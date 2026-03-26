# backend/services/workflow_agent_service.py
"""
Human-in-the-loop workflow agent — completely rewritten to match final.sql schema.

Schema facts this file depends on:
  workflow_templates        : id, city_id, name, situation_summary, situation_keywords,
                              situation_infra_codes, times_used, avg_completion_days,
                              last_used_at, source_complaint_ids
  workflow_template_versions: id, template_id, version, is_active, is_latest_version,
                              infra_type_id, jurisdiction_id
  workflow_template_steps   : id, version_id (NOT template_id), step_number, department_id,
                              step_name, expected_duration_hours, work_type_codes,
                              is_optional, requires_tender
  workflow_instances        : id, infra_node_id, template_id, version_id, jurisdiction_id,
                              status, mode, current_step_number, total_steps
                              (NO complaint_id — uses workflow_complaints junction table)
  workflow_complaints       : workflow_instance_id, complaint_id  (junction)
  workflow_step_instances   : id, workflow_instance_id, template_step_id, step_number,
                              department_id, step_name, status, assigned_official_id
"""
import json
import logging
import uuid as _uuid
from typing import Any, Dict, List, Optional

import vertexai
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

logger = logging.getLogger(__name__)

_vertex_initialized = False


def _ensure_vertex():
    global _vertex_initialized
    if _vertex_initialized:
        return
    vertexai.init(project=settings.GCS_PROJECT_ID, location=settings.VERTEX_AI_LOCATION)
    _vertex_initialized = True


def _call_gemini_json(prompt: str, max_tokens: int = 3048) -> str:
    _ensure_vertex()
    model = GenerativeModel(
        "gemini-2.5-flash",
        system_instruction="Output only valid JSON. No markdown fences, no explanation, no prose.",
        generation_config=GenerationConfig(temperature=0.1, max_output_tokens=3060),
    )
    return (model.generate_content(prompt, safety_settings=_SAFETY_SETTINGS).text or "").strip()


def _parse_json(raw: str) -> Any:
    clean = raw.strip()
    if "```" in clean:
        parts = clean.split("```")
        clean = parts[1] if len(parts) > 1 else parts[0]
        if clean.lstrip().startswith("json"):
            clean = clean.lstrip()[4:]
    return json.loads(clean.strip())


def _get_latest_version(db: Session, template_id: str) -> Optional[Dict]:
    row = db.execute(
        text("""
            SELECT id, version, infra_type_id, jurisdiction_id
            FROM workflow_template_versions
            WHERE template_id     = CAST(:tid AS uuid)
              AND is_active        = TRUE
              AND is_latest_version= TRUE
            LIMIT 1
        """),
        {"tid": template_id},
    ).mappings().first()
    return dict(row) if row else None


def _get_steps_for_version(db: Session, version_id: str) -> List[Dict]:
    rows = db.execute(
        text("""
            SELECT wts.id, wts.step_number, wts.step_name, wts.description,
                   wts.expected_duration_hours, wts.work_type_codes,
                   wts.is_optional, wts.requires_tender,
                   d.name AS dept_name, d.code AS dept_code, wts.department_id
            FROM workflow_template_steps wts
            JOIN departments d ON d.id = wts.department_id
            WHERE wts.version_id = CAST(:vid AS uuid)
            ORDER BY wts.step_number
        """),
        {"vid": version_id},
    ).mappings().all()
    return [dict(r) for r in rows]


# ── suggest_workflows ─────────────────────────────────────────────

def suggest_workflows(
    db: Session,
    *,
    complaint_id: str,
    city_id: str,
    infra_type_code: str,
    complaint_summary: str,
    priority: str,
    is_repeat: bool,
) -> List[Dict[str, Any]]:
    """
    Returns top-3 workflow template suggestions.

    Matching strategy (two-pass):
      Pass 1 — templates whose situation_infra_codes contain this infra_type_code
               OR whose infra_type_id matches (via version).
               These are always preferred.
      Pass 2 — fill remaining slots from other templates, scored by keywords + usage.

    This guarantees a pothole node never gets a streetlight workflow ranked first.
    """
    _BASE_QUERY = """
        SELECT
            wt.id, wt.name, wt.description,
            wt.situation_summary, wt.situation_keywords,
            wt.situation_infra_codes, wt.times_used, wt.avg_completion_days,
            wtv.id AS version_id,
            COUNT(wts.id) AS step_count
        FROM workflow_templates wt
        JOIN workflow_template_versions wtv
            ON  wtv.template_id      = wt.id
            AND wtv.is_active         = TRUE
            AND wtv.is_latest_version = TRUE
        LEFT JOIN workflow_template_steps wts ON wts.version_id = wtv.id
        {where}
        GROUP BY wt.id, wt.name, wt.description,
                 wt.situation_summary, wt.situation_keywords,
                 wt.situation_infra_codes, wt.times_used, wt.avg_completion_days,
                 wtv.id
        ORDER BY wt.times_used DESC, wt.avg_completion_days ASC NULLS LAST
        LIMIT {limit}
    """

    seen_ids: set = set()
    candidates: list = []

    # ── Pass 1: infra-type-matched templates (always shown first) ─
    if infra_type_code:
        matched = db.execute(
            text(_BASE_QUERY.format(
                where="""
                    WHERE wt.city_id = CAST(:city_id AS uuid)
                      AND (
                        :infra_code = ANY(wt.situation_infra_codes)
                        OR EXISTS (
                            SELECT 1 FROM infra_types it2
                            WHERE it2.code = :infra_code
                              AND wtv.infra_type_id = it2.id
                        )
                      )
                """,
                limit=6,
            )),
            {"city_id": city_id, "infra_code": infra_type_code},
        ).mappings().all()
        for r in matched:
            seen_ids.add(str(r["id"]))
            candidates.append(dict(r) | {"_pass": 1})

    # ── Pass 2: fill with any remaining templates ─────────────────
    if len(candidates) < 6:
        others = db.execute(
            text(_BASE_QUERY.format(
                where="WHERE wt.city_id = CAST(:city_id AS uuid)",
                limit=12,
            )),
            {"city_id": city_id},
        ).mappings().all()
        for r in others:
            if str(r["id"]) not in seen_ids:
                candidates.append(dict(r) | {"_pass": 2})
            if len(candidates) >= 9:
                break

    if not candidates:
        return []

    template_map = {str(c["id"]): c for c in candidates}
    version_map  = {str(c["id"]): str(c["version_id"]) for c in candidates}

    def score_template(t):
        score = 0

        # Pass-1 templates get a huge head-start — they match the infra type
        if t.get("_pass") == 1:
            score += 10

        # Infra code match in situation_infra_codes
        infra_codes = t.get("situation_infra_codes") or []
        if infra_type_code and infra_type_code in infra_codes:
            score += 5

        # Keyword match against complaint summary
        keywords = t.get("situation_keywords") or []
        kw_matches = sum(
            1 for kw in keywords
            if kw.lower() in (complaint_summary or "").lower()
        )
        score += min(kw_matches, 4)

        # Name match — direct infra type word in template name
        if infra_type_code:
            name_lower = (t.get("name") or "").lower()
            code_lower = infra_type_code.lower().replace("_", " ")
            if code_lower in name_lower or infra_type_code.lower() in name_lower:
                score += 3

        # Repeat complaint bonus
        if is_repeat:
            score += 1

        # Usage weight (capped — don't let usage override type match)
        times_used = t.get("times_used") or 0
        score += min(times_used / 20.0, 2)

        # High priority bonus
        if priority in ("critical", "emergency", "high"):
            score += 0.5

        match_pct  = min(99, max(10, int(score / 25.0 * 100)))
        is_type_match = t.get("_pass") == 1 or infra_type_code in (t.get("situation_infra_codes") or [])
        reason = (
            f"Direct infra type match ({infra_type_code}). " if is_type_match else ""
        ) + (
            f"{kw_matches} keyword match{'es' if kw_matches != 1 else ''}. " if kw_matches else ""
        ) + f"Used {times_used} time{'s' if times_used != 1 else ''}."

        return {
            "template_id":           str(t["id"]),
            "match_score":           match_pct / 100,
            "match_reason":          reason,
            "recommended_priority":  1,
            "_raw_score":            score,
        }

    scored = sorted([score_template(c) for c in candidates], key=lambda x: x["_raw_score"], reverse=True)
    suggestions = scored[:3]

    result = []
    for s in suggestions[:3]:
        tid  = s.get("template_id")
        tmpl = template_map.get(tid)
        if not tmpl:
            continue
        vid   = version_map.get(tid)
        steps = _get_steps_for_version(db, vid) if vid else []
        result.append({
            "template_id":          tid,
            "name":                 tmpl["name"],
            "description":          tmpl["description"],
            "situation_summary":    tmpl["situation_summary"],
            "times_used":           tmpl["times_used"],
            "avg_completion_days":  float(tmpl["avg_completion_days"] or 0),
            "match_score":          s.get("match_score", 0.7),
            "match_reason":         s.get("match_reason", ""),
            "recommended_priority": s.get("recommended_priority", 1),
            "version_id":           vid,
            "steps": [
                {
                    "step_number":            step["step_number"],
                    "step_name":              step["step_name"],
                    "description":            step.get("description"),
                    "dept_name":              step["dept_name"],
                    "dept_code":              step["dept_code"],
                    "department_id":          str(step["department_id"]),
                    "expected_duration_hours":step["expected_duration_hours"],
                    "work_type_codes":        step["work_type_codes"] or [],
                    "is_optional":            step["is_optional"],
                    "requires_tender":        step["requires_tender"],
                }
                for step in steps
            ],
        })

    return result


# ── create_workflow_from_approval ─────────────────────────────────

def create_workflow_from_approval(
    db: Session,
    *,
    complaint_id: str,
    template_id: str,
    official_id: str,
    city_id: str,
    edited_steps: Optional[List[Dict]] = None,
    edit_reason: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Creates a workflow_instance from a template approval.

    Correct flow:
      1. Resolve complaint → infra_node_id, jurisdiction_id
      2. If edited → create variant template + version + steps
      3. Get active version → version_id
      4. Insert workflow_instances (infra_node_id NOT complaint_id)
      5. Insert workflow_complaints junction row
      6. Update complaints.workflow_instance_id
      7. Insert workflow_step_instances per step
      8. Create one task per step
      9. Bump template.times_used
    """
    was_edited = bool(edited_steps and edit_reason)

    # 1. Resolve complaint
    complaint = db.execute(
        text("""
            SELECT id, infra_node_id, jurisdiction_id, title, priority, complaint_number
            FROM complaints WHERE id = CAST(:cid AS uuid)
        """),
        {"cid": complaint_id},
    ).mappings().first()

    if not complaint:
        raise ValueError(f"Complaint {complaint_id} not found")

    infra_node_id   = str(complaint["infra_node_id"]) if complaint["infra_node_id"] else None
    jurisdiction_id = str(complaint["jurisdiction_id"]) if complaint["jurisdiction_id"] else None

    if not infra_node_id:
        raise ValueError("Complaint has no infra_node_id — cannot create workflow_instance")

    actual_template_id = template_id
    actual_version_id  = None

    # 2. If edited → create variant template + new version
    if was_edited:
        orig = db.execute(
            text("""
                SELECT name, description, situation_summary,
                       situation_keywords, situation_infra_codes
                FROM workflow_templates WHERE id = CAST(:id AS uuid)
            """),
            {"id": template_id},
        ).mappings().first()

        if not orig:
            raise ValueError(f"Template {template_id} not found")

        new_template_id = str(_uuid.uuid4())
        new_version_id  = str(_uuid.uuid4())

        db.execute(
            text("""
                INSERT INTO workflow_templates (
                    id, city_id, name, description,
                    situation_summary, situation_keywords, situation_infra_codes,
                    times_used, source_complaint_ids, created_by
                ) VALUES (
                    CAST(:id   AS uuid), CAST(:city AS uuid),
                    :name, :desc, :sit_sum, :sit_kw, :sit_ic,
                    1, ARRAY[CAST(:cid AS uuid)],
                    CAST(:uid  AS uuid)
                )
            """),
            {
                "id": new_template_id, "city": city_id,
                "name": f"{orig['name']} (Edited)", "desc": orig["description"],
                "sit_sum": orig["situation_summary"],
                "sit_kw":  orig["situation_keywords"] or [],
                "sit_ic":  orig["situation_infra_codes"] or [],
                "cid": complaint_id, "uid": official_id,
            },
        )

        db.execute(
            text("""
                INSERT INTO workflow_template_versions (
                    id, template_id, city_id, version, is_active, is_latest_version,
                    notes, created_by
                ) VALUES (
                    CAST(:id  AS uuid), CAST(:tid AS uuid), CAST(:cid AS uuid),
                    1, TRUE, TRUE, :notes, CAST(:uid AS uuid)
                )
            """),
            {
                "id": new_version_id, "tid": new_template_id, "cid": city_id,
                "notes": f"Edited from template {template_id}. Reason: {edit_reason}",
                "uid": official_id,
            },
        )

        for step in (edited_steps or []):
            db.execute(
                text("""
                    INSERT INTO workflow_template_steps (
                        id, version_id, step_number, department_id,
                        step_name, description, expected_duration_hours,
                        work_type_codes, is_optional, requires_tender
                    ) VALUES (
                        CAST(:id  AS uuid), CAST(:vid AS uuid), :num, CAST(:did AS uuid),
                        :sname, :desc, :dur_hrs, :wtc, :optional, :tender
                    )
                """),
                {
                    "id": str(_uuid.uuid4()), "vid": new_version_id,
                    "num": step["step_number"],
                    "did": step["department_id"],
                    "sname": step["step_name"],
                    "desc": step.get("description", ""),
                    "dur_hrs": step.get("expected_duration_hours", 24),
                    "wtc": step.get("work_type_codes", []),
                    "optional": step.get("is_optional", False),
                    "tender": step.get("requires_tender", False),
                },
            )

        actual_template_id = new_template_id
        actual_version_id  = new_version_id

    # 3. Get active version
    if not actual_version_id:
        ver = _get_latest_version(db, actual_template_id)
        if not ver:
            raise ValueError(f"No active version for template {actual_template_id}")
        actual_version_id = str(ver["id"])

    steps_source = _get_steps_for_version(db, actual_version_id)
    total_steps  = len(steps_source)
    if total_steps == 0:
        raise ValueError("Template version has no steps")

    # 4. Create workflow_instance
    instance_id = str(_uuid.uuid4())
    db.execute(
        text("""
            INSERT INTO workflow_instances (
                id, infra_node_id, template_id, version_id, jurisdiction_id,
                status, mode, current_step_number, total_steps, created_by
            ) VALUES (
                CAST(:id  AS uuid), CAST(:nid AS uuid),
                CAST(:tid AS uuid), CAST(:vid AS uuid), CAST(:jid AS uuid),
                'active', 'normal', 1, :total, CAST(:uid AS uuid)
            )
        """),
        {
            "id": instance_id, "nid": infra_node_id,
            "tid": actual_template_id, "vid": actual_version_id,
            "jid": jurisdiction_id, "total": total_steps, "uid": official_id,
        },
    )

    # 5. Link complaint via junction table
    db.execute(
        text("""
            INSERT INTO workflow_complaints (workflow_instance_id, complaint_id)
            VALUES (CAST(:wid AS uuid), CAST(:cid AS uuid))
            ON CONFLICT DO NOTHING
        """),
        {"wid": instance_id, "cid": complaint_id},
    )

    # 6. Update complaints.workflow_instance_id + status
    db.execute(
        text("""
            UPDATE complaints
               SET workflow_instance_id = CAST(:wid AS uuid),
                   status               = 'workflow_started',
                   updated_at           = NOW()
             WHERE id = CAST(:cid AS uuid)
        """),
        {"wid": instance_id, "cid": complaint_id},
    )

    # 7 + 8. Create step instances + tasks
    for step in steps_source:
        si_id      = str(_uuid.uuid4())
        is_first   = step["step_number"] == 1
        step_status= "in_progress" if is_first else "pending"

        db.execute(
            text(f"""
                INSERT INTO workflow_step_instances (
                    id, workflow_instance_id, template_step_id,
                    step_number, department_id, step_name,
                    status, assigned_official_id,
                    unlocked_at
                ) VALUES (
                    CAST(:id   AS uuid), CAST(:wid  AS uuid), CAST(:tsid AS uuid),
                    :num,   CAST(:did  AS uuid), :sname,
                    :status, CAST(:oid AS uuid),
                    {'NOW()' if is_first else 'NULL'}
                )
            """),
            {
                "id": si_id, "wid": instance_id, "tsid": str(step["id"]),
                "num": step["step_number"], "did": str(step["department_id"]),
                "sname": step["step_name"], "status": step_status, "oid": official_id,
            },
        )

        task_number = db.execute(text("SELECT fn_generate_task_number('DEL')")).scalar()
        due_hours   = step["expected_duration_hours"] or 48

        db.execute(
            text("""
                INSERT INTO tasks (
                    id, task_number, workflow_step_instance_id, complaint_id,
                    department_id, jurisdiction_id, assigned_official_id,
                    title, description, status, priority, due_at
                ) VALUES (
                    CAST(:id   AS uuid), :tnum, CAST(:wsid AS uuid),
                    CAST(:cid  AS uuid), CAST(:did  AS uuid), CAST(:jid  AS uuid),
                    CAST(:oid  AS uuid), :title, :desc, :status, :priority,
                    NOW() + (:dur || ' hours')::INTERVAL
                )
            """),
            {
                "id": str(_uuid.uuid4()), "tnum": task_number, "wsid": si_id,
                "cid": complaint_id, "did": str(step["department_id"]),
                "jid": jurisdiction_id, "oid": official_id,
                "title": f"Step {step['step_number']}: {step['step_name']}",
                "desc":  step.get("description") or "",
                "status": "accepted" if is_first else "pending",
                "priority": complaint["priority"] or "normal",
                "dur": str(due_hours),
            },
        )

    # 9. Bump template usage
    db.execute(
        text("""
            UPDATE workflow_templates
               SET times_used           = times_used + 1,
                   last_used_at         = NOW(),
                   source_complaint_ids = array_append(
                       COALESCE(source_complaint_ids, '{}'), CAST(:cid AS uuid)
                   )
             WHERE id = CAST(:tid AS uuid)
        """),
        {"tid": template_id, "cid": complaint_id},
    )

    db.commit()
    logger.info(
        "workflow_instance=%s complaint=%s template=%s version=%s edited=%s steps=%d",
        instance_id, complaint_id, actual_template_id, actual_version_id, was_edited, total_steps,
    )

    return {
        "workflow_instance_id": instance_id,
        "template_id":          actual_template_id,
        "version_id":           actual_version_id,
        "was_edited":           was_edited,
        "total_steps":          total_steps,
        "original_template_id": template_id,
    }

# ── suggest_workflows_for_node ────────────────────────────────────
# Primary infra-node-centric workflow suggestion.
# Uses the node's stored AI summary as context — no per-complaint fetch needed.

def suggest_workflows_for_node(
    db: Session,
    *,
    infra_node_id: str,
    city_id: str,
) -> Dict[str, Any]:
    """
    Returns workflow suggestions for an infra node, driven by its AI summary.

    Returns dict with keys:
      suggestions         — list of top-3 template suggestions (same format as suggest_workflows)
      has_active_workflow — bool
      infra_node_id
      cluster_summary     — the node's stored AI summary
      cluster_severity
      open_complaint_count
    """
    node = db.execute(
        text("""
            SELECT n.id, n.cluster_ai_summary, n.cluster_severity,
                   n.cluster_major_themes, n.total_complaint_count,
                   it.code AS infra_type_code,
                   (SELECT COUNT(*) FROM complaints c2
                    WHERE c2.infra_node_id = n.id AND c2.is_deleted = FALSE
                      AND c2.status NOT IN ('resolved','closed','rejected')
                   ) AS open_complaint_count
            FROM infra_nodes n
            JOIN infra_types it ON it.id = n.infra_type_id
            WHERE n.id = CAST(:nid AS uuid) AND n.is_deleted = FALSE
        """),
        {"nid": infra_node_id},
    ).mappings().first()

    if not node:
        raise ValueError(f"Infra node {infra_node_id} not found")

    # Build a rich context string from the stored AI summary
    node_summary = node["cluster_ai_summary"] or ""
    if node["cluster_major_themes"]:
        node_summary += " Key themes: " + ", ".join(node["cluster_major_themes"])

    # If no summary yet, fall back to fetching a complaint title
    if not node_summary:
        fallback = db.execute(
            text("""
                SELECT title, description FROM complaints
                WHERE infra_node_id = CAST(:nid AS uuid) AND is_deleted = FALSE
                ORDER BY created_at DESC LIMIT 1
            """),
            {"nid": infra_node_id},
        ).mappings().first()
        if fallback:
            node_summary = f"{fallback['title']}: {(fallback['description'] or '')[:200]}"

    # Check for existing active workflow
    active_wf = db.execute(
        text("""
            SELECT id FROM workflow_instances
            WHERE infra_node_id = CAST(:nid AS uuid) AND status = 'active'
            LIMIT 1
        """),
        {"nid": infra_node_id},
    ).first()

    # Infer priority from severity
    severity = node["cluster_severity"] or "medium"
    priority = "high" if severity in ("high", "critical") else "normal"

    # Use existing suggest_workflows with node-derived context
    suggestions = suggest_workflows(
        db,
        complaint_id=None,          # not needed — we have node summary
        city_id=city_id,
        infra_type_code=node["infra_type_code"] or "GENERAL",
        complaint_summary=node_summary,
        priority=priority,
        is_repeat=int(node["total_complaint_count"] or 0) > 1,
    )

    return {
        "suggestions":          suggestions,
        "has_active_workflow":  bool(active_wf),
        "active_workflow_id":   str(active_wf[0]) if active_wf else None,
        "infra_node_id":        infra_node_id,
        "cluster_summary":      node["cluster_ai_summary"],
        "cluster_severity":     node["cluster_severity"],
        "open_complaint_count": int(node["open_complaint_count"] or 0),
    }


# ── create_workflow_for_infra_node ────────────────────────────────
# Infra-node-level workflow creation.
# Bulk-links ALL open complaints to ONE workflow instance.

def create_workflow_for_infra_node(
    db: Session,
    *,
    infra_node_id: str,
    template_id: str,
    official_id: str,
    city_id: str,
    edited_steps: Optional[List[Dict]] = None,
    edit_reason:  Optional[str]        = None,
) -> Dict[str, Any]:
    """
    Creates a workflow_instance tied to the infra node (not a single complaint).

    Key differences from create_workflow_from_approval:
      1. Takes infra_node_id directly — no complaint lookup needed.
      2. Bulk-links ALL open unworkflowed complaints via workflow_complaints.
      3. Tasks are created once per step with the primary complaint for location.
      4. Returns complaints_linked count.
    """
    was_edited = bool(edited_steps and edit_reason)

    # 1. Resolve node + jurisdiction
    node = db.execute(
        text("""
            SELECT id, jurisdiction_id
            FROM infra_nodes
            WHERE id = CAST(:nid AS uuid) AND is_deleted = FALSE
        """),
        {"nid": infra_node_id},
    ).mappings().first()

    if not node:
        raise ValueError(f"Infra node {infra_node_id} not found")

    jurisdiction_id = str(node["jurisdiction_id"]) if node["jurisdiction_id"] else None

    # 2. Find open complaints to link (all without an active workflow)
    open_complaints = db.execute(
        text("""
            SELECT id, priority FROM complaints
            WHERE infra_node_id = CAST(:nid AS uuid)
              AND is_deleted = FALSE
              AND workflow_instance_id IS NULL
              AND status NOT IN ('resolved', 'closed', 'rejected')
            ORDER BY
                CASE priority WHEN 'emergency' THEN 1 WHEN 'critical' THEN 2
                    WHEN 'high' THEN 3 ELSE 4 END,
                created_at ASC
        """),
        {"nid": infra_node_id},
    ).mappings().all()

    # Primary complaint = highest-priority open complaint (used for task location)
    primary_complaint_id = str(open_complaints[0]["id"]) if open_complaints else None
    primary_priority = open_complaints[0]["priority"] if open_complaints else "normal"

    actual_template_id = template_id
    actual_version_id  = None

    # 3. Edited variant — create new template + version
    if was_edited:
        orig = db.execute(
            text("""
                SELECT name, description, situation_summary,
                       situation_keywords, situation_infra_codes
                FROM workflow_templates WHERE id = CAST(:id AS uuid)
            """),
            {"id": template_id},
        ).mappings().first()

        if not orig:
            raise ValueError(f"Template {template_id} not found")

        new_template_id = str(_uuid.uuid4())
        new_version_id  = str(_uuid.uuid4())

        db.execute(
            text("""
                INSERT INTO workflow_templates (
                    id, city_id, name, description,
                    situation_summary, situation_keywords, situation_infra_codes,
                    times_used, source_complaint_ids, created_by
                ) VALUES (
                    CAST(:id   AS uuid), CAST(:city AS uuid),
                    :name, :desc, :sit_sum, :sit_kw, :sit_ic,
                    1, ARRAY[]::uuid[],
                    CAST(:uid  AS uuid)
                )
            """),
            {
                "id": new_template_id, "city": city_id,
                "name": f"{orig['name']} (Edited)", "desc": orig["description"],
                "sit_sum": orig["situation_summary"],
                "sit_kw":  orig["situation_keywords"] or [],
                "sit_ic":  orig["situation_infra_codes"] or [],
                "uid": official_id,
            },
        )

        db.execute(
            text("""
                INSERT INTO workflow_template_versions (
                    id, template_id, city_id, version, is_active, is_latest_version,
                    notes, created_by
                ) VALUES (
                    CAST(:id  AS uuid), CAST(:tid AS uuid), CAST(:cid AS uuid),
                    1, TRUE, TRUE, :notes, CAST(:uid AS uuid)
                )
            """),
            {
                "id": new_version_id, "tid": new_template_id, "cid": city_id,
                "notes": f"Edited from template {template_id}. Reason: {edit_reason}",
                "uid": official_id,
            },
        )

        for step in (edited_steps or []):
            db.execute(
                text("""
                    INSERT INTO workflow_template_steps (
                        id, version_id, step_number, department_id,
                        step_name, description, expected_duration_hours,
                        work_type_codes, is_optional, requires_tender
                    ) VALUES (
                        CAST(:id  AS uuid), CAST(:vid AS uuid), :num, CAST(:did AS uuid),
                        :sname, :desc, :dur_hrs, :wtc, :optional, :tender
                    )
                """),
                {
                    "id": str(_uuid.uuid4()), "vid": new_version_id,
                    "num": step["step_number"],
                    "did": step["department_id"],
                    "sname": step["step_name"],
                    "desc": step.get("description", ""),
                    "dur_hrs": step.get("expected_duration_hours", 24),
                    "wtc": step.get("work_type_codes", []),
                    "optional": step.get("is_optional", False),
                    "tender": step.get("requires_tender", False),
                },
            )

        actual_template_id = new_template_id
        actual_version_id  = new_version_id

    # 4. Resolve active version
    if not actual_version_id:
        ver = _get_latest_version(db, actual_template_id)
        if not ver:
            raise ValueError(f"No active version for template {actual_template_id}")
        actual_version_id = str(ver["id"])

    steps_source = _get_steps_for_version(db, actual_version_id)
    total_steps  = len(steps_source)
    if total_steps == 0:
        raise ValueError("Template version has no steps")

    # 5. Create workflow_instance (infra_node_id — not complaint_id)
    instance_id = str(_uuid.uuid4())
    db.execute(
        text("""
            INSERT INTO workflow_instances (
                id, infra_node_id, template_id, version_id, jurisdiction_id,
                status, mode, current_step_number, total_steps, created_by
            ) VALUES (
                CAST(:id  AS uuid), CAST(:nid AS uuid),
                CAST(:tid AS uuid), CAST(:vid AS uuid), CAST(:jid AS uuid),
                'active', 'normal', 1, :total, CAST(:uid AS uuid)
            )
        """),
        {
            "id": instance_id, "nid": infra_node_id,
            "tid": actual_template_id, "vid": actual_version_id,
            "jid": jurisdiction_id, "total": total_steps, "uid": official_id,
        },
    )

    # 6. Bulk-link ALL open complaints to this workflow
    for row in open_complaints:
        cid = str(row["id"])
        db.execute(
            text("""
                INSERT INTO workflow_complaints (workflow_instance_id, complaint_id)
                VALUES (CAST(:wid AS uuid), CAST(:cid AS uuid))
                ON CONFLICT DO NOTHING
            """),
            {"wid": instance_id, "cid": cid},
        )
        db.execute(
            text("""
                UPDATE complaints
                   SET workflow_instance_id = CAST(:wid AS uuid),
                       status               = 'workflow_started',
                       updated_at           = NOW()
                 WHERE id = CAST(:cid AS uuid)
            """),
            {"wid": instance_id, "cid": cid},
        )

    # 7 + 8. Create step instances + one task per step
    for step in steps_source:
        si_id    = str(_uuid.uuid4())
        is_first = step["step_number"] == 1
        step_status = "in_progress" if is_first else "pending"

        db.execute(
            text(f"""
                INSERT INTO workflow_step_instances (
                    id, workflow_instance_id, template_step_id,
                    step_number, department_id, step_name,
                    status, assigned_official_id,
                    unlocked_at
                ) VALUES (
                    CAST(:id   AS uuid), CAST(:wid  AS uuid), CAST(:tsid AS uuid),
                    :num,   CAST(:did  AS uuid), :sname,
                    :status, CAST(:oid AS uuid),
                    {'NOW()' if is_first else 'NULL'}
                )
            """),
            {
                "id": si_id, "wid": instance_id, "tsid": str(step["id"]),
                "num": step["step_number"], "did": str(step["department_id"]),
                "sname": step["step_name"], "status": step_status, "oid": official_id,
            },
        )

        task_number = db.execute(text("SELECT fn_generate_task_number('DEL')")).scalar()
        due_hours   = step["expected_duration_hours"] or 48

        db.execute(
            text("""
                INSERT INTO tasks (
                    id, task_number, workflow_step_instance_id, complaint_id,
                    department_id, jurisdiction_id, assigned_official_id,
                    title, description, status, priority, due_at
                ) VALUES (
                    CAST(:id   AS uuid), :tnum, CAST(:wsid AS uuid),
                    CAST(:cid  AS uuid), CAST(:did  AS uuid), CAST(:jid  AS uuid),
                    CAST(:oid  AS uuid), :title, :desc, :status, :priority,
                    NOW() + (:dur || ' hours')::INTERVAL
                )
            """),
            {
                "id": str(_uuid.uuid4()), "tnum": task_number, "wsid": si_id,
                "cid": primary_complaint_id,        # location source; may be None
                "did": str(step["department_id"]),
                "jid": jurisdiction_id, "oid": official_id,
                "title": f"Step {step['step_number']}: {step['step_name']}",
                "desc":  step.get("description") or "",
                "status": "accepted" if is_first else "pending",
                "priority": primary_priority,
                "dur": str(due_hours),
            },
        )

    # 9. Bump template usage
    db.execute(
        text("""
            UPDATE workflow_templates
               SET times_used   = times_used + 1,
                   last_used_at = NOW()
             WHERE id = CAST(:tid AS uuid)
        """),
        {"tid": template_id},
    )

    db.commit()
    logger.info(
        "Node workflow created: instance=%s node=%s template=%s steps=%d complaints_linked=%d",
        instance_id, infra_node_id, actual_template_id, total_steps, len(open_complaints),
    )

    return {
        "workflow_instance_id": instance_id,
        "template_id":          actual_template_id,
        "version_id":           actual_version_id,
        "was_edited":           was_edited,
        "total_steps":          total_steps,
        "complaints_linked":    len(open_complaints),
        "original_template_id": template_id,
    }