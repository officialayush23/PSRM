# backend/services/notification_service.py
"""
Notification dispatcher — Firebase FCM + SMTP only.
Aligned with notification_logs schema:
  recipient_user_id, recipient_contact, channel, event_type,
  complaint_id, payload, status
"""
import json
import logging
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from config import settings

logger = logging.getLogger(__name__)

# ── Firebase Admin SDK init ───────────────────────────────────────
_firebase_initialized = False


def _ensure_firebase():
    global _firebase_initialized
    if _firebase_initialized:
        return
    try:
        import firebase_admin
        from firebase_admin import credentials
        if not firebase_admin._apps:
            cred = credentials.Certificate(settings.FIREBASE_SERVICE_ACCOUNT_PATH)
            firebase_admin.initialize_app(cred)
        _firebase_initialized = True
    except Exception as exc:
        logger.error("Firebase init failed: %s", exc)


# ── Notification templates ────────────────────────────────────────

TEMPLATES = {
    "COMPLAINT_RECEIVED": {
        "title_en": "Complaint Registered ✓",
        "body_en":  "Your complaint #{number} has been registered. We will update you on progress.",
        "title_hi": "शिकायत दर्ज हो गई ✓",
        "body_hi":  "आपकी शिकायत #{number} दर्ज हो गई है। हम आपको अपडेट करते रहेंगे।",
    },
    "DEPT_MAPPED": {
        "title_en": "Complaint Assigned to Department",
        "body_en":  "Your complaint #{number} has been assigned to {dept_name} for action.",
        "title_hi": "शिकायत विभाग को सौंपी गई",
        "body_hi":  "आपकी शिकायत #{number} {dept_name} को सौंपी गई है।",
    },
    "WORKFLOW_STARTED": {
        "title_en": "Work Has Begun on Your Complaint",
        "body_en":  "Work on complaint #{number} has started. {worker_info}Expected completion: {eta}.",
        "title_hi": "आपकी शिकायत पर काम शुरू हो गया",
        "body_hi":  "शिकायत #{number} पर काम शुरू हो गया है। {worker_info}अनुमानित समाधान: {eta}।",
    },
    "MIDWAY_SURVEY": {
        "title_en": "How is the work going?",
        "body_en":  "Please rate the progress on complaint #{number}. Your feedback matters.",
        "title_hi": "काम कैसा चल रहा है?",
        "body_hi":  "शिकायत #{number} की प्रगति को रेट करें। आपका फीडबैक महत्वपूर्ण है।",
    },
    "COMPLAINT_RESOLVED": {
        "title_en": "Issue Resolved ✓",
        "body_en":  "Your complaint #{number} has been resolved. Please share your experience.",
        "title_hi": "समस्या हल हो गई ✓",
        "body_hi":  "आपकी शिकायत #{number} हल हो गई है। कृपया अपना अनुभव साझा करें।",
    },
    "TASK_ASSIGNED": {
        "title_en": "New Task Assigned",
        "body_en":  "You have been assigned: {task_title}. Complaint: #{number}. Due: {eta}. Please check the app.",
        "title_hi": "नया काम सौंपा गया",
        "body_hi":  "आपको काम सौंपा गया: {task_title}। शिकायत #{number}। कृपया ऐप देखें।",
    },
    "SURVEY_ALERT": {
        "title_en": "⚠️ Task Quality Alert",
        "body_en":  "Survey responses for task #{task_id} suggest quality issues. Investigation needed.",
        "title_hi": "⚠️ काम की गुणवत्ता पर ध्यान दें",
        "body_hi":  "कार्य #{task_id} के लिए सर्वे में समस्याएं मिली हैं।",
    },
    "REPEAT_COMPLAINT_ALERT": {
        "title_en": "⚠️ Repeat Complaint Alert",
        "body_en":  "Complaint #{number} is a repeat issue at this location. Immediate attention needed.",
        "title_hi": "⚠️ बार-बार की शिकायत",
        "body_hi":  "शिकायत #{number} इस स्थान पर बार-बार आ रही है।",
    },
    "TENDER_REJECTED": {
        "title_en": "Tender Rejected",
        "body_en":  "Your tender #{number} has been rejected. Reason: {reason}.",
        "title_hi": "टेंडर अस्वीकृत",
        "body_hi":  "आपका टेंडर #{number} अस्वीकृत हो गया है। कारण: {reason}।",
    },
}


def _render_template(
    template_key: str,
    language: str,
    variables: Dict[str, str],
) -> Dict[str, str]:
    tmpl = TEMPLATES.get(template_key, {})
    lang = "hi" if language == "hi" else "en"

    title = tmpl.get(f"title_{lang}", tmpl.get("title_en", "PS-CRM Update"))
    body  = tmpl.get(f"body_{lang}",  tmpl.get("body_en", ""))

    for k, v in variables.items():
        title = title.replace(f"{{{k}}}", str(v))
        body  = body.replace(f"{{{k}}}", str(v))

    return {"title": title, "body": body}


# ── FCM push notification ─────────────────────────────────────────

def send_fcm(
    fcm_token: str,
    title: str,
    body: str,
    data: Dict[str, str],
) -> bool:
    try:
        _ensure_firebase()
        from firebase_admin import messaging

        message = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data={k: str(v) for k, v in data.items()},
            token=fcm_token,
            android=messaging.AndroidConfig(
                priority="high",
                notification=messaging.AndroidNotification(
                    sound="default",
                    click_action="FLUTTER_NOTIFICATION_CLICK",
                ),
            ),
        )
        response = messaging.send(message)
        logger.info("FCM sent: %s", response)
        return True
    except Exception as exc:
        logger.error("FCM failed token=%s: %s", fcm_token[:20], exc)
        return False


# ── SMTP email ────────────────────────────────────────────────────

def send_email(
    to_email: str,
    subject: str,
    html_body: str,
    text_body: str,
) -> bool:
    if not settings.SMTP_HOST or not settings.SMTP_USER:
        logger.warning("SMTP not configured — skipping email to %s", to_email)
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = f"PS-CRM Delhi <{settings.SMTP_USER}>"
        msg["To"]      = to_email

        msg.attach(MIMEText(text_body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html",  "utf-8"))

        port = settings.SMTP_PORT
        logger.info("SMTP attempt: host=%s port=%s user=%s to=%s",
                    settings.SMTP_HOST, port, settings.SMTP_USER, to_email)

        if port == 587:
            with smtplib.SMTP(settings.SMTP_HOST, port, timeout=30) as server:
                server.ehlo()
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.sendmail(settings.SMTP_USER, to_email, msg.as_string())
        else:
            ctx = ssl.create_default_context()
            with smtplib.SMTP_SSL(settings.SMTP_HOST, port, context=ctx, timeout=30) as server:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.sendmail(settings.SMTP_USER, to_email, msg.as_string())

        logger.info("Email sent to %s subject=%s", to_email, subject)
        return True
    except Exception as exc:
        logger.error("SMTP failed to=%s error=%s", to_email, exc)
        raise  # re-raise so caller captures error_message


def _make_html_email(title: str, body: str, cta_url: Optional[str] = None) -> str:
    cta_block = ""
    if cta_url:
        cta_block = (
            f'<a href="{cta_url}" style="display:inline-block;margin-top:16px;'
            f'padding:10px 24px;background:#6750A4;color:white;border-radius:8px;'
            f'text-decoration:none;font-weight:600;">View Details</a>'
        )
    return f"""
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
      <div style="background:#6750A4;color:white;padding:16px 24px;border-radius:12px 12px 0 0;">
        <h2 style="margin:0;font-size:18px;">PS-CRM — Delhi</h2>
      </div>
      <div style="background:white;padding:24px;border:1px solid #e8def8;border-radius:0 0 12px 12px;">
        <h3 style="color:#1d1b20;margin-top:0;">{title}</h3>
        <p style="color:#49454f;line-height:1.6;">{body}</p>
        {cta_block}
        <hr style="margin-top:24px;border:none;border-top:1px solid #e8def8;">
        <p style="font-size:12px;color:#79747e;">
          Delhi Municipal CRM · This is an automated notification.
        </p>
      </div>
    </div>
    """


# ── Main dispatcher ───────────────────────────────────────────────

def dispatch_notification(
    db: Session,
    *,
    user_id: str,
    event_type: str,
    variables: Dict[str, str],
    data: Dict[str, str],
    cta_url: Optional[str] = None,
) -> Dict[str, bool]:
    """
    Fetches user contact details and dispatches FCM + email.
    Writes result to notification_logs (aligned with final.sql schema).
    Returns {fcm: bool, email: bool}.
    """
    user = db.execute(
        text("""
            SELECT full_name, email, phone, preferred_language, fcm_token,
                   email_opt_in, twilio_opt_in
            FROM users WHERE id = CAST(:uid AS uuid)
        """),
        {"uid": user_id},
    ).mappings().first()

    if not user:
        logger.warning("dispatch_notification: user %s not found", user_id)
        return {"fcm": False, "email": False}

    lang     = user["preferred_language"] or "hi"
    rendered = _render_template(event_type, lang, variables)
    title    = rendered["title"]
    body     = rendered["body"]
    results  = {"fcm": False, "email": False}

    # ── FCM ───────────────────────────────────────────────────────
    if user["fcm_token"]:
        results["fcm"] = send_fcm(
            fcm_token=user["fcm_token"],
            title=title,
            body=body,
            data={"event_type": event_type, **data},
        )
        # Log FCM attempt — recipient_contact = fcm_token (truncated)
        _write_notif_log(
            db,
            user_id=user_id,
            contact=user["fcm_token"][:80],
            channel="fcm",
            event_type=event_type,
            payload={"title": title, "body": body, "data": data},
            status="sent" if results["fcm"] else "failed",
            data=data,
        )

    # ── Email ─────────────────────────────────────────────────────
    # email_opt_in defaults to True — send unless explicitly opted out
    if user["email"] and (user["email_opt_in"] is None or user["email_opt_in"]):
        html = _make_html_email(title, body, cta_url)
        email_error = None
        try:
            results["email"] = bool(send_email(
                to_email=user["email"],
                subject=title,
                html_body=html,
                text_body=body,
            ))
        except Exception as exc:
            results["email"] = False
            email_error = str(exc)
            logger.error("Email dispatch failed to=%s: %s", user["email"], exc)
        _write_notif_log(
            db,
            user_id=user_id,
            contact=user["email"],
            channel="email",
            event_type=event_type,
            payload={"title": title, "body": body, "variables": variables},
            status="sent" if results["email"] else "failed",
            data=data,
            error_message=email_error,
        )

    db.commit()
    return results


def _write_notif_log(
    db: Session,
    *,
    user_id: str,
    contact: str,
    channel: str,
    event_type: str,
    payload: dict,
    status: str,
    data: dict,
    error_message: str = None,
) -> None:
    complaint_id = data.get("complaint_id")
    try:
        db.execute(
            text("""
                INSERT INTO notification_logs (
                    recipient_user_id, recipient_contact,
                    channel, event_type,
                    complaint_id,
                    payload, status, error_message
                ) VALUES (
                    CAST(:uid     AS uuid),
                    :contact,
                    :channel,
                    :event_type,
                    CAST(:cid     AS uuid),
                    CAST(:payload AS jsonb),
                    :status,
                    :error_message
                )
            """),
            {
                "uid":           user_id,
                "contact":       contact,
                "channel":       channel,
                "event_type":    event_type,
                "cid":           complaint_id,
                "payload":       json.dumps(payload),
                "status":        status,
                "error_message": error_message,
            },
        )
    except Exception as exc:
        logger.error("notification_logs write failed: %s", exc)


# ── Area notification — all citizens in a jurisdiction ───────────

def notify_area_citizens(
    db: Session,
    *,
    jurisdiction_id: str,
    event_type: str,
    variables: Dict[str, str],
    data: Dict[str, str],
):
    """Sends FCM to all citizens subscribed in a jurisdiction."""
    rows = db.execute(
        text("""
            SELECT DISTINCT u.id
            FROM area_notification_subscriptions ans
            JOIN users u ON u.id = ans.user_id
            WHERE ans.jurisdiction_id = CAST(:jid AS uuid)
              AND u.fcm_token IS NOT NULL
              AND u.is_active = TRUE
        """),
        {"jid": jurisdiction_id},
    ).mappings().all()

    logger.info(
        "Area notification event=%s jurisdiction=%s recipients=%d",
        event_type, jurisdiction_id, len(rows),
    )

    for row in rows:
        dispatch_notification(
            db,
            user_id=str(row["id"]),
            event_type=event_type,
            variables=variables,
            data=data,
        )