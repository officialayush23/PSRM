# backend/routes/complaint_router.py

import json
import logging
import re
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import text
from sqlalchemy.orm import Session

from db import get_db
from dependencies import get_current_user
from models import City, User
from schemas import ComplaintIngestRequest, ComplaintIngestResponse, TokenData
from services.complaint_service import (
    get_complaint_by_id as get_complaint_by_id_service,
    ingest_complaint as ingest_complaint_service,
)
from services.mapping_service import infer_infra_type, ensure_infra_type
from services.storage_service import generate_signed_upload_url

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/complaints", tags=["Complaints"])


# ══════════════════════════════════════════════════════════════════
# IMPORTANT: All fixed-string routes MUST come before /{complaint_id}
# otherwise FastAPI matches e.g. "infra-types" as a UUID parameter.
# Order: map-pins → nearby → all → (empty) → infra-types
#        → /{id}/history → /{id}  → POST /ingest
# ══════════════════════════════════════════════════════════════════


# ── 1. Infra types list (no auth — used by submit form) ──────────

@router.get("/infra-types")
def list_infra_types(db: Session = Depends(get_db)):
    """
    Public — no auth required.
    Returns all seeded + user-created infra types so the frontend
    can render the issue-type selector grid.
    """
    rows = db.execute(
        text("SELECT id, name, code, metadata FROM infra_types ORDER BY name")
    ).mappings().all()
    return [
        {
            "id":       str(r["id"]),
            "name":     r["name"],
            "code":     r["code"],
            "metadata": r["metadata"] or {},
        }
        for r in rows
    ]


# ── 2. My complaint map-pins ──────────────────────────────────────

@router.get("/map-pins")
def get_map_pins(
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    """Returns lat/lng of the authenticated citizen's own complaints."""
    rows = db.execute(
        text("""
            SELECT id, complaint_number, title, status, priority,
                   ST_Y(location::geometry) AS lat,
                   ST_X(location::geometry) AS lng
            FROM complaints
            WHERE citizen_id = CAST(:uid AS uuid)
              AND is_deleted  = false
              AND location IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 50
        """),
        {"uid": str(current_user.user_id)},
    ).mappings().all()

    return [
        {
            "id":               str(row["id"]),
            "complaint_number": row["complaint_number"],
            "title":            row["title"],
            "status":           row["status"],
            "priority":         row["priority"],
            "lat":              float(row["lat"]),
            "lng":              float(row["lng"]),
        }
        for row in rows
    ]


# ── 3. Nearby complaints (all citizens, within radius) ───────────

@router.get("/nearby")
def get_nearby_complaints(
    lat:           float = Query(...),
    lng:           float = Query(...),
    radius_meters: int   = Query(default=4000, le=10000),
    limit:         int   = Query(default=100,  le=200),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    rows = db.execute(
        text("""
            SELECT
                c.id, c.complaint_number, c.title, c.status, c.priority,
                c.is_repeat_complaint, c.created_at, c.infra_node_id, c.images,
                ST_Y(c.location::geometry)                             AS lat,
                ST_X(c.location::geometry)                             AS lng,
                ST_Distance(
                    c.location::geography,
                    ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
                )                                                      AS distance_meters,
                it.name  AS infra_type_name,
                it.code  AS infra_type_code,
                it.id    AS infra_type_id,
                n.status AS node_status,
                n.total_complaint_count
            FROM complaints c
            LEFT JOIN infra_nodes  n  ON n.id  = c.infra_node_id
            LEFT JOIN infra_types  it ON it.id = n.infra_type_id
            WHERE c.is_deleted = FALSE
              AND c.location IS NOT NULL
              AND ST_DWithin(
                    c.location::geography,
                    ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
                    :radius
              )
            ORDER BY c.created_at DESC
            LIMIT :limit
        """),
        {"lat": lat, "lng": lng, "radius": radius_meters, "limit": limit},
    ).mappings().all()

    def _thumb(images):
        if images and isinstance(images, list) and len(images) > 0:
            return images[0].get("url") if isinstance(images[0], dict) else None
        return None

    return [
        {
            "id":                   str(r["id"]),
            "complaint_number":     r["complaint_number"],
            "title":                r["title"],
            "status":               r["status"],
            "priority":             r["priority"],
            "is_repeat_complaint":  bool(r["is_repeat_complaint"]),
            "lat":                  float(r["lat"]),
            "lng":                  float(r["lng"]),
            "distance_meters":      round(float(r["distance_meters"])),
            "created_at":           r["created_at"].isoformat() if r["created_at"] else None,
            "infra_type_name":      r["infra_type_name"],
            "infra_type_code":      r["infra_type_code"],
            "infra_node_id":        str(r["infra_node_id"]) if r["infra_node_id"] else None,
            "node_status":          r["node_status"],
            "node_complaint_count": r["total_complaint_count"],
            "thumbnail_url":        _thumb(r["images"]),
        }
        for r in rows
    ]


# ── 4. All complaints citywide (map toggle) ───────────────────────

@router.get("/all")
def get_all_complaints_map(
    limit:           int           = Query(default=500, le=1000),
    status:          Optional[str] = Query(default=None),
    infra_type_code: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    filters = ["c.is_deleted = FALSE", "c.location IS NOT NULL"]
    params  = {"limit": limit}

    if status:
        filters.append("c.status = :status")
        params["status"] = status
    if infra_type_code:
        filters.append("it.code = :infra_type_code")
        params["infra_type_code"] = infra_type_code

    where = " AND ".join(filters)

    rows = db.execute(
        text(f"""
            SELECT
                c.id, c.complaint_number, c.title, c.status, c.priority,
                c.is_repeat_complaint, c.created_at, c.images, c.infra_node_id,
                ST_Y(c.location::geometry)  AS lat,
                ST_X(c.location::geometry)  AS lng,
                it.name  AS infra_type_name,
                it.code  AS infra_type_code,
                it.id    AS infra_type_id,
                n.status AS node_status,
                n.total_complaint_count
            FROM complaints c
            LEFT JOIN infra_nodes  n  ON n.id  = c.infra_node_id
            LEFT JOIN infra_types  it ON it.id = n.infra_type_id
            WHERE {where}
            ORDER BY c.created_at DESC
            LIMIT :limit
        """),
        params,
    ).mappings().all()

    def _thumb(images):
        if images and isinstance(images, list) and len(images) > 0:
            return images[0].get("url") if isinstance(images[0], dict) else None
        return None

    return [
        {
            "id":                   str(r["id"]),
            "complaint_number":     r["complaint_number"],
            "title":                r["title"],
            "status":               r["status"],
            "priority":             r["priority"],
            "is_repeat_complaint":  bool(r["is_repeat_complaint"]),
            "lat":                  float(r["lat"]),
            "lng":                  float(r["lng"]),
            "distance_meters":      None,
            "created_at":           r["created_at"].isoformat() if r["created_at"] else None,
            "thumbnail_url":        _thumb(r["images"]),
            "infra_type_name":      r["infra_type_name"],
            "infra_type_code":      r["infra_type_code"],
            "infra_node_id":        str(r["infra_node_id"]) if r["infra_node_id"] else None,
            "node_status":          r["node_status"],
            "node_complaint_count": r["total_complaint_count"],
        }
        for r in rows
    ]


# ── 5. My complaints paginated ────────────────────────────────────

@router.get("")
def list_my_complaints(
    status: Optional[str] = Query(default=None),
    limit:  int           = Query(default=20, ge=1, le=100),
    offset: int           = Query(default=0,  ge=0),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    status_filter = ""
    params = {"uid": str(current_user.user_id), "limit": limit, "offset": offset}
    if status:
        status_filter = "AND status = :status"
        params["status"] = status

    rows = db.execute(
        text(f"""
            SELECT id, complaint_number, title, description, address_text,
                   status, priority, is_repeat_complaint, images,
                   created_at, updated_at, resolved_at,
                   ST_Y(location::geometry) AS lat,
                   ST_X(location::geometry) AS lng
            FROM complaints
            WHERE citizen_id = CAST(:uid AS uuid)
              AND is_deleted  = false
              {status_filter}
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    ).mappings().all()

    count_row = db.execute(
        text(f"""
            SELECT COUNT(*) AS total FROM complaints
            WHERE citizen_id = CAST(:uid AS uuid)
              AND is_deleted  = false {status_filter}
        """),
        params,
    ).mappings().first()

    def _safe_thumb(images):
        if not images: return None
        imgs = images if isinstance(images, list) else []
        return imgs[0].get("url") if imgs and isinstance(imgs[0], dict) else None

    return {
        "total":  int(count_row["total"]),
        "limit":  limit,
        "offset": offset,
        "items": [
            {
                "id":                  str(r["id"]),
                "complaint_number":    r["complaint_number"],
                "title":               r["title"],
                "description":         r["description"],
                "address_text":        r["address_text"],
                "status":              r["status"],
                "priority":            r["priority"],
                "is_repeat_complaint": bool(r["is_repeat_complaint"]),
                "thumbnail_url":       _safe_thumb(r["images"]),
                "created_at":          r["created_at"].isoformat() if r["created_at"] else None,
                "updated_at":          r["updated_at"].isoformat() if r["updated_at"] else None,
                "resolved_at":         r["resolved_at"].isoformat() if r["resolved_at"] else None,
                "lat":                 float(r["lat"]) if r["lat"] is not None else None,
                "lng":                 float(r["lng"]) if r["lng"] is not None else None,
            }
            for r in rows
        ],
    }


# ── 6. Complaint status history ───────────────────────────────────

@router.get("/{complaint_id}/history")
def get_complaint_history(
    complaint_id: UUID,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    complaint_row = db.execute(
        text("""
            SELECT citizen_id FROM complaints
            WHERE id = CAST(:cid AS uuid) AND is_deleted = false
        """),
        {"cid": str(complaint_id)},
    ).mappings().first()

    if not complaint_row:
        raise HTTPException(status_code=404, detail="Complaint not found")

    if (
        current_user.role == "citizen"
        and str(complaint_row["citizen_id"]) != str(current_user.user_id)
    ):
        raise HTTPException(status_code=403, detail="Not allowed")

    rows = db.execute(
        text("""
            SELECT old_status, new_status, reason, created_at
            FROM complaint_status_history
            WHERE complaint_id = CAST(:cid AS uuid)
            ORDER BY created_at ASC
        """),
        {"cid": str(complaint_id)},
    ).mappings().all()

    return [
        {
            "old_status": r["old_status"],
            "new_status": r["new_status"],
            "reason":     r["reason"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]


# ── 7. Single complaint detail ────────────────────────────────────

@router.get("/{complaint_id}")
def get_complaint_by_id(
    complaint_id: UUID,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    return get_complaint_by_id_service(
        db=db,
        complaint_id=complaint_id,
        current_user_id=current_user.user_id,
        current_user_role=current_user.role,
    )


# ── 8. Ingest ─────────────────────────────────────────────────────

@router.post("/ingest", response_model=ComplaintIngestResponse)
async def ingest_complaint(
    title:                    Optional[str]        = Form(default=None),
    text:                     Optional[str]        = Form(default=None),
    description:              Optional[str]        = Form(default=None),
    original_language:        str                  = Form("en"),
    lat:                      float                = Form(...),
    lng:                      float                = Form(...),
    # ── infra type — exactly ONE of these three paths is used ──────
    infra_type_id:            Optional[UUID]       = Form(default=None),
    # User chose "Something Else" and typed a custom type name
    custom_infra_type_name:   Optional[str]        = Form(default=None),
    # (if neither: AI infers from title + description)
    # ──────────────────────────────────────────────────────────────
    address_text:             Optional[str]        = Form(default=None),
    infra_name:               Optional[str]        = Form(default=None),
    priority:                 str                  = Form(default="normal"),
    voice_transcript:         Optional[str]        = Form(default=None),
    agent_summary:            Optional[str]        = Form(default=None),
    agent_priority_reason:    Optional[str]        = Form(default=None),
    embedding_model:          str                  = Form(default="nomic-embed-text-v1.5"),
    agent_suggested_dept_ids: Optional[str]        = Form(default=None),
    images:                   List[UploadFile]     = File(default=[]),
    image:                    Optional[UploadFile] = File(default=None),
    voice_recording:          Optional[UploadFile] = File(default=None),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    """
    Infra type resolution order (highest priority first):

      1. infra_type_id provided  → use directly, no LLM needed
      2. custom_infra_type_name  → ensure_infra_type() creates/finds a
                                   row with a slugified code
                                   e.g. "Flyover crack" → FLYOVER_CRACK
      3. Neither                 → infer_infra_type() calls Groq +
                                   keyword fallback on existing types.
                                   Never falls back to "first row in DB".
    """
    allowed_roles = {"citizen", "admin", "super_admin"}
    if current_user.role not in allowed_roles:
        raise HTTPException(status_code=403, detail="Not allowed to submit complaints")

    user = db.query(User).filter(
        User.id == current_user.user_id, User.is_active.is_(True)
    ).first()
    if not user:
        raise HTTPException(status_code=401, detail="Authenticated user not found")
    if not user.city_id:
        raise HTTPException(status_code=400, detail="User city is not configured")

    city = db.query(City).filter(City.id == user.city_id).first()
    if not city:
        raise HTTPException(status_code=400, detail="User city record not found")

    resolved_description = (description or text or "").strip()
    if not resolved_description:
        raise HTTPException(status_code=400, detail="Complaint description is required")

    resolved_title = (title or resolved_description[:120]).strip()

    # ── Resolve infra_type_id ─────────────────────────────────────
    resolved_infra_type_id: Optional[UUID] = infra_type_id

    if resolved_infra_type_id is None:

        if custom_infra_type_name and custom_infra_type_name.strip():
            # Path 2 — user described a novel type
            custom_name = custom_infra_type_name.strip()[:200]
            custom_code = re.sub(
                r"[^A-Z0-9_]", "",
                custom_name.upper().replace(" ", "_")
            )[:30] or "CUSTOM"

            logger.info("Creating custom infra_type name=%s code=%s", custom_name, custom_code)

            infra_info = ensure_infra_type(
                db,
                # ensure_infra_type first arg is an ID to look up;
                # passing a random value forces it to fall through to
                # the code-lookup + create path
                "00000000-0000-0000-0000-000000000000",
                fallback_name=custom_name,
                fallback_code=custom_code,
            )
            resolved_infra_type_id = UUID(infra_info["id"])
            logger.info(
                "Custom infra_type resolved → id=%s code=%s",
                infra_info["id"], infra_info["code"],
            )

        else:
            # Path 3 — let AI infer from text
            logger.info("No infra_type supplied — running AI inference")
            try:
                inferred = infer_infra_type(
                    db,
                    title=resolved_title,
                    description=resolved_description,
                    translated_description=resolved_description,
                )
                if inferred and inferred.get("id"):
                    resolved_infra_type_id = UUID(inferred["id"])
                    logger.info(
                        "AI inferred infra_type: %s (%s)",
                        inferred.get("code"), inferred.get("id"),
                    )
                else:
                    raise ValueError("infer_infra_type returned empty result")

            except Exception as exc:
                logger.error("AI inference failed: %s — trying GENERAL fallback", exc)
                # Last resort: find GENERAL, else any existing type
                fallback = db.execute(
                    text("""
                        SELECT id FROM infra_types
                        WHERE code = 'GENERAL'
                        LIMIT 1
                    """)
                ).scalar()
                if not fallback:
                    fallback = db.execute(
                        text("SELECT id FROM infra_types ORDER BY created_at ASC LIMIT 1")
                    ).scalar()
                if not fallback:
                    raise HTTPException(
                        status_code=500,
                        detail="No infra types configured in system",
                    )
                resolved_infra_type_id = UUID(str(fallback))

    # ── Collect images ────────────────────────────────────────────
    all_images = list(images)
    if image is not None:
        all_images.append(image)

    suggested_dept_ids = []
    if agent_suggested_dept_ids:
        suggested_dept_ids = [
            item.strip()
            for item in agent_suggested_dept_ids.split(",")
            if item.strip()
        ]

    request = ComplaintIngestRequest(
        citizen_id               = current_user.user_id,
        city_id                  = user.city_id,
        city_code                = city.city_code,
        title                    = resolved_title,
        description              = resolved_description,
        original_language        = original_language,
        lat                      = lat,
        lng                      = lng,
        infra_type_id            = resolved_infra_type_id,
        address_text             = address_text,
        infra_name               = infra_name,
        priority                 = priority,
        voice_transcript         = voice_transcript,
        agent_summary            = agent_summary,
        agent_priority_reason    = agent_priority_reason,
        agent_suggested_dept_ids = suggested_dept_ids,
        embedding_model          = embedding_model,
        images                   = all_images,
        voice_recording          = voice_recording,
    )

    return await ingest_complaint_service(db, request)


# ── 9. Signed upload URL ──────────────────────────────────────────

@router.get("/upload-url")
def get_upload_url(
    complaint_id: str,
    content_type: str = "image/jpeg",
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    if current_user.role not in ["citizen", "worker", "contractor"]:
        raise HTTPException(status_code=403, detail="Not allowed to upload images")
    try:
        return generate_signed_upload_url(complaint_id, content_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── 10. Append image to existing complaint ────────────────────────

@router.patch("/{complaint_id}/images")
def append_complaint_image(
    complaint_id: str,
    file_url:     str,
    object_path:  str,
    content_type: str = "image/jpeg",
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    new_image = {
        "url":         file_url,
        "object_path": object_path,
        "storage":     "gcs",
        "mime_type":   content_type,
        "uploaded_by": str(current_user.user_id),
        "uploaded_at": datetime.utcnow().isoformat(),
    }
    db.execute(
        text("""
            UPDATE complaints
               SET images     = images || :new_image::jsonb,
                   updated_at = now()
             WHERE id         = CAST(:complaint_id AS uuid)
               AND is_deleted = false
        """),
        {"complaint_id": complaint_id, "new_image": json.dumps(new_image)},
    )
    db.commit()
    return {"message": "Image appended successfully", "image": new_image}