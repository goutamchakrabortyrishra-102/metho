import json
import logging
from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError

from .database import SessionLocal
from .models import AppSetting, CRMFollowUp, CRMLead, CRMLeadActivity
from .whatsapp_cloud import WHATSAPP_PRESET_MESSAGE_DEFAULTS, get_whatsapp_preset_message, send_whatsapp_message

logger = logging.getLogger(__name__)

SCHEDULER_ENABLED_KEY = "lifecycle_followup_scheduler_enabled"
TEMPLATE_NAME_KEY = "lifecycle_followup_template_name"
TEMPLATE_LANGUAGE_KEY = "lifecycle_followup_template_language"
DEFAULT_TEMPLATE_NAME = "registration_reminder"
DEFAULT_TEMPLATE_LANGUAGE = "en"
MARKER_PREFIX = "followup_notified:"


def _json_value(value: str | None, default=None):
    if value is None or value == "":
        return default
    try:
        return json.loads(value)
    except Exception:
        return value


def _setting_enabled(db) -> bool:
    row = db.query(AppSetting).filter(AppSetting.key == SCHEDULER_ENABLED_KEY).first()
    if not row:
        return True
    value = _json_value(row.value_json, True)
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() not in {"0", "false", "off", "no", "disabled"}


def _setting_text(db, key: str, default: str) -> str:
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row:
        return default
    value = _json_value(row.value_json, default)
    return str(value or "").strip()


def _hours_since_last_inbound(db, lead_id: str, now: datetime) -> float:
    activity = (
        db.query(CRMLeadActivity)
        .filter(CRMLeadActivity.lead_id == lead_id, CRMLeadActivity.activity_type == "whatsapp_message_received")
        .order_by(CRMLeadActivity.created_at.desc())
        .first()
    )
    if not activity or not activity.created_at:
        return 24.0
    created_at = activity.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return (now - created_at).total_seconds() / 3600


def _lead_display_name(lead: CRMLead) -> str:
    return str(lead.contact_person or lead.business_name or "there").strip() or "there"


def _marker_key(followup_id: str) -> str:
    return f"{MARKER_PREFIX}{followup_id}"


def _claim_marker(db, followup_id: str, now: datetime) -> bool:
    key = _marker_key(followup_id)
    if db.query(AppSetting).filter(AppSetting.key == key).first():
        return False
    db.add(
        AppSetting(
            key=key,
            value_json=json.dumps({"status": "sending", "claimed_at": now.isoformat()}),
            updated_at=now,
        )
    )
    try:
        db.commit()
        return True
    except IntegrityError:
        db.rollback()
        return False


def _finalize_marker(db, followup_id: str, now: datetime) -> None:
    row = db.query(AppSetting).filter(AppSetting.key == _marker_key(followup_id)).first()
    if not row:
        row = AppSetting(key=_marker_key(followup_id), value_json="{}", updated_at=now)
        db.add(row)
    row.value_json = json.dumps({"status": "sent", "sent_at": now.isoformat()})
    row.updated_at = now


def _release_marker(db, followup_id: str) -> None:
    row = db.query(AppSetting).filter(AppSetting.key == _marker_key(followup_id)).first()
    if row:
        db.delete(row)
        db.commit()


def _lead_phone(lead: CRMLead) -> str:
    return str(lead.whatsapp_no or lead.phone or "").strip()


def send_due_lifecycle_followups() -> dict:
    summary = {"sent": 0, "skipped": 0, "skipped_outside_24h_window": 0, "failed": 0}
    db = SessionLocal()
    try:
        if not _setting_enabled(db):
            logger.info("Lifecycle follow-up scheduler disabled by AppSetting")
            return summary

        now = datetime.now(timezone.utc)
        due_followups = (
            db.query(CRMFollowUp)
            .join(CRMLead, CRMLead.id == CRMFollowUp.lead_id)
            # WhatsApp/Facebook leads already get richer, role-aware follow-up handling from
            # process_due_followups() in whatsapp_ai.py; skip them here so the two schedulers
            # never race to dispatch the same CRMFollowUp row.
            .filter(CRMFollowUp.status == "Pending", CRMFollowUp.scheduled_at <= now, ~CRMLead.source.in_(["whatsapp", "facebook"]))
            .order_by(CRMFollowUp.scheduled_at.asc(), CRMFollowUp.created_at.asc())
            .all()
        )

        for followup in due_followups:
            try:
                if not _claim_marker(db, followup.id, now):
                    summary["skipped"] += 1
                    continue

                lead = db.query(CRMLead).filter(CRMLead.id == followup.lead_id).first()
                if not lead:
                    raise RuntimeError(f"CRM lead not found for followup {followup.id}")

                phone = _lead_phone(lead)
                if not phone:
                    raise RuntimeError(f"CRM lead {lead.id} has no WhatsApp phone number")

                reminder_text = get_whatsapp_preset_message(
                    db,
                    "preset_crm_followup_due",
                    WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_crm_followup_due"],
                    lead_id=lead.lead_id,
                    business_name=lead.business_name,
                    contact_person=lead.contact_person,
                    notes=followup.notes,
                )
                if _hours_since_last_inbound(db, lead.id, now) < 24:
                    send_whatsapp_message(db, phone, text=reminder_text)
                else:
                    template_name = _setting_text(db, TEMPLATE_NAME_KEY, DEFAULT_TEMPLATE_NAME)
                    template_language = _setting_text(db, TEMPLATE_LANGUAGE_KEY, DEFAULT_TEMPLATE_LANGUAGE)
                    if not template_name or not template_language:
                        _release_marker(db, followup.id)
                        summary["skipped_outside_24h_window"] += 1
                        continue
                    try:
                        send_whatsapp_message(
                            db,
                            phone,
                            template_name=template_name,
                            template_language_code=template_language,
                            template_parameters=[_lead_display_name(lead)],
                        )
                    except Exception as exc:
                        if "language" in str(exc).lower():
                            logger.error("Lifecycle follow-up template send failed with language code %s; correct lifecycle_followup_template_language AppSetting, for example to en_US", template_language)
                        raise

                sent_at = datetime.now(timezone.utc)
                _finalize_marker(db, followup.id, sent_at)
                db.add(
                    CRMLeadActivity(
                        lead_id=lead.id,
                        activity_type="followup_reminder_sent",
                        message=f"Scheduled lifecycle follow-up reminder sent via WhatsApp: {followup.notes}",
                    )
                )
                db.commit()
                summary["sent"] += 1
            except Exception:
                db.rollback()
                try:
                    _release_marker(db, followup.id)
                except Exception:
                    db.rollback()
                    logger.exception("Failed to release lifecycle follow-up marker: followup_id=%s", followup.id)
                summary["failed"] += 1
                logger.exception("Lifecycle follow-up reminder failed: followup_id=%s", followup.id)

        logger.info(
            "Lifecycle follow-up scheduler run complete: sent=%s skipped=%s failed=%s",
            summary["sent"],
            summary["skipped"],
            summary["failed"],
        )
        return summary
    except Exception:
        logger.exception("Lifecycle follow-up scheduler batch failed")
        return summary
    finally:
        db.close()