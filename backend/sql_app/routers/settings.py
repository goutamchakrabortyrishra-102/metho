import json
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AppSetting
from ..meta_ads import encrypt_secret, resolve_config
from .auth import get_current_user

router = APIRouter(prefix="/api", tags=["settings"])
ADMIN_ROLES = {"super_admin", "company_admin", "admin"}

PUBLIC_SETTINGS_EXCLUDE_KEYS = {
    "razorpay_key_secret",
    "einvoice_api_key",
    "einvoice_client_secret",
    "einvoice_password",
    "customer_order_access_secret",
}

DATA_URL_MAX_LEN = 4_000_000

PUBLIC_BRANDING_DATA_KEYS = {
    "site_logo_url",
    "landing_hero_image_url",
    "landing_tourism_banner_image_url",
    "directory_hero_image_url",
    "product_placeholder_image_url",
    "social_share_image_url",
    "top_leader_1_image_url",
    "top_leader_2_image_url",
    "top_leader_3_image_url",
    "top_leader_4_image_url",
    "top_leader_5_image_url",
    "top_leader_6_image_url",
}


DEFAULT_SETTINGS = {
    "site_title": "METHO AAY-UPAY",
    "company_name": "METHO Logistics Pvt Ltd",
    "company_address": "India",
    "company_state": "West Bengal",
    "company_state_code": "19",
    "company_email": "admin@metho.com",
    "company_gst_no": "",
    "company_pan": "",
    "invoice_terms": "",
    "currency": "INR",
    "currency_symbol": "₹",
    "smart_cycle_bonus_percent": 10,
    "leader_match_percent": 50,
    "smart_cycle_days": 28,
    "cycle_target_bv": 10000,
    "cycle_reward_text": "10% Smart Cycle Bonus",
    "metho_commission_percent": 10,
    "metho_delivery_smart_cycle_percent": 0,
    "metho_delivery_reward_pool_percent": 0,
    "metho_rider_share_percent": 70,
    "metho_transport_rates": {"bike": 12, "e_rickshaw": 16, "auto_rickshaw": 20, "delivery": 14},
    "min_withdrawal": 100,
    "withdrawal_tds_percent": 5,
    "withdrawal_admin_charge_percent": 3,
    "rank_bronze_bv": 5000,
    "rank_silver_bv": 20000,
    "rank_gold_bv": 50000,
    "rank_diamond_bv": 100000,
    "commission_split_member_pool": 40,
    "commission_split_leader_pool": 20,
    "commission_split_mps_fund": 10,
    "commission_split_company_fund": 20,
    "commission_split_technology_reserve": 10,
    "referral_signup_bonus": 0,
    "first_partner_order_cashback_percent": 0,
    "first_partner_order_cashback_max": 0,
    "customer_mobile_order_access_enabled": True,
    "customer_mobile_access_mode": "mobile_only",
    "customer_order_session_minutes": 720,
    "customer_order_otp_ttl_seconds": 300,
    "customer_order_otp_length": 6,
    "customer_order_otp_max_attempts": 5,
    "customer_order_otp_debug_mode": True,
    "customer_order_access_secret": "",
    "leader_min_direct_members": 0,
    "leader_min_active_members": 0,
    "leader_min_personal_monthly_purchase": 0,
    "leader_min_team_monthly_purchase": 0,
    "leader_min_active_days": 0,
    "mps_min_active_months": 0,
    "mps_min_monthly_purchase": 0,
    "mps_max_claim_amount": 0,
    "mps_min_claim_gap_days": 0,
    "mps_benefit_duration_months": 0,
    "product_categories": [
        "Health & Wellness",
        "Beauty & Personal Care",
        "Home & Kitchen",
        "Nutrition",
        "Utilities",
    ],
    "vegetable_categories": [
        "Leafy Vegetables",
        "Root Vegetables",
        "Fruit Vegetables",
        "Cruciferous Vegetables",
        "Herbs & Greens",
        "Other Vegetables",
    ],
    "category_delivery_rules": {},
    "partner_registration_custom_options": {
        "service_sectors": [],
        "shop_sectors": [],
        "service_templates_by_sector": {},
        "shop_templates_by_sector": {},
    },
    "product_pricing_tiers": {},
    "enable_partner_slab_pricing": False,
    "upi_id": "methopvtltd@paytm",
    "upi_payee_name": "METHO Logistics Pvt Ltd",
    "upi_qr_url": "",
    "metho_bank_account_holder": "",
    "metho_bank_name": "",
    "metho_bank_branch": "",
    "metho_bank_account_number": "",
    "metho_bank_ifsc": "",
    "referral_message_template": "Join METHO using my sponsor code {sponsor_code}: {referral_link}",
    "mission_statement": "",
    "vision_statement": "",
    "return_policy": "",
    "partner_agreement_policy": "",
    "site_logo_url": "",
    "landing_hero_image_url": "",
    "landing_tourism_banner_image_url": "",
    "landing_metho_delivery_banner_image_url": "",
    "landing_tagline": "",
    "landing_subheading": "",
    "company_youtube_url": "",
    "company_facebook_url": "",
    "landing_top_product_ids": [],
    "landing_featured_partner_ids": [],
    "landing_featured_store_ids": [],
    "landing_show_metho_store": True,
    "landing_show_partner_shop": True,
    "product_placeholder_image_url": "",
    "directory_hero_image_url": "",
    "social_share_image_url": "",
    "top_leader_1_name": "",
    "top_leader_1_title": "MD",
    "top_leader_2_name": "",
    "top_leader_2_title": "CEO",
    "top_leader_2_image_url": "",
    "top_leader_3_name": "",
    "top_leader_3_title": "Mentor",
    "top_leader_3_image_url": "",
    "top_leader_4_name": "",
    "top_leader_4_title": "",
    "top_leader_4_image_url": "",
    "top_leader_5_name": "",
    "top_leader_5_title": "",
    "top_leader_5_image_url": "",
    "top_leader_6_name": "",
    "top_leader_6_title": "",
    "top_leader_6_image_url": "",
    "einvoice_enabled": False,
    "einvoice_provider": "mock",
    "einvoice_sandbox": True,
    "einvoice_api_url": "",
    "einvoice_api_key": "",
    "einvoice_client_id": "",
    "einvoice_client_secret": "",
    "einvoice_gstin": "",
    "einvoice_username": "",
    "einvoice_password": "",
    "rules_and_conditions": (
        "1. Rewards follow company policy and eligibility rules.\n"
        "2. Fraudulent activity may lead to account action.\n"
        "3. Policies may be updated with notice."
    ),
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_settings(db: Session) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == "global").first()
    if not row:
        payload = DEFAULT_SETTINGS.copy()
        db.add(AppSetting(key="global", value_json=json.dumps(payload), updated_at=datetime.now(timezone.utc)))
        db.commit()
        return payload

    try:
        payload = json.loads(row.value_json or "{}")
    except Exception:
        payload = {}

    changed = False
    for key, value in DEFAULT_SETTINGS.items():
        if payload.get(key) is None:
            payload[key] = value
            changed = True
    if changed:
        row.value_json = json.dumps(payload)
        row.updated_at = datetime.now(timezone.utc)
        db.commit()
    return payload


def save_settings(db: Session, patch: dict) -> dict:
    current = load_settings(db)
    current.update(patch or {})
    row = db.query(AppSetting).filter(AppSetting.key == "global").first()
    row.value_json = json.dumps(current)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    current["updated_at"] = _now_iso()
    return current


def _sanitize_public_settings(payload: dict) -> dict:
    safe: dict = {}
    for key, value in (payload or {}).items():
        if key in PUBLIC_SETTINGS_EXCLUDE_KEYS:
            continue
        if key in PUBLIC_BRANDING_DATA_KEYS:
            text = str(value or "").strip()
            if text.startswith("data:") and len(text) > DATA_URL_MAX_LEN:
                safe[key] = ""
                continue
        safe[key] = value
    return safe


@router.get("/settings")
def get_settings(authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    payload = load_settings(db)
    if str(authorization or "").strip():
        return payload
    return _sanitize_public_settings(payload)


@router.get("/settings/public")
def get_public_settings(db: Session = Depends(get_db)):
    return _sanitize_public_settings(load_settings(db))


def _require_admin(current_user):
    if getattr(current_user, "role", "") not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")


def _mask_secret(value: str) -> str:
    text = str(value or "")
    return f"{'*' * max(8, len(text) - 4)}{text[-4:]}" if text else ""


@router.get("/admin/settings/meta")
def get_meta_settings(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    config = resolve_config(db)
    return {
        "enabled": config["enabled"],
        "page_id": config["page_id"],
        "app_id": config["app_id"],
        "graph_api_version": config["graph_api_version"],
        "default_assignee_id": config["default_assignee_id"],
        "verify_token_masked": _mask_secret(config["verify_token"]),
        "app_secret_masked": _mask_secret(config["app_secret"]),
        "access_token_masked": _mask_secret(config["access_token"]),
        "configured": bool(config["verify_token"] and config["app_secret"] and config["access_token"] and config["page_id"]),
    }


@router.put("/admin/settings/meta")
def update_meta_settings(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    data = payload if isinstance(payload, dict) else {}
    current_row = db.query(AppSetting).filter(AppSetting.key == "meta_integration").first()
    try:
        current = json.loads(current_row.value_json or "{}") if current_row else {}
    except json.JSONDecodeError:
        current = {}
    next_config = {
        "enabled": bool(data.get("enabled", current.get("enabled", True))),
        "page_id": str(data.get("page_id", current.get("page_id", "")) or "").strip(),
        "app_id": str(data.get("app_id", current.get("app_id", "")) or "").strip(),
        "graph_api_version": str(data.get("graph_api_version", current.get("graph_api_version", "v20.0")) or "v20.0").strip(),
        "default_assignee_id": str(data.get("default_assignee_id", current.get("default_assignee_id", "")) or "").strip(),
    }
    secret_update_requested = any(str(data.get(field) or "").strip() for field in ("verify_token", "app_secret", "access_token"))
    if secret_update_requested and not os.getenv("META_SETTINGS_ENCRYPTION_KEY", "").strip():
        raise HTTPException(status_code=503, detail="META_SETTINGS_ENCRYPTION_KEY is required to save Meta secrets")
    for field in ("verify_token", "app_secret", "access_token"):
        value = str(data.get(field) or "").strip()
        if value:
            next_config[field] = encrypt_secret(value)
        elif current.get(field):
            next_config[field] = current[field]
    if not current_row:
        current_row = AppSetting(key="meta_integration", value_json=json.dumps(next_config), updated_at=datetime.now(timezone.utc))
        db.add(current_row)
    else:
        current_row.value_json = json.dumps(next_config)
        current_row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return get_meta_settings(db, current_user)


@router.post("/admin/settings/meta/test")
def run_meta_settings_test(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    config = resolve_config(db)
    missing = [key for key in ("verify_token", "app_secret", "access_token", "page_id") if not config.get(key)]
    if missing:
        return {"ok": False, "configured": False, "missing": missing}
    return {"ok": True, "configured": True, "page_id": config["page_id"], "graph_api_version": config["graph_api_version"], "message": "Meta configuration is present; no external API call was made."}
