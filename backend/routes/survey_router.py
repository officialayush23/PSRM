# backend/routes/survey_router.py
"""
Survey system — midway and closing surveys for citizens and workers.

SCHEMA FACTS (final.sql):
  survey_templates : id, name, survey_type, questions, is_active
                     NO title, NO description columns
  survey_instances : id, template_id(NN), complaint_id, workflow_instance_id,
                     survey_type, target_user_id(NN), target_role(NN),
                     triggered_by, channel, status, expires_at
                     NO city_id column
  survey_responses : id, survey_instance_id, respondent_id,
                     answers(JSONB NN), overall_rating, feedback_text
                     NO rating, NO respondent_role, NO is_resolved,
                     NO wants_followup, NO response_data columns
  survey_templates.survey_type CHECK: 'midway' | 'completion' | 'worker_feedback'
"""
import json
import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from db import get_db
from dependencies import get_current_user
from schemas import TokenData
from services.notification_service import dispatch_notification
from services.pubsub_service import publish_event

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/surveys", tags=["Surveys"])


class SurveyResponseSubmit(BaseModel):
    rating:         int
    feedback:       Optional[str]  = None
    is_resolved:    Optional[bool] = None
    wants_followup: Optional[bool] = None


def _get_template_id(db: Session, survey_type: str) -> Optional[str]:
    row = db.execute(
        text("SELECT id FROM survey_templates WHERE survey_type=:st AND is_active=TRUE LIMIT 1"),
        {"st": survey_type},
    ).first()
    return str(row[0]) if row else None


def _default_title(t): return {"midway":"How is the work going?","completion":"Was your issue resolved?","worker_feedback":"Rate the work done"}.get(t,"Share your feedback")
def _default_desc(t): return {"midway":"Work on your complaint is in progress.","completion":"Your complaint has been marked resolved. Was the issue fixed?","worker_feedback":"Please rate the quality of work done."}.get(t,"Please share your experience.")
def _default_questions(t):
    base = [{"id":"rating","type":"rating","label":"Overall rating","required":True}]
    if t == "completion":
        base.append({"id":"is_resolved","type":"boolean","label":"Is the issue actually fixed?","required":True})
        base.append({"id":"wants_followup","type":"boolean","label":"Do you want a follow-up?","required":False})
    base.append({"id":"feedback","type":"text","label":"Any comments?","required":False})
    return base

def _thank_you(rating, t):
    if rating>=4: return "Thank you! We're glad the service was satisfactory."
    if rating>=3: return "Thank you for your feedback. We'll use it to improve."
    return "Thank you. We've alerted the concerned official to investigate."

def _trigger_alert(db, si, rating, feedback):
    try:
        off = db.execute(text("""
            SELECT wsi.assigned_official_id FROM workflow_step_instances wsi
            WHERE wsi.workflow_instance_id=CAST(:wid AS uuid) AND wsi.assigned_official_id IS NOT NULL
            ORDER BY wsi.step_number DESC LIMIT 1
        """), {"wid": str(si["workflow_instance_id"]) if si["workflow_instance_id"] else "00000000-0000-0000-0000-000000000000"}).mappings().first()
        if off and off["assigned_official_id"]:
            dispatch_notification(db, user_id=str(off["assigned_official_id"]), event_type="SURVEY_ALERT",
                variables={"task_id": si.get("complaint_number","—")},
                data={"complaint_id":str(si["complaint_id"]),"avg_rating":str(rating),"feedback":feedback or ""})
    except Exception as e: logger.error("Survey alert failed: %s", e)


@router.get("/user/my")
def get_my_surveys(db: Session=Depends(get_db), current_user: TokenData=Depends(get_current_user)):
    rows = db.execute(text("""
        SELECT si.id, si.survey_type, si.status, si.created_at,
               c.id AS complaint_id, c.complaint_number, c.title AS complaint_title
        FROM survey_instances si JOIN complaints c ON c.id=si.complaint_id
        WHERE si.target_user_id=CAST(:uid AS uuid) AND si.status='pending'
        ORDER BY si.created_at DESC
    """), {"uid": str(current_user.user_id)}).mappings().all()
    return [{"id":str(r["id"]),"survey_type":r["survey_type"],"status":r["status"],
             "created_at":r["created_at"].isoformat() if r["created_at"] else None,
             "complaint_id":str(r["complaint_id"]) if r["complaint_id"] else None,
             "complaint_number":r["complaint_number"],"complaint_title":r["complaint_title"]} for r in rows]


@router.get("/{survey_instance_id}")
def get_survey(survey_instance_id: UUID, db: Session=Depends(get_db), current_user: TokenData=Depends(get_current_user)):
    row = db.execute(text("""
        SELECT si.id, si.survey_type, si.status, si.expires_at, si.target_user_id,
               si.complaint_id, si.workflow_instance_id,
               c.complaint_number, c.title AS complaint_title, c.description,
               c.address_text, c.status AS complaint_status,
               it.name AS infra_type_name,
               st.name AS survey_name, st.questions AS survey_questions
        FROM survey_instances si
        JOIN complaints c ON c.id=si.complaint_id
        LEFT JOIN infra_nodes n ON n.id=c.infra_node_id
        LEFT JOIN infra_types it ON it.id=n.infra_type_id
        LEFT JOIN survey_templates st ON st.id=si.template_id
        WHERE si.id=CAST(:sid AS uuid)
    """), {"sid": str(survey_instance_id)}).mappings().first()

    if not row: raise HTTPException(404, "Survey not found")
    if str(row["target_user_id"]) != str(current_user.user_id):
        cit = db.execute(text("SELECT citizen_id FROM complaints WHERE id=CAST(:cid AS uuid)"), {"cid":str(row["complaint_id"])}).scalar()
        if str(cit) != str(current_user.user_id): raise HTTPException(403, "Not allowed")
    if row["status"] == "completed": raise HTTPException(400, "Survey already completed")

    t = row["survey_type"]
    return {
        "id": str(row["id"]), "survey_type": t,
        "expires_at": row["expires_at"].isoformat() if row["expires_at"] else None,
        "complaint_number": row["complaint_number"], "complaint_title": row["complaint_title"],
        "complaint_description": row["description"], "address_text": row["address_text"],
        "complaint_status": row["complaint_status"], "infra_type_name": row["infra_type_name"],
        "survey_title": row["survey_name"] or _default_title(t),
        "survey_description": _default_desc(t),
        "questions": row["survey_questions"] or _default_questions(t),
    }


@router.post("/{survey_instance_id}/submit")
def submit_survey(survey_instance_id: UUID, body: SurveyResponseSubmit,
                  db: Session=Depends(get_db), current_user: TokenData=Depends(get_current_user)):
    if not (1 <= body.rating <= 5): raise HTTPException(400, "Rating must be between 1 and 5")

    si = db.execute(text("""
        SELECT si.id, si.survey_type, si.status, si.complaint_id, si.workflow_instance_id,
               c.complaint_number, c.citizen_id
        FROM survey_instances si JOIN complaints c ON c.id=si.complaint_id
        WHERE si.id=CAST(:sid AS uuid)
    """), {"sid": str(survey_instance_id)}).mappings().first()
    if not si: raise HTTPException(404, "Survey not found")
    if si["status"] == "completed": raise HTTPException(400, "Survey already completed")

    answers = {"rating": body.rating, "is_resolved": body.is_resolved, "wants_followup": body.wants_followup}
    db.execute(text("""
        INSERT INTO survey_responses (survey_instance_id, respondent_id, answers, overall_rating, feedback_text)
        VALUES (CAST(:sid AS uuid), CAST(:uid AS uuid), CAST(:answers AS jsonb), :rating, :feedback)
    """), {"sid":str(survey_instance_id),"uid":str(current_user.user_id),
           "answers":json.dumps(answers),"rating":body.rating,"feedback":body.feedback})

    db.execute(text("UPDATE survey_instances SET status='completed', completed_at=NOW() WHERE id=CAST(:sid AS uuid)"),
               {"sid": str(survey_instance_id)})

    if si["survey_type"] == "completion" and body.is_resolved is True:
        db.execute(text("""
            UPDATE complaints SET status='resolved', resolved_at=NOW(), updated_at=NOW()
            WHERE id=CAST(:cid AS uuid) AND status NOT IN ('resolved','closed','rejected')
        """), {"cid": str(si["complaint_id"])})

    db.commit()
    if body.rating < 3: _trigger_alert(db, si, body.rating, body.feedback)
    return {"status":"submitted","rating":body.rating,"message":_thank_you(body.rating, si["survey_type"])}


@router.post("/rollout")
def rollout_survey(complaint_id: UUID, survey_type: str,
                   workflow_instance_id: Optional[UUID]=None,
                   db: Session=Depends(get_db), current_user: TokenData=Depends(get_current_user)):
    if current_user.role not in ("official","admin","super_admin"): raise HTTPException(403,"Not allowed")
    if survey_type not in ("midway","completion","worker_feedback"):
        raise HTTPException(400, "survey_type must be 'midway', 'completion', or 'worker_feedback'")

    complaint = db.execute(text("SELECT citizen_id, complaint_number FROM complaints WHERE id=CAST(:cid AS uuid)"),
                           {"cid": str(complaint_id)}).mappings().first()
    if not complaint: raise HTTPException(404, "Complaint not found")

    template_id = _get_template_id(db, survey_type)
    if not template_id:
        raise HTTPException(422, f"No active survey_template for type '{survey_type}'. Seed survey_templates first.")

    import uuid as _uuid
    si_id = str(_uuid.uuid4())
    db.execute(text("""
        INSERT INTO survey_instances (
            id, template_id, complaint_id, workflow_instance_id,
            survey_type, target_user_id, target_role,
            triggered_by, channel, status, expires_at
        ) VALUES (
            CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:cid AS uuid), CAST(:wid AS uuid),
            :survey_type, CAST(:target AS uuid), 'citizen',
            'agent', 'portal', 'pending', NOW()+INTERVAL '7 days'
        )
    """), {"id":si_id,"tid":template_id,"cid":str(complaint_id),
           "wid":str(workflow_instance_id) if workflow_instance_id else None,
           "survey_type":survey_type,"target":str(complaint["citizen_id"])})
    db.commit()

    event_key = "MIDWAY_SURVEY" if survey_type == "midway" else "COMPLAINT_RESOLVED"
    dispatch_notification(db, user_id=str(complaint["citizen_id"]), event_type=event_key,
        variables={"number": complaint["complaint_number"]},
        data={"survey_instance_id":si_id,"complaint_id":str(complaint_id),"cta_path":f"/survey/{si_id}"})
    return {"survey_instance_id": si_id, "status": "dispatched"}