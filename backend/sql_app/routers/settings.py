import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AppSetting

router = APIRouter(prefix="/api", tags=["settings"])


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
    "min_withdrawal": 100,
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
    "landing_tagline": "",
    "landing_subheading": "",
    "landing_show_metho_store": True,
    "landing_show_partner_shop": True,
    "product_placeholder_image_url": "",
    "directory_hero_image_url": "",
    "social_share_image_url": "",
    "top_leader_1_name": "",
    "top_leader_1_title": "MD",
    "top_leader_1_image_url": "",
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


@router.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    return load_settings(db)
