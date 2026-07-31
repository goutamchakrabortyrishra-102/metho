"""
METHO AAY-UPAY ERP v3.0 - Backend Server
Powered by METHO Logistics Pvt. Ltd.
FastAPI + MongoDB + JWT Auth
"""
from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Header, UploadFile, File, Response, Body
from fastapi.responses import StreamingResponse, FileResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import jwt
import bcrypt
from pathlib import Path
import mimetypes
from urllib.parse import quote_plus
from pydantic import BaseModel, Field, EmailStr, ConfigDict
from typing import List, Optional, Literal
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# ===================== CONFIG =====================
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ.get('JWT_SECRET', 'metho-aay-upay-secret-key-change-in-prod')
JWT_ALGORITHM = "HS256"
JWT_EXP_HOURS = 24 * 7  # 7 days

APP_NAME = "metho-aay-upay"
LOCAL_STORAGE_DIR = ROOT_DIR / "uploaded_objects"
LOCAL_STORAGE_DIR.mkdir(parents=True, exist_ok=True)


def put_object(path: str, data: bytes, content_type: str) -> dict:
    file_path = LOCAL_STORAGE_DIR / path
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(data)
    return {"path": path, "size": len(data)}


def get_object(path: str) -> tuple:
    file_path = LOCAL_STORAGE_DIR / path
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Object not found in local storage")
    return file_path.read_bytes(), "application/octet-stream"


def _build_upi_payment_uri(amount: float, settings: dict, note: Optional[str] = None) -> str:
    upi_id = (settings.get("upi_id") or "").strip()
    if not upi_id:
        raise HTTPException(status_code=400, detail="UPI ID not configured")
    payee_name = (settings.get("upi_payee_name") or "").strip()
    if amount is None or amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")
    params = [
        ("pa", upi_id),
        ("pn", payee_name),
        ("am", f"{amount:.2f}"),
        ("cu", "INR"),
    ]
    if note:
        params.append(("tn", note))
    query = "&".join(f"{k}={quote_plus(v)}" for k, v in params if v and v != "")
    return f"upi://pay?{query}"


api_router = APIRouter(prefix="/api")


def _generate_local_description(name: str, category: str, product_type: Optional[str] = None) -> str:
    name_text = name.strip() or "এই পণ্য"
    category_text = category.strip() or "পণ্য"
    bn_description = (
        f"{name_text} হলো একটি বিশ্বাসযোগ্য এবং ব্যবহার-বান্ধব {category_text}, "
        "যা প্রতিদিনের জীবনে কাজে লাগে এবং সাধারন মান বজায় রাখে।"
    )
    en_description = (
        f"{name_text} is a reliable {category_text} product made for everyday use, "
        "built to offer honest value and simple practical quality."
    )
    return f"{bn_description}\n\n{en_description}"


def _build_upi_amount_qr(amount: float, settings: dict, note: Optional[str] = None) -> dict:
    qr_text = _build_upi_payment_uri(amount, settings, note)
    qr_data_url = None
    try:
        qr_data_url = _qr_to_data_url(qr_text)
    except Exception:
        qr_data_url = None
    return {"upi_payment_uri": qr_text, "upi_payment_qr_data_url": qr_data_url}


def _sanitize_audit_metadata(metadata: Optional[dict]) -> dict:
    if not isinstance(metadata, dict):
        return {}
    clean = {}
    for key, value in metadata.items():
        if isinstance(value, (str, int, float, bool)) or value is None:
            clean[key] = value
        elif isinstance(value, list):
            clean[key] = [item for item in value if isinstance(item, (str, int, float, bool)) or item is None][:50]
        elif isinstance(value, dict):
            nested = {}
            for nested_key, nested_value in value.items():
                if isinstance(nested_value, (str, int, float, bool)) or nested_value is None:
                    nested[nested_key] = nested_value
            clean[key] = nested
    return clean


async def log_admin_action(
    admin: dict,
    action: str,
    module: str,
    summary: str,
    target_id: Optional[str] = None,
    metadata: Optional[dict] = None,
):
    await db.admin_audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "actor_id": admin["id"],
        "actor_name": admin.get("name") or admin.get("email") or "Admin",
        "actor_role": admin.get("role"),
        "action": action,
        "module": module,
        "summary": summary,
        "target_id": target_id,
        "metadata": _sanitize_audit_metadata(metadata),
        "created_at": now_iso(),
    })


@api_router.get("/payments/upi-qr")
async def get_payment_upi_qr(amount: float, note: Optional[str] = None):
    """Generate an amount-specific UPI payment URI/QR for checkout."""
    settings = await get_settings()
    qr_payload = _build_upi_amount_qr(amount, settings, note or "METHO AAY-UPAY payment")
    merchant_qr_path = settings.get("upi_qr_url")
    return {
        "amount": round(amount, 2),
        "currency": "INR",
        "upi_id": settings.get("upi_id"),
        "upi_payee_name": settings.get("upi_payee_name"),
        "upi_qr_url": settings.get("upi_qr_url"),
        "merchant_qr_url": f"/api/files/{merchant_qr_path}" if merchant_qr_path else None,
        **qr_payload,
    }

app = FastAPI(title="METHO AAY-UPAY ERP v3.0")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ===================== HELPERS =====================
def now_iso():
    return datetime.now(timezone.utc).isoformat()


def _smart_cycle_window(settings: dict) -> tuple[int, int, int]:
    """Returns (slot_days, total_slots, cycle_days) with safe minimums."""
    slot_days = max(1, int(settings.get("smart_cycle_slot_days", 7) or 7))
    total_slots = max(1, int(settings.get("smart_cycle_total_slots", 4) or 4))
    cycle_days = slot_days * total_slots
    return slot_days, total_slots, cycle_days


def _compute_cycle_slot(cycle: dict, settings: dict, at_time: Optional[datetime] = None) -> int:
    """Compute 1-based slot position inside a cycle using configured slot window."""
    slot_days, total_slots, _ = _smart_cycle_window(settings)
    now = at_time or datetime.now(timezone.utc)
    try:
        started = datetime.fromisoformat(cycle["started_at"])
    except Exception:
        return 1
    elapsed_days = max(0, (now - started).days)
    return min(total_slots, (elapsed_days // slot_days) + 1)


def _slot_aligned_window(target_slot: int, settings: dict, at_time: Optional[datetime] = None) -> tuple[str, str]:
    """Build started/ends timestamps so 'now' falls into target_slot (1-based)."""
    slot_days, total_slots, cycle_days = _smart_cycle_window(settings)
    now = at_time or datetime.now(timezone.utc)
    slot = max(1, min(total_slots, int(target_slot or 1)))
    started = now - timedelta(days=(slot - 1) * slot_days)
    ends = started + timedelta(days=cycle_days)
    return started.isoformat(), ends.isoformat()

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def create_token(user_id: str, role: str) -> str:
    payload = {
        "user_id": user_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXP_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization token missing")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["user_id"]}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def get_optional_user(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    """Try to return the user from Authorization header, but return None when no token provided
    or when token is invalid. Use for guest-capable endpoints.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        return None
    user = await db.users.find_one({"id": payload["user_id"]}, {"_id": 0, "password": 0})
    return user

def require_role(*roles):
    async def checker(user: dict = Depends(get_current_user)):
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return checker

# ===================== MODELS =====================
Role = Literal["super_admin", "company_admin", "franchise", "partner", "leader", "member", "customer"]

class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    phone: str
    password: str
    sponsor_code: Optional[str] = None
    role: Optional[Role] = "member"

class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class PayoutDetailsRequest(BaseModel):
    bank_account_holder: Optional[str] = ""
    bank_name: Optional[str] = ""
    bank_branch: Optional[str] = ""
    bank_account_number: Optional[str] = ""
    bank_ifsc: Optional[str] = ""
    upi_id: Optional[str] = ""
    upi_qr_url: Optional[str] = ""

class KYCRequest(BaseModel):
    nid_number: str
    address: str
    date_of_birth: str
    document_url: Optional[str] = None

class WithdrawalRequest(BaseModel):
    amount: float
    method: str  # bank / bkash / nagad
    account_details: str

class ProductRequest(BaseModel):
    name: str
    category: str
    price: float
    bv: float = 0  # Business Volume
    stock: int = 0
    description: Optional[str] = ""
    image_url: Optional[str] = ""
    product_type: Literal["metho", "associate_partner"] = "metho"
    partner_id: Optional[str] = None  # links to Associate Partner (only for product_type=associate_partner)
    hidden: Optional[bool] = False  # Hide product from shop without deletion


class AssociatePartnerRequest(BaseModel):
    business_name: str
    business_type: str
    contact_person: str
    phone: str
    email: Optional[str] = ""
    address: str
    city: Optional[str] = ""
    state: Optional[str] = ""
    pincode: Optional[str] = ""
    gst_no: Optional[str] = ""
    commission_percent: float
    agreement_percent: Optional[float] = None
    upi_id: Optional[str] = ""
    whatsapp_no: Optional[str] = ""
    notes: Optional[str] = ""
    active: bool = True
    login_password: Optional[str] = None
    logo_url: Optional[str] = ""

class OrderItemReq(BaseModel):
    product_id: str
    quantity: int

class OrderRequest(BaseModel):
    items: List[OrderItemReq]
    shipping_address: str
    # Manual UPI payment fields — user submits at checkout
    payment_method: Optional[Literal["upi", "cod"]] = "upi"
    txn_id: Optional[str] = None
    payment_screenshot_url: Optional[str] = None
    payer_name: Optional[str] = None
    # Optional: attribute this purchase to an existing member id (for BV/rewards)
    member_id: Optional[str] = None
    member_code: Optional[str] = None

class ApproveRejectOrderRequest(BaseModel):
    reason: Optional[str] = None

class SettingsUpdate(BaseModel):
    # Smart Cycle Engine
    smart_cycle_bonus_percent: Optional[float] = None
    leader_match_percent: Optional[float] = None
    smart_cycle_days: Optional[int] = None
    smart_cycle_slot_days: Optional[int] = None
    smart_cycle_total_slots: Optional[int] = None
    # Partner Commission split — 5-bucket distribution (must total 100)
    partner_commission_percent: Optional[float] = None
    commission_split_member_pool: Optional[float] = None
    commission_split_leader_pool: Optional[float] = None
    commission_split_mps_fund: Optional[float] = None
    commission_split_company_fund: Optional[float] = None
    commission_split_technology_reserve: Optional[float] = None
    # Wallet
    min_withdrawal: Optional[float] = None
    # Team Business Cycle (monthly team target)
    cycle_target_bv: Optional[float] = None
    cycle_reward_text: Optional[str] = None
    # Rank thresholds
    rank_bronze_bv: Optional[float] = None
    rank_silver_bv: Optional[float] = None
    rank_gold_bv: Optional[float] = None
    rank_diamond_bv: Optional[float] = None
    # Branding
    company_name: Optional[str] = None
    currency_symbol: Optional[str] = None
    mission_statement: Optional[str] = None
    vision_statement: Optional[str] = None
    rules_and_conditions: Optional[str] = None
    return_policy: Optional[str] = None
    partner_agreement_policy: Optional[str] = None
    product_categories: Optional[List[str]] = None
    # Company GST / PAN for invoice
    company_gst_no: Optional[str] = None
    company_pan: Optional[str] = None
    # Invoice terms (admin-editable, shown on every invoice footer)
    invoice_terms: Optional[str] = None
    # UPI Payment Details
    upi_id: Optional[str] = None
    upi_qr_url: Optional[str] = None
    upi_payee_name: Optional[str] = None
    # Referral / WhatsApp invite message (supports {sponsor_code} & {referral_link} vars)
    referral_message_template: Optional[str] = None
    referral_signup_bonus: Optional[float] = None
    # First Partner-order cashback (member-only, one-time)
    first_partner_order_cashback_percent: Optional[float] = None
    first_partner_order_cashback_max: Optional[float] = None
    # === E-Invoice / IRN configuration ===
    einvoice_enabled: Optional[bool] = None
    einvoice_provider: Optional[str] = None
    einvoice_sandbox: Optional[bool] = None
    einvoice_api_url: Optional[str] = None
    einvoice_api_key: Optional[str] = None
    einvoice_client_id: Optional[str] = None
    einvoice_client_secret: Optional[str] = None
    einvoice_gstin: Optional[str] = None
    einvoice_username: Optional[str] = None
    einvoice_password: Optional[str] = None
    # === Branding Images (admin-controlled — used by landing / shop / PWA) ===
    site_logo_url: Optional[str] = None
    landing_hero_image_url: Optional[str] = None
    landing_tagline: Optional[str] = None
    landing_subheading: Optional[str] = None
    product_placeholder_image_url: Optional[str] = None
    directory_hero_image_url: Optional[str] = None
    social_share_image_url: Optional[str] = None
    # === Company Management / Achievers (Top Leaders) ===
    top_leader_1_name: Optional[str] = None
    top_leader_1_title: Optional[str] = None
    top_leader_1_image_url: Optional[str] = None
    top_leader_2_name: Optional[str] = None
    top_leader_2_title: Optional[str] = None
    top_leader_2_image_url: Optional[str] = None
    top_leader_3_name: Optional[str] = None
    top_leader_3_title: Optional[str] = None
    top_leader_3_image_url: Optional[str] = None
    # === Leader Eligibility (fully admin-defined, backend does NOT hardcode) ===
    leader_min_direct_members: Optional[int] = None
    leader_min_personal_product_sales: Optional[float] = None
    leader_min_active_members: Optional[int] = None
    leader_min_personal_monthly_purchase: Optional[float] = None
    leader_min_team_monthly_purchase: Optional[float] = None
    leader_min_active_days: Optional[int] = None
    # === MPS Fund Rules (fully admin-defined) ===
    mps_min_active_months: Optional[int] = None
    mps_min_monthly_purchase: Optional[float] = None
    mps_max_claim_amount: Optional[float] = None
    mps_min_claim_gap_days: Optional[int] = None
    mps_benefit_duration_months: Optional[int] = None


class AIUpgradePromptRequest(BaseModel):
    prompt: str = Field(..., min_length=10, max_length=4000)
    title: Optional[str] = None


class AIUpgradeStatusUpdateRequest(BaseModel):
    status: Literal["draft_plan", "approved_for_build", "needs_review", "rejected", "completed"]
    admin_note: Optional[str] = None

DEFAULT_SETTINGS = {
    # Smart Cycle Engine
    "smart_cycle_bonus_percent": 10.0,
    "leader_match_percent": 50.0,
    "smart_cycle_days": 28,
    "smart_cycle_slot_days": 7,
    "smart_cycle_total_slots": 4,
    # Partner Commission Pool 5-bucket split (Company Commission → 5 destinations)
    "partner_commission_percent": 10.0,  # Agreement % between company and partner (default 10%)
    "commission_split_member_pool": 40.0,
    "commission_split_leader_pool": 20.0,
    "commission_split_mps_fund": 10.0,
    "commission_split_company_fund": 20.0,
    "commission_split_technology_reserve": 10.0,
    # Wallet
    "min_withdrawal": 100.0,
    # Team Business Cycle (monthly)
    "cycle_target_bv": 10000.0,
    "cycle_reward_text": "₹5000 Bonus + Rank Upgrade",
    # Ranks
    "rank_bronze_bv": 5000.0,
    "rank_silver_bv": 20000.0,
    "rank_gold_bv": 50000.0,
    "rank_diamond_bv": 100000.0,
    # Branding
    "company_name": "METHO AAY-UPAY",
    "currency_symbol": "₹",
    "mission_statement": "সবার জন্য ন্যায্য আয় ও বিশ্বস্ত পণ্যভিত্তিক স্মার্ট কমিউনিটি তৈরি করা।",
    "vision_statement": "প্রান্তিক মানুষের ক্ষমতায়ন, ছোট ব্যবসাকে লোকাল থেকে গ্লোবালে রূপান্তর, এবং বিশেষ করে নারীদের টেকসই আর্থিক স্বাধীনতা গড়ে তোলাই আমাদের ভিশন।",
    "rules_and_conditions": (
        "1) সকল বোনাস/কমিশন সিস্টেম-ভিত্তিক নিয়ম অনুযায়ী প্রদান হবে।\n"
        "2) ভুয়া অর্ডার, জাল ডকুমেন্ট বা অপব্যবহার প্রমাণিত হলে অ্যাকাউন্ট স্থগিত হতে পারে।\n"
        "3) কোম্পানি প্রয়োজনে নীতিমালা আপডেট করতে পারবে এবং সেটিংস/নোটিশে তা জানাবে।"
    ),
    "return_policy": (
        "1) ডেলিভারির ৭ দিনের মধ্যে ডিফেক্টিভ/ভুল পণ্যের রিটার্ন রিকোয়েস্ট করা যাবে।\n"
        "2) ব্যবহৃত/ক্ষতিগ্রস্ত পণ্যে রিটার্ন প্রযোজ্য নয় (নীতিমালা সাপেক্ষে)।\n"
        "3) অনুমোদিত রিটার্নে নির্ধারিত সময়ে রিফান্ড/রিপ্লেসমেন্ট সম্পন্ন হবে।"
    ),
    "partner_agreement_policy": (
        "প্রতিটি Associate Partner-এর Agreement % আলাদাভাবে নির্ধারিত হবে এবং"
        " সেই হার অনুযায়ী কমিশন গণনা করা হবে।"
    ),
    "product_categories": [
        "Health & Wellness",
        "Beauty & Personal Care",
        "Home & Kitchen",
        "Nutrition",
        "Utilities",
    ],
    # UPI Payment (manual verify)
    "upi_id": "methopvtltd@paytm",
    "upi_qr_url": "",
    "upi_payee_name": "METHO Logistics Pvt Ltd",
    # Referral WhatsApp invite (edit from Settings; {sponsor_code} & {referral_link} are placeholders)
    "referral_message_template": (
        "🌟 আমি METHO AAY-UPAY-এ join হয়েছি — India-র নতুন Smart Cycle income platform 💰\n\n"
        "✅ Ayurvedic + Wellness products (100% original)\n"
        "✅ Buy করলেই Smart Cycle Bonus 10% + Leader Match 50%\n"
        "✅ Free registration · Wallet Day 1 থেকে active\n"
        "✅ Transparent 5-bucket reward engine\n\n"
        "আমার referral link দিয়ে register করুন 👇\n"
        "{referral_link}\n\n"
        "Sponsor code: {sponsor_code}"
    ),
    # Signup bonus — instantly credited to the sponsor's wallet when a new user registers under them
    "referral_signup_bonus": 50.0,
    # === First-Partner-Order Cashback (member-only, one-time) ===
    "first_partner_order_cashback_percent": 5.0,
    "first_partner_order_cashback_max": 100.0,
    # === E-Invoice IRN (GSTN / GSP) ===
    "einvoice_enabled": False,
    "einvoice_provider": "mock",  # "mock" | "generic_gsp" | "nic_direct"
    "einvoice_sandbox": True,
    "einvoice_api_url": "",  # e.g. https://api.mastersindia.co/api/v2/eInvoice
    "einvoice_api_key": "",
    "einvoice_client_id": "",
    "einvoice_client_secret": "",
    "einvoice_gstin": "",
    "einvoice_username": "",
    "einvoice_password": "",
    "einvoice_auth_token": "",  # cached auth token (updated on submit)
    "einvoice_auth_expires_at": "",
    "site_logo_url": "",
    "landing_hero_image_url": "",
    "landing_tagline": "Smart Cycle Income Platform — Buy · Earn · Grow",
    "landing_subheading": "India's transparent 5-bucket reward engine powered by METHO Logistics Pvt Ltd.",
    "product_placeholder_image_url": "",
    "directory_hero_image_url": "",
    "social_share_image_url": "",
    # === Company Management / Achievers (Top Leaders) ===
    "top_leader_1_name": "Top Leader 1",
    "top_leader_1_title": "National Achiever",
    "top_leader_1_image_url": "",
    "top_leader_2_name": "Top Leader 2",
    "top_leader_2_title": "Regional Achiever",
    "top_leader_2_image_url": "",
    "top_leader_3_name": "Top Leader 3",
    "top_leader_3_title": "Fastest Growing Leader",
    "top_leader_3_image_url": "",
    # === Leader Eligibility (all admin-configurable — 0 to disable) ===
    "leader_min_direct_members": 5,
    "leader_min_personal_product_sales": 5000.0,
    "leader_min_active_members": 3,
    "leader_min_personal_monthly_purchase": 5000.0,
    "leader_min_team_monthly_purchase": 50000.0,
    "leader_min_active_days": 30,
    # === MPS Fund Rules (all admin-configurable) ===
    "mps_min_active_months": 6,
    "mps_min_monthly_purchase": 1000.0,
    "mps_max_claim_amount": 100000.0,
    "mps_min_claim_gap_days": 90,
    "mps_benefit_duration_months": 12,
    # === Invoice defaults ===
    "company_gst_no": "19XXXXX0000X0Z0",
    "company_pan": "AAAAA0000A",
    "invoice_terms": (
        "1. Payments once made are non-refundable except as per company return policy.\n"
        "2. Delivery timelines are estimates; delays due to force majeure are excluded.\n"
        "3. All disputes subject to Kolkata jurisdiction only.\n"
        "4. Products under warranty per manufacturer terms.\n"
        "5. Tax-inclusive pricing. E&OE."
    ),
}

def normalize_product_categories(value) -> List[str]:
    if isinstance(value, list):
        raw_items = value
    elif isinstance(value, str):
        raw_items = value.replace("\n", "|").split("|") if "|" in value else value.split(",")
    else:
        raw_items = []
    cleaned = []
    for item in raw_items:
        text = str(item).strip()
        if text and text not in cleaned:
            cleaned.append(text)
    return cleaned or list(DEFAULT_SETTINGS["product_categories"])


def _detect_prompt_language(text: str) -> str:
    return "bangla" if any("\u0980" <= ch <= "\u09FF" for ch in text) else "english"


def _infer_change_type(prompt_lower: str) -> str:
    if any(word in prompt_lower for word in ["bug", "error", "fix", "repair", "issue", "broken", "fail"]):
        return "bugfix"
    if any(word in prompt_lower for word in ["add", "new", "create", "banan", "baniye", "jog", "jog korun"]):
        return "feature"
    if any(word in prompt_lower for word in ["change", "update", "modify", "edit", "improve", "upgrade"]):
        return "change"
    if any(word in prompt_lower for word in ["remove", "delete", "hide"]):
        return "cleanup"
    return "analysis"


def _infer_risk_level(prompt_lower: str) -> str:
    high_keywords = [
        "auth", "login", "password", "withdraw", "withdrawal", "settlement", "wallet",
        "payment", "commission", "jwt", "role", "permission", "delete database", "migration",
    ]
    moderate_keywords = [
        "product", "partner", "order", "admin", "settings", "profile", "upload", "category",
        "dashboard", "member", "claim",
    ]
    if any(word in prompt_lower for word in high_keywords):
        return "high"
    if any(word in prompt_lower for word in moderate_keywords):
        return "moderate"
    return "low"


def _infer_affected_areas(prompt_lower: str) -> List[str]:
    area_rules = [
        (["product", "category", "upload"], "Products / Catalog"),
        (["partner"], "Partners / Partner Approval"),
        (["order", "invoice", "checkout"], "Orders / Billing"),
        (["withdraw", "wallet"], "Wallet / Withdrawals"),
        (["settlement", "commission", "reward"], "Settlement / Rewards"),
        (["mps", "claim"], "MPS Claims"),
        (["member", "genealogy", "leaderboard"], "Members / Network"),
        (["login", "auth", "password", "role"], "Authentication / Access Control"),
        (["settings", "branding", "logo"], "Settings / Branding"),
        (["ai", "prompt", "agent"], "AI Upgrade Console"),
    ]
    areas = []
    for keywords, label in area_rules:
        if any(keyword in prompt_lower for keyword in keywords) and label not in areas:
            areas.append(label)
    return areas or ["Frontend Dashboard", "Backend API"]


def _build_recommended_steps(change_type: str, affected_areas: List[str], risk_level: str) -> List[str]:
    steps = [
        "Analyze the prompt and map it to affected dashboard/API modules.",
        "Create a minimal patch plan before touching code.",
    ]
    if any(area in affected_areas for area in ["Products / Catalog", "Partners / Partner Approval", "AI Upgrade Console"]):
        steps.append("Update the relevant admin UI and the matching API surface together.")
    if risk_level in ["moderate", "high"]:
        steps.append("Run targeted validation for the affected flow before approval.")
    if risk_level == "high":
        steps.append("Require explicit admin approval before deployment or data mutation.")
    return steps


def _build_validation_checks(affected_areas: List[str], risk_level: str) -> List[str]:
    checks = ["Frontend smoke check", "Backend endpoint smoke check"]
    if any(area in affected_areas for area in ["Authentication / Access Control", "Wallet / Withdrawals", "Settlement / Rewards"]):
        checks.append("Role/permission regression check")
    if any(area in affected_areas for area in ["Products / Catalog", "Partners / Partner Approval", "Orders / Billing"]):
        checks.append("Admin panel action-flow check")
    if risk_level == "high":
        checks.append("Manual approval gate before deploy")
    return checks


def _build_watchdog_actions(affected_areas: List[str]) -> List[str]:
    actions = ["Watch API failures", "Watch frontend error toasts"]
    if any(area in affected_areas for area in ["Wallet / Withdrawals", "Settlement / Rewards", "Orders / Billing"]):
        actions.append("Watch payment/finance endpoints for 4xx/5xx spikes")
    if any(area in affected_areas for area in ["Authentication / Access Control"]):
        actions.append("Watch login failure rate and permission denials")
    return actions


def _build_suggested_files(affected_areas: List[str]) -> List[str]:
    file_map = {
        "Products / Catalog": [
            "frontend/src/pages/dashboard/ProductsPage.jsx",
            "frontend/src/components/AddProductDialog.jsx",
            "backend/server.py",
        ],
        "Partners / Partner Approval": [
            "frontend/src/pages/dashboard/PartnersPage.jsx",
            "frontend/src/pages/dashboard/PartnerApprovalsPage.jsx",
            "backend/server.py",
        ],
        "Orders / Billing": [
            "frontend/src/pages/dashboard/OrdersPage.jsx",
            "frontend/src/components/UpiPaymentDialog.jsx",
            "backend/server.py",
        ],
        "Wallet / Withdrawals": [
            "frontend/src/pages/dashboard/WithdrawalsPage.jsx",
            "frontend/src/pages/dashboard/WalletPage.jsx",
            "backend/server.py",
        ],
        "Settlement / Rewards": [
            "frontend/src/pages/dashboard/MonthlySettlementPage.jsx",
            "frontend/src/pages/dashboard/SmartCyclePage.jsx",
            "backend/server.py",
        ],
        "MPS Claims": [
            "frontend/src/pages/dashboard/MPSClaimsPage.jsx",
            "backend/server.py",
        ],
        "Members / Network": [
            "frontend/src/pages/dashboard/MembersPage.jsx",
            "frontend/src/pages/dashboard/GenealogyPage.jsx",
            "backend/server.py",
        ],
        "Authentication / Access Control": [
            "frontend/src/contexts/AuthContext.jsx",
            "frontend/src/pages/LoginPage.jsx",
            "backend/server.py",
        ],
        "Settings / Branding": [
            "frontend/src/pages/dashboard/SettingsPage.jsx",
            "frontend/src/contexts/SettingsContext.jsx",
            "backend/server.py",
        ],
        "AI Upgrade Console": [
            "frontend/src/pages/dashboard/AIUpgradePage.jsx",
            "frontend/src/layouts/DashboardLayout.jsx",
            "backend/server.py",
        ],
    }
    files = []
    for area in affected_areas:
        for path in file_map.get(area, []):
            if path not in files:
                files.append(path)
    return files or ["frontend/src/App.js", "backend/server.py"]


def _build_implementation_brief(change_type: str, affected_areas: List[str], risk_level: str) -> List[str]:
    brief = [
        "Start with the owning UI/API surfaces instead of broad repo changes.",
        "Keep the first patch minimal and validate immediately after the edit.",
    ]
    if any(area in affected_areas for area in ["Products / Catalog", "Partners / Partner Approval", "Orders / Billing"]):
        brief.append("Align dashboard UI actions with matching backend endpoints and permissions.")
    if any(area in affected_areas for area in ["Authentication / Access Control", "Wallet / Withdrawals", "Settlement / Rewards"]):
        brief.append("Prefer additive safeguards over silent behavior changes because this is operationally sensitive.")
    if change_type == "bugfix":
        brief.append("Reproduce the failure first, then fix the controlling code path, then rerun the same check.")
    if risk_level == "high":
        brief.append("Do not deploy directly from prompt output without explicit review and rollback readiness.")
    return brief


def _build_draft_patch_preview(prompt: str, affected_areas: List[str], suggested_files: List[str], risk_level: str) -> List[dict]:
    prompt_lower = prompt.lower()
    preview = []
    for file_path in suggested_files[:5]:
        changes = []
        if file_path.endswith("server.py"):
            changes.append("Adjust or add backend endpoint logic that directly controls the requested behavior.")
            if any(word in prompt_lower for word in ["auth", "login", "permission", "role", "otp"]):
                changes.append("Add request validation or permission checks before state mutation.")
            if any(word in prompt_lower for word in ["report", "history", "dashboard", "summary"]):
                changes.append("Return additional structured fields needed by the admin UI.")
        elif file_path.endswith("Page.jsx"):
            changes.append("Update the visible admin/member page to expose the new workflow or data.")
            if any(word in prompt_lower for word in ["button", "approve", "reject", "upload", "filter"]):
                changes.append("Add or refine the relevant action controls and loading/error states.")
            if any(word in prompt_lower for word in ["report", "summary", "dashboard", "health"]):
                changes.append("Render the new sections/cards required by the prompt.")
        elif file_path.endswith("Dialog.jsx") or file_path.endswith("Form.jsx"):
            changes.append("Extend the dialog/form fields and client-side validation to capture the new inputs.")
        elif file_path.endswith("Context.jsx"):
            changes.append("Adjust shared context state so the new flow remains consistent across pages.")
        else:
            changes.append("Apply a focused change in this file to support the requested behavior.")

        if risk_level == "high":
            changes.append("Preserve existing behavior behind explicit approval/confirmation where possible.")

        preview.append({
            "file": file_path,
            "purpose": f"Patch preview for {file_path.split('/')[-1]}",
            "planned_changes": changes,
            "pseudo_diff": [
                f"- existing behavior in {file_path.split('/')[-1]}",
                f"+ targeted changes derived from prompt: {prompt[:120]}",
            ],
        })
    return preview


def _build_draft_patch_notes(change_type: str, risk_level: str) -> List[str]:
    notes = [
        "This is a planning preview, not an applied code patch.",
        "A real implementation should validate one touched slice immediately after the first edit.",
    ]
    if change_type == "bugfix":
        notes.append("Prefer reproducing the bug and fixing the controlling code path before broad edits.")
    if risk_level == "high":
        notes.append("High-risk requests should keep an approval gate and rollback plan before deploy.")
    return notes


def _build_test_preview(affected_areas: List[str], validation_checks: List[str], risk_level: str) -> List[dict]:
    preview = [
        {
            "name": "Frontend smoke check",
            "scope": "UI render and primary action controls",
            "why": "Confirms the touched screen still loads and the main controls remain visible.",
        },
        {
            "name": "Backend endpoint smoke check",
            "scope": "Touched API endpoints and response shape",
            "why": "Confirms the backend slice still accepts requests and returns expected fields.",
        },
    ]
    if "Role/permission regression check" in validation_checks:
        preview.append({
            "name": "Role/permission regression check",
            "scope": "Admin/member/partner access boundaries",
            "why": "Sensitive flows must not widen access during implementation.",
        })
    if "Admin panel action-flow check" in validation_checks:
        preview.append({
            "name": "Admin panel action-flow check",
            "scope": ", ".join(affected_areas[:3]) or "Admin workflow",
            "why": "Verifies that approve/reject/create actions still work end-to-end.",
        })
    if risk_level == "high":
        preview.append({
            "name": "Manual approval gate before deploy",
            "scope": "Release review and rollback readiness",
            "why": "High-risk flows require explicit review before deployment.",
        })
    return preview


def _build_ai_upgrade_plan(payload: AIUpgradePromptRequest, admin: dict) -> dict:
    prompt = payload.prompt.strip()
    prompt_lower = prompt.lower()
    title = (payload.title or prompt[:72]).strip()
    change_type = _infer_change_type(prompt_lower)
    risk_level = _infer_risk_level(prompt_lower)
    affected_areas = _infer_affected_areas(prompt_lower)
    suggested_files = _build_suggested_files(affected_areas)
    return {
        "id": str(uuid.uuid4()),
        "title": title,
        "prompt": prompt,
        "language": _detect_prompt_language(prompt),
        "change_type": change_type,
        "risk_level": risk_level,
        "status": "draft_plan",
        "affected_areas": affected_areas,
        "recommended_steps": _build_recommended_steps(change_type, affected_areas, risk_level),
        "validation_checks": _build_validation_checks(affected_areas, risk_level),
        "watchdog_actions": _build_watchdog_actions(affected_areas),
        "suggested_files": suggested_files,
        "implementation_brief": _build_implementation_brief(change_type, affected_areas, risk_level),
        "draft_patch_preview": [],
        "draft_patch_notes": [],
        "test_preview": [],
        "draft_patch_generated_at": None,
        "summary": f"This prompt is classified as a {risk_level}-risk {change_type} request affecting {', '.join(affected_areas)}.",
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "created_by": admin["id"],
        "created_by_name": admin.get("name"),
        "admin_note": "",
    }


def _normalize_ai_upgrade_doc(doc: dict) -> dict:
    if not doc:
        return doc
    prompt = (doc.get("prompt") or "").strip()
    prompt_lower = prompt.lower()
    affected_areas = doc.get("affected_areas") or _infer_affected_areas(prompt_lower)
    change_type = doc.get("change_type") or _infer_change_type(prompt_lower)
    risk_level = doc.get("risk_level") or _infer_risk_level(prompt_lower)
    doc["language"] = doc.get("language") or _detect_prompt_language(prompt)
    doc["change_type"] = change_type
    doc["risk_level"] = risk_level
    doc["status"] = doc.get("status") or "draft_plan"
    doc["affected_areas"] = affected_areas
    doc["recommended_steps"] = doc.get("recommended_steps") or _build_recommended_steps(change_type, affected_areas, risk_level)
    doc["validation_checks"] = doc.get("validation_checks") or _build_validation_checks(affected_areas, risk_level)
    doc["watchdog_actions"] = doc.get("watchdog_actions") or _build_watchdog_actions(affected_areas)
    doc["suggested_files"] = doc.get("suggested_files") or _build_suggested_files(affected_areas)
    doc["implementation_brief"] = doc.get("implementation_brief") or _build_implementation_brief(change_type, affected_areas, risk_level)
    doc["draft_patch_preview"] = doc.get("draft_patch_preview") or []
    doc["draft_patch_notes"] = doc.get("draft_patch_notes") or []
    doc["test_preview"] = doc.get("test_preview") or []
    doc["draft_patch_generated_at"] = doc.get("draft_patch_generated_at")
    doc["admin_note"] = doc.get("admin_note") or ""
    doc["updated_at"] = doc.get("updated_at") or doc.get("created_at") or now_iso()
    return doc

async def get_settings() -> dict:
    doc = await db.settings.find_one({"id": "global"}, {"_id": 0})
    if not doc:
        doc = {"id": "global", **DEFAULT_SETTINGS, "updated_at": now_iso()}
        await db.settings.insert_one(doc.copy())
    # Ensure all defaults present
    for k, v in DEFAULT_SETTINGS.items():
        if doc.get(k) is None:
            doc[k] = v
    if doc.get("leader_min_personal_product_sales") is None:
        doc["leader_min_personal_product_sales"] = float(doc.get("leader_min_personal_monthly_purchase") or 0)
    if doc.get("leader_min_personal_monthly_purchase") is None:
        doc["leader_min_personal_monthly_purchase"] = float(doc.get("leader_min_personal_product_sales") or 0)
    slot_days, total_slots, cycle_days = _smart_cycle_window(doc)
    doc["smart_cycle_slot_days"] = slot_days
    doc["smart_cycle_total_slots"] = total_slots
    doc["smart_cycle_days"] = cycle_days
    doc["product_categories"] = normalize_product_categories(doc.get("product_categories"))
    doc.pop("_id", None)
    return doc

# ===================== AUTH ROUTES =====================
@api_router.post("/auth/register")
async def register(req: RegisterRequest):
    email = str(req.email).strip().lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user_id = str(uuid.uuid4())
    # Generate member code like MTH-XXXXX
    member_code = f"MTH-{str(uuid.uuid4().int)[:6]}"

    # Verify sponsor
    sponsor_id = None
    if req.sponsor_code:
        sp = await db.users.find_one({"member_code": req.sponsor_code})
        if sp:
            sponsor_id = sp["id"]

    user_doc = {
        "id": user_id,
        "name": req.name,
        "email": email,
        "phone": req.phone,
        "password": hash_password(req.password),
        "role": "member",  # public register is always member; admin roles are set separately
        "member_code": member_code,
        "sponsor_id": sponsor_id,
        "sponsor_code": req.sponsor_code,
        "kyc_status": "pending",
        "rank": "Starter",
        "active": True,
        "created_at": now_iso(),
    }
    await db.users.insert_one(user_doc)
    user_doc.pop("_id", None)

    # Create wallet
    await db.wallets.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "balance": 0.0,
        "total_income": 0.0,
        "total_bonus": 0.0,
        "total_withdrawn": 0.0,
        "member_value_points": 0.0,
        "elite_leader_points": 0.0,
        "mps_shield_balance": 0.0,
        "created_at": now_iso(),
    })

    token = create_token(user_id, user_doc["role"])

    # === Referral Signup Bonus — instant sponsor wallet credit ===
    if sponsor_id:
        settings = await get_settings()
        bonus = float(settings.get("referral_signup_bonus") or 0)
        if bonus > 0:
            await db.wallets.update_one(
                {"user_id": sponsor_id},
                {"$inc": {"balance": bonus, "total_bonus": bonus, "total_income": bonus}},
            )
            await db.wallet_transactions.insert_one({
                "id": str(uuid.uuid4()),
                "user_id": sponsor_id,
                "type": "referral_signup_bonus",
                "amount": bonus,
                "description": f"Referral signup bonus — {req.name} joined under you",
                "ref_user_id": user_id,
                "created_at": now_iso(),
            })

    return {
        "token": token,
        "user": {k: v for k, v in user_doc.items() if k != "password"},
    }

@api_router.post("/auth/login")
async def login(req: LoginRequest):
    email = str(req.email).strip().lower()
    user = await db.users.find_one({"email": email})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    is_valid = verify_password(req.password, user["password"])
    print(f"Login attempt for {email} - Password valid: {is_valid}")
    
    if not is_valid:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Account deactivated")
    token = create_token(user["id"], user["role"])
    user.pop("password", None)
    user.pop("_id", None)
    return {"token": token, "user": user}


@api_router.get("/auth/sponsor-info/{code}")
async def sponsor_info(code: str):
    """Public lookup — returns the sponsor's display name + code so referred users can confirm they're joining under the right person. NEVER exposes email/phone."""
    sp = await db.users.find_one({"member_code": code, "active": True}, {"_id": 0})
    if not sp:
        raise HTTPException(status_code=404, detail="Sponsor code not found")
    return {
        "member_code": sp.get("member_code"),
        "name": sp.get("name"),
        "rank": sp.get("rank", "Starter"),
    }

@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@api_router.get("/auth/payout-details")
async def get_my_payout_details(user: dict = Depends(get_current_user)):
    """Return member's saved payout details (bank + UPI)."""
    full_user = await db.users.find_one({"id": user["id"]}, {"_id": 0}) or {}
    return {
        "bank_account_holder": full_user.get("bank_account_holder", ""),
        "bank_name": full_user.get("bank_name", ""),
        "bank_branch": full_user.get("bank_branch", ""),
        "bank_account_number": full_user.get("bank_account_number", ""),
        "bank_ifsc": full_user.get("bank_ifsc", ""),
        "upi_id": full_user.get("upi_id", ""),
        "upi_qr_url": full_user.get("upi_qr_url", ""),
    }


@api_router.put("/auth/payout-details")
async def update_my_payout_details(req: PayoutDetailsRequest, user: dict = Depends(get_current_user)):
    """Save member payout details for withdrawal convenience."""
    payload = {
        "bank_account_holder": (req.bank_account_holder or "").strip(),
        "bank_name": (req.bank_name or "").strip(),
        "bank_branch": (req.bank_branch or "").strip(),
        "bank_account_number": (req.bank_account_number or "").strip(),
        "bank_ifsc": (req.bank_ifsc or "").strip().upper(),
        "upi_id": (req.upi_id or "").strip(),
        "upi_qr_url": (req.upi_qr_url or "").strip(),
        "payout_details_updated_at": now_iso(),
    }
    await db.users.update_one({"id": user["id"]}, {"$set": payload})
    return {"success": True, **payload}

# ===================== FORGOT / RESET PASSWORD =====================
EMAIL_FROM_NAME = os.environ.get('EMAIL_FROM_NAME', 'METHO AAY-UPAY')
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:3000')

class ForgotRequest(BaseModel):
    email: EmailStr

class ResetRequest(BaseModel):
    token: str
    new_password: str

async def send_transactional_email(to: str, subject: str, html: str) -> bool:
    logger.warning("Transactional email disabled. Email send skipped.")
    return False

@api_router.post("/auth/forgot-password")
async def forgot_password(req: ForgotRequest):
    # Always return success (don't leak whether email exists)
    email = str(req.email).strip().lower()
    user = await db.users.find_one({"email": email})
    if user:
        token = jwt.encode(
            {"user_id": user["id"], "purpose": "password_reset",
             "exp": datetime.now(timezone.utc) + timedelta(minutes=15)},
            JWT_SECRET, algorithm=JWT_ALGORITHM,
        )
        reset_link = f"{FRONTEND_URL}/reset-password?token={token}"
        html = f"""
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:40px 0;font-family:Arial,sans-serif">
          <tr><td align="center">
            <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:40px;border:1px solid #e5e7eb">
              <tr><td>
                <h1 style="color:#0b3d2e;margin:0 0 8px;font-size:24px">METHO AAY-UPAY™</h1>
                <p style="color:#4b5563;margin:0 0 24px">Password Reset Request</p>
                <p style="color:#111827;font-size:15px;line-height:1.6">Hi {user.get('name','there')},</p>
                <p style="color:#111827;font-size:15px;line-height:1.6">আপনি password reset request করেছেন। নিচের button-এ click করে নতুন password set করুন। এই link ১৫ মিনিটের জন্য valid।</p>
                <p style="color:#111827;font-size:15px;line-height:1.6">You requested a password reset. Click the button below to set a new password. This link is valid for 15 minutes.</p>
                <table cellpadding="0" cellspacing="0" style="margin:28px 0">
                  <tr><td style="border-radius:24px;background:#065f46">
                    <a href="{reset_link}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;border-radius:24px">Reset Password</a>
                  </td></tr>
                </table>
                <p style="color:#6b7280;font-size:13px;line-height:1.6">অথবা এই link browser-এ paste করুন:<br /><span style="color:#065f46;word-break:break-all">{reset_link}</span></p>
                <p style="color:#9ca3af;font-size:12px;margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb">If you didn't request this, safely ignore this email. Your password will not change.</p>
                <p style="color:#9ca3af;font-size:12px;margin:8px 0 0">© METHO Logistics Pvt. Ltd. · India</p>
              </td></tr>
            </table>
          </td></tr>
        </table>"""
        await send_transactional_email(user["email"], "METHO Password Reset", html)
        # Also store token hash in DB for one-time-use tracking
        await db.password_reset_tokens.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "token_hash": hash_password(token),
            "used": False,
            "created_at": now_iso(),
        })
    return {"success": True, "message": "If an account exists, a reset link has been sent."}

@api_router.post("/auth/reset-password")
async def reset_password(req: ResetRequest):
    try:
        payload = jwt.decode(req.token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=400, detail="Reset link has expired. Please request a new one.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=400, detail="Invalid reset link.")
    if payload.get("purpose") != "password_reset":
        raise HTTPException(status_code=400, detail="Invalid token purpose")
    if len(req.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    user_id = payload["user_id"]
    # Check token wasn't already used
    tokens = await db.password_reset_tokens.find({"user_id": user_id, "used": False}).to_list(20)
    match = None
    for t in tokens:
        if verify_password(req.token, t["token_hash"]):
            match = t
            break
    if not match:
        raise HTTPException(status_code=400, detail="Reset link already used or invalid.")
    # Update password
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"password": hash_password(req.new_password), "password_updated_at": now_iso()}},
    )
    await db.password_reset_tokens.update_one(
        {"id": match["id"]},
        {"$set": {"used": True, "used_at": now_iso()}},
    )
    return {"success": True, "message": "Password reset successful. Please log in."}

# ===================== MEMBERS =====================
@api_router.get("/members")
async def list_members(user: dict = Depends(get_current_user)):
    # Admins see all; others see their downline
    query = {} if user["role"] in ("super_admin", "company_admin") else {"sponsor_id": user["id"]}
    members = await db.users.find(query, {"_id": 0, "password": 0}).to_list(500)
    return members

@api_router.post("/auth/change-password")
async def change_password(
    payload: dict = Body(...),
    user: dict = Depends(get_current_user),
):
    """Logged-in user changes their own password. Requires current_password + new_password."""
    current_password = (payload.get("current_password") or "").strip()
    new_password = (payload.get("new_password") or "").strip()
    if not current_password or not new_password:
        raise HTTPException(status_code=400, detail="current_password and new_password required")
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    # Re-fetch the full user document — get_current_user strips out password
    full_user = await db.users.find_one({"id": user["id"]})
    stored = (full_user or {}).get("password") or ""
    if not stored or not verify_password(current_password, stored):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if verify_password(new_password, stored):
        raise HTTPException(status_code=400, detail="New password must be different from current password")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password": hash_password(new_password), "password_changed_at": now_iso()}},
    )
    return {"success": True, "message": "Password changed successfully"}


@api_router.post("/admin/users/{user_id}/toggle-active")
async def admin_toggle_user_active(
    user_id: str,
    admin: dict = Depends(require_role("super_admin", "company_admin")),
):
    """Admin activates or deactivates any member/partner. Deactivated users cannot login."""
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "active": 1, "name": 1, "role": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") in ("super_admin", "company_admin"):
        raise HTTPException(status_code=403, detail="Cannot deactivate an admin account")
    new_state = not bool(target.get("active", True))
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"active": new_state, "status_changed_by": admin["id"], "status_changed_at": now_iso()}},
    )
    await log_admin_action(
        admin,
        action="user_toggle_active",
        module="users",
        summary=f"Set user {target.get('name') or user_id} active={new_state}",
        target_id=user_id,
        metadata={"active": new_state, "user_name": target.get("name"), "user_role": target.get("role")},
    )
    return {"success": True, "user_id": user_id, "active": new_state, "user_name": target.get("name")}


@api_router.delete("/admin/members/{user_id}")
async def delete_member_permanent(
    user_id: str,
    admin: dict = Depends(require_role("super_admin", "company_admin")),
):
    """Permanently delete a member account. Cannot delete admin accounts."""
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "role": 1, "name": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") in ("super_admin", "company_admin"):
        raise HTTPException(status_code=403, detail="Cannot delete an admin account")
    await db.users.delete_one({"id": user_id})
    return {"success": True, "deleted": user_id, "name": target.get("name")}


@api_router.post("/admin/users/{user_id}/reset-password")
async def admin_reset_user_password(
    user_id: str,
    payload: dict = Body(default={}),
    admin: dict = Depends(require_role("super_admin", "company_admin")),
):
    """Admin resets ANY user's (member/partner/leader) password. Returns the new password.
    If payload has {"new_password": "..."} that value is used; otherwise a random one is generated."""
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    new_password = (payload.get("new_password") or "").strip()
    if new_password:
        if len(new_password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    else:
        import secrets, string
        alphabet = string.ascii_letters + string.digits
        new_password = "".join(secrets.choice(alphabet) for _ in range(10))
    await db.users.update_one(
        {"id": user_id},
        {"$set": {
            "password": hash_password(new_password),
            "password_reset_by_admin": admin["id"],
            "password_reset_at": now_iso(),
        }},
    )
    return {
        "success": True,
        "user_id": user_id,
        "user_email": target.get("email"),
        "user_name": target.get("name"),
        "new_password": new_password,
        "note": "Share this password with the user via a secure channel; encourage them to change it on next login.",
    }



@api_router.get("/members/{member_id}")
async def get_member(member_id: str, user: dict = Depends(get_current_user)):
    m = await db.users.find_one({"id": member_id}, {"_id": 0, "password": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")
    return m

# ===================== KYC =====================
@api_router.post("/kyc/submit")
async def submit_kyc(req: KYCRequest, user: dict = Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "nid_number": req.nid_number,
        "address": req.address,
        "date_of_birth": req.date_of_birth,
        "document_url": req.document_url,
        "status": "pending",
        "submitted_at": now_iso(),
    }
    await db.kyc.update_one({"user_id": user["id"]}, {"$set": doc}, upsert=True)
    await db.users.update_one({"id": user["id"]}, {"$set": {"kyc_status": "pending"}})
    return {"success": True, "kyc": doc}

@api_router.get("/kyc/me")
async def my_kyc(user: dict = Depends(get_current_user)):
    kyc = await db.kyc.find_one({"user_id": user["id"]}, {"_id": 0})
    return kyc or {"status": "not_submitted"}

@api_router.post("/kyc/{user_id}/approve")
async def approve_kyc(user_id: str, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    await db.kyc.update_one({"user_id": user_id}, {"$set": {"status": "approved", "reviewed_at": now_iso()}})
    await db.users.update_one({"id": user_id}, {"$set": {"kyc_status": "approved"}})
    return {"success": True}

# ===================== WALLET =====================
@api_router.get("/wallet")
async def get_wallet(user: dict = Depends(get_current_user)):
    w = await db.wallets.find_one({"user_id": user["id"]}, {"_id": 0})
    if not w:
        w = {"id": str(uuid.uuid4()), "user_id": user["id"], "balance": 0, "total_income": 0, "total_bonus": 0, "total_withdrawn": 0,
             "member_value_points": 0, "elite_leader_points": 0, "mps_shield_balance": 0}
        await db.wallets.insert_one({**w, "created_at": now_iso()})
    # Ensure all reward fields exist for legacy wallets
    for k in ("member_value_points", "elite_leader_points", "mps_shield_balance"):
        if k not in w or w[k] is None:
            w[k] = 0.0
    return w

@api_router.get("/wallet/transactions")
async def wallet_transactions(user: dict = Depends(get_current_user)):
    txs = await db.wallet_transactions.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return txs

@api_router.post("/wallet/withdraw")
async def request_withdrawal(req: WithdrawalRequest, user: dict = Depends(get_current_user)):
    settings = await get_settings()
    min_wd = settings["min_withdrawal"]
    if req.amount < min_wd:
        raise HTTPException(status_code=400, detail=f"Minimum withdrawal ₹{min_wd:g}")
    wallet = await db.wallets.find_one({"user_id": user["id"]})
    if not wallet or wallet["balance"] < req.amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")
    wd = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "amount": req.amount,
        "method": req.method,
        "account_details": req.account_details,
        "status": "pending",
        "created_at": now_iso(),
    }
    await db.withdrawals.insert_one(wd)
    # Freeze balance
    await db.wallets.update_one({"user_id": user["id"]}, {"$inc": {"balance": -req.amount, "total_withdrawn": req.amount}})
    await db.wallet_transactions.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "type": "withdrawal",
        "amount": -req.amount,
        "description": f"Withdrawal request via {req.method}",
        "created_at": now_iso(),
    })
    wd.pop("_id", None)
    return wd

@api_router.get("/wallet/withdrawals")
async def my_withdrawals(user: dict = Depends(get_current_user)):
    ws = await db.withdrawals.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return ws


# ===================== ADMIN WITHDRAWAL QUEUE =====================
class WithdrawalDecisionRequest(BaseModel):
    reason: Optional[str] = None
    utr: Optional[str] = None  # bank transaction reference

@api_router.get("/admin/withdrawals")
async def admin_list_withdrawals(
    status_filter: Optional[str] = None,
    admin: dict = Depends(require_role("super_admin", "company_admin")),
):
    query = {}
    if status_filter:
        query["status"] = status_filter
    docs = await db.withdrawals.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    # attach user summary
    for w in docs:
        u = await db.users.find_one({"id": w["user_id"]}, {"_id": 0, "name": 1, "member_code": 1, "phone": 1, "email": 1}) or {}
        w["user_name"] = u.get("name")
        w["user_member_code"] = u.get("member_code")
        w["user_phone"] = u.get("phone")
        w["user_email"] = u.get("email")
    return docs


@api_router.post("/admin/withdrawals/{withdrawal_id}/approve")
async def admin_approve_withdrawal(withdrawal_id: str, req: WithdrawalDecisionRequest, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    wd = await db.withdrawals.find_one({"id": withdrawal_id})
    if not wd:
        raise HTTPException(status_code=404, detail="Withdrawal not found")
    if wd.get("status") != "pending":
        raise HTTPException(status_code=400, detail=f"Cannot approve — status is {wd.get('status')}")
    await db.withdrawals.update_one(
        {"id": withdrawal_id},
        {"$set": {
            "status": "approved",
            "approved_by": admin["id"],
            "approved_at": now_iso(),
            "utr": req.utr or "",
            "admin_note": req.reason or "",
        }},
    )
    await db.wallet_transactions.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": wd["user_id"],
        "type": "withdrawal_approved",
        "amount": 0,  # already deducted on request
        "description": f"Withdrawal ₹{wd['amount']} paid via {wd.get('method')} (UTR: {req.utr or '—'})",
        "ref_withdrawal_id": withdrawal_id,
        "created_at": now_iso(),
    })
    await log_admin_action(
        admin,
        action="withdrawal_approve",
        module="withdrawals",
        summary=f"Approved withdrawal {withdrawal_id} for user {wd['user_id']}",
        target_id=withdrawal_id,
        metadata={"user_id": wd["user_id"], "amount": wd.get("amount"), "utr": req.utr or "", "method": wd.get("method")},
    )
    return {"success": True, "withdrawal_id": withdrawal_id, "status": "approved"}


@api_router.post("/admin/withdrawals/{withdrawal_id}/reject")
async def admin_reject_withdrawal(withdrawal_id: str, req: WithdrawalDecisionRequest, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    wd = await db.withdrawals.find_one({"id": withdrawal_id})
    if not wd:
        raise HTTPException(status_code=404, detail="Withdrawal not found")
    if wd.get("status") != "pending":
        raise HTTPException(status_code=400, detail=f"Cannot reject — status is {wd.get('status')}")
    # Refund the frozen amount back to wallet
    await db.wallets.update_one(
        {"user_id": wd["user_id"]},
        {"$inc": {"balance": wd["amount"], "total_withdrawn": -wd["amount"]}},
    )
    await db.withdrawals.update_one(
        {"id": withdrawal_id},
        {"$set": {
            "status": "rejected",
            "rejected_by": admin["id"],
            "rejected_at": now_iso(),
            "rejection_reason": req.reason or "Not approved",
        }},
    )
    await db.wallet_transactions.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": wd["user_id"],
        "type": "withdrawal_refund",
        "amount": wd["amount"],
        "description": f"Withdrawal rejected — amount refunded ({req.reason or 'Not approved'})",
        "ref_withdrawal_id": withdrawal_id,
        "created_at": now_iso(),
    })
    await log_admin_action(
        admin,
        action="withdrawal_reject",
        module="withdrawals",
        summary=f"Rejected withdrawal {withdrawal_id} for user {wd['user_id']}",
        target_id=withdrawal_id,
        metadata={"user_id": wd["user_id"], "amount": wd.get("amount"), "reason": req.reason or "Not approved", "method": wd.get("method")},
    )
    return {"success": True, "withdrawal_id": withdrawal_id, "status": "rejected"}


# ===================== REFERRAL LEADERBOARD =====================
@api_router.get("/leaderboard/referrals")
async def referral_leaderboard(
    period: Optional[str] = None,  # 'all' (default), 'month', 'week'
    limit: int = 20,
):
    """Top recruiters by number of direct referrals. Public — visible to all logged-in members."""
    now = datetime.now(timezone.utc)
    match = {"sponsor_id": {"$ne": None, "$exists": True}}
    if period == "month":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        match["created_at"] = {"$gte": start.isoformat()}
    elif period == "week":
        # Monday 00:00 of current week
        start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        match["created_at"] = {"$gte": start.isoformat()}
    pipeline = [
        {"$match": match},
        {"$group": {"_id": "$sponsor_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": max(1, min(int(limit or 20), 100))},
    ]
    rows = await db.users.aggregate(pipeline).to_list(200)
    out = []
    for r in rows:
        sp = await db.users.find_one({"id": r["_id"]}, {"_id": 0, "name": 1, "member_code": 1, "rank": 1}) or {}
        # Total wallet bonus earned from referrals (informational)
        bonus_agg = await db.wallet_transactions.aggregate([
            {"$match": {"user_id": r["_id"], "type": "referral_signup_bonus"}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
        ]).to_list(1)
        total_bonus = bonus_agg[0]["total"] if bonus_agg else 0
        out.append({
            "user_id": r["_id"],
            "name": sp.get("name") or "—",
            "member_code": sp.get("member_code") or "",
            "rank": sp.get("rank") or "Starter",
            "referral_count": r["count"],
            "total_bonus_earned": round(float(total_bonus), 2),
        })
    return {"period": period or "all", "leaders": out}


@api_router.get("/leaderboard/rank-ups")
async def rank_up_feed(period: Optional[str] = None, limit: int = 20):
    """Recent rank promotions — public feed for the Leaderboard celebration section."""
    now = datetime.now(timezone.utc)
    match = {}
    if period == "week":
        start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        match["created_at"] = {"$gte": start.isoformat()}
    elif period == "month":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        match["created_at"] = {"$gte": start.isoformat()}
    docs = await db.rank_history.find(match, {"_id": 0}).sort("created_at", -1).to_list(max(1, min(int(limit or 20), 100)))
    return {"period": period or "all", "promotions": docs}


@api_router.post("/admin/rank/recompute")
async def admin_rank_recompute(admin: dict = Depends(require_role("super_admin", "company_admin"))):
    """Admin utility — recompute ranks for every member; used after changing rank thresholds in Settings.
    Any resulting promotions are logged to rank_history and will appear on the Leaderboard feed."""
    users = await db.users.find({"role": {"$in": ["member", "leader", None]}}, {"_id": 0, "id": 1}).to_list(5000)
    promoted = 0
    scanned = 0
    for u in users:
        scanned += 1
        ev = await maybe_promote_user(u["id"])
        if ev:
            promoted += 1
    return {"success": True, "scanned": scanned, "promoted": promoted}


# ===================== PRODUCTS =====================
@api_router.get("/products")
async def list_products():
    # Public: only approved and non-hidden products (or legacy with unset status)
    all_docs = await db.products.find({}, {"_id": 0}).to_list(500)
    visible = [p for p in all_docs if p.get("approval_status") in (None, "", "approved") and not p.get("hidden", False)]
    for p in visible:
        if not p.get("product_type"):
            p["product_type"] = "metho"
    return visible
@api_router.post("/products")
async def create_product(req: ProductRequest, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    # Admin-created products are auto-approved
    p = {"id": str(uuid.uuid4()), **req.model_dump(), "approval_status": "approved", "approved_by": admin["id"], "approved_at": now_iso(), "created_at": now_iso()}
    await db.products.insert_one(p)
    p.pop("_id", None)
    await log_admin_action(
        admin,
        action="product_create",
        module="products",
        summary=f"Created product {p.get('name')}",
        target_id=p["id"],
        metadata={"name": p.get("name"), "category": p.get("category"), "product_type": p.get("product_type"), "price": p.get("price")},
    )
    return p

@api_router.put("/products/{product_id}")
async def update_product(product_id: str, req: ProductRequest, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    existing = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Product not found")
    update_fields = {**req.model_dump(), "updated_at": now_iso()}
    await db.products.update_one({"id": product_id}, {"$set": update_fields})
    updated = await db.products.find_one({"id": product_id}, {"_id": 0})
    await log_admin_action(
        admin,
        action="product_update",
        module="products",
        summary=f"Updated product {updated.get('name')}",
        target_id=product_id,
        metadata={"name": updated.get("name"), "category": updated.get("category"), "product_type": updated.get("product_type"), "price": updated.get("price")},
    )
    return updated

@api_router.patch("/products/{product_id}")
async def patch_product(product_id: str, updates: dict = Body(...), admin: dict = Depends(require_role("super_admin", "company_admin"))):
    """Partial update for products. Useful for toggling hidden status."""
    existing = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Product not found")
    # Only allow specific fields to be patched
    allowed_fields = {"hidden", "stock", "name", "price", "description"}
    patch_data = {k: v for k, v in updates.items() if k in allowed_fields}
    patch_data["updated_at"] = now_iso()
    await db.products.update_one({"id": product_id}, {"$set": patch_data})
    updated = await db.products.find_one({"id": product_id}, {"_id": 0})
    await log_admin_action(
        admin,
        action="product_patch",
        module="products",
        summary=f"Updated product {updated.get('name')} (hidden={patch_data.get('hidden', existing.get('hidden'))})",
        target_id=product_id,
        metadata=patch_data,
    )
    return updated

@api_router.delete("/products/{product_id}")
async def delete_product(product_id: str, admin: dict = Depends(require_role("super_admin", "company_admin", "admin"))):
    existing = await db.products.find_one({"id": product_id}, {"_id": 0, "name": 1, "category": 1, "product_type": 1})
    r = await db.products.delete_one({"id": product_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    await log_admin_action(
        admin,
        action="product_delete",
        module="products",
        summary=f"Deleted product {(existing or {}).get('name') or product_id}",
        target_id=product_id,
        metadata={"name": (existing or {}).get("name"), "category": (existing or {}).get("category"), "product_type": (existing or {}).get("product_type")},
    )
    return {"success": True, "deleted": product_id}


# ===================== ASSOCIATE PARTNERS (Business/Service Providers) =====================
# Each Partner has its OWN commission_percent agreed at registration.
# The commission for any product sale is looked up from the associated Partner — NOT global settings.
@api_router.post("/admin/partners")
async def create_partner(req: AssociatePartnerRequest, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    agreed_percent = float(req.agreement_percent if req.agreement_percent is not None else req.commission_percent)
    if agreed_percent <= 0 or agreed_percent > 100:
        raise HTTPException(status_code=400, detail="agreement_percent must be between 0 and 100")
    partner_id = str(uuid.uuid4())
    partner_code = f"AP-{str(uuid.uuid4().int)[:6]}"

    # Auto-create partner login user
    partner_email = (req.email or "").strip().lower()
    generated_password = None
    partner_user_id = None
    if partner_email:
        existing = await db.users.find_one({"email": partner_email})
        if existing:
            partner_user_id = existing["id"]
            # Upgrade role & link partner_id if needed
            await db.users.update_one(
                {"id": partner_user_id},
                {"$set": {"role": "partner", "partner_id": partner_id, "partner_code": partner_code}}
            )
        else:
            partner_user_id = str(uuid.uuid4())
            generated_password = req.login_password or f"AP{uuid.uuid4().hex[:8]}"
            user_doc = {
                "id": partner_user_id,
                "email": partner_email,
                "phone": req.phone,
                "name": req.business_name,
                "member_code": partner_code,
                "role": "partner",
                "partner_id": partner_id,
                "sponsor_id": None,
                "password": hash_password(generated_password),
                "rank": "Partner",
                "created_at": now_iso(),
                "active": True,
                "kyc_status": "verified",
            }
            await db.users.insert_one(user_doc.copy())
            # Wallet init (partners have wallets to accumulate commission owed)
            await db.wallets.insert_one({
                "user_id": partner_user_id, "balance": 0, "total_income": 0,
                "total_bonus": 0, "total_withdrawn": 0, "created_at": now_iso(),
            })

    partner = {
        "id": partner_id,
        **req.model_dump(exclude={"login_password"}),
        "agreement_percent": agreed_percent,
        "commission_percent": agreed_percent,
        "partner_code": partner_code,
        "user_id": partner_user_id,
        "created_at": now_iso(),
        "created_by": admin["id"],
        "total_sales": 0.0,
        "total_commission_paid": 0.0,
    }
    await db.associate_partners.insert_one(partner.copy())
    partner.pop("_id", None)
    if generated_password:
        partner["generated_password"] = generated_password  # shown once to admin
        partner["login_url"] = "/login"
    await log_admin_action(
        admin,
        action="partner_create",
        module="partners",
        summary=f"Created partner {partner.get('business_name')}",
        target_id=partner_id,
        metadata={"business_name": partner.get("business_name"), "partner_code": partner.get("partner_code"), "agreement_percent": partner.get("agreement_percent")},
    )
    return partner


# ===================== PUBLIC PARTNER REGISTRATION (approval-gated) =====================

class PartnerRegistrationRequest(BaseModel):
    business_name: str
    business_type: str = "Retail Shop"
    contact_person: str
    phone: str
    email: Optional[str] = ""
    whatsapp_no: Optional[str] = ""
    address: str
    city: str
    state: str
    pincode: Optional[str] = ""
    gst_no: Optional[str] = ""
    upi_id: Optional[str] = ""
    website: Optional[str] = ""
    social_link: Optional[str] = ""
    business_description: Optional[str] = ""
    commission_percent_ask: Optional[float] = None
    logo_url: Optional[str] = ""


@api_router.post("/partners/register")
async def public_register_partner(req: PartnerRegistrationRequest):
    """Public — anyone can apply to become an Associate Partner. Creates a `partner_request`
    document with status='pending'. Admin approves via /admin/partner-requests/{id}/approve
    which auto-creates the login + partner + credentials."""
    or_clauses = [{"phone": req.phone}]
    if req.email:
        or_clauses.append({"email": req.email})
    existing = await db.partner_requests.find_one({
        "$or": or_clauses,
        "status": {"$in": ["pending", "approved"]},
    })
    if existing:
        raise HTTPException(status_code=400, detail=f"A request with this phone/email is already {existing.get('status')}.")

    doc = {
        "id": str(uuid.uuid4()),
        **req.model_dump(),
        "status": "pending",
        "created_at": now_iso(),
    }
    await db.partner_requests.insert_one(doc)
    return {
        "success": True,
        "request_id": doc["id"],
        "message": "Application received. Admin will review and get in touch within 24-48 hours.",
    }


@api_router.get("/admin/partner-requests")
async def admin_list_partner_requests(
    status_filter: Optional[str] = None,
    admin: dict = Depends(require_role("super_admin", "company_admin")),
):
    q = {}
    if status_filter:
        q["status"] = status_filter
    docs = await db.partner_requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@api_router.post("/admin/partner-requests/{request_id}/approve")
async def admin_approve_partner_request(
    request_id: str,
    payload: dict = Body(default={}),
    admin: dict = Depends(require_role("super_admin", "company_admin")),
):
    """Approve a pending partner request. Auto-creates the login user + associate_partner."""
    req = await db.partner_requests.find_one({"id": request_id})
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.get("status") != "pending":
        raise HTTPException(status_code=400, detail=f"Cannot approve — status is {req.get('status')}")

    agreement_percent = float(payload.get("agreement_percent") or payload.get("commission_percent") or req.get("commission_percent_ask") or 10)

    partner_payload = AssociatePartnerRequest(
        business_name=req["business_name"],
        business_type=req.get("business_type", "Retail Shop"),
        contact_person=req["contact_person"],
        phone=req["phone"],
        email=req.get("email", ""),
        address=req["address"],
        city=req.get("city", ""),
        state=req.get("state", ""),
        pincode=req.get("pincode", ""),
        gst_no=req.get("gst_no", ""),
        commission_percent=agreement_percent,
        agreement_percent=agreement_percent,
        upi_id=req.get("upi_id", ""),
        whatsapp_no=req.get("whatsapp_no", ""),
        notes=req.get("business_description", ""),
        logo_url=req.get("logo_url", ""),
        active=True,
    )
    partner_response = await create_partner(partner_payload, admin=admin)

    await db.partner_requests.update_one(
        {"id": request_id},
        {"$set": {
            "status": "approved",
            "approved_by": admin["id"],
            "approved_at": now_iso(),
            "linked_partner_id": partner_response["id"],
            "linked_partner_code": partner_response["partner_code"],
        }},
    )
    return {
        "success": True,
        "request_id": request_id,
        "partner_id": partner_response["id"],
        "partner_code": partner_response["partner_code"],
        "login_email": partner_response.get("email"),
        "login_password": partner_response.get("generated_password"),
        "message": "Partner approved and activated. Share the credentials via WhatsApp/email.",
    }
    await log_admin_action(
        admin,
        action="partner_request_approve",
        module="partner_requests",
        summary=f"Approved partner request {request_id}",
        target_id=request_id,
        metadata={"partner_id": partner_response["id"], "partner_code": partner_response["partner_code"], "login_email": partner_response.get("email") or ""},
    )
    return {
        "success": True,
        "request_id": request_id,
        "partner_id": partner_response["id"],
        "partner_code": partner_response["partner_code"],
        "login_email": partner_response.get("email"),
        "login_password": partner_response.get("generated_password"),
        "message": "Partner approved and activated. Share the credentials via WhatsApp/email.",
    }


@api_router.post("/admin/partner-requests/{request_id}/reject")
async def admin_reject_partner_request(
    request_id: str,
    payload: dict = Body(default={}),
    admin: dict = Depends(require_role("super_admin", "company_admin")),
):
    req = await db.partner_requests.find_one({"id": request_id})
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.get("status") != "pending":
        raise HTTPException(status_code=400, detail=f"Cannot reject — status is {req.get('status')}")
    await db.partner_requests.update_one(
        {"id": request_id},
        {"$set": {
            "status": "rejected",
            "rejected_by": admin["id"],
            "rejected_at": now_iso(),
            "rejection_reason": payload.get("reason") or "Application not approved",
        }},
    )
    await log_admin_action(
        admin,
        action="partner_request_reject",
        module="partner_requests",
        summary=f"Rejected partner request {request_id}",
        target_id=request_id,
        metadata={"reason": payload.get("reason") or "Application not approved"},
    )
    return {"success": True, "request_id": request_id, "status": "rejected"}


@api_router.get("/admin/partners")
async def list_partners(admin: dict = Depends(require_role("super_admin", "company_admin"))):
    docs = await db.associate_partners.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@api_router.get("/partners")
async def list_partners_public():
    """Public list (for dropdowns / customer visibility). No sensitive fields."""
    docs = await db.associate_partners.find(
        {"active": True},
        {"_id": 0, "id": 1, "business_name": 1, "business_type": 1, "partner_code": 1, "commission_percent": 1}
    ).to_list(500)
    return docs


@api_router.put("/admin/partners/{partner_id}")
async def update_partner(partner_id: str, req: AssociatePartnerRequest, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    agreed_percent = float(req.agreement_percent if req.agreement_percent is not None else req.commission_percent)
    if agreed_percent <= 0 or agreed_percent > 100:
        raise HTTPException(status_code=400, detail="agreement_percent must be between 0 and 100")
    payload = req.model_dump()
    payload["agreement_percent"] = agreed_percent
    payload["commission_percent"] = agreed_percent
    r = await db.associate_partners.update_one({"id": partner_id}, {"$set": {**payload, "updated_at": now_iso()}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Partner not found")
    doc = await db.associate_partners.find_one({"id": partner_id}, {"_id": 0})
    return doc


@api_router.delete("/admin/partners/{partner_id}")
async def deactivate_partner(partner_id: str, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    r = await db.associate_partners.update_one({"id": partner_id}, {"$set": {"active": False, "deactivated_at": now_iso()}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Partner not found")
    return {"success": True, "deactivated": partner_id}


@api_router.post("/admin/partners/{partner_id}/reactivate")
async def reactivate_partner(partner_id: str, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    """Re-activate a previously deactivated/blocked partner."""
    r = await db.associate_partners.update_one({"id": partner_id}, {"$set": {"active": True, "reactivated_at": now_iso()}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Partner not found")
    return {"success": True, "reactivated": partner_id}


@api_router.delete("/admin/partners/{partner_id}/permanent")
async def delete_partner_permanent(partner_id: str, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    """Permanently delete a partner record."""
    r = await db.associate_partners.delete_one({"id": partner_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Partner not found")
    return {"success": True, "deleted": partner_id}


@api_router.get("/admin/partners/{partner_id}/ledger")
async def partner_ledger(partner_id: str, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    partner = await db.associate_partners.find_one({"id": partner_id}, {"_id": 0})
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    entries = await db.partner_ledger.find({"partner_id": partner_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"partner": partner, "entries": entries}


# ===================== PARTNER-SELF ENDPOINTS (partner role only) =====================
def _require_partner(user: dict):
    if user.get("role") != "partner" or not user.get("partner_id"):
        raise HTTPException(status_code=403, detail="Partner access only")


@api_router.get("/partner/me")
async def partner_me(user: dict = Depends(get_current_user)):
    _require_partner(user)
    partner = await db.associate_partners.find_one({"id": user["partner_id"]}, {"_id": 0})
    if not partner:
        raise HTTPException(status_code=404, detail="Partner record not found")
    return partner


@api_router.get("/partner/summary")
async def partner_summary(user: dict = Depends(get_current_user)):
    _require_partner(user)
    partner_id = user["partner_id"]
    partner = await db.associate_partners.find_one({"id": partner_id}, {"_id": 0}) or {}
    # This month's sales
    period = _period_key()
    pipeline = [
        {"$match": {"partner_id": partner_id, "period": period}},
        {"$group": {"_id": None, "sales": {"$sum": "$sales_amount"}, "commission": {"$sum": "$commission_amount"}, "orders": {"$sum": 1}}},
    ]
    agg = await db.partner_ledger.aggregate(pipeline).to_list(1)
    this_month = agg[0] if agg else {"sales": 0, "commission": 0, "orders": 0}
    products = await db.products.count_documents({"partner_id": partner_id})
    return {
        "partner_code": partner.get("partner_code"),
        "business_name": partner.get("business_name"),
        "commission_percent": partner.get("commission_percent"),
        "total_sales": partner.get("total_sales", 0),
        "total_commission_paid": partner.get("total_commission_paid", 0),
        "this_month": {k: this_month.get(k, 0) for k in ("sales", "commission", "orders")},
        "products_linked": products,
        "current_period": period,
    }


@api_router.get("/partner/ledger")
async def partner_own_ledger(user: dict = Depends(get_current_user)):
    _require_partner(user)
    entries = await db.partner_ledger.find({"partner_id": user["partner_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return entries


@api_router.get("/partner/products")
async def partner_own_products(user: dict = Depends(get_current_user)):
    _require_partner(user)
    docs = await db.products.find({"partner_id": user["partner_id"]}, {"_id": 0}).to_list(500)
    return docs


@api_router.get("/partner/orders")
async def partner_own_orders(user: dict = Depends(get_current_user)):
    """Orders that included this partner's products."""
    _require_partner(user)
    products = await db.products.find({"partner_id": user["partner_id"]}, {"_id": 0, "id": 1}).to_list(1000)
    pids = [p["id"] for p in products]
    if not pids:
        return []
    orders = await db.orders.find(
        {"items.product_id": {"$in": pids}},
        {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    partner_id = user["partner_id"]
    for o in orders:
        pl = await db.partner_ledger.find_one({"ref_order_id": o["id"], "partner_id": partner_id}, {"_id": 0})
        o["my_sales"] = pl.get("sales_amount", 0) if pl else 0
        o["my_commission"] = pl.get("commission_amount", 0) if pl else 0
        o["my_items"] = [it for it in o.get("items", []) if it.get("product_id") in pids]
    return orders


@api_router.post("/partner/products")
async def partner_create_product(req: ProductRequest, user: dict = Depends(get_current_user)):
    _require_partner(user)
    existing_count = await db.products.count_documents({"partner_id": user["partner_id"]})
    if existing_count >= 5:
        raise HTTPException(status_code=400, detail="You can upload up to 5 products only. Please delete or update existing products.")
    p = {
        "id": str(uuid.uuid4()),
        **req.model_dump(),
        "product_type": "associate_partner",
        "partner_id": user["partner_id"],
        "approval_status": "pending",  # ADMIN must approve before public
        "created_at": now_iso(),
        "created_by": user["id"],
    }
    await db.products.insert_one(p.copy())
    p.pop("_id", None)
    return p


@api_router.get("/admin/products/pending")
async def admin_pending_products(admin: dict = Depends(require_role("super_admin", "company_admin"))):
    docs = await db.products.find({"approval_status": "pending"}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@api_router.post("/admin/products/{product_id}/approve")
async def admin_approve_product(product_id: str, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    r = await db.products.update_one({"id": product_id}, {"$set": {"approval_status": "approved", "approved_by": admin["id"], "approved_at": now_iso()}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"success": True, "product_id": product_id}


class RejectProductRequest(BaseModel):
    reason: Optional[str] = None


@api_router.post("/admin/products/{product_id}/reject")
async def admin_reject_product(product_id: str, req: RejectProductRequest, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    r = await db.products.update_one({"id": product_id}, {"$set": {"approval_status": "rejected", "rejection_reason": req.reason or "Not approved", "rejected_at": now_iso(), "rejected_by": admin["id"]}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"success": True, "product_id": product_id, "reason": req.reason}


@api_router.put("/partner/products/{product_id}")
async def partner_update_product(product_id: str, req: ProductRequest, user: dict = Depends(get_current_user)):
    _require_partner(user)
    existing = await db.products.find_one({"id": product_id, "partner_id": user["partner_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Product not found or not yours")
    payload = req.model_dump()
    payload["partner_id"] = user["partner_id"]
    payload["product_type"] = "associate_partner"
    # Edits by a partner must go back into moderation queue
    payload["approval_status"] = "pending"
    await db.products.update_one(
        {"id": product_id},
        {"$set": {**payload, "updated_at": now_iso()}, "$unset": {"rejection_reason": "", "rejected_at": "", "rejected_by": "", "approved_at": "", "approved_by": ""}},
    )
    updated = await db.products.find_one({"id": product_id}, {"_id": 0})
    return updated


@api_router.delete("/partner/products/{product_id}")
async def partner_delete_product(product_id: str, user: dict = Depends(get_current_user)):
    _require_partner(user)
    r = await db.products.delete_one({"id": product_id, "partner_id": user["partner_id"]})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Product not found or not yours")
    return {"success": True, "deleted": product_id}


# ===================== PUBLIC PARTNER DIRECTORY =====================
@api_router.get("/directory/partners")
async def partner_directory(
    city: Optional[str] = None,
    business_type: Optional[str] = None,
    category: Optional[str] = None,
    q: Optional[str] = None,
):
    """Public directory — members find partners by city / type / category / search."""
    query = {"active": True}
    if city:
        query["city"] = {"$regex": f"^{city}$", "$options": "i"}
    if business_type:
        query["business_type"] = business_type
    if q:
        query["$or"] = [
            {"business_name": {"$regex": q, "$options": "i"}},
            {"contact_person": {"$regex": q, "$options": "i"}},
        ]
    # Category filter — find partners that have at least one product in that category
    if category:
        pids = await db.products.distinct("partner_id", {"category": category, "product_type": "associate_partner"})
        query["id"] = {"$in": pids}
    docs = await db.associate_partners.find(
        query,
        {"_id": 0, "id": 1, "partner_code": 1, "business_name": 1, "business_type": 1,
         "city": 1, "state": 1, "address": 1, "pincode": 1, "phone": 1, "whatsapp_no": 1, "contact_person": 1,
         "logo_url": 1, "commission_percent": 1, "total_sales": 1, "is_featured": 1}
    ).sort([("is_featured", -1), ("business_name", 1)]).to_list(500)
    return docs


@api_router.get("/directory/featured-partners")
async def featured_partners():
    """Public — up to 3 admin-featured active partners for the Directory hero."""
    docs = await db.associate_partners.find(
        {"active": True, "is_featured": True},
        {"_id": 0, "id": 1, "partner_code": 1, "business_name": 1, "business_type": 1,
         "city": 1, "state": 1, "address": 1, "phone": 1, "whatsapp_no": 1, "logo_url": 1, "is_featured": 1}
    ).sort("business_name", 1).to_list(3)
    return docs


@api_router.post("/admin/partners/{partner_id}/toggle-featured")
async def toggle_featured(partner_id: str, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    """Admin marks a partner as Featured Partner of the Week (shown on Directory hero)."""
    partner = await db.associate_partners.find_one({"id": partner_id}, {"_id": 0, "is_featured": 1, "business_name": 1})
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    new_state = not bool(partner.get("is_featured"))
    await db.associate_partners.update_one(
        {"id": partner_id},
        {"$set": {"is_featured": new_state, "featured_at": now_iso() if new_state else None}},
    )
    return {"success": True, "partner_id": partner_id, "is_featured": new_state}


@api_router.post("/admin/partners/{partner_id}/reset-password")
async def admin_reset_partner_password(partner_id: str, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    """Generate new password for a partner. Returned once — admin should share securely."""
    partner = await db.associate_partners.find_one({"id": partner_id}, {"_id": 0})
    if not partner or not partner.get("user_id"):
        raise HTTPException(status_code=404, detail="Partner not found or has no login account")
    new_password = f"AP{uuid.uuid4().hex[:8]}"
    await db.users.update_one(
        {"id": partner["user_id"]},
        {"$set": {"password": hash_password(new_password), "password_reset_at": now_iso()}}
    )
    return {"success": True, "partner_id": partner_id, "new_password": new_password, "user_email": (await db.users.find_one({"id": partner["user_id"]}, {"_id": 0, "email": 1}) or {}).get("email")}


@api_router.get("/directory/categories")
async def list_directory_categories():
    """Distinct product categories across active partner products."""
    cats = await db.products.distinct("category", {"product_type": "associate_partner"})
    return sorted([c for c in cats if c])


@api_router.get("/directory/cities")
async def list_cities():
    """Distinct cities that have active partners."""
    cities = await db.associate_partners.distinct("city", {"active": True, "city": {"$ne": ""}})
    return sorted([c for c in cities if c])


@api_router.get("/directory/partner/{partner_code}")
async def partner_public_page(partner_code: str):
    """Public partner storefront — business info + product catalog."""
    partner = await db.associate_partners.find_one(
        {"partner_code": partner_code, "active": True},
        {"_id": 0, "user_id": 0, "notes": 0, "email": 0, "gst_no": 0, "upi_id": 0, "created_by": 0, "total_commission_paid": 0}
    )
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    products = await db.products.find({"partner_id": partner["id"], "approval_status": {"$in": ["approved", None]}}, {"_id": 0}).to_list(500)
    return {"partner": partner, "products": products}



# ===================== INVOICE (GST-compliant) =====================
@api_router.get("/orders/{order_id}/invoice")
async def get_invoice(order_id: str, user: dict = Depends(get_current_user)):
    """Full invoice payload for print/PDF. Buyer can only fetch their own; admin can fetch any."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    is_admin = user["role"] in ("super_admin", "company_admin")
    if not is_admin and order["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not allowed")

    settings = await get_settings()
    buyer = await db.users.find_one({"id": order["user_id"]}, {"_id": 0, "password": 0}) or {}

    # Group items by partner (each partner may have their own GST) — for now company issues single invoice
    items_out = []
    subtotal_pre_tax = 0.0
    for it in order.get("items", []):
        product = await db.products.find_one({"id": it["product_id"]}, {"_id": 0}) or {}
        rate = 18.0  # default GST rate for products — could be per-product later
        # taxable value = subtotal / (1 + rate/100) if price is tax-inclusive; keep tax-inclusive presentation
        pre_tax = round(it["subtotal"] / (1 + rate / 100), 2)
        tax = round(it["subtotal"] - pre_tax, 2)
        items_out.append({
            **it,
            "hsn_sac": product.get("hsn_sac") or "9999",  # placeholder HSN
            "gst_rate": rate,
            "pre_tax": pre_tax,
            "tax_amount": tax,
            "cgst": round(tax / 2, 2),
            "sgst": round(tax / 2, 2),
        })
        subtotal_pre_tax += pre_tax
    total_tax = round(sum(i["tax_amount"] for i in items_out), 2)
    grand_total = round(order.get("total_amount", 0), 2)

    invoice_no = order.get("invoice_no") or f"INV-{order['order_no'].replace('ORD-', '')}"
    # Store invoice number on the order so it's stable
    if not order.get("invoice_no"):
        await db.orders.update_one({"id": order_id}, {"$set": {"invoice_no": invoice_no}})

    return {
        "invoice_no": invoice_no,
        "invoice_date": order.get("approved_at") or order.get("created_at"),
        "order_no": order["order_no"],
        "status": order["status"],
        "seller": {
            "name": settings.get("company_name") or "METHO Logistics Pvt. Ltd.",
            "address": "METHO Logistics Pvt. Ltd., India",
            "gst_no": settings.get("company_gst_no") or "19XXXXX0000X0Z0",
            "pan": settings.get("company_pan") or "AAAAA0000A",
            "state": "West Bengal",
            "state_code": "19",
            "upi_id": settings.get("upi_id"),
            "email": "billing@metho.com",
        },
        "buyer": {
            "name": buyer.get("name"),
            "email": buyer.get("email"),
            "phone": buyer.get("phone"),
            "member_code": buyer.get("member_code"),
            "shipping_address": order.get("shipping_address"),
        },
        "items": items_out,
        "subtotal_pre_tax": round(subtotal_pre_tax, 2),
        "total_cgst": round(total_tax / 2, 2),
        "total_sgst": round(total_tax / 2, 2),
        "total_tax": total_tax,
        "grand_total": grand_total,
        "payment": {
            "method": order.get("payment_method"),
            "txn_id": order.get("txn_id"),
            "screenshot_url": order.get("payment_screenshot_url"),
        },
        "notes": settings.get("invoice_terms") or "Tax-inclusive pricing. E&OE. Subject to Kolkata jurisdiction.",
        "einvoice": order.get("einvoice") or {},
    }


def _build_invoice_html(inv: dict) -> str:
    """Minimal styled HTML — used for email + bulk ZIP export."""
    def r(v):
        return f"{float(v or 0):,.2f}"
    items_rows = "".join(
        f"<tr><td>{i+1}</td><td>{it['product_name']}</td><td style='text-align:center'>{it.get('hsn_sac')}</td>"
        f"<td style='text-align:right'>{it['quantity']}</td><td style='text-align:right'>₹{r(it['price'])}</td>"
        f"<td style='text-align:right'>₹{r(it['pre_tax'])}</td><td style='text-align:right'>₹{r(it['cgst'])}</td>"
        f"<td style='text-align:right'>₹{r(it['sgst'])}</td><td style='text-align:right'><b>₹{r(it['subtotal'])}</b></td></tr>"
        for i, it in enumerate(inv["items"])
    )
    return f"""<!doctype html><html><head><meta charset='utf-8'/><title>{inv['invoice_no']}</title>
<style>body{{font-family:system-ui,Arial,sans-serif;color:#0f172a;max-width:820px;margin:24px auto;padding:0 16px}}
h1{{color:#064e3b;font-size:26px;margin:0}} .brand{{border-bottom:4px solid #064e3b;padding:16px;background:#f0fdf4;display:flex;justify-content:space-between}}
table{{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}} th{{background:#064e3b;color:#fbbf24;padding:6px;text-align:left;font-size:10px;text-transform:uppercase}}
td{{padding:6px;border-bottom:1px solid #e5e7eb}} .totals{{background:#fef3c7;padding:12px;margin-top:12px;text-align:right;font-size:14px}}
.footer{{background:#f9fafb;padding:12px;font-size:11px;color:#475569;margin-top:12px}}</style></head><body>
<div class='brand'><div><div style='color:#d97706;font-size:10px;letter-spacing:3px;font-weight:700'>TAX INVOICE</div>
<h1>{inv['seller']['name']}</h1><div style='font-size:11px;color:#475569'>GSTIN: {inv['seller']['gst_no']} · PAN: {inv['seller']['pan']}</div>
<div style='font-size:11px;color:#475569'>{inv['seller']['address']}</div></div>
<div style='text-align:right'><div><b>Invoice:</b> {inv['invoice_no']}</div><div><b>Date:</b> {inv['invoice_date'][:10]}</div>
<div><b>Order:</b> {inv['order_no']}</div>
{'<div style="margin-top:8px;padding:6px;border:1px solid #10b981;border-radius:4px;background:#ecfdf5"><div style="font-size:8px;text-transform:uppercase;letter-spacing:2px;color:#065f46;font-weight:700">GSTN E-Invoice</div><div style="font-size:8px;font-family:monospace;word-break:break-all;max-width:180px">IRN: ' + inv['einvoice'].get('irn', '')[:40] + '…</div><div style="font-size:8px;font-family:monospace">Ack: ' + str(inv['einvoice'].get('ack_no', '')) + '</div>' + ('<img src="' + inv['einvoice'].get('signed_qr_png', '') + '" style="width:80px;height:80px;margin-top:4px"/>' if inv['einvoice'].get('signed_qr_png') else '') + '</div>' if inv.get('einvoice', {}).get('irn') else ''}
</div></div>
<div style='display:flex;gap:24px;margin-top:16px'><div><div style='font-size:10px;color:#64748b;text-transform:uppercase'>Bill To</div>
<b>{inv['buyer']['name']}</b><br/>{inv['buyer']['email'] or ''} · {inv['buyer']['phone'] or ''}<br/>
Code: {inv['buyer']['member_code']}<br/><div style='font-size:11px;margin-top:4px'>{inv['buyer']['shipping_address'] or ''}</div></div>
<div><div style='font-size:10px;color:#64748b;text-transform:uppercase'>Payment</div>Method: <b>{(inv['payment']['method'] or '').upper()}</b><br/>
Txn: {inv['payment']['txn_id'] or '—'}<br/>Status: <b>{inv['status'].upper()}</b></div></div>
<table><thead><tr><th>#</th><th>Item</th><th>HSN</th><th>Qty</th><th>Rate</th><th>Pre-Tax</th><th>CGST</th><th>SGST</th><th>Total</th></tr></thead>
<tbody>{items_rows}</tbody></table>
<div class='totals'>Sub-total ₹{r(inv['subtotal_pre_tax'])} · CGST ₹{r(inv['total_cgst'])} · SGST ₹{r(inv['total_sgst'])}
<br/><b style='font-size:20px;color:#064e3b'>Grand Total ₹{r(inv['grand_total'])}</b></div>
<div class='footer'>{(inv['notes'] or '').replace(chr(10), '<br/>')}<br/><br/>UPI: {inv['seller'].get('upi_id') or ''}</div>
</body></html>"""


def _build_einvoice_json(inv: dict) -> dict:
    """GSTN e-invoice standard schema (subset — Version 1.1). Suitable for IRP upload after IRN generation."""
    return {
        "Version": "1.1",
        "TranDtls": {"TaxSch": "GST", "SupTyp": "B2C", "RegRev": "N", "IgstOnIntra": "N"},
        "DocDtls": {"Typ": "INV", "No": inv["invoice_no"], "Dt": inv["invoice_date"][:10].split("-")[::-1].__iter__().__next__() if inv.get("invoice_date") else ""},
        "SellerDtls": {
            "Gstin": inv["seller"]["gst_no"], "LglNm": inv["seller"]["name"],
            "Addr1": inv["seller"]["address"], "Loc": inv["seller"].get("state"),
            "Pin": 700001, "Stcd": inv["seller"].get("state_code", "19"),
        },
        "BuyerDtls": {
            "Gstin": "URP",  # Unregistered person
            "LglNm": inv["buyer"]["name"],
            "Pos": inv["seller"].get("state_code", "19"),
            "Addr1": (inv["buyer"].get("shipping_address") or "")[:100],
            "Loc": "Buyer Location", "Pin": 700001, "Stcd": "19",
        },
        "ItemList": [
            {
                "SlNo": str(i + 1),
                "PrdDesc": it["product_name"],
                "IsServc": "N",
                "HsnCd": str(it.get("hsn_sac") or "9999"),
                "Qty": float(it["quantity"]),
                "Unit": "NOS",
                "UnitPrice": float(it["price"]),
                "TotAmt": float(it["pre_tax"]),
                "AssAmt": float(it["pre_tax"]),
                "GstRt": float(it["gst_rate"]),
                "CgstAmt": float(it["cgst"]),
                "SgstAmt": float(it["sgst"]),
                "IgstAmt": 0.0,
                "TotItemVal": float(it["subtotal"]),
            }
            for i, it in enumerate(inv["items"])
        ],
        "ValDtls": {
            "AssVal": float(inv["subtotal_pre_tax"]),
            "CgstVal": float(inv["total_cgst"]),
            "SgstVal": float(inv["total_sgst"]),
            "IgstVal": 0.0,
            "TotInvVal": float(inv["grand_total"]),
        },
    }


@api_router.get("/orders/{order_id}/invoice.json")
async def get_invoice_einvoice_json(order_id: str, user: dict = Depends(get_current_user)):
    """GSTN e-invoice compliant JSON. Ready for IRN upload."""
    inv = await get_invoice(order_id, user)
    return _build_einvoice_json(inv)


# ===================== E-INVOICE IRN SUBMISSION =====================
def _sha256_irn(gstin: str, invoice_no: str, doc_type: str, invoice_date: str) -> str:
    """IRN = SHA256(GSTIN + DocNo + DocType + FinancialYear). Used for mock mode & verification."""
    import hashlib
    # Financial year: April to March (Indian FY)
    try:
        y, m, _d = (invoice_date or "")[:10].split("-")
        y = int(y); m = int(m)
        fy_start = y if m >= 4 else y - 1
        fy = f"{fy_start}-{str(fy_start + 1)[-2:]}"
    except Exception:
        fy = "2025-26"
    raw = f"{gstin}{invoice_no}{doc_type}{fy}"
    return hashlib.sha256(raw.encode()).hexdigest()


def _build_signed_qr_text(irn: str, gstin: str, buyer_gstin: str, invoice_no: str,
                          invoice_date: str, invoice_value: float, hsn: str) -> str:
    """Compact signed-QR text (the actual government JWT-signed QR requires GSTN response;
    this stand-in string embeds the mandated 8 fields for mock/dev mode)."""
    payload = {
        "SellerGstin": gstin,
        "BuyerGstin": buyer_gstin or "URP",
        "DocNo": invoice_no,
        "DocTyp": "INV",
        "DocDt": invoice_date,
        "TotInvVal": invoice_value,
        "ItemCnt": 1,
        "MainHsnCode": hsn,
        "Irn": irn,
    }
    import base64, json as _json
    return "MOCK_QR." + base64.b64encode(_json.dumps(payload).encode()).decode()


def _qr_to_data_url(qr_text: str) -> str:
    """Generate a PNG data-URL for the QR code text."""
    import qrcode, base64
    from io import BytesIO
    img = qrcode.make(qr_text)
    buf = BytesIO(); img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


async def _submit_to_gsp(inv_json: dict, settings: dict) -> dict:
    """POST invoice JSON to a configured GSP (GST Suvidha Provider). Expects the GSP to return:
    { irn, ack_no, ack_dt, signed_qr_code, signed_invoice }."""
    import httpx
    api_url = (settings.get("einvoice_api_url") or "").strip()
    if not api_url:
        raise HTTPException(status_code=400, detail="E-Invoice API URL not configured in Settings")
    headers = {"Content-Type": "application/json"}
    api_key = (settings.get("einvoice_api_key") or "").strip()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    gstin = (settings.get("einvoice_gstin") or "").strip()
    if gstin:
        headers["gstin"] = gstin
    client_id = (settings.get("einvoice_client_id") or "").strip()
    client_secret = (settings.get("einvoice_client_secret") or "").strip()
    if client_id:
        headers["client-id"] = client_id
    if client_secret:
        headers["client-secret"] = client_secret
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(api_url, json=inv_json, headers=headers)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"GSP request failed: {e}")
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"GSP error {r.status_code}: {r.text[:200]}")
    try:
        data = r.json()
    except Exception:
        raise HTTPException(status_code=502, detail="GSP returned non-JSON response")
    # Normalize common response shapes
    result = data.get("result") if isinstance(data, dict) and "result" in data else data
    irn = result.get("Irn") or result.get("irn")
    ack_no = result.get("AckNo") or result.get("ack_no")
    ack_dt = result.get("AckDt") or result.get("ack_dt")
    signed_qr = result.get("SignedQRCode") or result.get("signed_qr_code") or result.get("SignedQR") or ""
    signed_invoice = result.get("SignedInvoice") or result.get("signed_invoice") or ""
    if not irn:
        raise HTTPException(status_code=502, detail=f"GSP response missing IRN: {str(data)[:200]}")
    return {"irn": irn, "ack_no": ack_no, "ack_dt": ack_dt, "signed_qr": signed_qr, "signed_invoice": signed_invoice, "provider_response": data}


@api_router.post("/admin/orders/{order_id}/einvoice/submit")
async def admin_submit_einvoice(
    order_id: str,
    admin: dict = Depends(require_role("super_admin", "company_admin")),
):
    """Submit an approved invoice to the configured E-Invoice provider (or generate mock IRN
    when provider='mock'). Stores IRN + Ack + signed QR back onto the order."""
    order = await db.orders.find_one({"id": order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("einvoice", {}).get("irn"):
        return {"already_submitted": True, "einvoice": order["einvoice"]}
    settings = await get_settings()
    if not settings.get("einvoice_enabled"):
        raise HTTPException(status_code=400, detail="E-Invoice is not enabled in Settings")
    provider = (settings.get("einvoice_provider") or "mock").lower()

    # Build the base invoice + JSON
    inv = await get_invoice(order_id, admin)
    inv_json = _build_einvoice_json(inv)

    if provider == "mock":
        gstin = settings.get("einvoice_gstin") or inv["seller"].get("gst_no", "")
        irn = _sha256_irn(gstin, inv["invoice_no"], "INV", inv.get("invoice_date", ""))
        ack_no = "ACK" + irn[:12].upper()
        ack_dt = now_iso()
        hsn = str((inv.get("items") or [{}])[0].get("hsn_sac") or "9999")
        qr_text = _build_signed_qr_text(irn, gstin, "URP", inv["invoice_no"], inv.get("invoice_date", ""), float(inv.get("grand_total") or 0), hsn)
        einvoice = {
            "irn": irn, "ack_no": ack_no, "ack_dt": ack_dt,
            "signed_qr": qr_text, "signed_qr_png": _qr_to_data_url(qr_text),
            "signed_invoice": "",
            "provider": "mock", "sandbox": True,
            "submitted_at": now_iso(), "submitted_by": admin["id"],
        }
    elif provider in ("generic_gsp", "nic_direct"):
        result = await _submit_to_gsp(inv_json, settings)
        qr_text = result.get("signed_qr") or _build_signed_qr_text(
            result["irn"], settings.get("einvoice_gstin", ""), "URP",
            inv["invoice_no"], inv.get("invoice_date", ""),
            float(inv.get("grand_total") or 0),
            str((inv.get("items") or [{}])[0].get("hsn_sac") or "9999"),
        )
        einvoice = {
            "irn": result["irn"], "ack_no": result.get("ack_no"), "ack_dt": result.get("ack_dt"),
            "signed_qr": qr_text, "signed_qr_png": _qr_to_data_url(qr_text),
            "signed_invoice": result.get("signed_invoice") or "",
            "provider": provider, "sandbox": bool(settings.get("einvoice_sandbox")),
            "submitted_at": now_iso(), "submitted_by": admin["id"],
        }
    else:
        raise HTTPException(status_code=400, detail=f"Unknown provider '{provider}'. Use 'mock' or 'generic_gsp'.")

    await db.orders.update_one({"id": order_id}, {"$set": {"einvoice": einvoice}})
    return {"success": True, "einvoice": einvoice}


@api_router.get("/orders/{order_id}/einvoice")
async def get_order_einvoice(order_id: str, user: dict = Depends(get_current_user)):
    """Return the E-Invoice details (IRN + QR PNG) for an order. Buyer, admin or seller partner allowed."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    # Access: buyer, admin, or partner selling in this order
    is_admin = user.get("role") in ("super_admin", "company_admin")
    is_buyer = order.get("user_id") == user["id"]
    is_partner = user.get("role") == "partner"
    if not (is_admin or is_buyer or is_partner):
        raise HTTPException(status_code=403, detail="Not allowed")
    ei = order.get("einvoice") or {}
    return {"order_id": order_id, "invoice_no": order.get("invoice_no"), "einvoice": ei, "has_irn": bool(ei.get("irn"))}


def _html_to_pdf_bytes(html: str) -> bytes:
    """Render HTML to PDF using xhtml2pdf (pure-Python, no system deps)."""
    from io import BytesIO
    from xhtml2pdf import pisa
    buf = BytesIO()
    result = pisa.CreatePDF(src=html, dest=buf, encoding="utf-8")
    if result.err:
        raise HTTPException(status_code=500, detail=f"PDF generation failed ({result.err})")
    return buf.getvalue()


@api_router.get("/orders/{order_id}/invoice/pdf")
async def get_invoice_pdf(order_id: str, user: dict = Depends(get_current_user)):
    """Downloadable GST invoice PDF for buyer or admin."""
    inv = await get_invoice(order_id, user)
    html = _build_invoice_html(inv)
    pdf = _html_to_pdf_bytes(html)
    filename = f"Invoice_{inv.get('invoice_no', order_id)}.pdf"
    return StreamingResponse(
        iter([pdf]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _build_wallet_statement_html(user: dict, wallet: dict, txs: list, settings: dict) -> str:
    """Simple wallet statement HTML for PDF export."""
    rows = "".join(
        f"<tr>"
        f"<td>{(t.get('created_at') or '')[:19].replace('T',' ')}</td>"
        f"<td>{(t.get('type') or '').replace('_',' ').title()}</td>"
        f"<td>{(t.get('description') or '').replace('<','&lt;')[:60]}</td>"
        f"<td style='text-align:right'>{'+' if (t.get('amount') or 0) > 0 else ''}₹{t.get('amount', 0):,.2f}</td>"
        f"</tr>"
        for t in txs
    ) or "<tr><td colspan='4' style='text-align:center;color:#777;padding:12px'>No transactions</td></tr>"
    sym = settings.get("currency_symbol") or "₹"
    company = settings.get("company_name") or "METHO AAY-UPAY"
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>Wallet Statement</title>
<style>
body {{ font-family: Helvetica, Arial, sans-serif; color: #052e29; font-size: 11px; }}
h1 {{ font-size: 20px; color: #065f46; margin: 0 0 4px; }}
.brand {{ font-size: 10px; color: #666; }}
table {{ width: 100%; border-collapse: collapse; margin-top: 12px; }}
th {{ background: #ecfdf5; padding: 6px 8px; text-align: left; font-size: 10px; text-transform: uppercase; color: #065f46; border-bottom: 2px solid #10b981; }}
td {{ padding: 6px 8px; border-bottom: 1px solid #eee; }}
.kpi {{ background: #f0fdf4; padding: 10px 12px; border-radius: 6px; margin-top: 10px; border-left: 4px solid #10b981; }}
.kpi b {{ color: #065f46; font-size: 18px; }}
.grid {{ display: block; margin-top: 6px; }}
.grid .cell {{ display: inline-block; width: 30%; margin-right: 3%; }}
.footer {{ margin-top: 20px; font-size: 9px; color: #999; text-align: center; }}
</style></head><body>
<h1>{company} — Wallet Statement</h1>
<div class="brand">Member: <b>{user.get('name','')}</b> · Code: <b>{user.get('member_code','')}</b> · Generated: {datetime.now(timezone.utc).strftime('%d %b %Y %H:%M UTC')}</div>
<div class="grid">
  <div class="cell kpi"><span>Balance</span><br/><b>{sym}{wallet.get('balance',0):,.2f}</b></div>
  <div class="cell kpi"><span>Total Income</span><br/><b>{sym}{wallet.get('total_income',0):,.2f}</b></div>
  <div class="cell kpi"><span>Total Withdrawn</span><br/><b>{sym}{wallet.get('total_withdrawn',0):,.2f}</b></div>
</div>
<table>
<thead><tr><th>Date/Time (UTC)</th><th>Type</th><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
<tbody>{rows}</tbody>
</table>
<div class="footer">This is a computer-generated statement — no signature required. {company}, India.</div>
</body></html>"""


@api_router.get("/wallet/statement/pdf")
async def get_wallet_statement_pdf(user: dict = Depends(get_current_user)):
    """Downloadable wallet statement PDF for the logged-in user."""
    wallet = await db.wallets.find_one({"user_id": user["id"]}, {"_id": 0}) or {}
    txs = await db.wallet_transactions.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    settings = await get_settings()
    html = _build_wallet_statement_html(user, wallet, txs, settings)
    pdf = _html_to_pdf_bytes(html)
    filename = f"Wallet_Statement_{user.get('member_code','user')}_{datetime.now().strftime('%Y%m%d')}.pdf"
    return StreamingResponse(
        iter([pdf]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.get("/admin/invoices/bulk-zip")
async def bulk_invoice_zip(
    year: int, month: int,
    admin: dict = Depends(require_role("super_admin", "company_admin")),
):
    """ZIP of all paid orders' HTML invoices for a period (accountant-friendly)."""
    import json as _json
    import zipfile
    from io import BytesIO

    period = f"{year:04d}-{month:02d}"
    orders = await db.orders.find(
        {"status": {"$in": ["paid", "delivered"]}, "period": period},
        {"_id": 0}
    ).to_list(5000)

    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for o in orders:
            try:
                inv = await get_invoice(o["id"], admin)
                html = _build_invoice_html(inv)
                zf.writestr(f"{inv['invoice_no']}.html", html)
                zf.writestr(f"{inv['invoice_no']}.json", _json.dumps(_build_einvoice_json(inv), indent=2))
            except Exception as e:
                logger.error(f"Skip invoice for {o.get('id')}: {e}")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=METHO_Invoices_{period}.zip"},
    )




# ===================== AI PRODUCT DESCRIPTION =====================
class DescribeRequest(BaseModel):
    name: str
    category: str
    product_type: Optional[str] = "metho"

@api_router.post("/admin/products/generate-description")
async def ai_generate_description(req: DescribeRequest, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    return {"description": _generate_local_description(req.name, req.category, req.product_type)}

# ===================== IMAGE UPLOAD =====================
ALLOWED_IMAGE_EXTS = {"jpg", "jpeg", "png", "webp", "gif"}
MIME_BY_EXT = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"}
MAX_UPLOAD_BYTES = 200 * 1024  # 200 KB
MAX_UPLOAD_LABEL = "200KB"

@api_router.post("/admin/upload/product-image")
async def upload_product_image(
    file: UploadFile = File(...),
    admin: dict = Depends(require_role("super_admin", "company_admin")),
):
    ext = (file.filename or "img.bin").rsplit(".", 1)[-1].lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(status_code=400, detail=f"Only {', '.join(ALLOWED_IMAGE_EXTS)} allowed")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail=f"File too large (max {MAX_UPLOAD_LABEL})")
    content_type = MIME_BY_EXT.get(ext, "application/octet-stream")
    file_uuid = str(uuid.uuid4())
    storage_path = f"{APP_NAME}/product-images/{file_uuid}.{ext}"
    try:
        result = put_object(storage_path, data, content_type)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
    # DB record
    await db.files.insert_one({
        "id": file_uuid,
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": content_type,
        "size": result.get("size", len(data)),
        "uploaded_by": admin["id"],
        "purpose": "product-image",
        "is_deleted": False,
        "created_at": now_iso(),
    })
    # Return a URL that the frontend can put in <img src="...">
    return {
        "id": file_uuid,
        "storage_path": result["path"],
        "url": f"/api/files/{result['path']}",
        "content_type": content_type,
        "size": result.get("size", len(data)),
    }


@api_router.post("/partner/upload/product-image")
async def partner_upload_product_image(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    ext = (file.filename or "img.bin").rsplit(".", 1)[-1].lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(status_code=400, detail=f"Only {', '.join(ALLOWED_IMAGE_EXTS)} allowed")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail=f"File too large (max {MAX_UPLOAD_LABEL})")
    content_type = MIME_BY_EXT.get(ext, "application/octet-stream")
    file_uuid = str(uuid.uuid4())
    storage_path = f"{APP_NAME}/product-images/{file_uuid}.{ext}"
    try:
        result = put_object(storage_path, data, content_type)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
    await db.files.insert_one({
        "id": file_uuid,
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": content_type,
        "size": result.get("size", len(data)),
        "uploaded_by": current_user["id"],
        "purpose": "partner-product-image",
        "is_deleted": False,
        "created_at": now_iso(),
    })
    return {
        "id": file_uuid,
        "storage_path": result["path"],
        "url": f"/api/files/{result['path']}",
        "content_type": content_type,
        "size": result.get("size", len(data)),
    }


# Convenience image upload (API path) - allows admin uploads from PC / mobile
@api_router.post("/upload/image")
async def upload_image(
    file: UploadFile = File(...),
    admin: dict = Depends(require_role("super_admin", "company_admin")),
):
    """Simple image upload for admin users (super_admin, company_admin).
    Saves under uploads and creates a files DB record. Returns a URL usable in <img>.
    """
    ext = (file.filename or "img.bin").rsplit(".", 1)[-1].lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(status_code=400, detail=f"Only {', '.join(ALLOWED_IMAGE_EXTS)} allowed")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail=f"File too large (max {MAX_UPLOAD_LABEL})")
    content_type = MIME_BY_EXT.get(ext, file.content_type or "application/octet-stream")
    file_uuid = str(uuid.uuid4())
    storage_path = f"{APP_NAME}/images/{file_uuid}.{ext}"
    try:
        result = put_object(storage_path, data, content_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
    # DB record
    await db.files.insert_one({
        "id": file_uuid,
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": content_type,
        "size": result.get("size", len(data)),
        "uploaded_by": admin["id"],
        "purpose": "image-upload",
        "is_deleted": False,
        "created_at": now_iso(),
    })
    return {
        "id": file_uuid,
        "storage_path": result["path"],
        "url": f"/api/files/{result['path']}",
        "content_type": content_type,
        "size": result.get("size", len(data)),
    }

# ===================== PUBLIC FILE SERVE =====================
@api_router.get("/files/{path:path}")
async def serve_file(path: str):
    try:
        requested = str(path or "").strip().lstrip("/")
        if not requested or ".." in requested.split("/"):
            raise HTTPException(status_code=404, detail="File not found")

        candidate_paths = [
            requested,
            requested.replace("product_images/", f"{APP_NAME}/product-images/"),
            requested.replace("payment_screenshots/", f"{APP_NAME}/payment-screenshots/"),
            requested.replace("branding_images/", f"{APP_NAME}/branding_images/"),
        ]

        base_dir = LOCAL_STORAGE_DIR.resolve()
        seen = set()
        for rel_path in candidate_paths:
            rel = str(rel_path or "").strip().lstrip("/")
            if not rel or rel in seen:
                continue
            seen.add(rel)

            try:
                fp = (LOCAL_STORAGE_DIR / rel).resolve(strict=False)
            except Exception:
                continue

            if not str(fp).startswith(str(base_dir)):
                continue

            if fp.exists() and fp.is_file():
                media_type = mimetypes.guess_type(str(fp))[0] or "application/octet-stream"
                return FileResponse(path=str(fp), media_type=media_type)
    except HTTPException:
        raise
    except Exception:
        logger.exception("serve_file failed for path=%s", path)

    raise HTTPException(status_code=404, detail="File not found")

@api_router.get("/categories")
async def list_categories():
    cats = await db.categories.find({}, {"_id": 0}).to_list(100)
    return cats

# ===================== ORDERS =====================
def _period_key(dt=None):
    """Returns 'YYYY-MM' for the given datetime (default: now UTC)."""
    dt = dt or datetime.now(timezone.utc)
    return f"{dt.year:04d}-{dt.month:02d}"


RANK_ORDER = ["Starter", "Bronze", "Silver", "Gold", "Diamond"]


async def _compute_downline_bv(user_id: str) -> float:
    """Total business volume from a user's downline (direct sponsees) — same maths as business_stats."""
    downline = await db.users.find({"sponsor_id": user_id}, {"id": 1}).to_list(1000)
    downline_ids = [d["id"] for d in downline]
    if not downline_ids:
        return 0.0
    total_bv = 0.0
    cursor = db.orders.find({"user_id": {"$in": downline_ids}})
    async for o in cursor:
        total_bv += float(o.get("total_bv", 0) or 0)
    return total_bv


async def maybe_promote_user(user_id: str) -> Optional[dict]:
    """Recompute a user's rank from downline BV and settings thresholds. If the new rank is HIGHER
    than the stored one, persist it and log a rank_history event for the celebration feed.
    Returns the promotion event dict if promoted, else None."""
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "name": 1, "member_code": 1, "rank": 1, "role": 1})
    if not user or user.get("role") not in ("member", "leader", None):
        return None
    total_bv = await _compute_downline_bv(user_id)
    settings = await get_settings()
    if total_bv >= float(settings.get("rank_diamond_bv", 999999) or 0): new_rank = "Diamond"
    elif total_bv >= float(settings.get("rank_gold_bv", 999999) or 0): new_rank = "Gold"
    elif total_bv >= float(settings.get("rank_silver_bv", 999999) or 0): new_rank = "Silver"
    elif total_bv >= float(settings.get("rank_bronze_bv", 999999) or 0): new_rank = "Bronze"
    else: new_rank = "Starter"
    old_rank = user.get("rank") or "Starter"
    try:
        if RANK_ORDER.index(new_rank) <= RANK_ORDER.index(old_rank):
            return None
    except ValueError:
        return None  # unknown rank — do not touch
    # Promotion!
    event = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "user_name": user.get("name"),
        "member_code": user.get("member_code"),
        "from_rank": old_rank,
        "to_rank": new_rank,
        "total_bv": round(total_bv, 2),
        "created_at": now_iso(),
    }
    await db.rank_history.insert_one(event)
    await db.users.update_one({"id": user_id}, {"$set": {"rank": new_rank, "rank_updated_at": now_iso()}})
    # audit trail in wallet ledger (informational, no amount)
    await db.wallet_transactions.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "type": "rank_up",
        "amount": 0,
        "description": f"🎉 Rank up — {old_rank} → {new_rank}",
        "ref_rank_event_id": event["id"],
        "created_at": now_iso(),
    })
    return event


async def _credit_order_rewards(order: dict) -> dict:
    """5-bucket commission split + monthly pool accumulation + monthly purchase tracking.
    Commission rate is now per-Associate-Partner (agreed at partner registration).
    METHO products fall back to the global partner_commission_percent (company's own margin).
    Rewards to members/leaders are NOT credited here — only pool balances accumulate.
    Actual member/leader wallet credit happens during the monthly settlement.
    Idempotent per order via `rewards_credited` flag."""
    if order.get("rewards_credited"):
        return order.get("rewards_earned", {})

    # Rewards/percentage calculations happen only when order is attributed to a member.
    user_id = order.get("attributed_member_id") or order.get("user_id")
    if not user_id:
        rewards = {
            "commission_pool": 0.0,
            "member_reward_pool_contribution": 0.0,
            "leader_reward_pool_contribution": 0.0,
            "mps_fund_contribution": 0.0,
            "company_fund": 0.0,
            "technology_reserve": 0.0,
            "per_partner": [],
            "first_partner_cashback": 0.0,
            "period": _period_key(),
            "note": "Guest order without member attribution — no reward/percentage calculation applied.",
        }
        await db.orders.update_one(
            {"id": order["id"]},
            {"$set": {"rewards_credited": True, "rewards_earned": rewards, "credited_at": now_iso(), "period": rewards["period"]}},
        )
        return rewards

    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0}) or {}
    settings = await get_settings()
    total = order.get("total_amount", 0)
    metho_total = order.get("metho_amount", 0)
    period = _period_key()

    # === PER-PARTNER commission calculation ===
    # Walk each item, look up product → partner → commission_percent.
    # This replaces the old flat `settings.partner_commission_percent` blanket rate.
    default_percent = float(settings.get("partner_commission_percent") or 10.0)  # fallback for METHO / legacy items
    commission_pool = 0.0
    per_partner_breakdown = {}  # {partner_id: {"partner_name":..., "sales":..., "commission":..., "percent":...}}
    for it in order.get("items", []):
        product = await db.products.find_one({"id": it["product_id"]}, {"_id": 0}) or {}
        subtotal = float(it.get("subtotal", 0))
        # Determine rate
        rate = default_percent
        partner_id = product.get("partner_id")
        partner_name = None
        if partner_id:
            partner = await db.associate_partners.find_one({"id": partner_id}, {"_id": 0}) or {}
            partner_rate = partner.get("agreement_percent") if partner.get("agreement_percent") is not None else partner.get("commission_percent")
            if partner.get("active", True) and partner_rate is not None:
                rate = float(partner_rate)
                partner_name = partner.get("business_name")
        item_commission = round(subtotal * rate / 100.0, 2)
        commission_pool += item_commission
        # Update per-partner accumulator (for partner sales/commission ledger)
        if partner_id:
            bd = per_partner_breakdown.setdefault(partner_id, {
                "partner_id": partner_id, "partner_name": partner_name,
                "sales": 0.0, "commission": 0.0, "percent": rate,
            })
            bd["sales"] += subtotal
            bd["commission"] += item_commission
    commission_pool = round(commission_pool, 2)

    # Update each partner's sales/commission totals
    for pid, bd in per_partner_breakdown.items():
        await db.associate_partners.update_one(
            {"id": pid},
            {"$inc": {"total_sales": bd["sales"], "total_commission_paid": bd["commission"]}},
        )
        # Partner ledger
        await db.partner_ledger.insert_one({
            "id": str(uuid.uuid4()),
            "partner_id": pid,
            "ref_order_id": order["id"],
            "sales_amount": bd["sales"],
            "commission_amount": bd["commission"],
            "commission_percent": bd["percent"],
            "period": period,
            "created_at": now_iso(),
        })

    # === 5-bucket split (percentages still admin-configurable) ===
    mvr_pool = round(commission_pool * settings["commission_split_member_pool"] / 100.0, 2)
    elr_pool = round(commission_pool * settings["commission_split_leader_pool"] / 100.0, 2)
    mps_contrib = round(commission_pool * settings["commission_split_mps_fund"] / 100.0, 2)
    company_fund_amt = round(commission_pool * settings["commission_split_company_fund"] / 100.0, 2)
    tech_reserve = round(commission_pool * settings["commission_split_technology_reserve"] / 100.0, 2)

    # === Monthly Pool Accumulator (settlement will read from here) ===
    await db.monthly_pools.update_one(
        {"period": period},
        {"$inc": {
            "member_pool": mvr_pool,
            "leader_pool": elr_pool,
            "mps_fund_contribution": mps_contrib,
            "company_fund": company_fund_amt,
            "technology_reserve": tech_reserve,
            "commission_collected": commission_pool,
            "gross_sales": total,
        },
        "$setOnInsert": {"period": period, "settled": False, "created_at": now_iso()}},
        upsert=True,
    )

    # === MPS Fund — global running balance (persists across months) ===
    await db.mps_fund.update_one(
        {"id": "global"},
        {"$inc": {"balance": mps_contrib, "total_contributions": mps_contrib}},
        upsert=True,
    )

    # === Monthly Purchase Tracker (basis for point calculation) ===
    await db.monthly_purchases.update_one(
        {"user_id": user_id, "period": period},
        {"$inc": {"amount": total, "order_count": 1},
         "$setOnInsert": {
             "user_id": user_id, "period": period,
             "user_name": user.get("name"), "member_code": user.get("member_code"),
             "created_at": now_iso(),
         }},
        upsert=True,
    )

    # === Company Ledger (full audit trail) ===
    for bucket_type, amount in (
        ("member_reward_pool", mvr_pool),
        ("leader_reward_pool", elr_pool),
        ("mps_fund", mps_contrib),
        ("company_fund", company_fund_amt),
        ("technology_reserve", tech_reserve),
    ):
        if amount > 0:
            await db.company_ledger.insert_one({
                "id": str(uuid.uuid4()),
                "type": bucket_type,
                "amount": amount,
                "period": period,
                "ref_order_id": order["id"],
                "ref_user_id": user_id,
                "description": f"{bucket_type.replace('_', ' ').title()} contribution from commission",
                "created_at": now_iso(),
            })

    # === Smart Cycle qualification (legacy — METHO product tracking) ===
    if metho_total > 0:
        if user:
            # If 4-slot window is over, this incoming order acts as 5th-slot trigger sale for closing cycle.
            await _auto_settle_cycle_if_due(user, settings, fifth_slot_sale=float(metho_total))
        cycle = await ensure_active_cycle(user_id)
        if int(cycle.get("metho_order_count", 0) or 0) == 0 and float(cycle.get("qualified_volume", 0) or 0) <= 0 and user:
            # First METHO activation in this cycle: inherit sponsor chain slot +1.
            cycle = await _align_cycle_to_sponsor_next_slot(user, cycle, settings)
        await db.personal_cycles.update_one(
            {"id": cycle["id"]},
            {"$inc": {"qualified_volume": metho_total, "metho_order_count": 1}},
        )

    # === First-Partner-Order Cashback (one-time, member-only) ===
    cashback_credited = 0.0
    associate_total = float(order.get("associate_amount", 0) or 0)
    if (
        associate_total > 0
        and user
        and user.get("role") == "member"
        and not user.get("first_partner_cashback_credited")
    ):
        cb_pct = float(settings.get("first_partner_order_cashback_percent") or 0)
        cb_max = float(settings.get("first_partner_order_cashback_max") or 0)
        if cb_pct > 0:
            cashback = round(associate_total * cb_pct / 100.0, 2)
            if cb_max > 0:
                cashback = min(cashback, cb_max)
            if cashback > 0:
                await db.wallets.update_one(
                    {"user_id": user_id},
                    {"$inc": {"balance": cashback, "total_bonus": cashback, "total_income": cashback}},
                    upsert=True,
                )
                await db.wallet_transactions.insert_one({
                    "id": str(uuid.uuid4()),
                    "user_id": user_id,
                    "type": "first_partner_cashback",
                    "amount": cashback,
                    "description": f"First Partner-shop order cashback ({cb_pct}% of ₹{associate_total:.2f})",
                    "ref_order_id": order["id"],
                    "created_at": now_iso(),
                })
                await db.users.update_one(
                    {"id": user_id},
                    {"$set": {"first_partner_cashback_credited": True, "first_partner_cashback_at": now_iso(), "first_partner_cashback_amount": cashback}},
                )
                cashback_credited = cashback

    rewards = {
        "commission_pool": commission_pool,
        "member_reward_pool_contribution": mvr_pool,
        "leader_reward_pool_contribution": elr_pool,
        "mps_fund_contribution": mps_contrib,
        "company_fund": company_fund_amt,
        "technology_reserve": tech_reserve,
        "per_partner": list(per_partner_breakdown.values()),
        "first_partner_cashback": cashback_credited,
        "period": period,
        "note": "Pool contribution accepted — actual member/leader reward will be credited at monthly settlement.",
    }
    await db.orders.update_one(
        {"id": order["id"]},
        {"$set": {"rewards_credited": True, "rewards_earned": rewards, "credited_at": now_iso(), "period": period}},
    )
    # === Rank-up check: buyer and their direct sponsor may now qualify for a higher rank ===
    try:
        await maybe_promote_user(user_id)
        if user and user.get("sponsor_id"):
            await maybe_promote_user(user["sponsor_id"])
    except Exception:
        pass  # never fail the order flow for a promotion check
    return rewards


# ===================== LEADER ELIGIBILITY (admin-defined rules) =====================
async def _team_monthly_purchase(user_id: str, period: str) -> float:
    """Sum of direct downlines' purchases in the given period."""
    downlines = await db.users.find({"sponsor_id": user_id}, {"id": 1, "_id": 0}).to_list(2000)
    if not downlines:
        return 0.0
    ids = [d["id"] for d in downlines]
    pipeline = [
        {"$match": {"user_id": {"$in": ids}, "period": period}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
    ]
    agg = await db.monthly_purchases.aggregate(pipeline).to_list(1)
    return float(agg[0]["total"]) if agg else 0.0


async def _active_members_count(user_id: str, period: str) -> int:
    """How many of user's direct downlines made a purchase this period."""
    downlines = await db.users.find({"sponsor_id": user_id}, {"id": 1, "_id": 0}).to_list(2000)
    if not downlines:
        return 0
    ids = [d["id"] for d in downlines]
    return await db.monthly_purchases.count_documents({
        "user_id": {"$in": ids}, "period": period, "amount": {"$gt": 0},
    })


async def check_leader_eligibility(user_id: str, period: str, settings: dict = None) -> dict:
    """Evaluates dynamic leader criteria. Returns {qualified: bool, checks: {...}, reason: ...}.

    Current business rule: Leader qualification uses only
    1) personal product sales, 2) direct members, 3) team purchase.
    """
    settings = settings or await get_settings()
    await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0}) or {}

    # 1) Direct member count
    direct_count = await db.users.count_documents({"sponsor_id": user_id, "active": True})
    min_direct = int(settings.get("leader_min_direct_members") or 0)

    # 2) Personal product sales (monthly purchases include both METHO and Partner products)
    mp = await db.monthly_purchases.find_one({"user_id": user_id, "period": period}, {"_id": 0}) or {}
    personal_product_sales = float(mp.get("amount", 0))
    min_personal_sales = float(
        settings.get("leader_min_personal_product_sales")
        if settings.get("leader_min_personal_product_sales") is not None
        else (settings.get("leader_min_personal_monthly_purchase") or 0)
    )

    # 3) Team purchase
    team_purchase = await _team_monthly_purchase(user_id, period)
    min_team = float(settings.get("leader_min_team_monthly_purchase") or 0)

    checks = {
        "direct_members": {"actual": direct_count, "required": min_direct, "pass": direct_count >= min_direct},
        "personal_product_sales": {
            "actual": personal_product_sales,
            "required": min_personal_sales,
            "pass": personal_product_sales >= min_personal_sales,
        },
        "team_monthly_purchase": {"actual": team_purchase, "required": min_team, "pass": team_purchase >= min_team},
    }
    qualified = all(c["pass"] for c in checks.values())
    failed = [k for k, v in checks.items() if not v["pass"]]
    return {
        "qualified": qualified,
        "checks": checks,
        "reason": None if qualified else f"Missing: {', '.join(failed)}",
    }


@api_router.post("/orders")
async def create_order(req: OrderRequest, user: Optional[dict] = Depends(get_optional_user)):
    total = 0.0
    metho_total = 0.0  # only METHO products qualify for Smart Cycle Bonus
    associate_total = 0.0
    total_bv = 0.0
    items_out = []
    # Determine which member (if any) this order should be attributed to for BV/rewards
    attributed_member = None
    attributed_member_doc = None
    if user:
        attributed_member = user.get("id")
        attributed_member_doc = user
    else:
        member_id_in = (getattr(req, "member_id", None) or "").strip()
        member_code_in = (getattr(req, "member_code", None) or "").strip().upper()
        if member_id_in:
            attributed_member_doc = await db.users.find_one({"id": member_id_in, "active": True}, {"_id": 0, "password": 0})
        elif member_code_in:
            attributed_member_doc = await db.users.find_one({"member_code": member_code_in, "active": True}, {"_id": 0, "password": 0})
        if member_id_in or member_code_in:
            if not attributed_member_doc:
                raise HTTPException(status_code=400, detail="Invalid Member ID / Member Code")
            attributed_member = attributed_member_doc.get("id")
    for it in req.items:
        p = await db.products.find_one({"id": it.product_id})
        if not p:
            raise HTTPException(status_code=404, detail=f"Product {it.product_id} not found")
        subtotal = p["price"] * it.quantity
        ptype = p.get("product_type", "metho")
        total += subtotal
        # Only count BV/rewards if order is attributed to a member
        if attributed_member:
            total_bv += p.get("bv", 0) * it.quantity
        if ptype == "metho":
            metho_total += subtotal
        else:
            associate_total += subtotal
        items_out.append({
            "product_id": p["id"],
            "product_name": p["name"],
            "product_type": ptype,
            "price": p["price"],
            "quantity": it.quantity,
            "subtotal": subtotal,
            "bv": p.get("bv", 0) * it.quantity,
        })

    # Determine status based on payment info supplied
    payment_method = req.payment_method or "upi"
    has_payment_proof = bool(req.txn_id) and bool(req.payment_screenshot_url)
    order_status = "pending_approval" if has_payment_proof else "pending_payment"

    order = {
        "id": str(uuid.uuid4()),
        "order_no": f"ORD-{datetime.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:6].upper()}",
        "user_id": user["id"] if user else None,
        "user_name": (user.get("name") if user else (req.payer_name or "Guest")),
        "user_email": (user.get("email") if user else None),
        "user_member_code": (user.get("member_code") if user else (attributed_member_doc.get("member_code") if attributed_member_doc else None)),
        # member this order attributed to (for BV/rewards). May be None for guest-no-attribution
        "attributed_member_id": attributed_member,
        "items": items_out,
        "total_amount": total,
        "metho_amount": metho_total,
        "associate_amount": associate_total,
        "total_bv": total_bv if attributed_member else 0.0,
        "shipping_address": req.shipping_address,
        "payment_method": payment_method,
        "txn_id": req.txn_id,
        "payment_screenshot_url": req.payment_screenshot_url,
        "payer_name": req.payer_name or (user.get("name") if user else None),
        "status": order_status,
        "rewards_credited": False,
        "payment_submitted_at": now_iso() if has_payment_proof else None,
        "created_at": now_iso(),
    }
    await db.orders.insert_one(order)
    order.pop("_id", None)
    if order.get("payment_method") == "upi" and order.get("status") == "pending_payment":
        settings = await get_settings()
        order.update(_build_upi_amount_qr(order.get("total_amount", 0), settings, f"Order {order.get('order_no') or order.get('id')}"))
    return order


@api_router.post("/orders/{order_id}/submit-payment")
async def submit_payment(order_id: str, req: OrderRequest, user: dict = Depends(get_current_user)):
    """User submits UPI transaction proof for an existing pending order."""
    order = await db.orders.find_one({"id": order_id, "user_id": user["id"]})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("status") not in ("pending_payment", "rejected"):
        raise HTTPException(status_code=400, detail=f"Cannot submit payment for order in status: {order.get('status')}")
    if not req.txn_id or not req.payment_screenshot_url:
        raise HTTPException(status_code=400, detail="txn_id and payment_screenshot_url are required")
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {
            "txn_id": req.txn_id,
            "payment_screenshot_url": req.payment_screenshot_url,
            "payer_name": req.payer_name or user.get("name"),
            "status": "pending_approval",
            "payment_submitted_at": now_iso(),
            "rejection_reason": None,
        }},
    )
    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return updated


@api_router.get("/admin/orders/pending")
async def admin_pending_orders(admin: dict = Depends(require_role("super_admin", "company_admin"))):
    orders = await db.orders.find(
        {"status": {"$in": ["pending_approval", "pending_payment"]}}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    return orders


@api_router.get("/admin/orders")
async def admin_all_orders(admin: dict = Depends(require_role("super_admin", "company_admin"))):
    orders = await db.orders.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return orders


@api_router.post("/admin/orders/{order_id}/approve")
async def admin_approve_order(order_id: str, req: ApproveRejectOrderRequest, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    order = await db.orders.find_one({"id": order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("status") == "paid":
        return {"success": True, "message": "Already approved", "order_id": order_id}
    if order.get("status") != "pending_approval":
        raise HTTPException(status_code=400, detail=f"Cannot approve order in status: {order.get('status')}")
    rewards = await _credit_order_rewards(order)
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {
            "status": "paid",
            "approved_by": admin["id"],
            "approved_at": now_iso(),
            "admin_note": req.reason,
        }},
    )

    # === Auto-email invoice to buyer ===
    buyer = await db.users.find_one({"id": order["user_id"]}, {"_id": 0, "password": 0}) or {}
    if buyer.get("email"):
        try:
            fresh_order = await db.orders.find_one({"id": order_id}, {"_id": 0})
            inv = await get_invoice(order_id, admin)
            inv_html = _build_invoice_html(inv)
            subject = f"Invoice {inv['invoice_no']} · Order confirmed — METHO AAY-UPAY"
            email_body = f"""<div style='font-family:system-ui,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px'>
<div style='background:#064e3b;color:white;padding:20px;border-radius:8px 8px 0 0'>
  <div style='color:#fbbf24;font-size:11px;letter-spacing:3px;font-weight:700'>ORDER CONFIRMED</div>
  <h1 style='margin:8px 0 0;font-size:24px'>Thank you, {buyer.get('name', 'Member')}!</h1>
</div>
<div style='background:#f0fdf4;padding:20px;border-radius:0 0 8px 8px'>
  <p>Your order <b>{order['order_no']}</b> has been approved and payment verified.</p>
  <div style='background:white;padding:16px;border-radius:6px;margin:16px 0;border-left:4px solid #fbbf24'>
    <div style='font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#059669;font-weight:700'>Invoice</div>
    <div style='font-family:monospace;font-size:16px;color:#064e3b;font-weight:700;margin-top:4px'>{inv['invoice_no']}</div>
    <div style='font-size:22px;font-weight:900;color:#064e3b;margin-top:8px'>₹{inv['grand_total']:,.2f}</div>
    <div style='font-size:11px;color:#475569;margin-top:4px'>{len(inv['items'])} item(s) · CGST ₹{inv['total_cgst']:,.2f} · SGST ₹{inv['total_sgst']:,.2f}</div>
  </div>
  <p style='font-size:13px;color:#475569'>Full tax invoice attached below. You can also view / download it anytime from your dashboard.</p>
  <p style='font-size:12px;color:#64748b;margin-top:16px'>METHO Logistics Pvt. Ltd. · India<br/>GSTIN: {inv['seller']['gst_no']}</p>
</div>
<hr style='margin:24px 0;border:none;border-top:1px dashed #d1d5db'/>
{inv_html}
</div>"""
            await send_transactional_email(buyer["email"], subject, email_body)
        except Exception as e:
            logger.warning(f"Invoice email failed for {order_id}: {e}")

    return {"success": True, "order_id": order_id, "rewards_earned": rewards, "invoice_no": (fresh_order or {}).get("invoice_no") if buyer.get("email") else None}


@api_router.post("/admin/orders/{order_id}/reject")
async def admin_reject_order(order_id: str, req: ApproveRejectOrderRequest, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    order = await db.orders.find_one({"id": order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("status") == "paid":
        raise HTTPException(status_code=400, detail="Cannot reject an already paid order")
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {
            "status": "rejected",
            "rejected_by": admin["id"],
            "rejected_at": now_iso(),
            "rejection_reason": req.reason or "Payment could not be verified",
        }},
    )
    return {"success": True, "order_id": order_id, "reason": req.reason}


# ===================== USER PAYMENT SCREENSHOT UPLOAD =====================
@api_router.post("/upload/payment-screenshot")
async def upload_payment_screenshot(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """Any authenticated user can upload a payment screenshot for their order."""
    ext = (file.filename or "img.bin").rsplit(".", 1)[-1].lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(status_code=400, detail=f"Only {', '.join(ALLOWED_IMAGE_EXTS)} allowed")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail=f"File too large (max {MAX_UPLOAD_LABEL})")
    content_type = MIME_BY_EXT.get(ext, "application/octet-stream")
    file_uuid = str(uuid.uuid4())
    storage_path = f"{APP_NAME}/payment-screenshots/{user['id']}/{file_uuid}.{ext}"
    try:
        result = put_object(storage_path, data, content_type)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
    await db.files.insert_one({
        "id": file_uuid,
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": content_type,
        "size": result.get("size", len(data)),
        "uploaded_by": user["id"],
        "purpose": "payment-screenshot",
        "is_deleted": False,
        "created_at": now_iso(),
    })
    return {
        "id": file_uuid,
        "storage_path": result["path"],
        "url": f"/api/files/{result['path']}",
        "content_type": content_type,
        "size": result.get("size", len(data)),
    }


@api_router.post("/upload/upi-qr")
async def upload_member_upi_qr(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """Any authenticated user can upload their own UPI QR for payout profile."""
    ext = (file.filename or "qr.png").rsplit(".", 1)[-1].lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(status_code=400, detail=f"Only {', '.join(ALLOWED_IMAGE_EXTS)} allowed")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail=f"File too large (max {MAX_UPLOAD_LABEL})")
    content_type = MIME_BY_EXT.get(ext, "application/octet-stream")
    file_uuid = str(uuid.uuid4())
    storage_path = f"{APP_NAME}/member-upi-qr/{user['id']}/{file_uuid}.{ext}"
    try:
        result = put_object(storage_path, data, content_type)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
    await db.files.insert_one({
        "id": file_uuid,
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": content_type,
        "size": result.get("size", len(data)),
        "uploaded_by": user["id"],
        "purpose": "member-upi-qr",
        "is_deleted": False,
        "created_at": now_iso(),
    })
    return {
        "id": file_uuid,
        "storage_path": result["path"],
        "url": f"/api/files/{result['path']}",
        "content_type": content_type,
        "size": result.get("size", len(data)),
    }


# ===================== ADMIN UPI QR UPLOAD =====================
@api_router.post("/admin/upload/upi-qr")
async def upload_upi_qr(
    file: UploadFile = File(...),
    admin: dict = Depends(require_role("super_admin", "company_admin")),
):
    """Upload the merchant UPI QR image that customers scan at checkout."""
    ext = (file.filename or "qr.png").rsplit(".", 1)[-1].lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(status_code=400, detail=f"Only {', '.join(ALLOWED_IMAGE_EXTS)} allowed")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail=f"File too large (max {MAX_UPLOAD_LABEL})")
    content_type = MIME_BY_EXT.get(ext, "application/octet-stream")
    file_uuid = str(uuid.uuid4())
    storage_path = f"{APP_NAME}/upi-qr/{file_uuid}.{ext}"
    try:
        result = put_object(storage_path, data, content_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
    await db.files.insert_one({
        "id": file_uuid, "storage_path": result["path"], "content_type": content_type,
        "purpose": "upi-qr", "uploaded_by": admin["id"], "is_deleted": False,
        "size": result.get("size", len(data)), "original_filename": file.filename,
        "created_at": now_iso(),
    })
    # Also save current UPI QR path into global settings so frontend can display it
    try:
        await db.settings.update_one({"id": "global"}, {"$set": {"upi_qr_url": result["path"], "updated_at": now_iso()}}, upsert=True)
    except Exception:
        # non-fatal
        pass
    return {"url": f"/api/files/{result['path']}", "storage_path": result["path"]}



@api_router.post("/admin/upload/branding-image")
async def upload_branding_image(
    purpose: str,
    file: UploadFile = File(...),
    admin: dict = Depends(require_role("super_admin", "company_admin")),
):
    """Generic image upload for branding assets: site_logo, landing_hero, product_placeholder,
    directory_hero, social_share, etc. `purpose` is stored for audit and organizes storage paths."""
    allowed_purposes = {
        "site_logo", "landing_hero", "product_placeholder", "directory_hero", "social_share",
        "top_leader_1", "top_leader_2", "top_leader_3",
    }
    if purpose not in allowed_purposes:
        raise HTTPException(status_code=400, detail=f"purpose must be one of {sorted(allowed_purposes)}")
    ext = (file.filename or "img.png").rsplit(".", 1)[-1].lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(status_code=400, detail=f"Only {', '.join(ALLOWED_IMAGE_EXTS)} allowed")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail=f"File too large (max {MAX_UPLOAD_LABEL})")
    content_type = MIME_BY_EXT.get(ext, "application/octet-stream")
    file_uuid = str(uuid.uuid4())
    storage_path = f"{APP_NAME}/branding/{purpose}/{file_uuid}.{ext}"
    try:
        result = put_object(storage_path, data, content_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
    await db.files.insert_one({
        "id": file_uuid, "storage_path": result["path"], "content_type": content_type,
        "purpose": f"branding-{purpose}", "uploaded_by": admin["id"], "is_deleted": False,
        "size": result.get("size", len(data)), "original_filename": file.filename,
        "created_at": now_iso(),
    })
    return {"url": f"/api/files/{result['path']}", "storage_path": result["path"], "purpose": purpose}



# ===================== SMART CYCLE ENGINE =====================
async def ensure_active_cycle(user_id: str) -> dict:
    active = await db.personal_cycles.find_one({"user_id": user_id, "status": "active"}, {"_id": 0})
    if active:
        return active
    settings = await get_settings()
    slot_days, total_slots, cycle_days = _smart_cycle_window(settings)
    now = datetime.now(timezone.utc)
    prev_count = await db.personal_cycles.count_documents({"user_id": user_id})
    cycle = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "cycle_number": prev_count + 1,
        "started_at": now.isoformat(),
        "ends_at": (now + timedelta(days=cycle_days)).isoformat(),
        "qualified_volume": 0.0,
        "fifth_slot_volume": 0.0,
        "metho_order_count": 0,
        "slot_days": slot_days,
        "total_slots": total_slots,
        "status": "active",
        "bonus_paid": 0.0,
        "leader_match_paid": 0.0,
    }
    await db.personal_cycles.insert_one(cycle.copy())
    cycle.pop("_id", None)
    return cycle


async def _align_cycle_to_sponsor_next_slot(user_doc: dict, cycle: dict, settings: dict) -> dict:
    """Align first activation slot to sponsor's next slot (wrap after slot-4 to slot-1)."""
    sponsor_id = user_doc.get("sponsor_id")
    if not sponsor_id:
        return cycle

    sponsor_cycle = await db.personal_cycles.find_one({"user_id": sponsor_id, "status": "active"}, {"_id": 0})
    if not sponsor_cycle:
        return cycle

    _, total_slots, _ = _smart_cycle_window(settings)
    sponsor_slot = _compute_cycle_slot(sponsor_cycle, settings)
    target_slot = sponsor_slot + 1 if sponsor_slot < total_slots else 1
    started_at, ends_at = _slot_aligned_window(target_slot, settings)

    await db.personal_cycles.update_one(
        {"id": cycle["id"]},
        {"$set": {
            "started_at": started_at,
            "ends_at": ends_at,
            "activation_slot": target_slot,
            "activation_source_slot": sponsor_slot,
            "activation_source_user_id": sponsor_id,
        }},
    )

    cycle["started_at"] = started_at
    cycle["ends_at"] = ends_at
    cycle["activation_slot"] = target_slot
    cycle["activation_source_slot"] = sponsor_slot
    cycle["activation_source_user_id"] = sponsor_id
    return cycle


@api_router.get("/smart-cycle/me")
async def my_smart_cycle(user: dict = Depends(get_current_user)):
    settings = await get_settings()
    slot_days, total_slots, cycle_days = _smart_cycle_window(settings)
    active = await db.personal_cycles.find_one({"user_id": user["id"], "status": "active"}, {"_id": 0})
    past = await db.personal_cycles.find(
        {"user_id": user["id"], "status": {"$ne": "active"}}, {"_id": 0}
    ).sort("started_at", -1).limit(20).to_list(20)
    now = datetime.now(timezone.utc)

    if not active:
        return {
            "active": False,
            "message": "Purchase a METHO product to activate your Personal Smart Cycle™",
            "settings": {
                "smart_cycle_bonus_percent": settings["smart_cycle_bonus_percent"],
                "leader_match_percent": settings["leader_match_percent"],
                "smart_cycle_days": cycle_days,
                "smart_cycle_slot_days": slot_days,
                "smart_cycle_total_slots": total_slots,
            },
            "past_cycles": past,
        }

    ends = datetime.fromisoformat(active["ends_at"])
    started = datetime.fromisoformat(active["started_at"])
    total_days = max(1, (ends - started).days)
    elapsed = max(0, (now - started).days)
    current_slot = min(total_slots, (elapsed // slot_days) + 1)
    days_remaining = max(0, int((ends - now).total_seconds() // 86400))
    eligible = now >= ends

    est_bonus = round(float(active.get("fifth_slot_volume", 0) or 0) * settings["smart_cycle_bonus_percent"] / 100.0, 2)
    est_leader_match = round(est_bonus * settings["leader_match_percent"] / 100.0, 2)

    return {
        "active": True,
        "cycle": active,
        "current_slot": current_slot,
        "current_week": current_slot,
        "total_slots": total_slots,
        "settlement_trigger_slot": total_slots + 1,
        "activation_slot": active.get("activation_slot"),
        "activation_source_slot": active.get("activation_source_slot"),
        "activation_source_user_id": active.get("activation_source_user_id"),
        "fifth_slot_volume": float(active.get("fifth_slot_volume", 0) or 0),
        "own_cycle_sale_base": float(active.get("fifth_slot_volume", 0) or 0),
        "direct_match_base_bonus": est_bonus,
        "days_remaining": days_remaining,
        "elapsed_days": elapsed,
        "total_days": total_days,
        "progress_percent": round(min(100, (elapsed / total_days) * 100), 2),
        "eligible_for_settlement": eligible,
        "estimated_bonus": est_bonus,
        "estimated_leader_match": est_leader_match,
        "settings": {
            "smart_cycle_bonus_percent": settings["smart_cycle_bonus_percent"],
            "leader_match_percent": settings["leader_match_percent"],
            "smart_cycle_days": cycle_days,
            "smart_cycle_slot_days": slot_days,
            "smart_cycle_total_slots": total_slots,
        },
        "past_cycles": past,
    }


async def _settle_cycle_doc(cycle: dict, user_doc: dict, settings: dict, force: bool = False) -> dict:
    now = datetime.now(timezone.utc)
    now_str = now.isoformat()
    ends = datetime.fromisoformat(cycle["ends_at"])
    if not force and now < ends:
        raise HTTPException(status_code=400, detail=f"Cycle not yet complete. Ends {cycle['ends_at']}")

    qualified = float(cycle.get("fifth_slot_volume", 0.0) or 0.0)
    if qualified <= 0:
        await db.personal_cycles.update_one(
            {"id": cycle["id"]},
            {"$set": {"status": "expired", "settled_at": now_str}},
        )
        await ensure_active_cycle(user_doc["id"])
        return {
            "settled": True,
            "bonus": 0.0,
            "leader_match": 0.0,
            "own_cycle_sale_base": 0.0,
            "direct_match_base_bonus": 0.0,
            "message": "Cycle expired with no 5th-slot METHO sales",
        }

    bonus = round(qualified * settings["smart_cycle_bonus_percent"] / 100.0, 2)
    sponsor_id = user_doc.get("sponsor_id")
    leader_match = round(bonus * settings["leader_match_percent"] / 100.0, 2) if sponsor_id else 0.0

    # Credit member with Smart Cycle Bonus
    await db.wallets.update_one(
        {"user_id": user_doc["id"]},
        {"$inc": {"balance": bonus, "total_income": bonus, "total_bonus": bonus}},
    )
    await db.wallet_transactions.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user_doc["id"],
        "type": "smart_cycle_bonus",
        "amount": bonus,
        "description": f"Smart Cycle Bonus™ — Cycle #{cycle.get('cycle_number', '?')} 5th Slot (₹{qualified:,.2f} × {settings['smart_cycle_bonus_percent']}%)",
        "ref_cycle_id": cycle["id"],
        "created_at": now_str,
    })

    # Credit sponsor with Leader Match Reward
    if leader_match > 0 and sponsor_id:
        await db.wallets.update_one(
            {"user_id": sponsor_id},
            {"$inc": {"balance": leader_match, "total_income": leader_match, "total_bonus": leader_match}},
        )
        await db.wallet_transactions.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": sponsor_id,
            "type": "leader_match_reward",
            "amount": leader_match,
            "description": f"Leader Match Reward™ from {user_doc.get('name', 'downline')} — Cycle #{cycle.get('cycle_number', '?')}",
            "ref_cycle_id": cycle["id"],
            "ref_user_id": user_doc["id"],
            "created_at": now_str,
        })

    await db.personal_cycles.update_one(
        {"id": cycle["id"]},
        {"$set": {
            "status": "settled",
            "settled_at": now_str,
            "bonus_paid": bonus,
            "leader_match_paid": leader_match,
        }},
    )
    # Auto-start next cycle
    await ensure_active_cycle(user_doc["id"])
    return {
        "settled": True,
        "bonus": bonus,
        "leader_match": leader_match,
        "cycle_number": cycle.get("cycle_number"),
        "own_cycle_sale_base": qualified,
        "direct_match_base_bonus": bonus,
    }


async def _auto_settle_cycle_if_due(user_doc: dict, settings: dict, fifth_slot_sale: float = 0.0) -> Optional[dict]:
    """Auto-close a completed cycle before recording new cycle volume."""
    cycle = await db.personal_cycles.find_one({"user_id": user_doc["id"], "status": "active"})
    if not cycle:
        return None
    try:
        ends = datetime.fromisoformat(cycle["ends_at"])
    except Exception:
        return None
    if datetime.now(timezone.utc) < ends:
        return None
    if fifth_slot_sale > 0:
        await db.personal_cycles.update_one(
            {"id": cycle["id"]},
            {"$inc": {"fifth_slot_volume": float(fifth_slot_sale)}},
        )
        cycle["fifth_slot_volume"] = float(cycle.get("fifth_slot_volume", 0) or 0) + float(fifth_slot_sale)
    return await _settle_cycle_doc(cycle, user_doc, settings, force=True)


@api_router.post("/smart-cycle/settle")
async def settle_my_cycle(user: dict = Depends(get_current_user)):
    settings = await get_settings()
    cycle = await db.personal_cycles.find_one({"user_id": user["id"], "status": "active"})
    if not cycle:
        raise HTTPException(status_code=400, detail="No active Smart Cycle. Make a METHO purchase to start.")
    return await _settle_cycle_doc(cycle, user, settings, force=False)


@api_router.post("/admin/smart-cycle/settle-user/{user_id}")
async def admin_settle_user_cycle(user_id: str, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    """Admin override — settle a user's cycle even if not yet at end date (for testing / manual payout)."""
    settings = await get_settings()
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    cycle = await db.personal_cycles.find_one({"user_id": user_id, "status": "active"})
    if not cycle:
        raise HTTPException(status_code=400, detail="No active cycle for this user")
    return await _settle_cycle_doc(cycle, target, settings, force=True)


@api_router.post("/admin/smart-cycle/settle-all")
async def admin_settle_all_eligible(admin: dict = Depends(require_role("super_admin", "company_admin"))):
    """Cron-like: settle every cycle whose end date has passed."""
    settings = await get_settings()
    now_str = datetime.now(timezone.utc).isoformat()
    cycles = await db.personal_cycles.find({"status": "active", "ends_at": {"$lte": now_str}}).to_list(1000)
    settled_count = 0
    total_bonus = 0.0
    total_leader_match = 0.0
    for c in cycles:
        u = await db.users.find_one({"id": c["user_id"]})
        if not u:
            continue
        r = await _settle_cycle_doc(c, u, settings, force=True)
        settled_count += 1
        total_bonus += r.get("bonus", 0) or 0
        total_leader_match += r.get("leader_match", 0) or 0
    return {"settled_count": settled_count, "total_bonus_paid": total_bonus, "total_leader_match_paid": total_leader_match}


@api_router.get("/orders")
async def my_orders(user: dict = Depends(get_current_user)):
    orders = await db.orders.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return orders

# ===================== GENEALOGY =====================
async def build_tree(user_id: str, depth: int = 0, max_depth: int = 5):
    if depth > max_depth:
        return None
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    if not u:
        return None
    children = await db.users.find({"sponsor_id": user_id}, {"_id": 0, "password": 0}).to_list(50)
    child_trees = []
    for c in children:
        ct = await build_tree(c["id"], depth + 1, max_depth)
        if ct:
            child_trees.append(ct)
    return {
        "id": u["id"],
        "name": u["name"],
        "member_code": u["member_code"],
        "rank": u.get("rank", "Starter"),
        "kyc_status": u.get("kyc_status", "pending"),
        "children": child_trees,
    }

@api_router.get("/genealogy/tree")
async def get_tree(user: dict = Depends(get_current_user)):
    tree = await build_tree(user["id"])
    return tree or {"id": user["id"], "name": user["name"], "children": []}

# ===================== BUSINESS ENGINE =====================
@api_router.get("/business/stats")
async def business_stats(user: dict = Depends(get_current_user)):
    # Compute business volume from downline orders
    downline = await db.users.find({"sponsor_id": user["id"]}, {"id": 1}).to_list(500)
    downline_ids = [d["id"] for d in downline]
    total_bv = 0.0
    total_orders = 0
    if downline_ids:
        cursor = db.orders.find({"user_id": {"$in": downline_ids}})
        async for o in cursor:
            total_bv += o.get("total_bv", 0)
            total_orders += 1
    wallet = await db.wallets.find_one({"user_id": user["id"]}, {"_id": 0}) or {}
    # MPS (Monthly Performance Score) - simplified
    mps = round(total_bv / 100, 2) if total_bv else 0
    # Dynamic rank calculation based on settings
    settings = await get_settings()
    if total_bv >= settings["rank_diamond_bv"]: rank = "Diamond"
    elif total_bv >= settings["rank_gold_bv"]: rank = "Gold"
    elif total_bv >= settings["rank_silver_bv"]: rank = "Silver"
    elif total_bv >= settings["rank_bronze_bv"]: rank = "Bronze"
    else: rank = "Starter"
    # Do not overwrite existing higher rank (e.g. seeded admin)
    current_rank = user.get("rank", "Starter")
    return {
        "total_business_volume": total_bv,
        "total_downline_orders": total_orders,
        "direct_downline": len(downline_ids),
        "mps": mps,
        "rank": current_rank,
        "computed_rank": rank,
        "wallet_balance": wallet.get("balance", 0),
        "total_income": wallet.get("total_income", 0),
        "total_bonus": wallet.get("total_bonus", 0),
        "rank_thresholds": {
            "Bronze": settings["rank_bronze_bv"],
            "Silver": settings["rank_silver_bv"],
            "Gold": settings["rank_gold_bv"],
            "Diamond": settings["rank_diamond_bv"],
        },
    }

@api_router.get("/business/cycle")
async def business_cycle(user: dict = Depends(get_current_user)):
    # Business Cycle - track cumulative BV in current cycle (per month simplified)
    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    downline = await db.users.find({"sponsor_id": user["id"]}, {"id": 1}).to_list(500)
    downline_ids = [d["id"] for d in downline] + [user["id"]]
    cycle_bv = 0.0
    cursor = db.orders.find({"user_id": {"$in": downline_ids}, "created_at": {"$gte": month_start}})
    async for o in cursor:
        cycle_bv += o.get("total_bv", 0)
    settings = await get_settings()
    target = settings["cycle_target_bv"]
    progress = min(round((cycle_bv / target) * 100, 2), 100) if target else 0
    return {
        "cycle": datetime.now(timezone.utc).strftime("%B %Y"),
        "cycle_bv": cycle_bv,
        "target_bv": target,
        "progress_percentage": progress,
        "reward_at_target": settings["cycle_reward_text"],
    }

# ===================== DASHBOARD =====================
@api_router.get("/dashboard/overview")
async def dashboard_overview(user: dict = Depends(get_current_user)):
    wallet = await db.wallets.find_one({"user_id": user["id"]}, {"_id": 0}) or {}
    downline_count = await db.users.count_documents({"sponsor_id": user["id"]})
    orders_count = await db.orders.count_documents({"user_id": user["id"]})
    recent_tx = await db.wallet_transactions.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).limit(5).to_list(5)
    # Chart data - last 7 days income
    chart_data = []
    for i in range(6, -1, -1):
        day = datetime.now(timezone.utc) - timedelta(days=i)
        day_str = day.strftime("%Y-%m-%d")
        day_start = day.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        day_end = day.replace(hour=23, minute=59, second=59).isoformat()
        cursor = db.wallet_transactions.find({
            "user_id": user["id"],
            "created_at": {"$gte": day_start, "$lte": day_end},
            "amount": {"$gt": 0},
        })
        day_total = 0
        async for t in cursor:
            day_total += t.get("amount", 0)
        chart_data.append({"day": day.strftime("%a"), "income": round(day_total, 2)})
    return {
        "wallet_balance": wallet.get("balance", 0),
        "total_income": wallet.get("total_income", 0),
        "total_bonus": wallet.get("total_bonus", 0),
        "total_withdrawn": wallet.get("total_withdrawn", 0),
        "downline_count": downline_count,
        "orders_count": orders_count,
        "rank": user.get("rank", "Starter"),
        "kyc_status": user.get("kyc_status", "pending"),
        "recent_transactions": recent_tx,
        "income_chart": chart_data,
    }

# ===================== ADMIN =====================
@api_router.get("/admin/stats")
async def admin_stats(admin: dict = Depends(require_role("super_admin", "company_admin"))):
    total_users = await db.users.count_documents({})
    total_orders = await db.orders.count_documents({})
    total_products = await db.products.count_documents({})
    pending_kyc = await db.users.count_documents({"kyc_status": "pending"})
    pending_wd = await db.withdrawals.count_documents({"status": "pending"})
    all_orders = await db.orders.find({}, {"_id": 0}).to_list(2000)
    total_revenue = sum(o.get("total_amount", 0) for o in all_orders)
    metho_revenue = sum(o.get("metho_amount", 0) for o in all_orders)
    associate_revenue = sum(o.get("associate_amount", 0) for o in all_orders)
    # Company reserve
    ledger = await db.company_ledger.find({}, {"_id": 0}).to_list(5000)
    total_company_reserve = sum(l.get("amount", 0) for l in ledger)
    # Smart Cycle stats
    active_cycles = await db.personal_cycles.count_documents({"status": "active"})
    settled_cycles = await db.personal_cycles.count_documents({"status": "settled"})
    return {
        "total_users": total_users,
        "total_orders": total_orders,
        "total_products": total_products,
        "pending_kyc": pending_kyc,
        "pending_withdrawals": pending_wd,
        "total_revenue": total_revenue,
        "metho_revenue": metho_revenue,
        "associate_revenue": associate_revenue,
        "total_company_reserve": total_company_reserve,
        "active_smart_cycles": active_cycles,
        "settled_smart_cycles": settled_cycles,
    }

@api_router.get("/admin/company-ledger")
async def admin_company_ledger(admin: dict = Depends(require_role("super_admin", "company_admin"))):
    entries = await db.company_ledger.find({}, {"_id": 0}).sort("created_at", -1).limit(500).to_list(500)
    total = sum(e.get("amount", 0) for e in entries)
    return {"entries": entries, "total_reserve": total}

# ===================== SETTINGS =====================
@api_router.get("/settings")
async def read_settings():
    """Public read — used by frontend to render dynamic labels (currency, cycle target, etc)."""
    s = await get_settings()
    return s

@api_router.put("/settings")
async def update_settings(req: SettingsUpdate, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    current = await get_settings()
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    if "product_categories" in updates:
        updates["product_categories"] = normalize_product_categories(updates["product_categories"])
    # Validate percentages 0..100
    for pct_key in ("smart_cycle_bonus_percent", "leader_match_percent", "partner_commission_percent",
                    "commission_split_member_pool", "commission_split_leader_pool",
                    "commission_split_mps_fund", "commission_split_company_fund",
                    "commission_split_technology_reserve"):
        if pct_key in updates and (updates[pct_key] < 0 or updates[pct_key] > 100):
            raise HTTPException(status_code=400, detail=f"{pct_key} must be between 0 and 100")
    for bv_key in ("min_withdrawal", "cycle_target_bv", "rank_bronze_bv", "rank_silver_bv", "rank_gold_bv", "rank_diamond_bv", "leader_min_personal_product_sales"):
        if bv_key in updates and updates[bv_key] < 0:
            raise HTTPException(status_code=400, detail=f"{bv_key} must be non-negative")
    if "smart_cycle_days" in updates and updates["smart_cycle_days"] < 1:
        raise HTTPException(status_code=400, detail="smart_cycle_days must be >= 1")
    if "smart_cycle_slot_days" in updates and updates["smart_cycle_slot_days"] < 1:
        raise HTTPException(status_code=400, detail="smart_cycle_slot_days must be >= 1")
    if "smart_cycle_total_slots" in updates and updates["smart_cycle_total_slots"] < 1:
        raise HTTPException(status_code=400, detail="smart_cycle_total_slots must be >= 1")
    # Validate 5-bucket commission split sums to 100
    split_keys = ("commission_split_member_pool", "commission_split_leader_pool",
                  "commission_split_mps_fund", "commission_split_company_fund",
                  "commission_split_technology_reserve")
    if any(k in updates for k in split_keys):
        merged = {**current, **updates}
        total_split = sum(merged.get(k, 0) for k in split_keys)
        if abs(total_split - 100.0) > 0.01:
            raise HTTPException(status_code=400, detail=f"Commission split must sum to 100 (got {total_split})")

    # Keep backward-compatible key synced from slot-based cycle config.
    if any(k in updates for k in ("smart_cycle_slot_days", "smart_cycle_total_slots", "smart_cycle_days")):
        merged = {**current, **updates}
        slot_days = max(1, int(merged.get("smart_cycle_slot_days") or 7))
        total_slots = max(1, int(merged.get("smart_cycle_total_slots") or 4))
        if "smart_cycle_days" in updates and "smart_cycle_total_slots" not in updates and "smart_cycle_slot_days" not in updates:
            requested_days = max(1, int(updates.get("smart_cycle_days") or 1))
            total_slots = max(1, int(round(requested_days / slot_days)))
        updates["smart_cycle_slot_days"] = slot_days
        updates["smart_cycle_total_slots"] = total_slots
        updates["smart_cycle_days"] = slot_days * total_slots

    # Keep leader personal sales keys in sync (new explicit key + legacy key).
    if "leader_min_personal_product_sales" in updates and "leader_min_personal_monthly_purchase" not in updates:
        updates["leader_min_personal_monthly_purchase"] = updates["leader_min_personal_product_sales"]
    if "leader_min_personal_monthly_purchase" in updates and "leader_min_personal_product_sales" not in updates:
        updates["leader_min_personal_product_sales"] = updates["leader_min_personal_monthly_purchase"]
    changed_keys = sorted(updates.keys())
    before_values = {key: current.get(key) for key in changed_keys}
    updates["updated_at"] = now_iso()
    await db.settings.update_one({"id": "global"}, {"$set": updates}, upsert=True)
    updated = await get_settings()
    await log_admin_action(
        admin,
        action="settings_update",
        module="settings",
        summary=f"Updated settings: {', '.join(changed_keys)}",
        target_id="global",
        metadata={
            "changed_keys": changed_keys,
            "before": before_values,
            "after": {key: updated.get(key) for key in changed_keys},
        },
    )
    return updated

# ===================== SEED =====================
async def _seed_admin():
    admin_exists = await db.users.find_one({"email": "methopvtltd@gmail.com"}) or await db.users.find_one({"email": "admin@metho.com"})
    if admin_exists:
        return False
    admin_id = str(uuid.uuid4())
    await db.users.insert_one({
        "id": admin_id,
        "name": "METHO Admin",
        "email": "admin@metho.com",
        "phone": "+919999999999",
        "password": hash_password("admin123"),
        "role": "super_admin",
        "member_code": "MTH-ADMIN",
        "sponsor_id": None,
        "kyc_status": "approved",
        "rank": "Diamond",
        "active": True,
        "created_at": now_iso(),
    })
    await db.wallets.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": admin_id,
        "balance": 0,
        "total_income": 0,
        "total_bonus": 0,
        "total_withdrawn": 0,
        "member_value_points": 0,
        "elite_leader_points": 0,
        "mps_shield_balance": 0,
        "created_at": now_iso(),
    })
    return True


@api_router.post("/seed")
async def seed_data():
    # Backfill product_type for legacy products
    await db.products.update_many({"product_type": {"$exists": False}}, {"$set": {"product_type": "metho"}})
    has_associate = await db.products.count_documents({"product_type": "associate_partner"})
    has_metho = await db.products.count_documents({"product_type": "metho"})

    if has_metho > 0 and has_associate > 0:
        await _seed_admin()
        return {"seeded": False, "message": "Already seeded"}

    if has_metho == 0:
        categories = [
            {"id": str(uuid.uuid4()), "name": "Health & Wellness", "slug": "health"},
            {"id": str(uuid.uuid4()), "name": "Beauty & Personal Care", "slug": "beauty"},
            {"id": str(uuid.uuid4()), "name": "Home & Kitchen", "slug": "home"},
            {"id": str(uuid.uuid4()), "name": "Nutrition", "slug": "nutrition"},
            {"id": str(uuid.uuid4()), "name": "Utilities", "slug": "utilities"},
        ]
        await db.categories.insert_many(categories)

        metho_products = [
            {"id": str(uuid.uuid4()), "name": "METHO Ayurvedic Immunity Booster", "category": "Health & Wellness", "price": 1200, "bv": 60, "stock": 100, "product_type": "metho", "description": "প্রাকৃতিক আয়ুর্বেদিক herbs দিয়ে immunity বাড়ান — নিয়মিত সেবনে শরীর সুস্থ থাকে।\n\nBoost your immunity naturally with authentic Ayurvedic herbs from India.", "image_url": "https://images.unsplash.com/photo-1584362917165-526a968579e8?w=600", "created_at": now_iso()},
            {"id": str(uuid.uuid4()), "name": "AAY Glow Face Serum (Kesar & Neem)", "category": "Beauty & Personal Care", "price": 850, "bv": 40, "stock": 75, "product_type": "metho", "description": "কেশর ও নিমের গুণাগুণে তৈরি face serum — উজ্জ্বল ও দাগমুক্ত ত্বকের জন্য।\n\nRadiant, blemish-free skin with saffron and neem botanical extracts.", "image_url": "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=600", "created_at": now_iso()},
            {"id": str(uuid.uuid4()), "name": "UPAY Pure Kashmiri Honey (500g)", "category": "Nutrition", "price": 650, "bv": 30, "stock": 150, "product_type": "metho", "description": "কাশ্মীরের উপত্যকা থেকে সংগৃহীত ১০০% খাঁটি রাউ মধু।\n\n100% pure raw honey sourced from the Kashmir valleys — no additives.", "image_url": "https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=600", "created_at": now_iso()},
            {"id": str(uuid.uuid4()), "name": "Herbal Weight Care Tea", "category": "Health & Wellness", "price": 480, "bv": 20, "stock": 200, "product_type": "metho", "description": "আয়ুর্বেদিক herbs-এর tea — সুস্থ ওজন নিয়ন্ত্রণে দৈনিক পাণীয়।\n\nAyurvedic weight-management tea, perfect for daily wellness routine.", "image_url": "https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=600", "created_at": now_iso()},
            {"id": str(uuid.uuid4()), "name": "METHO Kitchen Combo Set", "category": "Home & Kitchen", "price": 2400, "bv": 100, "stock": 50, "product_type": "metho", "description": "উন্নতমানের stainless steel — বাড়ির রান্নাঘরের সম্পূর্ণ সেট।\n\nPremium stainless steel kitchen essentials designed for Indian households.", "image_url": "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=600", "created_at": now_iso()},
            {"id": str(uuid.uuid4()), "name": "AAY Multivitamin Capsule", "category": "Nutrition", "price": 950, "bv": 45, "stock": 120, "product_type": "metho", "description": "প্রতিদিনের পুষ্টি এক capsule-এ — Vitamin A থেকে Zinc সব একসাথে।\n\nComplete daily nutrition in one capsule — from Vitamin A to Zinc.", "image_url": "https://images.unsplash.com/photo-1550572017-edd951b55104?w=600", "created_at": now_iso()},
        ]
        await db.products.insert_many(metho_products)

    if has_associate == 0:
        associate_products = [
            {"id": str(uuid.uuid4()), "name": "Basmati Rice (10kg)", "category": "Home & Kitchen", "price": 800, "bv": 0, "stock": 300, "product_type": "associate_partner", "description": "Associate Partner-এর দোকান থেকে সেরা মানের বাসমতি চাল।\n\nPremium basmati rice from our Approved Associate Partner network.", "image_url": "https://images.unsplash.com/photo-1586201375761-83865001e31c?w=600", "created_at": now_iso()},
            {"id": str(uuid.uuid4()), "name": "Partner Mobile Recharge ₹500", "category": "Utilities", "price": 500, "bv": 0, "stock": 999, "product_type": "associate_partner", "description": "Associate Partner network-এর মাধ্যমে যেকোনো মোবাইল recharge।\n\nInstant mobile recharge via our Associate Partner network — all operators supported.", "image_url": "https://images.unsplash.com/photo-1512428559087-560fa5ceab42?w=600", "created_at": now_iso()},
            {"id": str(uuid.uuid4()), "name": "Partner Grocery Combo", "category": "Home & Kitchen", "price": 1500, "bv": 0, "stock": 100, "product_type": "associate_partner", "description": "একটি combo-তে দৈনন্দিন সব প্রয়োজনীয় জিনিস।\n\nEveryday grocery essentials from your local Associate Partner store.", "image_url": "https://images.unsplash.com/photo-1542838132-92c53300491e?w=600", "created_at": now_iso()},
        ]
        await db.products.insert_many(associate_products)

    await _seed_admin()
    total_products = await db.products.count_documents({})
    return {"seeded": True, "message": "Seed complete", "products": total_products}

@api_router.get("/")
async def root():
    return {"app": "METHO AAY-UPAY ERP v3.0", "status": "running", "by": "METHO Logistics Pvt. Ltd."}


# ===================== MONTHLY SETTLEMENT ENGINE =====================
# Business Formula:
#   Member Point       = Monthly Purchase ÷ 100
#   Total Member Pts   = Σ of all eligible member points
#   Member Point Value = Member Reward Pool ÷ Total Member Points  (dynamic per month)
#   Member Reward      = Member Points × Member Point Value
#   (Same formulas apply for Leaders, with Admin-defined eligibility rules)
#
# All percentages, thresholds, and rules are read from Settings — NOTHING is hardcoded.

async def _compute_settlement(period: str, settings: dict) -> dict:
    """Pure calculation — used by both preview & execute. Does NOT credit wallets."""
    pool_doc = await db.monthly_pools.find_one({"period": period}, {"_id": 0}) or {}
    member_pool = float(pool_doc.get("member_pool", 0))
    leader_pool = float(pool_doc.get("leader_pool", 0))
    mps_contribution = float(pool_doc.get("mps_fund_contribution", 0))
    company_fund = float(pool_doc.get("company_fund", 0))
    tech_reserve = float(pool_doc.get("technology_reserve", 0))
    already_settled = bool(pool_doc.get("settled", False))

    # === Member points (every purchasing member is eligible) ===
    purchases = await db.monthly_purchases.find({"period": period, "amount": {"$gt": 0}}, {"_id": 0}).to_list(50000)
    member_lines = []
    total_member_points = 0.0
    for p in purchases:
        points = round(float(p["amount"]) / 100.0, 4)
        member_lines.append({
            "user_id": p["user_id"], "user_name": p.get("user_name"), "member_code": p.get("member_code"),
            "monthly_purchase": float(p["amount"]), "points": points,
        })
        total_member_points += points
    member_point_value = round(member_pool / total_member_points, 4) if total_member_points > 0 else 0.0
    for m in member_lines:
        m["reward"] = round(m["points"] * member_point_value, 2)

    # === Leader points (eligibility gate applied via Admin rules) ===
    leader_lines = []
    total_leader_points = 0.0
    for p in purchases:
        elig = await check_leader_eligibility(p["user_id"], period, settings=settings)
        if not elig["qualified"]:
            continue
        points = round(float(p["amount"]) / 100.0, 4)
        leader_lines.append({
            "user_id": p["user_id"], "user_name": p.get("user_name"), "member_code": p.get("member_code"),
            "monthly_purchase": float(p["amount"]), "points": points,
            "eligibility": elig["checks"],
        })
        total_leader_points += points
    leader_point_value = round(leader_pool / total_leader_points, 4) if total_leader_points > 0 else 0.0
    for l in leader_lines:
        l["reward"] = round(l["points"] * leader_point_value, 2)

    return {
        "period": period,
        "already_settled": already_settled,
        "pool_snapshot": {
            "member_pool": member_pool, "leader_pool": leader_pool,
            "mps_fund_contribution": mps_contribution, "company_fund": company_fund,
            "technology_reserve": tech_reserve,
            "commission_collected": float(pool_doc.get("commission_collected", 0)),
            "gross_sales": float(pool_doc.get("gross_sales", 0)),
        },
        "member_settlement": {
            "total_points": round(total_member_points, 4),
            "point_value": member_point_value,
            "total_reward_distributed": round(sum(m["reward"] for m in member_lines), 2),
            "lines": member_lines,
        },
        "leader_settlement": {
            "total_points": round(total_leader_points, 4),
            "point_value": leader_point_value,
            "total_reward_distributed": round(sum(l["reward"] for l in leader_lines), 2),
            "qualified_count": len(leader_lines),
            "lines": leader_lines,
        },
    }


@api_router.get("/admin/settlement/preview")
async def settlement_preview(
    year: int = None, month: int = None,
    admin: dict = Depends(require_role("super_admin", "company_admin")),
):
    """Preview what the settlement would credit — no state change."""
    if year is None or month is None:
        now = datetime.now(timezone.utc)
        year, month = now.year, now.month
    period = f"{year:04d}-{month:02d}"
    settings = await get_settings()
    result = await _compute_settlement(period, settings)
    result["preview"] = True
    return result


@api_router.post("/admin/settlement/execute")
async def settlement_execute(
    year: int, month: int,
    admin: dict = Depends(require_role("super_admin", "company_admin")),
):
    """Execute the settlement — credits wallets, generates ledger + report. Idempotent."""
    period = f"{year:04d}-{month:02d}"
    settings = await get_settings()

    pool_doc = await db.monthly_pools.find_one({"period": period}, {"_id": 0}) or {}
    if pool_doc.get("settled"):
        raise HTTPException(status_code=400, detail=f"Period {period} is already settled.")

    result = await _compute_settlement(period, settings)

    # === Credit member wallets + ledger ===
    for line in result["member_settlement"]["lines"]:
        if line["reward"] <= 0:
            continue
        await db.wallets.update_one(
            {"user_id": line["user_id"]},
            {"$inc": {
                "balance": line["reward"],
                "total_income": line["reward"],
                "total_bonus": line["reward"],
                "member_reward_credited": line["reward"],
            }},
        )
        await db.wallet_transactions.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": line["user_id"],
            "type": "member_reward_settlement",
            "amount": line["reward"],
            "description": f"Monthly Member Reward · {period} · {line['points']} points × ₹{result['member_settlement']['point_value']}",
            "period": period,
            "created_at": now_iso(),
        })

    # === Credit leader wallets + ledger ===
    for line in result["leader_settlement"]["lines"]:
        if line["reward"] <= 0:
            continue
        await db.wallets.update_one(
            {"user_id": line["user_id"]},
            {"$inc": {
                "balance": line["reward"],
                "total_income": line["reward"],
                "total_bonus": line["reward"],
                "leader_reward_credited": line["reward"],
            }},
        )
        await db.wallet_transactions.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": line["user_id"],
            "type": "leader_reward_settlement",
            "amount": line["reward"],
            "description": f"Monthly Leader Reward · {period} · {line['points']} points × ₹{result['leader_settlement']['point_value']}",
            "period": period,
            "created_at": now_iso(),
        })

    # === Mark period as settled ===
    settlement_doc = {
        "id": str(uuid.uuid4()),
        "period": period,
        "year": year,
        "month": month,
        "settled_at": now_iso(),
        "settled_by": admin["id"],
        "settled_by_name": admin.get("name"),
        "pool_snapshot": result["pool_snapshot"],
        "member_settlement": result["member_settlement"],
        "leader_settlement": result["leader_settlement"],
        "settings_snapshot": {k: settings.get(k) for k in [
            "partner_commission_percent",
            "commission_split_member_pool", "commission_split_leader_pool",
            "commission_split_mps_fund", "commission_split_company_fund",
            "commission_split_technology_reserve",
            "leader_min_direct_members", "leader_min_active_members",
            "leader_min_personal_product_sales",
            "leader_min_personal_monthly_purchase", "leader_min_team_monthly_purchase",
            "leader_min_active_days",
        ]},
    }
    await db.monthly_settlements.insert_one(settlement_doc.copy())
    await db.monthly_pools.update_one(
        {"period": period},
        {"$set": {"settled": True, "settled_at": now_iso(), "settled_by": admin["id"]}},
    )

    settlement_doc.pop("_id", None)
    await log_admin_action(
        admin,
        action="settlement_execute",
        module="settlement",
        summary=f"Executed settlement for {period}",
        target_id=period,
        metadata={
            "period": period,
            "member_total_reward": result["member_settlement"].get("total_reward_distributed"),
            "leader_total_reward": result["leader_settlement"].get("total_reward_distributed"),
        },
    )
    return {"success": True, "settlement": settlement_doc}


@api_router.get("/admin/settlements")
async def list_settlements(admin: dict = Depends(require_role("super_admin", "company_admin"))):
    docs = await db.monthly_settlements.find({}, {"_id": 0}).sort("period", -1).to_list(120)
    return docs


@api_router.get("/admin/company-ledger")
async def get_company_ledger(
    year: Optional[int] = None, month: Optional[int] = None,
    admin: dict = Depends(require_role("super_admin", "company_admin")),
):
    """Full ledger of all pool contributions. Filter by period if year/month provided."""
    query = {}
    if year and month:
        query["period"] = f"{year:04d}-{month:02d}"
    entries = await db.company_ledger.find(query, {"_id": 0}).sort("created_at", -1).to_list(5000)
    summary = {}
    for e in entries:
        t = e.get("type", "unknown")
        summary[t] = summary.get(t, 0) + float(e.get("amount", 0))
    return {"entries": entries, "summary": summary, "total": sum(summary.values()), "count": len(entries)}


@api_router.get("/admin/monthly-pool/{period}")
async def get_monthly_pool(period: str, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    """View live running pool for a given period (YYYY-MM)."""
    doc = await db.monthly_pools.find_one({"period": period}, {"_id": 0})
    return doc or {"period": period, "member_pool": 0, "leader_pool": 0, "mps_fund_contribution": 0}


# ===================== SCHEDULER: month-end settlement alert =====================
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

_scheduler = None

async def _check_pending_settlements():
    """Runs daily; if previous month's pool exists and is not settled after 3rd of new month, log alert.
    Does NOT auto-execute (safety) — creates dashboard notification for admin review."""
    now = datetime.now(timezone.utc)
    # Compute previous period
    prev_month = now.month - 1 if now.month > 1 else 12
    prev_year = now.year if now.month > 1 else now.year - 1
    period = f"{prev_year:04d}-{prev_month:02d}"
    pool = await db.monthly_pools.find_one({"period": period}, {"_id": 0})
    if not pool or pool.get("settled"):
        return
    # Alert if past 3rd day of new month
    if now.day < 3:
        return
    existing = await db.notifications.find_one({"type": "settlement_pending", "period": period})
    if existing:
        return
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "type": "settlement_pending",
        "period": period,
        "message": f"Monthly settlement for {period} is pending. Please review & execute from Settlement page.",
        "severity": "warning",
        "created_at": now_iso(),
        "read": False,
    })
    logger.info(f"[cron] Settlement pending alert created for {period}")


@app.on_event("startup")
async def start_scheduler():
    global _scheduler
    if _scheduler:
        return
    _scheduler = AsyncIOScheduler(timezone="UTC")
    # Daily at 02:00 UTC (07:30 IST)
    _scheduler.add_job(_check_pending_settlements, CronTrigger(hour=2, minute=0))
    _scheduler.start()
    logger.info("Scheduler started — daily settlement check at 02:00 UTC")


@api_router.get("/admin/notifications")
async def list_admin_notifications(admin: dict = Depends(require_role("super_admin", "company_admin"))):
    docs = await db.notifications.find({}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return docs


@api_router.get("/admin/audit-logs")
async def list_admin_audit_logs(
    admin: dict = Depends(require_role("super_admin", "company_admin")),
    module: Optional[str] = None,
    action: Optional[str] = None,
    actor_id: Optional[str] = None,
    limit: int = 100,
):
    query = {}
    if module:
        query["module"] = module
    if action:
        query["action"] = action
    if actor_id:
        query["actor_id"] = actor_id
    docs = await db.admin_audit_logs.find(query, {"_id": 0}).sort("created_at", -1).to_list(max(1, min(int(limit or 100), 500)))
    return docs


@api_router.get("/admin/system-health")
async def admin_system_health(admin: dict = Depends(require_role("super_admin", "company_admin"))):
    stats = await admin_stats(admin)
    notifications = await db.notifications.find({}, {"_id": 0}).sort("created_at", -1).to_list(10)
    audit_logs = await db.admin_audit_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(10)
    ai_requests = await db.ai_upgrade_requests.find({}, {"_id": 0}).sort("created_at", -1).to_list(10)
    pending_partner_requests = await db.partner_requests.count_documents({"status": "pending"})
    pending_product_approvals = await db.products.count_documents({"approval_status": "pending"})
    pending_orders = await db.orders.count_documents({"status": {"$in": ["pending_payment", "pending_approval"]}})
    pending_mps_claims = await db.mps_claims.count_documents({"status": "pending"})
    health_items = [
        {
            "key": "pending_withdrawals",
            "label": "Pending Withdrawals",
            "value": stats["pending_withdrawals"],
            "severity": "high" if stats["pending_withdrawals"] > 10 else "normal",
        },
        {
            "key": "pending_kyc",
            "label": "Pending KYC",
            "value": stats["pending_kyc"],
            "severity": "warning" if stats["pending_kyc"] > 0 else "normal",
        },
        {
            "key": "pending_partner_requests",
            "label": "Pending Partner Requests",
            "value": pending_partner_requests,
            "severity": "warning" if pending_partner_requests > 0 else "normal",
        },
        {
            "key": "pending_product_approvals",
            "label": "Pending Product Approvals",
            "value": pending_product_approvals,
            "severity": "warning" if pending_product_approvals > 0 else "normal",
        },
        {
            "key": "pending_orders",
            "label": "Pending Orders",
            "value": pending_orders,
            "severity": "warning" if pending_orders > 0 else "normal",
        },
        {
            "key": "pending_mps_claims",
            "label": "Pending MPS Claims",
            "value": pending_mps_claims,
            "severity": "warning" if pending_mps_claims > 0 else "normal",
        },
    ]
    severity_rank = {"high": 3, "warning": 2, "normal": 1}
    highest = max(health_items, key=lambda item: severity_rank[item["severity"]], default={"severity": "normal"})
    overall_status = "attention" if highest.get("severity") == "high" else "watch" if highest.get("severity") == "warning" else "healthy"
    return {
        "overall_status": overall_status,
        "summary": {
            **stats,
            "pending_partner_requests": pending_partner_requests,
            "pending_product_approvals": pending_product_approvals,
            "pending_orders": pending_orders,
            "pending_mps_claims": pending_mps_claims,
        },
        "health_items": health_items,
        "recent_notifications": notifications,
        "recent_audit_logs": audit_logs,
        "recent_ai_requests": [_normalize_ai_upgrade_doc(doc) for doc in ai_requests],
        "generated_at": now_iso(),
    }


@api_router.get("/admin/ai-upgrade/requests")
async def list_ai_upgrade_requests(admin: dict = Depends(require_role("super_admin", "company_admin"))):
    docs = await db.ai_upgrade_requests.find({}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return [_normalize_ai_upgrade_doc(doc) for doc in docs]


@api_router.post("/admin/ai-upgrade/plan")
async def create_ai_upgrade_plan(req: AIUpgradePromptRequest, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    plan = _build_ai_upgrade_plan(req, admin)
    await db.ai_upgrade_requests.insert_one(plan.copy())
    await log_admin_action(
        admin,
        action="ai_upgrade_plan_create",
        module="ai_upgrade",
        summary=f"Created AI upgrade plan {plan['title']}",
        target_id=plan["id"],
        metadata={"risk_level": plan.get("risk_level"), "change_type": plan.get("change_type"), "affected_areas": plan.get("affected_areas")},
    )
    plan.pop("_id", None)
    return _normalize_ai_upgrade_doc(plan)


@api_router.post("/admin/ai-upgrade/requests/{request_id}/status")
async def update_ai_upgrade_request_status(
    request_id: str,
    req: AIUpgradeStatusUpdateRequest,
    admin: dict = Depends(require_role("super_admin", "company_admin")),
):
    existing = await db.ai_upgrade_requests.find_one({"id": request_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="AI upgrade request not found")
    update_payload = {
        "status": req.status,
        "admin_note": (req.admin_note or "").strip(),
        "updated_at": now_iso(),
        "reviewed_by": admin["id"],
        "reviewed_by_name": admin.get("name"),
    }
    await db.ai_upgrade_requests.update_one({"id": request_id}, {"$set": update_payload})
    updated = await db.ai_upgrade_requests.find_one({"id": request_id}, {"_id": 0})
    await log_admin_action(
        admin,
        action="ai_upgrade_status_update",
        module="ai_upgrade",
        summary=f"Marked AI upgrade request {request_id} as {req.status}",
        target_id=request_id,
        metadata={"status": req.status, "admin_note": (req.admin_note or "").strip()},
    )
    return _normalize_ai_upgrade_doc(updated)


@api_router.post("/admin/ai-upgrade/requests/{request_id}/generate-draft")
async def generate_ai_upgrade_draft_patch(
    request_id: str,
    admin: dict = Depends(require_role("super_admin", "company_admin")),
):
    existing = await db.ai_upgrade_requests.find_one({"id": request_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="AI upgrade request not found")
    normalized = _normalize_ai_upgrade_doc(existing)
    draft_patch_preview = _build_draft_patch_preview(
        normalized.get("prompt") or "",
        normalized.get("affected_areas") or [],
        normalized.get("suggested_files") or [],
        normalized.get("risk_level") or "low",
    )
    draft_patch_notes = _build_draft_patch_notes(
        normalized.get("change_type") or "analysis",
        normalized.get("risk_level") or "low",
    )
    test_preview = _build_test_preview(
        normalized.get("affected_areas") or [],
        normalized.get("validation_checks") or [],
        normalized.get("risk_level") or "low",
    )
    updates = {
        "draft_patch_preview": draft_patch_preview,
        "draft_patch_notes": draft_patch_notes,
        "test_preview": test_preview,
        "draft_patch_generated_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.ai_upgrade_requests.update_one({"id": request_id}, {"$set": updates})
    updated = await db.ai_upgrade_requests.find_one({"id": request_id}, {"_id": 0})
    await log_admin_action(
        admin,
        action="ai_upgrade_generate_draft",
        module="ai_upgrade",
        summary=f"Generated draft patch preview for AI request {request_id}",
        target_id=request_id,
        metadata={"files": [item.get("file") for item in draft_patch_preview], "test_count": len(test_preview)},
    )
    return _normalize_ai_upgrade_doc(updated)


# ===================== MPS FUND & CLAIMS =====================
async def _get_mps_balance() -> dict:
    doc = await db.mps_fund.find_one({"id": "global"}, {"_id": 0}) or {}
    approved_claims = float(doc.get("total_approved_claims", 0))
    contributions = float(doc.get("total_contributions", 0))
    balance = float(doc.get("balance", 0))
    return {
        "balance": balance,
        "total_contributions": contributions,
        "total_approved_claims": approved_claims,
    }


@api_router.get("/admin/mps-fund")
async def mps_fund_status(admin: dict = Depends(require_role("super_admin", "company_admin"))):
    settings = await get_settings()
    balance = await _get_mps_balance()
    return {
        **balance,
        "rules": {k: settings.get(k) for k in [
            "mps_min_active_months", "mps_min_monthly_purchase",
            "mps_max_claim_amount", "mps_min_claim_gap_days",
            "mps_benefit_duration_months",
        ]},
    }


class MPSClaimRequest(BaseModel):
    user_id: str
    amount: float
    reason: str
    supporting_doc_url: Optional[str] = None
    claim_type: Optional[Literal["standard", "nominee_emergency"]] = "standard"
    event_type: Optional[Literal["death", "critical_medical"]] = None
    nominee_name: Optional[str] = None
    nominee_relation: Optional[str] = None
    nominee_phone: Optional[str] = None


@api_router.post("/admin/mps-claims")
async def create_mps_claim(req: MPSClaimRequest, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    user = await db.users.find_one({"id": req.user_id}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if req.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    settings = await get_settings()
    max_claim = float(settings.get("mps_max_claim_amount") or 0)
    if max_claim > 0 and req.amount > max_claim:
        raise HTTPException(status_code=400, detail=f"Amount exceeds admin-configured max claim (₹{max_claim})")

    claim_type = (req.claim_type or "standard").strip().lower()
    event_type = (req.event_type or "").strip().lower() or None
    if claim_type == "nominee_emergency":
        role = (user.get("role") or "").strip().lower()
        rank = (user.get("rank") or "").strip().lower()
        is_leader = role == "leader" or rank in ("bronze", "silver", "gold", "diamond")
        if not is_leader:
            raise HTTPException(status_code=400, detail="Nominee emergency claim is allowed only after user becomes Leader")
        if event_type not in ("death", "critical_medical"):
            raise HTTPException(status_code=400, detail="event_type must be death or critical_medical for nominee emergency claim")
        if not (req.nominee_name and req.nominee_relation):
            raise HTTPException(status_code=400, detail="Nominee name and relation are required for nominee emergency claim")
        if not req.supporting_doc_url:
            raise HTTPException(status_code=400, detail="Supporting document is required for nominee emergency claim")

    claim = {
        "id": str(uuid.uuid4()),
        "user_id": req.user_id,
        "user_name": user.get("name"),
        "member_code": user.get("member_code"),
        "amount": req.amount,
        "reason": req.reason,
        "supporting_doc_url": req.supporting_doc_url,
        "claim_type": claim_type,
        "event_type": event_type,
        "nominee": {
            "name": req.nominee_name,
            "relation": req.nominee_relation,
            "phone": req.nominee_phone,
        },
        "status": "pending",
        "requested_at": now_iso(),
        "requested_by": admin["id"],
    }
    await db.mps_claims.insert_one(claim.copy())
    claim.pop("_id", None)
    return claim


@api_router.get("/admin/mps-claims")
async def list_mps_claims(status_filter: Optional[str] = None, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    query = {"status": status_filter} if status_filter else {}
    docs = await db.mps_claims.find(query, {"_id": 0}).sort("requested_at", -1).to_list(500)
    return docs


class ClaimDecisionRequest(BaseModel):
    note: Optional[str] = None


@api_router.post("/admin/mps-claims/{claim_id}/approve")
async def approve_mps_claim(claim_id: str, req: ClaimDecisionRequest, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    claim = await db.mps_claims.find_one({"id": claim_id})
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Claim already {claim['status']}")

    balance_info = await _get_mps_balance()
    if balance_info["balance"] < claim["amount"]:
        raise HTTPException(status_code=400, detail=f"Insufficient MPS Fund balance (₹{balance_info['balance']:.2f})")

    # Deduct from MPS Fund
    await db.mps_fund.update_one(
        {"id": "global"},
        {"$inc": {"balance": -claim["amount"], "total_approved_claims": claim["amount"]}},
    )
    # Credit user wallet
    await db.wallets.update_one(
        {"user_id": claim["user_id"]},
        {"$inc": {"balance": claim["amount"], "total_income": claim["amount"]}},
    )
    await db.wallet_transactions.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": claim["user_id"],
        "type": "mps_claim_payout",
        "amount": claim["amount"],
        "description": f"MPS Fund payout — {claim['reason']}",
        "ref_claim_id": claim_id,
        "created_at": now_iso(),
    })
    await db.mps_claims.update_one(
        {"id": claim_id},
        {"$set": {
            "status": "approved", "approved_at": now_iso(), "approved_by": admin["id"],
            "decision_note": req.note,
        }},
    )
    return {"success": True, "claim_id": claim_id, "amount_paid": claim["amount"]}


@api_router.post("/admin/mps-claims/{claim_id}/reject")
async def reject_mps_claim(claim_id: str, req: ClaimDecisionRequest, admin: dict = Depends(require_role("super_admin", "company_admin"))):
    claim = await db.mps_claims.find_one({"id": claim_id})
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Claim already {claim['status']}")
    await db.mps_claims.update_one(
        {"id": claim_id},
        {"$set": {
            "status": "rejected", "rejected_at": now_iso(), "rejected_by": admin["id"],
            "decision_note": req.note or "Rejected by admin",
        }},
    )
    return {"success": True, "claim_id": claim_id, "status": "rejected"}


@api_router.get("/wallet/monthly-projection")
async def my_monthly_projection(user: dict = Depends(get_current_user)):
    """Show the member their current-month accumulated points & projected reward (real-time)."""
    period = _period_key()
    settings = await get_settings()
    pool_doc = await db.monthly_pools.find_one({"period": period}, {"_id": 0}) or {}
    mp = await db.monthly_purchases.find_one({"user_id": user["id"], "period": period}, {"_id": 0}) or {}
    my_purchase = float(mp.get("amount", 0))
    my_points = round(my_purchase / 100.0, 4)

    # Total member points across everyone this period
    all_purchases = await db.monthly_purchases.find({"period": period, "amount": {"$gt": 0}}, {"_id": 0, "amount": 1}).to_list(50000)
    total_points = round(sum(float(p["amount"]) / 100.0 for p in all_purchases), 4)
    member_pool = float(pool_doc.get("member_pool", 0))
    projected_point_value = round(member_pool / total_points, 4) if total_points > 0 else 0.0
    projected_reward = round(my_points * projected_point_value, 2)

    # Leader qualification snapshot
    leader_status = await check_leader_eligibility(user["id"], period, settings=settings)

    return {
        "period": period,
        "my_monthly_purchase": my_purchase,
        "my_points": my_points,
        "total_member_points": total_points,
        "member_pool_balance": member_pool,
        "projected_point_value": projected_point_value,
        "projected_member_reward": projected_reward,
        "leader_qualification": leader_status,
    }


# ===================== MOUNT =====================
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


