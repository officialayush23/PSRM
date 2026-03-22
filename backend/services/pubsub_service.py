# backend/services/pubsub_service.py
"""
Pub/Sub service.

Two modes controlled by settings.PUBSUB_ENABLED:

  TRUE  → publishes JSON to the appropriate GCP Pub/Sub topic.
           Cloud Run subscriber picks it up and acts.

  FALSE → falls back to direct in-process dispatch so the app works
           fully without any GCP infrastructure.
           For surveys: creates the survey_instance and sends
           the notification directly via notification_service.
           For notifications: calls dispatch_notification directly.

This means the server boots and works locally (or before Cloud Run
is deployed) without any Pub/Sub setup at all.
"""
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from config import settings

logger = logging.getLogger(__name__)

# ── Lazy publisher singleton ──────────────────────────────────────

_publisher = None

TOPIC_COMPLAINT_RECEIVED  = "ps-crm-complaint-received"
TOPIC_WORKFLOW_EVENTS     = "ps-crm-workflow-events"
TOPIC_NOTIFICATIONS       = "ps-crm-notifications"
TOPIC_SURVEYS             = "ps-crm-surveys"

_EVENT_TOPIC_MAP = {
    "COMPLAINT_RECEIVED":        TOPIC_COMPLAINT_RECEIVED,
    "WORKFLOW_STARTED":          TOPIC_WORKFLOW_EVENTS,
    "WORKFLOW_STEP_COMPLETED":   TOPIC_WORKFLOW_EVENTS,
    "WORKFLOW_COMPLETED":        TOPIC_WORKFLOW_EVENTS,
    "TASK_ASSIGNED":             TOPIC_WORKFLOW_EVENTS,
    "TASK_COMPLETED":            TOPIC_WORKFLOW_EVENTS,
    "SURVEY_ROLLOUT":            TOPIC_SURVEYS,
    "MIDWAY_SURVEY":             TOPIC_SURVEYS,
    "COMPLAINT_RESOLVED":        TOPIC_SURVEYS,
    "NOTIFICATION":              TOPIC_NOTIFICATIONS,
    "REPEAT_COMPLAINT_ALERT":    TOPIC_NOTIFICATIONS,
    "SURVEY_ALERT":              TOPIC_NOTIFICATIONS,
}


def _get_publisher():
    global _publisher
    if _publisher is None:
        from google.cloud import pubsub_v1
        _publisher = pubsub_v1.PublisherClient()
    return _publisher


def _topic_path(topic_id: str) -> str:
    return f"projects/{settings.GCS_PROJECT_ID}/topics/{topic_id}"


# ── Generic publish_event ─────────────────────────────────────────

def publish_event(
    db: Session,
    *,
    event_type: str,
    payload: Dict[str, Any],
    city_id: Optional[str]              = None,
    complaint_id: Optional[str]         = None,
    user_id: Optional[str]              = None,
    workflow_instance_id: Optional[str] = None,
    # Fallback kwargs used when PUBSUB_ENABLED=False
    fallback_user_id: Optional[str]     = None,
    fallback_variables: Optional[Dict]  = None,
    fallback_data: Optional[Dict]       = None,
    fallback_survey_type: Optional[str] = None,
    fallback_workflow_instance_id: Optional[str] = None,
) -> Optional[str]:
    """
    Publishes an event to the appropriate Pub/Sub topic.

    When PUBSUB_ENABLED=False, falls back to direct in-process handling:
      - SURVEY_ROLLOUT / MIDWAY_SURVEY / COMPLAINT_RESOLVED
          → creates survey_instance + dispatches notification directly
      - Everything else
          → calls dispatch_notification directly if fallback_user_id given

    Returns the Pub/Sub message_id, "fallback", or None.
    """
    full_payload = {
        "event_type":  event_type,
        "city_id":     city_id,
        "complaint_id":complaint_id,
        "user_id":     user_id,
        "published_at":datetime.now(timezone.utc).isoformat(),
        **payload,
    }

    if not settings.PUBSUB_ENABLED:
        logger.info(
            "Pub/Sub disabled — direct fallback for event=%s complaint=%s",
            event_type, complaint_id,
        )
        _handle_fallback(
            db,
            event_type=event_type,
            payload=full_payload,
            complaint_id=complaint_id,
            user_id=user_id or fallback_user_id,
            fallback_user_id=fallback_user_id,
            fallback_variables=fallback_variables or {},
            fallback_data=fallback_data or {},
            fallback_survey_type=fallback_survey_type,
            fallback_workflow_instance_id=fallback_workflow_instance_id,
        )
        _write_event_log(
            db,
            event_type=event_type,
            topic=_EVENT_TOPIC_MAP.get(event_type, "unknown"),
            message_id=None,
            payload=full_payload,
            city_id=city_id,
            complaint_id=complaint_id,
            user_id=user_id,
            workflow_instance_id=workflow_instance_id,
            status="fallback",
        )
        return "fallback"

    topic_id  = _EVENT_TOPIC_MAP.get(event_type, TOPIC_NOTIFICATIONS)
    topic     = _topic_path(topic_id)
    message_id = None

    try:
        pub       = _get_publisher()
        future    = pub.publish(
            topic,
            json.dumps(full_payload).encode("utf-8"),
            event_type=event_type,
            city_id=city_id or "",
        )
        message_id = future.result(timeout=10)
        logger.info("Published event=%s message_id=%s", event_type, message_id)
    except Exception as exc:
        logger.error("Pub/Sub publish failed event=%s: %s", event_type, exc)
        # Still fall back so the operation isn't silently lost
        _handle_fallback(
            db,
            event_type=event_type,
            payload=full_payload,
            complaint_id=complaint_id,
            user_id=user_id or fallback_user_id,
            fallback_user_id=fallback_user_id,
            fallback_variables=fallback_variables or {},
            fallback_data=fallback_data or {},
            fallback_survey_type=fallback_survey_type,
            fallback_workflow_instance_id=fallback_workflow_instance_id,
        )

    _write_event_log(
        db,
        event_type=event_type,
        topic=topic_id,
        message_id=message_id,
        payload=full_payload,
        city_id=city_id,
        complaint_id=complaint_id,
        user_id=user_id,
        workflow_instance_id=workflow_instance_id,
        status="published" if message_id else "failed",
    )
    return message_id


# ── Fallback handler ──────────────────────────────────────────────

def _handle_fallback(
    db: Session,
    *,
    event_type: str,
    payload: Dict,
    complaint_id: Optional[str],
    user_id: Optional[str],
    fallback_user_id: Optional[str],
    fallback_variables: Dict,
    fallback_data: Dict,
    fallback_survey_type: Optional[str],
    fallback_workflow_instance_id: Optional[str],
) -> None:
    """
    Direct in-process fallback when Pub/Sub is not available.
    Imported lazily to avoid circular imports.
    """
    from services.notification_service import dispatch_notification

    # ── Survey events → create survey_instance + notify ──────────
    if event_type in ("SURVEY_ROLLOUT", "MIDWAY_SURVEY", "COMPLAINT_RESOLVED") \
            and complaint_id and fallback_survey_type:
        _direct_survey_rollout(
            db,
            complaint_id=complaint_id,
            survey_type=fallback_survey_type,
            workflow_instance_id=fallback_workflow_instance_id,
        )
        return

    # ── All other events → direct notification if user known ─────
    target = fallback_user_id or user_id
    if target and fallback_variables is not None:
        try:
            dispatch_notification(
                db,
                user_id=target,
                event_type=event_type,
                variables=fallback_variables,
                data=fallback_data or {},
            )
        except Exception as exc:
            logger.error("Fallback dispatch_notification failed: %s", exc)


def _direct_survey_rollout(
    db: Session,
    *,
    complaint_id: str,
    survey_type: str,
    workflow_instance_id: Optional[str],
) -> None:
    """
    Creates a survey_instance and notifies the citizen directly.
    Mirrors the logic in survey_router.rollout_survey but callable
    from the service layer without going through HTTP.
    """
    import uuid as _uuid
    from services.notification_service import dispatch_notification

    try:
        complaint = db.execute(
            text("""
                SELECT citizen_id, complaint_number, title
                FROM complaints WHERE id = CAST(:cid AS uuid)
            """),
            {"cid": complaint_id},
        ).mappings().first()

        if not complaint:
            logger.error("direct_survey_rollout: complaint %s not found", complaint_id)
            return

        # Resolve template
        tmpl = db.execute(
            text("""
                SELECT id FROM survey_templates
                WHERE survey_type = :stype AND is_active = TRUE
                LIMIT 1
            """),
            {"stype": survey_type},
        ).first()

        if not tmpl:
            logger.warning(
                "No active survey_template for type=%s — sending plain notification only",
                survey_type,
            )
            # Still send the notification even without a survey instance
            event_key = "MIDWAY_SURVEY" if survey_type == "midway" else "COMPLAINT_RESOLVED"
            dispatch_notification(
                db,
                user_id=str(complaint["citizen_id"]),
                event_type=event_key,
                variables={"number": complaint["complaint_number"]},
                data={"complaint_id": complaint_id},
            )
            return

        si_id = str(_uuid.uuid4())
        db.execute(
            text("""
                INSERT INTO survey_instances (
                    id, template_id, complaint_id, workflow_instance_id,
                    survey_type, target_user_id, target_role,
                    triggered_by, channel, status,
                    expires_at
                ) VALUES (
                    CAST(:id     AS uuid),
                    CAST(:tid    AS uuid),
                    CAST(:cid    AS uuid),
                    CAST(:wid    AS uuid),
                    :stype,
                    CAST(:target AS uuid),
                    'citizen',
                    'agent', 'portal', 'pending',
                    NOW() + INTERVAL '7 days'
                )
            """),
            {
                "id":     si_id,
                "tid":    str(tmpl[0]),
                "cid":    complaint_id,
                "wid":    workflow_instance_id,
                "stype":  survey_type,
                "target": str(complaint["citizen_id"]),
            },
        )
        db.commit()

        event_key = "MIDWAY_SURVEY" if survey_type == "midway" else "COMPLAINT_RESOLVED"
        dispatch_notification(
            db,
            user_id=str(complaint["citizen_id"]),
            event_type=event_key,
            variables={"number": complaint["complaint_number"]},
            data={
                "survey_instance_id": si_id,
                "complaint_id":       complaint_id,
                "cta_path":           f"/survey/{si_id}",
            },
        )
        logger.info(
            "Direct survey rollout: si_id=%s type=%s complaint=%s",
            si_id, survey_type, complaint_id,
        )

    except Exception as exc:
        logger.error("_direct_survey_rollout failed: %s", exc)


# ── Original complaint-received publisher (kept for ingestion) ────

def publish_complaint_received(
    db: Session,
    *,
    complaint_id: str,
    complaint_number: str,
    citizen_id: str,
    city_id: str,
    title: str,
    description: str,
    priority: str,
    infra_type_name: str,
    jurisdiction_name: Optional[str],
    dept_mappings: list,
    is_repeat: bool,
    is_new_infra_node: bool,
    lat: float,
    lng: float,
    images: list,
) -> Optional[str]:
    """
    Publishes a COMPLAINT_RECEIVED event.
    Delegates to publish_event for consistent handling.
    """
    return publish_event(
        db,
        event_type="COMPLAINT_RECEIVED",
        payload={
            "complaint_number":  complaint_number,
            "title":             title,
            "description":       description[:500],
            "priority":          priority,
            "infra_type":        infra_type_name,
            "jurisdiction":      jurisdiction_name,
            "dept_mappings":     dept_mappings,
            "is_repeat":         is_repeat,
            "is_new_infra_node": is_new_infra_node,
            "lat":               lat,
            "lng":               lng,
            "has_images":        len(images) > 0,
        },
        city_id=city_id,
        complaint_id=complaint_id,
        user_id=citizen_id,
        fallback_user_id=citizen_id,
        fallback_variables={"number": complaint_number},
        fallback_data={
            "complaint_id":     complaint_id,
            "complaint_number": complaint_number,
            "priority":         priority,
        },
    )


# ── Event log writer ──────────────────────────────────────────────

def _write_event_log(
    db: Session,
    *,
    event_type: str,
    topic: str,
    message_id: Optional[str],
    payload: Dict,
    city_id: Optional[str],
    complaint_id: Optional[str],
    user_id: Optional[str],
    workflow_instance_id: Optional[str],
    status: str,
) -> None:
    try:
        db.execute(
            text("""
                INSERT INTO pubsub_event_log (
                    event_type, pubsub_topic, pubsub_message_id,
                    published_at, payload,
                    city_id, complaint_id, user_id,
                    workflow_instance_id,
                    processing_status
                ) VALUES (
                    :event_type,
                    :topic,
                    :message_id,
                    NOW(),
                    CAST(:payload AS jsonb),
                    CAST(:city_id              AS uuid),
                    CAST(:complaint_id         AS uuid),
                    CAST(:user_id              AS uuid),
                    CAST(:workflow_instance_id AS uuid),
                    :status
                )
            """),
            {
                "event_type":           event_type,
                "topic":                topic,
                "message_id":           message_id,
                "payload":              json.dumps(payload),
                "city_id":              city_id,
                "complaint_id":         complaint_id,
                "user_id":              user_id,
                "workflow_instance_id": workflow_instance_id,
                "status":               status,
            },
        )
        db.commit()
    except Exception as exc:
        logger.error("pubsub_event_log write failed: %s", exc)