# backend/services/mapping_service.py

import json
import logging
import time
import uuid as uuid_lib
from typing import Any, Dict, List, Optional

from groq import Groq
from sqlalchemy import text
from sqlalchemy.orm import Session

from config import settings

logger = logging.getLogger(__name__)

_groq_client: Groq | None = None


def _get_groq_client() -> Groq:
    global _groq_client
    if _groq_client is None:
        _groq_client = Groq(api_key=settings.GROQ_API_KEY)
    return _groq_client


# ─────────────────────────────────────────────────────────────────
# INFRA TYPE — find or create
# ─────────────────────────────────────────────────────────────────

def ensure_infra_type(
    db: Session,
    infra_type_id: str,
    *,
    fallback_name: str = "General Infrastructure",
    fallback_code: str = "GENERAL",
) -> Dict[str, str]:
    """
    Returns {id, name, code} for the given infra_type_id.

    If the ID does not exist in infra_types:
      - Tries to find an existing type with fallback_code.
      - If still not found, creates a minimal row and returns it.

    This is a safety net — in normal flow fn_ingest_complaint would
    have already rejected an unknown infra_type_id.  But if someone
    passes a new UUID from the frontend before the admin seeds it,
    we degrade gracefully instead of 500-ing.
    """
    # 1. Try the exact ID first
    row = db.execute(
        text("SELECT id, name, code FROM infra_types WHERE id = CAST(:id AS uuid)"),
        {"id": infra_type_id},
    ).mappings().first()

    if row:
        return {"id": str(row["id"]), "name": row["name"], "code": row["code"]}

    # 2. Try by fallback code
    row = db.execute(
        text("SELECT id, name, code FROM infra_types WHERE code = :code LIMIT 1"),
        {"code": fallback_code},
    ).mappings().first()

    if row:
        logger.warning(
            "infra_type_id=%s not found — using existing type code=%s id=%s",
            infra_type_id, row["code"], row["id"],
        )
        return {"id": str(row["id"]), "name": row["name"], "code": row["code"]}

    # 3. Create a minimal infra_type row
    new_id   = str(uuid_lib.uuid4())
    new_code = fallback_code.upper()[:30]
    new_name = fallback_name[:100]

    db.execute(
        text("""
            INSERT INTO infra_types (
                id, name, code,
                default_dept_ids, cluster_radius_meters, repeat_alert_years,
                metadata
            ) VALUES (
                CAST(:id AS uuid),
                :name,
                :code,
                '{}'::uuid[],
                50,
                3,
                '{"auto_created": true}'::jsonb
            )
            ON CONFLICT (code) DO NOTHING
        """),
        {"id": new_id, "name": new_name, "code": new_code},
    )

    # Re-fetch in case ON CONFLICT DO NOTHING hit an existing row
    row = db.execute(
        text("SELECT id, name, code FROM infra_types WHERE code = :code LIMIT 1"),
        {"code": new_code},
    ).mappings().first()

    result_id   = str(row["id"])   if row else new_id
    result_name = row["name"]      if row else new_name
    result_code = row["code"]      if row else new_code

    logger.info(
        "Auto-created infra_type: id=%s code=%s name=%s",
        result_id, result_code, result_name,
    )
    return {"id": result_id, "name": result_name, "code": result_code}


# ─────────────────────────────────────────────────────────────────
# INFRA NODE — note on creation
# ─────────────────────────────────────────────────────────────────
#
# infra_node find-or-create is handled INSIDE fn_ingest_complaint
# (the SQL function).  It uses geohash uniqueness + ST_DWithin
# proximity to find existing nodes and creates a new one if nothing
# is within cluster_radius_meters.
#
# What mapping_service needs to do here is zero — the node already
# exists by the time map_complaint_to_departments is called, because
# fn_ingest_complaint runs first and we flush before calling this.
#
# The only thing we expose here is a helper to look up infra_node
# details for logging / agent context.

def _get_infra_node_info(db: Session, infra_node_id: str) -> Dict[str, Any]:
    row = db.execute(
        text("""
            SELECT
                n.id,
                n.status,
                n.total_complaint_count,
                n.total_resolved_count,
                n.location_hash,
                it.name AS infra_type_name,
                it.code AS infra_type_code
            FROM infra_nodes n
            JOIN infra_types it ON it.id = n.infra_type_id
            WHERE n.id = CAST(:id AS uuid)
        """),
        {"id": infra_node_id},
    ).mappings().first()

    if not row:
        return {}

    return {
        "id":                    str(row["id"]),
        "status":                row["status"],
        "total_complaint_count": row["total_complaint_count"],
        "total_resolved_count":  row["total_resolved_count"],
        "infra_type_name":       row["infra_type_name"],
        "infra_type_code":       row["infra_type_code"],
    }


# ─────────────────────────────────────────────────────────────────
# STEP 1 — Authority resolution via DB function
# ─────────────────────────────────────────────────────────────────

def _resolve_authority(
    db: Session,
    lat: float,
    lng: float,
    city_id: str,
    infra_type_code: str,
    road_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Calls fn_route_complaint_authority (from ps_crm_ndmc_and_rules.sql).

    Algorithm (inside the SQL fn):
      STEP 1 — PWD road-class override
        If infra_type IN (ROAD, POTHOLE, FOOTPATH) AND road_name matches
        road_class_registry (NH / SH / arterial / flyover / bridge)
        → authority = PWD, confidence = 0.95

      STEP 2 — Spatial polygon lookup
        NDMC checked first (explicit polygon, no child wards)
        → MCD ward polygons (272 wards, most specific)
        → Cantonment boundary
        Confidence: 0.92 / 0.90 / 0.90

      STEP 3 — Infra-type fallback
        WATER_PIPE / SEWER → DJB (city-wide, no boundary)
        Everything else    → MCD (default city authority)
        Confidence: 0.70 / 0.50

    FIX: explicit VARCHAR casts required — psycopg2 passes Python
    None as type 'unknown' which confuses PostgreSQL's overload resolver.
    """
    row = db.execute(
        text("""
            SELECT
                r.authority_code,
                r.jurisdiction_id,
                r.routing_reason,
                r.confidence
            FROM fn_route_complaint_authority(
                ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geometry(POINT, 4326),
                CAST(:city_id         AS uuid),
                CAST(:infra_type_code AS VARCHAR(20)),
                CAST(:road_name       AS VARCHAR(200))
            ) r
        """),
        {
            "lat":             lat,
            "lng":             lng,
            "city_id":         city_id,
            "infra_type_code": infra_type_code,
            "road_name":       road_name,   # None becomes NULL::VARCHAR(200) — fine
        },
    ).mappings().first()

    if not row:
        return {
            "authority_code":  "MCD",
            "jurisdiction_id": None,
            "routing_reason":  "fn_route_complaint_authority returned nothing — fallback MCD",
            "confidence":      0.40,
        }

    return {
        "authority_code":  row["authority_code"],
        "jurisdiction_id": str(row["jurisdiction_id"]) if row["jurisdiction_id"] else None,
        "routing_reason":  row["routing_reason"],
        "confidence":      float(row["confidence"]),
    }


# ─────────────────────────────────────────────────────────────────
# STEP 2 — Load departments for the resolved authority
# ─────────────────────────────────────────────────────────────────

def _load_departments_for_authority(
    db: Session,
    city_id: str,
    authority_code: str,
) -> List[Dict[str, Any]]:
    """
    Returns departments belonging to the resolved authority.

    Seed data authority → jurisdiction mapping:
      MCD        → code = 'MCD'        (10000001-...)  9 depts
      NDMC       → code = 'NDMC'       (20000002-...)  no depts seeded → fallback to all
      PWD        → code = 'PWD'        (40000004-...)  PWD_ROADS dept
      DJB        → code = 'DJB'        (60000006-...)  DJB dept
      CANTONMENT → code = 'CANTONMENT' (30000003-...)  no depts seeded → fallback to all

    For MCD we include all depts whose jurisdiction.code = 'MCD' OR
    whose jurisdiction is a child zone of MCD (parent_id = MCD's id).
    This captures all 9 MCD departments regardless of which zone
    they're filed under.
    """
    rows = db.execute(
        text("""
            SELECT
                d.id,
                d.name,
                d.code,
                d.metadata         AS extra_meta,
                j.name             AS jurisdiction_name,
                j.code             AS jurisdiction_code
            FROM departments d
            JOIN jurisdictions j ON j.id = d.jurisdiction_id
            WHERE d.city_id = CAST(:city_id AS uuid)
              AND (
                    -- Direct authority match
                    j.code = :authority_code

                    -- MCD: include all depts under MCD parent or any MCD child zone
                    OR (
                        :authority_code = 'MCD'
                        AND j.id IN (
                            SELECT id FROM jurisdictions
                            WHERE city_id = CAST(:city_id AS uuid)
                              AND (
                                    code = 'MCD'
                                 OR parent_id = (
                                       SELECT id FROM jurisdictions
                                       WHERE city_id = CAST(:city_id AS uuid)
                                         AND code = 'MCD'
                                       LIMIT 1
                                    )
                              )
                        )
                    )
                  )
            ORDER BY d.name
        """),
        {"city_id": city_id, "authority_code": authority_code},
    ).mappings().all()

    # Fallback: NDMC / Cantonment have no depts seeded — use all city depts
    # so Groq can still pick the correct one (e.g. DJB for water in NDMC area)
    if not rows:
        logger.warning(
            "No departments found for authority=%s city=%s — loading all city depts as fallback",
            authority_code, city_id,
        )
        rows = db.execute(
            text("""
                SELECT
                    d.id, d.name, d.code,
                    d.metadata         AS extra_meta,
                    j.name             AS jurisdiction_name,
                    j.code             AS jurisdiction_code
                FROM departments d
                LEFT JOIN jurisdictions j ON j.id = d.jurisdiction_id
                WHERE d.city_id = CAST(:city_id AS uuid)
                ORDER BY d.name
            """),
            {"city_id": city_id},
        ).mappings().all()

    depts = []
    for row in rows:
        meta = row["extra_meta"] or {}
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except Exception:
                meta = {}

        depts.append({
            "id":                str(row["id"]),
            "name":              row["name"],
            "code":              row["code"],
            "groq_id":           meta.get("groq_dept_id", row["code"].lower()),
            "jurisdiction_name": row["jurisdiction_name"],
            "description":       meta.get("description", ""),
            "handles":           meta.get("handles", []),
            "sla_days":          meta.get("sla_days", {}),
            "urgency_boost":     meta.get("urgency_boost", False),
        })

    return depts


# ─────────────────────────────────────────────────────────────────
# STEP 3 — Build Groq prompt
# ─────────────────────────────────────────────────────────────────

def _build_groq_prompt(
    title: str,
    description: str,
    infra_type_name: str,
    infra_type_code: str,
    authority_code: str,
    jurisdiction_name: Optional[str],
    routing_reason: str,
    departments: List[Dict[str, Any]],
    infra_node_info: Dict[str, Any],
) -> str:
    dept_lines = "\n".join(
        f'  - id="{d["id"]}" code="{d["code"]}" '
        f'name="{d["name"]}" '
        f'handles={json.dumps(d["handles"])} '
        f'description="{d["description"]}"'
        + (f' [URGENT — fast SLA]' if d.get("urgency_boost") else "")
        for d in departments
    )

    node_context = ""
    if infra_node_info:
        node_context = (
            f"\nINFRA NODE CONTEXT:\n"
            f"  Status: {infra_node_info.get('status', 'unknown')}\n"
            f"  Total complaints on this node: {infra_node_info.get('total_complaint_count', 0)}\n"
            f"  Previously resolved: {infra_node_info.get('total_resolved_count', 0)}\n"
        )

    return f"""You are a Delhi municipal complaint routing agent for the {authority_code} authority.

A citizen has filed a civic complaint. Your task:
1. Identify ALL departments that MUST act on this complaint.
2. A single complaint can require MULTIPLE departments — always check.
   Example: "electric pole fell because a tree fell on it"
     → EM (electric pole repair) + HORT (tree removal) — both required.
   Example: "garbage piled near a blocked drain"
     → PH (garbage collection) + ENGG (drain unblocking) — both required.
   Example: "broken streetlight on Ring Road"
     → EM (streetlight) — PWD owns road but EM owns the light — only EM.
3. Only include departments that have ACTUAL WORK to do, not just awareness.

AUTHORITY RESOLVED: {authority_code}
ROUTING REASON: {routing_reason}
JURISDICTION: {jurisdiction_name or "city-wide"}
{node_context}
COMPLAINT:
  Title: {title}
  Description: {description}
  Infrastructure type: {infra_type_name} (code: {infra_type_code})

AVAILABLE DEPARTMENTS FOR {authority_code}:
{dept_lines}

STRICT OUTPUT RULES:
1. Return ONLY a valid JSON array. No prose, no markdown, no code fences.
2. Use only dept_id values from the list above — no invented IDs.
3. Only include departments with confidence >= 0.40.
4. Keep "reason" under 12 words.
5. Single responsible department → array with one item is correct.

OUTPUT FORMAT (JSON array only):
[
  {{"dept_id": "<uuid>", "dept_code": "<code>", "confidence": 0.95, "reason": "<why this dept must act>"}},
  ...
]"""


# ─────────────────────────────────────────────────────────────────
# MAIN ENTRY POINT
# ─────────────────────────────────────────────────────────────────

def map_complaint_to_departments(
    db: Session,
    *,
    complaint_id: str,
    city_id: str,
    title: str,
    description: str,
    infra_type_id: str,
    infra_type_code: str,
    infra_type_name: str,
    infra_node_id: Optional[str],
    jurisdiction_name: Optional[str],
    lat: float,
    lng: float,
    road_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Full mapping pipeline:

      1.  ensure_infra_type — creates infra_type row if it doesn't exist
      2.  _get_infra_node_info — loads node context for Groq prompt
      3.  _resolve_authority — calls fn_route_complaint_authority (DB)
            NDMC / MCD / PWD / DJB resolved via PostGIS + road_class_registry
      4.  _load_departments_for_authority — filters to relevant depts
      5.  Groq (llama-3.3-70b) — maps complaint to 1-N departments
      6.  Validate Groq output — reject unknown IDs, enforce conf >= 0.40
      7.  Fallback — use infra_type.default_dept_ids if Groq returns nothing
      8.  UPDATE complaints.agent_suggested_dept_ids
      9.  INSERT agent_logs (input, output, confidence, latency, tokens)
      10. INSERT domain_events DEPT_MAPPED

    Tables written:
      complaints            (agent_suggested_dept_ids updated)
      agent_logs            (one row per complaint)
      domain_events         (DEPT_MAPPED event)
    """
    start_ms = int(time.time() * 1000)

    # ── 1. Ensure infra_type exists (auto-create if needed) ───────
    infra_type = ensure_infra_type(
        db,
        infra_type_id,
        fallback_name=infra_type_name or "General Infrastructure",
        fallback_code=infra_type_code or "GENERAL",
    )
    # Use the confirmed values (may differ if we fell back to an existing type)
    infra_type_code = infra_type["code"]
    infra_type_name = infra_type["name"]

    # ── 2. Load infra_node context for richer Groq prompt ─────────
    infra_node_info: Dict[str, Any] = {}
    if infra_node_id:
        infra_node_info = _get_infra_node_info(db, infra_node_id)

    # ── 3. Resolve authority ──────────────────────────────────────
    authority      = _resolve_authority(db, lat, lng, city_id, infra_type_code, road_name)
    authority_code = authority["authority_code"]
    routing_reason = authority["routing_reason"]
    routing_conf   = authority["confidence"]

    logger.info(
        "Complaint %s → authority=%s conf=%.2f reason=%s",
        complaint_id, authority_code, routing_conf, routing_reason,
    )

    # ── 4. Load departments for this authority ────────────────────
    departments = _load_departments_for_authority(db, city_id, authority_code)
    if not departments:
        logger.error(
            "Zero departments for city=%s authority=%s — skipping Groq",
            city_id, authority_code,
        )
        return {
            "dept_ids":       [],
            "mappings":       [],
            "authority":      authority_code,
            "avg_confidence": 0.0,
            "routing_reason": routing_reason,
        }

    # ── 5. Call Groq ──────────────────────────────────────────────
    prompt      = _build_groq_prompt(
        title=title,
        description=description,
        infra_type_name=infra_type_name,
        infra_type_code=infra_type_code,
        authority_code=authority_code,
        jurisdiction_name=jurisdiction_name,
        routing_reason=routing_reason,
        departments=departments,
        infra_node_info=infra_node_info,
    )

    raw_output:  str          = ""
    tokens_used: Optional[int] = None
    mappings:    List[Dict]   = []
    groq_error:  Optional[str] = None

    try:
        client   = _get_groq_client()
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role":    "system",
                    "content": "You output ONLY valid JSON arrays. No markdown fences, no explanation, no prose.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            max_tokens=512,
        )
        raw_output  = response.choices[0].message.content.strip()
        tokens_used = response.usage.total_tokens if response.usage else None
    except Exception as exc:
        groq_error = str(exc)
        logger.error("Groq call failed for complaint %s: %s", complaint_id, exc)

    latency_ms = int(time.time() * 1000) - start_ms

    # ── 6. Parse Groq JSON response ───────────────────────────────
    if raw_output and not groq_error:
        try:
            clean = raw_output.strip()
            if "```" in clean:
                # strip markdown fences if model disobeyed instructions
                parts = clean.split("```")
                clean = parts[1] if len(parts) > 1 else parts[0]
                if clean.lstrip().startswith("json"):
                    clean = clean.lstrip()[4:]
            parsed = json.loads(clean.strip())
            if isinstance(parsed, list):
                mappings = parsed
        except Exception as exc:
            logger.error(
                "Groq JSON parse failed for complaint %s: %s | raw=%s",
                complaint_id, exc, raw_output[:300],
            )

    # ── 7. Validate — only known dept IDs, conf >= 0.40 ──────────
    valid_ids = {d["id"] for d in departments}
    valid_mappings = [
        m for m in mappings
        if isinstance(m, dict)
        and m.get("dept_id") in valid_ids
        and float(m.get("confidence", 0)) >= 0.40
    ]

    # ── 7b. Fallback to infra_type.default_dept_ids ───────────────
    # Triggered when: Groq failed, returned garbage, or returned
    # dept IDs not in our authority's department list.
    if not valid_mappings:
        logger.warning(
            "No valid Groq mappings for complaint %s (groq_error=%s) "
            "— falling back to infra_type.default_dept_ids",
            complaint_id, groq_error,
        )
        infra_row = db.execute(
            text("""
                SELECT default_dept_ids
                FROM infra_types
                WHERE code = :code
            """),
            {"code": infra_type_code},
        ).mappings().first()

        if infra_row and infra_row["default_dept_ids"]:
            for dept_id in infra_row["default_dept_ids"]:
                dept_id_str = str(dept_id)
                matching_dept = next(
                    (d for d in departments if d["id"] == dept_id_str), None
                )
                if matching_dept:
                    valid_mappings.append({
                        "dept_id":    dept_id_str,
                        "dept_code":  matching_dept["code"],
                        "confidence": 0.60,
                        "reason":     "infra_type default department (Groq fallback)",
                    })

    dept_ids       = [m["dept_id"] for m in valid_mappings]
    avg_confidence = (
        sum(float(m["confidence"]) for m in valid_mappings) / len(valid_mappings)
        if valid_mappings else 0.0
    )
    fallback_used  = bool(not mappings and valid_mappings)

    # ── 8. UPDATE complaints.agent_suggested_dept_ids ─────────────
    if dept_ids:
        db.execute(
            text("""
                UPDATE complaints
                   SET agent_suggested_dept_ids = CAST(:dept_ids AS uuid[]),
                       updated_at               = NOW()
                 WHERE id = CAST(:complaint_id AS uuid)
            """),
            {
                "dept_ids":     "{" + ",".join(dept_ids) + "}",
                "complaint_id": complaint_id,
            },
        )

    # ── 9. Write agent_logs ───────────────────────────────────────
    input_data = {
        "title":            title,
        "description":      description[:400],
        "infra_type_code":  infra_type_code,
        "infra_type_name":  infra_type_name,
        "infra_node_id":    infra_node_id,
        "authority":        authority_code,
        "routing_reason":   routing_reason,
        "routing_conf":     routing_conf,
        "dept_count":       len(departments),
        "lat":              lat,
        "lng":              lng,
        "road_name":        road_name,
    }
    output_data = {
        "mappings":      valid_mappings,
        "raw_output":    raw_output[:800],
        "groq_error":    groq_error,
        "fallback_used": fallback_used,
        "infra_node":    infra_node_info,
    }

    db.execute(
        text("""
            INSERT INTO agent_logs (
                agent_type, complaint_id,
                input_data, output_data,
                action_taken, confidence_score,
                latency_ms, model_used, tokens_used
            ) VALUES (
                'DEPT_MAPPER',
                CAST(:complaint_id  AS uuid),
                CAST(:input_data    AS jsonb),
                CAST(:output_data   AS jsonb),
                :action_taken,
                :confidence_score,
                :latency_ms,
                'llama-3.3-70b-versatile',
                :tokens_used
            )
        """),
        {
            "complaint_id":     complaint_id,
            "input_data":       json.dumps(input_data),
            "output_data":      json.dumps(output_data),
            "action_taken":     "DEPT_MAPPED" if valid_mappings else "DEPT_MAPPING_FAILED",
            "confidence_score": round(avg_confidence, 4),
            "latency_ms":       latency_ms,
            "tokens_used":      tokens_used,
        },
    )

    # ── 10. Write DEPT_MAPPED domain_event ────────────────────────
    db.execute(
        text("""
            INSERT INTO domain_events (
                event_type, entity_type, entity_id,
                actor_type, payload,
                complaint_id, city_id
            ) VALUES (
                'DEPT_MAPPED',
                'complaint',
                CAST(:complaint_id AS uuid),
                'agent',
                CAST(:payload      AS jsonb),
                CAST(:complaint_id AS uuid),
                CAST(:city_id      AS uuid)
            )
        """),
        {
            "complaint_id": complaint_id,
            "city_id":      city_id,
            "payload":      json.dumps({
                "authority":       authority_code,
                "routing_reason":  routing_reason,
                "routing_conf":    routing_conf,
                "mapped_dept_ids": dept_ids,
                "mappings":        valid_mappings,
                "avg_confidence":  round(avg_confidence, 4),
                "latency_ms":      latency_ms,
                "fallback_used":   fallback_used,
                "infra_node_id":   infra_node_id,
            }),
        },
    )

    logger.info(
        "Complaint %s mapped → depts=%s avg_conf=%.2f fallback=%s",
        complaint_id,
        [m.get("dept_code") for m in valid_mappings],
        avg_confidence,
        fallback_used,
    )

    return {
        "dept_ids":       dept_ids,
        "mappings":       valid_mappings,
        "authority":      authority_code,
        "avg_confidence": avg_confidence,
        "routing_reason": routing_reason,
    }