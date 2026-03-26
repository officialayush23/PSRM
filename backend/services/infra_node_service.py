"""
Infra Node AI Summary Service.

Summary is stored as a JSON requirements object — not plain text.
Shape stored in cluster_ai_summary (Text column, JSON-encoded string):

{
  "requirements": [
    {"issue": "Pothole repair needed on main stretch", "severity": "high", "count": 3},
    {"issue": "Drainage clearing required near junction", "severity": "medium", "count": 1}
  ],
  "overall_severity": "high",
  "themes": ["potholes", "drainage", "road damage"],
  "brief": "Citizens repeatedly report pothole damage and blocked drainage at this location."
}

Incremental strategy (always 1 Gemini call, never re-fetch complaints):
  - No existing summary  →  bootstrap: generate requirements from this complaint only
  - Summary exists       →  incremental: old requirements + new complaint → updated requirements

cluster_major_themes and cluster_severity are also written separately
so map queries (which don't parse JSON) still work.
"""

import json
import logging
from typing import Dict, List, Optional

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


# ── Vertex init ───────────────────────────────────────────────────────────────

def _ensure_vertex():
    global _vertex_initialized
    if _vertex_initialized:
        return
    vertexai.init(
        project=settings.GCS_PROJECT_ID,
        location=settings.VERTEX_AI_LOCATION,
    )
    _vertex_initialized = True


def _call_gemini(prompt: str, max_tokens: int = 500) -> str:
    try:
        _ensure_vertex()
        model = GenerativeModel(
            "gemini-2.5-flash",
            system_instruction=(
                "You are a civic infrastructure analyst. "
                "Output only valid JSON. No markdown fences, no explanation."
            ),
            generation_config=GenerationConfig(temperature=0.1, max_output_tokens=max_tokens),
        )
        return (model.generate_content(prompt, safety_settings=_SAFETY_SETTINGS).text or "").strip()
    except Exception as exc:
        logger.error("Gemini call failed in infra_node_service: %s", exc)
        return ""


def _parse_json(raw: str) -> Optional[dict]:
    if not raw:
        return None
    clean = raw.strip()
    if "```" in clean:
        parts = clean.split("```")
        clean = parts[1] if len(parts) > 1 else parts[0]
        if clean.lstrip().startswith("json"):
            clean = clean.lstrip()[4:]
    try:
        return json.loads(clean.strip())
    except json.JSONDecodeError as exc:
        logger.error("JSON parse failed: %s — raw: %.200s", exc, raw)
        return None


# ── DB write ──────────────────────────────────────────────────────────────────

def _write_requirements(db: Session, infra_node_id: str, parsed: dict) -> None:
    """
    Writes the requirements JSON to infra_nodes.
    cluster_ai_summary  → full JSON string (for API consumers)
    cluster_major_themes→ themes array (for map queries without JSON parsing)
    cluster_severity    → severity string (same reason)
    """
    themes   = parsed.get("themes", [])
    severity = parsed.get("overall_severity", parsed.get("severity", "medium"))

    db.execute(
        text("""
            UPDATE infra_nodes
               SET cluster_ai_summary   = :summary_json,
                   cluster_major_themes = :themes,
                   cluster_severity     = :severity,
                   cluster_summary_at   = NOW(),
                   updated_at           = NOW()
             WHERE id = CAST(:nid AS uuid)
        """),
        {
            "nid":          infra_node_id,
            "summary_json": json.dumps(parsed, ensure_ascii=False),
            "themes":       themes,
            "severity":     severity,
        },
    )
    db.commit()
    logger.info(
        "Requirements saved for node=%s severity=%s themes=%s",
        infra_node_id, severity, themes,
    )


# ── Bootstrap ─────────────────────────────────────────────────────────────────

_BOOTSTRAP_PROMPT = """\
A civic infrastructure complaint has just been filed at a location.

Complaint:
{complaint_text}

Extract the citizen's requirements (what needs to be fixed/done) from this complaint.

Respond with only valid JSON:
{{
  "requirements": [
    {{"issue": "clear description of what the citizen needs done", "severity": "low|medium|high|critical", "count": 1}}
  ],
  "overall_severity": "low|medium|high|critical",
  "themes": ["theme1", "theme2"],
  "brief": "1-2 sentence summary of the situation at this location"
}}"""


def _bootstrap(db: Session, infra_node_id: str, complaint_text: str) -> Dict:
    raw    = _call_gemini(_BOOTSTRAP_PROMPT.format(complaint_text=complaint_text), max_tokens=400)
    parsed = _parse_json(raw) if raw else None

    if not parsed:
        logger.warning("Bootstrap failed for node=%s", infra_node_id)
        return {"status": "ai_failed"}

    _write_requirements(db, infra_node_id, parsed)
    return {"status": "success", "mode": "bootstrap", **parsed}


# ── Incremental ───────────────────────────────────────────────────────────────

_INCREMENTAL_PROMPT = """\
You maintain a running requirements list for a civic infrastructure location.

Current requirements:
{existing_json}

New complaint just filed:
{complaint_text}

Update the requirements list:
- If the new complaint describes the same issue as an existing requirement, increment its count.
- If it describes a new issue, add it as a new requirement entry.
- Update overall_severity if this complaint changes the urgency.
- Keep brief to 1-2 sentences reflecting the full situation.

Respond with only valid JSON (same structure as input):
{{
  "requirements": [
    {{"issue": "...", "severity": "low|medium|high|critical", "count": <number>}}
  ],
  "overall_severity": "low|medium|high|critical",
  "themes": ["theme1", "theme2", "theme3"],
  "brief": "updated 1-2 sentence summary"
}}"""


def _incremental(
    db: Session,
    infra_node_id: str,
    existing_json: str,
    complaint_text: str,
) -> Dict:
    prompt = _INCREMENTAL_PROMPT.format(
        existing_json=existing_json,
        complaint_text=complaint_text,
    )
    raw    = _call_gemini(prompt, max_tokens=500)
    parsed = _parse_json(raw) if raw else None

    if not parsed:
        # Soft failure — keep existing, don't block ingest
        logger.warning(
            "Incremental update failed for node=%s, keeping existing requirements",
            infra_node_id,
        )
        return {"status": "ai_failed", "kept_existing": True}

    _write_requirements(db, infra_node_id, parsed)
    return {"status": "success", "mode": "incremental", **parsed}


# ── Public entry point ────────────────────────────────────────────────────────

def update_infra_node_summary(
    db: Session,
    infra_node_id: str,
    *,
    new_complaint_text: str,
) -> Dict:
    """
    Called after every complaint ingest.

    - No existing summary  →  bootstrap from this complaint alone
    - Summary exists       →  incremental (old requirements + new complaint)

    Never re-fetches all complaints. Always exactly 1 Gemini call.

    Args:
        db:                  SQLAlchemy session.
        infra_node_id:       UUID string.
        new_complaint_text:  "title: translated_description[:300]"  (from complaint_service)
    """
    row = db.execute(
        text("""
            SELECT cluster_ai_summary
            FROM infra_nodes
            WHERE id = CAST(:nid AS uuid) AND is_deleted = FALSE
        """),
        {"nid": infra_node_id},
    ).mappings().first()

    if not row:
        return {"status": "node_not_found"}

    existing = row["cluster_ai_summary"]

    if not existing:
        return _bootstrap(db, infra_node_id, new_complaint_text)
    else:
        return _incremental(db, infra_node_id, existing, new_complaint_text)


# ── Helper: parse stored requirements for API responses ──────────────────────

def parse_requirements(cluster_ai_summary: Optional[str]) -> Optional[dict]:
    """
    Safely parses the stored JSON requirements string.
    Returns the dict or None if empty / not yet generated.
    Use this in any API endpoint that returns node details.
    """
    if not cluster_ai_summary:
        return None
    try:
        return json.loads(cluster_ai_summary)
    except (json.JSONDecodeError, TypeError):
        # Legacy plain-text summary — wrap it so frontend doesn't break
        return {
            "requirements": [{"issue": cluster_ai_summary, "severity": "medium", "count": 1}],
            "overall_severity": "medium",
            "themes": [],
            "brief": cluster_ai_summary,
        }


# ── Admin: forced full rebuild from last 20 complaints ───────────────────────

def rebuild_summary_from_complaints(db: Session, infra_node_id: str) -> Dict:
    """
    Admin-only: forces full requirements rebuild from last 20 complaints.
    NOT called during normal ingest. Use only for data repair.
    Exposed via POST /admin/infra-nodes/{node_id}/rebuild-summary
    """
    complaints = db.execute(
        text("""
            SELECT title, translated_description, priority
            FROM complaints
            WHERE infra_node_id = CAST(:nid AS uuid) AND is_deleted = FALSE
            ORDER BY created_at DESC LIMIT 20
        """),
        {"nid": infra_node_id},
    ).mappings().all()

    if not complaints:
        return {"status": "no_complaints"}

    complaint_block = "\n".join(
        f"- [{c['priority']}] {c['title']}: {(c['translated_description'] or '')[:150]}"
        for c in complaints
    )

    prompt = f"""Extract citizen requirements from these complaints at a single infrastructure location:

{complaint_block}

Respond with only valid JSON:
{{
  "requirements": [
    {{"issue": "what citizens need done", "severity": "low|medium|high|critical", "count": <how many complaints mention this>}}
  ],
  "overall_severity": "low|medium|high|critical",
  "themes": ["theme1", "theme2", "theme3"],
  "brief": "1-2 sentence summary of all issues at this location"
}}"""

    raw    = _call_gemini(prompt, max_tokens=600)
    parsed = _parse_json(raw) if raw else None

    if not parsed:
        return {"status": "ai_failed"}

    _write_requirements(db, infra_node_id, parsed)
    return {"status": "success", "mode": "full_rebuild", **parsed}