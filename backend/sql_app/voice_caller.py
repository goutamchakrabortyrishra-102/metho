import json
import logging
import re
import uuid
from datetime import datetime, timezone
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

from .models import AppSetting, AssociatePartner, CRMLead, CRMLeadActivity, CRMVoiceCallAttempt, CRMVoiceCallCampaign, User


REGISTRATION_TYPES = {"MEMBER", "PARTNER", "RIDER", "OTHER"}
SUPPORTED_LANGUAGES = {"bn", "en", "hi"}
CALL_STATUSES = {
    "CALL_PENDING",
    "CALLING",
    "CONNECTED",
    "QUALIFIED",
    "NOT_QUALIFIED",
    "CALLBACK_REQUESTED",
    "NO_ANSWER",
    "FAILED",
    "CONFIRMED",
}
RETRYABLE_STATUSES = {"FAILED", "NO_ANSWER"}
TARGET_TYPES = {"LEAD", "MEMBER", "PARTNER", "RIDER"}
CALL_PURPOSES = {"NEW_LEAD_QUALIFICATION", "REGISTRATION_REMINDER", "FOLLOW_UP", "SALES_OR_REORDER", "MEMBER_ENGAGEMENT", "PARTNER_FOLLOW_UP", "RIDER_FOLLOW_UP"}
SENSITIVE_KEYS = {"aadhaar", "pan", "password", "otp", "token", "access_token", "api_key", "payment", "card", "bank"}
REGISTRATION_LINKS = {
    "MEMBER": "/register",
    "PARTNER": "/partner-register",
    "RIDER": "/rider-register",
    "OTHER": None,
}
PROFILE_KEYS = (
    "test_endpoint_url",
    "call_endpoint_url",
    "test_http_method",
    "auth_type",
    "auth_header_name",
    "agent_list_path",
    "agent_id_field",
    "agent_name_field",
)

logger = logging.getLogger(__name__)
PLATFORM_CONTEXT = "METHO AAY-UPAY platform"


def _int_setting(value, default: int, minimum: int, maximum: int) -> int:
    try:
        return max(minimum, min(maximum, int(value)))
    except (TypeError, ValueError):
        return default


def load_voice_config(db) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == "ai_voice_caller").first()
    if not row:
        return {}
    try:
        payload = json.loads(row.value_json or "{}")
    except json.JSONDecodeError:
        return {}
    if not isinstance(payload, dict):
        return {}
    result = {key: payload.get(key) for key in ("enabled", "provider", "caller_id", "bengali_voice", "hindi_voice", "english_voice", "model", "max_call_attempts", "retry_delay_minutes", *PROFILE_KEYS) if key in payload}
    from .meta_ads import decrypt_secret

    for key in ("api_key", "api_secret"):
        if payload.get(key):
            result[key] = decrypt_secret(payload[key]).strip()
    return result


def resolve_voice_config(db) -> dict:
    stored = load_voice_config(db)
    provider = str(stored.get("provider") or "mock").strip().lower() or "mock"
    return {
        "enabled": bool(stored.get("enabled", False)),
        "provider": provider,
        "caller_id": str(stored.get("caller_id") or "").strip(),
        "bengali_voice": str(stored.get("bengali_voice") or "").strip(),
        "hindi_voice": str(stored.get("hindi_voice") or "").strip(),
        "english_voice": str(stored.get("english_voice") or "").strip(),
        "model": str(stored.get("model") or "").strip(),
        "max_call_attempts": _int_setting(stored.get("max_call_attempts"), 1, 1, 5),
        "retry_delay_minutes": _int_setting(stored.get("retry_delay_minutes"), 60, 1, 10080),
        "api_key": str(stored.get("api_key") or "").strip(),
        "api_secret": str(stored.get("api_secret") or "").strip(),
        **{key: str(stored.get(key) or "").strip() for key in PROFILE_KEYS},
    }


def validate_voice_config(config: dict) -> list[str]:
    if not config.get("enabled") or config.get("provider") == "mock":
        return []
    required = ["provider", "api_key", "caller_id", "bengali_voice", "hindi_voice", "english_voice", "test_http_method", "auth_type", "auth_header_name", "agent_id_field", "agent_name_field"]
    return [key for key in required if not str(config.get(key) or "").strip()]
CONVERSATION_START_PROMPT = "আপনি বাংলা, হিন্দি, না ইংরেজিতে কথা বলতে চান? / आप बंगाली, हिंदी या अंग्रेज़ी में बात करना पसंद करेंगे? / Would you prefer Bengali, Hindi, or English?"
QUALIFICATION_QUESTIONS = {
    "bn": [
        "আপনি মেঠো আয়-উপায়ের সঙ্গে সদস্য, পার্টনার, না রাইডার হিসেবে যুক্ত হতে চান?",
        "আপনি কি এই বিষয়ে আরও জানতে এবং নিবন্ধন সম্পূর্ণ করতে আগ্রহী?",
    ],
    "hi": [
        "आप मेठो आय-उपाय से सदस्य, पार्टनर या राइडर के रूप में जुड़ना चाहते हैं?",
        "क्या आप अधिक जानकारी लेकर पंजीकरण पूरा करने में रुचि रखते हैं?",
    ],
    "en": [
        "Would you like to join METHO AAY-UPAY as a member, partner, or rider?",
        "Would you like more information and help completing your registration?",
    ],
}


class MockVoiceProvider:
    name = "mock"

    def queue_call(self, target) -> str:
        return f"mock-{target.id}-{uuid.uuid4().hex[:12]}"


class VoiceCallProviderError(Exception):
    pass


def normalize_phone_number(value: str | None) -> str:
    phone = re.sub(r"[^0-9+]", "", str(value or "").strip())
    if phone.count("+") > 1 or ("+" in phone and not phone.startswith("+")):
        raise ValueError("Lead phone number is invalid")
    digits = phone.lstrip("+")
    if len(digits) == 10:
        digits = f"91{digits}"
    if not digits.isdigit() or not 10 <= len(digits) <= 15:
        raise ValueError("Lead phone number must contain 10 to 15 digits")
    return f"+{digits}"


def _response_data(response) -> dict:
    body = response.read().decode("utf-8", errors="replace").strip()
    if not body:
        return {}
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return {"raw_response": body[:500]}
    return data if isinstance(data, dict) else {"data": data}


class ConfiguredVoiceProvider:

    def __init__(self, config: dict):
        self.config = config
        self.name = str(config["provider"])

    def queue_call(self, target) -> str:
        return f"thinnestai-pending-{uuid.uuid4().hex}"

    def start_call(self, call: CRMVoiceCallAttempt, lead: CRMLead, language: str) -> str:
        endpoint = str(self.config.get("call_endpoint_url") or "").strip()
        if not endpoint.startswith("https://"):
            raise VoiceCallProviderError("Voice call endpoint must be a valid HTTPS URL")
        voice_id = {"bn": self.config["bengali_voice"], "hi": self.config["hindi_voice"], "en": self.config["english_voice"]}[language]
        payload = {
            "agent_id": self.config["caller_id"],
            "to_number": call.target_phone,
            "voice_id": voice_id,
            "model": self.config.get("model") or None,
            "dynamic_variables": {
                "lead_name": lead.contact_person or lead.business_name or "Customer",
                "platform_context": PLATFORM_CONTEXT,
                "registration_status": lead.status or "NEW",
                "registration_type": registration_type_for(call.registration_type),
                "preferred_language": language,
            },
        }
        headers = {"Content-Type": "application/json", "Accept": "application/json", "Idempotency-Key": call.idempotency_key}
        auth_type = self.config["auth_type"]
        auth_name = self.config["auth_header_name"]
        if auth_type == "bearer_token":
            headers[auth_name] = f"Bearer {self.config['api_key']}"
        elif auth_type == "custom_header":
            headers[auth_name] = self.config["api_key"]
        elif auth_type == "api_key_query_param":
            parsed = urlsplit(endpoint)
            endpoint = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode([*parse_qsl(parsed.query, keep_blank_values=True), (auth_name, self.config["api_key"])]), parsed.fragment))
        else:
            raise VoiceCallProviderError("Voice provider authentication type is invalid")
        request = Request(endpoint, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
        logger.info("Voice provider call request: provider=%s call_id=%s lead_id=%s phone=%s language=%s registration_status=%s", self.name, call.id, lead.id, call.target_phone[-4:].rjust(len(call.target_phone), "*"), language, lead.status)
        try:
            with urlopen(request, timeout=20) as response:
                response_data = _response_data(response)
                logger.info("Voice provider call response: provider=%s call_id=%s status=%s data=%s", self.name, call.id, getattr(response, "status", 200), _sanitize_result(response_data))
        except HTTPError as exc:
            data = _response_data(exc)
            logger.warning("Voice provider call HTTP error: provider=%s call_id=%s status=%s data=%s", self.name, call.id, exc.code, _sanitize_result(data))
            raise VoiceCallProviderError(f"{self.name} returned HTTP {exc.code}: {_sanitize_error(json.dumps(_sanitize_result(data)))}") from exc
        except (URLError, OSError, TimeoutError) as exc:
            logger.warning("Voice provider call network error: provider=%s call_id=%s error=%s", self.name, call.id, exc)
            raise VoiceCallProviderError(f"{self.name} network error: {_sanitize_error(str(exc))}") from exc
        provider_call_id = response_data.get("call_id") or response_data.get("id") or (response_data.get("data") or {}).get("call_id") or (response_data.get("data") or {}).get("id")
        return str(provider_call_id or call.provider_call_id)


@dataclass(frozen=True)
class VoiceCallTarget:
    target_type: str
    id: str
    phone: str
    lead_id: str | None = None
    language: str = ""
    language_status: str = "unknown"


def resolve_call_target(db, target_type: str, target_id: str) -> VoiceCallTarget:
    normalized_type = str(target_type or "").strip().upper()
    if normalized_type not in TARGET_TYPES:
        raise ValueError("Invalid call target type")
    if normalized_type == "LEAD":
        lead = db.query(CRMLead).filter(CRMLead.id == target_id).first()
        if not lead:
            raise ValueError("Lead not found")
        return VoiceCallTarget("LEAD", lead.id, str(lead.whatsapp_no or lead.phone or "").strip(), lead.id)
    if normalized_type == "PARTNER":
        partner = db.query(AssociatePartner).filter(AssociatePartner.id == target_id).first()
        if not partner:
            raise ValueError("Partner not found")
        return VoiceCallTarget("PARTNER", partner.id, str(partner.whatsapp_no or partner.phone or "").strip())
    role = "member" if normalized_type == "MEMBER" else "rider"
    user = db.query(User).filter(User.id == target_id, User.role == role).first()
    if not user:
        raise ValueError(f"{normalized_type.title()} not found")
    return VoiceCallTarget(normalized_type, user.id, str(user.phone or "").strip())


def voice_provider_for(db):
    config = resolve_voice_config(db)
    provider = str(config.get("provider") or "mock").lower()
    if not config.get("enabled") or provider == "mock":
        return MockVoiceProvider()
    required = ("api_key", "caller_id", "bengali_voice", "hindi_voice", "english_voice", "call_endpoint_url", "auth_type", "auth_header_name")
    missing = [key for key in required if not str(config.get(key) or "").strip()]
    if missing:
        raise ValueError(f"Voice provider configuration is incomplete: {', '.join(missing)}")
    return ConfiguredVoiceProvider(config)


def dispatch_voice_call(db, call: CRMVoiceCallAttempt, lead: CRMLead, provider) -> CRMVoiceCallAttempt:
    if not isinstance(provider, ConfiguredVoiceProvider):
        return call
    try:
        call.provider_call_id = provider.start_call(call, lead, call.language)
        call.status = "CALLING"
        call.error_code = ""
        call.error_message = ""
        db.commit()
    except VoiceCallProviderError as exc:
        call.status = "FAILED"
        call.error_code = "VOICE_PROVIDER_REQUEST_FAILED"
        call.error_message = _sanitize_error(str(exc))
        db.commit()
        raise
    db.refresh(call)
    return call


def _campaign_is_active(campaign: CRMVoiceCallCampaign, now: datetime) -> bool:
    return campaign.enabled and (not campaign.start_at or campaign.start_at <= now) and (not campaign.end_at or campaign.end_at >= now)


def create_voice_campaign(db, payload: dict) -> CRMVoiceCallCampaign:
    target_type = str((payload or {}).get("target_type") or "").strip().upper()
    call_purpose = str((payload or {}).get("call_purpose") or "").strip().upper()
    if target_type not in TARGET_TYPES:
        raise ValueError("Invalid campaign target type")
    if call_purpose not in CALL_PURPOSES:
        raise ValueError("Invalid call purpose")
    name = str((payload or {}).get("name") or "").strip()
    if not name:
        raise ValueError("Campaign name is required")
    languages = [language_for(language) for language in ((payload or {}).get("supported_languages") or ["bn", "hi"])]
    languages = [language for language in languages if language]
    if not languages:
        raise ValueError("At least one supported language is required")
    campaign = CRMVoiceCallCampaign(
        name=name,
        enabled=bool((payload or {}).get("enabled", False)),
        target_type=target_type,
        call_purpose=call_purpose,
        start_at=(payload or {}).get("start_at"),
        end_at=(payload or {}).get("end_at"),
        allowed_call_start=str((payload or {}).get("allowed_call_start") or "09:00"),
        allowed_call_end=str((payload or {}).get("allowed_call_end") or "18:00"),
        max_attempts=max(1, min(5, int((payload or {}).get("max_attempts") or 1))),
        retry_delay_minutes=max(1, min(10080, int((payload or {}).get("retry_delay_minutes") or 60))),
        supported_languages_json=json.dumps(languages),
    )
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return campaign


def queue_campaign_call(db, campaign: CRMVoiceCallCampaign, target: VoiceCallTarget, provider=None, preferred_language: str | None = None) -> tuple[CRMVoiceCallAttempt, bool]:
    if campaign.target_type != target.target_type:
        raise ValueError("Target type does not match campaign")
    if not _campaign_is_active(campaign, datetime.now(timezone.utc)):
        raise ValueError("Campaign is disabled or outside its active date range")
    existing = db.query(CRMVoiceCallAttempt).filter(CRMVoiceCallAttempt.campaign_id == campaign.id, CRMVoiceCallAttempt.target_id == target.id).order_by(CRMVoiceCallAttempt.created_at.desc()).all()
    if existing and (existing[0].status not in RETRYABLE_STATUSES or len(existing) >= campaign.max_attempts):
        return existing[0], False
    language = language_for(preferred_language) if preferred_language else target.language or "bn"
    if not language:
        raise ValueError("Preferred language must be Bengali, Hindi, or English")
    campaign_languages = json.loads(campaign.supported_languages_json or "[]")
    if campaign_languages and language not in campaign_languages:
        raise ValueError("Preferred language is not enabled for this campaign")
    provider = provider or MockVoiceProvider()
    attempt_number = len(existing) + 1
    call = CRMVoiceCallAttempt(lead_id=target.lead_id, target_type=target.target_type, target_id=target.id, target_phone=normalize_phone_number(target.phone), call_purpose=campaign.call_purpose, campaign_id=campaign.id, provider=provider.name, provider_call_id=provider.queue_call(target), idempotency_key=f"voice-campaign:{campaign.id}:{target.id}:{attempt_number}", status="CALL_PENDING", language=language)
    db.add(call)
    if target.lead_id:
        db.add(CRMLeadActivity(lead_id=target.lead_id, activity_type="voice_call_queued", message=f"AI voice campaign call queued ({campaign.name})"))
    db.commit()
    db.refresh(call)
    return call, True


def registration_type_for(value: str | None) -> str:
    normalized = str(value or "").strip().upper()
    return normalized if normalized in REGISTRATION_TYPES else "OTHER"


def language_for(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    aliases = {"bn": "bn", "bengali": "bn", "bangla": "bn", "বাংলা": "bn", "en": "en", "english": "en", "hi": "hi", "hindi": "hi", "हिंदी": "hi"}
    return aliases.get(normalized, "")


def conversation_start_prompt() -> str:
    return CONVERSATION_START_PROMPT


def qualification_questions_for(language: str | None) -> list[str]:
    return list(QUALIFICATION_QUESTIONS.get(language_for(language), []))


def registration_link_for(value: str | None) -> str | None:
    return REGISTRATION_LINKS[registration_type_for(value)]


def _sanitize_result(value):
    if isinstance(value, dict):
        return {
            str(key): _sanitize_result(item)
            for key, item in value.items()
            if not any(sensitive_key in str(key).lower() for sensitive_key in SENSITIVE_KEYS)
        }
    if isinstance(value, list):
        return [_sanitize_result(item) for item in value]
    return value


def _sanitize_error(value: str | None) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:500]


def _call_payload(call: CRMVoiceCallAttempt) -> dict:
    result = json.loads(call.qualification_result_json or "{}")
    return {
        "id": call.id,
        "lead_id": call.lead_id,
        "target_type": call.target_type,
        "target_id": call.target_id,
        "target_phone": call.target_phone,
        "call_purpose": call.call_purpose,
        "campaign_id": call.campaign_id,
        "provider": call.provider,
        "provider_call_id": call.provider_call_id,
        "status": call.status,
        "outcome": call.outcome,
        "registration_type": call.registration_type,
        "language": call.language or None,
        "conversation_start_prompt": conversation_start_prompt(),
        "qualification_questions": qualification_questions_for(call.language),
        "registration_link": registration_link_for(call.registration_type),
        "qualification_result": result if isinstance(result, dict) else {},
        "attempted_at": call.attempted_at.isoformat() if call.attempted_at else None,
        "connected_at": call.connected_at.isoformat() if call.connected_at else None,
        "completed_at": call.completed_at.isoformat() if call.completed_at else None,
        "duration_seconds": call.duration_seconds,
        "error_code": call.error_code,
        "error_message": call.error_message,
    }


def queue_voice_call(db, lead: CRMLead, provider=None, retry: bool = False, preferred_language: str | None = None) -> tuple[CRMVoiceCallAttempt, bool]:
    latest = db.query(CRMVoiceCallAttempt).filter(CRMVoiceCallAttempt.lead_id == lead.id).order_by(CRMVoiceCallAttempt.created_at.desc()).first()
    if latest and (not retry or latest.status not in RETRYABLE_STATUSES):
        return latest, False
    language = language_for(preferred_language) if preferred_language else "bn"
    if not language:
        raise ValueError("Preferred language must be Bengali, Hindi, or English")
    provider = provider or MockVoiceProvider()
    attempt_number = db.query(CRMVoiceCallAttempt).filter(CRMVoiceCallAttempt.lead_id == lead.id).count() + 1
    call = CRMVoiceCallAttempt(
        lead_id=lead.id,
        target_type="LEAD",
        target_id=lead.id,
        target_phone=normalize_phone_number(lead.whatsapp_no or lead.phone),
        provider=provider.name,
        provider_call_id=provider.queue_call(lead),
        idempotency_key=f"voice-call:{lead.id}:{attempt_number}",
        status="CALL_PENDING",
        registration_type="MEMBER" if lead.member_user_id else "PARTNER" if lead.partner_id else "OTHER",
        language=language,
    )
    db.add(call)
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="voice_call_queued", message=f"AI voice call queued ({call.provider})"))
    db.commit()
    db.refresh(call)
    return call, True


def trigger_lead_voice_call(db, lead: CRMLead, retry: bool = False, preferred_language: str | None = None) -> tuple[CRMVoiceCallAttempt, bool]:
    provider = voice_provider_for(db)
    call, created = queue_voice_call(db, lead, provider=provider, retry=retry, preferred_language=preferred_language)
    if created:
        dispatch_voice_call(db, call, lead, provider)
    return call, created


def receive_voice_call_result(db, provider_call_id: str, payload: dict) -> CRMVoiceCallAttempt:
    call = db.query(CRMVoiceCallAttempt).filter(CRMVoiceCallAttempt.provider_call_id == str(provider_call_id or "").strip()).first()
    if not call:
        raise ValueError("Voice call attempt not found")
    status = str((payload or {}).get("status") or "").strip().upper()
    if status not in CALL_STATUSES:
        raise ValueError("Invalid call status")
    registration_type = registration_type_for((payload or {}).get("registration_type"))
    qualification_result = _sanitize_result((payload or {}).get("qualification_result") or {})
    selected_language = language_for((payload or {}).get("language"))
    language_switches = [language_for(item) for item in ((payload or {}).get("language_switches") or [])]
    language_switches = [language for language in language_switches if language]
    now = datetime.now(timezone.utc)
    call.status = status
    call.outcome = _sanitize_error((payload or {}).get("outcome"))
    call.registration_type = registration_type
    if selected_language:
        call.language = selected_language
    if language_switches:
        qualification_result["language_switches"] = language_switches
    call.qualification_result_json = json.dumps(qualification_result, ensure_ascii=True)
    call.duration_seconds = max(0, int((payload or {}).get("duration_seconds") or 0)) or None
    call.error_code = _sanitize_error((payload or {}).get("error_code"))[:80]
    call.error_message = _sanitize_error((payload or {}).get("error_message"))
    if status == "CONNECTED":
        call.connected_at = now
    if status in {"QUALIFIED", "NOT_QUALIFIED", "CALLBACK_REQUESTED", "NO_ANSWER", "FAILED", "CONFIRMED"}:
        call.completed_at = now
    lead = db.query(CRMLead).filter(CRMLead.id == call.lead_id).first()
    if lead:
        if status == "CONNECTED" and lead.status == "NEW":
            lead.status = "CONTACTED"
        elif status == "QUALIFIED":
            lead.status = "QUALIFIED"
        elif status == "CONFIRMED":
            lead.status = "APPLICATION"
        elif status == "NOT_QUALIFIED":
            lead.status = "LOST"
        db.add(CRMLeadActivity(lead_id=lead.id, activity_type="voice_call_result", message=f"AI voice call {status}: {call.outcome or registration_type}"))
    db.commit()
    db.refresh(call)
    return call