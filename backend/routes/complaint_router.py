import json
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import text
from sqlalchemy.orm import Session

from db import get_db
from dependencies import get_current_user
from models import City, InfraType, User
from schemas import ComplaintIngestRequest, ComplaintIngestResponse, TokenData
from services.complaint_service import (
    get_complaint_by_id as get_complaint_by_id_service,
    ingest_complaint as ingest_complaint_service,
)
from services.storage_service import generate_signed_upload_url

router = APIRouter(prefix="/complaints", tags=["Complaints"])


# ── Must come BEFORE /{complaint_id} so FastAPI doesn't match "map-pins" as a UUID ──

@router.get("/map-pins")
def get_map_pins(
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    """Returns lat/lng of the authenticated citizen's complaints for the dashboard map."""
    rows = db.execute(
        text("""
            SELECT
                id,
                complaint_number,
                title,
                status,
                priority,
                ST_Y(location::geometry) AS lat,
                ST_X(location::geometry) AS lng
            FROM complaints
            WHERE citizen_id = CAST(:uid AS uuid)
              AND is_deleted = false
              AND location IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 50
        """),
        {"uid": str(current_user.user_id)},
    ).mappings().all()

    return [
        {
            "id": str(row["id"]),
            "complaint_number": row["complaint_number"],
            "title": row["title"],
            "status": row["status"],
            "priority": row["priority"],
            "lat": float(row["lat"]),
            "lng": float(row["lng"]),
        }
        for row in rows
    ]


@router.get("/nearby")
def get_nearby_complaints(
    lat: float = Query(..., description="User latitude"),
    lng: float = Query(..., description="User longitude"),
    radius_meters: int = Query(default=4000, le=10000, description="Radius in metres"),
    limit: int = Query(default=100, le=200),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    """
    Returns ALL citizens' complaints within `radius_meters` of the given point.
    Used by the dashboard map to show the civic picture around the user's location.
    Default radius: 4 km.
    """
    rows = db.execute(
        text("""
            SELECT
                c.id,
                c.complaint_number,
                c.title,
                c.status,
                c.priority,
                c.is_repeat_complaint,
                c.created_at,
                ST_Y(c.location::geometry)                                      AS lat,
                ST_X(c.location::geometry)                                      AS lng,
                ST_Distance(
                    c.location::geography,
                    ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
                )                                                               AS distance_meters
            FROM complaints c
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

    return [
        {
            "id":                   str(row["id"]),
            "complaint_number":     row["complaint_number"],
            "title":                row["title"],
            "status":               row["status"],
            "priority":             row["priority"],
            "is_repeat_complaint":  bool(row["is_repeat_complaint"]),
            "lat":                  float(row["lat"]),
            "lng":                  float(row["lng"]),
            "distance_meters":      round(float(row["distance_meters"])),
            "created_at":           row["created_at"].isoformat() if row["created_at"] else None,
        }
        for row in rows
    ]
    
@router.get("")
def list_my_complaints(
    status: Optional[str] = Query(default=None, description="Filter by status"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    """Lists the authenticated citizen's own complaints, paginated."""

    status_filter = ""
    params = {
        "uid": str(current_user.user_id),
        "limit": limit,
        "offset": offset,
    }
    if status:
        status_filter = "AND status = :status"
        params["status"] = status

    rows = db.execute(
        text(f"""
            SELECT
                id,
                complaint_number,
                title,
                description,
                address_text,
                status,
                priority,
                is_repeat_complaint,
                images,
                created_at,
                updated_at,
                resolved_at,
                ST_Y(location::geometry) AS lat,
                ST_X(location::geometry) AS lng
            FROM complaints
            WHERE citizen_id = CAST(:uid AS uuid)
              AND is_deleted = false
              {status_filter}
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    ).mappings().all()

    count_row = db.execute(
        text(f"""
            SELECT COUNT(*) AS total
            FROM complaints
            WHERE citizen_id = CAST(:uid AS uuid)
              AND is_deleted = false
              {status_filter}
        """),
        params,
    ).mappings().first()

    def safe_image_url(images_jsonb):
        if not images_jsonb:
            return None
        imgs = images_jsonb if isinstance(images_jsonb, list) else []
        if imgs and isinstance(imgs[0], dict):
            return imgs[0].get("url")
        return None

    return {
        "total": int(count_row["total"]),
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(row["id"]),
                "complaint_number": row["complaint_number"],
                "title": row["title"],
                "description": row["description"],
                "address_text": row["address_text"],
                "status": row["status"],
                "priority": row["priority"],
                "is_repeat_complaint": bool(row["is_repeat_complaint"]),
                "thumbnail_url": safe_image_url(row["images"]),
                "created_at": row["created_at"].isoformat() if row["created_at"] else None,
                "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
                "resolved_at": row["resolved_at"].isoformat() if row["resolved_at"] else None,
                "lat": float(row["lat"]) if row["lat"] is not None else None,
                "lng": float(row["lng"]) if row["lng"] is not None else None,
            }
            for row in rows
        ],
    }


@router.get("/{complaint_id}/history")
def get_complaint_history(
    complaint_id: UUID,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    """Returns the status change history for a complaint (for the timeline)."""
    # First verify the complaint belongs to this user (or is admin/official)
    complaint_row = db.execute(
        text("""
            SELECT citizen_id FROM complaints
            WHERE id = CAST(:cid AS uuid) AND is_deleted = false
        """),
        {"cid": str(complaint_id)},
    ).mappings().first()

    if not complaint_row:
        raise HTTPException(status_code=404, detail="Complaint not found")

    if current_user.role == "citizen" and str(complaint_row["citizen_id"]) != str(current_user.user_id):
        raise HTTPException(status_code=403, detail="Not allowed")

    rows = db.execute(
        text("""
            SELECT
                old_status,
                new_status,
                reason,
                created_at
            FROM complaint_status_history
            WHERE complaint_id = CAST(:cid AS uuid)
            ORDER BY created_at ASC
        """),
        {"cid": str(complaint_id)},
    ).mappings().all()

    return [
        {
            "old_status": row["old_status"],
            "new_status": row["new_status"],
            "reason": row["reason"],
            "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        }
        for row in rows
    ]


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


@router.post("/ingest", response_model=ComplaintIngestResponse)
async def ingest_complaint(
    title: Optional[str] = Form(default=None),
    text: Optional[str] = Form(default=None),
    description: Optional[str] = Form(default=None),
    original_language: str = Form("en"),
    lat: float = Form(...),
    lng: float = Form(...),
    infra_type_id: Optional[UUID] = Form(default=None),
    address_text: Optional[str] = Form(default=None),
    infra_name: Optional[str] = Form(default=None),
    priority: str = Form(default="normal"),
    voice_transcript: Optional[str] = Form(default=None),
    agent_summary: Optional[str] = Form(default=None),
    agent_priority_reason: Optional[str] = Form(default=None),
    embedding_model: str = Form(default="nomic-embed-text-v1.5"),
    agent_suggested_dept_ids: Optional[str] = Form(default=None),
    images: List[UploadFile] = File(default=[]),
    image: Optional[UploadFile] = File(default=None),
    voice_recording: Optional[UploadFile] = File(default=None),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    allowed_roles = {"citizen", "admin", "super_admin"}
    if current_user.role not in allowed_roles:
        raise HTTPException(status_code=403, detail="You are not allowed to submit complaints")

    user = db.query(User).filter(User.id == current_user.user_id, User.is_active.is_(True)).first()
    if not user:
        raise HTTPException(status_code=401, detail="Authenticated user not found")

    if not user.city_id:
        raise HTTPException(status_code=400, detail="User city is not configured")

    city = db.query(City).filter(City.id == user.city_id).first()
    if not city:
        raise HTTPException(status_code=400, detail="User city record not found")

    resolved_infra_type_id = infra_type_id
    if resolved_infra_type_id is None:
        first_infra_type = db.query(InfraType).order_by(InfraType.created_at.asc()).first()
        if not first_infra_type:
            raise HTTPException(status_code=400, detail="No infra type configured in system")
        resolved_infra_type_id = first_infra_type.id

    resolved_description = (description or text or "").strip()
    if not resolved_description:
        raise HTTPException(status_code=400, detail="Complaint description is required")

    resolved_title = (title or resolved_description[:120]).strip()

    all_images = list(images)
    if image is not None:
        all_images.append(image)

    suggested_dept_ids = []
    if agent_suggested_dept_ids:
        suggested_dept_ids = [item.strip() for item in agent_suggested_dept_ids.split(",") if item.strip()]

    request = ComplaintIngestRequest(
        citizen_id=current_user.user_id,
        city_id=user.city_id,
        city_code=city.city_code,
        title=resolved_title,
        description=resolved_description,
        original_language=original_language,
        lat=lat,
        lng=lng,
        infra_type_id=resolved_infra_type_id,
        address_text=address_text,
        infra_name=infra_name,
        priority=priority,
        voice_transcript=voice_transcript,
        agent_summary=agent_summary,
        agent_priority_reason=agent_priority_reason,
        agent_suggested_dept_ids=suggested_dept_ids,
        embedding_model=embedding_model,
        images=all_images,
        voice_recording=voice_recording,
    )

    return await ingest_complaint_service(db, request)


@router.get("/complaints/upload-url")
def get_upload_url(
    complaint_id: str,
    content_type: str = "image/jpeg",
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    allowed_roles = ["citizen", "worker", "contractor"]
    if current_user.role not in allowed_roles:
        raise HTTPException(status_code=403, detail="Not allowed to upload images")

    try:
        result = generate_signed_upload_url(complaint_id, content_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return result


@router.patch("/complaints/{complaint_id}/images")
def append_complaint_image(
    complaint_id: str,
    file_url: str,
    object_path: str,
    content_type: str = "image/jpeg",
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    new_image = {
        "url": file_url,
        "object_path": object_path,
        "storage": "gcs",
        "mime_type": content_type,
        "uploaded_by": str(current_user.user_id),
        "uploaded_at": datetime.utcnow().isoformat(),
    }

    db.execute(
        text(
            """
            UPDATE complaints
            SET images = images || :new_image::jsonb,
                updated_at = now()
            WHERE id = CAST(:complaint_id AS uuid)
              AND is_deleted = false
        """
        ),
        {
            "complaint_id": complaint_id,
            "new_image": json.dumps(new_image),
        }
    )
    db.commit()

    return {"message": "Image appended successfully", "image": new_image}

