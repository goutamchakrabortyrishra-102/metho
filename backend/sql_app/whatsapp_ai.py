import json
import logging
import os
import re

from sqlalchemy.exc import IntegrityError

from .database import SessionLocal
from .models import AppSetting, CRMLead, CRMLeadActivity, CRMWhatsAppAISuggestion

logger = logging.getLogger(__name__)
SETTING_KEY = "crm_whatsapp_ai"
DEFAULT_CONFIG = {
    "enabled": False,
    "provider": "openai",
    "model": "gpt-4.1-mini",
    "system_prompt": "You are METHO AAY-UPAY customer support. Write a concise, polite reply in the customer's language. Do not promise discounts, refunds, payments, approvals, or account changes. Ask a human agent to help when unsure.",
    "knowledge_base": "METHO AAY-UPAY is an e-commerce and partner platform. Customers can ask about products, orders, registration, and partner opportunities.",
    "handoff_keywords": "agent,human,মানুষ,অফিস,complaint,refund,payment,legal,fraud,otp,password",
}
SENSITIVE_PATTERNS = (r"\b\d{4}[-\s]?\d{4}[-\s]?\d{4}\b", r"\b[A-Z]{5}[0-9]{4}[A-Z]\b", r"\b\d{6}\b")


def resolve_ai_config(db) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == SETTING_KEY).first()
    try:
        stored = json.loads(row.value_json or "{}") if row else {}
    except json.JSONDecodeError:
        stored = {}
    stored = stored if isinstance(stored, dict) else {}
    return {**DEFAULT_CONFIG, **{key: stored.get(key, value) for key, value in DEFAULT_CONFIG.items()}}


def save_ai_config(db, payload: dict) -> dict:
    current = resolve_ai_config(db)
    data = payload if isinstance(payload, dict) else {}
    provider = str(data.get("provider", current["provider"]) or "openai").strip().lower()
    if provider not in {"openai", "gemini"}:
        raise ValueError("AI provider must be openai or gemini")
    config = {
        "enabled": bool(data.get("enabled", current["enabled"])),
        "provider": provider,
        "model": str(data.get("model", current["model"]) or "").strip()[:80],
        "system_prompt": str(data.get("system_prompt", current["system_prompt"]) or "").strip()[:4000],
        "knowledge_base": str(data.get("knowledge_base", current["knowledge_base"]) or "").strip()[:12000],
        "handoff_keywords": str(data.get("handoff_keywords", current["handoff_keywords"]) or "").strip()[:1000],
    }
    if not config["system_prompt"]:
        raise ValueError("System prompt is required")
    row = db.query(AppSetting).filter(AppSetting.key == SETTING_KEY).first()
    if row:
        row.value_json = json.dumps(config)
    else:
        db.add(AppSetting(key=SETTING_KEY, value_json=json.dumps(config)))
    db.commit()
    return config


def _guardrail(text: str, keywords: str) -> tuple[str, bool, str]:
    clean_text = str(text or "")[:4000]
    for pattern in SENSITIVE_PATTERNS:
        clean_text = re.sub(pattern, "[REDACTED]", clean_text, flags=re.IGNORECASE)
    lowered = clean_text.lower()
    for keyword in (value.strip().lower() for value in str(keywords or "").split(",")):
        if keyword and keyword in lowered:
            return clean_text, True, f"Matched handoff keyword: {keyword}"
    return clean_text, False, ""


def _generate_reply(config: dict, message: str) -> tuple[str, str, str]:
    prompt = f"{config['system_prompt']}\n\nKnowledge base:\n{config['knowledge_base']}\n\nCustomer message:\n{message}"
    preferred = config["provider"]
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    gemini_key = (os.getenv("GEMINI_API_KEY", "") or os.getenv("GOOGLE_API_KEY", "")).strip()
    if preferred == "openai" and openai_key:
        try:
            from openai import OpenAI
            response = OpenAI(api_key=openai_key, timeout=10).responses.create(model=config["model"] or "gpt-4.1-mini", input=prompt, max_output_tokens=220)
            text = str(response.output_text or "").strip()
            if text:
                return text[:1500], "openai", config["model"]
        except Exception as exc:
            logger.warning("WhatsApp AI OpenAI draft failed: %s", exc)
    if preferred == "gemini" and gemini_key:
        try:
            import google.generativeai as genai
            genai.configure(api_key=gemini_key)
            response = genai.GenerativeModel(config["model"] or "gemini-1.5-flash").generate_content(prompt)
            text = str(getattr(response, "text", "") or "").strip()
            if text:
                return text[:1500], "gemini", config["model"]
        except Exception as exc:
            logger.warning("WhatsApp AI Gemini draft failed: %s", exc)
    return "ধন্যবাদ আপনার বার্তার জন্য। মেঠো প্রতিনিধি শীঘ্রই আপনার সাথে যোগাযোগ করবেন।", "fallback", "local"


def create_suggestion_for_activity(activity_id: str) -> None:
    db = SessionLocal()
    try:
        activity = db.get(CRMLeadActivity, activity_id)
        if not activity or activity.activity_type != "whatsapp_message_received":
            return
        if db.query(CRMWhatsAppAISuggestion).filter(CRMWhatsAppAISuggestion.activity_id == activity.id).first():
            return
        lead = db.get(CRMLead, activity.lead_id)
        config = resolve_ai_config(db)
        if not lead or lead.source != "whatsapp" or not config["enabled"]:
            return
        incoming = activity.message.split("]: ", 1)[-1]
        clean_text, handoff, reason = _guardrail(incoming, config["handoff_keywords"])
        reply, provider, model = _generate_reply(config, clean_text)
        db.add(CRMWhatsAppAISuggestion(lead_id=lead.id, activity_id=activity.id, suggested_reply=reply, human_handoff_required=handoff, handoff_reason=reason, provider_used=provider, model_used=model))
        db.commit()
    except IntegrityError:
        db.rollback()
    except Exception:
        db.rollback()
        logger.exception("WhatsApp AI suggestion generation failed: activity_id=%s", activity_id)
    finally:
        db.close()