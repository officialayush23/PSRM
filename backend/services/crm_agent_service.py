# backend/services/crm_agent_service.py
"""
CRM Agent - fixed column names:
  - NO branch_id on users
  - NO city_id on tasks (scope via departments.city_id)
  - NO city_id on survey_instances (scope via complaints.city_id)
  - overall_rating (not rating) on survey_responses
  - submitted_at (not created_at) on survey_responses
"""
import json
import logging
import re
from typing import Any, Dict, List, Optional

import vertexai
from vertexai.generative_models import GenerativeModel, GenerationConfig

from config import settings
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)
_vertex_initialized = False


def _ensure_vertex():
    global _vertex_initialized
    if _vertex_initialized:
        return
    vertexai.init(project=settings.GCS_PROJECT_ID, location=settings.VERTEX_AI_LOCATION)
    _vertex_initialized = True


def _call_gemini(system: str, prompt: str, max_tokens: int = 600, temperature: float = 0.2) -> str:
    _ensure_vertex()
    model = GenerativeModel(
        "gemini-2.5-flash",
        system_instruction=system,
        generation_config=GenerationConfig(temperature=temperature, max_output_tokens=3060),
    )
    return (model.generate_content(prompt).text or "").strip()


def _load_official_context(db: Session, user_id: str, role: str) -> Dict[str, Any]:
    user = db.execute(
        text("SELECT full_name, department_id, jurisdiction_id, city_id FROM users WHERE id = CAST(:uid AS uuid)"),
        {"uid": user_id},
    ).mappings().first()

    if not user:
        return {}

    city_id = str(user["city_id"])
    scope_where = "c.is_deleted = FALSE AND c.city_id = CAST(:city_id AS uuid)"
    params: Dict[str, Any] = {"city_id": city_id}

    if role == "admin" and user["department_id"]:
        scope_where += " AND CAST(:dept_id AS uuid) = ANY(c.agent_suggested_dept_ids)"
        params["dept_id"] = str(user["department_id"])
    elif role == "official" and user["jurisdiction_id"]:
        scope_where += " AND c.jurisdiction_id = CAST(:jur_id AS uuid)"
        params["jur_id"] = str(user["jurisdiction_id"])

    kpi = db.execute(text(f"""
        SELECT
            COUNT(*) FILTER (WHERE c.status NOT IN ('resolved','closed','rejected')) AS open_total,
            COUNT(*) FILTER (WHERE c.priority IN ('critical','emergency'))            AS critical_open,
            COUNT(*) FILTER (WHERE c.is_repeat_complaint = TRUE
                AND c.status NOT IN ('resolved','closed','rejected'))                 AS repeat_open,
            COUNT(*) FILTER (WHERE c.status = 'received'
                AND c.created_at < NOW() - INTERVAL '3 days')                        AS stale_unassigned,
            COUNT(*) FILTER (WHERE c.status NOT IN ('resolved','closed','rejected')
                AND c.created_at < NOW() - INTERVAL '30 days')                       AS sla_breach_risk
        FROM complaints c WHERE {scope_where}
    """), params).mappings().first()

    oldest = db.execute(text(f"""
        SELECT c.complaint_number, c.title, c.status, c.priority,
               c.created_at, c.address_text, it.code AS infra_code,
               EXTRACT(DAY FROM NOW() - c.created_at)::int AS age_days
        FROM complaints c
        LEFT JOIN infra_nodes n  ON n.id  = c.infra_node_id
        LEFT JOIN infra_types it ON it.id = n.infra_type_id
        WHERE {scope_where} AND c.status NOT IN ('resolved','closed','rejected')
        ORDER BY c.created_at ASC LIMIT 5
    """), params).mappings().all()

    # tasks scoped via departments.city_id (tasks has NO city_id column)
    stale_tasks = db.execute(text("""
        SELECT t.id, t.title, t.status, t.priority, t.created_at,
               wu.full_name AS worker_name, co.company_name AS contractor_company
        FROM tasks t
        JOIN departments  d  ON d.id  = t.department_id
        LEFT JOIN workers wk ON wk.id = t.assigned_worker_id
        LEFT JOIN users   wu ON wu.id = wk.user_id
        LEFT JOIN contractors co ON co.id = t.assigned_contractor_id
        WHERE d.city_id = CAST(:city_id AS uuid)
          AND t.status IN ('pending','accepted')
          AND t.created_at < NOW() - INTERVAL '2 days'
          AND t.is_deleted = FALSE
        ORDER BY t.priority DESC, t.created_at ASC LIMIT 5
    """), {"city_id": city_id}).mappings().all()

    # survey_instances has NO city_id -> scope via complaints.city_id
    # survey_responses uses overall_rating (not rating), submitted_at (not created_at)
    survey_alerts = db.execute(text("""
        SELECT si.id, si.survey_type,
               AVG(sr.overall_rating) AS avg_rating,
               COUNT(*) AS response_count,
               c.complaint_number, c.title
        FROM survey_instances  si
        JOIN survey_responses  sr ON sr.survey_instance_id = si.id
        JOIN complaints        c  ON c.id = CAST(si.complaint_id AS uuid)
        WHERE c.city_id = CAST(:city_id AS uuid)
          AND sr.submitted_at > NOW() - INTERVAL '7 days'
          AND sr.overall_rating IS NOT NULL
        GROUP BY si.id, c.complaint_number, c.title
        HAVING AVG(sr.overall_rating) < 3.0
        ORDER BY avg_rating ASC LIMIT 5
    """), {"city_id": city_id}).mappings().all()

    return {
        "user_name":     user["full_name"],
        "role":          role,
        "kpi":           dict(kpi) if kpi else {},
        "oldest_open":   [dict(r) for r in oldest],
        "stale_tasks":   [dict(r) for r in stale_tasks],
        "survey_alerts": [dict(r) for r in survey_alerts],
    }


def get_daily_briefing(db: Session, user_id: str, role: str) -> Dict[str, Any]:
    ctx = _load_official_context(db, user_id, role)
    if not ctx:
        return {"greeting": "Namaskar! Dashboard data is loading.", "sections": []}

    kpi = ctx.get("kpi", {})
    greeting = "Namaskar! Here is your morning briefing."
    try:
        greeting = _call_gemini(
            "You are PS-CRM, a concise municipal operations assistant for Delhi.",
            f"Write a morning briefing (3-5 sentences, plain text, no bullets) "
            f"for {ctx['user_name']} ({role}). Mention: open complaints, critical issues, "
            f"stale complaints, survey alerts, 1-2 urgent actions.\n\nDATA:\n{json.dumps(ctx, default=str)}",
            max_tokens=300, temperature=0.3,
        )
    except Exception as exc:
        logger.error("Briefing Gemini failed: %s", exc)

    sections = []
    if int(kpi.get("critical_open") or 0) > 0:
        sections.append({"type": "alert", "title": f"🔴 {kpi['critical_open']} Critical/Emergency", "action": "Review now"})
    if int(kpi.get("stale_unassigned") or 0) > 0:
        sections.append({"type": "warning", "title": f"⚠️ {kpi['stale_unassigned']} unassigned >3 days", "action": "Assign workers"})
    if int(kpi.get("repeat_open") or 0) > 0:
        sections.append({"type": "info", "title": f"↩ {kpi['repeat_open']} repeat complaints open", "action": "Check infra history"})
    if ctx.get("survey_alerts"):
        sections.append({"type": "warning", "title": f"📋 {len(ctx['survey_alerts'])} poor survey ratings", "action": "Investigate"})
    if int(kpi.get("sla_breach_risk") or 0) > 0:
        sections.append({"type": "warning", "title": f"⏰ {kpi['sla_breach_risk']} SLA breach risk (>30d)", "action": "Escalate"})

    return {
        "greeting":     greeting,
        "kpi":          kpi,
        "sections":     sections,
        "oldest_open":  ctx.get("oldest_open",  []),
        "stale_tasks":  ctx.get("stale_tasks",  []),
        "survey_alerts":ctx.get("survey_alerts",[]),
    }


def chat_with_crm_agent(
    db: Session, user_id: str, role: str,
    user_message: str, conversation_history: List[Dict[str, str]],
) -> Dict[str, Any]:
    ctx       = _load_official_context(db, user_id, role)
    user_name = ctx.get("user_name", "Official")
    kpi       = ctx.get("kpi", {})

    system = f"""You are PS-CRM, the AI assistant for Delhi municipal officials.
CURRENT USER: {user_name} ({role})
OPEN: {kpi.get('open_total','N/A')} | CRITICAL: {kpi.get('critical_open','N/A')} | SLA RISK: {kpi.get('sla_breach_risk','N/A')}
Rules: Be direct and factual. If you need live DB data output: QUERY_NEEDED: <description>
Reference complaint numbers (CRM-DEL-YYYY-XXXXXX). Keep responses concise."""

    history_str = "".join(
        f"{'Official' if t.get('role')=='user' else 'PS-CRM'}: {t['content']}\n"
        for t in conversation_history[-6:]
    )
    full_prompt = f"{history_str}Official: {user_message}\nPS-CRM:"

    answer = ""
    query_data = None

    try:
        answer = _call_gemini(system, full_prompt, max_tokens=600)
    except Exception as exc:
        logger.error("CRM chat Gemini failed: %s", exc)
        return {"answer": "I'm having trouble connecting. Please try again.", "data": None}

    if "QUERY_NEEDED:" in answer:
        try:
            query_data = _run_agent_query(db, user_id, user_message)
            if query_data:
                followup = (f"{full_prompt}{answer}\n\nDB Results: {json.dumps(query_data, default=str)}\n\n"
                            f"Now answer concisely:\nPS-CRM:")
                try:
                    answer = _call_gemini(system, followup, max_tokens=600)
                except Exception:
                    pass
        except Exception as exc:
            logger.error("Agent query failed: %s", exc)

    return {"answer": answer, "data": query_data}


def _run_agent_query(db: Session, user_id: str, user_message: str) -> Optional[List[Dict]]:
    user = db.execute(
        text("SELECT city_id FROM users WHERE id = CAST(:uid AS uuid)"),
        {"uid": user_id},
    ).mappings().first()
    if not user:
        return None

    city_id = str(user["city_id"])
    msg     = user_message.lower()

    if any(w in msg for w in ["contractor", "company", "vendor"]):
        rows = db.execute(text("""
            SELECT co.company_name, co.performance_score, co.is_blacklisted,
                   COUNT(t.id) FILTER (WHERE t.status='completed') AS completed,
                   COUNT(t.id) FILTER (WHERE t.status IN ('accepted','in_progress')) AS active
            FROM contractors co
            LEFT JOIN tasks t ON t.assigned_contractor_id = co.id
            WHERE co.city_id = CAST(:city AS uuid)
            GROUP BY co.id ORDER BY co.performance_score DESC
        """), {"city": city_id}).mappings().all()
        return [dict(r) for r in rows]

    if "repeat" in msg:
        rows = db.execute(text("""
            SELECT c.complaint_number, c.title, c.status, c.address_text, it.code AS infra_type,
                   EXTRACT(DAY FROM NOW()-c.created_at)::int AS age_days
            FROM complaints c
            LEFT JOIN infra_nodes n ON n.id=c.infra_node_id
            LEFT JOIN infra_types it ON it.id=n.infra_type_id
            WHERE c.city_id=CAST(:city AS uuid) AND c.is_repeat_complaint=TRUE
              AND c.status NOT IN ('resolved','closed','rejected') AND c.is_deleted=FALSE
            ORDER BY age_days DESC LIMIT 10
        """), {"city": city_id}).mappings().all()
        return [dict(r) for r in rows]

    if any(w in msg for w in ["stuck", "old", "delayed", "stale", "week", "7 day"]):
        rows = db.execute(text("""
            SELECT c.complaint_number, c.title, c.status, c.priority, c.address_text,
                   EXTRACT(DAY FROM NOW()-c.created_at)::int AS age_days, it.code AS infra_type
            FROM complaints c
            LEFT JOIN infra_nodes n ON n.id=c.infra_node_id
            LEFT JOIN infra_types it ON it.id=n.infra_type_id
            WHERE c.city_id=CAST(:city AS uuid)
              AND c.status NOT IN ('resolved','closed','rejected')
              AND c.created_at < NOW()-INTERVAL '7 days' AND c.is_deleted=FALSE
            ORDER BY age_days DESC LIMIT 10
        """), {"city": city_id}).mappings().all()
        return [dict(r) for r in rows]

    if any(w in msg for w in ["sla", "breach", "overdue", "deadline"]):
        rows = db.execute(text("""
            SELECT c.complaint_number, c.title, c.status, c.address_text,
                   EXTRACT(DAY FROM NOW()-c.created_at)::int AS age_days
            FROM complaints c
            WHERE c.city_id=CAST(:city AS uuid)
              AND c.status NOT IN ('resolved','closed','rejected')
              AND c.created_at < NOW()-INTERVAL '30 days' AND c.is_deleted=FALSE
            ORDER BY age_days DESC LIMIT 10
        """), {"city": city_id}).mappings().all()
        return [dict(r) for r in rows]

    if any(w in msg for w in ["multi", "department", "coordination"]):
        rows = db.execute(text("""
            SELECT c.complaint_number, c.title, c.status, c.priority, c.address_text,
                   array_length(c.agent_suggested_dept_ids,1) AS dept_count
            FROM complaints c
            WHERE c.city_id=CAST(:city AS uuid)
              AND array_length(c.agent_suggested_dept_ids,1) > 1
              AND c.status NOT IN ('resolved','closed','rejected') AND c.is_deleted=FALSE
            ORDER BY dept_count DESC, c.priority DESC LIMIT 10
        """), {"city": city_id}).mappings().all()
        return [dict(r) for r in rows]

    match = re.search(r"CRM-[A-Z]+-\d{4}-\d+", user_message.upper())
    if match:
        rows = db.execute(text("""
            SELECT c.complaint_number, c.title, c.status, c.priority,
                   c.agent_summary, c.address_text, c.created_at, c.resolved_at,
                   it.name AS infra_type, j.name AS jurisdiction
            FROM complaints c
            LEFT JOIN infra_nodes n ON n.id=c.infra_node_id
            LEFT JOIN infra_types it ON it.id=n.infra_type_id
            LEFT JOIN jurisdictions j ON j.id=c.jurisdiction_id
            WHERE c.complaint_number=:num AND c.is_deleted=FALSE
        """), {"num": match.group(0)}).mappings().all()
        return [dict(r) for r in rows]

    # Tasks query
    if any(w in msg for w in ["task", "worker", "assigned"]):
        rows = db.execute(text("""
            SELECT t.task_number, t.title, t.status, t.priority,
                   wu.full_name AS worker_name, co.company_name,
                   d.name AS dept_name,
                   EXTRACT(DAY FROM NOW()-t.created_at)::int AS age_days
            FROM tasks t
            JOIN departments d ON d.id=t.department_id
            LEFT JOIN workers wk ON wk.id=t.assigned_worker_id
            LEFT JOIN users wu ON wu.id=wk.user_id
            LEFT JOIN contractors co ON co.id=t.assigned_contractor_id
            WHERE d.city_id=CAST(:city AS uuid)
              AND t.status IN ('pending','accepted')
              AND t.is_deleted=FALSE
            ORDER BY age_days DESC LIMIT 10
        """), {"city": city_id}).mappings().all()
        return [dict(r) for r in rows]

    return None