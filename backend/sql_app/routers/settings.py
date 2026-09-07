import json
import logging
import os
import re
from datetime import datetime, timezone
from urllib.error import HTTPError
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AppSetting, PublicOrder, User
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


def _json_path_text(payload, path: str) -> str:
    value = _json_path_value(payload, path)
    return "" if value is None else str(value).strip()


def _http_error_body(error: HTTPError) -> str:
    try:
        return error.read().decode("utf-8", errors="replace").strip()
    except Exception:
        return str(error.reason or "No response body")


def _has_valid_thinnestai_key(config: dict) -> bool:
    return str(config.get("api_key") or "").strip().startswith("ta_live_")


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


SHIPPING_CONFIG_KEY = "shipping_provider_integration"
SHIPPING_FIELDS = ("enabled", "provider", "api_base_url", "test_endpoint_url", "test_http_method", "auth_type", "auth_header_name", "shipment_request_template", "tracking_response_path", "return_address_id")
SHIPMENT_STATUSES = {"NOT_CREATED", "READY_TO_SHIP", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "RTO", "CANCELLED"}
DEFAULT_ITHINK_SHIPMENT_TEMPLATE = json.dumps(
    {
        "data": {
            "shipments": [
                {
                    "waybill": "",
                    "order": "{{order_id}}",
                    "sub_order": "",
                    "order_date": "{{order_date}}",
                    "total_amount": "{{total_amount}}",
                    "name": "{{customer_name}}",
                    "company_name": "",
                    "add": "{{address}}",
                    "add2": "",
                    "add3": "",
                    "pin": "{{pincode}}",
                    "city": "{{city}}",
                    "state": "{{state}}",
                    "country": "India",
                    "phone": "{{phone}}",
                    "alt_phone": "",
                    "email": "{{email}}",
                    "billing_address_name": "{{customer_name}}",
                    "billing_address": "{{address}}",
                    "billing_address2": "",
                    "billing_city": "{{city}}",
                    "billing_state": "{{state}}",
                    "billing_country": "India",
                    "billing_pincode": "{{pincode}}",
                    "billing_phone": "{{phone}}",
                    "billing_email": "{{email}}",
                    "payment_mode": "{{payment_mode}}",
                    "shipping_mode": "Surface",
                    "return_address_id": "{{return_address_id}}",
                    "products": "{{products}}",
                    "shipment_height": "10",
                    "shipment_width": "10",
                    "shipment_length": "10",
                    "shipment_weight": "0.5",
                }
            ]
        }
    },
    indent=2,
)


def _has_shipments_template(value: str) -> bool:
    try:
        payload = json.loads(value or "{}")
    except json.JSONDecodeError:
        return False
    shipments = ((payload if isinstance(payload, dict) else {}).get("data") or {}).get("shipments")
    return isinstance(shipments, list) and bool(shipments)


def _is_ithink_provider(value: str) -> bool:
    return "ithink" in str(value or "").strip().lower().replace("-", "").replace("_", "")


def _shipping_config(db: Session) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == SHIPPING_CONFIG_KEY).first()
    try:
        stored = json.loads(row.value_json or "{}") if row else {}
    except json.JSONDecodeError:
        stored = {}
    stored = stored if isinstance(stored, dict) else {}
    from ..meta_ads import decrypt_secret
    result = {field: stored.get(field, False if field == "enabled" else "") for field in SHIPPING_FIELDS}
    if _is_ithink_provider(result.get("provider")) and not _has_shipments_template(str(result.get("shipment_request_template") or "")):
        result["shipment_request_template"] = DEFAULT_ITHINK_SHIPMENT_TEMPLATE
    elif not str(result.get("shipment_request_template") or "").strip():
        result["shipment_request_template"] = DEFAULT_ITHINK_SHIPMENT_TEMPLATE
    if not str(result.get("tracking_response_path") or "").strip():
        result["tracking_response_path"] = "data.1.waybill_number"
    for secret in ("api_key", "secret_key"):
        if stored.get(secret):
            result[secret] = decrypt_secret(stored[secret]).strip()
        else:
            result[secret] = ""
    return result


@router.get("/admin/settings/shipping-provider")
def get_shipping_provider_settings(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    config = _shipping_config(db)
    return {field: config[field] for field in SHIPPING_FIELDS} | {"api_key_masked": _mask_secret(config["api_key"]), "secret_key_masked": _mask_secret(config["secret_key"]), "configured": bool(config["api_base_url"] and config["api_key"])}


@router.put("/admin/settings/shipping-provider")
def update_shipping_provider_settings(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    data = payload if isinstance(payload, dict) else {}
    row = db.query(AppSetting).filter(AppSetting.key == SHIPPING_CONFIG_KEY).first()
    try:
        current = json.loads(row.value_json or "{}") if row else {}
    except json.JSONDecodeError:
        current = {}
    current = current if isinstance(current, dict) else {}
    next_config = {field: (bool(data.get(field, current.get(field, False))) if field == "enabled" else str(data.get(field, current.get(field, "")) or "").strip()) for field in SHIPPING_FIELDS}
    for secret in ("api_key", "secret_key"):
        value = str(data.get(secret) or "").strip()
        if value:
            if not os.getenv("META_SETTINGS_ENCRYPTION_KEY", "").strip():
                raise HTTPException(status_code=503, detail="META_SETTINGS_ENCRYPTION_KEY is required to save shipping provider secrets")
            next_config[secret] = encrypt_secret(value)
        elif current.get(secret):
            next_config[secret] = current[secret]
    if row:
        row.value_json = json.dumps(next_config)
        row.updated_at = datetime.now(timezone.utc)
    else:
        db.add(AppSetting(key=SHIPPING_CONFIG_KEY, value_json=json.dumps(next_config), updated_at=datetime.now(timezone.utc)))
    db.commit()
    return get_shipping_provider_settings(db, current_user)


@router.post("/admin/settings/shipping-provider/test")
def test_shipping_provider_settings(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    config = _shipping_config(db)
    missing = [field for field in ("api_base_url", "api_key", "test_endpoint_url", "auth_type", "auth_header_name") if not config.get(field)]
    if missing:
        return {"ok": False, "missing": missing, "message": f"Shipping provider configuration is incomplete: {', '.join(missing)}"}
    try:
        if _is_ithink_provider(config.get("provider")) and "order/add.json" in str(config.get("test_endpoint_url") or ""):
            return JSONResponse(status_code=400, content={"ok": False, "message": "Use an iThink serviceability or account-balance endpoint for Test Connection, not order/add.json."})
        request = _shipping_request(config, config["test_endpoint_url"], method=config.get("test_http_method") or "GET")
        with urlopen(request, timeout=10) as response:
            payload = _read_json_response(response)
        ok, message = _shipping_response_ok(payload)
        if not ok:
            return JSONResponse(status_code=400, content={"ok": False, "message": message})
        return {"ok": True, "message": "Shipping provider connection verified"}
    except HTTPError as exc:
        return JSONResponse(status_code=400, content={"ok": False, "message": f"Shipping provider returned HTTP {exc.code}: {_http_error_body(exc)}"})
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        return JSONResponse(status_code=400, content={"ok": False, "message": str(exc)})
    except Exception as exc:
        return JSONResponse(status_code=500, content={"ok": False, "message": f"Shipping provider test failed: {str(exc)}"})


def _shipping_request(config: dict, endpoint: str, method: str = "GET", payload=None) -> Request:
    endpoint = str(endpoint or "").strip()
    parsed = urlsplit(endpoint)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("Shipping endpoint URL must be a valid HTTPS URL.")
    auth_type = str(config.get("auth_type") or "").strip()
    credential_name = str(config.get("auth_header_name") or "").strip()
    if not credential_name or "\r" in credential_name or "\n" in credential_name:
        raise ValueError("Authentication header or query parameter name is invalid.")
    headers = {"Accept": "application/json"}
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")
    if auth_type == "bearer_token":
        headers[credential_name] = f"Bearer {config['api_key']}"
    elif auth_type == "custom_header":
        headers[credential_name] = config["api_key"]
    elif auth_type == "api_key_query_param":
        query = parse_qsl(parsed.query, keep_blank_values=True)
        query.append((credential_name, config["api_key"]))
        if config.get("secret_key"):
            secret_name = "secret-key" if credential_name == "access-token" else "secret_key"
            query.append((secret_name, config["secret_key"]))
        endpoint = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment))
    else:
        raise ValueError("Authentication type is invalid.")
    method = str(method or "GET").upper()
    if method not in {"GET", "POST"}:
        raise ValueError("HTTP method must be GET or POST.")
    return Request(endpoint, data=body if body is not None else (b"{}" if method == "POST" else None), headers=headers, method=method)


def _read_json_response(response) -> dict:
    body = response.read().decode("utf-8")
    payload = json.loads(body or "{}")
    if not isinstance(payload, dict):
        raise ValueError("Shipping provider returned a non-object JSON response.")
    return payload


def _shipping_response_ok(payload: dict) -> tuple[bool, str]:
    status = str(payload.get("status") or "").strip().lower()
    status_code = payload.get("status_code")
    if status == "success" or status_code in {200, "200"}:
        return True, ""
    message = str(payload.get("html_message") or payload.get("message") or payload.get("error") or "iThink API Authentication Failed").strip()
    return False, message


def _shipment_key(order_id: str) -> str:
    return f"shipment:{order_id}"


def _shipment_payload(order: PublicOrder, stored: dict) -> dict:
    return {
        "order_id": order.id,
        "order_status": order.status,
        "customer_name": order.payer_name,
        "shipping_address": order.shipping_address,
        "amount": order.total_amount,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "shipment_status": stored.get("shipment_status", "NOT_CREATED"),
        "courier_name": stored.get("courier_name", ""),
        "awb_number": stored.get("awb_number", ""),
        "tracking_url": stored.get("tracking_url", ""),
        "notes": stored.get("notes", ""),
        "updated_at": stored.get("updated_at"),
    }


def _load_order_contact_details(db: Session, order_id: str) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == f"order_contact:{str(order_id or '').strip()}").first()
    try:
        payload = json.loads(row.value_json or "{}") if row else {}
    except json.JSONDecodeError:
        payload = {}
    payload = payload if isinstance(payload, dict) else {}
    return {
        "customer_phone": "".join(ch for ch in str(payload.get("customer_phone") or "") if ch.isdigit()),
        "shipping_city": str(payload.get("shipping_city") or "").strip(),
        "shipping_state": str(payload.get("shipping_state") or "").strip(),
        "shipping_pincode": "".join(ch for ch in str(payload.get("shipping_pincode") or "") if ch.isdigit())[-6:],
        "customer_email": str(payload.get("customer_email") or "").strip(),
    }


def _load_order_contact_phone(db: Session, order_id: str) -> str:
    return _load_order_contact_details(db, order_id).get("customer_phone", "")


def _first_pincode(text: str) -> str:
    match = re.search(r"\b\d{6}\b", str(text or ""))
    return match.group(0) if match else ""


def _order_products(order: PublicOrder) -> list[dict]:
    try:
        items = json.loads(order.items_json or "[]")
    except json.JSONDecodeError:
        items = []
    products = []
    for index, item in enumerate(items if isinstance(items, list) else [], start=1):
        item = item if isinstance(item, dict) else {}
        quantity = item.get("quantity") or item.get("qty") or 1
        price = item.get("price") or item.get("sale_price") or item.get("amount") or 0
        products.append(
            {
                "product_name": str(item.get("name") or item.get("product_name") or f"Item {index}"),
                "product_sku": str(item.get("sku") or item.get("product_sku") or item.get("product_id") or f"SKU-{index:03d}"),
                "product_quantity": str(quantity),
                "product_price": f"{float(price or 0):.2f}",
                "product_tax_rate": str(item.get("tax_rate") or item.get("product_tax_rate") or "0"),
            }
        )
    return products or [{"product_name": "METHO Order", "product_sku": "METHO-ORDER", "product_quantity": "1", "product_price": f"{float(order.total_amount or 0):.2f}", "product_tax_rate": "0"}]


def _render_template_value(value, context: dict):
    if isinstance(value, dict):
        return {key: _render_template_value(child, context) for key, child in value.items()}
    if isinstance(value, list):
        return [_render_template_value(child, context) for child in value]
    if isinstance(value, str):
        if value.strip() == "{{products}}":
            return context["products"]
        for key, replacement in context.items():
            if key != "products":
                value = value.replace("{{" + key + "}}", str(replacement))
        return value
    return value


def _build_shipment_request_payload(order: PublicOrder, config: dict, db: Session) -> dict:
    try:
        template = json.loads(config.get("shipment_request_template") or DEFAULT_ITHINK_SHIPMENT_TEMPLATE)
    except json.JSONDecodeError as exc:
        raise ValueError("Shipment Request JSON Template is not valid JSON.") from exc
    address = str(order.shipping_address or "").strip()
    contact = _load_order_contact_details(db, order.id)
    phone = contact.get("customer_phone", "")
    if not phone:
        user = db.query(User).filter(User.id == order.customer_user_id).first() if str(order.customer_user_id or "").strip() else None
        phone = "".join(ch for ch in str(getattr(user, "phone", "") or "") if ch.isdigit()) if user else ""
    phone = phone[-10:] if len(phone) > 10 else phone
    pincode = contact.get("shipping_pincode") or _first_pincode(address)
    city = contact.get("shipping_city")
    state = contact.get("shipping_state") or "West Bengal"
    provider = str(config.get("provider") or "").strip().lower()
    return_address_id = str(config.get("return_address_id") or "").strip()
    context = {
        "order_id": order.id,
        "order_date": (order.created_at or datetime.now(timezone.utc)).strftime("%d-%m-%Y"),
        "total_amount": f"{float(order.total_amount or 0):.2f}",
        "customer_name": order.payer_name or "Customer",
        "address": address,
        "pincode": pincode,
        "city": city,
        "state": state,
        "phone": phone,
        "email": contact.get("customer_email", ""),
        "payment_mode": "COD" if str(order.payment_method or "").lower() == "cod" else "Prepaid",
        "return_address_id": return_address_id,
        "products": _order_products(order),
    }
    missing = [field for field in ("address", "city", "state") if not context[field]]
    if not pincode:
        missing.append("pincode")
    elif len(pincode) != 6:
        missing.append("pincode (must be exactly 6 digits)")
    if not phone:
        missing.append("phone")
    elif len(phone) != 10:
        missing.append("phone (must be exactly 10 digits)")
    if _is_ithink_provider(provider) and not return_address_id:
        missing.append("return_address_id (configure Return/Pickup Address ID in Shipping Provider settings)")
    if missing:
        raise ValueError(f"Order is missing shipment data: {', '.join(missing)}")
    rendered = _render_template_value(template, context)
    if _is_ithink_provider(provider) and isinstance(rendered, dict):
        data = rendered.get("data")
        shipments = data.get("shipments") if isinstance(data, dict) else None
        if isinstance(shipments, list):
            for shipment in shipments:
                if isinstance(shipment, dict):
                    shipment.setdefault("shipping_mode", "Surface")
    return rendered


def _shipment_endpoint(config: dict) -> str:
    base = str(config.get("api_base_url") or "").strip()
    if base.endswith("order/add.json"):
        return base
    if "/api_v3/" in base:
        return urljoin(base.rstrip("/") + "/", "order/add.json")
    return urljoin(base.rstrip("/") + "/", "api_v3/order/add.json")


def _save_shipment_result(db: Session, order: PublicOrder, response_payload: dict, config: dict) -> dict:
    awb = _json_path_text(response_payload, config.get("tracking_response_path") or "data.1.waybill_number")
    courier = _json_path_text(response_payload, "data.1.logistic_name")
    stored = {
        "courier_name": courier,
        "awb_number": awb,
        "tracking_url": "",
        "notes": json.dumps(response_payload),
        "shipment_status": "READY_TO_SHIP" if awb else "NOT_CREATED",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    row = db.query(AppSetting).filter(AppSetting.key == _shipment_key(order.id)).first()
    if row:
        row.value_json = json.dumps(stored)
        row.updated_at = datetime.now(timezone.utc)
    else:
        db.add(AppSetting(key=_shipment_key(order.id), value_json=json.dumps(stored), updated_at=datetime.now(timezone.utc)))
    db.commit()
    return stored


@router.get("/admin/shipments")
def list_shipments(status: str = "", db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    rows = db.query(PublicOrder).filter(PublicOrder.shipping_address != "").order_by(PublicOrder.created_at.desc()).limit(300).all()
    result = []
    for order in rows:
        setting = db.query(AppSetting).filter(AppSetting.key == _shipment_key(order.id)).first()
        try:
            stored = json.loads(setting.value_json or "{}") if setting else {}
        except json.JSONDecodeError:
            stored = {}
        item = _shipment_payload(order, stored if isinstance(stored, dict) else {})
        if not status or item["shipment_status"] == status:
            result.append(item)
    return {"items": result, "provider": get_shipping_provider_settings(db, current_user)}


@router.post("/admin/shipments/{order_id}/create")
def create_provider_shipment(order_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    order = db.query(PublicOrder).filter(PublicOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    config = _shipping_config(db)
    missing = [field for field in ("api_base_url", "api_key", "auth_type", "auth_header_name") if not config.get(field)]
    if _is_ithink_provider(config.get("provider")) and not config.get("secret_key"):
        missing.append("secret_key")
    if missing:
        raise HTTPException(status_code=400, detail=f"Shipping provider configuration is incomplete: {', '.join(missing)}")
    try:
        request_payload = _build_shipment_request_payload(order, config, db)
        request = _shipping_request(config, _shipment_endpoint(config), method="POST", payload=request_payload)
        with urlopen(request, timeout=20) as response:
            response_payload = _read_json_response(response)
        ok, message = _shipping_response_ok(response_payload)
        if not ok:
            return JSONResponse(status_code=400, content={"ok": False, "message": message, "provider_response": response_payload})
        stored = _save_shipment_result(db, order, response_payload, config)
        return {"ok": True, "message": "Shipment created", "shipment": _shipment_payload(order, stored), "provider_response": response_payload}
    except HTTPError as exc:
        return JSONResponse(status_code=400, content={"ok": False, "message": f"Shipping provider returned HTTP {exc.code}: {_http_error_body(exc)}"})
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        return JSONResponse(status_code=400, content={"ok": False, "message": str(exc)})
    except Exception as exc:
        logger.exception("Shipping provider shipment creation failed: order_id=%s", order_id)
        return JSONResponse(status_code=500, content={"ok": False, "message": f"Shipment creation failed: {str(exc)}"})


@router.put("/admin/shipments/{order_id}")
def update_shipment(order_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    order = db.query(PublicOrder).filter(PublicOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    data = payload if isinstance(payload, dict) else {}
    status = str(data.get("shipment_status") or "NOT_CREATED").strip().upper()
    if status not in SHIPMENT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid shipment status")
    stored = {key: str(data.get(key) or "").strip() for key in ("courier_name", "awb_number", "tracking_url", "notes")}
    stored["shipment_status"] = status
    stored["updated_at"] = datetime.now(timezone.utc).isoformat()
    row = db.query(AppSetting).filter(AppSetting.key == _shipment_key(order.id)).first()
    if row:
        row.value_json = json.dumps(stored)
        row.updated_at = datetime.now(timezone.utc)
    else:
        db.add(AppSetting(key=_shipment_key(order.id), value_json=json.dumps(stored), updated_at=datetime.now(timezone.utc)))
    db.commit()
    return {"ok": True, "shipment": _shipment_payload(order, stored)}


@router.get("/admin/settings/voice-caller")
def get_voice_caller_settings(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    config = resolve_voice_config(db)
    missing = validate_voice_config(config)
    return {key: config[key] for key in ("enabled", "provider", "caller_id", "bengali_voice", "hindi_voice", "english_voice", "model", "max_call_attempts", "retry_delay_minutes", *PROFILE_KEYS)} | {"api_key_masked": _mask_secret(config["api_key"]), "api_secret_masked": _mask_secret(config["api_secret"]), "configured": not missing, "missing": missing}


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
            "english_voice": str(get_value("english_voice", "englishVoice") or "").strip(),
            "model": str(get_value("model", "model") or "").strip(),
            "max_call_attempts": max(1, min(5, int(get_value("max_call_attempts", "maxCallAttempts") or 1))),
            "retry_delay_minutes": max(1, min(10080, int(get_value("retry_delay_minutes", "retryDelayMinutes") or 60))),
        }
        for key in PROFILE_KEYS:
            next_config[key] = str(data.get(key, current.get(key, "")) or "").strip()
        if next_config["provider"] == "thinnestai" and not next_config["request_template"]:
            next_config["request_template"] = '{"to":"{{to}}","purpose":"{{purpose}}","agent":"{{agent}}"}'
            next_config["response_id_path"] = next_config["response_id_path"] or "id"
            next_config["purpose_template"] = next_config["purpose_template"] or "I'm calling from METHO AAY-UPAY for a follow-up with {{lead_name}}."
        if next_config["provider"] == "thinnestai":
            if next_config["call_endpoint_url"] in {"https://api.thinnest.ai/v1/calls", "https://api.thinnest.ai/api/v1/calls"}:
                next_config["call_endpoint_url"] = "https://app.thinnest.ai/api/v1/calls"
            if next_config["test_endpoint_url"] in {"https://api.thinnest.ai/v1/agents", "https://api.thinnest.ai/api/v1/agents"}:
                next_config["test_endpoint_url"] = ""
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
        if str(config.get("provider") or "").strip().lower() == "thinnestai" and not config.get("test_endpoint_url"):
            return {"success": True, "message": "ThinnestAI call endpoint saved. It does not expose an agent-list test endpoint; verify with one CRM test call."}
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
            return JSONResponse(status_code=400, content={"success": False, "message": f"Provider connection failed: HTTP {exc.code} - {_http_error_body(exc)}"})
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            logger.warning("Voice provider test configuration failed: provider=%s error=%s", config["provider"], exc)
            return JSONResponse(status_code=400, content={"success": False, "message": str(exc)})
        except Exception as exc:
            logger.exception("Voice provider test failed: provider=%s", config["provider"])
            return JSONResponse(status_code=500, content={"success": False, "message": f"Network Error: {str(exc)}"})
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
