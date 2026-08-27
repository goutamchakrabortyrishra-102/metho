"""Provider-switch dispatcher for outbound WhatsApp sends.

Additive only: existing callers of `whatsapp_cloud.send_whatsapp_message` are
completely untouched. This module lets an admin flip a single setting to route
NEW send calls through the WhatsApp Web microservice instead of Meta Cloud API,
while defaulting to "meta" (today's exact behavior) when nothing is configured.
"""
import base64
import json
from datetime import datetime, timezone

from . import whatsapp_web_client
from .models import AppSetting
from .whatsapp_cloud import decrypt_secret, encrypt_secret, send_whatsapp_message

SETTING_KEY = "whatsapp_provider_config"
VALID_PROVIDERS = {"meta", "whatsapp_web"}


def load_provider_config(db) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == SETTING_KEY).first()
    if not row:
        return {"active_provider": "meta", "service_url": "", "service_token": ""}
    try:
        payload = json.loads(row.value_json or "{}")
    except json.JSONDecodeError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    provider = str(payload.get("active_provider") or "meta").strip()
    if provider not in VALID_PROVIDERS:
        provider = "meta"
    service_token = ""
    if payload.get("service_token"):
        try:
            service_token = decrypt_secret(payload["service_token"])
        except RuntimeError:
            service_token = ""
    return {
        "active_provider": provider,
        "service_url": str(payload.get("service_url") or "").strip(),
        "service_token": service_token,
    }


def save_provider_config(db, active_provider: str, service_url: str, service_token: str | None) -> dict:
    provider = str(active_provider or "meta").strip()
    if provider not in VALID_PROVIDERS:
        raise ValueError(f"active_provider must be one of {sorted(VALID_PROVIDERS)}")

    row = db.query(AppSetting).filter(AppSetting.key == SETTING_KEY).first()
    current = {}
    if row:
        try:
            current = json.loads(row.value_json or "{}")
        except json.JSONDecodeError:
            current = {}
    next_config = {
        "active_provider": provider,
        "service_url": str(service_url or "").strip(),
    }
    token_value = str(service_token or "").strip()
    if token_value:
        next_config["service_token"] = encrypt_secret(token_value)
    elif isinstance(current, dict) and current.get("service_token"):
        next_config["service_token"] = current["service_token"]

    if not row:
        row = AppSetting(key=SETTING_KEY, value_json=json.dumps(next_config), updated_at=datetime.now(timezone.utc))
        db.add(row)
    else:
        row.value_json = json.dumps(next_config)
        row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return load_provider_config(db)


def send_via_active_provider(
    db,
    to: str,
    text: str | None = None,
    pdf_bytes: bytes | None = None,
    pdf_filename: str | None = None,
    pdf_caption: str = "Invoice",
    template_name: str | None = None,
    template_language_code: str | None = None,
    template_parameters: list[str] | None = None,
) -> dict:
    """Route a send through whichever provider is currently active. Defaults to Meta
    Cloud API (today's exact behavior) unless an admin has switched to whatsapp_web."""
    config = load_provider_config(db)

    if config["active_provider"] == "whatsapp_web":
        if pdf_bytes is not None:
            return whatsapp_web_client.send_pdf_invoice(
                config, to, base64.b64encode(pdf_bytes).decode("utf-8"), pdf_filename or "invoice.pdf", pdf_caption
            )
        if text:
            return whatsapp_web_client.send_text_message(config, to, text)
        raise ValueError("provide either text or pdf_bytes for whatsapp_web provider")

    # Fall back to the untouched, existing Meta Cloud API path.
    return send_whatsapp_message(
        db,
        to,
        text=text,
        template_name=template_name,
        template_language_code=template_language_code,
        template_parameters=template_parameters,
    )
