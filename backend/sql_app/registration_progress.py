"""Read-only view of how far a WhatsApp lead got in the registration flow, derived from existing rows
(`whatsapp_registration_sessions`, `crm_leads`) and the in-chat form definition in `whatsapp_cloud`."""
from dataclasses import dataclass

from .whatsapp_cloud import (
    WHATSAPP_INTRODUCTION,
    WHATSAPP_LEGACY_NATIVE_REGISTRATION_STATES,
    WHATSAPP_MEMBER_ACTIVATION_PENDING,
    WHATSAPP_MEMBER_ACTIVE,
    WHATSAPP_MEMBER_ONBOARDING,
    WHATSAPP_MEMBER_REGISTERED,
    WHATSAPP_NATIVE_REG_CONFIRM,
    WHATSAPP_NATIVE_REG_CONSENT,
    WHATSAPP_NATIVE_REG_ROLE_STATES,
    WHATSAPP_PARTNER_APPLICATION_PENDING,
    WHATSAPP_PARTNER_APPROVED,
    WHATSAPP_PARTNER_ONBOARDING,
    WHATSAPP_REGISTRATION_COMPLETED,
    WHATSAPP_RIDER_APPLICATION_PENDING,
    WHATSAPP_RIDER_APPROVED,
    WHATSAPP_RIDER_ONBOARDING,
    WHATSAPP_ROLE_REGISTRATION_PENDING,
    WHATSAPP_ROLE_SELECTION,
    _native_fields,
    _native_load,
    _native_next_field,
)

COMPLETED_STATES = {
    WHATSAPP_MEMBER_REGISTERED, WHATSAPP_MEMBER_ACTIVATION_PENDING, WHATSAPP_MEMBER_ACTIVE, WHATSAPP_MEMBER_ONBOARDING,
    WHATSAPP_PARTNER_APPLICATION_PENDING, WHATSAPP_PARTNER_APPROVED, WHATSAPP_PARTNER_ONBOARDING,
    WHATSAPP_RIDER_APPLICATION_PENDING, WHATSAPP_RIDER_APPROVED, WHATSAPP_RIDER_ONBOARDING,
    WHATSAPP_REGISTRATION_COMPLETED,
}
NATIVE_ROLE_STATES = set(WHATSAPP_NATIVE_REG_ROLE_STATES.values())
STEP_WELCOME = "welcome"
STEP_ROLE_LINK = "role_link_sent"
STEP_CONSENT = "consent"
STEP_CONFIRM = "confirm"

# Every in-chat question has a Bangla label in `_native_fields`; English/Hindi are used when the customer writes in them.
STEP_LABELS = {
    "en": {
        "name": "your name", "dob": "your date of birth", "pan_no": "your PAN", "address": "your address", "sponsor_code": "the Sponsor ID",
        "business_type": "the business type", "shop_sector": "the shop sector", "service_sector": "the service sector", "shop_category": "the shop category",
        "service_category": "the service category", "business_name": "the business name", "business_description": "the business description",
        "contact_person": "the owner/manager name", "aadhaar_no": "your Aadhaar", "email": "your Email/Login ID", "state": "your state", "district": "your district",
        "city": "your city", "pincode": "your pincode", "upi_id": "your UPI ID", "commission_percent_ask": "the commission request", "vehicle_type": "your vehicle category",
        "vehicle_number": "your vehicle number", "emergency_contact_name": "the emergency contact name", "emergency_contact_phone": "the emergency contact phone",
        "bank_account_holder": "the account holder name", "bank_name": "the bank name", "bank_account_number": "the account number", "bank_ifsc": "the IFSC code",
        STEP_CONFIRM: "the final review", STEP_CONSENT: "the start",
    },
    "hi": {
        "name": "आपका नाम", "dob": "जन्म तिथि", "pan_no": "PAN", "address": "पता", "sponsor_code": "Sponsor ID",
        "business_type": "व्यवसाय का प्रकार", "shop_sector": "दुकान का सेक्टर", "service_sector": "सेवा का सेक्टर", "shop_category": "दुकान की श्रेणी",
        "service_category": "सेवा की श्रेणी", "business_name": "व्यवसाय का नाम", "business_description": "व्यवसाय का विवरण",
        "contact_person": "मालिक/मैनेजर का नाम", "aadhaar_no": "Aadhaar", "email": "Email/Login ID", "state": "राज्य", "district": "ज़िला",
        "city": "शहर", "pincode": "पिनकोड", "upi_id": "UPI ID", "commission_percent_ask": "कमीशन अनुरोध", "vehicle_type": "वाहन श्रेणी",
        "vehicle_number": "वाहन नंबर", "emergency_contact_name": "इमरजेंसी संपर्क का नाम", "emergency_contact_phone": "इमरजेंसी संपर्क का फ़ोन",
        "bank_account_holder": "खाताधारक का नाम", "bank_name": "बैंक का नाम", "bank_account_number": "खाता नंबर", "bank_ifsc": "IFSC",
        STEP_CONFIRM: "अंतिम जाँच", STEP_CONSENT: "शुरुआत",
    },
    "bn": {STEP_CONFIRM: "চূড়ান্ত যাচাই", STEP_CONSENT: "শুরু"},
}
SPECIAL_STEP_LABELS_BN = {STEP_WELCOME: "Welcome", STEP_ROLE_LINK: "ওয়েব ফর্মের লিংক পাঠানো হয়েছে", STEP_CONSENT: "শুরু", STEP_CONFIRM: "চূড়ান্ত যাচাই"}


@dataclass
class RegistrationProgress:
    phase: str  # no_session | welcome | role_selected | registering | completed
    role: str
    step_key: str
    step_label: str
    completed_keys: tuple = ()
    completed_in_chat: bool = False

    @property
    def in_progress(self) -> bool:
        return self.phase in {"role_selected", "registering"}


def step_label(role: str, key: str, language: str = "bn") -> str:
    """Label of a step; Bangla comes from the form definition, English/Hindi from STEP_LABELS."""
    if language in {"en", "hi"} and key in STEP_LABELS[language]:
        return STEP_LABELS[language][key]
    if key in SPECIAL_STEP_LABELS_BN:
        return SPECIAL_STEP_LABELS_BN[key]
    for field in _native_fields(role) if role in WHATSAPP_NATIVE_REG_ROLE_STATES else []:
        if field["key"] == key:
            return field["label"]
    return key


def completed_keys(session) -> tuple:
    """Answered question keys saved in the session, in the order they were answered (gate flags excluded)."""
    _data, answers, meta = _native_load(session)
    return tuple(key for key in meta.get("history", []) if key in answers and not key.startswith("_"))


def registration_progress(lead, session) -> RegistrationProgress:
    role = ""
    for name, value in (("member", lead.member_user_id), ("partner", lead.partner_request_id), ("rider", lead.rider_user_id)):
        if value:
            role = name
            break
    state = str(getattr(session, "state", "") or "")
    session_role = str(getattr(session, "role", "") or "")
    in_chat = bool(session and (session.completed_at or state in COMPLETED_STATES))
    if role or in_chat:
        return RegistrationProgress("completed", role or session_role, "", "", completed_in_chat=in_chat)
    if session is None or state in {"", "IDLE"}:
        return RegistrationProgress("no_session", "", "", "")
    if state in {WHATSAPP_INTRODUCTION, WHATSAPP_ROLE_SELECTION}:
        return RegistrationProgress("welcome", "", STEP_WELCOME, step_label("", STEP_WELCOME))
    if state == WHATSAPP_ROLE_REGISTRATION_PENDING:
        return RegistrationProgress("role_selected", session_role, STEP_ROLE_LINK, step_label("", STEP_ROLE_LINK))
    if state == WHATSAPP_NATIVE_REG_CONSENT:
        return RegistrationProgress("role_selected", session_role, STEP_CONSENT, step_label("", STEP_CONSENT))
    if state == WHATSAPP_NATIVE_REG_CONFIRM:
        return RegistrationProgress("registering", session_role, STEP_CONFIRM, step_label(session_role, STEP_CONFIRM), completed_keys(session))
    if state in NATIVE_ROLE_STATES and session_role in WHATSAPP_NATIVE_REG_ROLE_STATES:
        _data, answers, _meta = _native_load(session)
        field = _native_next_field(session_role, answers)
        key = field["key"] if field else STEP_CONFIRM
        return RegistrationProgress("registering", session_role, key, step_label(session_role, key), completed_keys(session))
    if state in WHATSAPP_LEGACY_NATIVE_REGISTRATION_STATES:
        return RegistrationProgress("registering", session_role, state, state)
    return RegistrationProgress("no_session", session_role, "", "")
