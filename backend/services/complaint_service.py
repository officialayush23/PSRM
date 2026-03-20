# backend/services/complaint_service.py

import json
import logging
from typing import Dict, Iterable, List, Optional
from uuid import UUID

from fastapi import HTTPException
from google import genai
from sqlalchemy import text
from sqlalchemy.orm import Session

from config import settings
from schemas import ComplaintIngestRequest, ComplaintIngestResponse
from services.embedding_service import create_complaint_embeddings
from services.mapping_service import map_complaint_to_departments
from services.pubsub_service import publish_complaint_received
from services.storage_service import save_embedding_artifact, save_upload

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────

def _vector_literal(values: Optional[Iterable[float]]) -> Optional[str]:
    if values is None:
        return None
    return "[" + ",".join(str(float(v)) for v in values) + "]"


def _uuid_array_literal(values: Optional[List[str]]) -> str:
    if not values:
        return "{}"
    return "{" + ",".join(values) + "}"


def _translate_to_english(description: str, original_language: str) -> str:
    """Translate complaint to English via Gemini. No-op if already English."""
    if original_language.lower().startswith("en"):
        return description

    try:
        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        prompt = (
            "Translate this complaint to English and return only translated text.\n"
            f"Language: {original_language}\n"
            f"Complaint: {description}"
        )
        response = client.models.generate_content(model="gemini-2.5-flash", contents=prompt)
        translated = (response.text or "").strip()
        if translated:
            return translated
        logger.warning("Gemini translation returned empty text; using original description")
    except Exception as exc:
        logger.warning("Gemini translation failed; using original description: %s", exc)

    return description


def _insert_domain_event(
    db: Session,
    *,
    event_type: str,
    complaint_id: str,
    citizen_id: str,
    city_id: str,
    payload: Dict,
) -> None:
    db.execute(
        text("""
            INSERT INTO domain_events (
                event_type, entity_type, entity_id,
                actor_id, actor_type,
                complaint_id, city_id, payload
            ) VALUES (
                :event_type,
                'complaint',
                CAST(:entity_id   AS uuid),
                CAST(:actor_id    AS uuid),
                'user',
                CAST(:complaint_id AS uuid),
                CAST(:city_id      AS uuid),
                CAST(:payload      AS jsonb)
            )
        """),
        {
            "event_type":   event_type,
            "entity_id":    complaint_id,
            "actor_id":     citizen_id,
            "complaint_id": complaint_id,
            "city_id":      city_id,
            "payload":      json.dumps(payload),
        },
    )


# ─────────────────────────────────────────────────────────────────
# GET COMPLAINT BY ID
# ─────────────────────────────────────────────────────────────────

def get_complaint_by_id(
    db: Session,
    complaint_id: UUID,
    current_user_id: UUID,
    current_user_role: str,
) -> Dict:
    row = db.execute(
        text("""
            SELECT
                c.id,
                c.complaint_number,
                c.citizen_id,
                c.city_id,
                c.jurisdiction_id,
                c.infra_node_id,
                c.workflow_instance_id,
                c.title,
                c.description,
                c.translated_description,
                c.original_language,
                c.address_text,
                c.images,
                c.voice_recording_url,
                c.status,
                c.priority,
                c.is_repeat_complaint,
                c.repeat_gap_days,
                c.agent_summary,
                c.agent_priority_reason,
                c.agent_suggested_dept_ids,
                c.created_at,
                c.updated_at,
                c.resolved_at,
                ST_Y(c.location::geometry) AS lat,
                ST_X(c.location::geometry) AS lng,
                it.name  AS infra_type_name,
                it.code  AS infra_type_code,
                j.name   AS jurisdiction_name,
                j.code   AS jurisdiction_code
            FROM complaints c
            LEFT JOIN infra_nodes   n  ON n.id  = c.infra_node_id
            LEFT JOIN infra_types   it ON it.id = n.infra_type_id
            LEFT JOIN jurisdictions j  ON j.id  = c.jurisdiction_id
            WHERE c.id = CAST(:cid AS uuid)
              AND c.is_deleted = false
        """),
        {"cid": str(complaint_id)},
    ).mappings().first()

    if row is None:
        raise HTTPException(status_code=404, detail="Complaint not found")

    if current_user_role == "citizen" and str(row["citizen_id"]) != str(current_user_id):
        raise HTTPException(status_code=403, detail="You are not allowed to view this complaint")

    # ── Resolve department names from agent_suggested_dept_ids ────
    dept_names = []
    if row["agent_suggested_dept_ids"]:
        dept_ids_str = "{" + ",".join(str(d) for d in row["agent_suggested_dept_ids"]) + "}"
        dept_rows = db.execute(
            text("""
                SELECT id, name, code
                FROM departments
                WHERE id = ANY(CAST(:ids AS uuid[]))
            """),
            {"ids": dept_ids_str},
        ).mappings().all()
        dept_names = [
            {"id": str(d["id"]), "name": d["name"], "code": d["code"]}
            for d in dept_rows
        ]

    # ── Load latest mapping confidence from agent_logs ────────────
    agent_row = db.execute(
        text("""
            SELECT confidence_score, output_data, created_at
            FROM agent_logs
            WHERE complaint_id = CAST(:cid AS uuid)
              AND agent_type   = 'DEPT_MAPPER'
              AND action_taken = 'DEPT_MAPPED'
            ORDER BY created_at DESC
            LIMIT 1
        """),
        {"cid": str(complaint_id)},
    ).mappings().first()

    mapping_confidence = None
    mapping_details    = []
    mapping_authority  = None
    if agent_row:
        mapping_confidence = (
            float(agent_row["confidence_score"])
            if agent_row["confidence_score"] is not None
            else None
        )
        output = agent_row["output_data"] or {}
        if isinstance(output, dict):
            mapping_details   = output.get("mappings", [])
        # authority is in input_data
    
    # Also get authority from domain_events DEPT_MAPPED payload
    de_row = db.execute(
        text("""
            SELECT payload
            FROM domain_events
            WHERE complaint_id = CAST(:cid AS uuid)
              AND event_type   = 'DEPT_MAPPED'
            ORDER BY created_at DESC
            LIMIT 1
        """),
        {"cid": str(complaint_id)},
    ).mappings().first()
    if de_row and de_row["payload"]:
        p = de_row["payload"]
        if isinstance(p, dict):
            mapping_authority = p.get("authority")

    return {
        "id":                     str(row["id"]),
        "complaint_number":       row["complaint_number"],
        "citizen_id":             str(row["citizen_id"]),
        "city_id":                str(row["city_id"]),
        "jurisdiction_id":        str(row["jurisdiction_id"]) if row["jurisdiction_id"] else None,
        "jurisdiction_name":      row["jurisdiction_name"],
        "jurisdiction_code":      row["jurisdiction_code"],
        "infra_node_id":          str(row["infra_node_id"]) if row["infra_node_id"] else None,
        "infra_type_name":        row["infra_type_name"],
        "infra_type_code":        row["infra_type_code"],
        "workflow_instance_id":   str(row["workflow_instance_id"]) if row["workflow_instance_id"] else None,
        "title":                  row["title"],
        "description":            row["description"],
        "translated_description": row["translated_description"],
        "original_language":      row["original_language"],
        "address_text":           row["address_text"],
        "images":                 row["images"] or [],
        "voice_recording_url":    row["voice_recording_url"],
        "status":                 row["status"],
        "priority":               row["priority"],
        "is_repeat_complaint":    bool(row["is_repeat_complaint"]),
        "repeat_gap_days":        row["repeat_gap_days"],
        "agent_summary":          row["agent_summary"],
        "agent_priority_reason":  row["agent_priority_reason"],
        "departments":            dept_names,
        "mapping_confidence":     mapping_confidence,
        "mapping_details":        mapping_details,
        "mapping_authority":      mapping_authority,
        "lat":                    float(row["lat"]) if row["lat"] is not None else None,
        "lng":                    float(row["lng"]) if row["lng"] is not None else None,
        "created_at":             row["created_at"].isoformat() if row["created_at"] else None,
        "updated_at":             row["updated_at"].isoformat() if row["updated_at"] else None,
        "resolved_at":            row["resolved_at"].isoformat() if row["resolved_at"] else None,
    }


# ─────────────────────────────────────────────────────────────────
# INGEST COMPLAINT  (main entry point)
# ─────────────────────────────────────────────────────────────────

async def ingest_complaint(
    db: Session,
    request: ComplaintIngestRequest,
) -> ComplaintIngestResponse:
    """
    Full ingestion pipeline:
      1.  Upload media to GCS / local
      2.  Translate description (Gemini)
      3.  Create embeddings (Nomic text + vision)
      4.  fn_ingest_complaint — atomic SQL transaction
            • resolves jurisdiction (PostGIS)
            • finds / creates infra_node (geohash + proximity)
            • repeat-complaint check
            • inserts complaint row
            • inserts complaint_embeddings
            • maps to active workflow (if any)
            • writes COMPLAINT_RECEIVED domain_event
      5.  Flush so mapping service can see the committed complaint row
      6.  Department mapping (fn_route_complaint_authority + Groq)
            • resolves authority: NDMC / MCD / PWD / DJB
            • Groq maps to 1-N departments
            • updates complaints.agent_suggested_dept_ids
            • writes agent_logs + DEPT_MAPPED domain_event
      7.  Save embedding artifact to GCS / local
      8.  Pub/Sub publish + notification_logs (citizen receipt)
      9.  Commit everything
    """

    # ── 1. Media upload ───────────────────────────────────────────
    images_payload: List[Dict] = []
    primary_image_local_path: Optional[str] = None

    for upload in request.images:
        content = await upload.read()
        if not content:
            continue
        saved = save_upload(content, upload.filename or "image.bin", upload.content_type)
        if primary_image_local_path is None:
            primary_image_local_path = saved["local_path"]
        images_payload.append({
            "url":       saved["url"],
            "storage":   saved["storage"],
            "mime_type": upload.content_type or "application/octet-stream",
        })

    voice_recording_url: Optional[str] = None
    if request.voice_recording is not None:
        voice_content = await request.voice_recording.read()
        if voice_content:
            saved_voice = save_upload(
                voice_content,
                request.voice_recording.filename or "voice.bin",
                request.voice_recording.content_type,
            )
            voice_recording_url = saved_voice["url"]

    # ── 2. Translate ──────────────────────────────────────────────
    translated_description = _translate_to_english(
        request.description, request.original_language
    )

    # ── 3. Embeddings ─────────────────────────────────────────────
    embeddings      = create_complaint_embeddings(translated_description, primary_image_local_path)
    text_embedding  = embeddings["text_embedding"]
    image_embedding = embeddings["image_embedding"]

    if text_embedding is None:
        raise ValueError("Text embedding is required and cannot be null")

    # ── 4. fn_ingest_complaint ────────────────────────────────────
    params = {
        "p_citizen_id":               str(request.citizen_id),
        "p_city_id":                  str(request.city_id),
        "p_city_code":                request.city_code,
        "p_title":                    request.title,
        "p_description":              request.description,
        "p_original_language":        request.original_language,
        "p_translated_description":   translated_description,
        "p_lat":                      request.lat,
        "p_lng":                      request.lng,
        "p_address_text":             request.address_text,
        "p_images":                   json.dumps(images_payload),
        "p_voice_recording_url":      voice_recording_url,
        "p_voice_transcript":         request.voice_transcript,
        "p_infra_type_id":            str(request.infra_type_id),
        "p_infra_name":               request.infra_name,
        "p_text_embedding":           _vector_literal(text_embedding),
        "p_image_embedding":          _vector_literal(image_embedding),
        "p_embedding_model":          request.embedding_model or "nomic-embed-text-v1.5",
        "p_priority":                 request.priority,
        "p_agent_summary":            request.agent_summary,
        "p_agent_priority_reason":    request.agent_priority_reason,
        "p_agent_suggested_dept_ids": _uuid_array_literal(request.agent_suggested_dept_ids),
    }

    result = db.execute(
        text("""
            SELECT * FROM fn_ingest_complaint(
                CAST(:p_citizen_id AS uuid),
                CAST(:p_city_id    AS uuid),
                :p_city_code,
                :p_title,
                :p_description,
                :p_original_language,
                :p_translated_description,
                :p_lat,
                :p_lng,
                :p_address_text,
                CAST(:p_images              AS jsonb),
                :p_voice_recording_url,
                :p_voice_transcript,
                CAST(:p_infra_type_id       AS uuid),
                :p_infra_name,
                CAST(:p_text_embedding      AS vector(768)),
                CAST(:p_image_embedding     AS vector(768)),
                :p_embedding_model,
                :p_priority,
                :p_agent_summary,
                :p_agent_priority_reason,
                CAST(:p_agent_suggested_dept_ids AS uuid[])
            )
        """),
        params,
    )
    row = result.mappings().first()
    if row is None:
        raise ValueError("fn_ingest_complaint returned no row")

    complaint_id         = str(row["complaint_id"])
    complaint_number     = str(row["complaint_number"])
    infra_node_id        = str(row["infra_node_id"])
    workflow_instance_id = str(row["workflow_instance_id"]) if row["workflow_instance_id"] else None
    is_new_infra_node    = bool(row["is_new_infra_node"])
    is_repeat_complaint  = bool(row["is_repeat_complaint"])
    repeat_gap_days      = row["repeat_gap_days"]
    jurisdiction_id      = str(row["jurisdiction_id"]) if row["jurisdiction_id"] else None

    citizen_id = str(request.citizen_id)
    city_id    = str(request.city_id)

    # ── 4b. Extra domain events from the Python layer ─────────────
    base_payload = {
        "complaint_id":        complaint_id,
        "complaint_number":    complaint_number,
        "infra_node_id":       infra_node_id,
        "workflow_instance_id": workflow_instance_id,
        "is_new_infra_node":   is_new_infra_node,
        "is_repeat_complaint": is_repeat_complaint,
        "repeat_gap_days":     repeat_gap_days,
        "jurisdiction_id":     jurisdiction_id,
    }

    if workflow_instance_id is None:
        _insert_domain_event(
            db,
            event_type="WORKFLOW_INSTANCE_REQUIRED",
            complaint_id=complaint_id,
            citizen_id=citizen_id,
            city_id=city_id,
            payload=base_payload,
        )

    if is_repeat_complaint:
        _insert_domain_event(
            db,
            event_type="REPEAT_COMPLAINT_NOTIFICATION_QUEUED",
            complaint_id=complaint_id,
            citizen_id=citizen_id,
            city_id=city_id,
            payload=base_payload,
        )

    if is_new_infra_node:
        _insert_domain_event(
            db,
            event_type="NEW_INFRA_NODE_DETECTED",
            complaint_id=complaint_id,
            citizen_id=citizen_id,
            city_id=city_id,
            payload=base_payload,
        )

    # ── 5. Flush so mapping_service can see the complaint row ─────
    # We flush (not commit) so the entire batch rolls back together
    # if something later fails.
    db.flush()

    # ── 6. Resolve infra type name + code for mapping ─────────────
    infra_row = db.execute(
        text("SELECT name, code FROM infra_types WHERE id = CAST(:id AS uuid)"),
        {"id": str(request.infra_type_id)},
    ).mappings().first()
    infra_type_name = infra_row["name"] if infra_row else "Unknown infrastructure"
    infra_type_code = infra_row["code"] if infra_row else "ROAD"

    # Resolve jurisdiction name for Groq context
    jurisdiction_name: Optional[str] = None
    if jurisdiction_id:
        jur_row = db.execute(
            text("SELECT name FROM jurisdictions WHERE id = CAST(:id AS uuid)"),
            {"id": jurisdiction_id},
        ).mappings().first()
        jurisdiction_name = jur_row["name"] if jur_row else None

    # ── 7. Department mapping (authority → Groq) ──────────────────
    mapping_result = map_complaint_to_departments(
    db,
    complaint_id=complaint_id,
    city_id=city_id,
    title=request.title,
    description=translated_description,
    infra_type_id=str(request.infra_type_id),   # ← new
    infra_type_code=infra_type_code,
    infra_type_name=infra_type_name,
    infra_node_id=infra_node_id,                # ← new (from fn_ingest_complaint return)
    jurisdiction_name=jurisdiction_name,
    lat=request.lat,
    lng=request.lng,
    road_name=request.address_text,
)

    # ── 8. Save embedding artifact ────────────────────────────────
    embedding_artifact = save_embedding_artifact(
        complaint_id,
        {
            "complaint_id":           complaint_id,
            "embedding_model":        request.embedding_model or "nomic-embed-text-v1.5",
            "translated_description": translated_description,
            "text_embedding":         text_embedding,
            "image_embedding":        image_embedding,
        },
    )

    # ── 9. Pub/Sub publish + notification_logs ────────────────────
    # Writes pubsub_event_log + notification_logs (email + whatsapp)
    # Failures here are logged but do NOT roll back the complaint.
    try:
        publish_complaint_received(
            db,
            complaint_id=complaint_id,
            complaint_number=complaint_number,
            citizen_id=citizen_id,
            city_id=city_id,
            title=request.title,
            description=translated_description,
            priority=request.priority or "normal",
            infra_type_name=infra_type_name,
            jurisdiction_name=jurisdiction_name,
            dept_mappings=mapping_result.get("mappings", []),
            is_repeat=is_repeat_complaint,
            is_new_infra_node=is_new_infra_node,
            lat=request.lat,
            lng=request.lng,
            images=images_payload,
        )
    except Exception as exc:
        # notification failure must never block complaint creation
        logger.error("publish_complaint_received failed for %s: %s", complaint_id, exc)

    # ── 10. Single commit for everything ──────────────────────────
    db.commit()

    logger.info(
        "Complaint ingested: id=%s number=%s authority=%s depts=%s",
        complaint_id,
        complaint_number,
        mapping_result.get("authority"),
        [m.get("dept_code") for m in mapping_result.get("mappings", [])],
    )

    return ComplaintIngestResponse(
        complaint_id=row["complaint_id"],
        complaint_number=complaint_number,
        infra_node_id=row["infra_node_id"],
        workflow_instance_id=row["workflow_instance_id"],
        is_repeat_complaint=is_repeat_complaint,
        is_new_infra_node=is_new_infra_node,
        repeat_gap_days=repeat_gap_days,
        jurisdiction_id=row["jurisdiction_id"],
    )