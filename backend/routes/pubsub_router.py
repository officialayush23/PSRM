import base64
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from config import settings
from db import get_db
from services.notification_service import dispatch_notification

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pubsub", tags=["PubSub"])


def _verify_pubsub_request(request: Request) -> None:
    """
    Allow either:
    - GCP push-style request marker header (X-Goog-Resource-State), or
    - Bearer token matching PUBSUB_PUSH_SECRET when configured.
    """
    if not settings.PUBSUB_PUSH_SECRET:
        return

    if request.headers.get("x-goog-resource-state"):
        return

    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
        if token == settings.PUBSUB_PUSH_SECRET:
            return

    raise HTTPException(status_code=401, detail="Unauthorized Pub/Sub push request")


def _decode_pubsub_envelope(body: Dict[str, Any]) -> Dict[str, Any]:
    msg = body.get("message") if isinstance(body, dict) else None
    if not isinstance(msg, dict):
        raise HTTPException(status_code=400, detail="Invalid Pub/Sub envelope: missing message")

    data_b64 = msg.get("data")
    if not data_b64:
        return {}

    try:
        decoded = base64.b64decode(data_b64).decode("utf-8")
        payload = json.loads(decoded)
        if not isinstance(payload, dict):
            raise ValueError("Decoded payload is not a JSON object")
        return payload
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid Pub/Sub message data: {exc}") from exc


def _to_uuid_or_none(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        return str(uuid.UUID(str(value)))
    except Exception:
        return None


def _write_pubsub_log(
    db: Session,
    *,
    topic: str,
    event_type: str,
    payload: Dict[str, Any],
    status: str = "processed",
    complaint_id: Optional[str] = None,
    workflow_instance_id: Optional[str] = None,
    user_id: Optional[str] = None,
    message_id: Optional[str] = None,
) -> None:
    db.execute(
        text(
            """
            INSERT INTO pubsub_event_log (
                event_type,
                pubsub_topic,
                pubsub_message_id,
                published_at,
                ack_at,
                payload,
                complaint_id,
                workflow_instance_id,
                user_id,
                processed_by,
                processing_status,
                processed_at
            ) VALUES (
                :event_type,
                :topic,
                :message_id,
                NOW(),
                NOW(),
                CAST(:payload AS jsonb),
                CAST(:complaint_id AS uuid),
                CAST(:workflow_instance_id AS uuid),
                CAST(:user_id AS uuid),
                'pubsub_router',
                :status,
                NOW()
            )
            """
        ),
        {
            "event_type": event_type,
            "topic": topic,
            "message_id": message_id,
            "payload": json.dumps(payload),
            "complaint_id": _to_uuid_or_none(complaint_id),
            "workflow_instance_id": _to_uuid_or_none(workflow_instance_id),
            "user_id": _to_uuid_or_none(user_id),
            "status": status,
        },
    )


def _get_template_id(db: Session, survey_type: str) -> Optional[str]:
    row = db.execute(
        text("SELECT id FROM survey_templates WHERE survey_type=:st AND is_active=TRUE LIMIT 1"),
        {"st": survey_type},
    ).first()
    return str(row[0]) if row else None


@router.post("/complaint-received")
async def pubsub_complaint_received(request: Request, db: Session = Depends(get_db)):
    _verify_pubsub_request(request)
    body = await request.json()
    payload = _decode_pubsub_envelope(body)

    complaint_id  = str(payload.get("complaint_id") or "")
    infra_node_id = payload.get("infra_node_id")
    is_repeat     = bool(payload.get("is_repeat"))
    event_type    = str(payload.get("event_type") or "COMPLAINT_RECEIVED")
    citizen_id    = str(payload.get("citizen_id") or payload.get("user_id") or "")
    complaint_number = str(payload.get("complaint_number") or "")

    # ── 1. Notify citizen that complaint was registered ───────────
    if citizen_id and complaint_number and complaint_id:
        try:
            dispatch_notification(
                db,
                user_id=citizen_id,
                event_type="COMPLAINT_RECEIVED",
                variables={"number": complaint_number},
                data={"complaint_id": complaint_id},
                cta_url=f"/complaints/{complaint_id}",
            )
        except Exception as exc:
            logger.warning("Citizen complaint_received notification failed: %s", exc)

    # ── 2. If repeat → notify officials ──────────────────────────
    if is_repeat and complaint_id:
        try:
            officials = db.execute(
                text("""
                    SELECT DISTINCT u.id, c.complaint_number
                    FROM complaints c
                    JOIN users u ON u.department_id = ANY(c.agent_suggested_dept_ids)
                    WHERE c.id = CAST(:cid AS uuid)
                      AND u.role IN ('official', 'admin')
                      AND u.is_active = TRUE
                """),
                {"cid": complaint_id},
            ).mappings().all()
            for row in officials:
                dispatch_notification(
                    db,
                    user_id=str(row["id"]),
                    event_type="REPEAT_COMPLAINT_ALERT",
                    variables={"number": complaint_number or str(row.get("complaint_number") or "-")},
                    data={"complaint_id": complaint_id, "infra_node_id": str(infra_node_id or "")},
                )
        except Exception as exc:
            logger.warning("Repeat complaint official notification failed: %s", exc)

    # ── 3. Notify citizens within 500m of infra node ──────────────
    if infra_node_id and complaint_id:
        try:
            node_loc = db.execute(
                text("SELECT location FROM infra_nodes WHERE id = CAST(:nid AS uuid)"),
                {"nid": str(infra_node_id)},
            ).scalar()
            if node_loc:
                area_users = db.execute(
                    text("""
                        SELECT DISTINCT u.id
                        FROM users u
                        WHERE u.id != CAST(:cid AS uuid)
                          AND u.is_active = TRUE
                          AND u.role = 'citizen'
                          AND u.fcm_token IS NOT NULL
                          AND EXISTS (
                              SELECT 1 FROM complaints c2
                              WHERE c2.citizen_id = u.id
                                AND ST_DWithin(c2.location::geography, CAST(:loc AS geography), 500)
                          )
                    """),
                    {"cid": citizen_id or "00000000-0000-0000-0000-000000000000",
                     "loc": str(node_loc)},
                ).mappings().all()
                for row in area_users:
                    try:
                        dispatch_notification(
                            db,
                            user_id=str(row["id"]),
                            event_type="COMPLAINT_RECEIVED",
                            variables={"number": complaint_number},
                            data={"complaint_id": complaint_id, "infra_node_id": str(infra_node_id)},
                        )
                    except Exception:
                        pass
        except Exception as exc:
            logger.warning("Area citizen notification failed: %s", exc)

    _write_pubsub_log(
        db,
        topic="ps-crm-complaints",
        event_type=event_type,
        payload=payload,
        complaint_id=complaint_id,
        user_id=citizen_id,
    )
    db.commit()
    return {"status": "processed"}


@router.post("/workflow-events")
async def pubsub_workflow_events(request: Request, db: Session = Depends(get_db)):
    _verify_pubsub_request(request)
    body = await request.json()
    payload = _decode_pubsub_envelope(body)

    workflow_instance_id = str(payload.get("workflow_instance_id") or "")
    event_type = str(payload.get("event_type") or "WORKFLOW_EVENT")
    step_number = payload.get("step_number")
    total_steps = payload.get("total_steps")

    if event_type == "WORKFLOW_STEP_COMPLETED" and isinstance(step_number, int) and isinstance(total_steps, int):
        midpoint = total_steps // 2
        if midpoint > 0 and step_number == midpoint:
            db.execute(
                text(
                    """
                    INSERT INTO cloud_task_schedule (
                        cloud_task_name,
                        queue_name,
                        task_type,
                        workflow_instance_id,
                        payload,
                        scheduled_for,
                        schedule_delay_seconds,
                        status
                    ) VALUES (
                        :cloud_task_name,
                        :queue_name,
                        'TRIGGER_SURVEY',
                        CAST(:workflow_instance_id AS uuid),
                        CAST(:payload AS jsonb),
                        NOW() + INTERVAL '24 hours',
                        86400,
                        'scheduled'
                    )
                    """
                ),
                {
                    "cloud_task_name": f"trigger-survey-{workflow_instance_id}-{int(datetime.now(timezone.utc).timestamp())}",
                    "queue_name": "ps-crm-survey-queue",
                    "workflow_instance_id": workflow_instance_id,
                    "payload": json.dumps(
                        {
                            "workflow_instance_id": workflow_instance_id,
                            "event_type": event_type,
                            "step_number": step_number,
                            "total_steps": total_steps,
                            "survey_type": "midway",
                        }
                    ),
                },
            )

    if event_type == "WORKFLOW_COMPLETED":
        complaint_id = str(payload.get("complaint_id") or "")
        if complaint_id:
            complaint = db.execute(
                text("SELECT citizen_id, complaint_number FROM complaints WHERE id = CAST(:cid AS uuid)"),
                {"cid": complaint_id},
            ).mappings().first()
            if complaint:
                template_id = _get_template_id(db, "midway")
                if template_id:
                    already_exists = db.execute(
                        text(
                            """
                            SELECT 1
                            FROM survey_instances
                            WHERE complaint_id = CAST(:complaint_id AS uuid)
                              AND survey_type = 'midway'
                              AND status IN ('pending', 'sent')
                            LIMIT 1
                            """
                        ),
                        {"complaint_id": complaint_id},
                    ).first()
                    if not already_exists:
                        survey_instance_id = str(uuid.uuid4())
                        db.execute(
                            text(
                                """
                                INSERT INTO survey_instances (
                                    id,
                                    template_id,
                                    workflow_instance_id,
                                    complaint_id,
                                    survey_type,
                                    target_user_id,
                                    target_role,
                                    status,
                                    triggered_by,
                                    channel,
                                    expires_at
                                ) VALUES (
                                    CAST(:id AS uuid),
                                    CAST(:template_id AS uuid),
                                    CAST(:workflow_instance_id AS uuid),
                                    CAST(:complaint_id AS uuid),
                                    'midway',
                                    CAST(:target_user_id AS uuid),
                                    'citizen',
                                    'pending',
                                    'agent',
                                    'portal',
                                    NOW() + INTERVAL '7 days'
                                )
                                """
                            ),
                            {
                                "id": survey_instance_id,
                                "template_id": template_id,
                                "workflow_instance_id": _to_uuid_or_none(workflow_instance_id),
                                "complaint_id": complaint_id,
                                "target_user_id": str(complaint["citizen_id"]),
                            },
                        )
                        dispatch_notification(
                            db,
                            user_id=str(complaint["citizen_id"]),
                            event_type="MIDWAY_SURVEY",
                            variables={"number": complaint["complaint_number"]},
                            data={
                                "survey_instance_id": survey_instance_id,
                                "complaint_id": complaint_id,
                                "workflow_instance_id": workflow_instance_id,
                            },
                        )

    _write_pubsub_log(
        db,
        topic="ps-crm-workflow-events",
        event_type=event_type,
        payload=payload,
        workflow_instance_id=workflow_instance_id,
        complaint_id=str(payload.get("complaint_id") or ""),
    )
    db.commit()
    return {"status": "processed"}


@router.post("/notifications")
async def pubsub_notifications(request: Request, db: Session = Depends(get_db)):
    _verify_pubsub_request(request)
    body = await request.json()
    payload = _decode_pubsub_envelope(body)

    user_id = str(payload.get("user_id") or "")
    event_type = str(payload.get("event_type") or "NOTIFICATION")
    variables = payload.get("variables") or {}
    data = payload.get("data") or {}

    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required in notifications payload")

    dispatch_notification(
        db,
        user_id=user_id,
        event_type=event_type,
        variables=variables if isinstance(variables, dict) else {},
        data=data if isinstance(data, dict) else {},
    )

    _write_pubsub_log(
        db,
        topic="ps-crm-notifications",
        event_type=event_type,
        payload=payload,
        user_id=user_id,
        complaint_id=str(data.get("complaint_id") or payload.get("complaint_id") or ""),
    )
    db.commit()
    return {"status": "processed"}


@router.post("/surveys")
async def pubsub_surveys(request: Request, db: Session = Depends(get_db)):
    _verify_pubsub_request(request)
    body = await request.json()
    payload = _decode_pubsub_envelope(body)

    complaint_id = str(payload.get("complaint_id") or "")
    survey_type = str(payload.get("survey_type") or "")
    workflow_instance_id = str(payload.get("workflow_instance_id") or "") or None
    event_type = str(payload.get("event_type") or "SURVEY_ROLLOUT")

    if not complaint_id or not survey_type:
        raise HTTPException(status_code=400, detail="complaint_id and survey_type are required in surveys payload")

    complaint = db.execute(
        text("SELECT citizen_id, complaint_number FROM complaints WHERE id = CAST(:cid AS uuid)"),
        {"cid": complaint_id},
    ).mappings().first()
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")

    template_id = _get_template_id(db, survey_type)
    if not template_id:
        raise HTTPException(status_code=422, detail=f"No active survey template for type '{survey_type}'")

    survey_instance_id = str(uuid.uuid4())
    db.execute(
        text(
            """
            INSERT INTO survey_instances (
                id,
                template_id,
                workflow_instance_id,
                complaint_id,
                survey_type,
                target_user_id,
                target_role,
                status,
                triggered_by,
                channel,
                expires_at
            ) VALUES (
                CAST(:id AS uuid),
                CAST(:template_id AS uuid),
                CAST(:workflow_instance_id AS uuid),
                CAST(:complaint_id AS uuid),
                :survey_type,
                CAST(:target_user_id AS uuid),
                'citizen',
                'pending',
                'agent',
                'portal',
                NOW() + INTERVAL '7 days'
            )
            """
        ),
        {
            "id": survey_instance_id,
            "template_id": template_id,
            "workflow_instance_id": _to_uuid_or_none(workflow_instance_id),
            "complaint_id": complaint_id,
            "survey_type": survey_type,
            "target_user_id": str(complaint["citizen_id"]),
        },
    )

    notif_event = "MIDWAY_SURVEY" if survey_type == "midway" else "COMPLAINT_RESOLVED"

    # Notify the complaint citizen
    dispatch_notification(
        db,
        user_id=str(complaint["citizen_id"]),
        event_type=notif_event,
        variables={"number": complaint["complaint_number"]},
        data={
            "survey_instance_id": survey_instance_id,
            "complaint_id": complaint_id,
            "workflow_instance_id": workflow_instance_id,
        },
        cta_url=f"/survey/{survey_instance_id}",
    )

    # Also notify citizens within 500m of infra node (area survey)
    if survey_type == "completion":
        try:
            node_loc = db.execute(
                text("""
                    SELECT n.location FROM complaints c
                    JOIN infra_nodes n ON n.id = c.infra_node_id
                    WHERE c.id = CAST(:cid AS uuid) AND n.location IS NOT NULL
                    LIMIT 1
                """),
                {"cid": complaint_id},
            ).scalar()
            if node_loc:
                area_users = db.execute(
                    text("""
                        SELECT DISTINCT u.id FROM users u
                        WHERE u.id != CAST(:citizen AS uuid)
                          AND u.is_active = TRUE
                          AND u.role = 'citizen'
                          AND u.fcm_token IS NOT NULL
                          AND EXISTS (
                              SELECT 1 FROM complaints c2
                              WHERE c2.citizen_id = u.id
                                AND ST_DWithin(c2.location::geography, CAST(:loc AS geography), 500)
                                AND c2.created_at > NOW() - INTERVAL '90 days'
                          )
                        LIMIT 50
                    """),
                    {"citizen": str(complaint["citizen_id"]), "loc": str(node_loc)},
                ).mappings().all()
                for row in area_users:
                    try:
                        dispatch_notification(
                            db,
                            user_id=str(row["id"]),
                            event_type="MIDWAY_SURVEY",
                            variables={"number": complaint["complaint_number"]},
                            data={"complaint_id": complaint_id, "survey_instance_id": survey_instance_id},
                            cta_url=f"/survey/{survey_instance_id}",
                        )
                    except Exception:
                        pass
        except Exception as exc:
            logger.warning("Area survey notification failed: %s", exc)

    _write_pubsub_log(
        db,
        topic="ps-crm-surveys",
        event_type=event_type,
        payload=payload,
        complaint_id=complaint_id,
        workflow_instance_id=workflow_instance_id,
        user_id=str(complaint["citizen_id"]),
    )
    db.commit()
    return {"status": "processed", "survey_instance_id": survey_instance_id}