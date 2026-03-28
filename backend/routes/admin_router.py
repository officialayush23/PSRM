# backend/routes/admin_router.py
"""
Role-based Admin API — Production-ready, fully dept-scoped.

Scoping rules:
  super_admin → city-wide (user's city_id)
  admin       → their department_id (complaints where dept is in agent_suggested_dept_ids)
  official    → their department_id + optionally jurisdiction_id

Gemini model: gemini-2.5-flash (all AI calls)

Key fixes:
  - KPI returns "summary" key matching frontend field names
  - Dept-scoped filtering on ALL complaint queries
  - task_filter uses valid columns (assigned_official_id, jurisdiction_id exist on tasks)
  - Infra node deep AI summary (on-demand endpoint)
  - Infra node reroute endpoint
  - CRM chat returns structured DB data
  - Performance: city_id on all heavy queries, shared _get_user_scope() helper
"""
import json
import logging
import uuid as _uuid
from datetime import datetime
from functools import lru_cache
from typing import Any, Dict, List, Optional
from uuid import UUID

import vertexai
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session
from vertexai.generative_models import (
    GenerationConfig,
    GenerativeModel,
    HarmCategory,
    HarmBlockThreshold,
)

_SAFETY_SETTINGS = {
    HarmCategory.HARM_CATEGORY_HATE_SPEECH:       HarmBlockThreshold.BLOCK_ONLY_HIGH,
    HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_ONLY_HIGH,
    HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_ONLY_HIGH,
    HarmCategory.HARM_CATEGORY_HARASSMENT:        HarmBlockThreshold.BLOCK_ONLY_HIGH,
}

from config import settings
from db import get_db
from dependencies import get_current_user
from schemas import TokenData
from services.notification_service import dispatch_notification
from services.workflow_agent_service import (
    create_workflow_from_approval,
    create_workflow_for_infra_node,
    suggest_workflows,
    suggest_workflows_for_node,
)
from services.infra_node_service import parse_requirements, rebuild_summary_from_complaints

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


def _gemini(system: str, user_prompt: str, max_tokens: int = 800, temperature: float = 0.2) -> str:
    """Single Gemini 2.5 Flash call."""
    _ensure_vertex()
    model = GenerativeModel(
        "gemini-2.5-flash",
        system_instruction=system,
        generation_config=GenerationConfig(temperature=temperature, max_output_tokens=max_tokens),
    )
    return (model.generate_content(user_prompt, safety_settings=_SAFETY_SETTINGS).text or "").strip()


# ── Shared scope helper — called once per request ─────────────────

def _get_user_scope(db: Session, user_id: str, role: str) -> Dict[str, Any]:
    """
    Returns scoping metadata for the current user.
    Used by KPI, complaint queue, briefing, etc.

    Returns:
        city_id, department_id, jurisdiction_id,
        complaint_where (SQL fragment), complaint_params (dict),
        task_where (SQL fragment), task_params (dict)
    """
    u = db.execute(
        text("""
            SELECT city_id, department_id, jurisdiction_id, full_name
            FROM users WHERE id = CAST(:uid AS uuid)
        """),
        {"uid": user_id},
    ).mappings().first()

    if not u:
        return {}

    city_id       = str(u["city_id"]) if u["city_id"] else None
    dept_id       = str(u["department_id"]) if u["department_id"] else None
    jur_id        = str(u["jurisdiction_id"]) if u["jurisdiction_id"] else None

    # ── Complaint scoping ─────────────────────────────────────────
    # Base: city-wide, not deleted
    c_where  = "c.is_deleted = FALSE"
    c_params: Dict[str, Any] = {}

    if city_id:
        c_where += " AND c.city_id = CAST(:city_id AS uuid)"
        c_params["city_id"] = city_id

    if role == "official":
        # official sees complaints routed to their department
        if dept_id:
            c_where += " AND CAST(:dept_id AS uuid) = ANY(c.agent_suggested_dept_ids)"
            c_params["dept_id"] = dept_id
        # additionally constrain to jurisdiction if set
        if jur_id:
            c_where += " AND c.jurisdiction_id = CAST(:jur_id AS uuid)"
            c_params["jur_id"] = jur_id

    elif role == "admin":
        # admin sees their department across jurisdiction
        if dept_id:
            c_where += " AND CAST(:dept_id AS uuid) = ANY(c.agent_suggested_dept_ids)"
            c_params["dept_id"] = dept_id

    # super_admin: no additional filter — sees all city complaints

    # ── Task scoping ──────────────────────────────────────────────
    t_where  = "t.is_deleted = FALSE"
    t_params: Dict[str, Any] = {}

    if role == "official":
        # Tasks assigned to this official, or in their department
        if dept_id:
            t_where += " AND t.department_id = CAST(:t_dept_id AS uuid)"
            t_params["t_dept_id"] = dept_id
    elif role == "admin":
        if dept_id:
            t_where += " AND t.department_id = CAST(:t_dept_id AS uuid)"
            t_params["t_dept_id"] = dept_id
    elif role == "super_admin" and city_id:
        # Tasks via department's city
        t_where += " AND EXISTS (SELECT 1 FROM departments d WHERE d.id=t.department_id AND d.city_id=CAST(:city_id AS uuid))"
        t_params["city_id"] = city_id

    return {
        "city_id":      city_id,
        "dept_id":      dept_id,
        "jur_id":       jur_id,
        "full_name":    u["full_name"],
        "c_where":      c_where,
        "c_params":     c_params,
        "t_where":      t_where,
        "t_params":     t_params,
    }


# ══════════════════════════════════════════════════════════════
# 1. KPI DASHBOARD — returns "summary" key matching frontend
# ══════════════════════════════════════════════════════════════

@router.get("/dashboard/kpi")
def get_dashboard_kpi(
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)
    scope = _get_user_scope(db, str(current_user.user_id), current_user.role)
    if not scope:
        raise HTTPException(status_code=400, detail="User scope could not be determined")

    c_where  = scope["c_where"]
    c_params = dict(scope["c_params"])
    t_where  = scope["t_where"]
    t_params = dict(scope["t_params"])

    # ── Complaint counts ──────────────────────────────────────────
    cc = db.execute(
        text(f"""
            SELECT
                COUNT(*)                                                           AS total_complaints,
                COUNT(*) FILTER (WHERE c.status NOT IN ('resolved','closed','rejected'))
                                                                                   AS open_complaints,
                COUNT(*) FILTER (WHERE c.priority IN ('critical','emergency')
                    AND c.status NOT IN ('resolved','closed','rejected'))           AS critical_count,
                COUNT(*) FILTER (WHERE c.workflow_instance_id IS NULL
                    AND c.status NOT IN ('resolved','rejected','closed'))           AS needs_workflow,
                COUNT(*) FILTER (WHERE c.is_repeat_complaint = TRUE
                    AND c.status NOT IN ('resolved','closed','rejected'))           AS repeat_count,
                COUNT(*) FILTER (WHERE c.status NOT IN ('resolved','closed','rejected')
                    AND c.created_at < NOW() - INTERVAL '30 days')                 AS sla_at_risk,
                COUNT(*) FILTER (WHERE c.status IN ('resolved','closed'))          AS resolved_complaints,
                COUNT(*) FILTER (WHERE c.created_at >= NOW() - INTERVAL '24 hours') AS new_today,
                COUNT(*) FILTER (WHERE c.created_at >= NOW() - INTERVAL '7 days')   AS new_this_week,
                ROUND(
                    AVG(EXTRACT(EPOCH FROM (c.resolved_at - c.created_at)) / 86400.0)
                    FILTER (WHERE c.resolved_at IS NOT NULL), 1
                )                                                                   AS avg_resolution_days
            FROM complaints c
            WHERE {c_where}
        """),
        c_params,
    ).mappings().first()

    # ── Task counts ───────────────────────────────────────────────
    tc = db.execute(
        text(f"""
            SELECT
                COUNT(*) FILTER (WHERE t.status = 'pending')                           AS pending,
                COUNT(*) FILTER (WHERE t.status IN ('accepted','in_progress'))          AS active,
                COUNT(*) FILTER (WHERE t.status = 'completed')                         AS completed,
                COUNT(*) FILTER (WHERE t.due_at < NOW()
                    AND t.status NOT IN ('completed','cancelled'))                      AS overdue
            FROM tasks t
            WHERE {t_where}
        """),
        t_params,
    ).mappings().first()

    # ── Top infra types ───────────────────────────────────────────
    top_infra = db.execute(
        text(f"""
            SELECT it.name AS infra_type, it.code, COUNT(c.id) AS count
            FROM complaints c
            JOIN infra_nodes n  ON n.id  = c.infra_node_id
            JOIN infra_types it ON it.id = n.infra_type_id
            WHERE {c_where}
              AND c.status NOT IN ('resolved','closed','rejected')
            GROUP BY it.id, it.name, it.code
            ORDER BY count DESC LIMIT 8
        """),
        c_params,
    ).mappings().all()

    # ── Status breakdown ──────────────────────────────────────────
    status_breakdown = db.execute(
        text(f"""
            SELECT c.status, COUNT(*) AS count
            FROM complaints c
            WHERE {c_where}
            GROUP BY c.status
            ORDER BY count DESC
        """),
        c_params,
    ).mappings().all()

    # ── Dept breakdown (super_admin only) ─────────────────────────
    dept_breakdown = []
    if current_user.role == "super_admin":
        rows = db.execute(
            text("""
                SELECT d.name AS dept_name, d.code AS dept_code,
                       COUNT(DISTINCT t.complaint_id) AS complaints,
                       COUNT(t.id) FILTER (WHERE t.status = 'completed') AS tasks_done,
                       COUNT(t.id) FILTER (WHERE t.due_at < NOW()
                           AND t.status NOT IN ('completed','cancelled')) AS overdue,
                       ROUND(AVG(w.performance_score)::numeric, 2) AS avg_worker_score
                FROM departments d
                LEFT JOIN tasks t ON t.department_id = d.id AND t.is_deleted = FALSE
                LEFT JOIN workers w ON w.department_id = d.id
                WHERE d.city_id = CAST(:city_id AS uuid)
                GROUP BY d.id, d.name, d.code
                ORDER BY complaints DESC LIMIT 15
            """),
            {"city_id": scope["city_id"]},
        ).mappings().all()
        dept_breakdown = [dict(r) for r in rows]

    return {
        # ── "summary" key — matches frontend KPI cards exactly ──
        "summary": {
            "total_complaints":     int(cc["total_complaints"] or 0),
            "open_complaints":      int(cc["open_complaints"] or 0),
            "critical_count":       int(cc["critical_count"] or 0),
            "needs_workflow":       int(cc["needs_workflow"] or 0),
            "repeat_count":         int(cc["repeat_count"] or 0),
            "sla_at_risk":          int(cc["sla_at_risk"] or 0),
            "resolved_complaints":  int(cc["resolved_complaints"] or 0),
            "new_today":            int(cc["new_today"] or 0),
            "new_this_week":        int(cc["new_this_week"] or 0),
            "avg_resolution_days":  float(cc["avg_resolution_days"] or 0),
        },
        "tasks": {
            "pending":   int(tc["pending"] or 0),
            "active":    int(tc["active"] or 0),
            "completed": int(tc["completed"] or 0),
            "overdue":   int(tc["overdue"] or 0),
        },
        "top_infra_types":  [dict(r) for r in top_infra],
        "status_breakdown": [dict(r) for r in status_breakdown],
        "dept_breakdown":   dept_breakdown,
        "role": current_user.role,
    }



# ══════════════════════════════════════════════════════════════
# 2. DAILY BRIEFING (uses crm_agent_service for full context)
# ══════════════════════════════════════════════════════════════

@router.get("/crm/briefing")
def get_daily_briefing(
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)
    from services.crm_agent_service import get_daily_briefing as _briefing
    return _briefing(db, str(current_user.user_id), current_user.role)


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
    from services.crm_agent_service import chat_with_crm_agent
    result = chat_with_crm_agent(
        db, str(current_user.user_id), current_user.role,
        body.message, body.history,
    )
    return {"answer": result.get("answer", ""), "data": result.get("data")}


# ══════════════════════════════════════════════════════════════
# 4. COMPLAINT QUEUE — dept-scoped, paginated
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
    scope   = _get_user_scope(db, str(current_user.user_id), current_user.role)
    filters = [scope["c_where"]]
    params  = dict(scope["c_params"]) | {"limit": limit, "offset": offset}

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
                   c.status, c.priority, c.is_repeat_complaint, c.repeat_gap_days,
                   c.is_emergency, c.address_text,
                   ST_Y(c.location::geometry) AS lat,
                   ST_X(c.location::geometry) AS lng,
                   c.created_at, c.updated_at, c.resolved_at,
                   EXTRACT(DAY FROM NOW()-c.created_at)::int AS age_days,
                   c.workflow_instance_id, c.infra_node_id,
                   c.agent_summary, c.agent_priority_reason,
                   c.agent_suggested_dept_ids,
                   (
                       SELECT COALESCE((al.output_data->>'confidence')::float, al.confidence_score::float)
                       FROM agent_logs al
                       WHERE al.complaint_id = c.id
                       ORDER BY al.created_at DESC
                       LIMIT 1
                   ) AS mapping_confidence,
                   it.name AS infra_type_name, it.code AS infra_type_code,
                   n.total_complaint_count AS node_complaint_count,
                   j.name AS jurisdiction_name,
                   u.full_name AS citizen_name, u.phone AS citizen_phone
            FROM complaints c
            LEFT JOIN infra_nodes  n  ON n.id  = c.infra_node_id
            LEFT JOIN infra_types  it ON it.id = n.infra_type_id
            LEFT JOIN jurisdictions j ON j.id  = c.jurisdiction_id
            LEFT JOIN users u          ON u.id  = c.citizen_id
            WHERE {where}
            ORDER BY
                CASE c.priority
                    WHEN 'emergency' THEN 1 WHEN 'critical' THEN 2
                    WHEN 'high'      THEN 3 WHEN 'normal'   THEN 4
                    WHEN 'low'       THEN 5 ELSE 6 END,
                CASE WHEN c.is_emergency THEN 0 ELSE 1 END,
                CASE WHEN c.is_repeat_complaint THEN 0 ELSE 1 END,
                c.created_at ASC
            LIMIT :limit OFFSET :offset
        """),
        params,
    ).mappings().all()

    total = db.execute(
        text(f"""
            SELECT COUNT(c.id) FROM complaints c
            LEFT JOIN infra_nodes  n  ON n.id  = c.infra_node_id
            LEFT JOIN infra_types  it ON it.id = n.infra_type_id
            WHERE {where}
        """),
        params,
    ).scalar() or 0

    def _fmt(r):
        d = dict(r)
        d["id"]  = str(r["id"])
        d["lat"] = float(r["lat"]) if r["lat"] else None
        d["lng"] = float(r["lng"]) if r["lng"] else None
        d["infra_node_id"]       = str(r["infra_node_id"]) if r["infra_node_id"] else None
        d["workflow_instance_id"]= str(r["workflow_instance_id"]) if r["workflow_instance_id"] else None
        d["mapping_confidence"]  = float(r["mapping_confidence"]) if r["mapping_confidence"] is not None else None
        for ts in ("created_at","updated_at","resolved_at"):
            d[ts] = r[ts].isoformat() if r[ts] else None
        return d

    return {"total": int(total), "limit": limit, "offset": offset, "items": [_fmt(r) for r in rows]}


@router.get("/complaints/low-confidence")
def get_low_confidence_queue(
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)
    scope = _get_user_scope(db, str(current_user.user_id), current_user.role)
    filters = [
        scope["c_where"],
        "(c.agent_suggested_dept_ids = '{}' OR array_length(c.agent_suggested_dept_ids, 1) IS NULL)",
        "c.status IN ('received','mapped')",
        "c.workflow_instance_id IS NULL",
        "c.created_at < NOW() - INTERVAL '2 hours'",
    ]
    params = dict(scope["c_params"]) | {"limit": limit, "offset": offset}
    where = " AND ".join(filters)

    rows = db.execute(
        text(
            f"""
            SELECT c.id, c.complaint_number, c.title, c.description,
                   c.status, c.priority, c.is_repeat_complaint, c.repeat_gap_days,
                   c.is_emergency, c.address_text,
                   ST_Y(c.location::geometry) AS lat,
                   ST_X(c.location::geometry) AS lng,
                   c.created_at, c.updated_at, c.resolved_at,
                   EXTRACT(DAY FROM NOW()-c.created_at)::int AS age_days,
                   c.workflow_instance_id, c.infra_node_id,
                   c.agent_summary, c.agent_priority_reason,
                   c.agent_suggested_dept_ids,
                   it.name AS infra_type_name, it.code AS infra_type_code,
                   n.total_complaint_count AS node_complaint_count,
                   j.name AS jurisdiction_name,
                   u.full_name AS citizen_name, u.phone AS citizen_phone
            FROM complaints c
            LEFT JOIN infra_nodes  n  ON n.id  = c.infra_node_id
            LEFT JOIN infra_types  it ON it.id = n.infra_type_id
            LEFT JOIN jurisdictions j ON j.id  = c.jurisdiction_id
            LEFT JOIN users u          ON u.id  = c.citizen_id
            WHERE {where}
            ORDER BY c.created_at ASC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    ).mappings().all()

    total = db.execute(
        text(
            f"""
            SELECT COUNT(c.id)
            FROM complaints c
            LEFT JOIN infra_nodes  n  ON n.id  = c.infra_node_id
            LEFT JOIN infra_types  it ON it.id = n.infra_type_id
            WHERE {where}
            """
        ),
        params,
    ).scalar() or 0

    def _fmt(r):
        d = dict(r)
        d["id"] = str(r["id"])
        d["lat"] = float(r["lat"]) if r["lat"] else None
        d["lng"] = float(r["lng"]) if r["lng"] else None
        d["infra_node_id"] = str(r["infra_node_id"]) if r["infra_node_id"] else None
        d["workflow_instance_id"] = str(r["workflow_instance_id"]) if r["workflow_instance_id"] else None
        d["mapping_confidence"] = None
        for ts in ("created_at", "updated_at", "resolved_at"):
            d[ts] = r[ts].isoformat() if r[ts] else None
        return d

    return {"total": int(total), "limit": limit, "offset": offset, "items": [_fmt(r) for r in rows]}


# ══════════════════════════════════════════════════════════════
# 5. SINGLE COMPLAINT (admin detail view)
# ══════════════════════════════════════════════════════════════

@router.get("/complaints/{complaint_id}")
def get_complaint_admin(
    complaint_id: UUID,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)

    c = db.execute(
        text("""
            SELECT c.id, c.complaint_number, c.citizen_id, c.city_id,
                   c.jurisdiction_id, c.infra_node_id, c.workflow_instance_id,
                   c.title, c.description, c.translated_description,
                   c.original_language, c.address_text, c.images, c.status,
                   c.priority, c.is_repeat_complaint, c.repeat_gap_days,
                   c.is_emergency, c.agent_summary, c.agent_priority_reason,
                                     c.agent_suggested_dept_ids,
                                     (
                                             SELECT COALESCE((al.output_data->>'confidence')::float, al.confidence_score::float)
                                             FROM agent_logs al
                                             WHERE al.complaint_id = c.id
                                             ORDER BY al.created_at DESC
                                             LIMIT 1
                                     ) AS mapping_confidence,
                   c.created_at, c.updated_at, c.resolved_at,
                   ST_Y(c.location::geometry) AS lat, ST_X(c.location::geometry) AS lng,
                   it.name AS infra_type_name, it.code AS infra_type_code,
                   j.name  AS jurisdiction_name,
                   uc.full_name AS citizen_name, uc.phone AS citizen_phone
            FROM complaints c
            LEFT JOIN infra_nodes  n   ON n.id  = c.infra_node_id
            LEFT JOIN infra_types  it  ON it.id = n.infra_type_id
            LEFT JOIN jurisdictions j  ON j.id  = c.jurisdiction_id
            LEFT JOIN users uc         ON uc.id = c.citizen_id
            WHERE c.id = CAST(:cid AS uuid) AND c.is_deleted = FALSE
        """),
        {"cid": str(complaint_id)},
    ).mappings().first()

    if not c:
        raise HTTPException(status_code=404, detail="Complaint not found")

    # Status history
    history = db.execute(
        text("""
            SELECT old_status, new_status, reason, created_at
            FROM complaint_status_history
            WHERE complaint_id = CAST(:cid AS uuid)
            ORDER BY created_at ASC
        """),
        {"cid": str(complaint_id)},
    ).mappings().all()

    # Tasks
    tasks = db.execute(
        text("""
            SELECT t.id, t.task_number, t.title, t.status, t.priority,
                   t.due_at, t.created_at, t.completion_notes,
                   t.before_photos, t.after_photos, t.progress_photos,
                   wu.full_name AS worker_name, co.company_name AS contractor_name,
                   d.name AS dept_name, d.code AS dept_code
            FROM tasks t
            LEFT JOIN workers     wk ON wk.id = t.assigned_worker_id
            LEFT JOIN users       wu ON wu.id = wk.user_id
            LEFT JOIN contractors co ON co.id = t.assigned_contractor_id
            LEFT JOIN departments d  ON d.id  = t.department_id
            WHERE t.complaint_id = CAST(:cid AS uuid) AND t.is_deleted = FALSE
            ORDER BY t.created_at ASC
        """),
        {"cid": str(complaint_id)},
    ).mappings().all()

    # Department names for agent_suggested_dept_ids
    dept_names = []
    if c["agent_suggested_dept_ids"]:
        dept_rows = db.execute(
            text("SELECT id, name, code FROM departments WHERE id = ANY(:ids)"),
            {"ids": list(c["agent_suggested_dept_ids"])},
        ).mappings().all()
        dept_names = [{"id": str(d["id"]), "name": d["name"], "code": d["code"]} for d in dept_rows]

    def _ts(v): return v.isoformat() if v else None
    def _photo_list(v): return v if isinstance(v, list) else []

    return {
        **{k: (str(c[k]) if k.endswith("_id") and c[k] else c[k]) for k in [
            "id","complaint_number","citizen_id","city_id","jurisdiction_id",
            "infra_node_id","workflow_instance_id",
        ]},
        "title":                  c["title"],
        "description":            c["description"],
        "translated_description": c["translated_description"],
        "original_language":      c["original_language"],
        "address_text":           c["address_text"],
        "images":                 c["images"] or [],
        "status":                 c["status"],
        "priority":               c["priority"],
        "is_repeat_complaint":    bool(c["is_repeat_complaint"]),
        "repeat_gap_days":        c["repeat_gap_days"],
        "is_emergency":           bool(c["is_emergency"]),
        "agent_summary":          c["agent_summary"],
        "agent_priority_reason":  c["agent_priority_reason"],
        "mapping_confidence":     float(c["mapping_confidence"]) if c["mapping_confidence"] is not None else None,
        "infra_type_name":        c["infra_type_name"],
        "infra_type_code":        c["infra_type_code"],
        "jurisdiction_name":      c["jurisdiction_name"],
        "citizen_name":           c["citizen_name"],
        "citizen_phone":          c["citizen_phone"],
        "departments":            dept_names,
        "lat":  float(c["lat"]) if c["lat"] else None,
        "lng":  float(c["lng"]) if c["lng"] else None,
        "created_at":   _ts(c["created_at"]),
        "updated_at":   _ts(c["updated_at"]),
        "resolved_at":  _ts(c["resolved_at"]),
        "status_history": [
            {"old_status": h["old_status"], "new_status": h["new_status"],
             "reason": h["reason"], "created_at": _ts(h["created_at"])}
            for h in history
        ],
        "tasks": [
            {
                "id":        str(t["id"]),
                "task_number": t["task_number"],
                "title":     t["title"],
                "status":    t["status"],
                "priority":  t["priority"],
                "dept_name": t["dept_name"],
                "dept_code": t["dept_code"],
                "worker_name":     t["worker_name"],
                "contractor_name": t["contractor_name"],
                "due_at":     _ts(t["due_at"]),
                "created_at": _ts(t["created_at"]),
                "completion_notes": t["completion_notes"],
                "before_photos": _photo_list(t["before_photos"]),
                "after_photos":  _photo_list(t["after_photos"]),
            }
            for t in tasks
        ],
    }



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
                   c.infra_node_id, c.agent_suggested_dept_ids,
                   c.priority, c.is_repeat_complaint,
                   it.code AS infra_type_code
            FROM complaints c
            LEFT JOIN infra_nodes n  ON n.id  = c.infra_node_id
            LEFT JOIN infra_types it ON it.id = n.infra_type_id
            WHERE c.id = CAST(:cid AS uuid) AND c.is_deleted=FALSE
        """),
        {"cid": str(complaint_id)},
    ).mappings().first()

    if not c:
        raise HTTPException(status_code=404, detail="Complaint not found")

    summary = c["agent_summary"] or f"{c['title']}. {c['description'][:500]}"
    result  = suggest_workflows(
        db,
        complaint_id=str(complaint_id),
        city_id=str(c["city_id"]),
        infra_type_code=c["infra_type_code"] or "GENERAL",
        complaint_summary=summary,
        priority=c["priority"] or "normal",
        is_repeat=bool(c["is_repeat_complaint"]),
    )
    return result


# ══════════════════════════════════════════════════════════════
# 7. APPROVE WORKFLOW
# ══════════════════════════════════════════════════════════════

class WorkflowApproveBody(BaseModel):
    template_id:  str
    version_id:   str
    edited_steps: Optional[List[Dict]] = None
    edit_reason:  Optional[str]        = None


class WorkflowSaveLearningBody(BaseModel):
    edit_reason: Optional[str] = None
    edited_steps: Optional[List[Dict[str, Any]]] = None


@router.post("/complaints/{complaint_id}/workflow-approve")
def approve_workflow(
    complaint_id: UUID,
    body: WorkflowApproveBody,
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

    result = create_workflow_from_approval(
        db,
        complaint_id=str(complaint_id),
        city_id=str(c["city_id"]),
        template_id=body.template_id,
        official_id=str(current_user.user_id),
        edited_steps=body.edited_steps,
        edit_reason=body.edit_reason,
    )
    # Notify citizen
    try:
        dispatch_notification(
            db, user_id=str(c["citizen_id"]),
            event_type="WORKFLOW_STARTED",
            variables={"number": c["complaint_number"], "eta": "as per plan"},
            data={"complaint_id": str(complaint_id)},
        )
    except Exception as e:
        logger.warning("Notification failed: %s", e)
    return result


@router.post("/workflows/{workflow_instance_id}/save-learning")
def save_workflow_learning(
    workflow_instance_id: UUID,
    body: WorkflowSaveLearningBody,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)

    wi = db.execute(
        text(
            """
            SELECT
                wi.id,
                wi.template_id,
                wi.version_id,
                wi.jurisdiction_id,
                wt.city_id,
                curv.infra_type_id,
                curv.version AS current_version
            FROM workflow_instances wi
            JOIN workflow_templates wt ON wt.id = wi.template_id
            JOIN workflow_template_versions curv ON curv.id = wi.version_id
            WHERE wi.id = CAST(:wid AS uuid)
            """
        ),
        {"wid": str(workflow_instance_id)},
    ).mappings().first()

    if not wi:
        raise HTTPException(status_code=404, detail="Workflow instance not found")

    new_version_row = db.execute(
        text(
            """
            INSERT INTO workflow_template_versions (
                template_id,
                city_id,
                jurisdiction_id,
                infra_type_id,
                version,
                is_active,
                is_latest_version,
                previous_version_id,
                notes,
                created_by
            ) VALUES (
                CAST(:template_id AS uuid),
                CAST(:city_id AS uuid),
                CAST(:jurisdiction_id AS uuid),
                CAST(:infra_type_id AS uuid),
                :new_version,
                TRUE,
                TRUE,
                CAST(:previous_version_id AS uuid),
                :notes,
                CAST(:created_by AS uuid)
            )
            RETURNING id, version
            """
        ),
        {
            "template_id": str(wi["template_id"]),
            "city_id": str(wi["city_id"]),
            "jurisdiction_id": str(wi["jurisdiction_id"]) if wi["jurisdiction_id"] else None,
            "infra_type_id": str(wi["infra_type_id"]) if wi["infra_type_id"] else None,
            "new_version": int(wi["current_version"] or 0) + 1,
            "previous_version_id": str(wi["version_id"]),
            "notes": body.edit_reason,
            "created_by": str(current_user.user_id),
        },
    ).mappings().first()

    db.execute(
        text(
            """
            UPDATE workflow_template_versions
            SET is_latest_version = FALSE
            WHERE template_id = CAST(:template_id AS uuid)
              AND id <> CAST(:new_version_id AS uuid)
            """
        ),
        {
            "template_id": str(wi["template_id"]),
            "new_version_id": str(new_version_row["id"]),
        },
    )

    steps = body.edited_steps or []
    if steps:
        for idx, step in enumerate(steps, start=1):
            department_id = step.get("department_id")
            if not department_id:
                raise HTTPException(status_code=400, detail=f"edited_steps[{idx - 1}].department_id is required")

            work_type_codes = step.get("work_type_codes") or []
            if not isinstance(work_type_codes, list):
                work_type_codes = []

            db.execute(
                text(
                    """
                    INSERT INTO workflow_template_steps (
                        version_id,
                        step_number,
                        department_id,
                        step_name,
                        description,
                        expected_duration_hours,
                        is_optional,
                        requires_tender,
                        work_type_codes,
                        metadata
                    ) VALUES (
                        CAST(:version_id AS uuid),
                        :step_number,
                        CAST(:department_id AS uuid),
                        :step_name,
                        :description,
                        :expected_duration_hours,
                        :is_optional,
                        :requires_tender,
                        CAST(:work_type_codes AS text[]),
                        CAST(:metadata AS jsonb)
                    )
                    """
                ),
                {
                    "version_id": str(new_version_row["id"]),
                    "step_number": int(step.get("step_number") or idx),
                    "department_id": str(department_id),
                    "step_name": step.get("step_name") or f"Step {idx}",
                    "description": step.get("description"),
                    "expected_duration_hours": step.get("expected_duration_hours"),
                    "is_optional": bool(step.get("is_optional", False)),
                    "requires_tender": bool(step.get("requires_tender", False)),
                    "work_type_codes": work_type_codes,
                    "metadata": json.dumps(step.get("metadata") or {}),
                },
            )
    else:
        db.execute(
            text(
                """
                INSERT INTO workflow_template_steps (
                    version_id,
                    step_number,
                    department_id,
                    step_name,
                    description,
                    expected_duration_hours,
                    is_optional,
                    requires_tender,
                    work_type_codes,
                    metadata
                )
                SELECT
                    CAST(:new_version_id AS uuid),
                    step_number,
                    department_id,
                    step_name,
                    description,
                    expected_duration_hours,
                    is_optional,
                    requires_tender,
                    work_type_codes,
                    metadata
                FROM workflow_template_steps
                WHERE version_id = CAST(:old_version_id AS uuid)
                ORDER BY step_number
                """
            ),
            {
                "new_version_id": str(new_version_row["id"]),
                "old_version_id": str(wi["version_id"]),
            },
        )

    db.execute(
        text(
            """
            UPDATE workflow_templates
            SET times_used = times_used + 1,
                last_used_at = NOW(),
                situation_summary = COALESCE(:summary, situation_summary)
            WHERE id = CAST(:template_id AS uuid)
            """
        ),
        {
            "summary": body.edit_reason,
            "template_id": str(wi["template_id"]),
        },
    )

    db.commit()
    return {
        "saved": True,
        "new_version_id": str(new_version_row["id"]),
        "version_number": int(new_version_row["version"]),
    }


# ══════════════════════════════════════════════════════════════
# 8. REROUTE COMPLAINT — change department mapping
# ══════════════════════════════════════════════════════════════

class RerouteBody(BaseModel):
    new_dept_ids: List[str]
    reason:       str


@router.post("/complaints/{complaint_id}/reroute")
def reroute_complaint(
    complaint_id: UUID,
    body: RerouteBody,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)

    if not body.new_dept_ids or not body.reason.strip():
        raise HTTPException(status_code=400, detail="new_dept_ids and reason are required")

    exists = db.execute(
        text("SELECT id FROM complaints WHERE id = CAST(:cid AS uuid) AND is_deleted=FALSE"),
        {"cid": str(complaint_id)},
    ).first()
    if not exists:
        raise HTTPException(status_code=404, detail="Complaint not found")

    dept_arr = "{" + ",".join(body.new_dept_ids) + "}"
    db.execute(
        text("""
            UPDATE complaints
               SET agent_suggested_dept_ids = CAST(:dids AS uuid[]),
                   updated_at = NOW()
             WHERE id = CAST(:cid AS uuid)
        """),
        {"dids": dept_arr, "cid": str(complaint_id)},
    )
    db.execute(
        text("""
            INSERT INTO domain_events
                (event_type, entity_type, entity_id, actor_id, actor_type, payload, complaint_id)
            VALUES
                ('COMPLAINT_REROUTED','complaint',
                 CAST(:cid AS uuid), CAST(:uid AS uuid), 'official',
                 CAST(:p AS jsonb), CAST(:cid AS uuid))
        """),
        {
            "cid": str(complaint_id),
            "uid": str(current_user.user_id),
            "p":   json.dumps({"new_dept_ids": body.new_dept_ids, "reason": body.reason}),
        },
    )
    db.commit()
    return {"status": "rerouted", "complaint_id": str(complaint_id), "new_dept_ids": body.new_dept_ids}


# ══════════════════════════════════════════════════════════════
# 9. INFRA NODE SUMMARY — complaint history + active workflow
# ══════════════════════════════════════════════════════════════

@router.get("/infra-nodes")
def get_infra_nodes_list(
    dept_id: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    infra_type_code: Optional[str] = Query(default=None),
    has_repeat_risk: Optional[bool] = Query(default=None),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)
    scope = _get_user_scope(db, str(current_user.user_id), current_user.role)
    filters = ["n.is_deleted = FALSE"]
    params: Dict[str, Any] = {"limit": limit, "offset": offset}

    if scope.get("city_id"):
        filters.append("n.city_id = CAST(:city_id AS uuid)")
        params["city_id"] = scope["city_id"]

    scoped_dept = dept_id
    if current_user.role in {"admin", "official"} and scope.get("dept_id"):
        scoped_dept = scope["dept_id"]
    if scoped_dept:
        filters.append(
            """
            EXISTS (
                SELECT 1 FROM complaints c
                WHERE c.infra_node_id = n.id
                  AND c.is_deleted = FALSE
                  AND CAST(:dept_id AS uuid) = ANY(c.agent_suggested_dept_ids)
            )
            """
        )
        params["dept_id"] = scoped_dept

    if current_user.role == "official" and scope.get("jur_id"):
        filters.append("n.jurisdiction_id = CAST(:jur_id AS uuid)")
        params["jur_id"] = scope["jur_id"]

    if status:
        filters.append("n.status = :status")
        params["status"] = status
    if infra_type_code:
        filters.append("it.code = :infra_type_code")
        params["infra_type_code"] = infra_type_code
    if has_repeat_risk is True:
        filters.append("n.last_resolved_at IS NOT NULL AND NOW()-n.last_resolved_at < (it.repeat_alert_years || ' years')::INTERVAL")

    where = " AND ".join(filters)

    rows = db.execute(
        text(
            f"""
            SELECT
                n.id, n.status, n.total_complaint_count, n.total_resolved_count,
                n.last_resolved_at,
                it.name AS infra_type_name, it.code AS infra_type_code,
                j.name AS jurisdiction_name,
                ST_Y(n.location::geometry) AS lat,
                ST_X(n.location::geometry) AS lng,
                (
                    SELECT COUNT(*)
                    FROM complaints c
                    WHERE c.infra_node_id = n.id
                      AND c.is_deleted = FALSE
                      AND c.status NOT IN ('resolved','closed','rejected')
                ) AS open_complaint_count
            FROM infra_nodes n
            JOIN infra_types it ON it.id = n.infra_type_id
            LEFT JOIN jurisdictions j ON j.id = n.jurisdiction_id
            WHERE {where}
            ORDER BY n.updated_at DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    ).mappings().all()

    total = db.execute(
        text(
            f"""
            SELECT COUNT(*)
            FROM infra_nodes n
            JOIN infra_types it ON it.id = n.infra_type_id
            LEFT JOIN jurisdictions j ON j.id = n.jurisdiction_id
            WHERE {where}
            """
        ),
        {k: v for k, v in params.items() if k not in {"limit", "offset"}},
    ).scalar() or 0

    return {
        "total": int(total),
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(r["id"]),
                "status": r["status"],
                "infra_type_name": r["infra_type_name"],
                "infra_type_code": r["infra_type_code"],
                "jurisdiction_name": r["jurisdiction_name"],
                "total_complaint_count": int(r["total_complaint_count"] or 0),
                "total_resolved_count": int(r["total_resolved_count"] or 0),
                "open_complaint_count": int(r["open_complaint_count"] or 0),
                "last_resolved_at": r["last_resolved_at"].isoformat() if r["last_resolved_at"] else None,
                "lat": float(r["lat"]) if r["lat"] is not None else None,
                "lng": float(r["lng"]) if r["lng"] is not None else None,
            }
            for r in rows
        ],
    }

@router.get("/infra-nodes/{node_id}/summary")
def get_infra_node_summary(
    node_id: UUID,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)

    node = db.execute(
        text("""
            SELECT n.id, n.status, n.total_complaint_count, n.total_resolved_count,
                   n.last_resolved_at, n.cluster_ai_summary, n.cluster_major_themes,
                   n.cluster_severity, n.cluster_summary_at,
                   it.name AS infra_type_name, it.code AS infra_type_code,
                   it.cluster_radius_meters, it.repeat_alert_years,
                   ST_Y(n.location::geometry) AS lat, ST_X(n.location::geometry) AS lng,
                   j.name AS jurisdiction_name
            FROM infra_nodes n
            JOIN infra_types  it ON it.id = n.infra_type_id
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
                   c.created_at, c.resolved_at, c.is_repeat_complaint, c.agent_summary,
                   c.images
            FROM complaints c
            WHERE c.infra_node_id = CAST(:nid AS uuid) AND c.is_deleted = FALSE
            ORDER BY c.created_at DESC LIMIT 30
        """),
        {"nid": str(node_id)},
    ).mappings().all()

    # Aggregate ALL photos from ALL complaints on this node
    # Each complaint.images is a JSONB array of {url, storage, mime_type}
    all_photos = []
    for c in complaints:
        imgs = c["images"]
        if imgs and isinstance(imgs, list):
            for img in imgs:
                if isinstance(img, dict) and img.get("url"):
                    all_photos.append({
                        "url":              img["url"],
                        "mime_type":        img.get("mime_type", "image/jpeg"),
                        "complaint_id":     str(c["id"]),
                        "complaint_number": c["complaint_number"],
                        "uploaded_at":      c["created_at"].isoformat() if c["created_at"] else None,
                    })

    # Active workflow
    active_wf = db.execute(
        text("""
            SELECT wi.id, wi.status, wi.current_step_number, wi.total_steps,
                   wt.name AS template_name
            FROM workflow_instances wi
            JOIN workflow_templates wt ON wt.id = wi.template_id
            WHERE wi.infra_node_id = CAST(:nid AS uuid)
              AND wi.status NOT IN ('completed','cancelled')
            ORDER BY wi.created_at DESC LIMIT 1
        """),
        {"nid": str(node_id)},
    ).mappings().first()

    def _ts(v): return v.isoformat() if v else None

    return {
        "node": {
            "id":                    str(node["id"]),
            "status":                node["status"],
            "infra_type_name":       node["infra_type_name"],
            "infra_type_code":       node["infra_type_code"],
            "jurisdiction_name":     node["jurisdiction_name"],
            "total_complaint_count": node["total_complaint_count"],
            "total_resolved_count":  node["total_resolved_count"],
            "cluster_radius_meters": node["cluster_radius_meters"],
            "repeat_alert_years":    node["repeat_alert_years"],
            "lat": float(node["lat"]) if node["lat"] else None,
            "lng": float(node["lng"]) if node["lng"] else None,
            "last_resolved_at":    _ts(node["last_resolved_at"]),
            "cluster_summary_at":  _ts(node["cluster_summary_at"]),
            "cluster_severity":    node["cluster_severity"],
        },
        # Parsed requirements JSON — what citizens need at this node
        "requirements": parse_requirements(node["cluster_ai_summary"]),
        "active_workflow": (
            {"id": str(active_wf["id"]), **{k: v for k, v in dict(active_wf).items() if k != "id"}}
            if active_wf else None
        ),
        "complaints": [
            {
                "id":                  str(c["id"]),
                "complaint_number":    c["complaint_number"],
                "title":               c["title"],
                "status":              c["status"],
                "priority":            c["priority"],
                "is_repeat_complaint": bool(c["is_repeat_complaint"]),
                "agent_summary":       c["agent_summary"],
                "created_at":          _ts(c["created_at"]),
                "resolved_at":         _ts(c["resolved_at"]),
                "has_photos":          bool(c["images"] and len(c["images"]) > 0),
            }
            for c in complaints
        ],
        # All photos from all linked complaints — flat list
        "photos": all_photos,
    }


# ══════════════════════════════════════════════════════════════
# 9b. INFRA NODE AI SUMMARY — on-demand deep Gemini analysis
#     Triggered only when official clicks "View AI Analysis"
# ══════════════════════════════════════════════════════════════

@router.get("/infra-nodes/{node_id}/ai-summary")
def get_infra_node_ai_summary(
    node_id: UUID,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    """
    Deep AI analysis of an infra node — triggered on demand.
    Returns:
      - major_themes: repeated issues across complaints
      - frequency_analysis: complaint frequency pattern
      - criticality_assessment: risk level + reasoning
      - incident_timeline: key incidents from complaint history
      - recommended_action: concrete next step
      - estimated_severity: low | medium | high | critical
    """
    _require(current_user, ADMIN_ROLES)

    node = db.execute(
        text("""
            SELECT n.id, n.status, n.total_complaint_count, n.total_resolved_count,
                   n.last_resolved_at,
                   it.repeat_alert_years,
                   it.name AS infra_type_name, it.code AS infra_type_code,
                   it.cluster_radius_meters,
                   j.name AS jurisdiction_name,
                   n.cluster_ai_summary, n.cluster_major_themes, n.cluster_severity
            FROM infra_nodes n
            JOIN infra_types it ON it.id = n.infra_type_id
            LEFT JOIN jurisdictions j ON j.id = n.jurisdiction_id
            WHERE n.id = CAST(:nid AS uuid) AND n.is_deleted = FALSE
        """),
        {"nid": str(node_id)},
    ).mappings().first()

    if not node:
        raise HTTPException(status_code=404, detail="Infra node not found")

    complaints = db.execute(
        text("""
            SELECT c.complaint_number, c.title, c.description, c.status, c.priority,
                   c.is_repeat_complaint, c.agent_summary,
                   c.created_at, c.resolved_at,
                   EXTRACT(DAY FROM NOW() - c.created_at)::int AS age_days
            FROM complaints c
            WHERE c.infra_node_id = CAST(:nid AS uuid) AND c.is_deleted = FALSE
            ORDER BY c.created_at DESC LIMIT 50
        """),
        {"nid": str(node_id)},
    ).mappings().all()

    if not complaints:
        return {
            "major_themes":          ["No complaints on record"],
            "frequency_analysis":    "No data available",
            "criticality_assessment":"Cannot assess — no complaints",
            "incident_timeline":     [],
            "recommended_action":    "Monitor and await first complaint",
            "estimated_severity":    "low",
        }

    # Build structured context for Gemini
    complaint_lines = []
    for c in complaints[:30]:  # cap at 30 for context window
        status_note = "OPEN" if c["status"] not in ("resolved","closed","rejected") else "resolved"
        repeat_note = " [REPEAT]" if c["is_repeat_complaint"] else ""
        complaint_lines.append(
            f"[{c['complaint_number']}] {c['priority'].upper()}{repeat_note} | {status_note} | "
            f"Age: {c['age_days']}d | {c['title']}"
            + (f" | Summary: {c['agent_summary']}" if c['agent_summary'] else "")
        )

    complaints_text = "\n".join(complaint_lines)
    open_count    = sum(1 for c in complaints if c["status"] not in ("resolved","closed","rejected"))
    critical_count= sum(1 for c in complaints if c["priority"] in ("critical","emergency"))
    repeat_count  = sum(1 for c in complaints if c["is_repeat_complaint"])

    prompt = f"""You are a Delhi infrastructure analyst. Analyze this infra node's complaint history and return ONLY valid JSON.

INFRA NODE:
  Type: {node['infra_type_name']} ({node['infra_type_code']})
  Location: {node['jurisdiction_name']}
  Status: {node['status']}
  Total complaints: {node['total_complaint_count']}
  Resolved: {node['total_resolved_count']}
  Open: {open_count}
  Critical/Emergency: {critical_count}
  Repeat complaints: {repeat_count}
  Repeat alert threshold: {node['repeat_alert_years']} years

RECENT COMPLAINTS (newest first):
{complaints_text}

Return JSON with exactly these keys:
{{
  "major_themes": ["theme1", "theme2", "theme3"],
  "frequency_analysis": "1-2 sentences on complaint frequency pattern and trend",
  "criticality_assessment": "2-3 sentences on current risk level, urgency, and why",
  "incident_timeline": [
    {{"period": "recent/historic", "description": "notable incident or pattern", "severity": "high/medium/low"}}
  ],
  "recommended_action": "Specific, actionable next step for the official",
  "estimated_severity": "low|medium|high|critical"
}}"""

    try:
        raw = _gemini(
            "You are a Delhi infrastructure analyst. Output only valid JSON, no markdown.",
            prompt,
            max_tokens=1500,
            temperature=0.1,
        )
        if "```" in raw:
            parts = raw.split("```")
            raw = parts[1] if len(parts) > 1 else parts[0]
            if raw.lstrip().startswith("json"):
                raw = raw.lstrip()[4:]
        raw = raw.strip()
        # Repair truncated JSON (token limit cut the string mid-way)
        if raw and not raw.endswith("}"):
            open_braces   = raw.count("{") - raw.count("}")
            open_brackets = raw.count("[") - raw.count("]")
            raw += "]" * max(0, open_brackets) + "}" * max(0, open_braces)
        result = json.loads(raw)
    except Exception as exc:
        logger.error("Infra node AI summary failed: %s", exc)
        result = {
            "major_themes":           [c["title"] for c in complaints[:3]],
            "frequency_analysis":     f"{node['total_complaint_count']} complaints filed, {open_count} still open.",
            "criticality_assessment": f"{critical_count} critical/emergency cases. {'Immediate attention needed.' if critical_count > 0 else 'Manageable current load.'}",
            "incident_timeline":      [],
            "recommended_action":     "Review open complaints and assign workers to critical items.",
            "estimated_severity":     "critical" if critical_count > 2 else "high" if open_count > 5 else "medium",
        }

    return result


@router.get("/critical-alerts")
def get_critical_alerts(
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)
    scope = _get_user_scope(db, str(current_user.user_id), current_user.role)
    city_id = scope.get("city_id")
    if not city_id:
        raise HTTPException(status_code=400, detail="City scope missing")

    rows = db.execute(
        text(
            """
            SELECT
                n.id AS node_id,
                n.status AS node_status,
                n.last_resolved_at,
                n.total_complaint_count,
                it.name AS infra_type_name,
                it.repeat_alert_years,
                EXTRACT(DAY FROM NOW() - n.last_resolved_at)::int AS days_since_resolution,
                j.name AS jurisdiction_name,
                ST_Y(n.location::geometry) AS lat,
                ST_X(n.location::geometry) AS lng,
                co.company_name AS liable_contractor,
                co.id AS contractor_id,
                co.registration_number,
                c_new.id AS new_complaint_id,
                c_new.complaint_number,
                c_new.created_at AS new_complaint_at,
                c_new.priority
            FROM infra_nodes n
            JOIN infra_types it ON it.id = n.infra_type_id
            LEFT JOIN jurisdictions j ON j.id = n.jurisdiction_id
            JOIN complaints c_new ON c_new.infra_node_id = n.id
                AND c_new.is_repeat_complaint = TRUE
                AND c_new.status NOT IN ('resolved','closed','rejected')
                AND c_new.is_deleted = FALSE
            LEFT JOIN LATERAL (
                SELECT t.assigned_contractor_id
                FROM tasks t
                WHERE t.complaint_id IN (
                    SELECT id
                    FROM complaints
                    WHERE infra_node_id = n.id AND status IN ('resolved','closed')
                    ORDER BY resolved_at DESC
                    LIMIT 1
                )
                AND t.assigned_contractor_id IS NOT NULL
                LIMIT 1
            ) last_task ON TRUE
            LEFT JOIN contractors co ON co.id = last_task.assigned_contractor_id
            WHERE n.last_resolved_at IS NOT NULL
              AND NOW() - n.last_resolved_at < (it.repeat_alert_years || ' years')::INTERVAL
              AND n.city_id = CAST(:city_id AS uuid)
              AND n.is_deleted = FALSE
            ORDER BY c_new.created_at DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        {"city_id": city_id, "limit": limit, "offset": offset},
    ).mappings().all()

    out = []
    for r in rows:
        item = dict(r)
        item["node_id"] = str(r["node_id"])
        item["new_complaint_id"] = str(r["new_complaint_id"])
        item["contractor_id"] = str(r["contractor_id"]) if r["contractor_id"] else None
        item["lat"] = float(r["lat"]) if r["lat"] is not None else None
        item["lng"] = float(r["lng"]) if r["lng"] is not None else None
        item["new_complaint_at"] = r["new_complaint_at"].isoformat() if r["new_complaint_at"] else None
        item["last_resolved_at"] = r["last_resolved_at"].isoformat() if r["last_resolved_at"] else None
        item["liable_contractor_flag"] = bool(r["contractor_id"])
        out.append(item)

    return {"total": len(out), "limit": limit, "offset": offset, "items": out}


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
        text("SELECT id, task_number, complaint_id, status, assigned_worker_id, assigned_contractor_id, title FROM tasks WHERE id = CAST(:tid AS uuid) AND is_deleted=FALSE"),
        {"tid": str(task_id)},
    ).mappings().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    is_reassign = bool(task["assigned_worker_id"] or task["assigned_contractor_id"])
    if is_reassign and not body.override_reason_code:
        raise HTTPException(status_code=400, detail="override_reason_code required for reassignment")

    prev = {}
    if task["assigned_worker_id"]:     prev["worker_id"]     = str(task["assigned_worker_id"])
    if task["assigned_contractor_id"]: prev["contractor_id"] = str(task["assigned_contractor_id"])

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
            "tid": str(task_id),
            "wid": body.worker_id, "cid": body.contractor_id, "oid": body.official_id,
            "orc": body.override_reason_code, "notes": body.notes,
            "by":  str(current_user.user_id),
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
            dispatch_notification(db, user_id=str(worker_user), event_type="TASK_ASSIGNED",
                variables={"task_title": task["title"]}, data={"task_id": str(task_id)})

    db.commit()

    # Notify citizens within 500m of the infra node
    try:
        task_number = task.get("task_number")
        complaint_id = task.get("complaint_id")
        node_location = db.execute(text("""
            SELECT c.location FROM tasks t
            JOIN complaints c ON c.id = t.complaint_id
            WHERE t.id = CAST(:tid AS uuid) LIMIT 1
        """), {"tid": str(task_id)}).scalar()
        if node_location:
            subscribers = db.execute(text("""
                SELECT user_id FROM fn_get_area_subscribers(
                    CAST(:loc AS geometry), 500
                )
            """), {"loc": node_location}).mappings().all()
            for sub in subscribers:
                dispatch_notification(
                    db, user_id=str(sub["user_id"]),
                    event_type="WORKFLOW_STARTED",
                    variables={"number": task_number, "eta": "as per schedule"},
                    data={"task_id": str(task_id), "complaint_id": str(complaint_id)}
                )
            db.commit()
    except Exception as e:
        logger.warning("Area notification failed: %s", e)

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
    filters = ["w.is_available = TRUE", "u.is_active = TRUE"]
    if dept_id:
        filters.append("w.department_id = CAST(:dept_id AS uuid)"); params["dept_id"] = dept_id
    if skill:
        filters.append(":skill = ANY(w.skills)"); params["skill"] = skill

    rows = db.execute(
        text(f"""
            SELECT w.id, w.skills, w.current_task_count, w.performance_score,
                   w.is_available, u.full_name, u.phone,
                   d.name AS department_name, d.code AS dept_code
            FROM workers w
            JOIN users u ON u.id = w.user_id
            LEFT JOIN departments d ON d.id = w.department_id
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
                   c.registered_dept_ids,
                   u.full_name AS contact_name, u.phone AS contact_phone,
                   COUNT(t.id) FILTER(WHERE t.status NOT IN ('completed','cancelled','rejected')) AS active_tasks
            FROM contractors c
            JOIN users u ON u.id = c.user_id
            LEFT JOIN tasks t ON t.assigned_contractor_id=c.id AND t.is_deleted=FALSE
            WHERE {" AND ".join(filters)}
            GROUP BY c.id, u.full_name, u.phone
            HAVING COUNT(t.id) FILTER(WHERE t.status NOT IN ('completed','cancelled','rejected'))<c.max_concurrent_tasks
            ORDER BY c.performance_score DESC LIMIT 30
        """),
        params,
    ).mappings().all()
    return [dict(r) | {"id": str(r["id"])} for r in rows]


# ══════════════════════════════════════════════════════════════
# 13. DEPARTMENTS
# ══════════════════════════════════════════════════════════════

@router.get("/departments")
def get_departments(
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)
    scope = _get_user_scope(db, str(current_user.user_id), current_user.role)
    params: Dict[str, Any] = {}
    city_filter = ""
    if scope.get("city_id"):
        city_filter = "WHERE d.city_id = CAST(:city_id AS uuid)"
        params["city_id"] = scope["city_id"]

    rows = db.execute(
        text(f"""
            SELECT d.id, d.name, d.code, d.contact_email, d.contact_phone,
                   j.name AS jurisdiction_name, u.full_name AS head_name,
                   COUNT(DISTINCT w.id) AS worker_count
            FROM departments d
            LEFT JOIN jurisdictions j ON j.id = d.jurisdiction_id
            LEFT JOIN users u ON u.id = d.head_official_id
            LEFT JOIN workers w ON w.department_id = d.id
            {city_filter}
            GROUP BY d.id, j.name, u.full_name
            ORDER BY d.name
        """),
        params,
    ).mappings().all()
    return [dict(r) | {"id": str(r["id"])} for r in rows]


@router.get("/jurisdictions")
def get_jurisdictions(
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)
    scope = _get_user_scope(db, str(current_user.user_id), current_user.role)
    if not scope.get("city_id"):
        return []

    rows = db.execute(
        text("""
            SELECT id, name, code, city_id
            FROM jurisdictions
            WHERE city_id = CAST(:city_id AS uuid)
            ORDER BY name
        """),
        {"city_id": scope["city_id"]},
    ).mappings().all()

    return [
        {
            "id": str(r["id"]),
            "name": r["name"],
            "code": r["code"],
        }
        for r in rows
    ]


# ══════════════════════════════════════════════════════════════
# 14. OFFICIALS
# ══════════════════════════════════════════════════════════════

@router.get("/officials")
def get_officials(
    dept_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, UPPER_ROLES)
    scope = _get_user_scope(db, str(current_user.user_id), current_user.role)

    params: Dict[str, Any] = {}
    filters = ["u.role IN ('official','admin','super_admin')", "u.is_active=TRUE"]

    if scope.get("city_id"):
        filters.append("u.city_id = CAST(:city_id AS uuid)")
        params["city_id"] = scope["city_id"]
    if dept_id:
        filters.append("u.department_id=CAST(:dept_id AS uuid)"); params["dept_id"] = dept_id
    elif current_user.role == "admin" and scope.get("dept_id"):
        filters.append("u.department_id=CAST(:dept_id AS uuid)"); params["dept_id"] = scope["dept_id"]

    rows = db.execute(
        text(f"""
            SELECT u.id, u.full_name, u.email, u.phone, u.role,
                   u.department_id, u.jurisdiction_id,
                   d.name AS department_name, d.code AS dept_code,
                   j.name AS jurisdiction_name
            FROM users u
            LEFT JOIN departments  d ON d.id = u.department_id
            LEFT JOIN jurisdictions j ON j.id = u.jurisdiction_id
            WHERE {" AND ".join(filters)}
            ORDER BY u.full_name LIMIT 100
        """),
        params,
    ).mappings().all()
    return [dict(r) | {"id": str(r["id"])} for r in rows]


# ══════════════════════════════════════════════════════════════
# 15. WORKER TASKS (admin view)
# ══════════════════════════════════════════════════════════════

@router.get("/tasks")
def get_admin_tasks(
    status:  Optional[str] = Query(default=None),
    dept_id: Optional[str] = Query(default=None),
    limit:   int           = Query(default=50, le=200),
    offset:  int           = Query(default=0,  ge=0),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    """Task list for admin/official - department scoped, with full detail."""
    _require(current_user, ADMIN_ROLES)
    scope = _get_user_scope(db, str(current_user.user_id), current_user.role)

    t_where  = scope["t_where"]
    t_params = dict(scope["t_params"]) | {"limit": limit, "offset": offset}

    if status:
        t_where += " AND t.status = :status"; t_params["status"] = status
    if dept_id:
        t_where += " AND t.department_id = CAST(:dept_id2 AS uuid)"; t_params["dept_id2"] = dept_id

    rows = db.execute(
        text(f"""
            SELECT
                t.id, t.task_number, t.title, t.description,
                t.status, t.priority, t.due_at, t.created_at, t.updated_at,
                t.before_photos, t.after_photos, t.progress_photos,
                t.completion_notes, t.department_id,
                c.complaint_number, c.title AS complaint_title,
                c.address_text,
                ST_Y(c.location::geometry) AS lat, ST_X(c.location::geometry) AS lng,
                it.name AS infra_type_name,
                wu.full_name AS worker_name,
                co.company_name AS contractor_name,
                d.name AS dept_name, d.code AS dept_code,
                wsi.step_number, wsi.step_name,
                wsi.workflow_instance_id,
                c.infra_node_id
            FROM tasks t
            LEFT JOIN complaints c  ON c.id  = t.complaint_id
            LEFT JOIN infra_nodes n ON n.id  = c.infra_node_id
            LEFT JOIN infra_types it ON it.id = n.infra_type_id
            LEFT JOIN workers wk    ON wk.id = t.assigned_worker_id
            LEFT JOIN users wu      ON wu.id = wk.user_id
            LEFT JOIN contractors co ON co.id = t.assigned_contractor_id
            LEFT JOIN departments d  ON d.id  = t.department_id
            LEFT JOIN workflow_step_instances wsi ON wsi.id = t.workflow_step_instance_id
            WHERE {t_where}
            ORDER BY
                CASE t.priority WHEN 'emergency' THEN 1 WHEN 'critical' THEN 2
                    WHEN 'high' THEN 3 ELSE 4 END,
                t.due_at ASC NULLS LAST,
                t.created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        t_params,
    ).mappings().all()

    def _ph(v): return v if isinstance(v, list) else []
    def _ts(v): return v.isoformat() if v else None

    return {
        "total":  None,
        "limit":  limit,
        "offset": offset,
        "items": [
            {
                "id":             str(r["id"]),
                "task_number":    r["task_number"],
                "title":          r["title"],
                "description":    r["description"],
                "status":         r["status"],
                "priority":       r["priority"],
                "department_id":  str(r["department_id"]) if r["department_id"] else None,
                "dept_name":      r["dept_name"],
                "dept_code":      r["dept_code"],
                "complaint_number": r["complaint_number"],
                "complaint_title":  r["complaint_title"],
                "address_text":     r["address_text"],
                "infra_type_name":  r["infra_type_name"],
                "worker_name":      r["worker_name"],
                "contractor_name":  r["contractor_name"],
                "step_number":          r["step_number"],
                "step_name":            r["step_name"],
                "infra_node_id":         str(r["infra_node_id"]) if r["infra_node_id"] else None,
                "workflow_instance_id":  str(r["workflow_instance_id"]) if r["workflow_instance_id"] else None,
                "lat":  float(r["lat"]) if r["lat"] else None,
                "lng":  float(r["lng"]) if r["lng"] else None,
                "due_at":          _ts(r["due_at"]),
                "created_at":      _ts(r["created_at"]),
                "updated_at":      _ts(r["updated_at"]),
                "before_photos":   _ph(r["before_photos"]),
                "after_photos":    _ph(r["after_photos"]),
                "progress_photos": _ph(r["progress_photos"]),
                "completion_notes":r["completion_notes"],
            }
            for r in rows
        ],
    }


class CreateTenderRequest(BaseModel):
    task_id: str
    title: str
    description: Optional[str] = None
    scope_of_work: Optional[str] = None
    estimated_cost: Optional[float] = None


class TenderActionBody(BaseModel):
    reason: Optional[str] = None


@router.get("/tenders")
def get_tenders(
    status: Optional[str] = Query(default=None),
    dept_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)
    scope = _get_user_scope(db, str(current_user.user_id), current_user.role)

    filters = ["1=1"]
    params: Dict[str, Any] = {}

    if status:
        filters.append("t.status = :status")
        params["status"] = status

    if current_user.role == "super_admin" and scope.get("city_id"):
        filters.append("d.city_id = CAST(:city_id AS uuid)")
        params["city_id"] = scope["city_id"]
    elif scope.get("dept_id"):
        filters.append("t.department_id = CAST(:scope_dept_id AS uuid)")
        params["scope_dept_id"] = scope["dept_id"]

    if dept_id and current_user.role == "super_admin":
        filters.append("t.department_id = CAST(:dept_id AS uuid)")
        params["dept_id"] = dept_id

    rows = db.execute(
        text(
            f"""
            SELECT
                t.*,
                tk.title AS task_title,
                u.full_name AS submitter_name,
                d.name AS dept_name
            FROM tenders t
            LEFT JOIN tasks tk ON tk.workflow_step_instance_id = t.workflow_step_instance_id
            LEFT JOIN users u ON u.id = t.requested_by
            LEFT JOIN departments d ON d.id = t.department_id
            WHERE {' AND '.join(filters)}
            ORDER BY t.created_at DESC
            """
        ),
        params,
    ).mappings().all()

    result = []
    for r in rows:
        item = dict(r)
        item["id"] = str(r["id"])
        item["department_id"] = str(r["department_id"])
        item["workflow_step_instance_id"] = str(r["workflow_step_instance_id"]) if r["workflow_step_instance_id"] else None
        item["complaint_id"] = str(r["complaint_id"]) if r["complaint_id"] else None
        item["requested_by"] = str(r["requested_by"]) if r["requested_by"] else None
        item["approved_by"] = str(r["approved_by"]) if r["approved_by"] else None
        item["rejected_by"] = str(r["rejected_by"]) if r["rejected_by"] else None
        item["awarded_to_contractor_id"] = str(r["awarded_to_contractor_id"]) if r["awarded_to_contractor_id"] else None
        for ts in ("submitted_at", "approved_at", "awarded_at", "created_at", "updated_at"):
            item[ts] = r[ts].isoformat() if r[ts] else None
        result.append(item)

    return result


@router.post("/tenders")
def create_tender(
    body: CreateTenderRequest,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, {"official", "admin", "super_admin"})

    task = db.execute(
        text(
            """
            SELECT t.id, t.department_id, t.workflow_step_instance_id, t.complaint_id,
                   d.city_id, ci.city_code
            FROM tasks t
            JOIN departments d ON d.id = t.department_id
            JOIN cities ci ON ci.id = d.city_id
            WHERE t.id = CAST(:task_id AS uuid) AND t.is_deleted = FALSE
            """
        ),
        {"task_id": body.task_id},
    ).mappings().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if current_user.role in {"official", "admin"}:
        scope = _get_user_scope(db, str(current_user.user_id), current_user.role)
        if scope.get("dept_id") and str(task["department_id"]) != str(scope["dept_id"]):
            raise HTTPException(status_code=403, detail="Task is outside your department scope")

    tender_number = db.execute(
        text("SELECT fn_generate_tender_number(:city_code)"),
        {"city_code": task["city_code"]},
    ).scalar()

    tender = db.execute(
        text(
            """
            INSERT INTO tenders (
                tender_number,
                department_id,
                workflow_step_instance_id,
                complaint_id,
                requested_by,
                title,
                description,
                scope_of_work,
                estimated_cost,
                status,
                submitted_at
            ) VALUES (
                :tender_number,
                CAST(:department_id AS uuid),
                CAST(:workflow_step_instance_id AS uuid),
                CAST(:complaint_id AS uuid),
                CAST(:requested_by AS uuid),
                :title,
                :description,
                :scope_of_work,
                :estimated_cost,
                'submitted',
                NOW()
            )
            RETURNING id
            """
        ),
        {
            "tender_number": tender_number,
            "department_id": str(task["department_id"]),
            "workflow_step_instance_id": str(task["workflow_step_instance_id"]) if task["workflow_step_instance_id"] else None,
            "complaint_id": str(task["complaint_id"]) if task["complaint_id"] else None,
            "requested_by": str(current_user.user_id),
            "title": body.title,
            "description": body.description,
            "scope_of_work": body.scope_of_work,
            "estimated_cost": body.estimated_cost,
        },
    ).mappings().first()

    db.execute(
        text(
            """
            INSERT INTO domain_events
                (event_type, entity_type, entity_id, actor_id, actor_type, payload, complaint_id, city_id)
            VALUES
                ('TENDER_SUBMITTED', 'tender', CAST(:entity_id AS uuid), CAST(:actor_id AS uuid), :actor_type,
                 CAST(:payload AS jsonb), CAST(:complaint_id AS uuid), CAST(:city_id AS uuid))
            """
        ),
        {
            "entity_id": str(tender["id"]),
            "actor_id": str(current_user.user_id),
            "actor_type": current_user.role,
            "payload": json.dumps({"tender_number": tender_number, "task_id": body.task_id}),
            "complaint_id": str(task["complaint_id"]) if task["complaint_id"] else None,
            "city_id": str(task["city_id"]),
        },
    )
    db.commit()

    return {"id": str(tender["id"]), "tender_number": tender_number, "status": "submitted"}


@router.post("/tenders/{tender_id}/approve")
def approve_tender(
    tender_id: UUID,
    body: TenderActionBody,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, {"admin", "super_admin"})

    tender = db.execute(
        text(
            """
            SELECT t.id, t.status, t.requested_by, t.complaint_id, d.city_id, t.tender_number
            FROM tenders t
            JOIN departments d ON d.id = t.department_id
            WHERE t.id = CAST(:tid AS uuid)
            """
        ),
        {"tid": str(tender_id)},
    ).mappings().first()
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found")

    if current_user.role == "admin":
        if tender["status"] != "submitted":
            raise HTTPException(status_code=400, detail="Admin can approve only submitted tenders")
        new_status = "under_review"
        note = body.reason or "Admin approved"
    else:
        if tender["status"] != "under_review":
            raise HTTPException(status_code=400, detail="Super admin can approve only under_review tenders")
        new_status = "approved"
        note = body.reason or "Super admin approved"

    db.execute(
        text(
            """
            UPDATE tenders
            SET status = :status,
                approved_by = CAST(:approved_by AS uuid),
                approved_at = NOW(),
                approval_notes = :approval_notes,
                updated_at = NOW()
            WHERE id = CAST(:tid AS uuid)
            """
        ),
        {
            "status": new_status,
            "approved_by": str(current_user.user_id),
            "approval_notes": note,
            "tid": str(tender_id),
        },
    )

    db.execute(
        text(
            """
            INSERT INTO domain_events
                (event_type, entity_type, entity_id, actor_id, actor_type, payload, complaint_id, city_id)
            VALUES
                ('TENDER_APPROVED', 'tender', CAST(:entity_id AS uuid), CAST(:actor_id AS uuid), :actor_type,
                 CAST(:payload AS jsonb), CAST(:complaint_id AS uuid), CAST(:city_id AS uuid))
            """
        ),
        {
            "entity_id": str(tender_id),
            "actor_id": str(current_user.user_id),
            "actor_type": current_user.role,
            "payload": json.dumps({"status": new_status, "reason": body.reason}),
            "complaint_id": str(tender["complaint_id"]) if tender["complaint_id"] else None,
            "city_id": str(tender["city_id"]),
        },
    )

    db.commit()
    return {"status": new_status, "tender_id": str(tender_id)}


@router.post("/tenders/{tender_id}/reject")
def reject_tender(
    tender_id: UUID,
    body: TenderActionBody,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, {"admin", "super_admin"})
    if not body.reason or not body.reason.strip():
        raise HTTPException(status_code=400, detail="reason is required")

    tender = db.execute(
        text(
            """
            SELECT t.id, t.requested_by, t.complaint_id, d.city_id, t.tender_number
            FROM tenders t
            JOIN departments d ON d.id = t.department_id
            WHERE t.id = CAST(:tid AS uuid)
            """
        ),
        {"tid": str(tender_id)},
    ).mappings().first()
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found")

    db.execute(
        text(
            """
            UPDATE tenders
            SET status = 'rejected',
                rejected_by = CAST(:rejected_by AS uuid),
                rejection_reason = :reason,
                updated_at = NOW()
            WHERE id = CAST(:tid AS uuid)
            """
        ),
        {
            "rejected_by": str(current_user.user_id),
            "reason": body.reason,
            "tid": str(tender_id),
        },
    )

    db.execute(
        text(
            """
            INSERT INTO domain_events
                (event_type, entity_type, entity_id, actor_id, actor_type, payload, complaint_id, city_id)
            VALUES
                ('TENDER_REJECTED', 'tender', CAST(:entity_id AS uuid), CAST(:actor_id AS uuid), :actor_type,
                 CAST(:payload AS jsonb), CAST(:complaint_id AS uuid), CAST(:city_id AS uuid))
            """
        ),
        {
            "entity_id": str(tender_id),
            "actor_id": str(current_user.user_id),
            "actor_type": current_user.role,
            "payload": json.dumps({"reason": body.reason}),
            "complaint_id": str(tender["complaint_id"]) if tender["complaint_id"] else None,
            "city_id": str(tender["city_id"]),
        },
    )

    try:
        dispatch_notification(
            db,
            user_id=str(tender["requested_by"]),
            event_type="TENDER_REJECTED",
            variables={"number": tender["tender_number"], "reason": body.reason},
            data={"tender_id": str(tender_id)},
        )
    except Exception as exc:
        logger.warning("Failed to dispatch tender rejection notification: %s", exc)

    db.commit()
    return {"status": "rejected", "tender_id": str(tender_id)}


# ══════════════════════════════════════════════════════════════
# 16. USER MANAGEMENT
# ══════════════════════════════════════════════════════════════

class CreateUserRequest(BaseModel):
    email:              str
    full_name:          str
    role:               str
    department_id:      Optional[str] = None
    jurisdiction_id:    Optional[str] = None
    phone:              Optional[str] = None
    preferred_language: str           = "hi"
    temp_password:      str           = "PSCrm@2025"


class UpdateUserRequest(BaseModel):
    full_name:          Optional[str]  = None
    role:               Optional[str]  = None
    department_id:      Optional[str]  = None
    jurisdiction_id:    Optional[str]  = None
    phone:              Optional[str]  = None
    is_active:          Optional[bool] = None


@router.post("/users")
def create_user(
    body: CreateUserRequest,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, {"super_admin"})

    VALID_ROLES = {"official", "admin", "worker", "contractor", "super_admin"}
    if body.role not in VALID_ROLES:
        raise HTTPException(400, f"role must be one of: {VALID_ROLES}")

    import firebase_admin.auth as fb_auth

    # ── Get or create Firebase user ───────────────────────────────
    try:
        fb_user = fb_auth.create_user(
            email=body.email.lower().strip(),
            password=body.temp_password,
            display_name=body.full_name,
            email_verified=False,
        )
        firebase_uid = fb_user.uid
    except fb_auth.EmailAlreadyExistsError:
        fb_user = fb_auth.get_user_by_email(body.email.lower().strip())
        firebase_uid = fb_user.uid
    except Exception as exc:
        raise HTTPException(400, f"Could not create Firebase user: {exc}")

    scope = _get_user_scope(db, str(current_user.user_id), current_user.role)
    city_id = scope.get("city_id")
    if not city_id:
        city_id = str(db.execute(text("SELECT id FROM cities LIMIT 1")).scalar())

    # ── Check if user already exists in DB (could be a citizen who signed up) ─
    existing = db.execute(
        text("SELECT id, role FROM users WHERE email=:email OR auth_uid=:uid"),
        {"email": body.email.lower().strip(), "uid": firebase_uid},
    ).mappings().first()

    if existing:
        # User exists — update their role + department instead of creating new row
        existing_id = str(existing["id"])
        db.execute(
            text("""
                UPDATE users SET
                    role            = :role,
                    full_name       = :full_name,
                    phone           = COALESCE(:phone, phone),
                    department_id   = CAST(:dept AS uuid),
                    jurisdiction_id = CAST(:jur AS uuid),
                    auth_uid        = :auth_uid,
                    is_active       = TRUE,
                    is_verified     = TRUE,
                    email_opt_in    = TRUE,
                    updated_at      = NOW()
                WHERE id = CAST(:id AS uuid)
            """),
            {
                "id": existing_id, "role": body.role,
                "full_name": body.full_name, "phone": body.phone or None,
                "dept": body.department_id or None, "jur": body.jurisdiction_id or None,
                "auth_uid": firebase_uid,
            },
        )
        user_id_to_use = existing_id
        logger.info("Promoted existing user %s (%s) to role=%s", existing_id, body.email, body.role)
    else:
        # Create new DB user
        user_id_to_use = str(_uuid.uuid4())
        db.execute(
            text("""
                INSERT INTO users (
                    id, auth_uid, auth_provider, email, phone, full_name,
                    role, preferred_language, city_id, department_id, jurisdiction_id,
                    is_active, is_verified, twilio_opt_in, email_opt_in, metadata
                ) VALUES (
                    CAST(:id AS uuid), :auth_uid, 'password',
                    :email, :phone, :full_name,
                    :role, :lang,
                    CAST(:city AS uuid), CAST(:dept AS uuid), CAST(:jur AS uuid),
                    TRUE, TRUE, TRUE, TRUE, '{}'::jsonb
                )
            """),
            {
                "id": user_id_to_use, "auth_uid": firebase_uid,
                "email": body.email.lower().strip(), "phone": body.phone or None,
                "full_name": body.full_name, "role": body.role, "lang": body.preferred_language,
                "city": city_id, "dept": body.department_id or None, "jur": body.jurisdiction_id or None,
            },
        )

    # ── Create worker/contractor row if needed ─────────────────────
    if body.role == "worker":
        db.execute(
            text("""
                INSERT INTO workers (user_id, department_id, skills, is_available, current_task_count)
                VALUES (CAST(:uid AS uuid), CAST(:dept AS uuid), '{}'::text[], TRUE, 0)
                ON CONFLICT (user_id) DO UPDATE SET
                    department_id = CAST(:dept AS uuid),
                    is_available  = TRUE
            """),
            {"uid": user_id_to_use, "dept": body.department_id or None},
        )
    elif body.role == "contractor":
        db.execute(
            text("""
                INSERT INTO contractors (user_id, city_id, company_name, registration_number, registered_dept_ids)
                VALUES (CAST(:uid AS uuid), CAST(:city AS uuid), :name, :reg, '{}'::uuid[])
                ON CONFLICT (user_id) DO UPDATE SET
                    company_name = :name
            """),
            {
                "uid": user_id_to_use, "city": city_id,
                "name": body.full_name + " Contractors",
                "reg": "PENDING-" + user_id_to_use[-8:].upper(),
            },
        )

    db.commit()

    reset_link = None
    try:
        reset_link = fb_auth.generate_password_reset_link(body.email.lower().strip())
    except Exception:
        pass

    return {
        "user_id": user_id_to_use, "firebase_uid": firebase_uid,
        "email": body.email.lower().strip(), "role": body.role,
        "temp_password": body.temp_password, "reset_link": reset_link,
        "message": f"User {'promoted' if existing else 'created'}. Temp password: '{body.temp_password}'",
    }


@router.patch("/users/{user_id}")
def update_user(
    user_id: UUID,
    body: UpdateUserRequest,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, {"super_admin", "admin"})
    sets = ["updated_at=NOW()"]
    params: Dict[str, Any] = {"uid": str(user_id)}
    if body.full_name is not None:      sets.append("full_name=:full_name");                params["full_name"] = body.full_name
    if body.role is not None:           sets.append("role=:role");                          params["role"] = body.role
    if body.department_id is not None:  sets.append("department_id=CAST(:dept_id AS uuid)");params["dept_id"] = body.department_id
    if body.jurisdiction_id is not None:sets.append("jurisdiction_id=CAST(:jur_id AS uuid)");params["jur_id"] = body.jurisdiction_id
    if body.phone is not None:          sets.append("phone=:phone");                        params["phone"] = body.phone or None
    if body.is_active is not None:      sets.append("is_active=:is_active");                params["is_active"] = body.is_active

    db.execute(text(f"UPDATE users SET {', '.join(sets)} WHERE id=CAST(:uid AS uuid)"), params)

    # ── Role-specific table sync ──────────────────────────────────
    if body.role == "worker":
        # Ensure workers row exists — create if missing, update dept if changed
        dept = body.department_id or db.execute(
            text("SELECT department_id FROM users WHERE id=CAST(:uid AS uuid)"), {"uid": str(user_id)}
        ).scalar()
        db.execute(
            text("""
                INSERT INTO workers (user_id, department_id, skills, is_available, current_task_count)
                VALUES (CAST(:uid AS uuid), CAST(:dept AS uuid), '{}'::text[], TRUE, 0)
                ON CONFLICT (user_id) DO UPDATE SET
                    department_id = CAST(:dept AS uuid),
                    is_available  = TRUE
            """),
            {"uid": str(user_id), "dept": dept},
        )
    elif body.role in ("official", "admin", "super_admin"):
        # Officials don't need a workers row — but update dept on workers if they had one
        if body.department_id:
            db.execute(
                text("UPDATE workers SET department_id=CAST(:dept AS uuid) WHERE user_id=CAST(:uid AS uuid)"),
                {"dept": body.department_id, "uid": str(user_id)},
            )
    elif body.department_id:
        # Generic dept update for other roles
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
    _require(current_user, ADMIN_ROLES)
    scope = _get_user_scope(db, str(current_user.user_id), current_user.role)

    filters = ["u.role != 'citizen'"]
    params: Dict[str, Any] = {}
    if scope.get("city_id"):
        filters.append("u.city_id=CAST(:city_id AS uuid)"); params["city_id"] = scope["city_id"]
    if role:
        filters.append("u.role=:role"); params["role"] = role
    if dept_id:
        filters.append("u.department_id=CAST(:dept_id AS uuid)"); params["dept_id"] = str(dept_id)

    rows = db.execute(
        text(f"""
            SELECT u.id, u.full_name, u.email, u.phone, u.role,
                   u.is_active, u.auth_uid, u.preferred_language,
                   u.department_id, u.jurisdiction_id,
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
            "department_id":    str(r["department_id"]) if r["department_id"] else None,
            "jurisdiction_id":  str(r["jurisdiction_id"]) if r["jurisdiction_id"] else None,
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
    _require(current_user, {"super_admin"})
    auth_uid = db.execute(text("SELECT auth_uid FROM users WHERE id=CAST(:uid AS uuid)"), {"uid": str(user_id)}).scalar()
    db.execute(text("UPDATE users SET is_active=FALSE, updated_at=NOW() WHERE id=CAST(:uid AS uuid)"), {"uid": str(user_id)})
    db.commit()
    if auth_uid:
        try:
            import firebase_admin.auth as fb_auth
            fb_auth.update_user(auth_uid, disabled=True)
        except Exception as exc:
            logger.warning("Firebase disable failed: %s", exc)
    return {"status": "deactivated", "user_id": str(user_id)}


# ══════════════════════════════════════════════════════════════
# ★ EMAIL DIAGNOSTIC — POST /admin/debug/email-test
#   super_admin only — sends a test email to diagnose SMTP config
# ══════════════════════════════════════════════════════════════

@router.post("/debug/email-test")
def test_email(
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    """Send a test email to the current admin's address to verify SMTP config."""
    _require(current_user, {"super_admin"})
    from config import settings
    from services.notification_service import send_email

    # Fetch current user's email
    row = db.execute(
        text("SELECT email, full_name FROM users WHERE id = CAST(:uid AS uuid)"),
        {"uid": str(current_user.user_id)},
    ).mappings().first()

    if not row or not row["email"]:
        raise HTTPException(status_code=400, detail="No email on your account")

    config_info = {
        "smtp_host":      settings.SMTP_HOST,
        "smtp_port":      settings.SMTP_PORT,
        "smtp_user":      settings.SMTP_USER,
        "smtp_configured": bool(settings.SMTP_HOST and settings.SMTP_USER),
    }

    if not config_info["smtp_configured"]:
        return {
            "status":  "skipped",
            "reason":  "SMTP_HOST or SMTP_USER not set in environment",
            "config":  config_info,
        }

    try:
        ok = send_email(
            to_email=row["email"],
            subject="PS-CRM — SMTP Test Email",
            html_body=f"<p>SMTP is working. Sent to <b>{row['email']}</b>.</p>",
            text_body=f"SMTP is working. Sent to {row['email']}.",
        )
        return {"status": "sent" if ok else "failed", "to": row["email"], "config": config_info}
    except Exception as exc:
        logger.error("Email test failed: %s", exc)
        return {"status": "error", "error": str(exc), "config": config_info}


# ══════════════════════════════════════════════════════════════
# ★ INFRA NODE — WORKFLOW SUGGESTIONS
#   GET /admin/infra-nodes/{node_id}/workflow-suggestions
# ══════════════════════════════════════════════════════════════

@router.get("/infra-nodes/{node_id}/workflow-suggestions")
def get_infra_node_workflow_suggestions(
    node_id: UUID,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    """
    Returns top-3 workflow suggestions for an infra node.
    Uses the stored requirements JSON as context — fast, no complaint re-fetch.
    """
    _require(current_user, ADMIN_ROLES)

    scope = _get_user_scope(db, str(current_user.user_id), current_user.role)
    if not scope.get("city_id"):
        raise HTTPException(status_code=400, detail="User city scope could not be determined")

    try:
        from services.workflow_agent_service import suggest_workflows_for_node
        result = suggest_workflows_for_node(
            db,
            infra_node_id=str(node_id),
            city_id=scope["city_id"],
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return result


# ══════════════════════════════════════════════════════════════
# ★ INFRA NODE — WORKFLOW APPROVE
#   POST /admin/infra-nodes/{node_id}/workflow-approve
# ══════════════════════════════════════════════════════════════

class InfraWorkflowApproveBody(BaseModel):
    template_id:  str
    version_id:   str
    edited_steps: Optional[List[Dict]] = None
    edit_reason:  Optional[str]        = None


@router.post("/infra-nodes/{node_id}/workflow-approve")
def approve_infra_node_workflow(
    node_id: UUID,
    body: InfraWorkflowApproveBody,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    """
    Creates ONE workflow for the infra node and bulk-links all open complaints to it.
    """
    _require(current_user, ADMIN_ROLES)

    existing = db.execute(
        text("""
            SELECT id FROM workflow_instances
            WHERE infra_node_id = CAST(:nid AS uuid) AND status = 'active'
            LIMIT 1
        """),
        {"nid": str(node_id)},
    ).first()

    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Active workflow already exists for this infra node. "
                   "Complete or cancel it before creating a new one.",
        )

    node_city = db.execute(
        text("SELECT city_id FROM infra_nodes WHERE id = CAST(:nid AS uuid) AND is_deleted = FALSE"),
        {"nid": str(node_id)},
    ).first()
    if not node_city:
        raise HTTPException(status_code=404, detail="Infra node not found")

    try:
        from services.workflow_agent_service import create_workflow_for_infra_node
        result = create_workflow_for_infra_node(
            db,
            infra_node_id=str(node_id),
            template_id=body.template_id,
            official_id=str(current_user.user_id),
            city_id=str(node_city[0]),
            edited_steps=body.edited_steps,
            edit_reason=body.edit_reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Notify all citizens linked to this node's open complaints
    try:
        linked = db.execute(
            text("""
                SELECT c.citizen_id, c.complaint_number
                FROM workflow_complaints wc
                JOIN complaints c ON c.id = wc.complaint_id
                WHERE wc.workflow_instance_id = CAST(:wid AS uuid)
            """),
            {"wid": result["workflow_instance_id"]},
        ).mappings().all()

        for row in linked:
            dispatch_notification(
                db,
                user_id=str(row["citizen_id"]),
                event_type="WORKFLOW_STARTED",
                variables={"number": row["complaint_number"], "eta": "as per plan"},
                data={"complaint_id": str(row["complaint_number"])},
            )
    except Exception as exc:
        logger.warning("Bulk citizen notification failed: %s", exc)

    return result


# ══════════════════════════════════════════════════════════════
# ★ INFRA NODE — REBUILD SUMMARY (admin repair only)
#   POST /admin/infra-nodes/{node_id}/rebuild-summary
# ══════════════════════════════════════════════════════════════

@router.post("/infra-nodes/{node_id}/rebuild-summary")
def rebuild_infra_node_summary(
    node_id: UUID,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    """
    Forces a full requirements rebuild from the last 20 complaints.
    Use only to repair corrupted or missing summaries.
    NOT called automatically — admin action only.
    """
    _require(current_user, {"admin", "super_admin"})
    result = rebuild_summary_from_complaints(db, str(node_id))
    if result.get("status") == "ai_failed":
        raise HTTPException(status_code=502, detail="AI summary generation failed")
    return result


# ══════════════════════════════════════════════════════════════
# ★ INFRA NODE TASKS — all tasks linked to a node's workflows
#   GET /admin/infra-nodes/{node_id}/tasks
# ══════════════════════════════════════════════════════════════

@router.get("/infra-nodes/{node_id}/tasks")
def get_infra_node_tasks(
    node_id: UUID,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    """All tasks for an infra node, grouped by workflow step."""
    _require(current_user, ADMIN_ROLES)

    rows = db.execute(
        text("""
            SELECT
                t.id, t.task_number, t.title, t.description,
                t.status, t.priority, t.due_at, t.created_at,
                t.before_photos, t.after_photos, t.progress_photos,
                t.completion_notes,
                wsi.step_number, wsi.step_name,
                wsi.workflow_instance_id,
                wi.status   AS workflow_status,
                wi.current_step_number, wi.total_steps,
                wt.name     AS template_name,
                w.id        AS worker_id,
                wu.full_name AS worker_name,
                co.id       AS contractor_id,
                co.company_name AS contractor_name,
                d.name      AS dept_name, d.code AS dept_code
            FROM tasks t
            JOIN workflow_step_instances wsi ON wsi.id  = t.workflow_step_instance_id
            JOIN workflow_instances      wi  ON wi.id   = wsi.workflow_instance_id
            JOIN workflow_templates      wt  ON wt.id   = wi.template_id
            LEFT JOIN workers       w   ON w.id   = t.assigned_worker_id
            LEFT JOIN users         wu  ON wu.id  = w.user_id
            LEFT JOIN contractors   co  ON co.id  = t.assigned_contractor_id
            LEFT JOIN departments   d   ON d.id   = t.department_id
            WHERE wi.infra_node_id = CAST(:nid AS uuid)
              AND t.is_deleted = FALSE
            ORDER BY wsi.step_number ASC, t.created_at ASC
        """),
        {"nid": str(node_id)},
    ).mappings().all()

    def _ph(v): return v if isinstance(v, list) else []
    def _ts(v): return v.isoformat() if v else None

    return {
        "items": [
            {
                "id":                   str(r["id"]),
                "task_number":          r["task_number"],
                "title":                r["title"],
                "description":          r["description"],
                "status":               r["status"],
                "priority":             r["priority"],
                "step_number":          r["step_number"],
                "step_name":            r["step_name"],
                "workflow_instance_id": str(r["workflow_instance_id"]) if r["workflow_instance_id"] else None,
                "workflow_status":      r["workflow_status"],
                "current_step_number":  r["current_step_number"],
                "total_steps":          r["total_steps"],
                "template_name":        r["template_name"],
                "worker_id":            str(r["worker_id"]) if r["worker_id"] else None,
                "worker_name":          r["worker_name"],
                "contractor_id":        str(r["contractor_id"]) if r["contractor_id"] else None,
                "contractor_name":      r["contractor_name"],
                "dept_name":            r["dept_name"],
                "dept_code":            r["dept_code"],
                "due_at":               _ts(r["due_at"]),
                "created_at":           _ts(r["created_at"]),
                "before_photos":        _ph(r["before_photos"]),
                "after_photos":         _ph(r["after_photos"]),
                "progress_photos":      _ph(r["progress_photos"]),
                "completion_notes":     r["completion_notes"],
            }
            for r in rows
        ]
    }


# ══════════════════════════════════════════════════════════════
# ★ WORKFLOW WORKER ASSIGNMENT — assign all or per-step
#   POST /admin/workflow-instances/{wid}/assign-workers
# ══════════════════════════════════════════════════════════════

class WorkflowWorkerAssignBody(BaseModel):
    worker_id:         Optional[str]            = None  # assign ALL steps
    contractor_id:     Optional[str]            = None  # or all to contractor
    step_assignments:  Optional[List[Dict[str, Any]]] = None  # [{step_number, worker_id, contractor_id}]

@router.post("/workflow-instances/{wid}/assign-workers")
def assign_workflow_workers(
    wid: UUID,
    body: WorkflowWorkerAssignBody,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    """
    Assigns workers to a workflow instance.

    body.worker_id           → assign ALL steps/tasks to this worker
    body.contractor_id       → assign ALL steps/tasks to this contractor
    body.step_assignments    → [{step_number, worker_id?, contractor_id?}] per-step
    """
    _require(current_user, ADMIN_ROLES)

    # Count tasks in this workflow
    task_rows = db.execute(
        text("""
            SELECT t.id, wsi.step_number
            FROM tasks t
            JOIN workflow_step_instances wsi ON wsi.id = t.workflow_step_instance_id
            WHERE wsi.workflow_instance_id = CAST(:wid AS uuid) AND t.is_deleted = FALSE
        """),
        {"wid": str(wid)},
    ).mappings().all()

    if not task_rows:
        raise HTTPException(status_code=404, detail="No tasks found for this workflow")

    assigned_count = 0

    if body.worker_id or body.contractor_id:
        # Assign all tasks to one worker/contractor
        db.execute(
            text("""
                UPDATE tasks t
                SET assigned_worker_id     = CAST(:w AS uuid),
                    assigned_contractor_id = CAST(:c AS uuid),
                    status     = CASE WHEN status = 'pending' THEN 'accepted' ELSE status END,
                    override_by = CAST(:by AS uuid),
                    updated_at  = NOW()
                FROM workflow_step_instances wsi
                WHERE t.workflow_step_instance_id = wsi.id
                  AND wsi.workflow_instance_id = CAST(:wid AS uuid)
                  AND t.is_deleted = FALSE
            """),
            {"wid": str(wid), "w": body.worker_id, "c": body.contractor_id, "by": str(current_user.user_id)},
        )
        assigned_count = len(task_rows)

        if body.worker_id:
            db.execute(
                text("UPDATE workers SET current_task_count = current_task_count + :n, updated_at=NOW() WHERE id=CAST(:wid AS uuid)"),
                {"wid": body.worker_id, "n": assigned_count},
            )
            worker_user = db.execute(
                text("SELECT user_id FROM workers WHERE id = CAST(:wid AS uuid)"),
                {"wid": body.worker_id},
            ).scalar()
            if worker_user:
                try:
                    dispatch_notification(
                        db, user_id=str(worker_user),
                        event_type="TASK_ASSIGNED",
                        variables={"task_title": f"{assigned_count} workflow tasks"},
                        data={"workflow_instance_id": str(wid)},
                    )
                except Exception as exc:
                    logger.warning("Worker assign notification failed: %s", exc)

    elif body.step_assignments:
        for sa in body.step_assignments:
            step_num = sa.get("step_number")
            w_id = sa.get("worker_id")
            c_id = sa.get("contractor_id")
            if not step_num or not (w_id or c_id):
                continue
            db.execute(
                text("""
                    UPDATE tasks t
                    SET assigned_worker_id     = CAST(:w AS uuid),
                        assigned_contractor_id = CAST(:c AS uuid),
                        status  = CASE WHEN status='pending' THEN 'accepted' ELSE status END,
                        updated_at = NOW()
                    FROM workflow_step_instances wsi
                    WHERE t.workflow_step_instance_id = wsi.id
                      AND wsi.workflow_instance_id = CAST(:wid AS uuid)
                      AND wsi.step_number = :sn
                      AND t.is_deleted = FALSE
                """),
                {"wid": str(wid), "w": w_id, "c": c_id, "sn": step_num},
            )
            assigned_count += 1

    db.commit()
    return {"assigned_count": assigned_count, "workflow_instance_id": str(wid)}