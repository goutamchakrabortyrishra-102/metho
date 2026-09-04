import base64
import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from cryptography.fernet import Fernet, InvalidToken

from .models import AppSetting, CRMFollowUp, CRMLead, CRMLeadActivity, CRMTask, User

WHATSAPP_GRAPH_API_VERSION = os.getenv("WHATSAPP_GRAPH_API_VERSION", "v20.0").strip() or "v20.0"
DEFAULT_FALLBACK_ENCRYPTION_KEY = "default-fallback-32-char-key-here"
DEFAULT_WHATSAPP_REGISTRATION_URL = "https://methoaayupay.com/app/register"
DEFAULT_WHATSAPP_WELCOME_MESSAGE = "নমস্কার! মেঠো আয়-উপায় (METHO AAY-UPAY)-এ আপনাকে স্বাগতম!"
DEFAULT_WHATSAPP_REGISTRATION_HELP_PROMPT = "রেজিস্ট্রেশনে কোনো সাহায্য লাগলে এই চ্যাটেই রিপ্লাই করুন, আমরা আপনাকে সহায়তা করব।"
DEFAULT_REGISTRATION_ROLE_QUESTION = "আপনি কীভাবে যুক্ত হতে চান? 1 লিখুন Member-এর জন্য, 2 লিখুন Partner-এর জন্য, অথবা 3 লিখুন Rider-এর জন্য।"
DEFAULT_MEMBER_REGISTRATION_URL = "https://methoaayupay.com/app/register"
DEFAULT_PARTNER_REGISTRATION_URL = "https://methoaayupay.com/partner-register"
DEFAULT_RIDER_REGISTRATION_URL = "https://methoaayupay.com/rider-register"
REGISTRATION_ROLE_SETTINGS = ("member", "partner", "rider")
DEFAULT_AUTO_REPLY = """আমরা কারা?
মেঠো হলো একটি আধুনিক প্ল্যাটফর্ম, যেখানে কেনাকাটা, ব্যবসা বা সার্ভিসের মাধ্যমে আয় করার সুযোগ রয়েছে।

এখানে কীভাবে আয় করবেন?
কেনাকাটা করে রিওয়ার্ড ও ক্যাশব্যাক পান, রেফারেলের মাধ্যমে কমিশন ও বোনাসের সুযোগ পান, এবং দোকান বা সার্ভিস যুক্ত করে কাস্টমার বৃদ্ধি করুন।

সম্পূর্ণ ফ্রি রেজিস্ট্রেশন এবং অনলাইন ও অফলাইন ফ্রি ট্রেনিং সাপোর্ট দেওয়া হয়।"""
DEFAULT_ROLE_REGISTRATION_REPLIES = {
    "member": """মেঠো মেম্বার (Member) হিসেবে আয় শুরু করুন!
কেনাকাটায় রিওয়ার্ড কমিশন, টিম ম্যাচিং বোনাস এবং লিডারশিপ বোনাসের সুযোগ পেতে এখনই আপনার আইডি চালু করুন।

পরবর্তী ধাপ: রেজিস্ট্রেশন সম্পন্ন করার পরে ফ্রি ট্রেনিংয়ের জন্য আমাদের টিম আপনাকে গাইড করবে।""",
    "partner": """মেঠো বিজনেস পার্টনার (Partner) হয়ে দোকান বা সার্ভিস বাড়ান!
ছোট দোকানদার, খুচরা বিক্রেতা বা সার্ভিস প্রোভাইডার হিসেবে মেঠো পার্টনার হয়ে আপনার এলাকায় কাস্টমার বাড়ান।

কোনো ইনভেস্টমেন্ট ছাড়াই রেজিস্ট্রেশন করুন। দোকান যুক্ত করার অনলাইন ও অফলাইন ট্রেনিং ফ্রিতে দেওয়া হবে।""",
    "rider": """মেঠো রাইডার (Rider) হয়ে প্রতিদিন আয় করুন!
আপনার বাইক, স্কুটার, টোটো বা ডেলিভারি সার্ভিস দিয়ে মেঠো প্ল্যাটফর্মে কাজের সুযোগ পান।

রেজিস্ট্রেশন শেষে আমাদের প্রতিনিধি ভেরিফিকেশন ও ট্র্যাকিং সুবিধা বুঝিয়ে দেবেন।""",
}
DEFAULT_REGISTRATION_ROLE_KEYWORDS = {
    "member": "1,member,মেম্বার,কেনাকাটা,ইনকাম",
    "partner": "2,partner,পার্টনার,দোকান,ব্যবসা",
    "rider": "3,rider,রাইডার,ডেলিভারি,গাড়ি",
}


def _setting(name: str) -> str:
    return str(os.getenv(name, "") or "").strip()


def _derived_fernet_key(value: str) -> str:
    text = (value or DEFAULT_FALLBACK_ENCRYPTION_KEY).strip()
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest).decode("utf-8")


def _encryption_key() -> bytes:
    raw_key = (
        _setting("WHATSAPP_SETTINGS_ENCRYPTION_KEY")
        or _setting("META_SETTINGS_ENCRYPTION_KEY")
        or DEFAULT_FALLBACK_ENCRYPTION_KEY
    ).strip()
    if not raw_key:
        raw_key = DEFAULT_FALLBACK_ENCRYPTION_KEY
    try:
        decoded = base64.urlsafe_b64decode(raw_key + "=" * ((4 - len(raw_key) % 4) % 4))
        if len(decoded) == 32:
            return raw_key.encode("utf-8")
    except Exception:
        pass
    return _derived_fernet_key(raw_key).encode("utf-8")


def encrypt_secret(value: str) -> str:
    return Fernet(_encryption_key()).encrypt(str(value).encode("utf-8")).decode("utf-8")


def decrypt_secret(value: str) -> str:
    try:
        return Fernet(_encryption_key()).decrypt(str(value).encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError, TypeError) as exc:
        raise RuntimeError("Stored WhatsApp secret could not be decrypted") from exc


def load_db_config(db) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == "whatsapp_cloud_integration").first()
    if not row:
        return {}
    try:
        payload = json.loads(row.value_json or "{}")
    except json.JSONDecodeError:
        return {}
    if not isinstance(payload, dict):
        return {}
    result = {key: str(payload.get(key) or "").strip() for key in (
        "enabled",
        "phone_number_id",
        "business_account_id",
        "graph_api_version",
        "default_assignee_id",
        "default_auto_reply",
        "customer_auto_reply",
        "member_auto_reply",
        "partner_auto_reply",
        "invoice_template",
        "order_template",
        "registration_welcome_message",
        "registration_url",
        "registration_help_prompt",
        "registration_role_question",
        *[f"{role}_registration_url" for role in REGISTRATION_ROLE_SETTINGS],
        *[f"{role}_registration_reply" for role in REGISTRATION_ROLE_SETTINGS],
        *[f"{role}_registration_keywords" for role in REGISTRATION_ROLE_SETTINGS],
    ) if key in payload}
    for key in ("webhook_verify_token", "app_secret", "access_token"):
        if payload.get(key):
            result[key] = decrypt_secret(payload[key]).strip()
    return result


def resolve_config(db=None) -> dict:
    db_config = load_db_config(db) if db is not None else {}
    return {
        "enabled": str(db_config.get("enabled", True)).strip().lower() not in {"false", "0", "no", "off"},
        "phone_number_id": str(db_config.get("phone_number_id") or _setting("WHATSAPP_PHONE_NUMBER_ID")),
        "business_account_id": str(db_config.get("business_account_id") or _setting("WHATSAPP_BUSINESS_ACCOUNT_ID")),
        "graph_api_version": str(db_config.get("graph_api_version") or WHATSAPP_GRAPH_API_VERSION),
        "default_assignee_id": str(db_config.get("default_assignee_id") or _setting("WHATSAPP_CRM_DEFAULT_ASSIGNEE_ID")),
        "default_auto_reply": str(db_config.get("default_auto_reply") or DEFAULT_AUTO_REPLY).strip(),
        "customer_auto_reply": str(db_config.get("customer_auto_reply") or "").strip(),
        "member_auto_reply": str(db_config.get("member_auto_reply") or "").strip(),
        "partner_auto_reply": str(db_config.get("partner_auto_reply") or "").strip(),
        "invoice_template": str(db_config.get("invoice_template") or "").strip(),
        "order_template": str(db_config.get("order_template") or "").strip(),
        "registration_welcome_message": str(db_config.get("registration_welcome_message") or DEFAULT_WHATSAPP_WELCOME_MESSAGE).strip(),
        "registration_url": str(db_config.get("registration_url") or DEFAULT_WHATSAPP_REGISTRATION_URL).strip(),
        "registration_help_prompt": str(db_config.get("registration_help_prompt") or DEFAULT_WHATSAPP_REGISTRATION_HELP_PROMPT).strip(),
        "registration_role_question": str(db_config.get("registration_role_question") or DEFAULT_REGISTRATION_ROLE_QUESTION).strip(),
        "member_registration_url": str(db_config.get("member_registration_url") or DEFAULT_MEMBER_REGISTRATION_URL).strip(),
        "partner_registration_url": str(db_config.get("partner_registration_url") or DEFAULT_PARTNER_REGISTRATION_URL).strip(),
        "rider_registration_url": str(db_config.get("rider_registration_url") or DEFAULT_RIDER_REGISTRATION_URL).strip(),
        **{f"{role}_registration_reply": str(db_config.get(f"{role}_registration_reply") or DEFAULT_ROLE_REGISTRATION_REPLIES[role]).strip() for role in REGISTRATION_ROLE_SETTINGS},
        **{f"{role}_registration_keywords": str(db_config.get(f"{role}_registration_keywords") or DEFAULT_REGISTRATION_ROLE_KEYWORDS[role]).strip() for role in REGISTRATION_ROLE_SETTINGS},
        "webhook_verify_token": str(db_config.get("webhook_verify_token") or _setting("WHATSAPP_WEBHOOK_VERIFY_TOKEN")),
        "app_secret": str(db_config.get("app_secret") or _setting("WHATSAPP_APP_SECRET")),
        "access_token": str(db_config.get("access_token") or _setting("WHATSAPP_ACCESS_TOKEN")),
    }


def get_configured_whatsapp_reply(db, role: str | None = None, fallback: str = "") -> str:
    config = resolve_config(db)
    key_map = {
        "customer": "customer_auto_reply",
        "member": "member_auto_reply",
        "partner": "partner_auto_reply",
        "default": "default_auto_reply",
    }
    chosen = key_map.get((role or "default").lower(), "default_auto_reply")
    value = config.get(chosen) or config.get("default_auto_reply") or fallback
    return str(value or "").strip()


def verify_webhook_token(token: str, challenge: str, db=None) -> str | None:
    expected = resolve_config(db).get("webhook_verify_token")
    if not expected or not hmac.compare_digest(str(token or ""), expected):
        return None
    return str(challenge or "")


def verify_signature(body: bytes, signature: str | None, db=None) -> bool:
    secret = resolve_config(db).get("app_secret")
    supplied = str(signature or "").strip()
    if not secret or not supplied.startswith("sha256="):
        return False
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(supplied[7:], digest)


def _admin_assignee(db) -> User | None:
    configured = resolve_config(db).get("default_assignee_id")
    query = db.query(User).filter(User.role.in_(["super_admin", "company_admin", "admin"]), User.is_active.is_(True))
    if configured:
        return query.filter(User.id == configured).first()
    return query.order_by(User.created_at.asc()).first()


def test_whatsapp_config(db=None) -> dict:
    from urllib.error import HTTPError

    config = resolve_config(db)
    token = config.get("access_token")
    phone_number_id = config.get("phone_number_id")
    if not token:
        raise RuntimeError("access_token not configured")
    if not phone_number_id:
        raise RuntimeError("phone_number_id not configured")

    query = urlencode({"fields": "id,display_phone_number,verified_name", "access_token": token})
    endpoint = f"https://graph.facebook.com/{config['graph_api_version']}/{phone_number_id}?{query}"
    request = Request(endpoint, headers={"Accept": "application/json", "User-Agent": "metho-crm-whatsapp-config-test/1.0"})
    try:
        with urlopen(request, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        try:
            error_response = json.loads(exc.read().decode("utf-8"))
            error_detail = error_response.get("error", {})
            error_msg = error_detail.get("message", str(exc)) if isinstance(error_detail, dict) else str(error_detail)
        except Exception:
            error_msg = str(exc)
        raise RuntimeError(f"WhatsApp API error: {error_msg}") from exc
    except Exception as exc:
        raise RuntimeError(f"WhatsApp API request failed: {str(exc)}") from exc

    if not isinstance(payload, dict) or not payload.get("id"):
        raise RuntimeError("WhatsApp API returned an invalid response")

    return {
        "ok": True,
        "phone_number_id": str(payload.get("id", "")),
        "display_phone_number": str(payload.get("display_phone_number", "")),
        "verified_name": str(payload.get("verified_name", "")),
        "graph_api_version": config["graph_api_version"],
    }


def send_whatsapp_message(
    db,
    recipient: str,
    text: str | None = None,
    template_name: str | None = None,
    template_language_code: str | None = None,
    template_parameters: list[str] | None = None,
) -> dict:
    """Send one text or approved template message through WhatsApp Cloud API."""
    config = resolve_config(db)
    token = config.get("access_token")
    phone_number_id = config.get("phone_number_id")
    if not token:
        raise RuntimeError("access_token not configured")
    if not phone_number_id:
        raise RuntimeError("phone_number_id not configured")

    to = str(recipient or "").strip()
    if not to:
        raise ValueError("recipient is required")
    has_text = bool(str(text or "").strip())
    has_template = bool(str(template_name or "").strip())
    if has_text == has_template:
        raise ValueError("provide exactly one of text or template_name")

    if has_text:
        message = {"messaging_product": "whatsapp", "to": to, "type": "text", "text": {"body": str(text).strip()}}
    else:
        language_code = str(template_language_code or "").strip()
        if not language_code:
            raise ValueError("template_language_code is required for template messages")
        components = []
        if template_parameters:
            components.append({"type": "body", "parameters": [{"type": "text", "text": str(value)} for value in template_parameters]})
        message = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "template",
            "template": {"name": str(template_name).strip(), "language": {"code": language_code}, **({"components": components} if components else {})},
        }

    endpoint = f"https://graph.facebook.com/{config['graph_api_version']}/{phone_number_id}/messages"
    request = Request(
        endpoint,
        data=json.dumps(message).encode("utf-8"),
        headers={"Accept": "application/json", "Content-Type": "application/json", "Authorization": f"Bearer {token}", "User-Agent": "metho-crm-whatsapp-send/1.0"},
        method="POST",
    )
    from urllib.error import HTTPError

    try:
        with urlopen(request, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        try:
            error_response = json.loads(exc.read().decode("utf-8"))
            error_detail = error_response.get("error", {})
            error_msg = error_detail.get("message", str(exc)) if isinstance(error_detail, dict) else str(error_detail)
        except Exception:
            error_msg = str(exc)
        raise RuntimeError(f"WhatsApp API error: {error_msg}") from exc
    except Exception as exc:
        raise RuntimeError(f"WhatsApp API request failed: {str(exc)}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("WhatsApp API returned an invalid response")
    return payload


def _normalized_whatsapp_messages(payload: dict) -> list[dict]:
    if not isinstance(payload, dict):
        raise ValueError("WhatsApp payload must be an object")
    records = []
    for entry in payload.get("entry") or []:
        if not isinstance(entry, dict):
            continue
        for change in (entry or {}).get("changes") or []:
            value = (change or {}).get("value") or {}
            if not isinstance(value, dict):
                continue
            for message in value.get("messages") or []:
                if isinstance(message, dict):
                    records.append({**value, "message": message, "business_account_id": str((entry or {}).get("id") or value.get("metadata", {}).get("phone_number_id") or "").strip()})
    normalized = []
    for value in records:
        message = value.get("message") or {}
        contact = (value.get("contacts") or [{}])[0] if (value.get("contacts") or []) else {}
        profile = contact.get("profile") or {}
        wa_id = str(message.get("from") or contact.get("wa_id") or "").strip()
        if not wa_id:
            raise ValueError("WhatsApp sender id is required")
        msg_id = str(message.get("id") or "").strip()
        if not msg_id:
            raise ValueError("WhatsApp message id is required")
        name = str(profile.get("name") or "WhatsApp Lead").strip() or "WhatsApp Lead"
        msg_type = str(message.get("type") or "text").strip() or "text"
        body = ""
        if msg_type == "text":
            body = str((message.get("text") or {}).get("body") or "").strip()
        elif msg_type == "interactive":
            body = str((message.get("interactive") or {}).get("button_reply", {}).get("title") or (message.get("interactive") or {}).get("list_reply", {}).get("title") or "").strip()
        elif msg_type == "button":
            body = str((message.get("button") or {}).get("text") or "").strip()
        elif msg_type == "image":
            body = str((message.get("image") or {}).get("caption") or "").strip()
        metadata = {
            "source": "whatsapp",
            "message_id": msg_id,
            "wa_id": wa_id,
            "phone_number_id": str((value.get("metadata") or {}).get("phone_number_id") or "").strip(),
            "display_phone_number": str((value.get("metadata") or {}).get("display_phone_number") or "").strip(),
            "business_account_id": str(value.get("business_account_id") or "").strip(),
            "message_type": msg_type,
            "timestamp": str(message.get("timestamp") or "").strip(),
            "raw_body": body,
        }
        normalized.append({
            "external_lead_id": msg_id,
            "lead_id": f"WA-{wa_id}",
            "business_name": f"WhatsApp-{name}",
            "contact_person": name,
            "phone": wa_id,
            "whatsapp_no": wa_id,
            "email": "",
            "city": "",
            "state": "",
            "pincode": "",
            "address": "",
            "source": "whatsapp",
            "tags": ["whatsapp_cloud", f"message_type:{msg_type}"],
            "metadata": metadata,
        })
    if not normalized:
        raise ValueError("WhatsApp message payload is empty")
    return normalized


def normalize_whatsapp_message(payload: dict) -> dict:
    return _normalized_whatsapp_messages(payload)[0]


def _registration_reply(db, reply_text: str) -> str:
    config = resolve_config(db)
    text = str(reply_text or "").strip()
    cta = "\n\n".join((
        config["registration_welcome_message"],
        f"রেজিস্ট্রেশন করুন: {config['registration_url']}",
        config["registration_help_prompt"],
    ))
    return f"{text}\n\n{cta}" if text else cta


def _role_registration_reply(db, role: str) -> str:
    config = resolve_config(db)
    reply = config.get(f"{role}_registration_reply") or config["registration_welcome_message"]
    return "\n\n".join((
        reply,
        f"{role.title()} রেজিস্ট্রেশন করুন: {config[f'{role}_registration_url']}",
        config["registration_help_prompt"],
    ))


def _registration_role_for_text(config: dict, text: str) -> str | None:
    lowered = str(text or "").lower()
    for role in REGISTRATION_ROLE_SETTINGS:
        keywords = (keyword.strip().lower() for keyword in str(config.get(f"{role}_registration_keywords") or "").split(","))
        if any(keyword and keyword in lowered for keyword in keywords):
            return role
    return None


def _send_auto_reply_if_configured(db, recipient: str, text: str) -> None:
    config = resolve_config(db)
    if not config["enabled"] or not config["access_token"] or not config["phone_number_id"]:
        return
    send_whatsapp_message(db, recipient, text=text)


def ingest_whatsapp_message(db, payload: dict, request=None) -> str:
    statuses = []
    for normalized in _normalized_whatsapp_messages(payload):
        message_id = normalized["external_lead_id"]
        activity_prefix = f"WhatsApp message received [{message_id}]"
        if db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type == "whatsapp_message_received", CRMLeadActivity.message.like(f"{activity_prefix}:%")).first():
            statuses.append("duplicate")
            continue

        # Icebreaker response matching
        incoming_text = str(
            normalized.get("metadata", {}).get("raw_body") or ""
        ).strip()

        reply_text = ""
        config = resolve_config(db)
        role_hint = _registration_role_for_text(config, incoming_text)
        lowered = incoming_text.lower()
        if not role_hint and any(word in lowered for word in ("customer", "product", "order", "price")):
            role_hint = "customer"

        if (
            "What is METHO AAY-UPAY?" in incoming_text
            or "মেঠো আয়-উপায় কী?" in incoming_text
        ):
            reply_text = (
                "METHO AAY-UPAY is a smart e-commerce platform by "
                "Metho Logistics Pvt. Ltd. Browse quality daily essentials, "
                "kitchenware, & direct farm produce easily!\n\n"
                "মেঠো আয়-উপায় হলো মেঠো লজিস্টিকস প্রাইভেট লিমিটেডের একটি "
                "ডিজিটাল প্ল্যাটফর্ম। এখান থেকে সহজেই দৈনন্দিন প্রয়োজনীয় "
                "সামগ্রী, কিচেন অ্যাপ্লায়েন্স ও সেরা দেশি পণ্য অর্ডার করতে পারবেন।"
            )

        elif (
            "How to buy products or join as a Partner?" in incoming_text
            or "কীভাবে কেনাকাটা বা পার্টনার হিসেবে যুক্ত হব?" in incoming_text
        ):
            reply_text = (
                "Looking to shop or grow your business with us? Visit our "
                "portal to place orders or register as an authorized partner/vendor.\n\n"
                "পণ্য কিনতে চান নাকি আমাদের সাথে বিজনেসে যুক্ত হতে চান? "
                "অর্ডার করতে বা অথরাইজড বিজনেস পার্টনার/ভেন্ডর হিসেবে "
                "রেজিস্টার করতে আমাদের পোর্টালে ভিজিট করুন।"
            )

        elif (
            "How to contact Customer Support?" in incoming_text
            or "কাস্টমার কেয়ারের সাথে কীভাবে যোগাযোগ করব?" in incoming_text
        ):
            reply_text = (
                "We are here to help! For product details or business support, "
                "call or WhatsApp us at +91 91635 30078.\n\n"
                "আমরা আপনাকে সাহায্য করতে প্রস্তুত! পণ্য অর্ডার বা বিজনেসের "
                "যেকোনো সহায়তার জন্য কল বা মেসেজ করুন: +91 91635 30078।"
            )

        if reply_text:
            _send_auto_reply_if_configured(
                db,
                normalized["phone"],
                text=_registration_reply(db, reply_text),
            )
        elif role_hint:
            if role_hint in REGISTRATION_ROLE_SETTINGS:
                _send_auto_reply_if_configured(db, normalized["phone"], text=_role_registration_reply(db, role_hint))
            else:
                configured_reply = get_configured_whatsapp_reply(db, role_hint)
                _send_auto_reply_if_configured(db, normalized["phone"], text=_registration_reply(db, configured_reply))
        else:
            configured_default = get_configured_whatsapp_reply(db, "default")
            _send_auto_reply_if_configured(db, normalized["phone"], text=configured_default)

        lead = db.query(CRMLead).filter(CRMLead.lead_id == normalized["lead_id"]).first()
        if not lead:
            lead = db.query(CRMLead).filter(CRMLead.whatsapp_no == normalized["whatsapp_no"]).first()
        if not lead:
            lead = CRMLead(
                lead_id=normalized["lead_id"],
                business_name=normalized["business_name"],
                business_type="WhatsApp Lead",
                contact_person=normalized["contact_person"],
                phone=normalized["phone"],
                whatsapp_no=normalized["whatsapp_no"],
                email=normalized["email"],
                address=normalized["address"],
                city=normalized["city"],
                state=normalized["state"],
                pincode=normalized["pincode"],
                source=normalized["source"],
                tags_json=json.dumps(normalized["tags"]),
                notes=json.dumps(normalized["metadata"], sort_keys=True),
                status="NEW",
                priority_bucket="Warm",
            )
            assignee = _admin_assignee(db)
            if assignee:
                lead.assigned_user_id = assignee.id
            db.add(lead)
            db.flush()
            db.add(CRMFollowUp(lead_id=lead.id, scheduled_at=datetime.now(timezone.utc) + timedelta(days=1), status="Pending", notes="Initial follow-up for WhatsApp Cloud lead"))
            if assignee:
                db.add(CRMTask(title="Initial WhatsApp lead follow-up", description="Contact WhatsApp lead and qualify the inbound enquiry", due_at=datetime.now(timezone.utc) + timedelta(days=1), status="Pending", priority="High", lead_id=lead.id, assigned_user_id=assignee.id, created_by_user_id=assignee.id))
            status = "created"
        else:
            status = "updated"
        body = normalized["metadata"].get("raw_body") or ""
        db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_received", message=f"{activity_prefix}: {body}"))
        statuses.append(status)
    db.commit()
    if "created" in statuses:
        return "created"
    if "updated" in statuses:
        return "updated"
    return "duplicate"
