import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone

import requests
from sqlalchemy.exc import IntegrityError

from .database import SessionLocal
from .google_search import search_web_context
from .models import AppSetting, CRMFollowUp, CRMLead, CRMLeadActivity, CRMTask, CRMWhatsAppAISuggestion, PartnerRequest, Product, PublicOrder, User, WhatsAppMessageOutbox, WhatsAppRegistrationSession
from .whatsapp_cloud import WHATSAPP_PRESET_MESSAGE_DEFAULTS, get_whatsapp_preset_message

logger = logging.getLogger(__name__)
SETTING_KEY = "crm_whatsapp_ai"
DEFAULT_CONFIG = {
    "enabled": False,
    "auto_send_enabled": False,
    "auto_send_fallback_allowed": False,
    "suppress_static_default_when_ai_enabled": True,
    "follow_up_delay_hours": 24,
    "provider": "gemini",
    "model": "",
    "system_prompt": "You are METHO AAY-UPAY customer support. Answer only from the CRM context and knowledge base. Reply in the customer's language. Be concise, polite, and practical. Do not invent product availability, prices, payment status, shipment status, approvals, rewards, refunds, or account changes. If the answer is not known from context, say a METHO team member will check and follow up.",
    "knowledge_base": "METHO AAY-UPAY is an e-commerce, member reward, partner shop/service, METHO Move, and delivery platform. Customers can ask about products, orders, registration, partner opportunities, rider work, payments, delivery, and support. Never ask for OTP, UPI PIN, ATM PIN, CVV, passwords, or full bank details.",
    "handoff_keywords": "agent,human,মানুষ,অফিস,complaint,refund,payment,legal,fraud,otp,password",
}
SUPPORTED_GEMINI_MODELS = ("gemini-1.5-flash", "gemini-1.5-pro", "gemini-pro")
GEMINI_REST_BASE_URL = "https://generativelanguage.googleapis.com/v1/models"
GEMINI_MODEL_ALIASES = {
    "gemini_1.5": "gemini-1.5-flash",
    "gemini-1.5": "gemini-1.5-flash",
    "gemini-2.0-flash": "gemini-1.5-flash",
    "gemini-2.5-flash": "gemini-1.5-flash",
    "models/gemini_1.5": "gemini-1.5-flash",
    "models/gemini-1.5": "gemini-1.5-flash",
    "models/gemini-2.0-flash": "gemini-1.5-flash",
    "models/gemini-2.5-flash": "gemini-1.5-flash",
}
SENSITIVE_PATTERNS = (r"\b\d{4}[-\s]?\d{4}[-\s]?\d{4}\b", r"\b[A-Z]{5}[0-9]{4}[A-Z]\b", r"\b\d{6}\b")
SEARCH_TERMS = ("price", "cost", "benefit", "use", "detail", "product", "business", "join", "registration", "দাম", "কত", "উপকারিতা", "ব্যবহার", "বিস্তারিত", "পণ্য", "ব্যবসা", "যোগ", "রেজিস্ট্রেশন")
PRE_REGISTRATION_FOLLOWUP = WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_pre_registration_followup"]
LIFECYCLE_SUGGESTIONS = {
    "registration_form_opened": WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_lifecycle_registration_form_opened"],
    "registration_form_submitted": WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_lifecycle_registration_form_submitted"],
    "registration_form_followup_started": WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_lifecycle_registration_form_followup_started"],
    "member_registration_completed": WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_lifecycle_member_registration_completed"],
    "member_activated": WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_lifecycle_member_activated"],
    "partner_registration_submitted": WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_lifecycle_partner_registration_submitted"],
    "partner_activated": WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_lifecycle_partner_activated"],
    "rider_activated": WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_lifecycle_rider_activated"],
    "metho_move_booking_created": WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_lifecycle_metho_move_booking_created"],
    "crm_followup_due": WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_crm_followup_due"],
    "pre_registration_followup": PRE_REGISTRATION_FOLLOWUP,
}


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
    try:
        follow_up_delay_hours = max(1, min(168, int(data.get("follow_up_delay_hours", current.get("follow_up_delay_hours", 24)) or 24)))
    except (TypeError, ValueError):
        follow_up_delay_hours = 24
    config = {
        "enabled": bool(data.get("enabled", current["enabled"])),
        "auto_send_enabled": bool(data.get("auto_send_enabled", current.get("auto_send_enabled", False))),
        "auto_send_fallback_allowed": bool(data.get("auto_send_fallback_allowed", current.get("auto_send_fallback_allowed", False))),
        "suppress_static_default_when_ai_enabled": bool(data.get("suppress_static_default_when_ai_enabled", current.get("suppress_static_default_when_ai_enabled", True))),
        "follow_up_delay_hours": follow_up_delay_hours,
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


def _crm_context(db, lead: CRMLead) -> str:
    followup = db.query(CRMFollowUp).filter(CRMFollowUp.lead_id == lead.id, CRMFollowUp.status == "Pending").order_by(CRMFollowUp.scheduled_at.asc()).first()
    tasks = db.query(CRMTask).filter(CRMTask.lead_id == lead.id, CRMTask.status.in_(["Pending", "In Progress"])).order_by(CRMTask.due_at.asc()).limit(5).all()
    activities = db.query(CRMLeadActivity).filter(CRMLeadActivity.lead_id == lead.id).order_by(CRMLeadActivity.created_at.desc()).limit(8).all()
    registration = "member linked" if lead.member_user_id else "partner request linked" if lead.partner_request_id else "partner active" if lead.converted_partner_id else "not linked"
    timeline = "; ".join(f"{row.activity_type}: {str(row.message or '')[:160]}" for row in reversed(activities))
    return "\n".join((
        f"CRM stage: {lead.status}",
        f"Lead source: {lead.source}",
        f"Priority: {lead.priority_bucket}",
        f"Registration/account: {registration}",
        f"Next follow-up: {followup.scheduled_at.isoformat() if followup and followup.scheduled_at else 'none'}",
        f"Pending admin actions: {', '.join(task.title for task in tasks) or 'none'}",
        f"Recent CRM timeline: {timeline or 'none'}",
    ))


def _conversation_context(db, lead: CRMLead) -> str:
    activities = db.query(CRMLeadActivity).filter(
        CRMLeadActivity.lead_id == lead.id,
        CRMLeadActivity.activity_type.in_(["whatsapp_message_received", "whatsapp_message_sent"]),
    ).order_by(CRMLeadActivity.created_at.desc()).limit(6).all()
    return "\n".join(f"{row.activity_type}: {str(row.message or '')[:500]}" for row in reversed(activities)) or "No previous WhatsApp conversation available."


def _catalog_context(db) -> str:
    products = db.query(Product).filter(Product.stock > 0).order_by(Product.created_at.desc()).limit(30).all()
    if not products:
        return "No currently stocked product found in the catalog."
    return "\n".join(
        f"{product.name} | category: {product.category} | price: INR {product.price:g} | stock: {product.stock}"
        for product in products
    )


def enqueue_whatsapp_message(db, dedupe_key: str, recipient: str, message: str, lead_id: str = "", activity_type: str = "whatsapp_message_sent") -> bool:
    if not str(recipient or "").strip() or not str(message or "").strip():
        return False
    try:
        db.add(WhatsAppMessageOutbox(
            dedupe_key=str(dedupe_key).strip(),
            recipient=str(recipient).strip(),
            message=str(message).strip(),
            lead_id=str(lead_id or "").strip() or None,
            activity_type=str(activity_type or "whatsapp_message_sent").strip()[:60],
        ))
        db.commit()
        return True
    except IntegrityError:
        db.rollback()
        return False


def process_message_outbox(limit: int = 20) -> int:
    db = SessionLocal()
    sent_count = 0
    try:
        now = datetime.now(timezone.utc)
        rows = db.query(WhatsAppMessageOutbox).filter(
            WhatsAppMessageOutbox.status.in_(["pending", "retry"]),
            WhatsAppMessageOutbox.next_attempt_at <= now,
        ).order_by(WhatsAppMessageOutbox.created_at.asc()).limit(max(1, min(100, int(limit)))).all()
        for row in rows:
            row.status = "processing"
            row.attempts += 1
            db.commit()
            try:
                from .whatsapp_cloud import send_whatsapp_message
                send_whatsapp_message(db, row.recipient, text=row.message)
                row.status = "sent"
                row.sent_at = datetime.now(timezone.utc)
                row.last_error = ""
                if row.lead_id:
                    db.add(CRMLeadActivity(lead_id=row.lead_id, activity_type=row.activity_type, message=row.message))
                db.commit()
                sent_count += 1
            except Exception as exc:
                row.last_error = str(exc)[:1000]
                row.status = "failed" if row.attempts >= 5 else "retry"
                row.next_attempt_at = datetime.now(timezone.utc) + timedelta(minutes=min(60, 2 ** row.attempts))
                db.commit()
                logger.exception("WhatsApp outbox delivery failed: outbox_id=%s", row.id)
        return sent_count
    finally:
        db.close()


def _admin_assignee(db) -> str:
    configured = ""
    try:
        from .whatsapp_cloud import resolve_config
        configured = str(resolve_config(db).get("default_assignee_id") or "").strip()
    except Exception:
        configured = ""
    if configured:
        if db.query(User).filter(User.id == configured, User.role.in_(["super_admin", "company_admin", "admin"]), User.is_active.is_(True)).first():
            return configured
    admin = db.query(User).filter(User.role.in_(["super_admin", "company_admin", "admin"]), User.is_active.is_(True)).order_by(User.created_at.asc()).first()
    return admin.id if admin else ""


def should_ai_handle_freeform_reply(db) -> bool:
    config = resolve_ai_config(db)
    return bool(config.get("enabled")) and bool(config.get("auto_send_enabled"))


def _schedule_ai_follow_up(db, lead: CRMLead, config: dict, reason: str) -> None:
    try:
        delay_hours = max(1, min(168, int(config.get("follow_up_delay_hours") or 24)))
    except (TypeError, ValueError):
        delay_hours = 24
    scheduled_at = datetime.now(timezone.utc) + timedelta(hours=delay_hours)
    lead.next_follow_up_at = scheduled_at
    lead.follow_up_status = "Pending"
    existing = db.query(
        CRMFollowUp
    ).filter(
        CRMFollowUp.lead_id == lead.id,
        CRMFollowUp.status == "Pending",
        CRMFollowUp.notes == reason,
    ).first()
    if existing:
        existing.scheduled_at = scheduled_at
        existing.notes = reason
    else:
        db.add(CRMFollowUp(lead_id=lead.id, scheduled_at=scheduled_at, status="Pending", notes=reason))
    assignee_id = lead.assigned_user_id or _admin_assignee(db)
    if assignee_id:
        task = db.query(CRMTask).filter(CRMTask.lead_id == lead.id, CRMTask.status.in_(["Pending", "In Progress"]), CRMTask.title == "WhatsApp AI follow-up").first()
        if task:
            task.due_at = scheduled_at
            task.description = reason
        else:
            db.add(CRMTask(title="WhatsApp AI follow-up", description=reason, due_at=scheduled_at, status="Pending", priority="Medium", lead_id=lead.id, assigned_user_id=assignee_id, created_by_user_id=assignee_id))


def _recent_outgoing_after(db, lead_id: str, created_at) -> bool:
    if not created_at:
        return False
    return db.query(CRMLeadActivity).filter(CRMLeadActivity.lead_id == lead_id, CRMLeadActivity.activity_type == "whatsapp_message_sent", CRMLeadActivity.created_at >= created_at).first() is not None


def _auto_send_allowed(config: dict, suggestion: CRMWhatsAppAISuggestion, activity: CRMLeadActivity, provider: str) -> tuple[bool, str]:
    if not config.get("auto_send_enabled"):
        return False, "Auto-send disabled"
    if suggestion.human_handoff_required:
        return False, suggestion.handoff_reason or "Human handoff required"
    if provider == "fallback" and not config.get("auto_send_fallback_allowed"):
        return False, "Fallback reply requires admin review"
    text = str(suggestion.suggested_reply or "").strip()
    if not text:
        return False, "Empty AI reply"
    if len(text) > 1500:
        return False, "AI reply too long"
    return True, ""


def _send_preset_fallback(db, lead: CRMLead, role: str | None) -> tuple[str, str]:
    from .whatsapp_cloud import (
        get_configured_whatsapp_reply,
        get_configured_whatsapp_reply_image,
        get_configured_whatsapp_reply_mode,
        public_whatsapp_image_url,
        send_whatsapp_image,
        send_whatsapp_message,
    )

    mode = get_configured_whatsapp_reply_mode(db, role)
    text = get_configured_whatsapp_reply(db, role, LIFECYCLE_SUGGESTIONS.get("crm_followup_due", ""))
    recipient = str(lead.whatsapp_no or lead.phone or "").strip()
    if not recipient:
        raise ValueError("WhatsApp phone number is missing")
    if mode == "image":
        image_url = get_configured_whatsapp_reply_image(db, role)
        if not image_url:
            raise ValueError("Preset is set to poster only but no poster is attached")
        send_whatsapp_image(db, recipient, public_whatsapp_image_url(image_url), caption=text[:1024])
        return image_url, "preset-image"
    send_whatsapp_message(db, recipient, text=text)
    return text, "preset-text"


def _gemini_model_name(model) -> str:
    if isinstance(model, str):
        return model.strip()
    return str(getattr(model, "name", "") or "").strip()


def _gemini_model_basename(model_name: str) -> str:
    value = _gemini_model_name(model_name).replace("_", "-").strip().lower()
    return GEMINI_MODEL_ALIASES.get(value, value).removeprefix("models/").strip()


def _gemini_candidate_models(configured_model: str) -> list[str]:
    configured_base = _gemini_model_basename(configured_model)
    if configured_base not in SUPPORTED_GEMINI_MODELS:
        configured_base = "gemini-1.5-flash"
    candidates = []
    for desired_model in (configured_base, *SUPPORTED_GEMINI_MODELS):
        if desired_model not in candidates:
            candidates.append(desired_model)
    return candidates


def _gemini_generate_content(api_key: str, model_name: str, prompt: str) -> str:
    model_id = _gemini_model_basename(model_name)
    endpoint = f"{GEMINI_REST_BASE_URL}/{model_id}:generateContent"
    response = requests.post(
        endpoint,
        params={"key": api_key},
        json={"contents": [{"parts": [{"text": prompt}]}]},
        timeout=15,
    )
    response.raise_for_status()
    payload = response.json()
    return str(payload["candidates"][0]["content"]["parts"][0]["text"] or "").strip()


def _generate_reply(config: dict, message: str, context: str = "", event_type: str = "", db=None) -> tuple[str, str, str]:
    search_context = search_web_context(f"METHO AAY-UPAY {message}") if any(term in message.lower() for term in SEARCH_TERMS) else ""
    prompt = f"{config['system_prompt']}\n\nYou are a helpful METHO customer-care teammate, not a generic chatbot. Reply like a real person: acknowledge the customer's exact question, answer directly, and give one practical next step. Detect the language of the customer's latest message and reply in that language; preserve familiar product names and links. Use the CRM context and previous conversation so you do not repeat questions or contradict earlier replies. Explain products, prices, delivery, business opportunities, and how to join only from verified context. If a fact is missing or sensitive, say that a human METHO team member will verify it and create a follow-up instead of guessing. Never claim an account is activated, a reward is paid, a purchase is completed, stock is available, or an approval is complete unless the context says so. Never include an executive/support phone number unless it is present in the verified CRM/config context. For reminders, be warm and specific, never spammy, and keep the reply under 900 characters.\n\nTrigger event: {event_type or 'incoming_whatsapp_message'}\n\nCRM and conversation context:\n{context or 'No CRM context available.'}\n\nKnowledge base:\n{config['knowledge_base']}\n\nOptional public search context (use only as background; do not copy source wording or invent facts):\n{search_context or 'No search context available.'}\n\nCustomer message/event:\n{message}"
    gemini_key = (os.getenv("GEMINI_API_KEY", "") or os.getenv("GOOGLE_API_KEY", "")).strip()

    if gemini_key:
        try:
            gemini_error = None
            for model_name in _gemini_candidate_models(str(config.get("model") or "")):
                try:
                    logger.info("WhatsApp AI Gemini generation start: model=%s message_length=%s", model_name, len(message))
                    text = _gemini_generate_content(gemini_key, model_name, prompt)
                    logger.info("WhatsApp AI Gemini generation complete: model=%s usable_output=%s", model_name, bool(text and text.strip()))
                    if text:
                        return text[:1500], "gemini", model_name
                except Exception as exc:
                    gemini_error = exc
                    logger.warning("WhatsApp AI Gemini model failed: model=%s error=%s", model_name, exc)
            if gemini_error:
                raise gemini_error
        except Exception as exc:
            logger.warning("WhatsApp AI Gemini reply failed; using local fallback: %s", exc)
    else:
        logger.error("WhatsApp AI Gemini provider selected but GEMINI_API_KEY/GOOGLE_API_KEY is not configured")
    if event_type in LIFECYCLE_SUGGESTIONS:
        return get_whatsapp_preset_message(db, f"preset_lifecycle_{event_type}", LIFECYCLE_SUGGESTIONS[event_type]), "fallback", "local"
    return get_whatsapp_preset_message(db, "preset_ai_local_fallback", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_ai_local_fallback"]), "fallback", "local"


def create_suggestion_for_activity(activity_id: str) -> None:
    db = SessionLocal()
    try:
        activity = db.get(CRMLeadActivity, activity_id)
        if not activity or activity.activity_type not in {"whatsapp_message_received", *LIFECYCLE_SUGGESTIONS}:
            logger.info("WhatsApp AI skipped: invalid activity activity_id=%s", activity_id)
            return
        if db.query(CRMWhatsAppAISuggestion).filter(CRMWhatsAppAISuggestion.activity_id == activity.id).first():
            return
        lead = db.get(CRMLead, activity.lead_id)
        config = resolve_ai_config(db)
        logger.info("WhatsApp AI activity accepted: activity_id=%s lead_id=%s source=%s enabled=%s auto_send=%s provider=%s model=%s", activity.id, activity.lead_id, getattr(lead, "source", "missing"), config.get("enabled"), config.get("auto_send_enabled"), config.get("provider"), config.get("model"))
        if not lead or lead.source not in {"whatsapp", "facebook"} or not config["enabled"]:
            logger.info("WhatsApp AI skipped: missing lead/source or disabled: activity_id=%s lead_id=%s", activity.id, activity.lead_id)
            return
        if activity.activity_type == "whatsapp_message_received":
            message_id = str(activity.message or "").split("]:", 1)[0].removeprefix("WhatsApp message received [").strip()
            if message_id and db.query(CRMLeadActivity).filter(
                CRMLeadActivity.lead_id == lead.id,
                CRMLeadActivity.activity_type == "whatsapp_auto_reply_dispatched",
                CRMLeadActivity.message.like(f"auto-reply-for:{message_id}%"),
            ).first():
                logger.info("WhatsApp AI skipped: webhook preset already dispatched: activity_id=%s message_id=%s", activity.id, message_id)
                return
        incoming = activity.message.split("]: ", 1)[-1]
        clean_text, handoff, reason = _guardrail(incoming, config["handoff_keywords"])
        context = f"{_crm_context(db, lead)}\nPrevious WhatsApp conversation:\n{_conversation_context(db, lead)}\nAvailable METHO catalog:\n{_catalog_context(db)}"
        reply, provider, model = _generate_reply(config, clean_text, context, activity.activity_type, db)
        logger.info("WhatsApp AI reply generated: activity_id=%s lead_id=%s provider=%s model=%s handoff=%s", activity.id, lead.id, provider, model, handoff)
        db.query(CRMWhatsAppAISuggestion).filter(
            CRMWhatsAppAISuggestion.lead_id == lead.id,
            CRMWhatsAppAISuggestion.status == "PENDING",
        ).update({"status": "SUPERSEDED"}, synchronize_session=False)
        suggestion = CRMWhatsAppAISuggestion(lead_id=lead.id, activity_id=activity.id, suggested_reply=reply, human_handoff_required=handoff, handoff_reason=reason, provider_used=provider, model_used=model)
        db.add(suggestion)
        db.flush()
        role_hint = None
        lowered_message = clean_text.lower()
        for candidate in ("member", "partner", "rider"):
            if candidate in lowered_message:
                role_hint = candidate
                break
        allow_auto_send, blocked_reason = _auto_send_allowed(config, suggestion, activity, provider)
        if allow_auto_send and _recent_outgoing_after(db, lead.id, activity.created_at):
            allow_auto_send = False
            blocked_reason = "Outgoing reply already recorded after this message"
        if provider == "fallback" and config.get("auto_send_enabled") and not handoff and not _recent_outgoing_after(db, lead.id, activity.created_at):
            try:
                preset_reply, preset_kind = _send_preset_fallback(db, lead, role_hint)
                suggestion.status = "SENT"
                suggestion.provider_used = preset_kind
                suggestion.model_used = "admin-configured"
                suggestion.suggested_reply = preset_reply
                suggestion.sent_reply = preset_reply
                suggestion.error_message = ""
                lead.last_contact_at = datetime.now(timezone.utc)
                db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_sent" if preset_kind == "preset-text" else "whatsapp_image_sent", message=preset_reply))
                db.add(CRMLeadActivity(lead_id=lead.id, activity_type="ai_suggestion_auto_sent", message="Admin preset auto-sent because AI provider fallback was used."))
                logger.info("WhatsApp preset fallback sent: activity_id=%s lead_id=%s kind=%s", activity.id, lead.id, preset_kind)
                allow_auto_send = False
                blocked_reason = "Admin preset sent after AI fallback"
            except Exception as exc:
                suggestion.error_message = str(exc)[:500]
                db.add(CRMLeadActivity(lead_id=lead.id, activity_type="preset_auto_send_failed", message=str(exc)[:500]))
                logger.exception("WhatsApp preset fallback failed: activity_id=%s lead_id=%s", activity.id, lead.id)
        if allow_auto_send:
            try:
                from .whatsapp_cloud import send_whatsapp_message
                send_whatsapp_message(db, lead.whatsapp_no or lead.phone, text=reply)
                suggestion.status = "SENT"
                suggestion.sent_reply = reply
                suggestion.error_message = ""
                lead.last_contact_at = datetime.now(timezone.utc)
                db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_sent", message=reply))
                db.add(CRMLeadActivity(lead_id=lead.id, activity_type="ai_suggestion_auto_sent", message=f"AI auto-reply sent with {provider}/{model}."))
                logger.info("WhatsApp AI reply sent: activity_id=%s lead_id=%s provider=%s model=%s", activity.id, lead.id, provider, model)
            except Exception as exc:
                queued = enqueue_whatsapp_message(db, f"ai-autosend:{suggestion.id}", lead.whatsapp_no or lead.phone, reply, lead.id, "ai_suggestion_auto_sent")
                suggestion.status = "PENDING" if queued else "FAILED"
                suggestion.error_message = ("AI reply queued for retry after WhatsApp send failure" if queued else str(exc))[:500]
                db.add(CRMLeadActivity(lead_id=lead.id, activity_type="ai_suggestion_auto_send_failed", message=str(exc)[:500]))
                logger.exception("WhatsApp AI reply send failed: activity_id=%s lead_id=%s provider=%s model=%s", activity.id, lead.id, provider, model)
        else:
            db.add(CRMLeadActivity(lead_id=lead.id, activity_type="ai_suggestion_created", message=f"AI draft created. Auto-send: no. Reason: {blocked_reason}. CRM context included: {context.splitlines()[0] if context else 'none'}"))
        if activity.activity_type != "crm_followup_due":
            _schedule_ai_follow_up(db, lead, config, "Review WhatsApp AI response and follow up with the customer if needed.")
        db.commit()
    except IntegrityError:
        db.rollback()
        logger.info("WhatsApp AI suggestion duplicate prevented: activity_id=%s", activity_id)
    except Exception:
        db.rollback()
        logger.exception("WhatsApp AI suggestion generation failed: activity_id=%s", activity_id)
    finally:
        db.close()


def process_pending_whatsapp_ai_activities(limit: int = 20, lookback_hours: int = 24) -> int:
    db = SessionLocal()
    try:
        config = resolve_ai_config(db)
        if not config.get("enabled"):
            return 0
        since = datetime.now(timezone.utc) - timedelta(hours=max(1, min(168, int(lookback_hours or 24))))
        rows = db.query(CRMLeadActivity).join(CRMLead, CRMLead.id == CRMLeadActivity.lead_id).filter(
            CRMLeadActivity.activity_type == "whatsapp_message_received",
            CRMLeadActivity.created_at >= since,
            CRMLead.source.in_(["whatsapp", "facebook"]),
            ~db.query(CRMWhatsAppAISuggestion.id).filter(CRMWhatsAppAISuggestion.activity_id == CRMLeadActivity.id).exists(),
        ).order_by(CRMLeadActivity.created_at.asc()).limit(max(1, min(100, int(limit or 20)))).all()
        activity_ids = []
        for activity in rows:
            message_id = str(activity.message or "").split("]:", 1)[0].removeprefix("WhatsApp message received [").strip()
            if message_id and db.query(CRMLeadActivity).filter(
                CRMLeadActivity.lead_id == activity.lead_id,
                CRMLeadActivity.activity_type == "whatsapp_auto_reply_dispatched",
                CRMLeadActivity.message.like(f"auto-reply-for:{message_id}%"),
            ).first():
                continue
            activity_ids.append(activity.id)
    finally:
        db.close()
    for activity_id in activity_ids:
        create_suggestion_for_activity(activity_id)
    return len(activity_ids)


def process_due_followups(limit: int = 20) -> int:
    db = SessionLocal()
    processed = 0
    try:
        now = datetime.now(timezone.utc)
        rows = db.query(CRMFollowUp).join(CRMLead, CRMLead.id == CRMFollowUp.lead_id).filter(
            CRMFollowUp.status == "Pending",
            CRMFollowUp.scheduled_at <= now,
            CRMLead.source.in_(["whatsapp", "facebook"]),
        ).order_by(CRMFollowUp.scheduled_at.asc()).limit(max(1, min(100, int(limit)))).all()
        for followup in rows:
            lead = db.get(CRMLead, followup.lead_id)
            recipient = str((lead.whatsapp_no if lead else "") or (lead.phone if lead else "")).strip()
            if not lead or not recipient:
                followup.status = "Skipped"
                continue
            lifecycle_state = _whatsapp_followup_state(db, lead, followup)
            if lifecycle_state == "completed":
                followup.status = "Completed"
                _complete_followup_task_rows(db, lead, followup.notes)
                continue
            followup.status = "Processing"
            reminder_notes = "Abandoned registration reminder"
            is_abandoned_registration = str(followup.notes or "") == reminder_notes
            is_pre_registration = not is_abandoned_registration and not lead.member_user_id and any(marker in str(followup.notes or "") for marker in ("Initial Meta", "Initial WhatsApp", "Follow-up for WhatsApp", "linked Meta/Facebook"))
            activity = CRMLeadActivity(
                lead_id=lead.id,
                activity_type="registration_reminder_queued" if is_abandoned_registration else "pre_registration_followup" if is_pre_registration else "crm_followup_due",
                message=f"Scheduled CRM follow-up: {followup.notes or 'Please follow up with this lead.'}",
            )
            db.add(activity)
            db.flush()
            from .whatsapp_cloud import _tracked_registration_url, get_configured_whatsapp_reply, resolve_config
            if is_abandoned_registration:
                session = db.query(WhatsAppRegistrationSession).filter(WhatsAppRegistrationSession.lead_id == lead.id).first()
                role = session.role if session and session.role in {"member", "partner", "rider"} else "member"
                config = resolve_config(db)
                registration_url = _tracked_registration_url(config[f"{role}_registration_url"], role, lead.id, recipient)
                fallback_text = get_whatsapp_preset_message(db, "preset_abandoned_registration_reminder", "", role=role.title(), registration_url=registration_url)
                outbox_activity_type = "registration_reminder_sent"
            else:
                fallback_text = get_whatsapp_preset_message(db, "preset_pre_registration_followup", PRE_REGISTRATION_FOLLOWUP) if is_pre_registration else (get_configured_whatsapp_reply(db, "default") or get_whatsapp_preset_message(db, "preset_crm_followup_due", LIFECYCLE_SUGGESTIONS["crm_followup_due"]))
                outbox_activity_type = "whatsapp_message_sent"
            scheduled_marker = int((followup.scheduled_at or now).timestamp())
            queued = enqueue_whatsapp_message(db, f"crm-followup:{followup.id}:{scheduled_marker}", recipient, fallback_text, lead.id, outbox_activity_type)
            if queued:
                db.commit()
            if queued or db.query(WhatsAppMessageOutbox).filter(WhatsAppMessageOutbox.dedupe_key == f"crm-followup:{followup.id}:{scheduled_marker}").first():
                if is_abandoned_registration:
                    followup.status = "Pending"
                    followup.scheduled_at = now + timedelta(hours=24)
                    lead.follow_up_status = "Pending"
                    lead.next_follow_up_at = followup.scheduled_at
                    processed += 1
                    db.commit()
                    continue
                followup.status = "Sent"
                lead.last_contact_at = now
                from .models import PublicOrder
                paid_orders = db.query(PublicOrder).filter(PublicOrder.status == "paid", PublicOrder.customer_user_id == lead.member_user_id).count() if lead.member_user_id else 0
                registration_reminder = "activation/payment" in str(followup.notes or "").lower() or "first purchase" in str(followup.notes or "").lower() or "member activation" in str(followup.notes or "").lower()
                reorder_reminder = "next product purchase" in str(followup.notes or "").lower()
                if registration_reminder and lead.member_user_id and paid_orders == 0:
                    followup.status = "Pending"
                    followup.scheduled_at = now + timedelta(days=3)
                    lead.follow_up_status = "Pending"
                    lead.next_follow_up_at = followup.scheduled_at
                elif reorder_reminder and paid_orders <= 1:
                    next_due = now + timedelta(days=30)
                    existing_reorder = db.query(CRMFollowUp).filter(
                        CRMFollowUp.lead_id == lead.id,
                        CRMFollowUp.status == "Pending",
                        CRMFollowUp.notes == followup.notes,
                    ).first()
                    if existing_reorder:
                        existing_reorder.scheduled_at = next_due
                    else:
                        db.add(CRMFollowUp(lead_id=lead.id, scheduled_at=next_due, status="Pending", notes=followup.notes))
                    lead.follow_up_status = "Pending"
                    lead.next_follow_up_at = next_due
                else:
                    lead.follow_up_status = "Completed"
                    lead.next_follow_up_at = None
                processed += 1
            else:
                followup.status = "Pending"
                followup.scheduled_at = now + timedelta(hours=1)
            db.commit()
        return processed
    except Exception:
        db.rollback()
        logger.exception("Due WhatsApp follow-up processing failed")
        return processed
    finally:
        db.close()


def _complete_followup_task_rows(db, lead: CRMLead, notes: str) -> None:
    for task in db.query(CRMTask).filter(CRMTask.lead_id == lead.id, CRMTask.status.in_(["Pending", "In Progress"])).all():
        if str(notes or "").lower() in str(task.title or "").lower() or str(task.title or "").lower() in str(notes or "").lower():
            task.status = "Completed"


def _whatsapp_followup_state(db, lead: CRMLead, followup: CRMFollowUp) -> str:
    notes = str(followup.notes or "").lower()
    session = db.query(WhatsAppRegistrationSession).filter(WhatsAppRegistrationSession.lead_id == lead.id).first()
    if notes == "abandoned registration reminder":
        if str(lead.status or "").upper() in {"LOST", "CLOSED"} or lead.member_user_id or lead.partner_request_id or lead.rider_user_id:
            return "completed"
        return "pending"
    if "member activation" in notes or "activation/payment" in notes or "first purchase" in notes:
        user = db.query(User).filter(User.id == lead.member_user_id, User.role == "member").first() if lead.member_user_id else None
        if user and user.is_active:
            try:
                from .routers.compat import _member_purchase_active
                return "pending" if not _member_purchase_active(db, user.id) else "completed"
            except Exception:
                return "pending"
        return "pending"
    if "partner approval" in notes:
        request = db.query(PartnerRequest).filter(PartnerRequest.id == lead.partner_request_id).first() if lead.partner_request_id else None
        return "completed" if request and str(request.status or "").lower() in {"approved", "rejected"} else "pending"
    if "rider approval" in notes:
        rider = db.query(User).filter(User.id == lead.rider_user_id, User.role == "rider").first() if lead.rider_user_id else None
        profile = db.query(AppSetting).filter(AppSetting.key == f"rider_profile:{rider.id}").first() if rider else None
        try:
            status = str((json.loads(profile.value_json or "{}") if profile else {}).get("approval_status") or "pending").lower()
        except (TypeError, ValueError):
            status = "pending"
        return "completed" if status in {"approved", "rejected"} else "pending"
    if session and session.state in {"MEMBER_NAME", "MEMBER_ADDRESS", "MEMBER_PAN", "MEMBER_DOB", "PARTNER_BUSINESS_TYPE", "RIDER_NAME"}:
        return "pending"
    return "pending"


def process_birthday_reminders(limit: int = 50) -> int:
    db = SessionLocal()
    sent_count = 0
    try:
        today = datetime.now(timezone.utc).date()
        year = today.year
        users = db.query(User).filter(User.is_active.is_(True), User.phone != "").limit(max(1, min(200, int(limit)))).all()
        for user in users:
            row = db.query(AppSetting).filter(AppSetting.key == f"user_profile:{user.id}").first()
            try:
                profile = json.loads(row.value_json or "{}") if row else {}
            except json.JSONDecodeError:
                profile = {}
            dob = str((profile if isinstance(profile, dict) else {}).get("dob") or "").strip()
            if not dob:
                continue
            try:
                birth_date = datetime.fromisoformat(dob[:10]).date()
            except ValueError:
                continue
            if (birth_date.month, birth_date.day) != (today.month, today.day):
                continue
            lead = db.query(CRMLead).filter((CRMLead.phone == user.phone) | (CRMLead.whatsapp_no == user.phone)).first()
            if not lead or lead.source not in {"whatsapp", "facebook"}:
                continue
            marker = f"birthday_message_sent:{year}"
            if db.query(CRMLeadActivity).filter(CRMLeadActivity.lead_id == lead.id, CRMLeadActivity.activity_type == marker).first():
                continue
            try:
                message = f"শুভ জন্মদিন, {user.name}! METHO পরিবারের পক্ষ থেকে আপনার জন্য আন্তরিক শুভেচ্ছা। আপনার পছন্দের product, business বা registration নিয়ে কোনো সাহায্য লাগলে এই WhatsApp-এ লিখুন।"
                if enqueue_whatsapp_message(db, f"birthday:{lead.id}:{year}", lead.whatsapp_no or lead.phone, message, lead.id, marker):
                    sent_count += 1
            except Exception:
                db.rollback()
                logger.exception("Birthday WhatsApp reminder failed: user_id=%s", user.id)
        return sent_count
    finally:
        db.close()