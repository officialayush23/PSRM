# backend/routes/admin_router.py
"""
Role-based Admin API.
Roles:
  super_admin — city-wide head, sees everything
  admin       — branch head, sees their jurisdiction
  official    — complaint handler, assigns work

All endpoints require Firebase auth + role check.
"""
import json
import logging
from typing import Any, Dict, List, Optional
from uuid import UUID

import vertexai
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session
from vertexai.generative_models import GenerationConfig, GenerativeModel

from config import settings
from db import get_db
from dependencies import get_current_user
from schemas import TokenData
from services.notification_service import dispatch_notification
from services.workflow_agent_service import (
    create_workflow_from_approval,
    suggest_workflows,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["Admin"])

ADMIN_ROLES = {"official", "admin", "super_admin"}
UPPER_ROLES = {"admin", "super_admin"}

_vertex_ok = False


def _require(current_user: TokenData, roles: set):
    if current_user.role not in roles:
        raise HTTPException(status_code=403, detail="Insufficient role")


def _ensure_vertex():
    global _vertex_ok
    if _vertex_ok:
        return
    vertexai.init(project=settings.GCS_PROJECT_ID, location=settings.VERTEX_AI_LOCATION)
    _vertex_ok = True


def _gemini_text(system: str, user: str, max_tokens: int = 1000) -> str:
    _ensure_vertex()
    model = GenerativeModel(
        "gemini-2.5-flash",
        system_instruction=system,
        generation_config=GenerationConfig(temperature=0.3, max_output_tokens=3060),
    )
    return (model.generate_content(user).text or "").strip()


# ══════════════════════════════════════════════════════════════
# 1. KPI DASHBOARD
# ══════════════════════════════════════════════════════════════

@router.get("/dashboard/kpi")
def get_dashboard_kpi(
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)
    uid = str(current_user.user_id)
    params: Dict[str, Any] = {}
    juri_filter = ""
    dept_filter = ""

    if current_user.role == "official":
        u = db.execute(
            text("SELECT department_id, jurisdiction_id FROM users WHERE id = CAST(:uid AS uuid)"),
            {"uid": uid},
        ).mappings().first()
        if u and u["department_id"]:
            dept_filter = (
                "AND EXISTS (SELECT 1 FROM tasks _t WHERE _t.complaint_id = c.id "
                "AND _t.department_id = CAST(:dept_id AS uuid) AND _t.is_deleted=FALSE)"
            )
            params["dept_id"] = str(u["department_id"])
    elif current_user.role == "admin":
        u = db.execute(
            text("SELECT jurisdiction_id FROM users WHERE id = CAST(:uid AS uuid)"),
            {"uid": uid},
        ).mappings().first()
        if u and u["jurisdiction_id"]:
            juri_filter = "AND c.jurisdiction_id = CAST(:juri_id AS uuid)"
            params["juri_id"] = str(u["jurisdiction_id"])

    cc = db.execute(
        text(f"""
            SELECT
                COUNT(*)                                                        AS total,
                COUNT(*) FILTER (WHERE c.status = 'received')                  AS received,
                COUNT(*) FILTER (WHERE c.status = 'dept_mapped')               AS dept_mapped,
                COUNT(*) FILTER (WHERE c.status = 'workflow_started')           AS workflow_started,
                COUNT(*) FILTER (WHERE c.status = 'in_progress')               AS in_progress,
                COUNT(*) FILTER (WHERE c.status = 'resolved')                  AS resolved,
                COUNT(*) FILTER (WHERE c.status = 'rejected')                  AS rejected,
                COUNT(*) FILTER (WHERE c.priority IN ('critical','emergency'))  AS urgent,
                COUNT(*) FILTER (WHERE c.is_repeat_complaint = TRUE)            AS repeat_complaints,
                COUNT(*) FILTER (WHERE c.created_at >= NOW() - INTERVAL '24 hours') AS today,
                COUNT(*) FILTER (WHERE c.created_at >= NOW() - INTERVAL '7 days')   AS this_week,
                COUNT(*) FILTER (WHERE c.workflow_instance_id IS NULL
                                   AND c.status NOT IN ('resolved','rejected','closed')) AS needs_workflow
            FROM complaints c
            WHERE c.is_deleted = FALSE {juri_filter} {dept_filter}
        """),
        params,
    ).mappings().first()

    sla = db.execute(
        text(f"""
            SELECT
                COUNT(*) FILTER (WHERE NOW() - c.created_at > INTERVAL '35 days')   AS critical_sla,
                COUNT(*) FILTER (WHERE NOW() - c.created_at BETWEEN INTERVAL '25 days' AND INTERVAL '35 days') AS warning_sla,
                COUNT(*) FILTER (WHERE c.status = 'resolved'
                                   AND c.resolved_at - c.created_at > INTERVAL '41 days') AS breached
            FROM complaints c
            WHERE c.is_deleted = FALSE
              AND c.status NOT IN ('resolved','rejected','closed')
              {juri_filter} {dept_filter}
        """),
        params,
    ).mappings().first()

    task_filter = ""
    task_params: Dict[str, Any] = {}
    if current_user.role == "official":
        task_filter = "AND t.assigned_official_id = CAST(:uid AS uuid)"
        task_params["uid"] = uid
    elif current_user.role == "admin" and params.get("juri_id"):
        task_filter = "AND t.jurisdiction_id = CAST(:juri_id AS uuid)"
        task_params["juri_id"] = params["juri_id"]

    tc = db.execute(
        text(f"""
            SELECT
                COUNT(*)                                                              AS total,
                COUNT(*) FILTER (WHERE t.status = 'pending')                         AS pending,
                COUNT(*) FILTER (WHERE t.status IN ('accepted','in_progress'))        AS active,
                COUNT(*) FILTER (WHERE t.status = 'completed')                       AS completed,
                COUNT(*) FILTER (WHERE t.due_at < NOW()
                                   AND t.status NOT IN ('completed','cancelled'))     AS overdue
            FROM tasks t
            WHERE t.is_deleted = FALSE {task_filter}
        """),
        task_params,
    ).mappings().first()

    survey_alerts = db.execute(
        text("""
            SELECT COUNT(*) FROM survey_responses
            WHERE overall_rating < 3
              AND submitted_at >= NOW() - INTERVAL '7 days'
        """),
    ).scalar() or 0

    dept_breakdown = []
    if current_user.role == "super_admin":
        rows = db.execute(
            text("""
                SELECT d.name AS dept_name, d.code AS dept_code,
                       COUNT(DISTINCT t.complaint_id) AS complaints,
                       COUNT(t.id) FILTER (WHERE t.status = 'completed') AS tasks_done,
                       COUNT(t.id) FILTER (WHERE t.due_at < NOW()
                           AND t.status NOT IN ('completed','cancelled')) AS overdue
                FROM departments d
                LEFT JOIN tasks t ON t.department_id = d.id AND t.is_deleted = FALSE
                GROUP BY d.id, d.name, d.code ORDER BY complaints DESC LIMIT 15
            """),
        ).mappings().all()
        dept_breakdown = [dict(r) for r in rows]

    return {
        "complaints":     dict(cc),
        "sla_risk":       dict(sla),
        "tasks":          dict(tc),
        "survey_alerts":  int(survey_alerts),
        "dept_breakdown": dept_breakdown,
        "role":           current_user.role,
    }


# ══════════════════════════════════════════════════════════════
# 2. DAILY BRIEFING
# ══════════════════════════════════════════════════════════════

@router.get("/crm/briefing")
def get_daily_briefing(
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)
    uid = str(current_user.user_id)

    stats = db.execute(
        text("""
            SELECT COUNT(*)                                                AS total_open,
                   COUNT(*) FILTER (WHERE priority IN ('critical','emergency')) AS urgent,
                   COUNT(*) FILTER (WHERE status = 'received')            AS needs_workflow,
                   COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS new_today
            FROM complaints
            WHERE is_deleted = FALSE AND status NOT IN ('resolved','rejected','closed')
        """),
    ).mappings().first()

    overdue = db.execute(
        text("SELECT COUNT(*) FROM tasks WHERE is_deleted=FALSE AND due_at<NOW() AND status NOT IN ('completed','cancelled')"),
    ).scalar() or 0

    poor = db.execute(
        text("SELECT COUNT(*) FROM survey_responses WHERE overall_rating<3 AND submitted_at>=NOW()-INTERVAL '7 days'"),
    ).scalar() or 0

    stuck = db.execute(
        text("SELECT COUNT(*) FROM complaints WHERE is_deleted=FALSE AND status NOT IN ('resolved','rejected','closed') AND updated_at<NOW()-INTERVAL '72 hours'"),
    ).scalar() or 0

    user_row = db.execute(
        text("SELECT full_name FROM users WHERE id = CAST(:uid AS uuid)"), {"uid": uid}
    ).mappings().first()
    name = (user_row["full_name"] if user_row else "Official") or "Official"

    ctx = (
        f"Open complaints: {stats['total_open']} ({stats['urgent']} urgent). "
        f"Needs workflow: {stats['needs_workflow']}. New today: {stats['new_today']}. "
        f"Overdue tasks: {overdue}. Poor surveys (7d): {poor}. Stalled >72h: {stuck}."
    )

    try:
        narrative = _gemini_text(
            system=(
                "You are the PS-CRM assistant for Delhi. Give a concise 3-4 sentence "
                "morning briefing. Be direct. Highlight urgent items. End with one action."
            ),
            user=f"Morning briefing for {name} ({current_user.role}). {ctx}",
            max_tokens=300,
        )
    except Exception as exc:
        logger.error("Briefing Gemini failed: %s", exc)
        narrative = (
            f"Good morning, {name}. {stats['total_open']} open complaints, "
            f"{stats['urgent']} urgent, {overdue} overdue tasks. "
            f"{stats['needs_workflow']} complaints need workflow assignment."
        )

    return {
        "greeting": narrative, "narrative": narrative,
        "stats":         dict(stats) | {"overdue_tasks": overdue, "poor_surveys": poor},
        "stalled_count": int(stuck),
    }


# ══════════════════════════════════════════════════════════════
# 3. CRM AGENT CHAT
# ══════════════════════════════════════════════════════════════

class ChatRequest(BaseModel):
    message: str
    history: List[Dict[str, str]] = []


@router.post("/crm/chat")
def crm_chat(
    body: ChatRequest,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)
    msg = body.message.lower()
    db_context = ""

    if any(k in msg for k in ["critical", "urgent", "emergency"]):
        rows = db.execute(text("""
            SELECT complaint_number, title, status, priority,
                   EXTRACT(EPOCH FROM (NOW()-created_at))/3600 AS age_hours
            FROM complaints WHERE priority IN ('critical','emergency')
              AND status NOT IN ('resolved','rejected','closed') AND is_deleted=FALSE
            ORDER BY created_at ASC LIMIT 10
        """)).mappings().all()
        db_context = "CRITICAL COMPLAINTS:\n" + "\n".join(
            f"  [{r['complaint_number']}] {r['title']} | {r['status']} | {r['age_hours']:.0f}h old" for r in rows)

    elif any(k in msg for k in ["repeat", "recurring"]):
        rows = db.execute(text("""
            SELECT complaint_number, title, status, repeat_gap_days, address_text
            FROM complaints WHERE is_repeat_complaint=TRUE AND is_deleted=FALSE
            ORDER BY created_at DESC LIMIT 10
        """)).mappings().all()
        db_context = "REPEAT COMPLAINTS:\n" + "\n".join(
            f"  [{r['complaint_number']}] {r['title']} | gap={r['repeat_gap_days']}d | {r['address_text']}" for r in rows)

    elif any(k in msg for k in ["stuck", "stalled", "overdue", "delayed"]):
        rows = db.execute(text("""
            SELECT complaint_number, title, status,
                   EXTRACT(DAY FROM NOW()-updated_at) AS days_stalled
            FROM complaints WHERE is_deleted=FALSE
              AND status NOT IN ('resolved','rejected','closed')
              AND updated_at<NOW()-INTERVAL '48 hours'
            ORDER BY updated_at ASC LIMIT 10
        """)).mappings().all()
        db_context = "STALLED COMPLAINTS:\n" + "\n".join(
            f"  [{r['complaint_number']}] {r['title']} | {r['status']} | {r['days_stalled']:.0f}d" for r in rows)

    elif any(k in msg for k in ["contractor", "performance", "worker"]):
        rows = db.execute(text("""
            SELECT c.company_name, c.performance_score, c.is_blacklisted,
                   COUNT(t.id) AS tasks, COUNT(t.id) FILTER(WHERE t.status='completed') AS done
            FROM contractors c
            LEFT JOIN tasks t ON t.assigned_contractor_id=c.id AND t.is_deleted=FALSE
            GROUP BY c.id, c.company_name, c.performance_score, c.is_blacklisted
            ORDER BY c.performance_score ASC LIMIT 10
        """)).mappings().all()
        db_context = "CONTRACTOR PERFORMANCE:\n" + "\n".join(
            f"  {r['company_name']} | score={r['performance_score']} | tasks={r['tasks']} done={r['done']} blacklisted={r['is_blacklisted']}" for r in rows)

    elif any(k in msg for k in ["sla", "breach", "deadline"]):
        rows = db.execute(text("""
            SELECT complaint_number, title, EXTRACT(DAY FROM NOW()-created_at) AS age_days, priority
            FROM complaints WHERE is_deleted=FALSE
              AND status NOT IN ('resolved','rejected','closed')
              AND NOW()-created_at>INTERVAL '25 days'
            ORDER BY created_at ASC LIMIT 10
        """)).mappings().all()
        db_context = "SLA RISK (>25d open, limit=41d):\n" + "\n".join(
            f"  [{r['complaint_number']}] {r['title']} | {r['age_days']:.0f}d | {r['priority']}" for r in rows)

    elif any(k in msg for k in ["survey", "rating", "feedback"]):
        row = db.execute(text("""
            SELECT AVG(overall_rating) AS avg, COUNT(*) AS total,
                   COUNT(*) FILTER(WHERE overall_rating<3) AS poor
            FROM survey_responses WHERE submitted_at>=NOW()-INTERVAL '30 days'
        """)).mappings().first()
        db_context = f"SURVEY STATS (30d): avg={float(row['avg'] or 0):.1f} total={row['total']} poor={row['poor']}"

    elif any(k in msg for k in ["multi", "multiple department", "coordination"]):
        rows = db.execute(text("""
            SELECT c.complaint_number, c.title, c.status, COUNT(DISTINCT t.department_id) AS depts
            FROM complaints c JOIN tasks t ON t.complaint_id=c.id AND t.is_deleted=FALSE
            WHERE c.is_deleted=FALSE AND c.status NOT IN ('resolved','rejected','closed')
            GROUP BY c.id, c.complaint_number, c.title, c.status
            HAVING COUNT(DISTINCT t.department_id)>1 ORDER BY depts DESC LIMIT 8
        """)).mappings().all()
        db_context = "MULTI-DEPT COMPLAINTS:\n" + "\n".join(
            f"  [{r['complaint_number']}] {r['title']} | {r['depts']} depts | {r['status']}" for r in rows)

    history_text = "\n".join(
        f"{'Official' if m.get('role')=='user' else 'Agent'}: {m.get('content','')}"
        for m in body.history[-6:]
    )

    prompt = ""
    if db_context:
        prompt += f"[Live PS-CRM data]\n{db_context}\n\n"
    if history_text:
        prompt += f"[Recent conversation]\n{history_text}\n\n"
    prompt += f"Official asks: {body.message}"

    try:
        reply = _gemini_text(
            system=(
                "You are the PS-CRM field assistant for Delhi municipal services. "
                "Help officials understand complaint status, tasks, SLA risks. "
                "Be concise and action-oriented. 2-5 sentences max unless a list is clearer."
            ),
            user=prompt,
            max_tokens=500,
        )
    except Exception as exc:
        logger.error("CRM chat Gemini failed: %s", exc)
        reply = "I couldn't process that right now. Please try again."

    return {"answer": reply, "data": None, "has_db_context": bool(db_context)}


# ══════════════════════════════════════════════════════════════
# 4. COMPLAINT QUEUE
# ══════════════════════════════════════════════════════════════

@router.get("/complaints/queue")
def get_complaint_queue(
    status:          Optional[str]  = Query(default=None),
    priority:        Optional[str]  = Query(default=None),
    infra_type_code: Optional[str]  = Query(default=None),
    needs_workflow:  Optional[bool] = Query(default=None),
    limit:  int = Query(default=50, le=200),
    offset: int = Query(default=0,  ge=0),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)
    uid = str(current_user.user_id)
    params: Dict[str, Any] = {"limit": limit, "offset": offset}
    filters = ["c.is_deleted = FALSE"]

    if current_user.role == "official":
        u = db.execute(
            text("SELECT jurisdiction_id FROM users WHERE id = CAST(:uid AS uuid)"), {"uid": uid}
        ).mappings().first()
        if u and u["jurisdiction_id"]:
            filters.append("c.jurisdiction_id = CAST(:juri_id AS uuid)")
            params["juri_id"] = str(u["jurisdiction_id"])
    elif current_user.role == "admin":
        u = db.execute(
            text("SELECT jurisdiction_id FROM users WHERE id = CAST(:uid AS uuid)"), {"uid": uid}
        ).mappings().first()
        if u and u["jurisdiction_id"]:
            filters.append("c.jurisdiction_id = CAST(:juri_id AS uuid)")
            params["juri_id"] = str(u["jurisdiction_id"])

    if status:
        filters.append("c.status = :status"); params["status"] = status
    if priority:
        filters.append("c.priority = :priority"); params["priority"] = priority
    if infra_type_code:
        filters.append("it.code = :itc"); params["itc"] = infra_type_code
    if needs_workflow is True:
        filters.append("c.workflow_instance_id IS NULL AND c.status NOT IN ('resolved','rejected','closed')")
    elif needs_workflow is False:
        filters.append("c.workflow_instance_id IS NOT NULL")

    where = " AND ".join(filters)

    rows = db.execute(
        text(f"""
            SELECT c.id, c.complaint_number, c.title, c.description,
                   c.status, c.priority, c.is_repeat_complaint, c.is_emergency,
                   c.address_text,
                   ST_Y(c.location::geometry) AS lat,
                   ST_X(c.location::geometry) AS lng,
                   c.created_at, c.updated_at, c.resolved_at,
                   EXTRACT(DAY FROM NOW()-c.created_at) AS age_days,
                   c.workflow_instance_id, c.agent_summary, c.agent_priority_reason,
                   it.name AS infra_type_name, it.code AS infra_type_code,
                   u.full_name AS citizen_name, u.phone AS citizen_phone
            FROM complaints c
            LEFT JOIN infra_nodes n  ON n.id  = c.infra_node_id
            LEFT JOIN infra_types it ON it.id = n.infra_type_id
            LEFT JOIN users u        ON u.id  = c.citizen_id
            WHERE {where}
            ORDER BY
                CASE c.priority WHEN 'emergency' THEN 1 WHEN 'critical' THEN 2
                    WHEN 'high' THEN 3 WHEN 'normal' THEN 4 WHEN 'low' THEN 5 ELSE 6 END,
                CASE WHEN c.is_repeat_complaint THEN 0 ELSE 1 END,
                c.created_at ASC
            LIMIT :limit OFFSET :offset
        """),
        params,
    ).mappings().all()

    total = db.execute(
        text(f"""
            SELECT COUNT(c.id) FROM complaints c
            LEFT JOIN infra_nodes n  ON n.id  = c.infra_node_id
            LEFT JOIN infra_types it ON it.id = n.infra_type_id
            WHERE {where}
        """),
        params,
    ).scalar() or 0

    def _fmt(r):
        d = dict(r)
        d["id"]       = str(r["id"])
        d["lat"]      = float(r["lat"]) if r["lat"] else None
        d["lng"]      = float(r["lng"]) if r["lng"] else None
        d["age_days"] = float(r["age_days"] or 0)
        d["workflow_instance_id"] = str(r["workflow_instance_id"]) if r["workflow_instance_id"] else None
        for ts in ("created_at", "updated_at", "resolved_at"):
            d[ts] = r[ts].isoformat() if r[ts] else None
        return d

    return {"total": int(total), "limit": limit, "offset": offset, "items": [_fmt(r) for r in rows]}


# ══════════════════════════════════════════════════════════════
# 5. SINGLE COMPLAINT (admin detail)
# ══════════════════════════════════════════════════════════════

@router.get("/complaints/{complaint_id}")
def get_complaint_admin(
    complaint_id: UUID,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)

    row = db.execute(
        text("""
            SELECT c.id, c.complaint_number, c.title, c.description,
                   c.status, c.priority, c.address_text,
                   c.is_repeat_complaint, c.repeat_gap_days, c.is_emergency,
                   c.agent_summary, c.agent_priority_reason, c.agent_suggested_dept_ids,
                   ST_Y(c.location::geometry) AS lat, ST_X(c.location::geometry) AS lng,
                   c.images, c.voice_transcript,
                   c.created_at, c.updated_at, c.resolved_at,
                   c.workflow_instance_id, c.infra_node_id,
                   u.full_name AS citizen_name, u.phone AS citizen_phone, u.email AS citizen_email,
                   it.name AS infra_type_name, it.code AS infra_type_code,
                   n.total_complaint_count AS node_total_complaints,
                   n.last_resolved_at AS node_last_resolved
            FROM complaints c
            LEFT JOIN infra_nodes n  ON n.id  = c.infra_node_id
            LEFT JOIN infra_types it ON it.id = n.infra_type_id
            LEFT JOIN users u        ON u.id  = c.citizen_id
            WHERE c.id = CAST(:cid AS uuid) AND c.is_deleted = FALSE
        """),
        {"cid": str(complaint_id)},
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Complaint not found")

    history = db.execute(
        text("""
            SELECT csh.old_status, csh.new_status, csh.reason, csh.created_at,
                   u.full_name AS changed_by_name
            FROM complaint_status_history csh
            LEFT JOIN users u ON u.id = csh.changed_by
            WHERE csh.complaint_id = CAST(:cid AS uuid) ORDER BY csh.created_at ASC
        """),
        {"cid": str(complaint_id)},
    ).mappings().all()

    tasks = db.execute(
        text("""
            SELECT t.id, t.task_number, t.title, t.status, t.priority,
                   t.due_at, t.completed_at, d.name AS dept_name,
                   COALESCE(wu.full_name, cu.full_name) AS assignee_name
            FROM tasks t JOIN departments d ON d.id = t.department_id
            LEFT JOIN workers w  ON w.id = t.assigned_worker_id
            LEFT JOIN users wu   ON wu.id = w.user_id
            LEFT JOIN contractors ct ON ct.id = t.assigned_contractor_id
            LEFT JOIN users cu   ON cu.id = ct.user_id
            WHERE t.complaint_id = CAST(:cid AS uuid) AND t.is_deleted = FALSE
            ORDER BY t.created_at ASC
        """),
        {"cid": str(complaint_id)},
    ).mappings().all()

    d = dict(row)
    d["id"]       = str(row["id"])
    d["lat"]      = float(row["lat"]) if row["lat"] else None
    d["lng"]      = float(row["lng"]) if row["lng"] else None
    d["workflow_instance_id"] = str(row["workflow_instance_id"]) if row["workflow_instance_id"] else None
    for ts in ("created_at", "updated_at", "resolved_at"):
        d[ts] = row[ts].isoformat() if row[ts] else None
    d["history"] = [dict(h) | {"created_at": h["created_at"].isoformat()} for h in history]
    d["tasks"]   = [
        dict(t) | {
            "id": str(t["id"]),
            "due_at":       t["due_at"].isoformat() if t["due_at"] else None,
            "completed_at": t["completed_at"].isoformat() if t["completed_at"] else None,
        }
        for t in tasks
    ]
    return d


# ══════════════════════════════════════════════════════════════
# 6. WORKFLOW SUGGESTIONS
# ══════════════════════════════════════════════════════════════

@router.get("/complaints/{complaint_id}/workflow-suggestions")
def get_workflow_suggestions(
    complaint_id: UUID,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)

    c = db.execute(
        text("""
            SELECT c.id, c.city_id, c.agent_summary, c.title, c.description,
                   c.priority, c.is_repeat_complaint, it.code AS infra_code
            FROM complaints c
            LEFT JOIN infra_nodes n  ON n.id  = c.infra_node_id
            LEFT JOIN infra_types it ON it.id = n.infra_type_id
            WHERE c.id = CAST(:cid AS uuid) AND c.is_deleted = FALSE
        """),
        {"cid": str(complaint_id)},
    ).mappings().first()

    if not c:
        raise HTTPException(status_code=404, detail="Complaint not found")

    summary = c["agent_summary"] or f"{c['title']}. {c['description']}"
    suggestions = suggest_workflows(
        db,
        complaint_id      = str(complaint_id),
        city_id           = str(c["city_id"]),
        infra_type_code   = c["infra_code"] or "unknown",
        complaint_summary = summary,
        priority          = c["priority"],
        is_repeat         = bool(c["is_repeat_complaint"]),
    )

    return {"complaint_id": str(complaint_id), "suggestions": suggestions}


# ══════════════════════════════════════════════════════════════
# 7. APPROVE WORKFLOW
# ══════════════════════════════════════════════════════════════

class WorkflowApproveRequest(BaseModel):
    template_id:  str
    edited_steps: Optional[List[Dict[str, Any]]] = None
    edit_reason:  Optional[str]                  = None


@router.post("/complaints/{complaint_id}/workflow-approve")
def approve_workflow(
    complaint_id: UUID,
    body: WorkflowApproveRequest,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)

    c = db.execute(
        text("SELECT city_id, citizen_id, complaint_number FROM complaints WHERE id = CAST(:cid AS uuid) AND is_deleted=FALSE"),
        {"cid": str(complaint_id)},
    ).mappings().first()

    if not c:
        raise HTTPException(status_code=404, detail="Complaint not found")

    try:
        result = create_workflow_from_approval(
            db,
            complaint_id = str(complaint_id),
            template_id  = body.template_id,
            official_id  = str(current_user.user_id),
            city_id      = str(c["city_id"]),
            edited_steps = body.edited_steps,
            edit_reason  = body.edit_reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    dispatch_notification(
        db,
        user_id    = str(c["citizen_id"]),
        event_type = "WORKFLOW_STARTED",
        variables  = {"number": c["complaint_number"], "eta": "TBD"},
        data       = {"complaint_id": str(complaint_id)},
    )

    return result


# ══════════════════════════════════════════════════════════════
# 8. REROUTE COMPLAINT
# ══════════════════════════════════════════════════════════════

class RerouteRequest(BaseModel):
    new_dept_ids: List[str]
    reason: str


@router.post("/complaints/{complaint_id}/reroute")
def reroute_complaint(
    complaint_id: UUID,
    body: RerouteRequest,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)

    if not body.reason or len(body.reason.strip()) < 10:
        raise HTTPException(status_code=400, detail="Reason must be at least 10 characters")

    c = db.execute(
        text("SELECT id FROM complaints WHERE id = CAST(:cid AS uuid) AND is_deleted=FALSE"),
        {"cid": str(complaint_id)},
    ).mappings().first()

    if not c:
        raise HTTPException(status_code=404, detail="Complaint not found")

    db.execute(
        text("""
            UPDATE complaints
               SET agent_suggested_dept_ids = CAST(:dids AS uuid[]),
                   status = 'dept_mapped', updated_at = NOW()
             WHERE id = CAST(:cid AS uuid)
        """),
        {"cid": str(complaint_id), "dids": [str(d) for d in body.new_dept_ids]},
    )
    db.execute(
        text("""
            INSERT INTO domain_events (event_type, entity_type, entity_id, actor_id, actor_type, payload, complaint_id)
            VALUES ('COMPLAINT_REROUTED','complaint',CAST(:cid AS uuid),CAST(:uid AS uuid),'official',CAST(:p AS jsonb),CAST(:cid AS uuid))
        """),
        {
            "cid": str(complaint_id), "uid": str(current_user.user_id),
            "p": json.dumps({"new_dept_ids": body.new_dept_ids, "reason": body.reason}),
        },
    )
    db.commit()
    return {"status": "rerouted", "new_dept_ids": body.new_dept_ids}


# ══════════════════════════════════════════════════════════════
# 9. INFRA NODE SUMMARY
# ══════════════════════════════════════════════════════════════

@router.get("/infra-nodes/{node_id}/summary")
def get_infra_node_summary(
    node_id: UUID,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)

    node = db.execute(
        text("""
            SELECT n.id, n.name, n.status, n.total_complaint_count, n.total_resolved_count,
                   n.last_resolved_at,
                   it.name AS infra_type_name, it.code AS infra_type_code,
                   it.repeat_alert_years,
                   ST_Y(n.location::geometry) AS lat, ST_X(n.location::geometry) AS lng,
                   j.name AS jurisdiction_name
            FROM infra_nodes n
            JOIN infra_types it  ON it.id = n.infra_type_id
            LEFT JOIN jurisdictions j ON j.id = n.jurisdiction_id
            WHERE n.id = CAST(:nid AS uuid) AND n.is_deleted = FALSE
        """),
        {"nid": str(node_id)},
    ).mappings().first()

    if not node:
        raise HTTPException(status_code=404, detail="Infra node not found")

    complaints = db.execute(
        text("""
            SELECT c.id, c.complaint_number, c.title, c.status, c.priority,
                   c.created_at, c.resolved_at, c.is_repeat_complaint, c.agent_summary
            FROM complaints c
            WHERE c.infra_node_id = CAST(:nid AS uuid) AND c.is_deleted = FALSE
            ORDER BY c.created_at DESC LIMIT 20
        """),
        {"nid": str(node_id)},
    ).mappings().all()

    health = db.execute(
        text("SELECT health_score, avg_resolution_days, computed_at FROM asset_health_logs WHERE infra_node_id=CAST(:nid AS uuid) ORDER BY computed_at DESC LIMIT 1"),
        {"nid": str(node_id)},
    ).mappings().first()

    open_count = sum(1 for c in complaints if c["status"] not in ("resolved", "rejected"))
    titles     = "; ".join(c["title"] for c in complaints[:5])

    try:
        recommendation = _gemini_text(
            system="You are a Delhi infrastructure analyst. Be concise, max 2 sentences.",
            user=(
                f"Infrastructure: {node['infra_type_name']} at {node['jurisdiction_name']}. "
                f"Total complaints: {node['total_complaint_count']}, Open: {open_count}. "
                f"Recent issues: {titles}. Suggest the most effective remediation."
            ),
            max_tokens=150,
        )
    except Exception:
        recommendation = f"This {node['infra_type_name']} has {node['total_complaint_count']} total complaints. Consider preventive maintenance."

    return {
        "node": dict(node) | {
            "lat": float(node["lat"]) if node["lat"] else None,
            "lng": float(node["lng"]) if node["lng"] else None,
            "last_resolved_at": node["last_resolved_at"].isoformat() if node["last_resolved_at"] else None,
        },
        "asset_health":         dict(health) if health else None,
        "open_complaint_count": open_count,
        "complaints": [
            dict(c) | {
                "id": str(c["id"]),
                "created_at":  c["created_at"].isoformat() if c["created_at"] else None,
                "resolved_at": c["resolved_at"].isoformat() if c["resolved_at"] else None,
            }
            for c in complaints
        ],
        "ai_recommendation": recommendation,
    }


# ══════════════════════════════════════════════════════════════
# 10. TASK ASSIGNMENT
# ══════════════════════════════════════════════════════════════

class AssignTaskRequest(BaseModel):
    worker_id:            Optional[str] = None
    contractor_id:        Optional[str] = None
    official_id:          Optional[str] = None
    notes:                Optional[str] = None
    override_reason_code: Optional[str] = None


@router.post("/tasks/{task_id}/assign")
def assign_task(
    task_id: UUID,
    body: AssignTaskRequest,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)

    if not any([body.worker_id, body.contractor_id, body.official_id]):
        raise HTTPException(status_code=400, detail="Provide at least one assignee")

    task = db.execute(
        text("""
            SELECT id, status, assigned_worker_id, assigned_contractor_id, title
            FROM tasks WHERE id = CAST(:tid AS uuid) AND is_deleted = FALSE
        """),
        {"tid": str(task_id)},
    ).mappings().first()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    is_reassignment = bool(task["assigned_worker_id"] or task["assigned_contractor_id"])
    if is_reassignment and not body.override_reason_code:
        raise HTTPException(status_code=400, detail="override_reason_code required for reassignment")

    prev = {}
    if task["assigned_worker_id"]:
        prev["worker_id"] = str(task["assigned_worker_id"])
    if task["assigned_contractor_id"]:
        prev["contractor_id"] = str(task["assigned_contractor_id"])

    db.execute(
        text("""
            UPDATE tasks
               SET assigned_worker_id     = CAST(:wid AS uuid),
                   assigned_contractor_id = CAST(:cid AS uuid),
                   assigned_official_id   = CAST(:oid AS uuid),
                   override_reason_code   = :orc,
                   override_notes         = :notes,
                   override_by            = CAST(:by  AS uuid),
                   override_at            = CASE WHEN :orc IS NOT NULL THEN NOW() ELSE override_at END,
                   previous_assignee      = CAST(:prev AS jsonb),
                   status = CASE WHEN status='pending' THEN 'accepted' ELSE status END,
                   updated_at = NOW()
             WHERE id = CAST(:tid AS uuid)
        """),
        {
            "tid": str(task_id), "wid": body.worker_id, "cid": body.contractor_id,
            "oid": body.official_id, "orc": body.override_reason_code,
            "notes": body.notes, "by": str(current_user.user_id),
            "prev": json.dumps(prev) if prev else "{}",
        },
    )

    if body.worker_id:
        db.execute(
            text("UPDATE workers SET current_task_count=current_task_count+1, updated_at=NOW() WHERE id=CAST(:wid AS uuid)"),
            {"wid": body.worker_id},
        )
        worker_user = db.execute(
            text("SELECT user_id FROM workers WHERE id = CAST(:wid AS uuid)"), {"wid": body.worker_id}
        ).scalar()
        if worker_user:
            dispatch_notification(
                db, user_id=str(worker_user), event_type="TASK_ASSIGNED",
                variables={"task_title": task["title"]}, data={"task_id": str(task_id)},
            )

    db.commit()
    return {"status": "assigned", "task_id": str(task_id)}


# ══════════════════════════════════════════════════════════════
# 11. AVAILABLE WORKERS
# ══════════════════════════════════════════════════════════════

@router.get("/workers/available")
def get_available_workers(
    dept_id: Optional[str] = Query(default=None),
    skill:   Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)

    params: Dict[str, Any] = {}
    filters = ["w.is_available = TRUE"]
    if dept_id:
        filters.append("w.department_id = CAST(:dept_id AS uuid)"); params["dept_id"] = dept_id
    if skill:
        filters.append(":skill = ANY(w.skills)"); params["skill"] = skill

    rows = db.execute(
        text(f"""
            SELECT w.id, w.employee_id, w.skills, w.current_task_count, w.performance_score,
                   u.full_name, u.phone,
                   d.name AS dept_name, d.code AS dept_code,
                   c.company_name AS contractor_name
            FROM workers w
            JOIN users u ON u.id = w.user_id
            LEFT JOIN departments d ON d.id = w.department_id
            LEFT JOIN contractors c ON c.id = w.contractor_id
            WHERE {" AND ".join(filters)}
            ORDER BY w.performance_score DESC, w.current_task_count ASC LIMIT 50
        """),
        params,
    ).mappings().all()

    return [dict(r) | {"id": str(r["id"])} for r in rows]


# ══════════════════════════════════════════════════════════════
# 12. AVAILABLE CONTRACTORS
# ══════════════════════════════════════════════════════════════

@router.get("/contractors/available")
def get_available_contractors(
    dept_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)

    params: Dict[str, Any] = {}
    filters = ["c.is_blacklisted=FALSE", "(c.license_expiry IS NULL OR c.license_expiry>NOW())"]
    if dept_id:
        filters.append("CAST(:dept_id AS uuid)=ANY(c.registered_dept_ids)"); params["dept_id"] = dept_id

    rows = db.execute(
        text(f"""
            SELECT c.id, c.company_name, c.registration_number,
                   c.performance_score, c.max_concurrent_tasks, c.license_expiry,
                   u.full_name AS contact_name, u.phone AS contact_phone,
                   COUNT(t.id) FILTER(WHERE t.status NOT IN ('completed','cancelled','rejected')) AS active_tasks
            FROM contractors c
            JOIN users u ON u.id = c.user_id
            LEFT JOIN tasks t ON t.assigned_contractor_id=c.id AND t.is_deleted=FALSE
            WHERE {" AND ".join(filters)}
            GROUP BY c.id, c.company_name, c.registration_number,
                     c.performance_score, c.max_concurrent_tasks, c.license_expiry,
                     u.full_name, u.phone
            HAVING COUNT(t.id) FILTER(WHERE t.status NOT IN ('completed','cancelled','rejected'))<c.max_concurrent_tasks
            ORDER BY c.performance_score DESC LIMIT 30
        """),
        params,
    ).mappings().all()

    return [dict(r) | {"id": str(r["id"])} for r in rows]


# ══════════════════════════════════════════════════════════════
# 13. DEPARTMENTS LIST
# ══════════════════════════════════════════════════════════════

@router.get("/departments")
def get_departments(
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)

    rows = db.execute(
        text("""
            SELECT d.id, d.name, d.code, d.contact_email, d.contact_phone,
                   j.name AS jurisdiction_name, u.full_name AS head_name
            FROM departments d
            LEFT JOIN jurisdictions j ON j.id = d.jurisdiction_id
            LEFT JOIN users u ON u.id = d.head_official_id
            ORDER BY d.name
        """),
    ).mappings().all()

    return [dict(r) | {"id": str(r["id"])} for r in rows]


# ══════════════════════════════════════════════════════════════
# 14. OFFICIALS LIST
# ══════════════════════════════════════════════════════════════

@router.get("/officials")
def get_officials(
    dept_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, UPPER_ROLES)

    params: Dict[str, Any] = {}
    filters = ["u.role IN ('official','admin','super_admin')", "u.is_active=TRUE"]
    if dept_id:
        filters.append("u.department_id=CAST(:dept_id AS uuid)"); params["dept_id"] = dept_id

    rows = db.execute(
        text(f"""
            SELECT u.id, u.full_name, u.email, u.phone, u.role,
                   d.name AS dept_name, d.code AS dept_code,
                   j.name AS jurisdiction_name
            FROM users u
            LEFT JOIN departments d  ON d.id = u.department_id
            LEFT JOIN jurisdictions j ON j.id = u.jurisdiction_id
            WHERE {" AND ".join(filters)}
            ORDER BY u.full_name LIMIT 100
        """),
        params,
    ).mappings().all()

    return [dict(r) | {"id": str(r["id"])} for r in rows]

# ══════════════════════════════════════════════════════════════
# USER MANAGEMENT — super_admin creates officials/workers/admins
# ══════════════════════════════════════════════════════════════

class CreateUserRequest(BaseModel):
    email:              str
    full_name:          str
    role:               str              # official | admin | worker | contractor
    department_id:      Optional[str]    = None
    jurisdiction_id:    Optional[str]    = None
    phone:              Optional[str]    = None
    preferred_language: str              = "hi"
    temp_password:      str              = "PSCrm@2025"   # user must change on first login


class UpdateUserRequest(BaseModel):
    full_name:          Optional[str]   = None
    role:               Optional[str]   = None
    department_id:      Optional[str]   = None
    jurisdiction_id:    Optional[str]   = None
    phone:              Optional[str]   = None
    is_active:          Optional[bool]  = None


@router.post("/users")
def create_user(
    body: CreateUserRequest,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    """
    Super admin creates a new official/worker/admin with a Firebase account.
    Steps:
      1. firebase_admin.auth.create_user(email, password, display_name)
      2. INSERT INTO users with auth_uid = firebase_uid
    The user receives a welcome email via Firebase (or admin shares temp password).
    """
    _require(current_user, {"super_admin"})

    VALID_ROLES = {"official", "admin", "worker", "contractor", "super_admin"}
    if body.role not in VALID_ROLES:
        raise HTTPException(400, f"role must be one of: {VALID_ROLES}")

    # Check email not already used
    existing = db.execute(
        text("SELECT id FROM users WHERE email=:email"),
        {"email": body.email.lower().strip()},
    ).first()
    if existing:
        raise HTTPException(409, "Email already exists in DB")

    # 1. Create Firebase user
    import firebase_admin.auth as fb_auth
    try:
        fb_user = fb_auth.create_user(
            email=body.email.lower().strip(),
            password=body.temp_password,
            display_name=body.full_name,
            email_verified=False,
        )
        firebase_uid = fb_user.uid
    except fb_auth.EmailAlreadyExistsError:
        # Firebase already has the user — find their UID and proceed
        try:
            fb_user = fb_auth.get_user_by_email(body.email.lower().strip())
            firebase_uid = fb_user.uid
        except Exception as exc:
            raise HTTPException(400, f"Firebase error: {exc}")
    except Exception as exc:
        raise HTTPException(400, f"Could not create Firebase user: {exc}")

    # 2. Resolve city from current super_admin
    city_row = db.execute(
        text("SELECT city_id FROM users WHERE id=CAST(:uid AS uuid)"),
        {"uid": str(current_user.user_id)},
    ).first()
    city_id = str(city_row[0]) if city_row and city_row[0] else None

    if not city_id:
        # Fall back to first city
        city_id = str(db.execute(text("SELECT id FROM cities LIMIT 1")).scalar())

    # 3. Insert into users
    import uuid as _uuid
    new_user_id = str(_uuid.uuid4())
    db.execute(
        text("""
            INSERT INTO users (
                id, auth_uid, auth_provider, email, phone, full_name,
                role, preferred_language, city_id, department_id, jurisdiction_id,
                is_active, is_verified, twilio_opt_in, email_opt_in, metadata
            ) VALUES (
                CAST(:id   AS uuid),
                :auth_uid, 'password',
                :email, :phone, :full_name,
                :role, :lang,
                CAST(:city AS uuid),
                CAST(:dept AS uuid),
                CAST(:jur  AS uuid),
                TRUE, FALSE, TRUE, TRUE,
                '{}'::jsonb
            )
        """),
        {
            "id":       new_user_id,
            "auth_uid": firebase_uid,
            "email":    body.email.lower().strip(),
            "phone":    body.phone or None,
            "full_name":body.full_name,
            "role":     body.role,
            "lang":     body.preferred_language,
            "city":     city_id,
            "dept":     body.department_id or None,
            "jur":      body.jurisdiction_id or None,
        },
    )

    # 4. If worker/contractor, create the specialist row
    if body.role == "worker":
        db.execute(
            text("""
                INSERT INTO workers (user_id, department_id, skills, is_available)
                VALUES (CAST(:uid AS uuid), CAST(:dept AS uuid), '{}'::text[], TRUE)
            """),
            {"uid": new_user_id, "dept": body.department_id or None},
        )
    elif body.role == "contractor":
        db.execute(
            text("""
                INSERT INTO contractors (
                    user_id, city_id, company_name, registration_number,
                    registered_dept_ids
                ) VALUES (
                    CAST(:uid AS uuid), CAST(:city AS uuid),
                    :name, :reg,
                    '{}'::uuid[]
                )
            """),
            {"uid": new_user_id, "city": city_id,
             "name": body.full_name + " Contractors", "reg": "PENDING-" + new_user_id[-8:].upper()},
        )

    db.commit()

    # 5. Generate password reset link so user can set their own password
    reset_link = None
    try:
        reset_link = fb_auth.generate_password_reset_link(body.email.lower().strip())
    except Exception:
        pass  # not critical

    return {
        "user_id":     new_user_id,
        "firebase_uid": firebase_uid,
        "email":       body.email.lower().strip(),
        "role":        body.role,
        "temp_password": body.temp_password,
        "reset_link":  reset_link,
        "message":     f"User created. Share temp password '{body.temp_password}' or send reset link.",
    }


@router.patch("/users/{user_id}")
def update_user(
    user_id: UUID,
    body: UpdateUserRequest,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    """Update role, department, jurisdiction, is_active for any staff user."""
    _require(current_user, {"super_admin", "admin"})

    sets = []
    params: Dict[str, Any] = {"uid": str(user_id)}
    if body.full_name is not None:
        sets.append("full_name=:full_name"); params["full_name"] = body.full_name
    if body.role is not None:
        sets.append("role=:role"); params["role"] = body.role
    if body.department_id is not None:
        sets.append("department_id=CAST(:dept_id AS uuid)"); params["dept_id"] = body.department_id
    if body.jurisdiction_id is not None:
        sets.append("jurisdiction_id=CAST(:jur_id AS uuid)"); params["jur_id"] = body.jurisdiction_id
    if body.phone is not None:
        sets.append("phone=:phone"); params["phone"] = body.phone or None
    if body.is_active is not None:
        sets.append("is_active=:is_active"); params["is_active"] = body.is_active

    if not sets:
        raise HTTPException(400, "Nothing to update")

    sets.append("updated_at=NOW()")
    db.execute(
        text(f"UPDATE users SET {', '.join(sets)} WHERE id=CAST(:uid AS uuid)"),
        params,
    )

    # If department changed and user is a worker, update workers table too
    if body.department_id:
        db.execute(
            text("UPDATE workers SET department_id=CAST(:dept AS uuid) WHERE user_id=CAST(:uid AS uuid)"),
            {"dept": body.department_id, "uid": str(user_id)},
        )

    db.commit()
    return {"status": "updated", "user_id": str(user_id)}


@router.get("/users")
def list_staff_users(
    role:    Optional[str]  = Query(default=None),
    dept_id: Optional[UUID] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    """List all staff users (officials, admins, workers, contractors)."""
    _require(current_user, ADMIN_ROLES)

    ctx_row = db.execute(
        text("SELECT city_id FROM users WHERE id=CAST(:uid AS uuid)"),
        {"uid": str(current_user.user_id)},
    ).first()
    city_id = str(ctx_row[0]) if ctx_row and ctx_row[0] else None

    filters = ["u.city_id=CAST(:city_id AS uuid)", "u.role != 'citizen'"]
    params: Dict[str, Any] = {"city_id": city_id}

    if role:
        filters.append("u.role=:role"); params["role"] = role
    if dept_id:
        filters.append("u.department_id=CAST(:dept_id AS uuid)"); params["dept_id"] = str(dept_id)

    rows = db.execute(
        text(f"""
            SELECT u.id, u.full_name, u.email, u.phone, u.role,
                   u.is_active, u.auth_uid, u.preferred_language,
                   d.name AS dept_name, d.code AS dept_code,
                   j.name AS jurisdiction_name,
                   w.performance_score AS worker_score,
                   w.current_task_count, w.is_available
            FROM users u
            LEFT JOIN departments  d ON d.id=u.department_id
            LEFT JOIN jurisdictions j ON j.id=u.jurisdiction_id
            LEFT JOIN workers      w ON w.user_id=u.id
            WHERE {' AND '.join(filters)}
            ORDER BY u.role, u.full_name
            LIMIT 200
        """),
        params,
    ).mappings().all()

    return [
        {
            "id":               str(r["id"]),
            "full_name":        r["full_name"],
            "email":            r["email"],
            "phone":            r["phone"],
            "role":             r["role"],
            "is_active":        r["is_active"],
            "has_firebase_auth":bool(r["auth_uid"]),
            "preferred_language":r["preferred_language"],
            "dept_name":        r["dept_name"],
            "dept_code":        r["dept_code"],
            "jurisdiction_name":r["jurisdiction_name"],
            "worker_score":     float(r["worker_score"]) if r["worker_score"] else None,
            "current_task_count":r["current_task_count"],
            "is_available":     r["is_available"],
        }
        for r in rows
    ]


@router.post("/users/{user_id}/deactivate")
def deactivate_user(
    user_id: UUID,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    """Deactivates user in DB AND disables in Firebase."""
    _require(current_user, {"super_admin"})
    auth_uid = db.execute(
        text("SELECT auth_uid FROM users WHERE id=CAST(:uid AS uuid)"),
        {"uid": str(user_id)},
    ).scalar()

    db.execute(
        text("UPDATE users SET is_active=FALSE, updated_at=NOW() WHERE id=CAST(:uid AS uuid)"),
        {"uid": str(user_id)},
    )
    db.commit()

    if auth_uid:
        try:
            import firebase_admin.auth as fb_auth
            fb_auth.update_user(auth_uid, disabled=True)
        except Exception as exc:
            logger.warning("Firebase disable failed for %s: %s", auth_uid, exc)

    return {"status": "deactivated", "user_id": str(user_id)}