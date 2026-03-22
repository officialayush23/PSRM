# backend/routes/worker_router.py
"""
Worker & Contractor task management.
Workers/contractors: view assigned tasks, submit updates with before/after photos + GPS.
"""
import json
import logging
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import text
from sqlalchemy.orm import Session

from db import get_db
from dependencies import get_current_user
from schemas import TokenData
from services.storage_service import save_upload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/worker", tags=["Worker"])


def _require_worker_or_contractor(current_user: TokenData):
    if current_user.role not in ("worker", "contractor", "official", "admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Worker or contractor access required")
    return current_user


# ── My assigned tasks ─────────────────────────────────────────────

@router.get("/tasks")
def get_my_tasks(
    status: Optional[str] = Query(default=None),
    limit:  int           = Query(default=30, le=100),
    offset: int           = Query(default=0,  ge=0),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require_worker_or_contractor(current_user)

    # Resolve worker_id / contractor_id
    uid = str(current_user.user_id)

    if current_user.role == "worker":
        id_filter = "t.assigned_worker_id = (SELECT id FROM workers WHERE user_id = CAST(:uid AS uuid) LIMIT 1)"
    elif current_user.role == "contractor":
        id_filter = "t.assigned_contractor_id = (SELECT id FROM contractors WHERE user_id = CAST(:uid AS uuid) LIMIT 1)"
    else:
        id_filter = "1=1"  # admin/official/super_admin sees all tasks

    status_filter = ""
    params = {"uid": uid, "limit": limit, "offset": offset}
    if status:
        status_filter = "AND t.status = :status"
        params["status"] = status

    rows = db.execute(
        text(f"""
            SELECT
                t.id, t.title, t.description, t.status, t.priority,
                t.task_type, t.created_at, t.updated_at, t.due_date,
                t.photos, t.notes, t.completion_notes,
                t.before_photos, t.after_photos,
                ST_Y(t.location::geometry) AS lat,
                ST_X(t.location::geometry) AS lng,
                t.location_description,
                c.complaint_number, c.title AS complaint_title,
                c.address_text,
                c.status AS complaint_status,
                it.name AS infra_type_name,
                it.code AS infra_type_code,
                wi.id   AS workflow_instance_id,
                wsi.step_number, wsi.name AS step_name
            FROM tasks t
            LEFT JOIN complaints           c   ON c.id   = t.complaint_id
            LEFT JOIN infra_nodes          n   ON n.id   = c.infra_node_id
            LEFT JOIN infra_types          it  ON it.id  = n.infra_type_id
            LEFT JOIN workflow_instances   wi  ON wi.id  = t.workflow_instance_id
            LEFT JOIN workflow_step_instances wsi ON wsi.workflow_instance_id = wi.id
                                                  AND wsi.step_number = wi.current_step_number
            WHERE {id_filter}
              AND t.is_deleted = FALSE
              {status_filter}
            ORDER BY
                CASE t.priority
                    WHEN 'emergency' THEN 1 WHEN 'critical' THEN 2
                    WHEN 'high'      THEN 3 WHEN 'normal'   THEN 4
                    WHEN 'low'       THEN 5 END,
                t.created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    ).mappings().all()

    count = db.execute(
        text(f"""
            SELECT COUNT(*) FROM tasks t
            WHERE {id_filter} AND t.is_deleted = FALSE {status_filter}
        """),
        params,
    ).scalar()

    def _photos(col):
        if not col: return []
        return col if isinstance(col, list) else []

    return {
        "total":  int(count or 0),
        "limit":  limit,
        "offset": offset,
        "items": [
            {
                "id":                  str(r["id"]),
                "title":               r["title"],
                "description":         r["description"],
                "status":              r["status"],
                "priority":            r["priority"],
                "task_type":           r["task_type"],
                "due_date":            r["due_date"].isoformat() if r["due_date"] else None,
                "created_at":          r["created_at"].isoformat() if r["created_at"] else None,
                "updated_at":          r["updated_at"].isoformat() if r["updated_at"] else None,
                "complaint_number":    r["complaint_number"],
                "complaint_title":     r["complaint_title"],
                "complaint_status":    r["complaint_status"],
                "address_text":        r["address_text"],
                "infra_type_name":     r["infra_type_name"],
                "infra_type_code":     r["infra_type_code"],
                "lat":                 float(r["lat"]) if r["lat"] else None,
                "lng":                 float(r["lng"]) if r["lng"] else None,
                "location_description":r["location_description"],
                "step_number":         r["step_number"],
                "step_name":           r["step_name"],
                "before_photos":       _photos(r["before_photos"]),
                "after_photos":        _photos(r["after_photos"]),
                "notes":               r["notes"],
                "completion_notes":    r["completion_notes"],
            }
            for r in rows
        ],
    }


# ── Single task detail ────────────────────────────────────────────

@router.get("/tasks/{task_id}")
def get_task_detail(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require_worker_or_contractor(current_user)

    row = db.execute(
        text("""
            SELECT
                t.*,
                ST_Y(t.location::geometry) AS lat,
                ST_X(t.location::geometry) AS lng,
                c.complaint_number, c.title AS complaint_title,
                c.description AS complaint_description,
                c.address_text, c.status AS complaint_status,
                c.agent_summary,
                it.name AS infra_type_name,
                it.code AS infra_type_code,
                it.metadata AS infra_metadata
            FROM tasks t
            LEFT JOIN complaints c  ON c.id  = t.complaint_id
            LEFT JOIN infra_nodes n ON n.id  = c.infra_node_id
            LEFT JOIN infra_types it ON it.id = n.infra_type_id
            WHERE t.id = CAST(:tid AS uuid) AND t.is_deleted = FALSE
        """),
        {"tid": str(task_id)},
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Task not found")

    return dict(row) | {
        "lat": float(row["lat"]) if row["lat"] else None,
        "lng": float(row["lng"]) if row["lng"] else None,
    }


# ── Submit task update (before/after photos + GPS + description) ──

@router.post("/tasks/{task_id}/update")
async def update_task(
    task_id:      UUID,
    update_type:  str           = Form(..., description="before_photo | after_photo | progress_note | complete"),
    notes:        Optional[str] = Form(default=None),
    lat:          Optional[float] = Form(default=None),
    lng:          Optional[float] = Form(default=None),
    photos:       List[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    """
    Workers/contractors submit task progress updates.
    update_type:
      before_photo  — photos taken before work starts
      after_photo   — photos taken after work completes
      progress_note — text update mid-task
      complete      — mark task as completed
    """
    _require_worker_or_contractor(current_user)

    task = db.execute(
        text("SELECT id, status, complaint_id, workflow_instance_id FROM tasks WHERE id = CAST(:tid AS uuid) AND is_deleted = FALSE"),
        {"tid": str(task_id)},
    ).mappings().first()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["status"] == "completed":
        raise HTTPException(status_code=400, detail="Task already completed")

    # Upload photos
    uploaded_photos = []
    for upload in photos:
        content = await upload.read()
        if not content:
            continue
        saved = save_upload(content, upload.filename or "photo.jpg", upload.content_type)
        uploaded_photos.append({
            "url":         saved["url"],
            "storage":     saved["storage"],
            "uploaded_by": str(current_user.user_id),
            "uploaded_at": datetime.utcnow().isoformat(),
            "update_type": update_type,
        })

    now = datetime.utcnow()

    if update_type == "before_photo" and uploaded_photos:
        db.execute(
            text("""
                UPDATE tasks
                   SET before_photos = COALESCE(before_photos, '[]'::jsonb) || CAST(:photos AS jsonb),
                       status        = CASE WHEN status = 'assigned' THEN 'in_progress' ELSE status END,
                       updated_at    = NOW()
                 WHERE id = CAST(:tid AS uuid)
            """),
            {"tid": str(task_id), "photos": json.dumps(uploaded_photos)},
        )

    elif update_type == "after_photo" and uploaded_photos:
        db.execute(
            text("""
                UPDATE tasks
                   SET after_photos = COALESCE(after_photos, '[]'::jsonb) || CAST(:photos AS jsonb),
                       updated_at   = NOW()
                 WHERE id = CAST(:tid AS uuid)
            """),
            {"tid": str(task_id), "photos": json.dumps(uploaded_photos)},
        )

    elif update_type == "progress_note":
        new_note = {
            "note":        notes,
            "by":          str(current_user.user_id),
            "at":          now.isoformat(),
            "photos":      uploaded_photos,
            "lat":         lat,
            "lng":         lng,
        }
        db.execute(
            text("""
                UPDATE tasks
                   SET notes      = COALESCE(notes::jsonb, '[]'::jsonb) || CAST(:note AS jsonb),
                       status     = CASE WHEN status = 'assigned' THEN 'in_progress' ELSE status END,
                       updated_at = NOW()
                 WHERE id = CAST(:tid AS uuid)
            """),
            {"tid": str(task_id), "note": json.dumps([new_note])},
        )

    elif update_type == "complete":
        if not uploaded_photos:
            raise HTTPException(status_code=400, detail="After photo required to mark complete")

        # Save after photos and mark complete
        db.execute(
            text("""
                UPDATE tasks
                   SET after_photos     = COALESCE(after_photos, '[]'::jsonb) || CAST(:photos AS jsonb),
                       status           = 'completed',
                       completion_notes = :notes,
                       completed_at     = NOW(),
                       updated_at       = NOW()
                 WHERE id = CAST(:tid AS uuid)
            """),
            {
                "tid":    str(task_id),
                "photos": json.dumps(uploaded_photos),
                "notes":  notes,
            },
        )

        # Advance workflow step if linked
        if task["workflow_instance_id"]:
            db.execute(
                text("""
                    UPDATE workflow_step_instances
                       SET status       = 'completed',
                           completed_at = NOW()
                     WHERE workflow_instance_id = CAST(:wid AS uuid)
                       AND status = 'pending'
                       AND step_number = (
                           SELECT current_step_number FROM workflow_instances
                           WHERE id = CAST(:wid AS uuid)
                       )
                """),
                {"wid": str(task["workflow_instance_id"])},
            )
            db.execute(
                text("""
                    UPDATE workflow_instances
                       SET current_step_number = current_step_number + 1,
                           updated_at          = NOW()
                     WHERE id = CAST(:wid AS uuid)
                       AND current_step_number < total_steps
                """),
                {"wid": str(task["workflow_instance_id"])},
            )

        # Decrement worker task count
        db.execute(
            text("""
                UPDATE workers
                   SET current_task_count = GREATEST(0, current_task_count - 1)
                 WHERE user_id = CAST(:uid AS uuid)
            """),
            {"uid": str(current_user.user_id)},
        )

    db.commit()
    return {"status": "updated", "update_type": update_type, "photos_uploaded": len(uploaded_photos)}