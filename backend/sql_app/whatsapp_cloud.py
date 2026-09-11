import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

from cryptography.fernet import Fernet, InvalidToken

from .crm_identity import enrich_lead_from_contact, ensure_pending_followup, find_lead_by_phone
from .crm_automation import record_lifecycle_event
from .models import AppSetting, CRMFollowUp, CRMLead, CRMLeadActivity, CRMTask, PartnerRequest, PublicOrder, User, WhatsAppMessageOutbox, WhatsAppRegistrationSession
from .schemas import RegisterRequest, RiderRegisterRequest

logger = logging.getLogger(__name__)

WHATSAPP_GRAPH_API_VERSION = os.getenv("WHATSAPP_GRAPH_API_VERSION", "v20.0").strip() or "v20.0"
DEFAULT_FALLBACK_ENCRYPTION_KEY = "default-fallback-32-char-key-here"
DEFAULT_WHATSAPP_REGISTRATION_URL = "https://methoaayupay.com/register"
DEFAULT_WHATSAPP_WELCOME_MESSAGE = "নমস্কার! মেঠো আয়-উপায় (METHO AAY-UPAY)-এ আপনাকে স্বাগতম!"
DEFAULT_WHATSAPP_REGISTRATION_HELP_PROMPT = "রেজিস্ট্রেশনে কোনো সাহায্য লাগলে এই চ্যাটেই রিপ্লাই করুন, আমরা আপনাকে সহায়তা করব।"
DEFAULT_REGISTRATION_ROLE_QUESTION = "আপনি কীভাবে যুক্ত হতে চান? 1 লিখুন Member-এর জন্য, 2 লিখুন Partner-এর জন্য, অথবা 3 লিখুন Rider-এর জন্য।"
DEFAULT_MEMBER_REGISTRATION_URL = "https://methoaayupay.com/register"
DEFAULT_PARTNER_REGISTRATION_URL = "https://methoaayupay.com/partner-register"
DEFAULT_RIDER_REGISTRATION_URL = "https://methoaayupay.com/rider-register"
DEFAULT_MEMBER_ACTIVATION_URL = "https://methoaayupay.com/shop"
REGISTRATION_ROLE_SETTINGS = ("member", "partner", "rider")
ROLE_REGISTRATION_PATHS = {
    "member": "/register",
    "partner": "/partner-register",
    "rider": "/rider-register",
}
LOCALIZED_ROLE_REPLIES = {
    "bn": {
        "member": "মেঠো মেম্বার হিসেবে যুক্ত হতে Member রেজিস্ট্রেশন করুন।",
        "partner": "মেঠো বিজনেস পার্টনার হিসেবে যুক্ত হতে Partner রেজিস্ট্রেশন করুন।",
        "rider": "মেঠো রাইডার হিসেবে যুক্ত হতে Rider রেজিস্ট্রেশন করুন।",
    },
    "hi": {
        "member": "METHO Member के रूप में जुड़ने के लिए Member registration करें।",
        "partner": "METHO Business Partner के रूप में जुड़ने के लिए Partner registration करें।",
        "rider": "METHO Rider के रूप में जुड़ने के लिए Rider registration करें।",
    },
    "en": {
        "member": "Register as a METHO Member to get started.",
        "partner": "Register as a METHO Business Partner to get started.",
        "rider": "Register as a METHO Rider to get started.",
    },
}
LOCALIZED_DEFAULT_REPLIES = {
    "bn": "নমস্কার! METHO-তে স্বাগতম। Member-এর জন্য 1, Partner-এর জন্য 2, Rider-এর জন্য 3 লিখুন।",
    "hi": "नमस्कार! METHO में आपका स्वागत है। Member के लिए 1, Partner के लिए 2, Rider के लिए 3 लिखें।",
    "en": "Hello! Welcome to METHO. Reply 1 for Member, 2 for Partner, or 3 for Rider.",
}
LOCALIZED_HELP_PROMPTS = {
    "bn": "রেজিস্ট্রেশনে সাহায্য লাগলে এই WhatsApp chat-এ reply করুন।",
    "hi": "Registration में मदद चाहिए तो इसी WhatsApp chat में reply करें।",
    "en": "Reply in this WhatsApp chat if you need help with registration.",
}
DEFAULT_AUTO_REPLY = """আমরা কারা?
মেঠো হলো একটি আধুনিক প্ল্যাটফর্ম, যেখানে কেনাকাটা, ব্যবসা বা সার্ভিসের মাধ্যমে আয় করার সুযোগ রয়েছে।

এখানে কীভাবে আয় করবেন?
কেনাকাটা করে রিওয়ার্ড ও ক্যাশব্যাক পান, রেফারেলের মাধ্যমে কমিশন ও বোনাসের সুযোগ পান, এবং দোকান বা সার্ভিস যুক্ত করে কাস্টমার বৃদ্ধি করুন।

সম্পূর্ণ ফ্রি রেজিস্ট্রেশন এবং অনলাইন ও অফলাইন ফ্রি ট্রেনিং সাপোর্ট দেওয়া হয়।"""
DEFAULT_ROLE_REGISTRATION_REPLIES = {
    "member": """METHO AAY-UPAY-এ Member হিসেবে যুক্ত হয়ে কেনাকাটায় reward/cashback এবং referral-based earning opportunity পেতে পারেন। Registration ও training support-এ ধাপে ধাপে শুরু করুন.

Join METHO as a Member for shopping rewards and referral-based earning opportunities. Registration and training support help you get started step by step.""",
    "partner": """METHO Business Partner হিসেবে আপনার shop বা service-এর customer reach বাড়ানোর সুযোগ পান। Free registration ও available training support-এর মাধ্যমে শুরু করুন.

Join as a METHO Business Partner to grow your shop or service reach. Start with free registration and available training support.""",
    "rider": """METHO Rider হিসেবে delivery ও mobility কাজের earning opportunity পেতে পারেন। Free registration-এর পরে approval ও onboarding support অনুযায়ী শুরু করুন.

Join as a METHO Rider for delivery and mobility earning opportunities. Start with free registration, then approval and onboarding support.""",
}
DEFAULT_REGISTRATION_ROLE_KEYWORDS = {
    "member": "1,member,মেম্বার,কেনাকাটা,ইনকাম",
    "partner": "2,partner,পার্টনার,দোকান,ব্যবসা",
    "rider": "3,rider,রাইডার,ডেলিভারি,গাড়ি",
}
ROLE_IDENTITY_KEYWORDS = {
    "member": ("1", "member", "মেম্বার"),
    "partner": ("2", "partner", "পার্টনার"),
    "rider": ("3", "rider", "রাইডার"),
}
INFORMATIONAL_QUESTION_MARKERS = ("?", "কীভাবে", "কিভাবে", "কি ভাবে", "কী ভাবে", "কেমন করে", "জানতে চাই", "জানতে", "প্রোডাক্ট", "পণ্য", "সম্বন্ধে", "সম্পর্কে", "what", "how")
BROAD_EARNING_KEYWORDS = ("কাজ", "আয়", "আয়", "income", "earn", "earning", "work")
PRODUCT_QUERY_KEYWORDS = ("product", "catalog", "catalogue", "price", "পণ্য", "প্রোডাক্ট", "দাম")
ORDER_QUERY_KEYWORDS = ("order", "অর্ডার")
PAYMENT_QUERY_KEYWORDS = ("payment", "pay", "paid", "টাকা", "পেমেন্ট")
WALLET_QUERY_KEYWORDS = ("wallet", "reward", "rewards", "smart cycle", "ওয়ালেট", "রিওয়ার্ড", "স্মার্ট সাইকেল")
DELIVERY_QUERY_KEYWORDS = ("delivery", "deliver", "metho move", "ডেলিভারি")
SUPPORT_QUERY_KEYWORDS = ("support", "help", "contact", "executive", "সাপোর্ট", "সহায়তা", "যোগাযোগ")
EXECUTIVE_ENQUIRY_KEYWORDS = ("plan", "details", "detail", "income", "earning", "earn", "business opportunity", "work opportunity", "commission", "benefit", "how it works", "income hoy", "income হবে", "ইনকাম", "আয়", "আয়", "ব্যবসার সুযোগ", "কাজের সুযোগ", "কী ভাবে ইনকাম", "কিভাবে ইনকাম", "কীভাবে আয়", "কিভাবে আয়", "প্ল্যান", "ডিটেইল", "বিস্তারিত", "সুবিধা", "কমিশন")
REGISTRATION_INTENT_MARKERS = ("রেজিস্ট", "register", "registration", "যুক্ত", "join", "হতে চাই", "করতে চাই", "হব", "হবো", "চালু", "অনবোর্ডিং", "onboarding", "interested")
WHATSAPP_REGISTRATION_IDLE = "IDLE"
WHATSAPP_REGISTRATION_CONFIRMATION_PENDING = "REGISTRATION_CONFIRMATION_PENDING"
WHATSAPP_INTRODUCTION = "INTRODUCTION"
WHATSAPP_ROLE_SELECTION = "ROLE_SELECTION"
WHATSAPP_MEMBER_NAME = "MEMBER_NAME"
WHATSAPP_MEMBER_ADDRESS = "MEMBER_ADDRESS"
WHATSAPP_MEMBER_PAN = "MEMBER_PAN"
WHATSAPP_MEMBER_DOB = "MEMBER_DOB"
WHATSAPP_MEMBER_CONFIRMATION = "MEMBER_CONFIRMATION"
WHATSAPP_MEMBER_REGISTERED = "MEMBER_REGISTERED"
WHATSAPP_MEMBER_ACTIVATION_PENDING = "MEMBER_ACTIVATION_PENDING"
WHATSAPP_MEMBER_ACTIVE = "MEMBER_ACTIVE"
WHATSAPP_MEMBER_ONBOARDING = "MEMBER_ONBOARDING"
WHATSAPP_PARTNER_BUSINESS_TYPE = "PARTNER_BUSINESS_TYPE"
WHATSAPP_PARTNER_BUSINESS_NAME = "PARTNER_BUSINESS_NAME"
WHATSAPP_PARTNER_CONTACT = "PARTNER_CONTACT"
WHATSAPP_PARTNER_EMAIL = "PARTNER_EMAIL"
WHATSAPP_PARTNER_ADDRESS = "PARTNER_ADDRESS"
WHATSAPP_PARTNER_CITY = "PARTNER_CITY"
WHATSAPP_PARTNER_STATE = "PARTNER_STATE"
WHATSAPP_PARTNER_PINCODE = "PARTNER_PINCODE"
WHATSAPP_PARTNER_PAN = "PARTNER_PAN"
WHATSAPP_PARTNER_AADHAAR = "PARTNER_AADHAAR"
WHATSAPP_PARTNER_CONFIRMATION = "PARTNER_CONFIRMATION"
WHATSAPP_PARTNER_EDIT = "PARTNER_EDIT"
WHATSAPP_PARTNER_APPLICATION_PENDING = "PARTNER_APPLICATION_PENDING"
WHATSAPP_PARTNER_APPROVED = "PARTNER_APPROVED"
WHATSAPP_PARTNER_ONBOARDING = "PARTNER_ONBOARDING"
WHATSAPP_RIDER_NAME = "RIDER_NAME"
WHATSAPP_RIDER_VEHICLE = "RIDER_VEHICLE"
WHATSAPP_RIDER_ADDRESS = "RIDER_ADDRESS"
WHATSAPP_RIDER_CITY = "RIDER_CITY"
WHATSAPP_RIDER_STATE = "RIDER_STATE"
WHATSAPP_RIDER_PINCODE = "RIDER_PINCODE"
WHATSAPP_RIDER_PAN = "RIDER_PAN"
WHATSAPP_RIDER_AADHAAR = "RIDER_AADHAAR"
WHATSAPP_RIDER_CONFIRMATION = "RIDER_CONFIRMATION"
WHATSAPP_RIDER_EDIT = "RIDER_EDIT"
WHATSAPP_RIDER_APPLICATION_PENDING = "RIDER_APPLICATION_PENDING"
WHATSAPP_RIDER_APPROVED = "RIDER_APPROVED"
WHATSAPP_RIDER_ONBOARDING = "RIDER_ONBOARDING"
WHATSAPP_REGISTRATION_COMPLETED = "COMPLETED"
WHATSAPP_MEMBER_ACTIVE_STATES = {WHATSAPP_MEMBER_NAME, WHATSAPP_MEMBER_ADDRESS, WHATSAPP_MEMBER_PAN, WHATSAPP_MEMBER_DOB, WHATSAPP_MEMBER_CONFIRMATION}
WHATSAPP_LEGACY_NATIVE_REGISTRATION_STATES = {
    *WHATSAPP_MEMBER_ACTIVE_STATES,
    WHATSAPP_PARTNER_BUSINESS_TYPE,
    WHATSAPP_PARTNER_BUSINESS_NAME,
    WHATSAPP_PARTNER_CONTACT,
    WHATSAPP_PARTNER_EMAIL,
    WHATSAPP_PARTNER_ADDRESS,
    WHATSAPP_PARTNER_CITY,
    WHATSAPP_PARTNER_STATE,
    WHATSAPP_PARTNER_PINCODE,
    WHATSAPP_PARTNER_PAN,
    WHATSAPP_PARTNER_AADHAAR,
    WHATSAPP_PARTNER_CONFIRMATION,
    WHATSAPP_PARTNER_EDIT,
    WHATSAPP_RIDER_NAME,
    WHATSAPP_RIDER_VEHICLE,
    WHATSAPP_RIDER_ADDRESS,
    WHATSAPP_RIDER_CITY,
    WHATSAPP_RIDER_STATE,
    WHATSAPP_RIDER_PINCODE,
    WHATSAPP_RIDER_PAN,
    WHATSAPP_RIDER_AADHAAR,
    WHATSAPP_RIDER_CONFIRMATION,
    WHATSAPP_RIDER_EDIT,
}
WHATSAPP_REGISTRATION_START_COMMANDS = {"registration", "register", "রেজিস্ট্রেশন", "রেজিস্টার"}
WHATSAPP_RESET_COMMANDS = {"cancel", "reset", "বাতিল"}
WHATSAPP_HANDOFF_COMMANDS = {"agent", "support", "executive", "human", "কথা বলতে চাই", "এক্সিকিউটিভের সাথে কথা বলতে চাই", "প্রতিনিধি", "সাহায্য চাই", "মানুষের সাথে কথা বলতে চাই"}
WHATSAPP_REGISTRATION_REMINDER_OPTOUT_COMMANDS = {"stop", "no more", "unsubscribe", "বন্ধ করুন", "আর মেসেজ চাই না", "পরে করব না"}
WHATSAPP_RESUME_COMMANDS = {"hi", "hello", "হাই", "হ্যালো", "নমস্কার", "start", "namaskar"}
WHATSAPP_NEW_CONVERSATION_GREETINGS = {"hi", "hello", "হাই", "হ্যালো", "নমস্কার", "namaskar"}
WHATSAPP_CONFIRMATION_YES = {"yes", "y", "হ্যাঁ", "submitted", "submit করেছি", "submit korechi", "hoyeche", "hoye গেছে", "হয়েছে", "হয়ে গেছে", "korediyechi", "kore diyechi", "করে দিয়েছি", "করে দিয়েছি", "done"}
WHATSAPP_CONFIRMATION_NO = {"no", "n", "না", "not submitted", "not yet", "submit korini", "submit করি নি", "হয়নি", "হয়নি", "হয় নি", "হয় নি", "করিনি", "করি নি"}
WHATSAPP_PRESET_MESSAGE_DEFAULTS = {
    "preset_registration_intro": "নমস্কার! METHO AAY-UPAY-এ স্বাগতম।\nMETHO-তে Customer, Member, Business Partner অথবা Rider হিসেবে যুক্ত হতে পারেন।\nআপনি জানতে চান:\n1. Member\n2. Partner\n3. Rider\n4. METHO সম্পর্কে আরও জানতে চাই",
    "preset_metho_info": "METHO AAY-UPAY একটি ডিজিটাল platform যেখানে Customer, Member, Partner ও Rider হিসেবে যুক্ত হওয়ার পথ আছে।\n\n{introduction}",
    "preset_member_role_explanation": "Member হিসেবে METHO-র পণ্য ও সদস্য সুবিধা ব্যবহার করতে পারবেন। রেজিস্ট্রেশন করতে চাইলে 1 লিখুন।",
    "preset_partner_role_explanation": "Partner হিসেবে Shop বা Service business application জমা দিতে পারবেন। রেজিস্ট্রেশন করতে চাইলে 1 লিখুন।",
    "preset_rider_role_explanation": "Rider হিসেবে delivery কাজের জন্য application জমা দিতে পারবেন। রেজিস্ট্রেশন করতে চাইলে 1 লিখুন।",
    "preset_role_selection_fallback": "METHO AAY-UPAY সম্পর্কে আরও জানতে পারেন। যুক্ত হওয়ার জন্য একটি option বেছে নিন:\n1. Member\n2. Partner\n3. Rider",
    "preset_support_fallback": "আপনার প্রশ্নটি আমাদের support team দেখবে। METHO WhatsApp executive: {support_number}",
    "preset_business_enquiry_executive": "এই বিষয়ে বিস্তারিত জানতে আমাদের Executive-এর সাথে যোগাযোগ করুন: 9339566110",
    "preset_handoff_requested": "আপনার অনুরোধটি আমাদের support team-কে পাঠানো হয়েছে। একজন representative শীঘ্রই যোগাযোগ করবেন।",
    "preset_icebreaker_metho_info": "METHO AAY-UPAY is a smart e-commerce platform by Metho Logistics Pvt. Ltd. Browse quality daily essentials, kitchenware, & direct farm produce easily!\n\nমেঠো আয়-উপায় হলো মেঠো লজিস্টিকস প্রাইভেট লিমিটেডের একটি ডিজিটাল প্ল্যাটফর্ম। এখান থেকে সহজেই দৈনন্দিন প্রয়োজনীয় সামগ্রী, কিচেন অ্যাপ্লায়েন্স ও সেরা দেশি পণ্য অর্ডার করতে পারবেন।",
    "preset_icebreaker_shop_partner": "Looking to shop or grow your business with us? Visit our portal to place orders or register as an authorized partner/vendor.\n\nপণ্য কিনতে চান নাকি আমাদের সাথে বিজনেসে যুক্ত হতে চান? অর্ডার করতে বা অথরাইজড বিজনেস পার্টনার/ভেন্ডর হিসেবে রেজিস্টার করতে আমাদের পোর্টালে ভিজিট করুন।",
    "preset_icebreaker_customer_support": "We are here to help! For product details or business support, call or WhatsApp us at {support_number}.\n\nআমরা আপনাকে সাহায্য করতে প্রস্তুত! পণ্য অর্ডার বা বিজনেসের যেকোনো সহায়তার জন্য কল বা মেসেজ করুন: {support_number}।",
    "preset_lifecycle_registration_form_opened": "আপনি registration form খুলেছেন। Form পূরণ করতে কোনো সাহায্য লাগলে এখানেই লিখুন।",
    "preset_lifecycle_registration_form_submitted": "আপনার registration form জমা হয়েছে। পরবর্তী ধাপ সম্পন্ন করতে কোনো সাহায্য লাগলে এখানে reply করুন।",
    "preset_registration_submit_confirmation": "🌱 আপনি কি METHO AAY-UPAY Registration Form সফলভাবে Submit করেছেন?\n\nYes — হ্যাঁ, Submit করেছি\nNo — না, এখনও Submit করিনি\n\n👉 Reply: Yes / No",
    "preset_registration_confirmation_no": "Registration সম্পূর্ণ করতে অসুবিধা হলে আমাদের Executive-এর সাথে যোগাযোগ করুন: 9339566110",
    "preset_lifecycle_registration_form_followup_started": "আপনার Registration Form জমা হয়েছে। Account activation বা approval status নিয়ে কোনো প্রশ্ন থাকলে এখানে reply করুন, আমরা সাহায্য করব।",
    "preset_abandoned_registration_reminder": "আপনার METHO registration এখনও সম্পূর্ণ হয়নি।\nYour METHO registration is still incomplete.\n\n👉 Registration complete করতে এখানে ক্লিক করুন:\n{registration_url}\n\n💬 কোনো সাহায্য লাগলে \"Executive\" লিখুন — আমাদের Executive-এর সাথে কথা বলতে পারবেন।",
    "preset_registration_reminders_stopped": "ঠিক আছে। আমরা Registration reminder বন্ধ করে দিয়েছি।\nOkay. We have stopped the Registration reminders.\n\nপরে শুরু করতে চাইলে এই WhatsApp chat-এ reply করুন।",
    "preset_lifecycle_member_registration_completed": "আপনার Member registration সম্পন্ন হয়েছে। Account activation ও প্রথম purchase-এর পরবর্তী ধাপে সহায়তা লাগলে এখানে reply করুন।",
    "preset_lifecycle_member_activated": "আপনার Member account active হয়েছে। Smart Cycle, reward rules এবং product purchase নিয়ে সাহায্য লাগলে এখানে reply করুন।",
    "preset_lifecycle_partner_registration_submitted": "আপনার Partner registration জমা হয়েছে। KYC ও approval-এর পরবর্তী ধাপে সহায়তা লাগলে এখানে reply করুন।",
    "preset_lifecycle_partner_activated": "আপনার Partner account approved হয়েছে। Shop/service onboarding ও প্রথম listing-এর সাহায্য লাগলে এখানে reply করুন।",
    "preset_lifecycle_rider_activated": "আপনার Rider account approved হয়েছে। Availability ও delivery/onboarding নিয়ে সাহায্য লাগলে এখানে reply করুন।",
    "preset_lifecycle_metho_move_booking_created": "আপনার METHO Move booking request পাওয়া গেছে। Payment বা rider assignment বিষয়ে সাহায্য লাগলে এখানে reply করুন।",
    "preset_ai_local_fallback": "ধন্যবাদ আপনার বার্তার জন্য। মেঠো প্রতিনিধি শীঘ্রই আপনার সাথে যোগাযোগ করবেন।",
    "preset_member_active_reply": "আপনার METHO Member ID {member_code} Active।\nপ্রথম ধাপ: METHO products, wallet ও support সম্পর্কে জানতে এখানে প্রশ্ন করুন।",
    "preset_member_onboarding_started": "আপনার Member ID {member_code} এখন Active।\nMember onboarding শুরু হয়েছে। Products, wallet, rewards এবং support সম্পর্কে জানতে এখানে reply করুন।",
    "preset_member_activation_pending": "আপনার Member registration সম্পন্ন হয়েছে।\nMember ID: {member_code}\n\nআপনার ID এখনও Active হয়নি। Activation সম্পন্ন করার পর আপনার ID Active হবে।\nSecure action: {activation_url}\n\nশুধু payment সম্পন্ন করলেই Active ধরে নেওয়া হবে না; backend verification-এর পর status বদলাবে।",
    "preset_order_status_header": "আপনার সাম্প্রতিক order status:",
    "preset_no_orders_found": "আপনার Member account-এ কোনো order পাওয়া যায়নি।",
    "preset_partner_approved_reply": "আপনার Partner application approved হয়েছে। Repository-তে Partner profile, products/catalogue, inventory, orders, ledger এবং reports-এর APIs আছে; account action-এর জন্য secure Partner dashboard ব্যবহার করুন।",
    "preset_partner_rejected_reply": "আপনার Partner application rejected হয়েছে। বিস্তারিত সহায়তার জন্য support লিখুন।",
    "preset_partner_status_reply": "আপনার Partner application এখন {status} অবস্থায় আছে। Approval হলে আমরা জানাব।",
    "preset_rider_approved_reply": "আপনার Rider application approved হয়েছে। Repository-তে Rider profile ও availability APIs আছে; কাজ শুরু করার আগে secure Rider dashboard-এ availability সেট করুন। Assigned delivery/earnings-এর আলাদা WhatsApp flow পাওয়া যায়নি।",
    "preset_rider_status_reply": "আপনার Rider application এখন {status} অবস্থায় আছে। Approval হলে আমরা জানাব।",
    "preset_member_registration_start": "Member registration সম্পূর্ণ করতে website form খুলুন।",
    "preset_partner_registration_start": "Partner registration সম্পূর্ণ করতে website form খুলুন।",
    "preset_rider_registration_start": "Rider registration সম্পূর্ণ করতে website form খুলুন।",
    "preset_registration_continue": "আপনার registration website form-এ সম্পূর্ণ করুন।",
    "preset_registration_continue_invalid": "Registration link খুলে পুরো form পূরণ করুন। সাহায্য লাগলে Executive লিখুন।",
    "preset_registration_cancelled": "আপনার registration বাতিল করা হয়েছে।",
    "preset_member_registration_cancelled": "আপনার active Member registration flow বাতিল করা হয়েছে। আবার শুরু করতে চাইলে লিখুন: আমি মেম্বার হতে চাই",
    "preset_member_registration_incomplete": "আপনার Member registration এখনও অসম্পূর্ণ। সম্পূর্ণ website form-টি খুলে বাকি তথ্য দিন।",
    "preset_role_registration_incomplete": "আপনার {role} registration এখনও অসম্পূর্ণ। সম্পূর্ণ website form-টি খুলে registration শেষ করুন।",
    "preset_member_name_required": "Member registration website form-এ আপনার তথ্য সম্পূর্ণ করুন।",
    "preset_member_address_prompt": "Member registration website form-এ আপনার তথ্য সম্পূর্ণ করুন।",
    "preset_member_address_required": "Member registration website form-এ আপনার তথ্য সম্পূর্ণ করুন।",
    "preset_member_pan_prompt": "Member registration website form-এ আপনার তথ্য সম্পূর্ণ করুন।",
    "preset_member_pan_invalid": "Member registration website form-এ আপনার তথ্য সম্পূর্ণ করুন।",
    "preset_member_dob_prompt": "Member registration website form-এ আপনার তথ্য সম্পূর্ণ করুন।",
    "preset_member_dob_required": "Member registration website form-এ আপনার তথ্য সম্পূর্ণ করুন।",
    "preset_member_edit_restart": "Registration website form-এ তথ্য সম্পাদনা করুন।",
    "preset_member_registration_success": "আপনার Member registration সফল হয়েছে।\nMember ID: {member_code}\n\nআপনার ID এখনও Active হয়নি। Activation সম্পন্ন করার পর আপনার ID Active হবে।\nSecure action: {activation_url}\n\nPayment বা purchase status backend verify না হওয়া পর্যন্ত Active ধরা হবে না।",
    "preset_member_registration_failed": "রেজিস্ট্রেশন সম্পন্ন করা যায়নি: {detail}\nদয়া করে support লিখুন।",
    "preset_partner_confirmation": "Partner registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_partner_business_type_invalid": "Partner registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_partner_business_name_prompt": "Partner registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_partner_contact_prompt": "Partner registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_partner_email_prompt": "Partner registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_partner_email_required": "Partner registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_partner_address_prompt": "Partner registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_partner_city_prompt": "Partner registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_partner_state_prompt": "Partner registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_partner_pincode_prompt": "Partner registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_partner_pincode_invalid": "Partner registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_partner_pan_prompt": "Partner registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_partner_pan_invalid": "Partner registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_partner_aadhaar_prompt": "Partner registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_partner_aadhaar_invalid": "Partner registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_partner_edit_prompt": "Partner registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_registration_edit_value_prompt": "Registration website form-এ তথ্য সম্পাদনা করুন।",
    "preset_partner_submit_failed": "Partner application জমা দেওয়া যায়নি: {detail}",
    "preset_partner_submitted": "আপনার Partner application জমা হয়েছে। Reference ID: {request_id}\nStatus: pending approval। Approval হলে আমরা জানাব।",
    "preset_partner_pending_status": "আপনার Partner application status: {status}.",
    "preset_partner_pending_approved": "আপনার Partner application approved হয়েছে। Partner onboarding শুরু করা যাবে।",
    "preset_rider_name_prompt": "Rider registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_rider_address_prompt": "Rider registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_rider_city_prompt": "Rider registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_rider_state_prompt": "Rider registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_rider_pincode_prompt": "Rider registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_rider_pincode_invalid": "Rider registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_rider_pan_prompt": "Rider registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_rider_pan_invalid": "Rider registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_rider_aadhaar_prompt": "Rider registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_rider_aadhaar_invalid": "Rider registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_rider_edit_prompt": "Rider registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_rider_submit_failed": "Rider application জমা দেওয়া যায়নি: {detail}",
    "preset_rider_submitted": "আপনার Rider application জমা হয়েছে। Status: pending approval। Approval হলে আমরা জানাব।",
    "preset_rider_pending_status": "আপনার Rider application status: {status}.",
    "preset_rider_pending_approved": "আপনার Rider application approved হয়েছে। Rider onboarding শুরু করা যাবে।",
    "preset_partner_confirmation": "Partner registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_rider_confirmation": "Rider registration website form-এ আপনার application সম্পূর্ণ করুন।",
    "preset_pre_registration_followup": "হ্যালো! আপনি METHO সম্পর্কে তথ্য পেয়েছিলেন। Registration করতে কোনো সাহায্য লাগছে কি? চাইলে এই WhatsApp-এ reply করুন। আমরা Member, Partner বা Rider হিসেবে যুক্ত হওয়ার ধাপ বুঝিয়ে দেব।",
    "preset_crm_followup_due": "আপনার আগের METHO আপডেটের পরবর্তী ধাপ সম্পন্ন হয়েছে কি? কোনো সাহায্য লাগলে এই WhatsApp-এ reply করুন।",
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
        "default_auto_reply_image_url",
        "default_auto_reply_mode",
        "customer_auto_reply",
        "customer_auto_reply_image_url",
        "customer_auto_reply_mode",
        "member_auto_reply",
        "member_auto_reply_image_url",
        "member_auto_reply_mode",
        "partner_auto_reply",
        "partner_auto_reply_image_url",
        "partner_auto_reply_mode",
        "invoice_template",
        "order_template",
        "registration_welcome_message",
        "registration_welcome_message_image_url",
        "registration_welcome_message_mode",
        "registration_url",
        "registration_help_prompt",
        "registration_role_question",
        *[f"{role}_registration_url" for role in REGISTRATION_ROLE_SETTINGS],
        *[f"{role}_registration_reply" for role in REGISTRATION_ROLE_SETTINGS],
        *[f"{role}_registration_reply_image_url" for role in REGISTRATION_ROLE_SETTINGS],
        *[f"{role}_registration_keywords" for role in REGISTRATION_ROLE_SETTINGS],
        *WHATSAPP_PRESET_MESSAGE_DEFAULTS.keys(),
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
        "default_auto_reply_image_url": str(db_config.get("default_auto_reply_image_url") or "").strip(),
        "default_auto_reply_mode": str(db_config.get("default_auto_reply_mode") or "text").strip().lower(),
        "customer_auto_reply": str(db_config.get("customer_auto_reply") or "").strip(),
        "customer_auto_reply_image_url": str(db_config.get("customer_auto_reply_image_url") or "").strip(),
        "customer_auto_reply_mode": str(db_config.get("customer_auto_reply_mode") or "text").strip().lower(),
        "member_auto_reply": str(db_config.get("member_auto_reply") or "").strip(),
        "member_auto_reply_image_url": str(db_config.get("member_auto_reply_image_url") or "").strip(),
        "member_auto_reply_mode": str(db_config.get("member_auto_reply_mode") or "text").strip().lower(),
        "partner_auto_reply": str(db_config.get("partner_auto_reply") or "").strip(),
        "partner_auto_reply_image_url": str(db_config.get("partner_auto_reply_image_url") or "").strip(),
        "partner_auto_reply_mode": str(db_config.get("partner_auto_reply_mode") or "text").strip().lower(),
        "invoice_template": str(db_config.get("invoice_template") or "").strip(),
        "order_template": str(db_config.get("order_template") or "").strip(),
        "registration_welcome_message": str(db_config.get("registration_welcome_message") or DEFAULT_WHATSAPP_WELCOME_MESSAGE).strip(),
        "registration_welcome_message_image_url": str(db_config.get("registration_welcome_message_image_url") or "").strip(),
        "registration_welcome_message_mode": str(db_config.get("registration_welcome_message_mode") or "text").strip().lower(),
        "registration_url": str(db_config.get("registration_url") or DEFAULT_WHATSAPP_REGISTRATION_URL).strip(),
        "registration_help_prompt": str(db_config.get("registration_help_prompt") or DEFAULT_WHATSAPP_REGISTRATION_HELP_PROMPT).strip(),
        "registration_role_question": str(db_config.get("registration_role_question") or DEFAULT_REGISTRATION_ROLE_QUESTION).strip(),
        "member_registration_url": str(db_config.get("member_registration_url") or DEFAULT_MEMBER_REGISTRATION_URL).strip(),
        "partner_registration_url": str(db_config.get("partner_registration_url") or DEFAULT_PARTNER_REGISTRATION_URL).strip(),
        "rider_registration_url": str(db_config.get("rider_registration_url") or DEFAULT_RIDER_REGISTRATION_URL).strip(),
        **{f"{role}_registration_reply": str(db_config.get(f"{role}_registration_reply") or DEFAULT_ROLE_REGISTRATION_REPLIES[role]).strip() for role in REGISTRATION_ROLE_SETTINGS},
        **{f"{role}_registration_reply_image_url": str(db_config.get(f"{role}_registration_reply_image_url") or "").strip() for role in REGISTRATION_ROLE_SETTINGS},
        **{f"{role}_registration_reply_mode": str(db_config.get(f"{role}_registration_reply_mode") or "text").strip().lower() for role in REGISTRATION_ROLE_SETTINGS},
        **{f"{role}_registration_keywords": str(db_config.get(f"{role}_registration_keywords") or DEFAULT_REGISTRATION_ROLE_KEYWORDS[role]).strip() for role in REGISTRATION_ROLE_SETTINGS},
        **{key: str(db_config[key]).strip() if key in db_config else value for key, value in WHATSAPP_PRESET_MESSAGE_DEFAULTS.items()},
        "webhook_verify_token": str(db_config.get("webhook_verify_token") or _setting("WHATSAPP_WEBHOOK_VERIFY_TOKEN")),
        "app_secret": str(db_config.get("app_secret") or _setting("WHATSAPP_APP_SECRET")),
        "access_token": str(db_config.get("access_token") or _setting("WHATSAPP_ACCESS_TOKEN")),
    }


def get_whatsapp_preset_message(db, key: str, fallback: str = "", **values) -> str:
    config = resolve_config(db)
    template = str(config.get(key, fallback) or "").strip()
    if not template:
        return ""
    safe_values = {name: "" if value is None else str(value) for name, value in values.items()}
    try:
        return template.format(**safe_values)
    except (KeyError, ValueError):
        logger.warning("WhatsApp preset template could not be formatted: key=%s", key)
        return template


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


def get_configured_whatsapp_reply_image(db, role: str | None = None) -> str:
    role_key = (role or "default").lower()
    key = {"customer": "customer_auto_reply_image_url", "member": "member_registration_reply_image_url", "partner": "partner_registration_reply_image_url", "rider": "rider_registration_reply_image_url", "default": "default_auto_reply_image_url"}.get(role_key, "default_auto_reply_image_url")
    alternate_key = {"member": "member_auto_reply_image_url", "partner": "partner_auto_reply_image_url", "customer": "customer_auto_reply_image_url", "rider": "default_auto_reply_image_url"}.get(role_key, "default_auto_reply_image_url")
    config = resolve_config(db)
    return str(config.get(key) or config.get(alternate_key) or (config.get("default_auto_reply_image_url") if key != "default_auto_reply_image_url" else "") or "").strip()


def get_configured_whatsapp_reply_mode(db, role: str | None = None) -> str:
    role_key = (role or "default").lower()
    key = {"customer": "customer_auto_reply_mode", "member": "member_registration_reply_mode", "partner": "partner_registration_reply_mode", "rider": "rider_registration_reply_mode", "default": "default_auto_reply_mode"}.get(role_key, "default_auto_reply_mode")
    config = resolve_config(db)
    image_key = {"customer": "customer_auto_reply_image_url", "member": "member_registration_reply_image_url", "partner": "partner_registration_reply_image_url", "rider": "rider_registration_reply_image_url", "default": "default_auto_reply_image_url"}.get(role_key, "default_auto_reply_image_url")
    mode = "image" if str(config.get(image_key) or "").strip() else str(config.get(key) or "text").strip().lower()
    return mode if mode in {"text", "image"} else "text"


def _configured_executive_fallback(db) -> str:
    config = resolve_config(db)
    values = (
        str(config.get("customer_auto_reply") or "").strip(),
        str(config.get("default_auto_reply") or "").strip(),
        str(config.get("registration_help_prompt") or "").strip(),
    )
    markers = ("executive", "support", "contact", "representative", "সাপোর্ট", "সহায়তা", "যোগাযোগ", "প্রতিনিধি")
    for value in values:
        lowered = value.lower()
        if value and any(marker in lowered for marker in markers):
            return value
    try:
        from .routers.auth import METHO_SUPPORT_WHATSAPP
        support_number = str(METHO_SUPPORT_WHATSAPP or "").strip()
    except Exception:
        support_number = ""
    if support_number:
        return get_whatsapp_preset_message(db, "preset_support_fallback", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_support_fallback"], support_number=support_number)
    return ""


def _preset_role_for_common_query(config: dict, text: str) -> str | None:
    lowered = str(text or "").lower()
    if any(keyword in lowered for keyword in ("partner", "পার্টনার")):
        return "partner"
    if any(keyword in lowered for keyword in ("rider", "রাইডার")):
        return "rider"
    if any(keyword in lowered for keyword in (*PRODUCT_QUERY_KEYWORDS, *PAYMENT_QUERY_KEYWORDS, *WALLET_QUERY_KEYWORDS, *DELIVERY_QUERY_KEYWORDS)):
        return "customer" if str(config.get("customer_auto_reply") or "").strip() else "default"
    if any(keyword in lowered for keyword in (*ORDER_QUERY_KEYWORDS, *SUPPORT_QUERY_KEYWORDS, *BROAD_EARNING_KEYWORDS)):
        return "default"
    return None


def get_registration_welcome_image(db) -> str:
    return str(resolve_config(db).get("registration_welcome_message_image_url") or "").strip()


def get_registration_welcome_mode(db) -> str:
    config = resolve_config(db)
    mode = "image" if str(config.get("registration_welcome_message_image_url") or "").strip() else str(config.get("registration_welcome_message_mode") or "text").strip().lower()
    return mode if mode in {"text", "image"} else "text"


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


def send_whatsapp_image(db, recipient: str, image_url: str, caption: str = "") -> dict:
    config = resolve_config(db)
    token = config.get("access_token")
    phone_number_id = config.get("phone_number_id")
    if not token or not phone_number_id:
        raise RuntimeError("WhatsApp Cloud API is not configured")
    to = str(recipient or "").strip()
    link = str(image_url or "").strip()
    if not to or not link or not link.startswith(("https://", "http://")):
        raise ValueError("recipient and a public image URL are required")
    image = {"link": link}
    if str(caption or "").strip():
        image["caption"] = str(caption).strip()
    message = {"messaging_product": "whatsapp", "to": to, "type": "image", "image": image}
    endpoint = f"https://graph.facebook.com/{config['graph_api_version']}/{phone_number_id}/messages"
    request = Request(endpoint, data=json.dumps(message).encode("utf-8"), headers={"Accept": "application/json", "Content-Type": "application/json", "Authorization": f"Bearer {token}", "User-Agent": "metho-crm-whatsapp-image/1.0"}, method="POST")
    from urllib.error import HTTPError
    try:
        with urlopen(request, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        try:
            detail = json.loads(exc.read().decode("utf-8")).get("error", {}).get("message", str(exc))
        except Exception:
            detail = str(exc)
        raise RuntimeError(f"WhatsApp API error: {detail}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("WhatsApp API returned an invalid response")
    return payload


def public_whatsapp_image_url(value: str) -> str:
    raw = str(value or "").strip()
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    base = str(os.getenv("METHO_PUBLIC_BASE_URL") or "https://metho-backend.onrender.com").strip().rstrip("/")
    return f"{base}/{raw.lstrip('/')}"


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


def _registration_reply(db, reply_text: str, lead_id: str = "", phone: str = "") -> str:
    config = resolve_config(db)
    text = str(reply_text or "").strip()
    cta = "\n\n".join((
        config["registration_welcome_message"],
        f"রেজিস্ট্রেশন করুন: {_tracked_registration_url(config['registration_url'], 'member', lead_id, phone)}",
        config["registration_help_prompt"],
    ))
    return f"{text}\n\n{cta}" if text else cta


def _role_registration_reply(db, role: str, lead_id: str = "", phone: str = "") -> str:
    config = resolve_config(db)
    reply = config.get(f"{role}_registration_reply") or config["registration_welcome_message"]
    return "\n\n".join((
        reply,
        f"{role.title()} রেজিস্ট্রেশন করুন: {_tracked_registration_url(_role_registration_url(config, role), role, lead_id, phone)}",
        config["registration_help_prompt"],
    ))


def _is_informational_question(text: str) -> bool:
    lowered = str(text or "").lower()
    return any(marker in lowered for marker in INFORMATIONAL_QUESTION_MARKERS)


def _has_registration_intent(text: str) -> bool:
    lowered = str(text or "").lower()
    return any(marker in lowered for marker in REGISTRATION_INTENT_MARKERS)


def _registration_role_for_text(config: dict, text: str) -> str | None:
    lowered = str(text or "").lower()
    if _is_informational_question(text) and not _has_registration_intent(text):
        return None
    role_matches = []
    for role in REGISTRATION_ROLE_SETTINGS:
        keywords = (keyword.strip().lower() for keyword in str(config.get(f"{role}_registration_keywords") or "").split(","))
        for keyword in keywords:
            if keyword and keyword in lowered:
                if keyword in ROLE_IDENTITY_KEYWORDS[role]:
                    return role
                role_matches.append((role, keyword))
    if not role_matches:
        return None
    for role, _keyword in role_matches:
        return role
    return None


def _detect_language(text: str) -> str:
    value = str(text or "")
    if any("\u0980" <= char <= "\u09ff" for char in value):
        return "bn"
    if any("\u0900" <= char <= "\u097f" for char in value):
        return "hi"
    return "en"


def _localized_role_reply(db, role: str, language: str, lead_id: str = "", phone: str = "") -> str:
    config = resolve_config(db)
    custom = str(config.get(f"{role}_registration_reply") or "").strip()
    default = DEFAULT_ROLE_REGISTRATION_REPLIES.get(role, "")
    base = custom if custom and custom != default else LOCALIZED_ROLE_REPLIES[language][role]
    default_help = DEFAULT_WHATSAPP_REGISTRATION_HELP_PROMPT
    help_prompt = config["registration_help_prompt"] if config["registration_help_prompt"] != default_help else LOCALIZED_HELP_PROMPTS[language]
    return "\n\n".join((base, f"{role.title()} registration: {_tracked_registration_url(_role_registration_url(config, role), role, lead_id, phone)}", help_prompt))


def _role_registration_url(config: dict, role: str) -> str:
    raw_url = str(config.get(f"{role}_registration_url") or "").strip()
    parsed = urlsplit(raw_url)
    role_path = ROLE_REGISTRATION_PATHS.get(role, "/register")
    wrong_form_paths = {"", "/", "/app", "/login", "/app/register"}
    if parsed.path in wrong_form_paths:
        return urlunsplit((parsed.scheme, parsed.netloc, role_path, parsed.query, parsed.fragment))
    return raw_url


def _tracked_registration_url(url: str, role: str, lead_id: str = "", phone: str = "") -> str:
    parsed = urlsplit(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["source"] = "whatsapp"
    query["registration_role"] = role
    if lead_id:
        query["crm_lead_id"] = lead_id
    if phone:
        query["prefill_phone"] = phone
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment))


def _localized_default_reply(db, language: str) -> str:
    config = resolve_config(db)
    custom = str(config.get("default_auto_reply") or "").strip()
    return custom if custom and custom != DEFAULT_AUTO_REPLY else LOCALIZED_DEFAULT_REPLIES[language]


def _send_auto_reply_if_configured(db, recipient: str, text: str) -> str:
    config = resolve_config(db)
    if not str(text or "").strip():
        return "skipped"
    if not config["enabled"] or not config["access_token"] or not config["phone_number_id"]:
        return "skipped"
    try:
        send_whatsapp_message(db, recipient, text=text)
        return "sent"
    except Exception:
        logger.exception("WhatsApp auto-reply failed; inbound CRM message will still be stored")
        return "failed"


def _whatsapp_command_text(text: str) -> str:
    return " ".join(str(text or "").strip().lower().split())


def _is_whatsapp_reset_command(text: str) -> bool:
    return _whatsapp_command_text(text) in WHATSAPP_RESET_COMMANDS


def _is_registration_start_command(text: str) -> bool:
    return _whatsapp_command_text(text) in WHATSAPP_REGISTRATION_START_COMMANDS


def _is_new_conversation_greeting(text: str) -> bool:
    return _whatsapp_command_text(text) in WHATSAPP_NEW_CONVERSATION_GREETINGS


def _is_whatsapp_handoff_command(text: str) -> bool:
    normalized = _whatsapp_command_text(text)
    return normalized in WHATSAPP_HANDOFF_COMMANDS or any(command in normalized for command in WHATSAPP_HANDOFF_COMMANDS if " " in command)


def _is_registration_reminder_opt_out(text: str) -> bool:
    normalized = _whatsapp_command_text(text)
    return normalized in WHATSAPP_REGISTRATION_REMINDER_OPTOUT_COMMANDS or any(command in normalized for command in WHATSAPP_REGISTRATION_REMINDER_OPTOUT_COMMANDS if " " in command)


def _is_executive_enquiry(text: str) -> bool:
    normalized = _whatsapp_command_text(text)
    return bool(normalized) and any(keyword in normalized for keyword in EXECUTIVE_ENQUIRY_KEYWORDS)


def _stop_abandoned_registration_reminders(db, lead: CRMLead, reason: str) -> None:
    notes = "Abandoned registration reminder"
    for followup in db.query(CRMFollowUp).filter(CRMFollowUp.lead_id == lead.id, CRMFollowUp.status.in_(["Pending", "Processing"]), CRMFollowUp.notes == notes).all():
        followup.status = "Cancelled"
        db.query(WhatsAppMessageOutbox).filter(
            WhatsAppMessageOutbox.status.in_(["pending", "retry"]),
            WhatsAppMessageOutbox.dedupe_key.like(f"crm-followup:{followup.id}:%"),
        ).delete(synchronize_session=False)
    for task in db.query(CRMTask).filter(CRMTask.lead_id == lead.id, CRMTask.status.in_(["Pending", "In Progress"]), CRMTask.title == notes).all():
        task.status = "Completed"
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="registration_reminders_stopped", message=reason))


def _registration_confirmation_reply(db, session: WhatsAppRegistrationSession, lead: CRMLead, text: str, recipient: str) -> bool:
    normalized = _whatsapp_command_text(text)
    if normalized in WHATSAPP_CONFIRMATION_YES:
        data = _session_data(session)
        data["registration_confirmed"] = True
        session.data_json = json.dumps(data, ensure_ascii=False)
        session.completed_at = session.completed_at or datetime.now(timezone.utc)
        _stop_abandoned_registration_reminders(db, lead, "Registration confirmed after website form submit")
        handled = _route_existing_identity(db, lead, recipient, text) if (lead.member_user_id or lead.partner_request_id or lead.rider_user_id) else False
        data = _session_data(session)
        data["registration_confirmed"] = True
        _save_session_data(session, data)
        return handled
    if normalized in WHATSAPP_CONFIRMATION_NO:
        data = _session_data(session)
        data["registration_confirmed"] = False
        _save_session_data(session, data)
        reply = get_whatsapp_preset_message(db, "preset_registration_confirmation_no", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_registration_confirmation_no"])
        return _send_member_registration_reply(db, recipient, reply)
    reply = get_whatsapp_preset_message(db, "preset_registration_submit_confirmation", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_registration_submit_confirmation"])
    return _send_member_registration_reply(db, recipient, reply)


def _member_registration_session(db, phone: str, wa_id: str, lead: CRMLead) -> WhatsAppRegistrationSession:
    session = db.query(WhatsAppRegistrationSession).filter(WhatsAppRegistrationSession.phone == phone).first()
    if not session:
        session = db.query(WhatsAppRegistrationSession).filter(WhatsAppRegistrationSession.lead_id == lead.id).first()
    if not session:
        session = WhatsAppRegistrationSession(phone=phone, wa_id=wa_id or phone, lead_id=lead.id, role="member", state=WHATSAPP_REGISTRATION_IDLE)
        db.add(session)
        db.flush()
    else:
        if wa_id and not session.wa_id:
            session.wa_id = wa_id
        if not session.lead_id:
            session.lead_id = lead.id
    return session


def _clear_member_registration_session(session: WhatsAppRegistrationSession) -> None:
    session.state = WHATSAPP_REGISTRATION_IDLE
    session.name = ""
    session.address = ""
    session.data_json = "{}"
    session.completed_at = None


def _session_data(session: WhatsAppRegistrationSession) -> dict:
    try:
        value = json.loads(session.data_json or "{}")
    except (TypeError, ValueError):
        value = {}
    if not isinstance(value, dict):
        return {}
    encrypted = value.pop("sensitive_encrypted", "")
    if encrypted:
        try:
            sensitive = json.loads(decrypt_secret(encrypted))
            if isinstance(sensitive, dict):
                value.update(sensitive)
        except (RuntimeError, TypeError, ValueError, json.JSONDecodeError):
            pass
    return value


def _save_session_data(session: WhatsAppRegistrationSession, value: dict) -> None:
    safe = {key: item for key, item in value.items() if key not in {"pan_no", "aadhaar_no", "password"}}
    sensitive = {key: value[key] for key in ("pan_no", "aadhaar_no") if value.get(key)}
    if sensitive:
        safe["sensitive_encrypted"] = encrypt_secret(json.dumps(sensitive, ensure_ascii=False))
    session.data_json = json.dumps(safe, ensure_ascii=False)


def _member_registration_confirmation(db, data: dict) -> str:
    pan = str(data.get("pan_no", ""))
    masked_pan = f"{'*' * max(0, len(pan) - 4)}{pan[-4:]}" if pan else ""
    return get_whatsapp_preset_message(db, "preset_member_confirmation", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_member_confirmation"], name=data.get("name", ""), address=data.get("address", ""), pan=masked_pan, dob=data.get("dob", ""))


def _masked(value: str, visible: int = 4) -> str:
    text = str(value or "")
    return f"{'*' * max(0, len(text) - visible)}{text[-visible:]}" if text else ""


def _registration_confirmation(role: str, data: dict, db=None) -> str:
    if role == "partner":
        return get_whatsapp_preset_message(db, "preset_partner_confirmation", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_confirmation"], business_type=data.get("business_type", ""), business_name=data.get("business_name", ""), contact_person=data.get("contact_person", ""), email=data.get("email", ""), address=data.get("address", ""), city=data.get("city", ""), state=data.get("state", ""), pincode=data.get("pincode", ""), pan=_masked(data.get("pan_no", "")), aadhaar=_masked(data.get("aadhaar_no", ""), 4))
    return get_whatsapp_preset_message(db, "preset_rider_confirmation", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_rider_confirmation"], name=data.get("name", ""), vehicle_type=data.get("vehicle_type", ""), address=data.get("address", ""), city=data.get("city", ""), state=data.get("state", ""), pincode=data.get("pincode", ""), pan=_masked(data.get("pan_no", "")), aadhaar=_masked(data.get("aadhaar_no", ""), 4))


def _send_member_registration_reply(db, recipient: str, text: str) -> bool:
    return _send_auto_reply_if_configured(db, recipient, text=text) == "sent"


def _schedule_lifecycle_followup(db, lead: CRMLead, notes: str, days: int = 2) -> None:
    existing = db.query(CRMFollowUp).filter(CRMFollowUp.lead_id == lead.id, CRMFollowUp.status == "Pending", CRMFollowUp.notes == notes).first()
    if existing:
        return
    due_at = datetime.now(timezone.utc) + timedelta(days=max(1, days))
    db.add(CRMFollowUp(lead_id=lead.id, scheduled_at=due_at, status="Pending", notes=notes))
    assignee_id = lead.assigned_user_id or _admin_assignee(db)
    if assignee_id and not db.query(CRMTask).filter(CRMTask.lead_id == lead.id, CRMTask.title == notes, CRMTask.status.in_(["Pending", "In Progress"])).first():
        db.add(CRMTask(title=notes, description=notes, due_at=due_at, status="Pending", priority="High", lead_id=lead.id, assigned_user_id=assignee_id.id if isinstance(assignee_id, User) else assignee_id, created_by_user_id=assignee_id.id if isinstance(assignee_id, User) else assignee_id))
    existing_due = lead.next_follow_up_at
    if existing_due and existing_due.tzinfo is None:
        existing_due = existing_due.replace(tzinfo=timezone.utc)
    lead.next_follow_up_at = due_at if not existing_due or due_at < existing_due else lead.next_follow_up_at
    lead.follow_up_status = "Pending"


def _complete_lifecycle_followups(db, lead: CRMLead, keyword: str) -> None:
    for followup in db.query(CRMFollowUp).filter(CRMFollowUp.lead_id == lead.id, CRMFollowUp.status == "Pending").all():
        if keyword.lower() in str(followup.notes or "").lower():
            followup.status = "Completed"
    for task in db.query(CRMTask).filter(CRMTask.lead_id == lead.id, CRMTask.status.in_(["Pending", "In Progress"])).all():
        if keyword.lower() in str(task.title or "").lower():
            task.status = "Completed"


def _add_lifecycle_activity_once(db, lead: CRMLead, activity_type: str, message: str) -> None:
    if not db.query(CRMLeadActivity).filter(CRMLeadActivity.lead_id == lead.id, CRMLeadActivity.activity_type == activity_type).first():
        db.add(CRMLeadActivity(lead_id=lead.id, activity_type=activity_type, message=message))


def _introduction_message() -> str:
    return WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_registration_intro"]


def _configured_introduction_message(db) -> str:
    configured = get_whatsapp_preset_message(db, "preset_registration_intro", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_registration_intro"])
    if configured:
        return configured
    config = resolve_config(db)
    return "\n\n".join((config["registration_welcome_message"], config["registration_role_question"]))


def _role_explanation(db, role: str) -> str:
    return get_whatsapp_preset_message(db, f"preset_{role}_role_explanation", WHATSAPP_PRESET_MESSAGE_DEFAULTS[f"preset_{role}_role_explanation"])


def _send_introduction(db, session: WhatsAppRegistrationSession, lead: CRMLead, recipient: str) -> bool:
    session.state = WHATSAPP_INTRODUCTION
    session.role = ""
    reply = _configured_introduction_message(db)
    if not _send_member_registration_reply(db, recipient, reply):
        return False
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_introduction_started", message="WhatsApp METHO introduction started"))
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_sent", message=reply))
    return True


def _continue_introduction(db, session: WhatsAppRegistrationSession, lead: CRMLead, text: str, recipient: str) -> bool:
    normalized = _whatsapp_command_text(text)
    choices = {"1": "member", "member": "member", "মেম্বার": "member", "2": "partner", "partner": "partner", "পার্টনার": "partner", "3": "rider", "rider": "rider", "রাইডার": "rider"}
    if normalized == "4":
        reply = get_whatsapp_preset_message(db, "preset_metho_info", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_metho_info"], introduction=_configured_introduction_message(db))
        session.state = WHATSAPP_ROLE_SELECTION
    elif normalized in choices:
        session.role = choices[normalized]
        session.state = WHATSAPP_ROLE_SELECTION
        reply = _role_registration_reply(db, session.role, lead.id, recipient)
    else:
        session.state = WHATSAPP_ROLE_SELECTION
        reply = get_whatsapp_preset_message(db, "preset_role_selection_fallback", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_role_selection_fallback"])
    if not _send_member_registration_reply(db, recipient, reply):
        return False
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_sent", message=reply))
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_role_selected", message=session.role or "none"))
    return True


def _route_registered_member(db, session: WhatsAppRegistrationSession, lead: CRMLead, recipient: str, incoming_text: str = "") -> bool:
    data = _session_data(session)
    user_id = str(data.get("member_user_id") or lead.member_user_id or "").strip()
    user = db.query(User).filter(User.id == user_id, User.role == "member").first() if user_id else None
    if not user:
        return False
    try:
        from .routers.compat import _member_purchase_active
        active = bool(user.is_active and _member_purchase_active(db, user.id))
    except Exception:
        active = bool(user.is_active)
    if active:
        was_onboarded = session.state == WHATSAPP_MEMBER_ONBOARDING
        session.state = WHATSAPP_MEMBER_ONBOARDING
        normalized = _whatsapp_command_text(incoming_text)
        if "order" in normalized or "অর্ডার" in normalized:
            orders = db.query(PublicOrder).filter(PublicOrder.customer_user_id == user.id).order_by(PublicOrder.created_at.desc()).limit(5).all()
            if orders:
                reply = get_whatsapp_preset_message(db, "preset_order_status_header", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_order_status_header"]) + "\n" + "\n".join(f"{order.id}: {order.status}" for order in orders)
            else:
                reply = get_whatsapp_preset_message(db, "preset_no_orders_found", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_no_orders_found"])
        else:
            reply = get_whatsapp_preset_message(db, "preset_member_active_reply", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_member_active_reply"], member_code=data.get("member_code") or user.id)
        for followup in db.query(CRMFollowUp).filter(CRMFollowUp.lead_id == lead.id, CRMFollowUp.status == "Pending").all():
            if "activation" in str(followup.notes or "").lower() or "member" in str(followup.notes or "").lower():
                followup.status = "Completed"
        lead.next_follow_up_at = None
        lead.follow_up_status = "Completed"
        _complete_lifecycle_followups(db, lead, "activation")
        if not was_onboarded:
            db.add(CRMLeadActivity(lead_id=lead.id, activity_type="onboarding_started", message="Member onboarding started after backend activation confirmation"))
            activation_reply = get_whatsapp_preset_message(db, "preset_member_onboarding_started", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_member_onboarding_started"], member_code=data.get("member_code") or user.id)
            if not _send_member_registration_reply(db, recipient, activation_reply):
                return False
            db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_sent", message=activation_reply))
        else:
            if not _send_member_registration_reply(db, recipient, reply):
                return False
            db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_sent", message=reply))
    else:
        session.state = WHATSAPP_MEMBER_ACTIVATION_PENDING
        reply = get_whatsapp_preset_message(db, "preset_member_activation_pending", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_member_activation_pending"], member_code=data.get("member_code") or user.id, activation_url=DEFAULT_MEMBER_ACTIVATION_URL)
        db.add(CRMLeadActivity(lead_id=lead.id, activity_type="activation_pending", message="WhatsApp member asked while activation is pending"))
        db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_sent", message=reply))
        return _send_member_registration_reply(db, recipient, reply)
    return True


def _route_existing_identity(db, lead: CRMLead, recipient: str, incoming_text: str = "") -> bool:
    if lead.member_user_id:
        session = _member_registration_session(db, recipient, recipient, lead)
        session.role = "member"
        session.data_json = json.dumps({"member_user_id": lead.member_user_id}, ensure_ascii=False)
        return _route_registered_member(db, session, lead, recipient, incoming_text)
    request = db.query(PartnerRequest).filter(PartnerRequest.id == lead.partner_request_id).first() if lead.partner_request_id else None
    if request:
        status = str(request.status or "pending").lower()
        session = _member_registration_session(db, recipient, recipient, lead)
        session.role = "partner"
        session.data_json = json.dumps({"request_id": request.id}, ensure_ascii=False)
        session.state = WHATSAPP_PARTNER_ONBOARDING if status == "approved" else WHATSAPP_PARTNER_APPLICATION_PENDING
        if status == "approved":
            _complete_lifecycle_followups(db, lead, "Partner approval")
            _add_lifecycle_activity_once(db, lead, "onboarding_started", "Partner onboarding started after approval")
        else:
            _schedule_lifecycle_followup(db, lead, "Partner approval follow-up", 2)
        reply = (
            get_whatsapp_preset_message(db, "preset_partner_approved_reply", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_approved_reply"])
            if status == "approved"
            else get_whatsapp_preset_message(db, "preset_partner_rejected_reply", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_rejected_reply"])
            if status == "rejected"
            else get_whatsapp_preset_message(db, "preset_partner_status_reply", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_status_reply"], status=status)
        )
        db.add(CRMLeadActivity(lead_id=lead.id, activity_type="partner_approved" if status == "approved" else "partner_application_pending", message=f"WhatsApp status check: {status}"))
        return _send_member_registration_reply(db, recipient, reply)
    rider = db.query(User).filter(User.id == lead.rider_user_id, User.role == "rider").first() if lead.rider_user_id else db.query(User).filter(User.phone == recipient, User.role == "rider").first()
    if rider:
        profile = db.query(AppSetting).filter(AppSetting.key == f"rider_profile:{rider.id}").first()
        try:
            rider_data = json.loads(profile.value_json or "{}") if profile else {}
        except (TypeError, ValueError):
            rider_data = {}
        status = str(rider_data.get("approval_status") or "pending").lower()
        session = _member_registration_session(db, recipient, recipient, lead)
        session.role = "rider"
        session.data_json = json.dumps({"rider_user_id": rider.id}, ensure_ascii=False)
        session.state = WHATSAPP_RIDER_ONBOARDING if status == "approved" else WHATSAPP_RIDER_APPLICATION_PENDING
        if status == "approved":
            _complete_lifecycle_followups(db, lead, "Rider approval")
            _add_lifecycle_activity_once(db, lead, "onboarding_started", "Rider onboarding started after approval")
        else:
            _schedule_lifecycle_followup(db, lead, "Rider approval follow-up", 2)
        reply = get_whatsapp_preset_message(db, "preset_rider_approved_reply", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_rider_approved_reply"]) if status == "approved" else get_whatsapp_preset_message(db, "preset_rider_status_reply", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_rider_status_reply"], status=status)
        db.add(CRMLeadActivity(lead_id=lead.id, activity_type="rider_approved" if status == "approved" else "rider_application_pending", message=f"WhatsApp status check: {status}"))
        return _send_member_registration_reply(db, recipient, reply)
    return False


def _start_member_registration_flow(db, session: WhatsAppRegistrationSession, lead: CRMLead, recipient: str) -> bool:
    session.role = "member"
    session.state = WHATSAPP_MEMBER_NAME
    session.name = ""
    session.address = ""
    _save_session_data(session, {})
    session.completed_at = None
    lead.status = "APPLICATION" if lead.status == "NEW" else lead.status
    text = get_whatsapp_preset_message(db, "preset_member_registration_start", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_member_registration_start"])
    if not _send_member_registration_reply(db, recipient, text):
        _clear_member_registration_session(session)
        return False
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_sent", message=text))
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_registration_state", message="MEMBER_NAME"))
    return True


def _start_role_registration_flow(db, session: WhatsAppRegistrationSession, lead: CRMLead, role: str, recipient: str) -> bool:
    session.role = role
    session.completed_at = None
    _save_session_data(session, {})
    if role == "partner":
        session.state = WHATSAPP_PARTNER_BUSINESS_TYPE
        reply = get_whatsapp_preset_message(db, "preset_partner_registration_start", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_registration_start"])
    else:
        session.state = WHATSAPP_RIDER_NAME
        reply = get_whatsapp_preset_message(db, "preset_rider_registration_start", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_rider_registration_start"])
    lead.status = "APPLICATION" if lead.status == "NEW" else lead.status
    return _send_member_registration_reply(db, recipient, reply)


def _partner_application_payload(session: WhatsAppRegistrationSession, data: dict) -> dict:
    return {
        "login_id": data.get("email", ""),
        "password": secrets.token_urlsafe(18),
        "business_name": data.get("business_name", ""),
        "business_type": data.get("business_type", "Shop"),
        "contact_person": data.get("contact_person", ""),
        "phone": session.phone,
        "whatsapp_no": session.phone,
        "address": data.get("address", ""),
        "city": data.get("city", ""),
        "state": data.get("state", ""),
        "pincode": data.get("pincode", ""),
        "pan_no": data.get("pan_no", ""),
        "aadhaar_no": data.get("aadhaar_no", ""),
        "business_description": data.get("business_description", ""),
    }


def _rider_application_payload(session: WhatsAppRegistrationSession, data: dict) -> RiderRegisterRequest:
    return RiderRegisterRequest(
        name=data.get("name", ""),
        phone=session.phone,
        password=secrets.token_urlsafe(18),
        vehicle_type=data.get("vehicle_type", ""),
        whatsapp=session.phone,
        address=data.get("address", ""),
        city=data.get("city", ""),
        state=data.get("state", ""),
        pincode=data.get("pincode", ""),
        pan_no=data.get("pan_no", ""),
        aadhaar_no=data.get("aadhaar_no", ""),
        agreed_to_terms=True,
    )


def _continue_role_registration_flow(db, session: WhatsAppRegistrationSession, lead: CRMLead, incoming_text: str, recipient: str) -> bool:
    text = str(incoming_text or "").strip()
    normalized = _whatsapp_command_text(text)
    data = _session_data(session)
    role = session.role
    if data.pop("_resume_prompt", False):
        if normalized == "1":
            reply = get_whatsapp_preset_message(db, "preset_registration_continue", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_registration_continue"])
        elif normalized == "2":
            return _start_role_registration_flow(db, session, lead, role, recipient)
        elif normalized in {"0", "cancel", "বাতিল"}:
            _clear_member_registration_session(session)
            reply = get_whatsapp_preset_message(db, "preset_registration_cancelled", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_registration_cancelled"])
        else:
            reply = get_whatsapp_preset_message(db, "preset_registration_continue_invalid", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_registration_continue_invalid"])
    elif normalized in WHATSAPP_RESUME_COMMANDS and session.state not in {WHATSAPP_PARTNER_CONFIRMATION, WHATSAPP_RIDER_CONFIRMATION, WHATSAPP_PARTNER_APPLICATION_PENDING, WHATSAPP_RIDER_APPLICATION_PENDING}:
        data["_resume_prompt"] = True
        reply = get_whatsapp_preset_message(db, "preset_role_registration_incomplete", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_role_registration_incomplete"], role=role.title())
    elif normalized in {"0", "cancel", "বাতিল"}:
        _clear_member_registration_session(session)
        reply = get_whatsapp_preset_message(db, "preset_registration_cancelled", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_registration_cancelled"])
    elif role == "partner":
        if session.state == WHATSAPP_PARTNER_BUSINESS_TYPE:
            if normalized not in {"1", "2", "shop", "service"}:
                reply = get_whatsapp_preset_message(db, "preset_partner_business_type_invalid", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_business_type_invalid"])
            else:
                data["business_type"] = "Service" if normalized in {"2", "service"} else "Shop"
                session.state = WHATSAPP_PARTNER_BUSINESS_NAME
                reply = get_whatsapp_preset_message(db, "preset_partner_business_name_prompt", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_business_name_prompt"])
        elif session.state == WHATSAPP_PARTNER_BUSINESS_NAME:
            data["business_name"] = text[:255]
            session.state = WHATSAPP_PARTNER_CONTACT
            reply = get_whatsapp_preset_message(db, "preset_partner_contact_prompt", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_contact_prompt"])
        elif session.state == WHATSAPP_PARTNER_CONTACT:
            data["contact_person"] = text[:120]
            session.state = WHATSAPP_PARTNER_EMAIL
            reply = get_whatsapp_preset_message(db, "preset_partner_email_prompt", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_email_prompt"])
        elif session.state == WHATSAPP_PARTNER_EMAIL:
            if len(text) < 3:
                reply = get_whatsapp_preset_message(db, "preset_partner_email_required", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_email_required"])
            else:
                data["email"] = text[:255]
                session.state = WHATSAPP_PARTNER_ADDRESS
                reply = get_whatsapp_preset_message(db, "preset_partner_address_prompt", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_address_prompt"])
        elif session.state == WHATSAPP_PARTNER_ADDRESS:
            data["address"] = text[:2000]
            session.state = WHATSAPP_PARTNER_CITY
            reply = get_whatsapp_preset_message(db, "preset_partner_city_prompt", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_city_prompt"])
        elif session.state == WHATSAPP_PARTNER_CITY:
            data["city"] = text[:120]
            session.state = WHATSAPP_PARTNER_STATE
            reply = get_whatsapp_preset_message(db, "preset_partner_state_prompt", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_state_prompt"])
        elif session.state == WHATSAPP_PARTNER_STATE:
            data["state"] = text[:120]
            session.state = WHATSAPP_PARTNER_PINCODE
            reply = get_whatsapp_preset_message(db, "preset_partner_pincode_prompt", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_pincode_prompt"])
        elif session.state == WHATSAPP_PARTNER_PINCODE:
            if not text.isdigit() or len(text) != 6:
                reply = get_whatsapp_preset_message(db, "preset_partner_pincode_invalid", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_pincode_invalid"])
            else:
                data["pincode"] = text
                session.state = WHATSAPP_PARTNER_PAN
                reply = get_whatsapp_preset_message(db, "preset_partner_pan_prompt", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_pan_prompt"])
        elif session.state == WHATSAPP_PARTNER_PAN:
            pan = text.upper().replace(" ", "")
            if len(pan) != 10:
                reply = get_whatsapp_preset_message(db, "preset_partner_pan_invalid", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_pan_invalid"])
            else:
                data["pan_no"] = pan
                session.state = WHATSAPP_PARTNER_AADHAAR
                reply = get_whatsapp_preset_message(db, "preset_partner_aadhaar_prompt", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_aadhaar_prompt"])
        elif session.state == WHATSAPP_PARTNER_AADHAAR:
            aadhaar = "".join(ch for ch in text if ch.isdigit())
            if len(aadhaar) != 12:
                reply = get_whatsapp_preset_message(db, "preset_partner_aadhaar_invalid", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_aadhaar_invalid"])
            else:
                data["aadhaar_no"] = aadhaar
                session.state = WHATSAPP_PARTNER_CONFIRMATION
                reply = _registration_confirmation(role, data, db)
        elif session.state == WHATSAPP_PARTNER_CONFIRMATION:
            if normalized in {"1", "confirm", "yes", "হ্যাঁ", "হ্যা"}:
                from .routers.partner_public import partner_register
                try:
                    result = partner_register(_partner_application_payload(session, data), db)
                except Exception as exc:
                    reply = get_whatsapp_preset_message(db, "preset_partner_submit_failed", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_submit_failed"], detail=getattr(exc, "detail", str(exc)))
                else:
                    request_id = result.get("request_id", "")
                    session.state = WHATSAPP_PARTNER_APPLICATION_PENDING
                    session.completed_at = datetime.now(timezone.utc)
                    session.data_json = json.dumps({"request_id": request_id, "business_name": data.get("business_name", "")}, ensure_ascii=False)
                    lead.partner_request_id = request_id
                    record_lifecycle_event(db, lead, "partner_application_submitted", f"Partner application submitted: {request_id}.")
                    _schedule_lifecycle_followup(db, lead, "Partner approval follow-up", 2)
                    reply = get_whatsapp_preset_message(db, "preset_partner_submitted", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_submitted"], request_id=request_id)
            elif normalized in {"2", "edit"}:
                session.state = WHATSAPP_PARTNER_EDIT
                reply = get_whatsapp_preset_message(db, "preset_partner_edit_prompt", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_edit_prompt"])
            else:
                reply = _registration_confirmation(role, data, db)
        elif session.state == WHATSAPP_PARTNER_EDIT:
            edit_states = {"1": WHATSAPP_PARTNER_BUSINESS_NAME, "2": WHATSAPP_PARTNER_CONTACT, "3": WHATSAPP_PARTNER_EMAIL, "4": WHATSAPP_PARTNER_ADDRESS, "5": WHATSAPP_PARTNER_CITY, "6": WHATSAPP_PARTNER_PAN, "7": WHATSAPP_PARTNER_AADHAAR}
            session.state = edit_states.get(normalized, WHATSAPP_PARTNER_CONFIRMATION)
            if normalized in edit_states:
                data["_editing"] = True
            reply = get_whatsapp_preset_message(db, "preset_registration_edit_value_prompt", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_registration_edit_value_prompt"]) if normalized in edit_states else _registration_confirmation(role, data, db)
        elif session.state == WHATSAPP_PARTNER_APPLICATION_PENDING:
            request = db.query(PartnerRequest).filter(PartnerRequest.id == data.get("request_id")).first()
            status = str(request.status if request else "pending").lower()
            reply = get_whatsapp_preset_message(db, "preset_partner_pending_status", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_pending_status"], status=status) if status != "approved" else get_whatsapp_preset_message(db, "preset_partner_pending_approved", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_partner_pending_approved"])
            if status == "approved":
                session.state = WHATSAPP_PARTNER_ONBOARDING
                _complete_lifecycle_followups(db, lead, "Partner approval")
                _add_lifecycle_activity_once(db, lead, "onboarding_started", "Partner onboarding started after approval")
                record_lifecycle_event(db, lead, "partner_approved", "Partner application approved.", "Start Partner onboarding", 1)
        else:
            reply = get_whatsapp_preset_message(db, "preset_role_registration_incomplete", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_role_registration_incomplete"], role="Partner")
    else:
        rider_prompts = {
            WHATSAPP_RIDER_NAME: ("name", WHATSAPP_RIDER_VEHICLE, "preset_rider_name_prompt"),
            WHATSAPP_RIDER_VEHICLE: ("vehicle_type", WHATSAPP_RIDER_ADDRESS, "preset_rider_address_prompt"),
            WHATSAPP_RIDER_ADDRESS: ("address", WHATSAPP_RIDER_CITY, "preset_rider_city_prompt"),
            WHATSAPP_RIDER_CITY: ("city", WHATSAPP_RIDER_STATE, "preset_rider_state_prompt"),
            WHATSAPP_RIDER_STATE: ("state", WHATSAPP_RIDER_PINCODE, "preset_rider_pincode_prompt"),
        }
        if session.state in rider_prompts:
            key, next_state, prompt_key = rider_prompts[session.state]
            data[key] = text[:2000]
            session.state = next_state
            reply = get_whatsapp_preset_message(db, prompt_key, WHATSAPP_PRESET_MESSAGE_DEFAULTS[prompt_key])
        elif session.state == WHATSAPP_RIDER_PINCODE:
            if not text.isdigit() or len(text) != 6:
                reply = get_whatsapp_preset_message(db, "preset_rider_pincode_invalid", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_rider_pincode_invalid"])
            else:
                data["pincode"] = text
                session.state = WHATSAPP_RIDER_PAN
                reply = get_whatsapp_preset_message(db, "preset_rider_pan_prompt", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_rider_pan_prompt"])
        elif session.state == WHATSAPP_RIDER_PAN:
            pan = text.upper().replace(" ", "")
            if len(pan) != 10:
                reply = get_whatsapp_preset_message(db, "preset_rider_pan_invalid", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_rider_pan_invalid"])
            else:
                data["pan_no"] = pan
                session.state = WHATSAPP_RIDER_AADHAAR
                reply = get_whatsapp_preset_message(db, "preset_rider_aadhaar_prompt", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_rider_aadhaar_prompt"])
        elif session.state == WHATSAPP_RIDER_AADHAAR:
            aadhaar = "".join(ch for ch in text if ch.isdigit())
            if len(aadhaar) != 12:
                reply = get_whatsapp_preset_message(db, "preset_rider_aadhaar_invalid", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_rider_aadhaar_invalid"])
            else:
                data["aadhaar_no"] = aadhaar
                session.state = WHATSAPP_RIDER_CONFIRMATION
                reply = _registration_confirmation(role, data, db)
        elif session.state == WHATSAPP_RIDER_CONFIRMATION:
            if normalized in {"1", "confirm", "yes", "হ্যাঁ", "হ্যা"}:
                from .routers.rider import rider_register
                try:
                    result = rider_register(_rider_application_payload(session, data), db)
                except Exception as exc:
                    reply = get_whatsapp_preset_message(db, "preset_rider_submit_failed", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_rider_submit_failed"], detail=getattr(exc, "detail", str(exc)))
                else:
                    rider = result.get("rider") or {}
                    rider_id = rider.get("id", "")
                    session.state = WHATSAPP_RIDER_APPLICATION_PENDING
                    session.completed_at = datetime.now(timezone.utc)
                    session.data_json = json.dumps({"rider_user_id": rider_id, "name": data.get("name", "")}, ensure_ascii=False)
                    lead.rider_user_id = rider_id or lead.rider_user_id
                    record_lifecycle_event(db, lead, "rider_application_submitted", f"Rider application submitted: {rider_id}.")
                    _schedule_lifecycle_followup(db, lead, "Rider approval follow-up", 2)
                    reply = get_whatsapp_preset_message(db, "preset_rider_submitted", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_rider_submitted"])
            elif normalized in {"2", "edit"}:
                session.state = WHATSAPP_RIDER_EDIT
                reply = get_whatsapp_preset_message(db, "preset_rider_edit_prompt", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_rider_edit_prompt"])
            else:
                reply = _registration_confirmation(role, data, db)
        elif session.state == WHATSAPP_RIDER_EDIT:
            edit_states = {"1": WHATSAPP_RIDER_NAME, "2": WHATSAPP_RIDER_VEHICLE, "3": WHATSAPP_RIDER_ADDRESS, "4": WHATSAPP_RIDER_CITY, "5": WHATSAPP_RIDER_STATE, "6": WHATSAPP_RIDER_PINCODE, "7": WHATSAPP_RIDER_PAN, "8": WHATSAPP_RIDER_AADHAAR}
            session.state = edit_states.get(normalized, WHATSAPP_RIDER_CONFIRMATION)
            if normalized in edit_states:
                data["_editing"] = True
            reply = get_whatsapp_preset_message(db, "preset_registration_edit_value_prompt", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_registration_edit_value_prompt"]) if normalized in edit_states else _registration_confirmation(role, data, db)
        elif session.state == WHATSAPP_RIDER_APPLICATION_PENDING:
            rider = db.query(User).filter(User.id == data.get("rider_user_id"), User.role == "rider").first()
            profile = db.query(AppSetting).filter(AppSetting.key == f"rider_profile:{data.get('rider_user_id')}").first()
            try:
                status = str((json.loads(profile.value_json or "{}") if profile else {}).get("approval_status") or "pending").lower()
            except (TypeError, ValueError):
                status = "pending"
            reply = get_whatsapp_preset_message(db, "preset_rider_pending_status", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_rider_pending_status"], status=status) if status != "approved" else get_whatsapp_preset_message(db, "preset_rider_pending_approved", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_rider_pending_approved"])
            if rider and status == "approved":
                session.state = WHATSAPP_RIDER_ONBOARDING
                _complete_lifecycle_followups(db, lead, "Rider approval")
                _add_lifecycle_activity_once(db, lead, "onboarding_started", "Rider onboarding started after approval")
                record_lifecycle_event(db, lead, "rider_approved", "Rider application approved.", "Start Rider onboarding", 1)
        else:
            reply = get_whatsapp_preset_message(db, "preset_role_registration_incomplete", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_role_registration_incomplete"], role="Rider")
    if data.pop("_editing", False) and session.state not in {WHATSAPP_PARTNER_CONFIRMATION, WHATSAPP_RIDER_CONFIRMATION}:
        session.state = WHATSAPP_PARTNER_CONFIRMATION if role == "partner" else WHATSAPP_RIDER_CONFIRMATION
        reply = _registration_confirmation(role, data, db)
    _save_session_data(session, data)
    if not _send_member_registration_reply(db, recipient, reply):
        return False
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_sent", message=reply))
    return True


def _request_whatsapp_human_handoff(db, lead: CRMLead, session: WhatsAppRegistrationSession | None, recipient: str) -> bool:
    if session:
        _clear_member_registration_session(session)
    _stop_abandoned_registration_reminders(db, lead, "Automatic registration reminders stopped after human support request")
    ensure_pending_followup(db, lead, notes="WhatsApp customer requested human support")
    assignee_id = lead.assigned_user_id or _admin_assignee(db)
    if assignee_id:
        assignee_id = assignee_id.id if isinstance(assignee_id, User) else assignee_id
        db.add(CRMTask(title="WhatsApp human support requested", description="Customer asked to speak with a human from WhatsApp.", due_at=datetime.now(timezone.utc), status="Pending", priority="High", lead_id=lead.id, assigned_user_id=assignee_id, created_by_user_id=assignee_id))
    text = get_whatsapp_preset_message(db, "preset_handoff_requested", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_handoff_requested"])
    if not _send_member_registration_reply(db, recipient, text):
        return False
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_human_handoff_requested", message="Customer requested human support from WhatsApp"))
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_sent", message=text))
    return True


def _continue_member_registration_flow(db, session: WhatsAppRegistrationSession, lead: CRMLead, incoming_text: str, recipient: str) -> bool:
    text = str(incoming_text or "").strip()
    data = _session_data(session)
    if data.pop("_resume_prompt", False):
        if _whatsapp_command_text(text) == "1":
            reply = get_whatsapp_preset_message(db, "preset_registration_continue", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_registration_continue"])
        elif _whatsapp_command_text(text) == "2":
            return _start_member_registration_flow(db, session, lead, recipient)
        elif _whatsapp_command_text(text) in {"0", "cancel", "বাতিল"}:
            _clear_member_registration_session(session)
            reply = get_whatsapp_preset_message(db, "preset_registration_cancelled", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_registration_cancelled"])
        else:
            reply = get_whatsapp_preset_message(db, "preset_registration_continue_invalid", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_registration_continue_invalid"])
    elif _whatsapp_command_text(text) in WHATSAPP_RESUME_COMMANDS and session.state != WHATSAPP_MEMBER_CONFIRMATION:
        data["_resume_prompt"] = True
        reply = get_whatsapp_preset_message(db, "preset_member_registration_incomplete", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_member_registration_incomplete"])
    elif _is_whatsapp_reset_command(text):
        _clear_member_registration_session(session)
        reply = get_whatsapp_preset_message(db, "preset_member_registration_cancelled", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_member_registration_cancelled"])
    elif session.state == WHATSAPP_MEMBER_NAME:
        if not text:
            reply = get_whatsapp_preset_message(db, "preset_member_name_required", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_member_name_required"])
        else:
            session.name = text[:120]
            data["name"] = session.name
            if not lead.contact_person or lead.contact_person.startswith("WhatsApp-") or lead.contact_person == "WhatsApp Lead":
                lead.contact_person = session.name
            session.state = WHATSAPP_MEMBER_ADDRESS
            reply = get_whatsapp_preset_message(db, "preset_member_address_prompt", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_member_address_prompt"])
    elif session.state == WHATSAPP_MEMBER_ADDRESS:
        if len(text) < 3:
            reply = get_whatsapp_preset_message(db, "preset_member_address_required", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_member_address_required"])
        else:
            session.address = text[:2000]
            data["address"] = session.address
            if not lead.address:
                lead.address = session.address
            session.state = WHATSAPP_MEMBER_PAN
            reply = get_whatsapp_preset_message(db, "preset_member_pan_prompt", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_member_pan_prompt"])
    elif session.state == WHATSAPP_MEMBER_PAN:
        pan = text.upper().replace(" ", "")
        if len(pan) != 10:
            reply = get_whatsapp_preset_message(db, "preset_member_pan_invalid", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_member_pan_invalid"])
        else:
            data["pan_no"] = pan
            session.state = WHATSAPP_MEMBER_DOB
            reply = get_whatsapp_preset_message(db, "preset_member_dob_prompt", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_member_dob_prompt"])
    elif session.state == WHATSAPP_MEMBER_DOB:
        if len(text) < 4:
            reply = get_whatsapp_preset_message(db, "preset_member_dob_required", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_member_dob_required"])
        else:
            data["dob"] = text[:40]
            session.state = WHATSAPP_MEMBER_CONFIRMATION
            reply = _member_registration_confirmation(db, data)
    elif session.state == WHATSAPP_MEMBER_CONFIRMATION:
        normalized = _whatsapp_command_text(text)
        if normalized in {"1", "confirm", "yes", "হ্যাঁ", "হ্যা"}:
            from .routers.auth import register
            try:
                result = register(RegisterRequest(
                    name=data.get("name", ""),
                    email=f"WA{session.phone[-10:]}",
                    phone=session.phone,
                    pan_no=data.get("pan_no", ""),
                    password=secrets.token_urlsafe(18),
                    sponsor_code=None,
                ), None, db)
            except Exception as exc:
                detail = getattr(exc, "detail", str(exc))
                reply = get_whatsapp_preset_message(db, "preset_member_registration_failed", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_member_registration_failed"], detail=detail)
            else:
                user = result.get("user") or {}
                session.state = WHATSAPP_MEMBER_ACTIVATION_PENDING
                session.completed_at = datetime.now(timezone.utc)
                session.data_json = json.dumps({"member_user_id": user.get("id", ""), "member_code": user.get("member_code", ""), "name": data.get("name", "")}, ensure_ascii=False)
                lead.member_user_id = user.get("id") or lead.member_user_id
                lead.contact_person = data.get("name") or lead.contact_person
                lead.address = data.get("address") or lead.address
                lead.status = "APPLICATION" if lead.status == "NEW" else lead.status
                db.add(CRMLeadActivity(lead_id=lead.id, activity_type="registration_completed", message="WhatsApp Member registration completed; activation remains pending."))
                db.add(CRMLeadActivity(lead_id=lead.id, activity_type="activation_pending", message="WhatsApp Member registration completed; payment activation is pending."))
                _schedule_lifecycle_followup(db, lead, "Member activation follow-up", 2)
                reply = get_whatsapp_preset_message(db, "preset_member_registration_success", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_member_registration_success"], member_code=user.get("member_code") or user.get("id"), activation_url=DEFAULT_MEMBER_ACTIVATION_URL)
        elif normalized in {"2", "edit"}:
            session.state = WHATSAPP_MEMBER_NAME
            session.name = ""
            session.address = ""
            _save_session_data(session, {})
            reply = get_whatsapp_preset_message(db, "preset_member_edit_restart", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_member_edit_restart"])
        elif normalized in {"0", "cancel", "বাতিল"}:
            _clear_member_registration_session(session)
            reply = get_whatsapp_preset_message(db, "preset_registration_cancelled", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_registration_cancelled"])
        else:
            reply = _member_registration_confirmation(db, data)
    else:
        return False
    _save_session_data(session, data)
    if not _send_member_registration_reply(db, recipient, reply):
        return False
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_sent", message=reply))
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_registration_state", message=session.state))
    return True


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
        language = _detect_language(incoming_text)

        reply_text = ""
        config = resolve_config(db)
        role_hint = _registration_role_for_text(config, incoming_text)
        lowered = incoming_text.lower()
        is_ai_freeform_query = _is_informational_question(incoming_text) and not _has_registration_intent(incoming_text)
        if not role_hint:
            role_hint = _preset_role_for_common_query(config, incoming_text)

        if (
            "What is METHO AAY-UPAY?" in incoming_text
            or "মেঠো আয়-উপায় কী?" in incoming_text
        ):
            reply_text = get_whatsapp_preset_message(db, "preset_icebreaker_metho_info", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_icebreaker_metho_info"])

        elif (
            "How to buy products or join as a Partner?" in incoming_text
            or "কীভাবে কেনাকাটা বা পার্টনার হিসেবে যুক্ত হব?" in incoming_text
        ):
            reply_text = get_whatsapp_preset_message(db, "preset_icebreaker_shop_partner", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_icebreaker_shop_partner"])

        elif (
            "How to contact Customer Support?" in incoming_text
            or "কাস্টমার কেয়ারের সাথে কীভাবে যোগাযোগ করব?" in incoming_text
        ):
            try:
                from .routers.auth import METHO_SUPPORT_WHATSAPP
                support_number = str(METHO_SUPPORT_WHATSAPP or "").strip()
            except Exception:
                support_number = ""
            reply_text = get_whatsapp_preset_message(db, "preset_icebreaker_customer_support", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_icebreaker_customer_support"], support_number=support_number)

        auto_reply = ""

        lead = db.query(CRMLead).filter(CRMLead.lead_id == normalized["lead_id"]).first()
        if not lead:
            lead = find_lead_by_phone(db, normalized["phone"], normalized["whatsapp_no"])
        if lead:
            enrich_lead_from_contact(
                lead,
                name=normalized["contact_person"],
                phone=normalized["phone"],
                whatsapp_no=normalized["whatsapp_no"],
            )
            ensure_pending_followup(db, lead, notes="Follow-up for WhatsApp Cloud lead")
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
            lead.next_follow_up_at = datetime.now(timezone.utc) + timedelta(days=1)
            if assignee:
                db.add(CRMTask(title="Initial WhatsApp lead follow-up", description="Contact WhatsApp lead and qualify the inbound enquiry", due_at=datetime.now(timezone.utc) + timedelta(days=1), status="Pending", priority="High", lead_id=lead.id, assigned_user_id=assignee.id, created_by_user_id=assignee.id))
            status = "created"
        else:
            status = "updated"

        body = normalized["metadata"].get("raw_body") or ""
        dispatch_marker = f"auto-reply-for:{message_id}"
        registration_session = db.query(WhatsAppRegistrationSession).filter(WhatsAppRegistrationSession.phone == normalized["phone"]).first()
        logger.info(
            "WhatsApp inbound routing: text=%r role_hint=%s is_ai_freeform_query=%s session_state=%s",
            incoming_text[:120],
            role_hint or "none",
            is_ai_freeform_query,
            registration_session.state if registration_session else "none",
        )
        native_member_handled = False
        if _is_registration_start_command(incoming_text):
            registration_session = _member_registration_session(db, normalized["phone"], normalized["whatsapp_no"], lead)
            _clear_member_registration_session(registration_session)
            native_member_handled = _send_introduction(db, registration_session, lead, normalized["phone"])
        elif _is_registration_reminder_opt_out(incoming_text):
            if registration_session:
                _clear_member_registration_session(registration_session)
            _stop_abandoned_registration_reminders(db, lead, "Customer opted out of registration reminders")
            reply = get_whatsapp_preset_message(db, "preset_registration_reminders_stopped", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_registration_reminders_stopped"])
            native_member_handled = _send_member_registration_reply(db, normalized["phone"], reply)
        elif _is_whatsapp_handoff_command(incoming_text):
            native_member_handled = _request_whatsapp_human_handoff(db, lead, registration_session, normalized["phone"])
        elif registration_session and registration_session.state == WHATSAPP_REGISTRATION_CONFIRMATION_PENDING:
            native_member_handled = _registration_confirmation_reply(db, registration_session, lead, incoming_text, normalized["phone"])
        elif lead.member_user_id or lead.partner_request_id or lead.rider_user_id:
            native_member_handled = _route_existing_identity(db, lead, normalized["phone"], incoming_text)
        elif _is_new_conversation_greeting(incoming_text):
            registration_session = _member_registration_session(db, normalized["phone"], normalized["whatsapp_no"], lead)
            _clear_member_registration_session(registration_session)
            native_member_handled = _send_introduction(db, registration_session, lead, normalized["phone"])
        elif registration_session and registration_session.state in WHATSAPP_LEGACY_NATIVE_REGISTRATION_STATES:
            # Legacy field-by-field sessions must re-enter the website-form flow.
            _clear_member_registration_session(registration_session)
            native_member_handled = _send_introduction(db, registration_session, lead, normalized["phone"])
        elif registration_session and registration_session.state in {WHATSAPP_INTRODUCTION, WHATSAPP_ROLE_SELECTION} and _is_executive_enquiry(incoming_text):
            reply = get_whatsapp_preset_message(db, "preset_business_enquiry_executive", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_business_enquiry_executive"])
            native_member_handled = _send_member_registration_reply(db, normalized["phone"], reply)
        elif registration_session and registration_session.state in {WHATSAPP_INTRODUCTION, WHATSAPP_ROLE_SELECTION}:
            native_member_handled = _continue_introduction(db, registration_session, lead, incoming_text, normalized["phone"])
        elif registration_session and registration_session.role == "member" and registration_session.state in {WHATSAPP_MEMBER_REGISTERED, WHATSAPP_MEMBER_ACTIVATION_PENDING, WHATSAPP_MEMBER_ACTIVE, WHATSAPP_MEMBER_ONBOARDING}:
            native_member_handled = _route_registered_member(db, registration_session, lead, normalized["phone"], incoming_text)
        elif registration_session and registration_session.role in {"partner", "rider"} and registration_session.state not in {WHATSAPP_REGISTRATION_IDLE, WHATSAPP_INTRODUCTION, WHATSAPP_ROLE_SELECTION}:
            native_member_handled = _continue_role_registration_flow(db, registration_session, lead, incoming_text, normalized["phone"])
        elif registration_session and registration_session.role == "member" and registration_session.state in WHATSAPP_MEMBER_ACTIVE_STATES:
            native_member_handled = _continue_member_registration_flow(db, registration_session, lead, incoming_text, normalized["phone"])
        elif registration_session is None and not role_hint and not is_ai_freeform_query:
            registration_session = _member_registration_session(db, normalized["phone"], normalized["whatsapp_no"], lead)
            native_member_handled = _send_introduction(db, registration_session, lead, normalized["phone"])
        elif registration_session is None and not role_hint and is_ai_freeform_query:
            registration_session = _member_registration_session(db, normalized["phone"], normalized["whatsapp_no"], lead)
            registration_session.state = WHATSAPP_INTRODUCTION
        elif role_hint in {"member", "partner", "rider"}:
            registration_session = _member_registration_session(db, normalized["phone"], normalized["whatsapp_no"], lead)
            registration_session.role = role_hint
            registration_session.state = WHATSAPP_ROLE_SELECTION
            reply = _role_registration_reply(db, role_hint, lead.id, normalized["phone"])
            native_member_handled = _send_member_registration_reply(db, normalized["phone"], reply)
            if native_member_handled:
                db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_sent", message=reply))
                db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_role_selected", message=role_hint))

        if native_member_handled:
            logger.info("WhatsApp final reply path: registration message_id=%s", message_id)
            db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_received", message=f"{activity_prefix}: {body}"))
            db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_auto_reply_dispatched", message=f"{dispatch_marker}:member-registration"))
            statuses.append(status)
            continue

        if reply_text:
            auto_reply = _registration_reply(db, reply_text, lead.id, normalized["phone"])
        elif role_hint:
            if role_hint in REGISTRATION_ROLE_SETTINGS:
                auto_reply = _localized_role_reply(db, role_hint, language, lead.id, normalized["phone"])
            elif role_hint in {"customer", "default"}:
                if role_hint == "default" and any(keyword in incoming_text.lower() for keyword in ORDER_QUERY_KEYWORDS) and str(config.get("order_template") or "").strip():
                    auto_reply = str(config.get("order_template") or "").strip()
                elif role_hint == "default" and any(keyword in incoming_text.lower() for keyword in SUPPORT_QUERY_KEYWORDS):
                    auto_reply = _configured_executive_fallback(db) or get_configured_whatsapp_reply(db, "default", DEFAULT_AUTO_REPLY)
                else:
                    auto_reply = get_configured_whatsapp_reply(db, role_hint, DEFAULT_AUTO_REPLY)
            else:
                configured_reply = get_configured_whatsapp_reply(db, role_hint)
                auto_reply = _registration_reply(db, configured_reply, lead.id, normalized["phone"])
        else:
            auto_reply = get_configured_whatsapp_reply(db, "default", DEFAULT_AUTO_REPLY)
        logger.info(
            "WhatsApp AI routing decision: message_id=%s ai_handles_freeform=%s",
            message_id,
            False,
        )
        db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_received", message=f"{activity_prefix}: {body}"))
        already_dispatched = db.query(CRMLeadActivity).filter(
            CRMLeadActivity.lead_id == lead.id,
            CRMLeadActivity.activity_type == "whatsapp_auto_reply_dispatched",
            CRMLeadActivity.message.like(f"{dispatch_marker}%"),
        ).first()
        if already_dispatched:
            statuses.append(status)
            continue
        allow_preset_dispatch = True
        reply_mode = get_registration_welcome_mode(db) if reply_text else get_configured_whatsapp_reply_mode(db, role_hint)
        if auto_reply or reply_text:
            logger.info("WhatsApp final reply path: %s message_id=%s", "configured fallback" if is_ai_freeform_query and not role_hint else "static default", message_id)
        if allow_preset_dispatch and auto_reply and reply_mode == "text":
            reply_status = _send_auto_reply_if_configured(db, normalized["phone"], text=auto_reply)
            if reply_status == "sent":
                db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_sent", message=auto_reply))
                db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_auto_reply_dispatched", message=f"{dispatch_marker}:text"))
        if allow_preset_dispatch and reply_mode == "image":
            image_url = get_registration_welcome_image(db) if reply_text else get_configured_whatsapp_reply_image(db, role_hint)
            if image_url:
                try:
                    send_whatsapp_image(db, normalized["phone"], public_whatsapp_image_url(image_url), caption=auto_reply[:1024])
                    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_image_sent", message=f"{image_url} | caption: {auto_reply[:1024]}"))
                    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_auto_reply_dispatched", message=f"{dispatch_marker}:image"))
                except Exception:
                    logger.exception("WhatsApp preset image auto-reply failed")
            else:
                logger.error("WhatsApp reply mode is image but no poster URL is configured: role=%s message_id=%s", role_hint or "default", message_id)
        if reply_mode not in {"text", "image"}:
            logger.warning("Unknown WhatsApp reply mode; no auto-reply dispatched: mode=%s message_id=%s", reply_mode, message_id)
        statuses.append(status)
    db.commit()
    if "created" in statuses:
        return "created"
    if "updated" in statuses:
        return "updated"
    return "duplicate"
