from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from db import get_db
from dependencies import get_current_user
from schemas import TokenData
from services.complaint_cluster_service import get_cluster_for_node
from services.infra_node_service import parse_requirements

router = APIRouter(prefix="/infra", tags=["Infra"])

ADMIN_ROLES = {"official", "admin", "super_admin"}


def _require(current_user: TokenData, roles: set) -> None:
    if current_user.role not in roles:
        raise HTTPException(status_code=403, detail="Insufficient role")


def _get_scope(db: Session, current_user: TokenData) -> Dict[str, Optional[str]]:
    row = db.execute(
        text(
            """
            SELECT city_id, department_id, jurisdiction_id
            FROM users
            WHERE id = CAST(:uid AS uuid)
            """
        ),
        {"uid": str(current_user.user_id)},
    ).mappings().first()

    if not row or not row["city_id"]:
        raise HTTPException(status_code=400, detail="User scope could not be determined")

    return {
        "city_id": str(row["city_id"]) if row["city_id"] else None,
        "dept_id": str(row["department_id"]) if row["department_id"] else None,
        "jur_id": str(row["jurisdiction_id"]) if row["jurisdiction_id"] else None,
    }


def _node_scope_where(current_user: TokenData, scope: Dict[str, Optional[str]]) -> tuple[str, Dict[str, Any]]:
    where = ["n.is_deleted = FALSE", "n.city_id = CAST(:city_id AS uuid)"]
    params: Dict[str, Any] = {"city_id": scope["city_id"]}

    if current_user.role in {"official", "admin"} and scope.get("dept_id"):
        where.append(
            """
            EXISTS (
                SELECT 1
                FROM complaints c
                WHERE c.infra_node_id = n.id
                  AND c.is_deleted = FALSE
                  AND CAST(:scope_dept_id AS uuid) = ANY(c.agent_suggested_dept_ids)
            )
            """
        )
        params["scope_dept_id"] = scope["dept_id"]

    if current_user.role == "official" and scope.get("jur_id"):
        where.append("n.jurisdiction_id = CAST(:scope_jur_id AS uuid)")
        params["scope_jur_id"] = scope["jur_id"]

    return " AND ".join(where), params


@router.get("/nodes")
def list_infra_nodes(
    dept_id: Optional[UUID] = Query(default=None),
    jurisdiction_id: Optional[UUID] = Query(default=None),
    status: Optional[str] = Query(default=None),
    infra_type_code: Optional[str] = Query(default=None),
    has_repeat: Optional[bool] = Query(default=None),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)
    scope = _get_scope(db, current_user)
    where_sql, params = _node_scope_where(current_user, scope)
    filters = [where_sql]

    if dept_id:
        filters.append(
            """
            EXISTS (
                SELECT 1 FROM complaints c
                WHERE c.infra_node_id = n.id
                  AND c.is_deleted = FALSE
                  AND CAST(:dept_id AS uuid) = ANY(c.agent_suggested_dept_ids)
            )
            """
        )
        params["dept_id"] = str(dept_id)
    if jurisdiction_id:
        filters.append("n.jurisdiction_id = CAST(:jurisdiction_id AS uuid)")
        params["jurisdiction_id"] = str(jurisdiction_id)
    if status:
        filters.append("n.status = :status")
        params["status"] = status
    if infra_type_code:
        filters.append("it.code = :infra_type_code")
        params["infra_type_code"] = infra_type_code
    if has_repeat is True:
        filters.append("n.last_resolved_at IS NOT NULL AND NOW() - n.last_resolved_at < (it.repeat_alert_years || ' years')::INTERVAL")

    where = " AND ".join(filters)
    params.update({"limit": limit, "offset": offset})

    rows = db.execute(
        text(
            f"""
            SELECT
                n.id,
                n.status,
                it.name AS infra_type_name,
                it.code AS infra_type_code,
                j.name AS jurisdiction_name,
                n.total_complaint_count,
                n.total_resolved_count,
                n.last_resolved_at,
                ST_Y(n.location::geometry) AS lat,
                ST_X(n.location::geometry) AS lng,
                (
                    SELECT ahl.health_score
                    FROM asset_health_logs ahl
                    WHERE ahl.infra_node_id = n.id
                    ORDER BY ahl.computed_at DESC
                    LIMIT 1
                ) AS health_score,
                (
                    SELECT COUNT(*)
                    FROM complaints c2
                    WHERE c2.infra_node_id = n.id
                      AND c2.is_deleted = FALSE
                      AND c2.status NOT IN ('resolved','closed','rejected')
                ) AS open_complaint_count
            FROM infra_nodes n
            JOIN infra_types it ON it.id = n.infra_type_id
            LEFT JOIN jurisdictions j ON j.id = n.jurisdiction_id
            WHERE {where}
            ORDER BY n.updated_at DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    ).mappings().all()

    total = db.execute(
        text(
            f"""
            SELECT COUNT(*)
            FROM infra_nodes n
            JOIN infra_types it ON it.id = n.infra_type_id
            LEFT JOIN jurisdictions j ON j.id = n.jurisdiction_id
            WHERE {where}
            """
        ),
        {k: v for k, v in params.items() if k not in {"limit", "offset"}},
    ).scalar() or 0

    return {
        "total": int(total),
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(r["id"]),
                "status": r["status"],
                "infra_type_name": r["infra_type_name"],
                "infra_type_code": r["infra_type_code"],
                "jurisdiction_name": r["jurisdiction_name"],
                "total_complaint_count": int(r["total_complaint_count"] or 0),
                "total_resolved_count": int(r["total_resolved_count"] or 0),
                "last_resolved_at": r["last_resolved_at"].isoformat() if r["last_resolved_at"] else None,
                "lat": float(r["lat"]) if r["lat"] is not None else None,
                "lng": float(r["lng"]) if r["lng"] is not None else None,
                "health_score": float(r["health_score"]) if r["health_score"] is not None else None,
                "open_complaint_count": int(r["open_complaint_count"] or 0),
            }
            for r in rows
        ],
    }


@router.get("/nodes/map")
def get_infra_nodes_map(
    dept_id: Optional[UUID] = Query(default=None),
    jurisdiction_id: Optional[UUID] = Query(default=None),
    status: Optional[str] = Query(default=None),
    infra_type_code: Optional[str] = Query(default=None),
    has_repeat: Optional[bool] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)
    scope = _get_scope(db, current_user)
    where_sql, params = _node_scope_where(current_user, scope)
    filters = [where_sql]

    if dept_id:
        filters.append(
            """
            EXISTS (
                SELECT 1 FROM complaints c
                WHERE c.infra_node_id = n.id
                  AND c.is_deleted = FALSE
                  AND CAST(:dept_id AS uuid) = ANY(c.agent_suggested_dept_ids)
            )
            """
        )
        params["dept_id"] = str(dept_id)
    if jurisdiction_id:
        filters.append("n.jurisdiction_id = CAST(:jurisdiction_id AS uuid)")
        params["jurisdiction_id"] = str(jurisdiction_id)
    if status:
        filters.append("n.status = :status")
        params["status"] = status
    if infra_type_code:
        filters.append("it.code = :infra_type_code")
        params["infra_type_code"] = infra_type_code
    if has_repeat is True:
        filters.append("n.last_resolved_at IS NOT NULL AND NOW() - n.last_resolved_at < (it.repeat_alert_years || ' years')::INTERVAL")

    where = " AND ".join(filters)

    rows = db.execute(
        text(
            f"""
            SELECT
                n.id,
                n.status,
                it.code AS infra_type_code,
                it.name AS infra_type_name,
                n.total_complaint_count,
                n.cluster_ai_summary,
                n.cluster_severity,
                n.cluster_major_themes,
                (
                    SELECT COUNT(*)
                    FROM complaints c2
                    WHERE c2.infra_node_id = n.id
                      AND c2.is_deleted = FALSE
                      AND c2.status NOT IN ('resolved','closed','rejected')
                ) AS open_complaint_count,
                CASE
                    WHEN n.last_resolved_at IS NOT NULL
                         AND NOW() - n.last_resolved_at < (it.repeat_alert_years || ' years')::INTERVAL
                    THEN TRUE
                    ELSE FALSE
                END AS is_repeat_risk,
                (
                    SELECT ahl.health_score
                    FROM asset_health_logs ahl
                    WHERE ahl.infra_node_id = n.id
                    ORDER BY ahl.computed_at DESC
                    LIMIT 1
                ) AS health_score,
                ST_X(n.location::geometry) AS lng,
                ST_Y(n.location::geometry) AS lat
            FROM infra_nodes n
            JOIN infra_types it ON it.id = n.infra_type_id
            WHERE {where}
            ORDER BY n.updated_at DESC
            """
        ),
        params,
    ).mappings().all()

    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [float(r["lng"]), float(r["lat"])]},
            "properties": {
                "id": str(r["id"]),
                "status": r["status"],
                "infra_type_code": r["infra_type_code"],
                "infra_type_name": r["infra_type_name"],
                "total_complaint_count": int(r["total_complaint_count"] or 0),
                "open_complaint_count": int(r["open_complaint_count"] or 0),
                "is_repeat_risk": bool(r["is_repeat_risk"]),
                "health_score": float(r["health_score"]) if r["health_score"] is not None else None,
                "cluster_ai_summary": r["cluster_ai_summary"],
                "cluster_severity": r["cluster_severity"],
                "cluster_major_themes": r["cluster_major_themes"] or [],
                # Parsed requirements object for frontend — same data, structured
                "requirements": parse_requirements(r["cluster_ai_summary"]),
            },
        }
        for r in rows
        if r["lng"] is not None and r["lat"] is not None
    ]

    return {"type": "FeatureCollection", "features": features}


@router.get("/nodes/{node_id}/history")
def get_node_history(
    node_id: UUID,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)

    complaints = db.execute(
        text(
            """
            SELECT
                c.id,
                c.complaint_number,
                c.title,
                c.status,
                c.priority,
                c.created_at,
                c.resolved_at,
                c.is_repeat_complaint,
                co.company_name AS assigned_contractor,
                wu.full_name AS assigned_worker
            FROM complaints c
            LEFT JOIN LATERAL (
                SELECT t.assigned_contractor_id, t.assigned_worker_id
                FROM tasks t
                WHERE t.complaint_id = c.id
                ORDER BY t.created_at DESC
                LIMIT 1
            ) lt ON TRUE
            LEFT JOIN contractors co ON co.id = lt.assigned_contractor_id
            LEFT JOIN workers wk ON wk.id = lt.assigned_worker_id
            LEFT JOIN users wu ON wu.id = wk.user_id
            WHERE c.infra_node_id = CAST(:nid AS uuid)
              AND c.is_deleted = FALSE
            ORDER BY c.created_at DESC
            """
        ),
        {"nid": str(node_id)},
    ).mappings().all()

    workflows = db.execute(
        text(
            """
            SELECT wi.id, wi.status, wi.completed_at, wi.created_at
            FROM workflow_instances wi
            WHERE wi.infra_node_id = CAST(:nid AS uuid)
            ORDER BY wi.created_at DESC
            """
        ),
        {"nid": str(node_id)},
    ).mappings().all()

    return {
        "node_id": str(node_id),
        "complaints": [
            {
                "id": str(c["id"]),
                "complaint_number": c["complaint_number"],
                "title": c["title"],
                "status": c["status"],
                "priority": c["priority"],
                "created_at": c["created_at"].isoformat() if c["created_at"] else None,
                "resolved_at": c["resolved_at"].isoformat() if c["resolved_at"] else None,
                "is_repeat_complaint": bool(c["is_repeat_complaint"]),
                "assigned_contractor": c["assigned_contractor"],
                "assigned_worker": c["assigned_worker"],
            }
            for c in complaints
        ],
        "workflow_instances": [
            {
                "id": str(w["id"]),
                "status": w["status"],
                "created_at": w["created_at"].isoformat() if w["created_at"] else None,
                "completed_at": w["completed_at"].isoformat() if w["completed_at"] else None,
            }
            for w in workflows
        ],
    }


@router.get("/nodes/{node_id}/repeat-issues")
def get_node_repeat_issues(
    node_id: UUID,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)

    node = db.execute(
        text(
            """
            SELECT n.last_resolved_at, it.repeat_alert_years
            FROM infra_nodes n
            JOIN infra_types it ON it.id = n.infra_type_id
            WHERE n.id = CAST(:nid AS uuid) AND n.is_deleted = FALSE
            """
        ),
        {"nid": str(node_id)},
    ).mappings().first()
    if not node:
        raise HTTPException(status_code=404, detail="Infra node not found")

    repeat_check = db.execute(
        text("SELECT * FROM fn_check_repeat_complaint(CAST(:nid AS uuid))"),
        {"nid": str(node_id)},
    ).mappings().first()

    contractor = db.execute(
        text(
            """
            SELECT co.id, co.company_name, co.registration_number
            FROM complaints c
            JOIN tasks t ON t.complaint_id = c.id
            JOIN contractors co ON co.id = t.assigned_contractor_id
            WHERE c.infra_node_id = CAST(:nid AS uuid)
              AND c.status IN ('resolved','closed')
              AND c.is_deleted = FALSE
            ORDER BY c.resolved_at DESC NULLS LAST, t.created_at DESC
            LIMIT 1
            """
        ),
        {"nid": str(node_id)},
    ).mappings().first()

    repeat_count = db.execute(
        text(
            """
            SELECT COUNT(*)
            FROM complaints c
            WHERE c.infra_node_id = CAST(:nid AS uuid)
              AND c.is_deleted = FALSE
              AND (:last_resolved_at IS NULL OR c.created_at > :last_resolved_at)
            """
        ),
        {"nid": str(node_id), "last_resolved_at": node["last_resolved_at"]},
    ).scalar() or 0

    gap_days = None
    if node["last_resolved_at"]:
        gap_days_row = db.execute(
            text("SELECT EXTRACT(DAY FROM NOW() - CAST(:last_resolved_at AS timestamptz))::int AS gap_days"),
            {"last_resolved_at": node["last_resolved_at"]},
        ).mappings().first()
        gap_days = gap_days_row["gap_days"] if gap_days_row else None

    return {
        "node_id": str(node_id),
        "is_within_warranty": bool(repeat_check["is_repeat"]) if repeat_check else False,
        "last_resolved_at": node["last_resolved_at"].isoformat() if node["last_resolved_at"] else None,
        "gap_days": gap_days,
        "warranty_years": int(node["repeat_alert_years"] or 0),
        "last_contractor": {
            "id": str(contractor["id"]),
            "company_name": contractor["company_name"],
            "registration_number": contractor["registration_number"],
        } if contractor else None,
        "repeat_complaint_count": int(repeat_count),
        "repeat_check": {
            "previous_resolved_at": repeat_check["previous_resolved_at"].isoformat() if repeat_check and repeat_check["previous_resolved_at"] else None,
            "gap_days": repeat_check["gap_days"] if repeat_check else None,
            "last_resolved_workflow_id": str(repeat_check["last_resolved_workflow_id"]) if repeat_check and repeat_check["last_resolved_workflow_id"] else None,
        },
    }


class NodeCreateOrMatchRequest(BaseModel):
    lat: float
    lng: float
    infra_type_id: UUID
    city_id: UUID
    name: Optional[str] = None


@router.post("/nodes/create-or-match")
def create_or_match_node(
    body: NodeCreateOrMatchRequest,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    _require(current_user, ADMIN_ROLES)

    matched = db.execute(
        text(
            """
            SELECT infra_node_id, distance_meters
            FROM fn_find_infra_node_for_cluster(
                ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geometry,
                CAST(:infra_type_id AS uuid),
                CAST(:city_id AS uuid)
            )
            LIMIT 1
            """
        ),
        {
            "lng": body.lng,
            "lat": body.lat,
            "infra_type_id": str(body.infra_type_id),
            "city_id": str(body.city_id),
        },
    ).mappings().first()

    if matched and matched.get("infra_node_id"):
        return {
            "matched": True,
            "node_id": str(matched["infra_node_id"]),
            "distance_meters": float(matched["distance_meters"]) if matched.get("distance_meters") is not None else None,
        }

    created = db.execute(
        text(
            """
            INSERT INTO infra_nodes (
                city_id,
                infra_type_id,
                name,
                location,
                location_hash,
                status
            ) VALUES (
                CAST(:city_id AS uuid),
                CAST(:infra_type_id AS uuid),
                :name,
                ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geometry,
                ST_GeoHash(ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geometry, 8),
                'operational'
            )
            RETURNING id
            """
        ),
        {
            "city_id": str(body.city_id),
            "infra_type_id": str(body.infra_type_id),
            "name": body.name,
            "lng": body.lng,
            "lat": body.lat,
        },
    ).mappings().first()
    db.commit()

    return {
        "matched": False,
        "node_id": str(created["id"]),
    }


@router.get("/nodes/{node_id}/cluster")
def get_node_cluster(
    node_id: UUID,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user),
):
    """
    Returns the complaint cluster for an infra node — all grouped complaints,
    parsed requirements JSON, and aggregated photos from all complaints.
    """
    _require(current_user, ADMIN_ROLES)
    cluster = get_cluster_for_node(db, str(node_id))

    # Parse requirements from infra node
    node_row = db.execute(
        text("""
            SELECT cluster_ai_summary, cluster_severity, cluster_summary_at
            FROM infra_nodes WHERE id = CAST(:nid AS uuid) AND is_deleted = FALSE
        """),
        {"nid": str(node_id)},
    ).mappings().first()

    requirements = parse_requirements(node_row["cluster_ai_summary"]) if node_row else None

    # Aggregate all photos from all complaints on this node
    photo_rows = db.execute(
        text("""
            SELECT c.id, c.complaint_number, c.images, c.created_at
            FROM complaints c
            WHERE c.infra_node_id = CAST(:nid AS uuid)
              AND c.is_deleted = FALSE
              AND jsonb_array_length(COALESCE(c.images, '[]'::jsonb)) > 0
            ORDER BY c.created_at DESC
        """),
        {"nid": str(node_id)},
    ).mappings().all()

    all_photos = []
    for row in photo_rows:
        imgs = row["images"]
        if imgs and isinstance(imgs, list):
            for img in imgs:
                if isinstance(img, dict) and img.get("url"):
                    all_photos.append({
                        "url":              img["url"],
                        "mime_type":        img.get("mime_type", "image/jpeg"),
                        "complaint_id":     str(row["id"]),
                        "complaint_number": row["complaint_number"],
                        "uploaded_at":      row["created_at"].isoformat() if row["created_at"] else None,
                    })

    if not cluster:
        return {
            "cluster_id":      None,
            "complaint_count": 0,
            "cluster_summary": None,
            "requirements":    requirements,
            "photos":          all_photos,
            "members":         [],
        }

    return {
        **cluster,
        "requirements": requirements,
        "photos":        all_photos,
    }