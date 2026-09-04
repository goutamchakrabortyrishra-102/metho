import json
import logging
import os
from datetime import datetime, timezone
from urllib.error import HTTPError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AppSetting
from ..meta_ads import encrypt_secret, resolve_config, test_meta_config
from ..voice_caller import PROFILE_KEYS, resolve_voice_config, validate_voice_config
from .auth import get_current_user

router = APIRouter(prefix="/api", tags=["settings"])
logger = logging.getLogger(__name__)
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
    "metho_transport_rates": {"bike": 12, "e_rickshaw": 16, "auto_rickshaw": 20, "four_wheeler": 24, "bolero_maxx": 28, "vehicle_207": 30, "vehicle_407": 36, "dumper": 45, "delivery": 14},
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
    default_rates = DEFAULT_SETTINGS["metho_transport_rates"]
    saved_rates = payload.get("metho_transport_rates")
    if not isinstance(saved_rates, dict):
        payload["metho_transport_rates"] = dict(default_rates)
        changed = True
    else:
        for rate_key, rate_value in default_rates.items():
            if saved_rates.get(rate_key) is None:
                saved_rates[rate_key] = rate_value
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


def _json_path_value(payload, path: str):
    value = payload
    for key in filter(None, path.split(".")):
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def _voice_test_request(config: dict) -> Request:
    endpoint = str(config.get("test_endpoint_url") or "").strip()
    parsed = urlsplit(endpoint)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("Test endpoint URL must be a valid HTTPS URL.")
    auth_type = str(config.get("auth_type") or "").strip()
    credential_name = str(config.get("auth_header_name") or "").strip()
    if not credential_name or "\r" in credential_name or "\n" in credential_name:
        raise ValueError("Authentication header or query parameter name is invalid.")
    headers = {"Accept": "application/json"}
    if auth_type == "bearer_token":
        headers[credential_name] = f"Bearer {config['api_key']}"
    elif auth_type == "custom_header":
        headers[credential_name] = config["api_key"]
    elif auth_type == "api_key_query_param":
        query = parse_qsl(parsed.query, keep_blank_values=True)
        query.append((credential_name, config["api_key"]))
        endpoint = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment))
    else:
        raise ValueError("Authentication type is invalid.")
    method = str(config.get("test_http_method") or "").upper()
    if method not in {"GET", "POST"}:
        raise ValueError("HTTP method must be GET or POST.")
    return Request(endpoint, data=b"{}" if method == "POST" else None, headers=headers, method=method)


@router.get("/admin/settings/voice-caller")
def get_voice_caller_settings(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    config = resolve_voice_config(db)
    missing = validate_voice_config(config)
    return {key: config[key] for key in ("enabled", "provider", "caller_id", "bengali_voice", "hindi_voice", "model", "max_call_attempts", "retry_delay_minutes", *PROFILE_KEYS)} | {"api_key_masked": _mask_secret(config["api_key"]), "api_secret_masked": _mask_secret(config["api_secret"]), "configured": not missing, "missing": missing}


@router.put("/admin/settings/voice-caller")
def update_voice_caller_settings(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    try:
        data = payload if isinstance(payload, dict) else {}
        current_row = db.query(AppSetting).filter(AppSetting.key == "ai_voice_caller").first()
        try:
            current = json.loads(current_row.value_json or "{}") if current_row else {}
        except json.JSONDecodeError:
            current = {}
        if not isinstance(current, dict):
            current = {}
        get_value = lambda field, alias: data.get(field, data.get(alias, current.get(field, "")))
        next_config = {
            "enabled": bool(data.get("enabled", current.get("enabled", False))),
            "provider": str(get_value("provider", "provider") or "mock").strip().lower(),
            "caller_id": str(get_value("caller_id", "callerId") or "").strip(),
            "bengali_voice": str(get_value("bengali_voice", "bengaliVoice") or "").strip(),
            "hindi_voice": str(get_value("hindi_voice", "hindiVoice") or "").strip(),
            "model": str(get_value("model", "model") or "").strip(),
            "max_call_attempts": max(1, min(5, int(get_value("max_call_attempts", "maxCallAttempts") or 1))),
            "retry_delay_minutes": max(1, min(10080, int(get_value("retry_delay_minutes", "retryDelayMinutes") or 60))),
        }
        for key in PROFILE_KEYS:
            next_config[key] = str(data.get(key, current.get(key, "")) or "").strip()
        secret_update_requested = any(str(data.get(field, data.get(alias, "")) or "").strip() for field, alias in (("api_key", "apiKey"), ("api_secret", "apiSecret")))
        if secret_update_requested and not os.getenv("META_SETTINGS_ENCRYPTION_KEY", "").strip():
            raise HTTPException(status_code=503, detail="META_SETTINGS_ENCRYPTION_KEY is required to save AI voice secrets")
        for field, alias in (("api_key", "apiKey"), ("api_secret", "apiSecret")):
            value = str(data.get(field, data.get(alias, "")) or "").strip()
            if value:
                next_config[field] = encrypt_secret(value)
            elif current.get(field):
                next_config[field] = current[field]
        if not current_row:
            db.add(AppSetting(key="ai_voice_caller", value_json=json.dumps(next_config), updated_at=datetime.now(timezone.utc)))
        else:
            current_row.value_json = json.dumps(next_config)
            current_row.updated_at = datetime.now(timezone.utc)
        db.commit()
        return get_voice_caller_settings(db, current_user)
    except HTTPException:
        raise
    except (TypeError, ValueError) as exc:
        db.rollback()
        return JSONResponse(status_code=400, content={"success": False, "message": f"Invalid AI voice configuration: {str(exc)}"})
    except Exception:
        db.rollback()
        return JSONResponse(status_code=500, content={"success": False, "message": "AI voice configuration could not be saved."})


@router.post("/admin/settings/voice-caller/test")
def run_voice_caller_settings_test(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    try:
        config = resolve_voice_config(db)
        if str(config.get("provider") or "mock").strip().lower() == "mock":
            return {"success": True, "message": "Mock provider active"}
        missing = validate_voice_config(config)
        if missing:
            return {"success": False, "ok": False, "configured": False, "missing": missing, "message": f"AI voice configuration is incomplete: {', '.join(missing)}."}
        try:
            request = _voice_test_request(config)
            with urlopen(request, timeout=10) as response:
                payload = json.loads(response.read().decode("utf-8"))
            agents = _json_path_value(payload, config["agent_list_path"])
            if not isinstance(agents, list):
                return {"success": False, "message": "Connection succeeded, but the configured agent list path did not return a list."}
            matches_agent = any(
                isinstance(agent, dict) and (str(agent.get(config["agent_id_field"], "")) == config["caller_id"] or str(agent.get(config["agent_name_field"], "")) == config["caller_id"])
                for agent in agents
            )
            if matches_agent:
                return {"success": True, "message": "Connection Successful & Agent Verified"}
            return {"success": False, "message": "Connected to provider, but the configured caller ID/name was not found."}
        except HTTPError as exc:
            logger.warning("Voice provider test failed: provider=%s status=%s", config["provider"], exc.code)
            if exc.code in {401, 403}:
                return JSONResponse(status_code=400, content={"success": False, "message": "Provider authentication failed. Check the API key and authentication settings."})
            return JSONResponse(status_code=400, content={"success": False, "message": f"Provider connection failed (HTTP {exc.code})."})
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            logger.warning("Voice provider test configuration failed: provider=%s error=%s", config["provider"], exc)
            return JSONResponse(status_code=400, content={"success": False, "message": str(exc)})
        except Exception:
            logger.exception("Voice provider test failed: provider=%s", config["provider"])
            return JSONResponse(status_code=500, content={"success": False, "message": "Provider connection could not be completed."})
    except Exception:
        return JSONResponse(status_code=500, content={"success": False, "message": "AI voice configuration test could not be completed."})


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
    try:
        result = test_meta_config(db)
        return {"ok": True, "configured": True, "page_id": result["page_id"], "page_name": result["page_name"], "graph_api_version": result["graph_api_version"], "message": "Meta configuration verified with external API call."}
    except Exception as err:
        return {"ok": False, "configured": True, "error": str(err)}
