import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy.exc import IntegrityError

from .database import SessionLocal
from .google_search import search_web_context
from .models import AppSetting, CRMFollowUp, CRMLead, CRMLeadActivity, CRMTask, CRMWhatsAppAISuggestion, User

logger = logging.getLogger(__name__)
SETTING_KEY = "crm_whatsapp_ai"
DEFAULT_CONFIG = {
    "enabled": False,
    "auto_send_enabled": False,
    "auto_send_fallback_allowed": False,
    "suppress_static_default_when_ai_enabled": True,
    "follow_up_delay_hours": 24,
    "provider": "openai",
    "model": "gpt-4.1-mini",
    "system_prompt": "You are METHO AAY-UPAY customer support. Answer only from the CRM context and knowledge base. Reply in the customer's language. Be concise, polite, and practical. Do not invent product availability, prices, payment status, shipment status, approvals, rewards, refunds, or account changes. If the answer is not known from context, say a METHO team member will check and follow up.",
    "knowledge_base": "METHO AAY-UPAY is an e-commerce, member reward, partner shop/service, METHO Move, and delivery platform. Customers can ask about products, orders, registration, partner opportunities, rider work, payments, delivery, and support. Never ask for OTP, UPI PIN, ATM PIN, CVV, passwords, or full bank details.",
    "handoff_keywords": "agent,human,মানুষ,অফিস,complaint,refund,payment,legal,fraud,otp,password",
}
SENSITIVE_PATTERNS = (r"\b\d{4}[-\s]?\d{4}[-\s]?\d{4}\b", r"\b[A-Z]{5}[0-9]{4}[A-Z]\b", r"\b\d{6}\b")
SEARCH_TERMS = ("price", "cost", "benefit", "use", "detail", "product", "দাম", "কত", "উপকারিতা", "ব্যবহার", "বিস্তারিত", "পণ্য")
LIFECYCLE_SUGGESTIONS = {
    "registration_form_opened": "আপনি registration form খুলেছেন। Form পূরণ করতে কোনো সাহায্য লাগলে এখানেই লিখুন।",
    "registration_form_submitted": "আপনার registration form জমা হয়েছে। পরবর্তী ধাপ সম্পন্ন করতে কোনো সাহায্য লাগলে এখানে reply করুন।",    "registration_form_followup_started": "আপনার Registration Form জমা হয়েছে। Account activation বা approval status নিয়ে কোনো প্রশ্ন থাকলে এখানে reply করুন, আমরা সাহায্য করব।",    "member_registration_completed": "আপনার Member registration সম্পন্ন হয়েছে। Account activation ও প্রথম purchase-এর পরবর্তী ধাপে সহায়তা লাগলে এখানে reply করুন।",
    "member_activated": "আপনার Member account active হয়েছে। Smart Cycle, reward rules এবং product purchase নিয়ে সাহায্য লাগলে এখানে reply করুন।",
    "partner_registration_submitted": "আপনার Partner registration জমা হয়েছে। KYC ও approval-এর পরবর্তী ধাপে সহায়তা লাগলে এখানে reply করুন।",
    "partner_activated": "আপনার Partner account approved হয়েছে। Shop/service onboarding ও প্রথম listing-এর সাহায্য লাগলে এখানে reply করুন।",
    "metho_move_booking_created": "আপনার METHO Move booking request পাওয়া গেছে। Payment বা rider assignment বিষয়ে সাহায্য লাগলে এখানে reply করুন।",
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
    return bool(config.get("enabled") and config.get("suppress_static_default_when_ai_enabled"))


def _schedule_ai_follow_up(db, lead: CRMLead, config: dict, reason: str) -> None:
    try:
        delay_hours = max(1, min(168, int(config.get("follow_up_delay_hours") or 24)))
    except (TypeError, ValueError):
        delay_hours = 24
    scheduled_at = datetime.now(timezone.utc) + timedelta(hours=delay_hours)
    lead.next_follow_up_at = scheduled_at
    lead.follow_up_status = "Pending"
    existing = db.query(CRMFollowUp).filter(CRMFollowUp.lead_id == lead.id, CRMFollowUp.status == "Pending").order_by(CRMFollowUp.scheduled_at.asc()).first()
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


def _generate_reply(config: dict, message: str, context: str = "", event_type: str = "") -> tuple[str, str, str]:
    search_context = search_web_context(f"METHO AAY-UPAY {message}") if any(term in message.lower() for term in SEARCH_TERMS) else ""
    prompt = f"{config['system_prompt']}\n\nOperational rules: Use the CRM context to answer the next action clearly. If registration is submitted, explain the pending activation or approval step. If a follow-up is due, offer help and state that a human agent will follow up. Never claim an account is activated, a reward is paid, or an approval is complete unless the CRM context says so. For lifecycle event reminders, write one concise, actionable message and invite the customer to reply for help.\n\nTrigger event: {event_type or 'incoming_whatsapp_message'}\n\nCRM context:\n{context or 'No CRM context available.'}\n\nKnowledge base:\n{config['knowledge_base']}\n\nOptional public search context (use only as background; do not invent facts):\n{search_context or 'No search context available.'}\n\nCustomer message/event:\n{message}"
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
    return LIFECYCLE_SUGGESTIONS.get(event_type, "ধন্যবাদ আপনার বার্তার জন্য। মেঠো প্রতিনিধি শীঘ্রই আপনার সাথে যোগাযোগ করবেন।"), "fallback", "local"


def create_suggestion_for_activity(activity_id: str) -> None:
    db = SessionLocal()
    try:
        activity = db.get(CRMLeadActivity, activity_id)
        if not activity or activity.activity_type not in {"whatsapp_message_received", *LIFECYCLE_SUGGESTIONS}:
            return
        if db.query(CRMWhatsAppAISuggestion).filter(CRMWhatsAppAISuggestion.activity_id == activity.id).first():
            return
        lead = db.get(CRMLead, activity.lead_id)
        config = resolve_ai_config(db)
        if not lead or lead.source != "whatsapp" or not config["enabled"]:
            return
        incoming = activity.message.split("]: ", 1)[-1]
        clean_text, handoff, reason = _guardrail(incoming, config["handoff_keywords"])
        context = _crm_context(db, lead)
        reply, provider, model = _generate_reply(config, clean_text, context, activity.activity_type)
        suggestion = CRMWhatsAppAISuggestion(lead_id=lead.id, activity_id=activity.id, suggested_reply=reply, human_handoff_required=handoff, handoff_reason=reason, provider_used=provider, model_used=model)
        db.add(suggestion)
        db.flush()
        allow_auto_send, blocked_reason = _auto_send_allowed(config, suggestion, activity, provider)
        if allow_auto_send and _recent_outgoing_after(db, lead.id, activity.created_at):
            allow_auto_send = False
            blocked_reason = "Outgoing reply already recorded after this message"
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
            except Exception as exc:
                suggestion.status = "FAILED"
                suggestion.error_message = str(exc)[:500]
                db.add(CRMLeadActivity(lead_id=lead.id, activity_type="ai_suggestion_auto_send_failed", message=str(exc)[:500]))
        else:
            db.add(CRMLeadActivity(lead_id=lead.id, activity_type="ai_suggestion_created", message=f"AI draft created. Auto-send: no. Reason: {blocked_reason}. CRM context included: {context.splitlines()[0] if context else 'none'}"))
        _schedule_ai_follow_up(db, lead, config, "Review WhatsApp AI response and follow up with the customer if needed.")
        db.commit()
    except IntegrityError:
        db.rollback()
    except Exception:
        db.rollback()
        logger.exception("WhatsApp AI suggestion generation failed: activity_id=%s", activity_id)
    finally:
        db.close()