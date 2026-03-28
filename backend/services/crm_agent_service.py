# backend/services/crm_agent_service.py
"""
CRM Agent — Gemini 2.5 Flash.

Full data access for the chatbot:
  - Complaints (filtered by role scope)
  - Infra nodes (status, health, cluster AI summary, repeat risk)
  - Tasks (pending, overdue, assigned workers)
  - Workflows (pending approval, stuck instances)
  - Surveys (poor ratings, pending responses)
  - Contractors / workers (performance)
  - Tenders (pending approval)
  - Critical alerts (warranty breach)

Architecture:
  1. _load_official_context  — loads KPI snapshot once per request
  2. _run_agent_query        — keyword-based DB fetch, returns structured data
  3. chat_with_crm_agent     — assembles context + data → Gemini → answer
"""
import json
import logging
import re
from typing import Any, Dict, List, Optional

import vertexai
from groq import Groq
from sqlalchemy import text
from sqlalchemy.orm import Session
from vertexai.generative_models import (
    GenerationConfig,
    GenerativeModel,
    HarmCategory,
    HarmBlockThreshold,
)

from config import settings

logger = logging.getLogger(__name__)
_vertex_initialized = False
_groq_client: Optional[Groq] = None

# Safety settings — civic infrastructure data (words like "damaged", "hazard",
# "emergency", "broken pipe") triggers Vertex AI's DANGEROUS_CONTENT filter at
# default thresholds. Set all categories to BLOCK_ONLY_HIGH so legitimate
# municipal operations data passes through.
_SAFETY_SETTINGS = {
    HarmCategory.HARM_CATEGORY_HATE_SPEECH:       HarmBlockThreshold.BLOCK_NONE,
    HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
    HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
    HarmCategory.HARM_CATEGORY_HARASSMENT:        HarmBlockThreshold.BLOCK_NONE,
}


def _ensure_vertex():
    global _vertex_initialized
    if _vertex_initialized:
        return
    vertexai.init(project=settings.GCS_PROJECT_ID, location=settings.VERTEX_AI_LOCATION)
    _vertex_initialized = True


def _call_gemini(system: str, prompt: str, max_tokens: int = 4096, temperature: float = 0.2) -> str:
    _ensure_vertex()
    model = GenerativeModel(
        "gemini-2.5-flash",
        system_instruction=system,
        generation_config=GenerationConfig(temperature=temperature, max_output_tokens=max_tokens),
    )
    try:
        response = model.generate_content(
            prompt,
            safety_settings=_SAFETY_SETTINGS,
        )

        if not response.candidates:
            logger.warning("Gemini returned no candidates - response may be blocked")
            return ""

        candidate = response.candidates[0]
        if not candidate.content or not candidate.content.parts:
            finish_reason = getattr(candidate, "finish_reason", "UNKNOWN")
            # finish_reason=2 means SAFETY — log which category triggered it
            if str(finish_reason) in ("2", "SAFETY"):
                safety_ratings = getattr(candidate, "safety_ratings", [])
                blocked = [
                    f"{r.category.name}={r.probability.name}"
                    for r in safety_ratings
                    if hasattr(r, "blocked") and r.blocked
                ]
                logger.warning(
                    "Gemini SAFETY block. Blocked categories: %s",
                    blocked or "unknown",
                )
            else:
                logger.warning("Gemini returned empty content. finish_reason=%s", finish_reason)
            return ""

        return (response.text or "").strip()
    except Exception as exc:
        logger.error("Gemini call failed: %s", exc)
        return ""


def _get_groq_client() -> Optional[Groq]:
    global _groq_client
    if _groq_client is not None:
        return _groq_client
    api_key = getattr(settings, "GROQ_API_KEY", None)
    if not api_key:
        logger.warning("GROQ_API_KEY is not configured")
        return None
    try:
        _groq_client = Groq(api_key=api_key)
    except Exception as exc:
        logger.error("Failed to initialize Groq client: %s", exc)
        return None
    return _groq_client


def _call_groq_summary(system: str, prompt: str, max_tokens: int = 300, temperature: float = 0.3) -> str:
    client = _get_groq_client()
    if client is None:
        return ""
    try:
        response = client.chat.completions.create(
            model="llama3-70b-8192",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
        )
        if not response.choices:
            return ""
        return (response.choices[0].message.content or "").strip()
    except Exception as exc:
        logger.error("Groq summary call failed: %s", exc)
        return ""


def _generate_fallback_briefing(kpi: Dict[str, Any], scope: Dict[str, Any]) -> str:
    """Generate a simple text briefing when Gemini fails."""
    complaints = kpi.get("complaints", {})
    tasks = kpi.get("tasks", {})

    lines = [
        f"Good morning, {scope.get('full_name', 'Official')}!",
        "",
        "Current Status:",
        f"- Open complaints: {complaints.get('open_total', 0)}",
        f"- Critical/Emergency: {complaints.get('critical_open', 0)}",
        f"- Needs workflow: {complaints.get('needs_workflow', 0)}",
        f"- Resolved total: {complaints.get('resolved_total', 0)}",
        "",
        "Tasks:",
        f"- Pending: {tasks.get('pending', 0)}",
        f"- Active: {tasks.get('active', 0)}",
        f"- Overdue: {tasks.get('overdue', 0)}",
        "",
        "Focus on critical items and overdue tasks today.",
    ]
    return "\n".join(lines)


def _enrich_query_data_for_chat(query_data: Optional[List[Dict[str, Any]]]) -> Optional[List[Dict[str, Any]]]:
    """
    Expand infra summary JSON into explicit fields so Gemini can reason over
    stable keys (problems_reported, summary, recommended_action) instead of
    a raw JSON string blob.
    """
    if not query_data:
        return query_data

    enriched: List[Dict[str, Any]] = []
    for row in query_data:
        item = dict(row)
        raw_summary = item.get("cluster_ai_summary")
        parsed_summary: Optional[Dict[str, Any]] = None

        if isinstance(raw_summary, str) and raw_summary.strip().startswith("{"):
            try:
                maybe = json.loads(raw_summary)
                if isinstance(maybe, dict):
                    parsed_summary = maybe
            except json.JSONDecodeError:
                parsed_summary = None
        elif isinstance(raw_summary, dict):
            parsed_summary = raw_summary

        if parsed_summary:
            problems = parsed_summary.get("problems_reported")
            if isinstance(problems, list):
                item["infra_problems_reported"] = problems
                item["infra_problem_count"] = len(problems)
                actions = [
                    str(p.get("recommended_action")).strip()
                    for p in problems
                    if isinstance(p, dict) and p.get("recommended_action")
                ]
                if actions:
                    # De-duplicate while preserving order.
                    item["infra_recommended_actions"] = list(dict.fromkeys(actions))

            if parsed_summary.get("summary"):
                item["infra_summary"] = parsed_summary.get("summary")
            elif parsed_summary.get("brief"):
                item["infra_summary"] = parsed_summary.get("brief")

            if not item.get("cluster_severity") and parsed_summary.get("overall_severity"):
                item["cluster_severity"] = parsed_summary.get("overall_severity")

        enriched.append(item)

    return enriched


# ── Scope helper ──────────────────────────────────────────────────

def _get_scope(db: Session, user_id: str, role: str) -> Dict[str, Any]:
    u = db.execute(
        text("SELECT city_id, department_id, jurisdiction_id, full_name FROM users WHERE id = CAST(:uid AS uuid)"),
        {"uid": user_id},
    ).mappings().first()
    if not u:
        return {}

    city_id = str(u["city_id"])   if u["city_id"]        else None
    dept_id = str(u["department_id"]) if u["department_id"]  else None
    jur_id  = str(u["jurisdiction_id"]) if u["jurisdiction_id"] else None

    c_where  = "c.is_deleted = FALSE"
    c_params: Dict[str, Any] = {}
    if city_id:
        c_where += " AND c.city_id = CAST(:city_id AS uuid)"
        c_params["city_id"] = city_id
    if role == "official":
        if dept_id:
            c_where += " AND CAST(:dept_id AS uuid) = ANY(c.agent_suggested_dept_ids)"
            c_params["dept_id"] = dept_id
        if jur_id:
            c_where += " AND c.jurisdiction_id = CAST(:jur_id AS uuid)"
            c_params["jur_id"] = jur_id
    elif role == "admin" and dept_id:
        c_where += " AND CAST(:dept_id AS uuid) = ANY(c.agent_suggested_dept_ids)"
        c_params["dept_id"] = dept_id

    # Task where clause
    t_where  = "t.is_deleted = FALSE"
    t_params: Dict[str, Any] = {}
    if role in ("official", "admin") and dept_id:
        t_where += " AND t.department_id = CAST(:t_dept_id AS uuid)"
        t_params["t_dept_id"] = dept_id
    elif role == "super_admin" and city_id:
        t_where += " AND EXISTS (SELECT 1 FROM departments d WHERE d.id=t.department_id AND d.city_id=CAST(:city_id AS uuid))"
        t_params["city_id"] = city_id

    return {
        "city_id":   city_id,
        "dept_id":   dept_id,
        "jur_id":    jur_id,
        "full_name": u["full_name"],
        "role":      role,
        "c_where":   c_where,
        "c_params":  c_params,
        "t_where":   t_where,
        "t_params":  t_params,
    }


# ── KPI snapshot ──────────────────────────────────────────────────

def _load_kpi(db: Session, scope: Dict) -> Dict:
    c_where  = scope["c_where"]
    c_params = dict(scope["c_params"])
    t_where  = scope["t_where"]
    t_params = dict(scope["t_params"])

    kpi = db.execute(text(f"""
        SELECT
            COUNT(*) FILTER (WHERE c.status NOT IN ('resolved','closed','rejected'))  AS open_total,
            COUNT(*) FILTER (WHERE c.priority IN ('critical','emergency')
                AND c.status NOT IN ('resolved','closed','rejected'))                  AS critical_open,
            COUNT(*) FILTER (WHERE c.is_repeat_complaint = TRUE
                AND c.status NOT IN ('resolved','closed','rejected'))                  AS repeat_open,
            COUNT(*) FILTER (WHERE c.status = 'received'
                AND c.created_at < NOW() - INTERVAL '3 days')                         AS stale_unassigned,
            COUNT(*) FILTER (WHERE c.status NOT IN ('resolved','closed','rejected')
                AND c.created_at < NOW() - INTERVAL '30 days')                        AS sla_breach_risk,
            COUNT(*) FILTER (WHERE c.workflow_instance_id IS NULL
                AND c.status NOT IN ('resolved','rejected','closed'))                  AS needs_workflow,
            COUNT(*) FILTER (WHERE c.status IN ('resolved','closed'))                 AS resolved_total
        FROM complaints c WHERE {c_where}
    """), c_params).mappings().first()

    tasks = db.execute(text(f"""
        SELECT
            COUNT(*) FILTER (WHERE t.status = 'pending')                         AS pending,
            COUNT(*) FILTER (WHERE t.status IN ('accepted','in_progress'))        AS active,
            COUNT(*) FILTER (WHERE t.status = 'completed')                       AS completed,
            COUNT(*) FILTER (WHERE t.due_at < NOW()
                AND t.status NOT IN ('completed','cancelled'))                    AS overdue
        FROM tasks t WHERE {t_where}
    """), t_params).mappings().first()

    # Infra node health
    city_id = scope.get("city_id")
    infra_kpi = {}
    if city_id:
        row = db.execute(text("""
            SELECT
                COUNT(*) FILTER (WHERE n.status = 'damaged')      AS damaged_nodes,
                COUNT(*) FILTER (WHERE n.status = 'under_repair') AS under_repair_nodes,
                COUNT(*) FILTER (WHERE n.last_resolved_at IS NOT NULL
                    AND NOW() - n.last_resolved_at < (it.repeat_alert_years || ' years')::INTERVAL
                    AND n.total_complaint_count > n.total_resolved_count) AS warranty_risk_nodes,
                COUNT(*)                                           AS total_nodes
            FROM infra_nodes n
            JOIN infra_types it ON it.id = n.infra_type_id
            WHERE n.city_id = CAST(:city_id AS uuid) AND n.is_deleted = FALSE
        """), {"city_id": city_id}).mappings().first()
        infra_kpi = dict(row) if row else {}

    return {
        "complaints": dict(kpi) if kpi else {},
        "tasks":      dict(tasks) if tasks else {},
        "infra":      infra_kpi,
    }


# ── Context loader ────────────────────────────────────────────────

def _load_official_context(db: Session, user_id: str, role: str) -> Dict[str, Any]:
    scope = _get_scope(db, user_id, role)
    if not scope:
        return {}

    kpi = _load_kpi(db, scope)
    c_where  = scope["c_where"]
    c_params = dict(scope["c_params"])

    oldest = db.execute(text(f"""
        SELECT c.complaint_number, c.title, c.status, c.priority,
               c.address_text, it.code AS infra_code,
               EXTRACT(DAY FROM NOW() - c.created_at)::int AS age_days,
               n.cluster_ai_summary
        FROM complaints c
        LEFT JOIN infra_nodes n  ON n.id  = c.infra_node_id
        LEFT JOIN infra_types it ON it.id = n.infra_type_id
        WHERE {c_where} AND c.status NOT IN ('resolved','closed','rejected')
        ORDER BY c.created_at ASC LIMIT 5
    """), c_params).mappings().all()

    stale_params: Dict[str, Any] = {}
    stale_where = "t.status IN ('pending','accepted') AND t.created_at < NOW() - INTERVAL '2 days' AND t.is_deleted=FALSE"
    city_id = scope.get("city_id")
    if city_id:
        stale_where += " AND EXISTS (SELECT 1 FROM departments d WHERE d.id=t.department_id AND d.city_id=CAST(:city_id AS uuid))"
        stale_params["city_id"] = city_id
    if scope.get("dept_id"):
        stale_where += " AND t.department_id = CAST(:dept_id AS uuid)"
        stale_params["dept_id"] = scope["dept_id"]

    stale_tasks = db.execute(text(f"""
        SELECT t.task_number, t.title, t.status, t.priority, t.created_at,
               wu.full_name AS worker_name, co.company_name AS contractor_company
        FROM tasks t
        LEFT JOIN workers     wk ON wk.id = t.assigned_worker_id
        LEFT JOIN users       wu ON wu.id = wk.user_id
        LEFT JOIN contractors co ON co.id = t.assigned_contractor_id
        WHERE {stale_where}
        ORDER BY t.priority DESC, t.created_at ASC LIMIT 5
    """), stale_params).mappings().all()

    survey_alerts = db.execute(text(f"""
        SELECT si.id, c.complaint_number, c.title AS complaint_title,
               si.survey_type, AVG(sr.overall_rating)::numeric(3,1) AS avg_rating
        FROM survey_instances si
        JOIN survey_responses sr ON sr.survey_instance_id = si.id
        JOIN complaints c        ON c.id = si.complaint_id
        WHERE {c_where.replace('c.city_id', 'c.city_id')}
          AND sr.submitted_at > NOW() - INTERVAL '7 days'
          AND sr.overall_rating IS NOT NULL
        GROUP BY si.id, c.complaint_number, c.title, si.survey_type
        HAVING AVG(sr.overall_rating) < 3.0
        ORDER BY avg_rating ASC LIMIT 5
    """), c_params).mappings().all()

    # Infra nodes needing attention
    infra_alerts = []
    if city_id:
        rows = db.execute(text("""
            SELECT n.id, it.name AS infra_type, n.status, n.cluster_severity,
                   n.cluster_ai_summary, n.total_complaint_count,
                   j.name AS jurisdiction
            FROM infra_nodes n
            JOIN infra_types it   ON it.id = n.infra_type_id
            LEFT JOIN jurisdictions j ON j.id = n.jurisdiction_id
            WHERE n.city_id = CAST(:city_id AS uuid) AND n.is_deleted = FALSE
              AND (n.status = 'damaged' OR n.cluster_severity IN ('high','critical'))
            ORDER BY
                CASE n.cluster_severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
                n.total_complaint_count DESC
            LIMIT 5
        """), {"city_id": city_id}).mappings().all()
        infra_alerts = [dict(r) for r in rows]

    return {
        "user_name":    scope["full_name"],
        "role":         role,
        "kpi":          kpi,
        "oldest_open":  [dict(r) for r in oldest],
        "stale_tasks":  [dict(r) for r in stale_tasks],
        "survey_alerts":[dict(r) for r in survey_alerts],
        "infra_alerts": infra_alerts,
        "_scope":       scope,
    }


# ── Daily briefing ────────────────────────────────────────────────

def get_daily_briefing(db: Session, user_id: str, role: str) -> Dict[str, Any]:
    ctx = _load_official_context(db, user_id, role)
    if not ctx:
        return {"greeting": "Namaskar! Dashboard data is loading.", "sections": []}

    kpi_c = ctx.get("kpi", {}).get("complaints", {})
    kpi_i = ctx.get("kpi", {}).get("infra", {})

    greeting = "Namaskar! Here is your morning briefing."
    try:
        # Build a clean, filter-safe context — drop raw AI summaries which contain
        # civic keywords (damaged, hazard, broken) that trigger DANGEROUS_CONTENT.
        safe_ctx = {
            "user_name": ctx["user_name"],
            "role": role,
            "kpi": ctx.get("kpi", {}),
            "oldest_open": [
                {k: v for k, v in c.items() if k != "cluster_ai_summary"}
                for c in ctx.get("oldest_open", [])
            ],
            "stale_tasks":  ctx.get("stale_tasks", []),
            "survey_alerts": ctx.get("survey_alerts", []),
            "infra_alerts": [
                {k: v for k, v in n.items() if k != "cluster_ai_summary"}
                for n in ctx.get("infra_alerts", [])
            ],
        }
        raw = _call_groq_summary(
            "You are PS-CRM, a concise municipal operations assistant for Delhi. Be direct and actionable. Use neutral, professional wording. Plain text, no bullet points, no markdown.",
            f"Write a 3-4 sentence morning briefing for {ctx['user_name']} ({role}).\n\nDATA:\n{json.dumps(safe_ctx, default=str, indent=2)}",
            max_tokens=300, temperature=0.3,
        )
        if raw:
            greeting = raw
        else:
            greeting = _generate_fallback_briefing(ctx.get("kpi", {}), ctx.get("_scope", {}))
    except Exception as exc:
        logger.error("Briefing summary generation failed: %s", exc)
        greeting = _generate_fallback_briefing(ctx.get("kpi", {}), ctx.get("_scope", {}))

    sections = []
    if int(kpi_c.get("critical_open") or 0) > 0:
        sections.append({"type": "alert",   "title": f"🔴 {kpi_c['critical_open']} Critical/Emergency complaints", "action": "Review now"})
    if int(kpi_c.get("needs_workflow") or 0) > 0:
        sections.append({"type": "warning", "title": f"🔄 {kpi_c['needs_workflow']} complaints need workflow",     "action": "Assign workflows"})
    if int(kpi_c.get("stale_unassigned") or 0) > 0:
        sections.append({"type": "warning", "title": f"⚠️ {kpi_c['stale_unassigned']} unassigned >3 days",         "action": "Assign workers"})
    if int(kpi_c.get("repeat_open") or 0) > 0:
        sections.append({"type": "info",    "title": f"↩ {kpi_c['repeat_open']} repeat complaints open",           "action": "Check infra history"})
    if int(kpi_i.get("damaged_nodes") or 0) > 0:
        sections.append({"type": "alert",   "title": f"🏗️ {kpi_i['damaged_nodes']} infra nodes marked Damaged",    "action": "Dispatch repair"})
    if int(kpi_i.get("warranty_risk_nodes") or 0) > 0:
        sections.append({"type": "warning", "title": f"⚠️ {kpi_i['warranty_risk_nodes']} nodes in warranty breach risk", "action": "Check contractors"})
    if ctx.get("survey_alerts"):
        sections.append({"type": "warning", "title": f"📋 {len(ctx['survey_alerts'])} poor survey ratings this week", "action": "Investigate"})
    if int(kpi_c.get("sla_breach_risk") or 0) > 0:
        sections.append({"type": "warning", "title": f"⏰ {kpi_c['sla_breach_risk']} SLA breach risk (>30d)",       "action": "Escalate"})

    return {
        "greeting":      greeting,
        "kpi":           kpi_c,
        "sections":      sections,
        "oldest_open":   ctx.get("oldest_open", []),
        "stale_tasks":   ctx.get("stale_tasks", []),
        "survey_alerts": ctx.get("survey_alerts", []),
        "infra_alerts":  ctx.get("infra_alerts", []),
    }


# ── Main chat ─────────────────────────────────────────────────────

def chat_with_crm_agent(
    db: Session, user_id: str, role: str,
    user_message: str, conversation_history: List[Dict[str, str]],
) -> Dict[str, Any]:
    ctx       = _load_official_context(db, user_id, role)
    user_name = ctx.get("user_name", "Official")
    kpi_c     = ctx.get("kpi", {}).get("complaints", {})
    kpi_t     = ctx.get("kpi", {}).get("tasks", {})
    kpi_i     = ctx.get("kpi", {}).get("infra", {})
    scope     = ctx.get("_scope", {})

    query_data = None
    try:
        query_data = _run_agent_query(db, scope, user_message)
    except Exception as exc:
        logger.warning("Agent query failed: %s", exc)

    system = f"""You are PS-CRM, the AI assistant for Delhi municipal officials.
CURRENT USER: {user_name} ({role})
KPI SNAPSHOT:
  Complaints → Open={kpi_c.get('open_total','?')} | Critical={kpi_c.get('critical_open','?')} | NeedsWorkflow={kpi_c.get('needs_workflow','?')} | SLA_Risk={kpi_c.get('sla_breach_risk','?')} | Repeat={kpi_c.get('repeat_open','?')}
  Tasks      → Pending={kpi_t.get('pending','?')} | Active={kpi_t.get('active','?')} | Overdue={kpi_t.get('overdue','?')}
  Infra      → Damaged={kpi_i.get('damaged_nodes','?')} | UnderRepair={kpi_i.get('under_repair_nodes','?')} | WarrantyRisk={kpi_i.get('warranty_risk_nodes','?')}

Rules:
- Be direct, factual, and concise (2-5 sentences, or a structured list if more helpful)
- Reference complaint numbers (e.g. CRM-DEL-...) and task numbers when discussing specific items
- If LIVE DB DATA is provided below, use it as your primary source
- Never say "I don't have access to..." — you do. Refer to the data provided.
- If asked about infra nodes, mention their AI summary, severity, and complaint count
- If asked about workflows, mention their status, steps, and assigned officials"""

    history_str = "".join(
        f"{'Official' if t.get('role') == 'user' else 'PS-CRM'}: {t['content']}\n"
        for t in conversation_history[-8:]
    )

    db_section = ""
    query_data_for_llm = _enrich_query_data_for_chat(query_data)
    if query_data_for_llm:
        db_section = f"\nLIVE DB DATA:\n{json.dumps(query_data_for_llm, default=str, separators=(',', ':'))}\n"

    full_prompt = f"{history_str}{db_section}Official: {user_message}\nPS-CRM:"

    answer = ""
    try:
        answer = _call_gemini(system, full_prompt, max_tokens=800)
    except Exception as exc:
        logger.error("CRM chat Gemini failed: %s", exc)

    # If Gemini returned empty (safety block or timeout), build a data-driven fallback
    if not answer:
        if query_data and isinstance(query_data, list) and len(query_data) > 0:
            count = len(query_data)
            first = query_data[0]
            # Build a summary from the DB data directly
            answer = (
                f"Here are the {count} result(s) I found. "
                f"First item: {first.get('title') or first.get('template_name') or first.get('infra_type') or str(first)[:80]}. "
                f"Full data is shown below in the table."
            )
        else:
            answer = (
                f"Based on current data — "
                f"Open complaints: {kpi_c.get('open_total', '?')} | "
                f"Critical: {kpi_c.get('critical_open', '?')} | "
                f"Tasks overdue: {kpi_t.get('overdue', '?')} | "
                f"Needs workflow: {kpi_c.get('needs_workflow', '?')}. "
                f"Ask me about specific complaints, tasks, or infra nodes."
            )

    return {"answer": answer, "data": query_data}


# ── Keyword-based DB query ────────────────────────────────────────

def _run_agent_query(db: Session, scope: Dict, user_message: str) -> Optional[List[Dict]]:
    """
    Routes the user message to the most relevant DB query.
    Returns structured data injected directly into Gemini context.
    """
    if not scope:
        return None

    city_id = scope.get("city_id")
    dept_id = scope.get("dept_id")
    msg     = user_message.lower()

    c_params: Dict[str, Any] = {}
    city_f = "c.city_id = CAST(:city AS uuid)" if city_id else "TRUE"
    dept_f = "CAST(:dept AS uuid) = ANY(c.agent_suggested_dept_ids)" if dept_id else "TRUE"
    if city_id: c_params["city"] = city_id
    if dept_id: c_params["dept"] = dept_id
    combined = f"{city_f} AND {dept_f} AND c.is_deleted=FALSE"

    t_params: Dict[str, Any] = {}
    t_filter = "t.is_deleted=FALSE"
    if dept_id:
        t_filter += " AND t.department_id = CAST(:t_dept AS uuid)"
        t_params["t_dept"] = dept_id
    elif city_id:
        t_filter += " AND EXISTS (SELECT 1 FROM departments d WHERE d.id=t.department_id AND d.city_id=CAST(:city AS uuid))"
        t_params["city"] = city_id

    # ── Complaint number lookup ───────────────────────────────────
    match = re.search(r"CRM-[A-Z]+-\d{4}-\d+", user_message.upper())
    if match:
        rows = db.execute(text("""
            SELECT c.complaint_number, c.title, c.status, c.priority,
                   c.agent_summary, c.address_text, c.created_at, c.resolved_at,
                   it.name AS infra_type, j.name AS jurisdiction,
                   n.cluster_ai_summary, n.cluster_severity
            FROM complaints c
            LEFT JOIN infra_nodes n  ON n.id  = c.infra_node_id
            LEFT JOIN infra_types it ON it.id = n.infra_type_id
            LEFT JOIN jurisdictions j ON j.id = c.jurisdiction_id
            WHERE c.complaint_number = :num AND c.is_deleted=FALSE
        """), {"num": match.group(0)}).mappings().all()
        return [dict(r) for r in rows] if rows else None

    # ── Infra nodes ───────────────────────────────────────────────
    if any(w in msg for w in ["infra", "node", "infrastructure", "cluster", "pothole", "road", "drain",
                               "streetlight", "water pipe", "sewer", "garbage", "tree", "pole"]):
        n_params: Dict[str, Any] = {}
        n_filter = "n.is_deleted=FALSE"
        if city_id:
            n_filter += " AND n.city_id = CAST(:city AS uuid)"
            n_params["city"] = city_id
        if dept_id:
            # Nodes that have complaints routed to this dept
            n_filter += """ AND EXISTS (
                SELECT 1 FROM complaints c2
                WHERE c2.infra_node_id = n.id
                  AND CAST(:dept AS uuid) = ANY(c2.agent_suggested_dept_ids)
                  AND c2.is_deleted = FALSE
            )"""
            n_params["dept"] = dept_id

        # Filter by specific infra type if mentioned
        infra_keyword_map = {
            "pothole": "POTHOLE", "road": "ROAD", "drain": "DRAIN",
            "streetlight": "STLIGHT", "water": "WATER_PIPE", "sewer": "SEWER",
            "garbage": "GARBAGE", "tree": "TREE", "pole": "ELEC_POLE",
        }
        type_filter = ""
        for kw, code in infra_keyword_map.items():
            if kw in msg:
                type_filter = f" AND it.code = '{code}'"
                break

        rows = db.execute(text(f"""
            SELECT n.id, it.name AS infra_type, it.code AS infra_code,
                   n.status, n.cluster_severity, n.cluster_ai_summary,
                   n.cluster_major_themes,
                   n.total_complaint_count, n.last_resolved_at,
                   j.name AS jurisdiction,
                   (SELECT COUNT(*) FROM complaints c3
                    WHERE c3.infra_node_id = n.id
                      AND c3.status NOT IN ('resolved','closed','rejected')
                      AND c3.is_deleted = FALSE) AS open_complaints
            FROM infra_nodes n
            JOIN infra_types it   ON it.id = n.infra_type_id
            LEFT JOIN jurisdictions j ON j.id = n.jurisdiction_id
            WHERE {n_filter}{type_filter}
            ORDER BY
                CASE n.cluster_severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2
                                        WHEN 'medium' THEN 3 ELSE 4 END,
                n.total_complaint_count DESC
            LIMIT 10
        """), n_params).mappings().all()
        return [dict(r) for r in rows] if rows else None

    # ── Warranty / repeat / critical alerts ───────────────────────
    if any(w in msg for w in ["warranty", "repeat alert", "contractor liable", "critical alert", "breach warranty"]):
        if city_id:
            rows = db.execute(text("""
                SELECT n.id, it.name AS infra_type, n.status,
                       n.last_resolved_at,
                       EXTRACT(DAY FROM NOW() - n.last_resolved_at)::int AS days_since_resolved,
                       it.repeat_alert_years AS warranty_years,
                       co.company_name AS liable_contractor,
                       j.name AS jurisdiction,
                       COUNT(c.id) AS new_complaints_after_repair
                FROM infra_nodes n
                JOIN infra_types it ON it.id = n.infra_type_id
                LEFT JOIN jurisdictions j ON j.id = n.jurisdiction_id
                JOIN complaints c ON c.infra_node_id = n.id
                    AND c.is_repeat_complaint = TRUE
                    AND c.status NOT IN ('resolved','closed','rejected')
                    AND c.is_deleted = FALSE
                LEFT JOIN LATERAL (
                    SELECT t.assigned_contractor_id FROM tasks t
                    WHERE t.complaint_id IN (
                        SELECT id FROM complaints WHERE infra_node_id = n.id
                          AND status IN ('resolved','closed') ORDER BY resolved_at DESC LIMIT 1
                    ) AND t.assigned_contractor_id IS NOT NULL LIMIT 1
                ) lt ON TRUE
                LEFT JOIN contractors co ON co.id = lt.assigned_contractor_id
                WHERE n.city_id = CAST(:city AS uuid) AND n.is_deleted = FALSE
                  AND n.last_resolved_at IS NOT NULL
                  AND NOW() - n.last_resolved_at < (it.repeat_alert_years || ' years')::INTERVAL
                GROUP BY n.id, it.name, n.status, n.last_resolved_at,
                         it.repeat_alert_years, co.company_name, j.name
                ORDER BY days_since_resolved ASC LIMIT 10
            """), {"city": city_id}).mappings().all()
            return [dict(r) for r in rows] if rows else None

    # ── Workflow ──────────────────────────────────────────────────
    if any(w in msg for w in ["workflow", "no workflow", "needs workflow", "pending workflow", "approve workflow"]):
        rows = db.execute(text(f"""
            SELECT c.complaint_number, c.title, c.priority, c.status, c.address_text,
                   EXTRACT(DAY FROM NOW()-c.created_at)::int AS age_days,
                   it.code AS infra_type, it.name AS infra_type_name,
                   n.cluster_ai_summary, n.cluster_severity
            FROM complaints c
            LEFT JOIN infra_nodes n  ON n.id=c.infra_node_id
            LEFT JOIN infra_types it ON it.id=n.infra_type_id
            WHERE {combined} AND c.workflow_instance_id IS NULL
              AND c.status NOT IN ('resolved','rejected','closed')
            ORDER BY c.priority DESC, age_days DESC LIMIT 10
        """), c_params).mappings().all()
        return [dict(r) for r in rows] if rows else None

    # ── Active workflows ──────────────────────────────────────────
    if any(w in msg for w in ["active workflow", "workflow status", "workflow progress"]):
        w_params: Dict[str, Any] = {}
        w_filter = "wi.status = 'active'"
        if city_id:
            w_filter += " AND EXISTS (SELECT 1 FROM infra_nodes n2 WHERE n2.id=wi.infra_node_id AND n2.city_id=CAST(:city AS uuid))"
            w_params["city"] = city_id
        rows = db.execute(text(f"""
            SELECT wi.id, wt.name AS template_name, wi.status,
                   wi.current_step_number, wi.total_steps,
                   it.name AS infra_type, j.name AS jurisdiction,
                   wi.started_at,
                   EXTRACT(DAY FROM NOW()-wi.started_at)::int AS days_running
            FROM workflow_instances wi
            JOIN workflow_templates wt ON wt.id = wi.template_id
            JOIN infra_nodes n  ON n.id = wi.infra_node_id
            JOIN infra_types it ON it.id = n.infra_type_id
            LEFT JOIN jurisdictions j ON j.id = wi.jurisdiction_id
            WHERE {w_filter}
            ORDER BY days_running DESC LIMIT 10
        """), w_params).mappings().all()
        return [dict(r) for r in rows] if rows else None

    # ── Contractor / performance ──────────────────────────────────
    if any(w in msg for w in ["contractor", "company", "vendor", "performance", "blacklist"]):
        rows = db.execute(text("""
            SELECT co.company_name, co.registration_number,
                   co.performance_score, co.is_blacklisted, co.license_expiry,
                   COUNT(t.id) FILTER (WHERE t.status='completed')             AS completed_tasks,
                   COUNT(t.id) FILTER (WHERE t.status IN ('accepted','in_progress')) AS active_tasks,
                   COUNT(t.id) FILTER (WHERE t.due_at < NOW()
                       AND t.status NOT IN ('completed','cancelled'))           AS overdue_tasks
            FROM contractors co
            LEFT JOIN tasks t ON t.assigned_contractor_id = co.id
            WHERE co.city_id = CAST(:city AS uuid)
            GROUP BY co.id ORDER BY co.performance_score ASC LIMIT 10
        """), {"city": city_id} if city_id else {}).mappings().all()
        return [dict(r) for r in rows] if rows else None

    # ── Workers ───────────────────────────────────────────────────
    if any(w in msg for w in ["worker", "field staff", "employee", "available worker"]):
        w_params: Dict[str, Any] = {}
        w_filter = "TRUE"
        if dept_id:
            w_filter = "w.department_id = CAST(:dept AS uuid)"
            w_params["dept"] = dept_id
        rows = db.execute(text(f"""
            SELECT u.full_name, w.performance_score, w.is_available,
                   w.current_task_count, w.skills,
                   d.name AS department
            FROM workers w
            JOIN users u ON u.id = w.user_id
            LEFT JOIN departments d ON d.id = w.department_id
            WHERE {w_filter} AND u.is_active=TRUE
            ORDER BY w.performance_score DESC LIMIT 10
        """), w_params).mappings().all()
        return [dict(r) for r in rows] if rows else None

    # ── Tenders ───────────────────────────────────────────────────
    if any(w in msg for w in ["tender", "procurement", "bid", "contract award"]):
        t2_params: Dict[str, Any] = {}
        t2_filter = "td.status IN ('submitted','admin_approved','requested')"
        if city_id:
            t2_filter += " AND d.city_id = CAST(:city AS uuid)"
            t2_params["city"] = city_id
        rows = db.execute(text(f"""
            SELECT td.tender_number, td.title, td.status,
                   td.estimated_cost, td.submitted_at,
                   u.full_name AS submitted_by, d.name AS department
            FROM tenders td
            JOIN departments d ON d.id = td.department_id
            LEFT JOIN users u  ON u.id = td.requested_by
            WHERE {t2_filter}
            ORDER BY td.submitted_at DESC LIMIT 10
        """), t2_params).mappings().all()
        return [dict(r) for r in rows] if rows else None

    # ── Surveys / feedback ────────────────────────────────────────
    if any(w in msg for w in ["survey", "rating", "feedback", "citizen satisfaction", "poor rating"]):
        rows = db.execute(text("""
            SELECT
                AVG(sr.overall_rating)::numeric(3,1)                          AS avg_rating,
                COUNT(*)                                                       AS total_responses,
                COUNT(*) FILTER (WHERE sr.overall_rating < 3)                 AS poor_count,
                COUNT(*) FILTER (WHERE sr.overall_rating >= 4)                AS good_count,
                COUNT(*) FILTER (WHERE sr.overall_rating IS NULL)             AS no_rating,
                MIN(sr.overall_rating)                                        AS min_rating,
                MAX(sr.overall_rating)                                        AS max_rating
            FROM survey_responses sr
            WHERE sr.submitted_at >= NOW() - INTERVAL '30 days'
        """), {}).mappings().first()
        return [dict(rows)] if rows else None

    # ── Repeat complaints ─────────────────────────────────────────
    if any(w in msg for w in ["repeat", "recurring", "same complaint", "again"]):
        rows = db.execute(text(f"""
            SELECT c.complaint_number, c.title, c.status, c.address_text,
                   it.code AS infra_type, c.repeat_gap_days,
                   EXTRACT(DAY FROM NOW()-c.created_at)::int AS age_days,
                   n.total_complaint_count, n.cluster_ai_summary
            FROM complaints c
            LEFT JOIN infra_nodes n  ON n.id=c.infra_node_id
            LEFT JOIN infra_types it ON it.id=n.infra_type_id
            WHERE {combined} AND c.is_repeat_complaint=TRUE
              AND c.status NOT IN ('resolved','closed','rejected')
            ORDER BY age_days DESC LIMIT 10
        """), c_params).mappings().all()
        return [dict(r) for r in rows] if rows else None

    # ── Stuck / stale ─────────────────────────────────────────────
    if any(w in msg for w in ["stuck", "stale", "old", "delayed", "7 day", "week", "unresponded"]):
        rows = db.execute(text(f"""
            SELECT c.complaint_number, c.title, c.status, c.priority, c.address_text,
                   EXTRACT(DAY FROM NOW()-c.created_at)::int AS age_days, it.code AS infra_type
            FROM complaints c
            LEFT JOIN infra_nodes n  ON n.id=c.infra_node_id
            LEFT JOIN infra_types it ON it.id=n.infra_type_id
            WHERE {combined} AND c.status NOT IN ('resolved','closed','rejected')
              AND c.created_at < NOW()-INTERVAL '7 days'
            ORDER BY age_days DESC LIMIT 10
        """), c_params).mappings().all()
        return [dict(r) for r in rows] if rows else None

    # ── SLA risk ──────────────────────────────────────────────────
    if any(w in msg for w in ["sla", "breach", "overdue", "deadline", "30 day", "41 day"]):
        rows = db.execute(text(f"""
            SELECT c.complaint_number, c.title, c.status, c.address_text,
                   EXTRACT(DAY FROM NOW()-c.created_at)::int AS age_days,
                   it.code AS infra_type
            FROM complaints c
            LEFT JOIN infra_nodes n  ON n.id=c.infra_node_id
            LEFT JOIN infra_types it ON it.id=n.infra_type_id
            WHERE {combined} AND c.status NOT IN ('resolved','closed','rejected')
              AND c.created_at < NOW()-INTERVAL '30 days'
            ORDER BY age_days DESC LIMIT 10
        """), c_params).mappings().all()
        return [dict(r) for r in rows] if rows else None

    # ── Critical / emergency ──────────────────────────────────────
    if any(w in msg for w in ["critical", "emergency", "urgent", "priority"]):
        rows = db.execute(text(f"""
            SELECT c.complaint_number, c.title, c.status, c.priority, c.address_text,
                   EXTRACT(DAY FROM NOW()-c.created_at)::int AS age_days,
                   n.cluster_ai_summary, it.code AS infra_type
            FROM complaints c
            LEFT JOIN infra_nodes n  ON n.id=c.infra_node_id
            LEFT JOIN infra_types it ON it.id=n.infra_type_id
            WHERE {combined} AND c.priority IN ('critical','emergency')
              AND c.status NOT IN ('resolved','closed','rejected')
            ORDER BY c.priority DESC, c.created_at ASC LIMIT 10
        """), c_params).mappings().all()
        return [dict(r) for r in rows] if rows else None

    # ── Multi-department ──────────────────────────────────────────
    if any(w in msg for w in ["multi", "department", "coordination", "coord", "multiple dept"]):
        rows = db.execute(text(f"""
            SELECT c.complaint_number, c.title, c.status, c.priority, c.address_text,
                   array_length(c.agent_suggested_dept_ids,1) AS dept_count,
                   it.code AS infra_type
            FROM complaints c
            LEFT JOIN infra_nodes n  ON n.id=c.infra_node_id
            LEFT JOIN infra_types it ON it.id=n.infra_type_id
            WHERE {combined} AND array_length(c.agent_suggested_dept_ids,1) > 1
              AND c.status NOT IN ('resolved','closed','rejected')
            ORDER BY dept_count DESC, c.priority DESC LIMIT 10
        """), c_params).mappings().all()
        return [dict(r) for r in rows] if rows else None

    # ── Tasks ─────────────────────────────────────────────────────
    if any(w in msg for w in ["task", "assigned", "pending task", "overdue task"]):
        rows = db.execute(text(f"""
            SELECT t.task_number, t.title, t.status, t.priority,
                   wu.full_name AS worker_name, co.company_name,
                   d.name AS dept_name,
                   EXTRACT(DAY FROM NOW()-t.created_at)::int AS age_days,
                   t.due_at
            FROM tasks t
            LEFT JOIN departments d  ON d.id=t.department_id
            LEFT JOIN workers wk     ON wk.id=t.assigned_worker_id
            LEFT JOIN users wu       ON wu.id=wk.user_id
            LEFT JOIN contractors co ON co.id=t.assigned_contractor_id
            WHERE {t_filter}
            ORDER BY
                CASE WHEN t.due_at < NOW() THEN 0 ELSE 1 END,
                age_days DESC LIMIT 10
        """), t_params).mappings().all()
        return [dict(r) for r in rows] if rows else None

    # ── Resolved / completed ──────────────────────────────────────
    if any(w in msg for w in ["resolved", "completed", "closed", "done this week", "last week"]):
        rows = db.execute(text(f"""
            SELECT c.complaint_number, c.title, c.priority, c.resolved_at,
                   EXTRACT(DAY FROM c.resolved_at - c.created_at)::int AS resolution_days,
                   it.code AS infra_type
            FROM complaints c
            LEFT JOIN infra_nodes n  ON n.id=c.infra_node_id
            LEFT JOIN infra_types it ON it.id=n.infra_type_id
            WHERE {combined} AND c.status IN ('resolved','closed')
              AND c.resolved_at > NOW() - INTERVAL '7 days'
            ORDER BY c.resolved_at DESC LIMIT 10
        """), c_params).mappings().all()
        return [dict(r) for r in rows] if rows else None

    # ── Overview / summary / briefing (general question) ─────────
    if any(w in msg for w in ["overview", "summary", "status", "what's happening", "update",
                               "how many", "total", "count", "today", "right now"]):
        # Return KPI + top infra alerts
        infra_top = []
        if city_id:
            rows = db.execute(text("""
                SELECT it.name AS infra_type, it.code,
                       COUNT(c.id) AS open_complaints,
                       n.cluster_severity
                FROM complaints c
                JOIN infra_nodes n  ON n.id  = c.infra_node_id
                JOIN infra_types it ON it.id = n.infra_type_id
                WHERE c.city_id = CAST(:city AS uuid) AND c.is_deleted=FALSE
                  AND c.status NOT IN ('resolved','closed','rejected')
                GROUP BY it.id, it.name, it.code, n.cluster_severity
                ORDER BY open_complaints DESC LIMIT 8
            """), {"city": city_id}).mappings().all()
            infra_top = [dict(r) for r in rows]
        return infra_top if infra_top else None

    return None