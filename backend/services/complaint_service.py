import json
import uuid
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from google import genai
from sqlalchemy import text
from sqlalchemy.orm import Session

from config import settings
from schemas import ComplaintIngestRequest, ComplaintIngestResponse
from services.embedding_service import create_complaint_embeddings

BASE_DIR = Path(__file__).resolve().parents[1]
UPLOADS_DIR = BASE_DIR / "data" / "uploads"


def _ensure_uploads_dir() -> None:
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


def _save_upload(content: bytes, filename: str) -> str:
    _ensure_uploads_dir()
    suffix = Path(filename or "upload.bin").suffix
    path = UPLOADS_DIR / f"{uuid.uuid4()}{suffix}"
    path.write_bytes(content)
    return str(path)


def _vector_literal(values: Optional[Iterable[float]]) -> Optional[str]:
    if values is None:
        return None
    return "[" + ",".join(str(float(v)) for v in values) + "]"


def _uuid_array_literal(values: Optional[List[str]]) -> str:
    if not values:
        return "{}"
    return "{" + ",".join(values) + "}"


def _translate_to_english(description: str, original_language: str) -> str:
    if original_language.lower().startswith("en"):
        return description

    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    prompt = (
        "Translate this complaint to English and return only translated text.\n"
        f"Language: {original_language}\n"
        f"Complaint: {description}"
    )
    response = client.models.generate_content(model="gemini-2.5-flash", contents=prompt)
    translated = (response.text or "").strip()
    if not translated:
        raise ValueError("Gemini translation returned empty text")
    return translated


def _insert_domain_event(
    db: Session,
    *,
    event_type: str,
    complaint_id: str,
    citizen_id: str,
    city_id: str,
    payload: Dict[str, object],
) -> None:
    db.execute(
        text(
            """
            INSERT INTO domain_events (
                event_type,
                entity_type,
                entity_id,
                actor_id,
                actor_type,
                complaint_id,
                city_id,
                payload
            )
            VALUES (
                :event_type,
                'complaint',
                CAST(:entity_id AS uuid),
                CAST(:actor_id AS uuid),
                'user',
                CAST(:complaint_id AS uuid),
                CAST(:city_id AS uuid),
                CAST(:payload AS jsonb)
            )
            """
        ),
        {
            "event_type": event_type,
            "entity_id": complaint_id,
            "actor_id": citizen_id,
            "complaint_id": complaint_id,
            "city_id": city_id,
            "payload": json.dumps(payload),
        },
    )


async def ingest_complaint(db: Session, request: ComplaintIngestRequest) -> ComplaintIngestResponse:
    images_payload: List[Dict[str, str]] = []
    primary_image_path: Optional[str] = None

    for upload in request.images:
        content = await upload.read()
        if not content:
            continue

        saved_path = _save_upload(content, upload.filename or "image.bin")
        if primary_image_path is None:
            primary_image_path = saved_path

        images_payload.append(
            {
                "url": saved_path,
                "mime_type": upload.content_type or "application/octet-stream",
            }
        )

    voice_recording_url = None
    if request.voice_recording is not None:
        voice_content = await request.voice_recording.read()
        if voice_content:
            voice_recording_url = _save_upload(
                voice_content,
                request.voice_recording.filename or "voice.bin",
            )

    translated_description = _translate_to_english(request.description, request.original_language)
    embeddings = create_complaint_embeddings(translated_description, primary_image_path)
    text_embedding = embeddings["text_embedding"]
    image_embedding = embeddings["image_embedding"]

    if text_embedding is None:
        raise ValueError("Text embedding is required and cannot be null")

    params = {
        "p_citizen_id": str(request.citizen_id),
        "p_city_id": str(request.city_id),
        "p_city_code": request.city_code,
        "p_title": request.title,
        "p_description": request.description,
        "p_original_language": request.original_language,
        "p_translated_description": translated_description,
        "p_lat": request.lat,
        "p_lng": request.lng,
        "p_address_text": request.address_text,
        "p_images": json.dumps(images_payload),
        "p_voice_recording_url": voice_recording_url,
        "p_voice_transcript": request.voice_transcript,
        "p_infra_type_id": str(request.infra_type_id),
        "p_infra_name": request.infra_name,
        "p_text_embedding": _vector_literal(text_embedding),
        "p_image_embedding": _vector_literal(image_embedding),
        "p_embedding_model": request.embedding_model or "nomic-embed-text-v1.5",
        "p_priority": request.priority,
        "p_agent_summary": request.agent_summary,
        "p_agent_priority_reason": request.agent_priority_reason,
        "p_agent_suggested_dept_ids": _uuid_array_literal(request.agent_suggested_dept_ids),
    }

    result = db.execute(
        text(
            """
            SELECT * FROM fn_ingest_complaint(
                CAST(:p_citizen_id AS uuid), CAST(:p_city_id AS uuid), :p_city_code,
                :p_title, :p_description, :p_original_language, :p_translated_description,
                :p_lat, :p_lng, :p_address_text,
                CAST(:p_images AS jsonb), :p_voice_recording_url, :p_voice_transcript,
                CAST(:p_infra_type_id AS uuid), :p_infra_name,
                CAST(:p_text_embedding AS vector(768)), CAST(:p_image_embedding AS vector(768)),
                :p_embedding_model,
                :p_priority, :p_agent_summary, :p_agent_priority_reason,
                CAST(:p_agent_suggested_dept_ids AS uuid[])
            )
            """
        ),
        params,
    )
    row = result.mappings().first()
    if row is None:
        raise ValueError("fn_ingest_complaint returned no row")

    complaint_id = str(row["complaint_id"])
    city_id = str(request.city_id)
    citizen_id = str(request.citizen_id)
    payload = {
        "complaint_id": complaint_id,
        "complaint_number": str(row["complaint_number"]),
        "infra_node_id": str(row["infra_node_id"]),
        "workflow_instance_id": str(row["workflow_instance_id"]) if row["workflow_instance_id"] else None,
        "is_new_infra_node": bool(row["is_new_infra_node"]),
        "is_repeat_complaint": bool(row["is_repeat_complaint"]),
        "repeat_gap_days": row["repeat_gap_days"],
        "jurisdiction_id": str(row["jurisdiction_id"]),
    }

    if row["workflow_instance_id"] is None:
        _insert_domain_event(
            db,
            event_type="WORKFLOW_INSTANCE_REQUIRED",
            complaint_id=complaint_id,
            citizen_id=citizen_id,
            city_id=city_id,
            payload=payload,
        )

    if bool(row["is_repeat_complaint"]):
        _insert_domain_event(
            db,
            event_type="REPEAT_COMPLAINT_NOTIFICATION_QUEUED",
            complaint_id=complaint_id,
            citizen_id=citizen_id,
            city_id=city_id,
            payload=payload,
        )

    if bool(row["is_new_infra_node"]):
        _insert_domain_event(
            db,
            event_type="NEW_INFRA_NODE_DETECTED",
            complaint_id=complaint_id,
            citizen_id=citizen_id,
            city_id=city_id,
            payload=payload,
        )

    db.commit()

    return ComplaintIngestResponse(
        complaint_id=row["complaint_id"],
        complaint_number=row["complaint_number"],
        infra_node_id=row["infra_node_id"],
        workflow_instance_id=row["workflow_instance_id"],
        is_repeat_complaint=row["is_repeat_complaint"],
        is_new_infra_node=row["is_new_infra_node"],
        repeat_gap_days=row["repeat_gap_days"],
        jurisdiction_id=row["jurisdiction_id"],
    )
