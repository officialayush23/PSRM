# backend/routes/survey_router.py
"""
Survey system — midway and closing surveys for citizens and workers.
The agent rolls out surveys via Pub/Sub → notification_service.
Citizens receive FCM + email. Workers receive FCM.
Poor ratings trigger alerts to officials.
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


# ── Schemas ───────────────────────────────────────────────────────

class SurveyResponseSubmit(BaseModel):
    rating:          int            # 1-5
    feedback:        Optional[str]  = None
    is_resolved:     Optional[bool] = None   # for closing survey
    wants_followup:  Optional[bool] = None


# ── Get survey details ─────────────────────────────────────────────

@router.get("/{survey_instance_id}")
def get_survey(
    survey_instance_id: UUID,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    """Returns survey details for the citizen to fill in."""
    row = db.execute(
        text("""
            SELECT
                si.id, si.survey_type, si.status, si.expires_at,
                si.complaint_id, si.workflow_instance_id,
                c.complaint_number, c.title AS complaint_title,
                c.description, c.address_text,
                c.status AS complaint_status,
                it.name AS infra_type_name,
                st.title AS survey_title,
                st.description AS survey_description,
                st.questions
            FROM survey_instances      si
            JOIN complaints            c   ON c.id   = si.complaint_id
            LEFT JOIN infra_nodes      n   ON n.id   = c.infra_node_id
            LEFT JOIN infra_types      it  ON it.id  = n.infra_type_id
            LEFT JOIN survey_templates st  ON st.id  = si.template_id
            WHERE si.id = CAST(:sid AS uuid)
        """),
        {"sid": str(survey_instance_id)},
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Survey not found")

    if str(row["complaint_id"]) != str(current_user.user_id):
        # Allow if the complaint belongs to the user
        complaint_citizen = db.execute(
            text("SELECT citizen_id FROM complaints WHERE id = CAST(:cid AS uuid)"),
            {"cid": str(row["complaint_id"])},
        ).scalar()
        if str(complaint_citizen) != str(current_user.user_id):
            raise HTTPException(status_code=403, detail="Not allowed")

    if row["status"] == "completed":
        raise HTTPException(status_code=400, detail="Survey already completed")

    return {
        "id":                   str(row["id"]),
        "survey_type":          row["survey_type"],
        "expires_at":           row["expires_at"].isoformat() if row["expires_at"] else None,
        "complaint_number":     row["complaint_number"],
        "complaint_title":      row["complaint_title"],
        "complaint_description":row["description"],
        "address_text":         row["address_text"],
        "complaint_status":     row["complaint_status"],
        "infra_type_name":      row["infra_type_name"],
        "survey_title":         row["survey_title"] or _default_title(row["survey_type"]),
        "survey_description":   row["survey_description"] or _default_desc(row["survey_type"]),
        "questions":            row["questions"] or _default_questions(row["survey_type"]),
    }


# ── Submit survey response ────────────────────────────────────────

@router.post("/{survey_instance_id}/submit")
def submit_survey(
    survey_instance_id: UUID,
    body: SurveyResponseSubmit,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    if not (1 <= body.rating <= 5):
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")

    si = db.execute(
        text("""
            SELECT si.id, si.survey_type, si.status, si.complaint_id,
                   si.workflow_instance_id, si.city_id,
                   c.complaint_number, c.citizen_id
            FROM survey_instances si
            JOIN complaints c ON c.id = si.complaint_id
            WHERE si.id = CAST(:sid AS uuid)
        """),
        {"sid": str(survey_instance_id)},
    ).mappings().first()

    if not si:
        raise HTTPException(status_code=404, detail="Survey not found")
    if si["status"] == "completed":
        raise HTTPException(status_code=400, detail="Survey already completed")

    # Insert response
    db.execute(
        text("""
            INSERT INTO survey_responses (
                survey_instance_id, respondent_id, respondent_role,
                rating, feedback, is_resolved, wants_followup,
                response_data
            ) VALUES (
                CAST(:sid AS uuid),
                CAST(:uid AS uuid),
                :role,
                :rating,
                :feedback,
                :is_resolved,
                :wants_followup,
                CAST(:data AS jsonb)
            )
        """),
        {
            "sid":           str(survey_instance_id),
            "uid":           str(current_user.user_id),
            "role":          current_user.role,
            "rating":        body.rating,
            "feedback":      body.feedback,
            "is_resolved":   body.is_resolved,
            "wants_followup":body.wants_followup,
            "data":          json.dumps(body.dict()),
        },
    )

    # Mark survey completed
    db.execute(
        text("""
            UPDATE survey_instances
               SET status       = 'completed',
                   completed_at = NOW()
             WHERE id = CAST(:sid AS uuid)
        """),
        {"sid": str(survey_instance_id)},
    )

    # If closing survey says resolved → update complaint
    if si["survey_type"] == "closing" and body.is_resolved is True:
        db.execute(
            text("""
                UPDATE complaints
                   SET status      = 'resolved',
                       resolved_at = NOW(),
                       updated_at  = NOW()
                 WHERE id = CAST(:cid AS uuid)
                   AND status NOT IN ('resolved','closed','rejected')
            """),
            {"cid": str(si["complaint_id"])},
        )

    db.commit()

    # Trigger alert if rating is poor (< 3)
    if body.rating < 3:
        _trigger_quality_alert(db, si, body.rating, body.feedback)

    return {
        "status":  "submitted",
        "rating":  body.rating,
        "message": _thank_you_message(body.rating, si["survey_type"]),
    }


# ── Agent rolls out survey ────────────────────────────────────────

@router.post("/rollout")
def rollout_survey(
    complaint_id:          UUID,
    survey_type:           str,   # "midway" | "closing" | "worker_feedback"
    workflow_instance_id:  Optional[UUID] = None,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    """
    Called by the workflow agent / Pub/Sub handler to create and
    dispatch a survey to the citizen (and optionally workers).
    """
    if current_user.role not in ("official", "admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Not allowed")

    complaint = db.execute(
        text("""
            SELECT citizen_id, complaint_number, title, city_id
            FROM complaints WHERE id = CAST(:cid AS uuid)
        """),
        {"cid": str(complaint_id)},
    ).mappings().first()

    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")

    import uuid as _uuid
    si_id = str(_uuid.uuid4())

    db.execute(
        text("""
            INSERT INTO survey_instances (
                id, complaint_id, workflow_instance_id,
                city_id, survey_type, status,
                expires_at
            ) VALUES (
                CAST(:id AS uuid),
                CAST(:cid AS uuid),
                CAST(:wid AS uuid),
                CAST(:city AS uuid),
                :survey_type,
                'pending',
                NOW() + INTERVAL '7 days'
            )
        """),
        {
            "id":          si_id,
            "cid":         str(complaint_id),
            "wid":         str(workflow_instance_id) if workflow_instance_id else None,
            "city":        str(complaint["city_id"]),
            "survey_type": survey_type,
        },
    )
    db.commit()

    # Notify citizen
    event_key = "MIDWAY_SURVEY" if survey_type == "midway" else "COMPLAINT_RESOLVED"
    dispatch_notification(
        db,
        user_id=str(complaint["citizen_id"]),
        event_type=event_key,
        variables={"number": complaint["complaint_number"]},
        data={
            "survey_instance_id": si_id,
            "complaint_id":       str(complaint_id),
            "cta_path":           f"/survey/{si_id}",
        },
    )

    return {"survey_instance_id": si_id, "status": "dispatched"}


# ── Helpers ───────────────────────────────────────────────────────

def _default_title(survey_type: str) -> str:
    return {
        "midway":           "How is the work going?",
        "closing":          "Was your issue resolved?",
        "worker_feedback":  "Rate the work done",
    }.get(survey_type, "Share your feedback")


def _default_desc(survey_type: str) -> str:
    return {
        "midway":          "Work on your complaint is in progress. Please rate the work so far.",
        "closing":         "Your complaint has been marked resolved. Was the issue actually fixed?",
        "worker_feedback": "Please rate the quality of work done by the field team.",
    }.get(survey_type, "Please share your experience.")


def _default_questions(survey_type: str) -> list:
    base = [{"id": "rating", "type": "rating", "label": "Overall rating", "required": True}]
    if survey_type == "closing":
        base.append({"id": "is_resolved", "type": "boolean", "label": "Is the issue actually fixed?", "required": True})
        base.append({"id": "wants_followup", "type": "boolean", "label": "Do you want a follow-up?", "required": False})
    base.append({"id": "feedback", "type": "text", "label": "Any comments?", "required": False})
    return base


def _thank_you_message(rating: int, survey_type: str) -> str:
    if rating >= 4:
        return "Thank you for your feedback! We're glad the service was satisfactory."
    if rating >= 3:
        return "Thank you for your feedback. We'll use it to improve our service."
    return "Thank you for your feedback. We've alerted the concerned official to investigate."


def _trigger_quality_alert(db: Session, si, rating: int, feedback: Optional[str]):
    """Alert the assigned official when survey rating is poor."""
    try:
        official = db.execute(
            text("""
                SELECT wsi.assigned_official_id
                FROM workflow_step_instances wsi
                WHERE wsi.workflow_instance_id = CAST(:wid AS uuid)
                  AND wsi.assigned_official_id IS NOT NULL
                ORDER BY wsi.step_number DESC LIMIT 1
            """),
            {"wid": str(si["workflow_instance_id"]) if si["workflow_instance_id"] else "00000000-0000-0000-0000-000000000000"},
        ).mappings().first()

        if official and official["assigned_official_id"]:
            dispatch_notification(
                db,
                user_id=str(official["assigned_official_id"]),
                event_type="SURVEY_ALERT",
                variables={"task_id": si["complaint_number"]},
                data={
                    "complaint_id":  str(si["complaint_id"]),
                    "avg_rating":    str(rating),
                    "feedback":      feedback or "",
                },
            )
    except Exception as exc:
        logger.error("Survey quality alert failed: %s", exc)