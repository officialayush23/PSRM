# backend/services/pubsub_service.py
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict

from google.cloud import pubsub_v1
from sqlalchemy import text
from sqlalchemy.orm import Session

from config import settings

logger = logging.getLogger(__name__)

_publisher: pubsub_v1.PublisherClient | None = None

TOPIC_COMPLAINT_RECEIVED = "ps-crm-complaint-received"


def _get_publisher() -> pubsub_v1.PublisherClient:
    global _publisher
    if _publisher is None:
        _publisher = pubsub_v1.PublisherClient()
    return _publisher


def _topic_path(topic_id: str) -> str:
    return f"projects/{settings.GCS_PROJECT_ID}/topics/{topic_id}"


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
    jurisdiction_name: str | None,
    dept_mappings: list,
    is_repeat: bool,
    is_new_infra_node: bool,
    lat: float,
    lng: float,
    images: list,
) -> str | None:
    """
    Publishes a COMPLAINT_RECEIVED event to Pub/Sub.
    Writes to pubsub_event_log and notification_logs.
    Returns the Pub/Sub message ID, or None if publishing is disabled.
    """
    if not settings.PUBSUB_ENABLED:
        logger.info("Pub/Sub disabled — skipping publish for complaint %s", complaint_id)
        _write_notification_log_direct(
            db,
            complaint_id=complaint_id,
            citizen_id=citizen_id,
            city_id=city_id,
            complaint_number=complaint_number,
            title=title,
            priority=priority,
        )
        return None

    payload = {
        "event_type":       "COMPLAINT_RECEIVED",
        "complaint_id":     complaint_id,
        "complaint_number": complaint_number,
        "citizen_id":       citizen_id,
        "city_id":          city_id,
        "title":            title,
        "description":      description[:500],
        "priority":         priority,
        "infra_type":       infra_type_name,
        "jurisdiction":     jurisdiction_name,
        "dept_mappings":    dept_mappings,
        "is_repeat":        is_repeat,
        "is_new_infra_node": is_new_infra_node,
        "lat":              lat,
        "lng":              lng,
        "has_images":       len(images) > 0,
        "published_at":     datetime.now(timezone.utc).isoformat(),
    }

    message_bytes = json.dumps(payload).encode("utf-8")
    message_id = None

    try:
        publisher   = _get_publisher()
        topic       = _topic_path(TOPIC_COMPLAINT_RECEIVED)
        future      = publisher.publish(
            topic,
            message_bytes,
            # Pub/Sub message attributes (filterable by subscribers)
            event_type="COMPLAINT_RECEIVED",
            city_id=city_id,
            priority=priority,
        )
        message_id  = future.result(timeout=10)
        logger.info("Published complaint %s to Pub/Sub, message_id=%s", complaint_id, message_id)
    except Exception as exc:
        logger.error("Pub/Sub publish failed for complaint %s: %s", complaint_id, exc)
        # Don't raise — notification failure must not roll back the complaint

    # ── Write pubsub_event_log ─────────────────────────────────────
    db.execute(
        text("""
            INSERT INTO pubsub_event_log (
                event_type, pubsub_topic, pubsub_message_id,
                published_at, payload,
                city_id, complaint_id, user_id,
                processing_status
            ) VALUES (
                'COMPLAINT_RECEIVED',
                :topic,
                :message_id,
                NOW(),
                CAST(:payload AS jsonb),
                CAST(:city_id AS uuid),
                CAST(:complaint_id AS uuid),
                CAST(:citizen_id AS uuid),
                :status
            )
        """),
        {
            "topic":        TOPIC_COMPLAINT_RECEIVED,
            "message_id":   message_id,
            "payload":      json.dumps(payload),
            "city_id":      city_id,
            "complaint_id": complaint_id,
            "citizen_id":   citizen_id,
            "status":       "published" if message_id else "failed",
        },
    )

    # ── Write notification_logs (citizen receipt notification) ─────
    _write_notification_log_direct(
        db,
        complaint_id=complaint_id,
        citizen_id=citizen_id,
        city_id=city_id,
        complaint_number=complaint_number,
        title=title,
        priority=priority,
    )

    return message_id


def _write_notification_log_direct(
    db: Session,
    *,
    complaint_id: str,
    citizen_id: str,
    city_id: str,
    complaint_number: str,
    title: str,
    priority: str,
) -> None:
    """
    Writes a notification_logs row for the citizen.
    The actual sending (WhatsApp/email) is done by the Pub/Sub subscriber
    (Cloud Run or Cloud Function). This row tracks the intent.
    """
    # Get citizen's contact info
    row = db.execute(
        text("""
            SELECT email, phone, preferred_language, email_opt_in, twilio_opt_in
            FROM users
            WHERE id = CAST(:uid AS uuid) AND is_active = true
        """),
        {"uid": citizen_id},
    ).mappings().first()

    if not row:
        return

    notification_payload = json.dumps({
        "complaint_id":     complaint_id,
        "complaint_number": complaint_number,
        "title":            title,
        "priority":         priority,
        "message_hi":       f"आपकी शिकायत #{complaint_number} दर्ज हो गई है। हम जल्द कार्रवाई करेंगे।",
        "message_en":       f"Your complaint #{complaint_number} has been registered. We will act soon.",
    })

    # Write one row per channel the user has opted into
    channels = []
    if row["email_opt_in"] and row["email"]:
        channels.append(("email", row["email"]))
    if row["twilio_opt_in"] and row["phone"]:
        channels.append(("whatsapp", row["phone"]))

    for channel, contact in channels:
        db.execute(
            text("""
                INSERT INTO notification_logs (
                    recipient_user_id, recipient_contact,
                    channel, event_type,
                    complaint_id, payload, status
                ) VALUES (
                    CAST(:user_id AS uuid),
                    :contact,
                    :channel,
                    'COMPLAINT_RECEIVED',
                    CAST(:complaint_id AS uuid),
                    CAST(:payload AS jsonb),
                    'pending'
                )
            """),
            {
                "user_id":      citizen_id,
                "contact":      contact,
                "channel":      channel,
                "complaint_id": complaint_id,
                "payload":      notification_payload,
            },
        )