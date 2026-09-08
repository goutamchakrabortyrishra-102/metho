import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, Request, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AppSetting, CRMLeadActivity
from ..whatsapp_ai import create_suggestion_for_activity
from ..storage import UPLOADED_OBJECTS_DIR
from ..whatsapp_cloud import encrypt_secret, resolve_config, send_whatsapp_image, test_whatsapp_config, verify_signature, verify_webhook_token, ingest_whatsapp_message
from ..webhook_idempotency import claim_webhook_event, mark_webhook_event
from .auth import get_current_user

router = APIRouter(prefix="/api", tags=["whatsapp"])
logger = logging.getLogger(__name__)
WHATSAPP_POSTER_DIR = UPLOADED_OBJECTS_DIR / "whatsapp_posters"
WHATSAPP_POSTER_DIR.mkdir(parents=True, exist_ok=True)
ADMIN_ROLES = {"super_admin", "company_admin", "admin"}


def _require_admin(current_user):
    if getattr(current_user, "role", "") not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")


def _mask_secret(value: str) -> str:
    text = str(value or "")
    return f"{'*' * max(8, len(text) - 4)}{text[-4:]}" if text else ""


@router.get("/admin/settings/whatsapp")
def get_whatsapp_settings(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    config = resolve_config(db)
    current_row = db.query(AppSetting).filter(AppSetting.key == "whatsapp_cloud_integration").first()
    current = {}
    if current_row:
        try:
            current = json.loads(current_row.value_json or "{}")
        except json.JSONDecodeError:
            current = {}
    return {
        "enabled": config["enabled"],
        "phone_number_id": config["phone_number_id"],
        "business_account_id": config["business_account_id"],
        "graph_api_version": config["graph_api_version"],
        "default_assignee_id": config["default_assignee_id"],
        "default_auto_reply": config["default_auto_reply"],
        "default_auto_reply_image_url": config["default_auto_reply_image_url"],
        "default_auto_reply_mode": config["default_auto_reply_mode"],
        "customer_auto_reply": str(current.get("customer_auto_reply") or "").strip(),
        "customer_auto_reply_image_url": config["customer_auto_reply_image_url"],
        "customer_auto_reply_mode": config["customer_auto_reply_mode"],
        "member_auto_reply": str(current.get("member_auto_reply") or "").strip(),
        "member_auto_reply_image_url": config["member_auto_reply_image_url"],
        "member_auto_reply_mode": config["member_auto_reply_mode"],
        "partner_auto_reply": str(current.get("partner_auto_reply") or "").strip(),
        "partner_auto_reply_image_url": config["partner_auto_reply_image_url"],
        "default_auto_reply_mode": config["default_auto_reply_mode"],
        "customer_auto_reply_mode": config["customer_auto_reply_mode"],
        "member_auto_reply_mode": config["member_auto_reply_mode"],
        "partner_auto_reply_mode": config["partner_auto_reply_mode"],
        "invoice_template": str(current.get("invoice_template") or "").strip(),
        "order_template": str(current.get("order_template") or "").strip(),
        "registration_welcome_message": config["registration_welcome_message"],
        "registration_welcome_message_mode": config["registration_welcome_message_mode"],
        "registration_welcome_message_image_url": config["registration_welcome_message_image_url"],
        "registration_url": config["registration_url"],
        "registration_help_prompt": config["registration_help_prompt"],
        "registration_role_question": config["registration_role_question"],
        **{f"{role}_registration_{field}": config[f"{role}_registration_{field}"] for role in ("member", "partner", "rider") for field in ("url", "reply", "keywords")},
        **{f"{role}_registration_reply_image_url": config[f"{role}_registration_reply_image_url"] for role in ("member", "partner", "rider")},
        **{f"{role}_registration_reply_mode": config[f"{role}_registration_reply_mode"] for role in ("member", "partner", "rider")},
        "webhook_verify_token_masked": _mask_secret(config["webhook_verify_token"]),
        "app_secret_masked": _mask_secret(config["app_secret"]),
        "access_token_masked": _mask_secret(config["access_token"]),
        "configured": bool(config["phone_number_id"] and config["access_token"]),
    }


@router.put("/admin/settings/whatsapp")
def update_whatsapp_settings(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    data = payload if isinstance(payload, dict) else {}
    current_row = db.query(AppSetting).filter(AppSetting.key == "whatsapp_cloud_integration").first()
    try:
        current = json.loads(current_row.value_json or "{}") if current_row else {}
    except json.JSONDecodeError:
        current = {}
    next_config = {
        "enabled": bool(data.get("enabled", current.get("enabled", True))),
        "phone_number_id": str(data.get("phone_number_id", current.get("phone_number_id", "")) or "").strip(),
        "business_account_id": str(data.get("business_account_id", current.get("business_account_id", "")) or "").strip(),
        "graph_api_version": str(data.get("graph_api_version", current.get("graph_api_version", "v20.0")) or "v20.0").strip(),
        "default_assignee_id": str(data.get("default_assignee_id", current.get("default_assignee_id", "")) or "").strip(),
        "default_auto_reply": str(data.get("default_auto_reply", current.get("default_auto_reply", "")) or "").strip(),
        "default_auto_reply_image_url": str(data.get("default_auto_reply_image_url", current.get("default_auto_reply_image_url", "")) or "").strip(),
        "default_auto_reply_mode": str(data.get("default_auto_reply_mode", current.get("default_auto_reply_mode", "text")) or "text").strip().lower(),
        "customer_auto_reply": str(data.get("customer_auto_reply", current.get("customer_auto_reply", "")) or "").strip(),
        "customer_auto_reply_image_url": str(data.get("customer_auto_reply_image_url", current.get("customer_auto_reply_image_url", "")) or "").strip(),
        "customer_auto_reply_mode": str(data.get("customer_auto_reply_mode", current.get("customer_auto_reply_mode", "text")) or "text").strip().lower(),
        "member_auto_reply": str(data.get("member_auto_reply", current.get("member_auto_reply", "")) or "").strip(),
        "member_auto_reply_image_url": str(data.get("member_auto_reply_image_url", current.get("member_auto_reply_image_url", "")) or "").strip(),
        "member_auto_reply_mode": str(data.get("member_auto_reply_mode", current.get("member_auto_reply_mode", "text")) or "text").strip().lower(),
        "partner_auto_reply": str(data.get("partner_auto_reply", current.get("partner_auto_reply", "")) or "").strip(),
        "partner_auto_reply_image_url": str(data.get("partner_auto_reply_image_url", current.get("partner_auto_reply_image_url", "")) or "").strip(),
        "default_auto_reply_mode": str(data.get("default_auto_reply_mode", current.get("default_auto_reply_mode", "text")) or "text").strip().lower(),
        "customer_auto_reply_mode": str(data.get("customer_auto_reply_mode", current.get("customer_auto_reply_mode", "text")) or "text").strip().lower(),
        "member_auto_reply_mode": str(data.get("member_auto_reply_mode", current.get("member_auto_reply_mode", "text")) or "text").strip().lower(),
        "partner_auto_reply_mode": str(data.get("partner_auto_reply_mode", current.get("partner_auto_reply_mode", "text")) or "text").strip().lower(),
        "invoice_template": str(data.get("invoice_template", current.get("invoice_template", "")) or "").strip(),
        "order_template": str(data.get("order_template", current.get("order_template", "")) or "").strip(),
        "registration_welcome_message": str(data.get("registration_welcome_message", current.get("registration_welcome_message", "")) or "").strip(),
        "registration_welcome_message_mode": str(data.get("registration_welcome_message_mode", current.get("registration_welcome_message_mode", "text")) or "text").strip().lower(),
        "registration_url": str(data.get("registration_url", current.get("registration_url", "")) or "").strip(),
        "registration_help_prompt": str(data.get("registration_help_prompt", current.get("registration_help_prompt", "")) or "").strip(),
        "registration_role_question": str(data.get("registration_role_question", current.get("registration_role_question", "")) or "").strip(),
        **{f"{role}_registration_{field}": str(data.get(f"{role}_registration_{field}", current.get(f"{role}_registration_{field}", "")) or "").strip() for role in ("member", "partner", "rider") for field in ("url", "reply", "keywords")},
        **{f"{role}_registration_reply_image_url": str(data.get(f"{role}_registration_reply_image_url", current.get(f"{role}_registration_reply_image_url", "")) or "").strip() for role in ("member", "partner", "rider")},
        **{f"{role}_registration_reply_mode": str(data.get(f"{role}_registration_reply_mode", current.get(f"{role}_registration_reply_mode", "text")) or "text").strip().lower() for role in ("member", "partner", "rider")},
    }
    secret_update_requested = any(str(data.get(field) or "").strip() for field in ("webhook_verify_token", "app_secret", "access_token"))
    encryption_key = (
        os.getenv("WHATSAPP_SETTINGS_ENCRYPTION_KEY", "")
        or os.getenv("META_SETTINGS_ENCRYPTION_KEY", "")
        or "default-fallback-32-char-key-here"
    ).strip()
    if secret_update_requested and not encryption_key:
        raise HTTPException(status_code=503, detail="WhatsApp secret storage is unavailable")
    for field in ("webhook_verify_token", "app_secret", "access_token"):
        value = str(data.get(field) or "").strip()
        if value:
            next_config[field] = encrypt_secret(value)
        elif current.get(field):
            next_config[field] = current[field]
    if not current_row:
        current_row = AppSetting(key="whatsapp_cloud_integration", value_json=json.dumps(next_config), updated_at=datetime.now(timezone.utc))
        db.add(current_row)
    else:
        current_row.value_json = json.dumps(next_config)
        current_row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return get_whatsapp_settings(db, current_user)


@router.post("/admin/settings/whatsapp/test")
def run_whatsapp_settings_test(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    config = resolve_config(db)
    missing = [key for key in ("phone_number_id", "access_token") if not config.get(key)]
    if missing:
        return {"ok": False, "configured": False, "missing": missing}
    try:
        result = test_whatsapp_config(db)
        return {"ok": True, "configured": True, "phone_number_id": result["phone_number_id"], "display_phone_number": result["display_phone_number"], "verified_name": result["verified_name"], "graph_api_version": result["graph_api_version"], "message": "WhatsApp Cloud configuration verified with external API call."}
    except Exception as err:
        return {"ok": False, "configured": True, "error": str(err)}


@router.post("/admin/settings/whatsapp/send")
def send_admin_whatsapp_reply(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    data = payload if isinstance(payload, dict) else {}
    recipient = str(data.get("recipient") or "").strip()
    message = str(data.get("message") or "").strip()
    if not recipient or not message:
        raise HTTPException(status_code=400, detail="Recipient and message are required")
    try:
        from ..whatsapp_cloud import send_whatsapp_message

        result = send_whatsapp_message(db, recipient, text=message)
        return {"ok": True, "message_id": ((result.get("messages") or [{}])[0]).get("id") if isinstance(result, dict) else None}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/admin/settings/whatsapp/poster")
async def upload_whatsapp_poster(file: UploadFile = File(...), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    from .compat import _read_validated_image_upload
    ext, content, _mime = _read_validated_image_upload(file, 5 * 1024 * 1024)
    name = f"whatsapp-poster-{uuid.uuid4().hex}{ext}"
    (WHATSAPP_POSTER_DIR / name).write_bytes(content)
    return {"ok": True, "name": name, "url": f"/api/files/whatsapp_posters/{name}"}


@router.delete("/admin/settings/whatsapp/poster")
def delete_whatsapp_poster(payload: dict, current_user=Depends(get_current_user)):
    _require_admin(current_user)
    raw = str((payload or {}).get("url") or "").strip()
    name = Path(raw.split("?", 1)[0]).name
    if not name.startswith("whatsapp-poster-"):
        raise HTTPException(status_code=400, detail="Only WhatsApp posters can be deleted")
    target = WHATSAPP_POSTER_DIR / name
    if target.exists():
        target.unlink()
    return {"ok": True, "deleted": name}


@router.delete("/admin/settings/whatsapp/posters")
def delete_all_whatsapp_posters(current_user=Depends(get_current_user)):
    _require_admin(current_user)
    deleted = 0
    for poster in WHATSAPP_POSTER_DIR.glob("whatsapp-poster-*"):
        if poster.is_file():
            poster.unlink()
            deleted += 1
    return {"ok": True, "deleted": deleted}


@router.post("/admin/settings/whatsapp/send-image")
def send_admin_whatsapp_image(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    data = payload if isinstance(payload, dict) else {}
    recipient = str(data.get("recipient") or "").strip()
    image_url = str(data.get("image_url") or "").strip()
    caption = str(data.get("caption") or "").strip()
    if image_url.startswith("/"):
        public_base = str(os.getenv("METHO_PUBLIC_BASE_URL") or "https://metho-backend.onrender.com").strip().rstrip("/")
        if not public_base:
            raise HTTPException(status_code=503, detail="METHO_PUBLIC_BASE_URL is required for poster sending")
        image_url = f"{public_base}{image_url}"
    try:
        result = send_whatsapp_image(db, recipient, image_url, caption)
        return {"ok": True, "message_id": ((result.get("messages") or [{}])[0]).get("id") if isinstance(result, dict) else None}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/whatsapp/webhook")
@router.get("/webhooks/whatsapp")
def verify_whatsapp_webhook(mode: str | None = Query(default=None, alias="hub.mode"), token: str | None = Query(default=None, alias="hub.verify_token"), challenge: str | None = Query(default=None, alias="hub.challenge"), db: Session = Depends(get_db)):
    if mode != "subscribe":
        raise HTTPException(status_code=400, detail="Invalid webhook mode")
    verified = verify_webhook_token(token or "", challenge or "", db)
    if verified is None:
        raise HTTPException(status_code=403, detail="Invalid webhook verification token")
    return int(verified) if verified.isdigit() else verified


@router.post("/whatsapp/webhook")
@router.post("/webhooks/whatsapp")
async def receive_whatsapp_webhook(request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    body = await request.body()
    config = resolve_config(db)
    if config.get("app_secret"):
        try:
            signature_valid = verify_signature(body, request.headers.get("X-Hub-Signature-256"), db)
        except Exception as exc:
            db.rollback()
            raise HTTPException(status_code=503, detail="WhatsApp webhook configuration unavailable") from exc
        if not signature_valid:
            raise HTTPException(status_code=403, detail="Invalid webhook signature")
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Malformed webhook payload") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Webhook payload must be an object")

    try:
        normalized = payload.get("entry") or []
        messages = []
        for entry in normalized:
            for change in (entry or {}).get("changes") or []:
                value = (change or {}).get("value") or {}
                if value.get("messages"):
                    messages.extend(value.get("messages") or [])
        if not messages:
            logger.info(
                "Acknowledging WhatsApp webhook without messages: entries=%s changes=%s has_statuses=%s has_errors=%s",
                len(normalized),
                sum(len((entry or {}).get("changes") or []) for entry in normalized if isinstance(entry, dict)),
                any(bool(((change or {}).get("value") or {}).get("statuses")) for entry in normalized if isinstance(entry, dict) for change in (entry or {}).get("changes") or []),
                any(bool(((change or {}).get("value") or {}).get("errors")) for entry in normalized if isinstance(entry, dict) for change in (entry or {}).get("changes") or []),
            )
            return {"ok": True, "status": "acknowledged", "message_count": 0}
        claimed_message_ids = [
            str((message or {}).get("id") or "").strip()
            for message in messages
            if str((message or {}).get("id") or "").strip() and claim_webhook_event(db, "whatsapp", str((message or {}).get("id") or "").strip())
        ]
        if not claimed_message_ids:
            return {"ok": True, "status": "duplicate", "message_count": len(messages)}
        result = ingest_whatsapp_message(db, payload)
    except Exception as exc:
        db.rollback()
        for message_id in locals().get("claimed_message_ids", []):
            try:
                mark_webhook_event(db, message_id, "failed")
            except Exception:
                db.rollback()
                logger.exception("WhatsApp webhook idempotency failure marker failed: message_id=%s", message_id)
        logger.exception("WhatsApp webhook ingestion failed: message_ids=%s", locals().get("claimed_message_ids", []))
        raise HTTPException(status_code=503, detail=f"WhatsApp lead could not be stored: {str(exc)}") from exc
    for message_id in claimed_message_ids:
        mark_webhook_event(db, message_id, "processed")
    for message in messages:
        message_id = str((message or {}).get("id") or "").strip()
        if not message_id:
            continue
        activity = db.query(CRMLeadActivity).filter(
            CRMLeadActivity.activity_type == "whatsapp_message_received",
            CRMLeadActivity.message.like(f"WhatsApp message received [{message_id}]:%"),
        ).first()
        if activity:
            background_tasks.add_task(create_suggestion_for_activity, activity.id)
            logger.info("WhatsApp AI background task queued: message_id=%s activity_id=%s lead_id=%s", message_id, activity.id, activity.lead_id)
        else:
            logger.warning("WhatsApp AI task not queued: received activity missing: message_id=%s", message_id)
    return {"ok": True, "status": result, "message_count": len(messages)}
