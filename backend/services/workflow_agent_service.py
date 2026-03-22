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
from vertexai.generative_models import GenerationConfig, GenerativeModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from config import settings

logger = logging.getLogger(__name__)

_vertex_initialized = False


def _ensure_vertex():
    global _vertex_initialized
    if _vertex_initialized:
        return
    vertexai.init(project=settings.GCS_PROJECT_ID, location=settings.VERTEX_AI_LOCATION)
    _vertex_initialized = True


def _call_gemini_json(prompt: str, max_tokens: int = 600) -> str:
    _ensure_vertex()
    model = GenerativeModel(
        "gemini-2.5-flash-preview-05-20",
        system_instruction="Output only valid JSON. No markdown fences, no explanation, no prose.",
        generation_config=GenerationConfig(temperature=0.1, max_output_tokens=max_tokens),
    )
    return (model.generate_content(prompt).text or "").strip()


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
    Returns top-3 workflow template suggestions with Gemini ranking.
    Steps are fetched via version_id (not template_id).
    """
    candidates = db.execute(
        text("""
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
            WHERE wt.city_id = CAST(:city_id AS uuid)
            GROUP BY wt.id, wt.name, wt.description,
                     wt.situation_summary, wt.situation_keywords,
                     wt.situation_infra_codes, wt.times_used, wt.avg_completion_days,
                     wtv.id
            ORDER BY wt.times_used DESC, wt.avg_completion_days ASC NULLS LAST
            LIMIT 12
        """),
        {"city_id": city_id},
    ).mappings().all()

    if not candidates:
        return []

    template_map = {str(c["id"]): c for c in candidates}
    version_map  = {str(c["id"]): str(c["version_id"]) for c in candidates}

    template_list = "\n".join(
        f'  id="{c["id"]}" name="{c["name"]}" '
        f'situation="{c["situation_summary"] or "General"}" '
        f'infra_codes={c["situation_infra_codes"] or []} '
        f'steps={c["step_count"]} used={c["times_used"]} avg_days={c["avg_completion_days"]}'
        for c in candidates
    )

    prompt = f"""Select the TOP 3 most suitable workflow templates for this complaint.

NEW COMPLAINT:
  Summary:  {complaint_summary}
  Infra:    {infra_type_code}
  Priority: {priority}
  Repeat:   {is_repeat}

AVAILABLE TEMPLATES:
{template_list}

Return a JSON array (top 3 only):
[
  {{
    "template_id": "<uuid from list>",
    "match_score": 0.95,
    "match_reason": "One sentence explaining why this fits",
    "recommended_priority": 1
  }}
]"""

    suggestions = []
    try:
        suggestions = _parse_json(_call_gemini_json(prompt))
        if not isinstance(suggestions, list):
            suggestions = []
    except Exception as exc:
        logger.error("Workflow suggestion Gemini failed: %s", exc)
        suggestions = [
            {"template_id": str(c["id"]), "match_score": 0.7,
             "match_reason": "Most frequently used template", "recommended_priority": i + 1}
            for i, c in enumerate(candidates[:3])
        ]

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