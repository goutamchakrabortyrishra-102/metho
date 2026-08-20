import json
import uuid
from datetime import datetime, timedelta, timezone
import base64
import hashlib
import hmac
import mimetypes
from decimal import Decimal, ROUND_HALF_UP
from email.utils import formatdate
from types import SimpleNamespace
import urllib.error
import urllib.request
from urllib.parse import quote
from pathlib import Path
import os
from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AppSetting, AssociatePartner, PartnerProduct, Product, ProductMeta, PublicOrder, User
from ..security import decode_token
from ..storage import UPLOADED_OBJECTS_DIR
from .auth import get_current_user, member_code_for_user
from .settings import load_settings

router = APIRouter(prefix="/api", tags=["checkout"])

UPLOAD_DIR = UPLOADED_OBJECTS_DIR / "payment_screenshots"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
PARTNER_PRODUCT_UNITS_KEY = "partner_product_units"
PARTNER_PRODUCT_META_KEY = "partner_product_meta"
PARTNER_UNIT_OPTIONS = {"piece", "kg", "gram", "litre", "ml"}
ORDER_CONTACT_KEY_PREFIX = "order_contact:"
TOURISM_TERMS_VERSION = "2026-08-19"
RESTAURANT_SLOT_TEMPLATE_KEYS = {
    "restaurant_table_booking",
    "banquet_slot",
    "restaurant_takeaway_slot",
    "cafe_table_reservation",
}
SERVICE_SLOT_TEMPLATE_KEYS = {
    "restaurant_table_booking",
    "banquet_slot",
    "restaurant_takeaway_slot",
    "cafe_table_reservation",
    "ac_service_visit",
    "plumbing_repair",
    "electrician_visit",
    "appliance_repair",
    "laundry_kg_service",
    "dry_clean_service",
    "tailoring_stitching",
    "beauty_home_service",
    "courier_pickup",
    "house_deep_clean",
    "office_cleaning",
    "pest_control_visit",
    "doctor_consultation",
    "diagnostic_visit",
    "tele_consultation",
    "dental_checkup",
    "pathology_test_slot",
    "ultrasound_slot",
    "yoga_class_slot",
    "tuition_monthly_batch",
    "coaching_mock_test",
    "salon_haircut",
    "salon_grooming_package",
    "salon_bridal_package",
    "spa_session",
    "gym_personal_training",
    "photo_event_shoot",
    "video_shoot_edit",
    "tourism_booking",
}
TRANSPORT_TEMPLATE_KEYS = {
    "cab_airport_drop",
    "car_rental_daily",
    "bike_rental_daily",
}
SLOT_INACTIVE_ORDER_STATUSES = {"cancelled", "rejected", "failed", "expired"}
SLOT_SUGGESTION_INTERVAL_MINUTES = 30
SLOT_SUGGESTION_INTERVAL_MIN_MINUTES = 5
SLOT_SUGGESTION_INTERVAL_MAX_MINUTES = 180


def round_half_up_to_whole_rupee(value: float | int) -> int:
    """Round GST-inclusive price to nearest whole rupee using standard mathematical rounding.
    
    Follows the rule:
    - Decimal < 0.50 → round DOWN
    - Decimal >= 0.50 → round UP
    
    Examples: 49.49 → 49, 49.50 → 50, 50.50 → 51
    """
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _parse_slot_datetime(value: str | None) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    candidates = [raw, raw.replace(" ", "T")]
    if raw.endswith("Z"):
        candidates.append(raw[:-1] + "+00:00")
    for candidate in candidates:
        try:
            parsed = datetime.fromisoformat(candidate)
            if parsed.tzinfo is not None:
                parsed = parsed.replace(tzinfo=None)
            return parsed.replace(second=0, microsecond=0)
        except Exception:
            continue
    return None


def _extract_slot_datetime_from_shipping_address(address: str | None) -> datetime | None:
    text = str(address or "").strip()
    if not text:
        return None
    slot_prefixes = ("Restaurant Slot:", "Service Slot:")
    for prefix in slot_prefixes:
        if text.startswith(prefix):
            slot_raw = text[len(prefix):].split("|", 1)[0].strip()
            return _parse_slot_datetime(slot_raw)
    return None


def _service_slot_product_ids_from_items(items: list[dict] | None) -> set[str]:
    product_ids: set[str] = set()
    for item in items or []:
        if not _is_service_order_item(item):
            continue
        template_key = str(item.get("service_template_key") or "").strip().lower()
        if template_key in TRANSPORT_TEMPLATE_KEYS:
            continue
        product_id = str(item.get("product_id") or "").strip()
        if product_id:
            product_ids.add(product_id)
    return product_ids


def _load_global_product_service_meta(db: Session, product_id: str) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == f"product_service_meta:{product_id}").first()
    if not row:
        return {}
    try:
        value = json.loads(row.value_json or "{}")
    except Exception:
        value = {}
    return value if isinstance(value, dict) else {}


def _normalize_slot_interval_minutes(value, default_value: int = SLOT_SUGGESTION_INTERVAL_MINUTES) -> int:
    try:
        minutes = int(value)
    except Exception:
        minutes = int(default_value)
    return max(SLOT_SUGGESTION_INTERVAL_MIN_MINUTES, min(SLOT_SUGGESTION_INTERVAL_MAX_MINUTES, minutes))


def _partner_slot_suggestion_interval_minutes(db: Session, partner_id: str) -> int:
    key = f"partner_checkout_pref:{str(partner_id or '').strip()}"
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row:
        return SLOT_SUGGESTION_INTERVAL_MINUTES
    try:
        payload = json.loads(row.value_json or "{}")
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    return _normalize_slot_interval_minutes(payload.get("slot_suggestion_interval_minutes"), SLOT_SUGGESTION_INTERVAL_MINUTES)


def _resolve_slot_suggestion_interval_minutes(db: Session, service_product_ids: set[str]) -> int:
    if not service_product_ids:
        return SLOT_SUGGESTION_INTERVAL_MINUTES
    intervals: list[int] = []
    for product_id in service_product_ids:
        product = db.query(PartnerProduct).filter(PartnerProduct.id == product_id).first()
        if not product or not getattr(product, "partner_id", ""):
            continue
        intervals.append(_partner_slot_suggestion_interval_minutes(db, product.partner_id))
    if not intervals:
        return SLOT_SUGGESTION_INTERVAL_MINUTES
    return min(intervals)


def _next_available_service_slot_suggestion(db: Session, requested_slot: str, service_product_ids: set[str], interval_minutes: int = SLOT_SUGGESTION_INTERVAL_MINUTES) -> str:
    requested_dt = _parse_slot_datetime(requested_slot)
    if not requested_dt or not service_product_ids:
        return ""

    slot_interval_minutes = _normalize_slot_interval_minutes(interval_minutes, SLOT_SUGGESTION_INTERVAL_MINUTES)

    taken_slots: set[datetime] = set()
    rows = db.query(PublicOrder).all()
    for row in rows:
        status = str(getattr(row, "status", "") or "").strip().lower()
        if status in SLOT_INACTIVE_ORDER_STATUSES:
            continue

        booked_slot = _extract_slot_datetime_from_shipping_address(getattr(row, "shipping_address", ""))
        if not booked_slot:
            continue

        try:
            order_items = json.loads(getattr(row, "items_json", "[]") or "[]")
        except Exception:
            order_items = []
        booked_service_ids = _service_slot_product_ids_from_items(order_items)
        if not booked_service_ids.intersection(service_product_ids):
            continue
        taken_slots.add(booked_slot)

    if requested_dt not in taken_slots:
        return ""

    probe = requested_dt
    for _ in range(1, 49):
        probe = probe + timedelta(minutes=slot_interval_minutes)
        if probe not in taken_slots:
            return probe.strftime("%Y-%m-%dT%H:%M")
    return ""


def _normalize_text(value: str | None) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _extract_pincode_from_address(address: str | None) -> str:
    digits = "".join(ch for ch in str(address or "") if ch.isdigit())
    if len(digits) >= 6:
        return digits[-6:]
    return ""


def _extract_city_from_address(address: str | None) -> str:
    text = _normalize_text(address)
    if not text:
        return ""
    parts = [part.strip() for part in text.replace(";", ",").split(",") if part.strip()]
    if not parts:
        return text
    for part in reversed(parts):
        if not any(ch.isdigit() for ch in part):
            return part
    return parts[-1]


def _delivery_area_matches(address: str | None, city: str | None, pincode: str | None) -> bool:
    expected_city = _normalize_text(city)
    expected_pincode = "".join(ch for ch in str(pincode or "") if ch.isdigit())
    if not expected_city and not expected_pincode:
        return True

    actual_pincode = _extract_pincode_from_address(address)
    actual_city = _extract_city_from_address(address)
    if expected_pincode and actual_pincode and expected_pincode != actual_pincode:
        return False
    if expected_city and actual_city and expected_city != actual_city:
        return False
    return True


def _build_partner_whatsapp_url(phone: str | None, message: str) -> str:
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    if not digits:
        return ""
    return f"https://wa.me/{digits}?text={quote(message)}"


def _resolve_member_user_by_ref(db: Session, member_ref: str) -> User | None:
    ref = str(member_ref or "").strip().upper()
    if not ref:
        return None

    by_id = db.query(User).filter(User.id == ref, User.role == "member").first()
    if by_id:
        return by_id

    by_email = db.query(User).filter(User.email == ref, User.role == "member").first()
    if by_email:
        return by_email

    if ref.startswith("MTH-"):
        prefix = ref.replace("-", "")[3:9]
        if prefix:
            return (
                db.query(User)
                .filter(User.role == "member", User.id.ilike(f"{prefix}%"))
                .order_by(User.created_at.asc())
                .first()
            )
    return None


def _member_profile_key(user_id: str) -> str:
    return f"member_profile:{str(user_id or '').strip()}"


def _load_member_profile(db: Session, user_id: str) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == _member_profile_key(user_id)).first()
    if not row:
        return {}
    try:
        payload = json.loads(row.value_json or "{}")
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


@router.get("/member-lookup/{member_ref}")
def member_lookup(member_ref: str, db: Session = Depends(get_db)):
    user = _resolve_member_user_by_ref(db, member_ref)
    if not user:
        raise HTTPException(status_code=404, detail="Member not found")
    profile = _load_member_profile(db, user.id)
    return {
        "id": user.id,
        "name": str(user.name or "").strip(),
        "phone": str(user.phone or "").strip(),
        "address": str(profile.get("address") or "").strip(),
        "member_code": member_code_for_user(user.id),
    }


def _order_contact_key(order_id: str) -> str:
    return f"{ORDER_CONTACT_KEY_PREFIX}{str(order_id or '').strip()}"


def _save_order_contact_phone(db: Session, order_id: str, phone: str) -> None:
    oid = str(order_id or "").strip()
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    if not oid or not digits:
        return
    row = db.query(AppSetting).filter(AppSetting.key == _order_contact_key(oid)).first()
    payload = {"customer_phone": digits}
    if not row:
        row = AppSetting(key=_order_contact_key(oid), value_json=json.dumps(payload))
        db.add(row)
    else:
        row.value_json = json.dumps(payload)
    db.commit()


def _load_order_contact_phone(db: Session, order_id: str) -> str:
    oid = str(order_id or "").strip()
    if not oid:
        return ""
    row = db.query(AppSetting).filter(AppSetting.key == _order_contact_key(oid)).first()
    if not row:
        return ""
    try:
        payload = json.loads(row.value_json or "{}")
    except Exception:
        return ""
    digits = "".join(ch for ch in str(payload.get("customer_phone") or "") if ch.isdigit())
    return digits


def _save_tourism_terms_acceptance(db: Session, order_id: str, customer_name: str, customer_phone: str) -> None:
    key = f"tourism_terms_acceptance:{str(order_id or '').strip()}"
    payload = {
        "policy_version": TOURISM_TERMS_VERSION,
        "accepted_at": datetime.now(timezone.utc).isoformat(),
        "customer_name": str(customer_name or "").strip(),
        "customer_phone": "".join(ch for ch in str(customer_phone or "") if ch.isdigit()),
    }
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row:
        db.add(AppSetting(key=key, value_json=json.dumps(payload)))
    else:
        row.value_json = json.dumps(payload)


def _normalize_partner_unit_type(value: str | None) -> str:
    text = str(value or "piece").strip().lower()
    if text in {"pcs", "pc", "unit", "units"}:
        text = "piece"
    if text not in PARTNER_UNIT_OPTIONS:
        return "piece"
    return text


def _partner_unit_step(unit_type: str) -> float:
    unit = _normalize_partner_unit_type(unit_type)
    if unit in {"kg", "litre"}:
        return 0.1
    if unit in {"gram", "ml"}:
        return 100.0
    return 1.0


def _normalize_partner_quantity_step(unit_type: str, raw_step) -> float:
    unit = _normalize_partner_unit_type(unit_type)
    default_step = _partner_unit_step(unit)
    try:
        step = float(raw_step or 0)
    except Exception:
        step = 0.0
    if step <= 0:
        return default_step
    if unit in {"kg", "litre"} and abs(step - 0.25) < 0.0001:
        return default_step
    if unit in {"gram", "ml"} and abs(step - 50.0) < 0.0001:
        return default_step
    return step


def _load_partner_product_units(db: Session) -> dict[str, dict]:
    row = db.query(AppSetting).filter(AppSetting.key == PARTNER_PRODUCT_UNITS_KEY).first()
    if not row:
        return {}
    try:
        payload = json.loads(row.value_json or "{}")
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _save_partner_product_units(db: Session, mapping: dict[str, dict]) -> None:
    row = db.query(AppSetting).filter(AppSetting.key == PARTNER_PRODUCT_UNITS_KEY).first()
    if not row:
        row = AppSetting(key=PARTNER_PRODUCT_UNITS_KEY, value_json="{}")
        db.add(row)
    row.value_json = json.dumps(mapping or {})
    db.commit()


def _set_partner_product_unit(db: Session, product_id: str, unit_type: str) -> dict[str, dict]:
    mapping = _load_partner_product_units(db)
    normalized = _normalize_partner_unit_type(unit_type)
    mapping[str(product_id)] = {
        "unit_type": normalized,
        "quantity_step": _partner_unit_step(normalized),
    }
    _save_partner_product_units(db, mapping)
    return mapping


def _partner_unit_info(unit_map: dict[str, dict], product_id: str) -> dict:
    meta = unit_map.get(str(product_id)) if isinstance(unit_map, dict) else None
    unit_type = _normalize_partner_unit_type((meta or {}).get("unit_type"))
    step = _normalize_partner_quantity_step(unit_type, (meta or {}).get("quantity_step"))
    return {
        "unit_type": unit_type,
        "unit_label": unit_type,
        "quantity_step": step,
    }


def _load_partner_product_meta(db: Session) -> dict[str, dict]:
    row = db.query(AppSetting).filter(AppSetting.key == PARTNER_PRODUCT_META_KEY).first()
    if not row:
        return {}
    try:
        payload = json.loads(row.value_json or "{}")
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _category_delivery_rule(settings: dict, category: str) -> dict:
    rules = settings.get("category_delivery_rules") if isinstance(settings, dict) else {}
    if not isinstance(rules, dict):
        return {"delivery_charge": 0.0, "free_delivery_threshold": 0.0}
    key = str(category or "").strip().lower()
    for name, rule in rules.items():
        if str(name or "").strip().lower() != key or not isinstance(rule, dict):
            continue
        return {
            "delivery_charge": max(0.0, float(rule.get("delivery_charge") or 0)),
            "free_delivery_threshold": max(0.0, float(rule.get("free_delivery_threshold") or 0)),
        }
    return {"delivery_charge": 0.0, "free_delivery_threshold": 0.0}


def _partner_category_delivery_rule(checkout_pref: dict, category: str) -> dict:
    rules = (checkout_pref or {}).get("category_delivery_rules")
    if not isinstance(rules, dict):
        return {"delivery_charge": 0.0, "free_delivery_threshold": 0.0}
    key = str(category or "").strip().lower()
    for name, rule in rules.items():
        if str(name or "").strip().lower() == key and isinstance(rule, dict):
            return {"delivery_charge": max(0.0, float(rule.get("delivery_charge") or 0)), "free_delivery_threshold": max(0.0, float(rule.get("free_delivery_threshold") or 0))}
    return {"delivery_charge": 0.0, "free_delivery_threshold": 0.0}


def _save_partner_product_meta(db: Session, mapping: dict[str, dict]) -> None:
    row = db.query(AppSetting).filter(AppSetting.key == PARTNER_PRODUCT_META_KEY).first()
    if not row:
        row = AppSetting(key=PARTNER_PRODUCT_META_KEY, value_json="{}")
        db.add(row)
    row.value_json = json.dumps(mapping or {})
    db.commit()


def _partner_product_meta(meta_map: dict[str, dict], product_id: str) -> dict:
    meta = meta_map.get(str(product_id)) if isinstance(meta_map, dict) else None
    listing_type = str((meta or {}).get("listing_type") or "product").strip().lower()
    if listing_type not in {"product", "service"}:
        listing_type = "product"
    is_service = bool((meta or {}).get("is_service") or listing_type == "service")
    service_invoice_mode = str((meta or {}).get("service_invoice_mode") or "detailed").strip().lower()
    if service_invoice_mode not in {"detailed", "summary_total"}:
        service_invoice_mode = "detailed"
    pdf_url = str((meta or {}).get("pdf_url") or (meta or {}).get("product_pdf_url") or "").strip()
    youtube_url = str((meta or {}).get("youtube_url") or "").strip()
    inventory_type = "SERVICE" if is_service else "PRODUCT"
    availability = str((meta or {}).get("availability") or ("available" if is_service else "")).strip().lower()
    if availability not in {"available", "unavailable", "temporarily_closed"}:
        availability = "available" if is_service else ""
    pricing_unit = str((meta or {}).get("pricing_unit") or ("PER_ITEM" if not is_service else "PER_VISIT")).strip().upper()
    return {
        "listing_type": "service" if is_service else "product",
        "item_kind": "service" if is_service else "product",
        "is_service": is_service,
        "service_booking_enabled": bool((meta or {}).get("service_booking_enabled") if (meta or {}).get("service_booking_enabled") is not None else is_service),
        "service_invoice_mode": service_invoice_mode,
        "service_template_key": str((meta or {}).get("service_template_key") or "").strip(),
        "pdf_url": pdf_url,
        "product_pdf_url": pdf_url,
        "youtube_url": youtube_url,
        "inventory_type": inventory_type,
        "opening_stock": max(0, int((meta or {}).get("opening_stock") or 0)),
        "purchase_cost": max(0.0, float((meta or {}).get("purchase_cost") or 0)),
        "sku": str((meta or {}).get("sku") or "").strip(),
        "sub_category": str((meta or {}).get("sub_category") or "").strip(),
        "brand": str((meta or {}).get("brand") or "").strip(),
        "price_before_gst": max(0.0, float((meta or {}).get("price_before_gst") or 0)),
        "gst_percent": max(0.0, float((meta or {}).get("gst_percent") or 0)),
        "pricing_unit": pricing_unit,
        "is_available": bool((meta or {}).get("is_available") if (meta or {}).get("is_available") is not None else availability == "available"),
        "availability": availability,
        "service_sector": str((meta or {}).get("service_sector") or "").strip(),
        "service_category": str((meta or {}).get("service_category") or "").strip(),
        "service_type": str((meta or {}).get("service_type") or "").strip(),
        "service_area": str((meta or {}).get("service_area") or "").strip(),
        "district": str((meta or {}).get("district") or "").strip(),
        "working_days": str((meta or {}).get("working_days") or "").strip(),
        "working_hours": str((meta or {}).get("working_hours") or "").strip(),
        "advance_booking_required": bool((meta or {}).get("advance_booking_required") or False),
        "advance_amount": max(0.0, float((meta or {}).get("advance_amount") or 0)),
        "delivery_charge": max(0.0, float((meta or {}).get("delivery_charge") or 0)),
        "free_delivery_threshold": max(0.0, float((meta or {}).get("free_delivery_threshold") or 0)),
        "vehicle_id": str((meta or {}).get("vehicle_id") or product_id).strip(),
        "vehicle_type": str((meta or {}).get("vehicle_type") or "").strip(),
        "vehicle_number": str((meta or {}).get("vehicle_number") or "").strip().upper(),
        "vehicle_category": str((meta or {}).get("vehicle_category") or "").strip(),
        "seating_capacity": max(0, int((meta or {}).get("seating_capacity") or 0)),
        "driver_name": str((meta or {}).get("driver_name") or "").strip(),
        "driver_phone": str((meta or {}).get("driver_phone") or "").strip(),
        "vehicle_status": str((meta or {}).get("vehicle_status") or ("AVAILABLE" if is_service else "")).strip().upper(),
        "driver_status": str((meta or {}).get("driver_status") or ("AVAILABLE" if is_service else "")).strip().upper(),
        "base_fare": max(0.0, float((meta or {}).get("base_fare") or 0)),
        "per_km_rate": max(0.0, float((meta or {}).get("per_km_rate") or 0)),
        "per_hour_rate": max(0.0, float((meta or {}).get("per_hour_rate") or 0)),
        "outstation_rate": max(0.0, float((meta or {}).get("outstation_rate") or 0)),
        "night_charge": max(0.0, float((meta or {}).get("night_charge") or 0)),
        "additional_charge": max(0.0, float((meta or {}).get("additional_charge") or 0)),
        "property_type": str((meta or {}).get("property_type") or "").strip(),
        "property_listing_type": str((meta or {}).get("property_listing_type") or "").strip(),
        "property_area": str((meta or {}).get("property_area") or "").strip(),
        "property_area_unit": str((meta or {}).get("property_area_unit") or "").strip(),
        "property_location": str((meta or {}).get("property_location") or "").strip(),
        "property_status": str((meta or {}).get("property_status") or "AVAILABLE").strip().upper(),
    }


def _set_partner_product_meta(db: Session, product_id: str, payload: dict | None) -> dict[str, dict]:
    mapping = _load_partner_product_meta(db)
    src = payload or {}
    listing_hint = str(src.get("listing_type") or src.get("item_kind") or "").strip().lower()
    is_service = bool(src.get("is_service") or src.get("service_booking_enabled") or listing_hint == "service")
    service_invoice_mode = str(src.get("service_invoice_mode") or "detailed").strip().lower()
    if service_invoice_mode not in {"detailed", "summary_total"}:
        service_invoice_mode = "detailed"
    pdf_url = str(src.get("pdf_url") or src.get("product_pdf_url") or "").strip()
    youtube_url = str(src.get("youtube_url") or "").strip()

    prev = mapping.get(str(product_id)) if isinstance(mapping.get(str(product_id)), dict) else {}
    if not pdf_url:
        pdf_url = str(prev.get("pdf_url") or prev.get("product_pdf_url") or "").strip()
    if not youtube_url:
        youtube_url = str(prev.get("youtube_url") or "").strip()

    def safe_int(value, fallback=0):
        try:
            return int(float(value)) if value not in (None, "") else int(fallback or 0)
        except (TypeError, ValueError):
            return int(fallback or 0)

    price_before_gst = max(0.0, float(src.get("price_before_gst") or src.get("price") or prev.get("price_before_gst") or 0))
    gst_percent = max(0.0, float(src.get("gst_percent") or prev.get("gst_percent") or 0))
    availability = str(src.get("availability") or prev.get("availability") or ("available" if is_service else "")).strip().lower()
    if availability not in {"available", "unavailable", "temporarily_closed"}:
        availability = "available" if is_service else ""
    mapping[str(product_id)] = {
        "listing_type": "service" if is_service else "product",
        "item_kind": "service" if is_service else "product",
        "is_service": is_service,
        "service_booking_enabled": bool(src.get("service_booking_enabled") if src.get("service_booking_enabled") is not None else is_service),
        "service_invoice_mode": service_invoice_mode,
        "service_template_key": str(src.get("service_template_key") or "").strip(),
        "pdf_url": pdf_url,
        "product_pdf_url": pdf_url,
        "youtube_url": youtube_url,
        "inventory_type": "SERVICE" if is_service else "PRODUCT",
        "opening_stock": 0 if is_service else max(0, safe_int(src.get("opening_stock"), prev.get("opening_stock") or src.get("stock") or 0)),
        "purchase_cost": max(0.0, float(src.get("purchase_cost") or prev.get("purchase_cost") or 0)),
        "sku": str(src.get("sku") or prev.get("sku") or "").strip(),
        "sub_category": str(src.get("sub_category") or prev.get("sub_category") or "").strip(),
        "brand": str(src.get("brand") or prev.get("brand") or "").strip(),
        "price_before_gst": price_before_gst,
        "gst_percent": gst_percent,
        "pricing_unit": str(src.get("pricing_unit") or prev.get("pricing_unit") or ("PER_VISIT" if is_service else "PER_ITEM")).strip().upper(),
        "is_available": bool(src.get("is_available") if src.get("is_available") is not None else availability == "available"),
        "availability": availability,
        "service_sector": str(src.get("service_sector") or prev.get("service_sector") or "").strip(),
        "service_category": str(src.get("service_category") or prev.get("service_category") or "").strip(),
        "service_type": str(src.get("service_type") or prev.get("service_type") or "").strip(),
        "service_area": str(src.get("service_area") or prev.get("service_area") or "").strip(),
        "district": str(src.get("district") or prev.get("district") or "").strip(),
        "working_days": str(src.get("working_days") or prev.get("working_days") or "").strip(),
        "working_hours": str(src.get("working_hours") or prev.get("working_hours") or "").strip(),
        "advance_booking_required": bool(src.get("advance_booking_required") if src.get("advance_booking_required") is not None else prev.get("advance_booking_required") or False),
        "advance_amount": max(0.0, float(src.get("advance_amount") or prev.get("advance_amount") or 0)),
        "delivery_charge": max(0.0, float(src.get("delivery_charge") if src.get("delivery_charge") is not None else prev.get("delivery_charge") or 0)),
        "free_delivery_threshold": max(0.0, float(src.get("free_delivery_threshold") if src.get("free_delivery_threshold") is not None else prev.get("free_delivery_threshold") or 0)),
        "vehicle_id": str(src.get("vehicle_id") or prev.get("vehicle_id") or product_id).strip(),
        "vehicle_type": str(src.get("vehicle_type") or prev.get("vehicle_type") or "").strip(),
        "vehicle_number": str(src.get("vehicle_number") or prev.get("vehicle_number") or "").strip().upper(),
        "vehicle_category": str(src.get("vehicle_category") or prev.get("vehicle_category") or "").strip(),
        "seating_capacity": max(0, safe_int(src.get("seating_capacity"), prev.get("seating_capacity") or 0)),
        "driver_name": str(src.get("driver_name") or prev.get("driver_name") or "").strip(),
        "driver_phone": str(src.get("driver_phone") or prev.get("driver_phone") or "").strip(),
        "vehicle_status": str(src.get("vehicle_status") or prev.get("vehicle_status") or ("AVAILABLE" if is_service else "")).strip().upper(),
        "driver_status": str(src.get("driver_status") or prev.get("driver_status") or ("AVAILABLE" if is_service else "")).strip().upper(),
        "base_fare": max(0.0, float(src.get("base_fare") or prev.get("base_fare") or 0)),
        "per_km_rate": max(0.0, float(src.get("per_km_rate") or prev.get("per_km_rate") or 0)),
        "per_hour_rate": max(0.0, float(src.get("per_hour_rate") or prev.get("per_hour_rate") or 0)),
        "outstation_rate": max(0.0, float(src.get("outstation_rate") or prev.get("outstation_rate") or 0)),
        "night_charge": max(0.0, float(src.get("night_charge") or prev.get("night_charge") or 0)),
        "additional_charge": max(0.0, float(src.get("additional_charge") or prev.get("additional_charge") or 0)),
        "property_type": str(src.get("property_type") or prev.get("property_type") or "").strip(),
        "property_listing_type": str(src.get("property_listing_type") or prev.get("property_listing_type") or "").strip(),
        "property_area": str(src.get("property_area") or prev.get("property_area") or "").strip(),
        "property_area_unit": str(src.get("property_area_unit") or prev.get("property_area_unit") or "").strip(),
        "property_location": str(src.get("property_location") or prev.get("property_location") or "").strip(),
        "property_status": str(src.get("property_status") or prev.get("property_status") or "AVAILABLE").strip().upper(),
    }
    _save_partner_product_meta(db, mapping)
    return mapping


def _candidate_upload_roots() -> list[Path]:
    roots: list[Path] = []

    def _add(root: Path | None):
        if not root:
            return
        try:
            resolved = root.resolve()
        except Exception:
            resolved = root
        key = str(resolved)
        if key not in {str(r) for r in roots}:
            roots.append(resolved)

    _add(UPLOADED_OBJECTS_DIR)

    explicit = (os.getenv("METHO_UPLOAD_ROOT") or os.getenv("UPLOADED_OBJECTS_DIR") or "").strip()
    if explicit:
        _add(Path(explicit))

    render_disk_path = (os.getenv("RENDER_DISK_PATH") or os.getenv("RENDER_DISK_MOUNT_PATH") or "").strip()
    if render_disk_path:
        _add(Path(render_disk_path))
        _add(Path(render_disk_path) / "uploaded_objects")

    # Fallback for hosts where persistent disk is mounted but env vars are not set.
    _add(Path("/var/data"))
    _add(Path("/var/data/uploaded_objects"))
    _add(Path("/data"))
    _add(Path("/data/uploaded_objects"))

    # Legacy roots used by previous backend builds.
    # Avoid fixed parent indexes because deployment paths can be shallower.
    try:
        current = Path(__file__).resolve()
    except Exception:
        current = Path(__file__)
    for ancestor in current.parents:
        _add(ancestor / "uploaded_objects")
    return roots


def _resolve_uploaded_file(path: str) -> Path | None:
    safe = str(path or "").replace("\\", "/").lstrip("/")
    if not safe or ".." in safe.split("/"):
        return None

    parts = safe.split("/")
    filename = parts[-1] if parts else ""
    rel_candidates = [safe]

    # Legacy/full-backend layouts used different subfolders for the same files.
    if safe.startswith("product_images/") and filename:
        rel_candidates.extend([
            f"metho-aay-upay/product-images/{filename}",
            f"metho-aay-upay/product_images/{filename}",
            f"product-images/{filename}",
        ])
    if safe.startswith("payment_screenshots/") and filename:
        rel_candidates.extend([
            f"metho-aay-upay/payment-screenshots/{filename}",
            f"metho-aay-upay/payment_screenshots/{filename}",
            f"payment-screenshots/{filename}",
        ])
    if safe.startswith("branding_images/") and filename:
        rel_candidates.extend([
            f"metho-aay-upay/branding_images/{filename}",
            f"metho-aay-upay/branding-images/{filename}",
            f"branding-images/{filename}",
        ])

    for root in _candidate_upload_roots():
        for rel in rel_candidates:
            candidate = root / rel
            try:
                if candidate.exists() and candidate.is_file() and os.access(candidate, os.R_OK):
                    return candidate
            except Exception:
                continue

    if filename:
        fallback_rel_prefixes = []
        if safe.startswith("product_images/"):
            fallback_rel_prefixes = [
                "product_images",
                "product-images",
                "metho-aay-upay/product_images",
                "metho-aay-upay/product-images",
            ]
        elif safe.startswith("payment_screenshots/"):
            fallback_rel_prefixes = [
                "payment_screenshots",
                "payment-screenshots",
                "metho-aay-upay/payment_screenshots",
                "metho-aay-upay/payment-screenshots",
            ]
        elif safe.startswith("branding_images/"):
            fallback_rel_prefixes = [
                "branding_images",
                "branding-images",
                "metho-aay-upay/branding_images",
                "metho-aay-upay/branding-images",
            ]

        for root in _candidate_upload_roots():
            for rel_prefix in fallback_rel_prefixes:
                candidate = root / rel_prefix / filename
                try:
                    if candidate.exists() and candidate.is_file() and os.access(candidate, os.R_OK):
                        return candidate
                except Exception:
                    continue

            # Final recovery path for legacy/moved folders.
            try:
                for candidate in root.rglob(filename):
                    if candidate.exists() and candidate.is_file() and os.access(candidate, os.R_OK):
                        return candidate
            except Exception:
                continue
    return None


def _build_file_cache_headers(file_path: Path, rel_path: str, media_type: str) -> dict[str, str]:
    stat = file_path.stat()
    etag = f'W/"{int(stat.st_mtime_ns):x}-{int(stat.st_size):x}"'
    rel = str(rel_path or "").replace("\\", "/").lstrip("/").lower()
    is_fast_static = (
        rel.startswith("product_images/")
        or rel.startswith("branding_images/")
        or media_type.startswith("image/")
        or media_type == "application/pdf"
    )
    cache_control = "public, max-age=604800, stale-while-revalidate=86400" if is_fast_static else "public, max-age=86400, stale-while-revalidate=3600"
    return {
        "ETag": etag,
        "Last-Modified": formatdate(stat.st_mtime, usegmt=True),
        "Cache-Control": cache_control,
        "Vary": "Accept-Encoding",
    }


def _load_checkout_razorpay_settings(db: Session) -> tuple[dict, str, str]:
    settings = load_settings(db)
    enabled = bool(settings.get("razorpay_enabled"))
    key_id = str(settings.get("razorpay_key_id") or "").strip()
    key_secret = str(settings.get("razorpay_key_secret") or "").strip()
    if not enabled:
        raise HTTPException(status_code=400, detail="Razorpay is disabled in settings")
    if not key_id or not key_secret:
        raise HTTPException(status_code=400, detail="Razorpay key_id/key_secret not configured")
    return settings, key_id, key_secret


def _razorpay_create_order(amount_paise: int, receipt: str, key_id: str, key_secret: str) -> dict:
    payload = json.dumps(
        {
            "amount": int(amount_paise),
            "currency": "INR",
            "receipt": receipt,
            "payment_capture": 1,
        }
    ).encode("utf-8")
    token = base64.b64encode(f"{key_id}:{key_secret}".encode("utf-8")).decode("ascii")
    req = urllib.request.Request(
        "https://api.razorpay.com/v1/orders",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Basic {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body or "{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="ignore")
        detail = "Razorpay order creation failed"
        try:
            parsed = json.loads(raw or "{}")
            detail = str(parsed.get("error", {}).get("description") or detail)
        except Exception:
            pass
        raise HTTPException(status_code=400, detail=detail)
    except Exception:
        raise HTTPException(status_code=502, detail="Razorpay gateway unreachable")


def _save_order_razorpay_ref(db: Session, order_id: str, razorpay_order_id: str):
    key = f"razorpay_order:{order_id}"
    payload = json.dumps(
        {
            "order_id": order_id,
            "razorpay_order_id": razorpay_order_id,
        }
    )
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row:
        db.add(AppSetting(key=key, value_json=payload))
    else:
        row.value_json = payload
    db.commit()


def _load_order_razorpay_ref(db: Session, order_id: str) -> str:
    key = f"razorpay_order:{order_id}"
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row or not row.value_json:
        return ""
    try:
        doc = json.loads(row.value_json or "{}")
    except Exception:
        return ""
    return str(doc.get("razorpay_order_id") or "").strip()


def _normalize_pricing_tiers(raw_tiers) -> list[dict]:
    if not raw_tiers:
        return []
    cleaned = {}
    if isinstance(raw_tiers, dict):
        iterator = [{"qty": k, "price": v} for k, v in raw_tiers.items()]
    elif isinstance(raw_tiers, list):
        iterator = raw_tiers
    else:
        return []

    for row in iterator:
        if not isinstance(row, dict):
            continue
        try:
            qty = int(row.get("qty") or row.get("quantity") or 0)
            price = float(row.get("price") or 0)
        except Exception:
            continue
        if qty <= 0 or price <= 0:
            continue
        cleaned[qty] = round(price, 2)

    return [{"qty": q, "price": cleaned[q]} for q in sorted(cleaned.keys())]


def _calc_tiered_subtotal(quantity: int, unit_price: float, tiers: list[dict]) -> tuple[float, list[dict]]:
    qty = max(1, int(quantity or 1))
    options = _normalize_pricing_tiers(tiers)
    if not options:
        subtotal = round(float(unit_price or 0) * qty, 2)
        return subtotal, [{"qty": 1, "count": qty, "price": round(float(unit_price or 0), 2)}]

    exact = next((o for o in options if int(o["qty"]) == qty), None)
    if exact:
        return round(float(exact["price"]), 2), [{"qty": int(exact["qty"]), "count": 1, "price": float(exact["price"])}]

    # For non-exact quantities, apply the biggest allowed packs first, then base-unit pricing for remainder.
    remaining = qty
    subtotal = 0.0
    breakdown = []
    for opt in sorted(options, key=lambda x: int(x["qty"]), reverse=True):
        pack_qty = int(opt["qty"])
        count = remaining // pack_qty
        if count <= 0:
            continue
        subtotal += float(opt["price"]) * count
        breakdown.append({"qty": pack_qty, "count": count, "price": float(opt["price"])})
        remaining -= pack_qty * count

    if remaining > 0:
        breakdown.append({"qty": 1, "count": remaining, "price": round(float(unit_price or 0), 2)})
        subtotal += round(float(unit_price or 0), 2) * remaining

    return round(subtotal, 2), breakdown


def _round_to_step(value: float, step: float) -> float:
    safe_step = max(0.01, float(step or 1.0))
    units = round(float(value or 0) / safe_step)
    rounded = units * safe_step
    return round(max(safe_step, rounded), 4)


def _resolve_partner_for_user(db: Session, user) -> AssociatePartner | None:
    if not user:
        return None
    email = str(getattr(user, "email", "") or "").strip().lower()
    phone = str(getattr(user, "phone", "") or "").strip()
    if email:
        by_email = db.query(AssociatePartner).filter(AssociatePartner.email == email).first()
        if by_email:
            return by_email
    if phone:
        by_phone = db.query(AssociatePartner).filter(AssociatePartner.phone == phone).first()
        if by_phone:
            return by_phone
        by_whatsapp = db.query(AssociatePartner).filter(AssociatePartner.whatsapp_no == phone).first()
        if by_whatsapp:
            return by_whatsapp
    return None


@router.post("/upload/payment-screenshot")
async def upload_payment_screenshot(file: UploadFile = File(...)):
    ext = Path(file.filename or "proof.jpg").suffix.lower() or ".jpg"
    name = f"{uuid.uuid4().hex}{ext}"
    path = UPLOAD_DIR / name
    content = await file.read()
    path.write_bytes(content)
    return {
        "url": f"/api/files/payment_screenshots/{name}",
        "storage_path": f"payment_screenshots/{name}",
    }


@router.get("/files/{path:path}")
def get_file(path: str, request: Request):
    file_path = _resolve_uploaded_file(path)
    if not file_path:
        raise HTTPException(status_code=404, detail="File not found")
    try:
        media_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        headers = _build_file_cache_headers(file_path, path, media_type)

        # Conditional GET support: return 304 when client cache is still valid.
        inm = str(request.headers.get("if-none-match") or "").strip()
        if inm and inm == headers.get("ETag"):
            return Response(status_code=304, headers=headers)

        # Read and return bytes directly to avoid sendfile/mount incompatibility on some hosts.
        content = file_path.read_bytes()
        return Response(content=content, media_type=media_type, headers=headers)
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")


@router.get("/public-files/{path:path}")
def get_public_file(path: str, request: Request):
    # Alias route used when upstream/proxy rules interfere with /api/files/* paths.
    return get_file(path, request)


@router.post("/orders")
def create_public_order(payload: dict, db: Session = Depends(get_db), authorization: str | None = Header(None)):
    items = payload.get("items") or []
    if not isinstance(items, list) or len(items) == 0:
        raise HTTPException(status_code=400, detail="Order items are required")

    total = 0.0
    normalized_items = []
    settings = load_settings(db)
    partner_unit_map = _load_partner_product_units(db)
    partner_meta_map = _load_partner_product_meta(db)
    partner_pref_cache = {}
    pricing_tier_map = settings.get("product_pricing_tiers") if isinstance(settings.get("product_pricing_tiers"), dict) else {}
    enable_partner_slab_pricing = bool(settings.get("enable_partner_slab_pricing", False))
    customer_user_id = ""
    auth_header = str(authorization or "")
    if auth_header.startswith("Bearer "):
        try:
            token = auth_header.split(" ", 1)[1]
            claims = decode_token(token)
            token_user_id = str(claims.get("user_id") or "").strip()
            if token_user_id:
                token_user = db.query(User).filter(User.id == token_user_id).first()
                token_role = str(getattr(token_user, "role", "") or "").strip().lower()
                # Public checkout should not auto-attach partner/admin/store-owner identities as invoice buyers.
                if token_user and token_role not in {"partner", "store_owner", "metho_store_owner", "owner", "admin", "super_admin", "company_admin"}:
                    customer_user_id = token_user_id
        except Exception:
            customer_user_id = ""

    for item in items:
        product_id = str(item.get("product_id", "")).strip()
        qty_raw = item.get("quantity")
        try:
            qty_value = float(qty_raw if qty_raw is not None else 1)
        except Exception:
            qty_value = 1.0
        product = db.query(Product).filter(Product.id == product_id).first()
        product_type = "metho"
        gst_percent = 0.0
        mrp = 0.0
        discount_percent = 0.0
        image_url = ""
        global_service_meta = {}
        if product:
            meta = db.query(ProductMeta).filter(ProductMeta.product_id == product.id).first()
            if meta:
                product_type = meta.product_type or "metho"
                gst_percent = float(meta.gst_percent or 0)
                mrp = float(meta.mrp or 0)
                discount_percent = float(meta.discount_percent or 0)
                image_url = meta.image_url or ""
            global_service_meta = _load_global_product_service_meta(db, product.id)
        if not product:
            product = db.query(PartnerProduct).filter(PartnerProduct.id == product_id).first()
            if product:
                product_type = "associate_partner"
        if not product:
            continue
        unit_info = {"unit_type": "piece", "unit_label": "piece", "quantity_step": 1.0}
        listing_meta = {
            "listing_type": "product",
            "item_kind": "product",
            "is_service": False,
            "service_booking_enabled": False,
            "service_invoice_mode": "detailed",
            "service_template_key": "",
        }
        if product_type == "associate_partner":
            unit_info = _partner_unit_info(partner_unit_map, product.id)
            listing_meta = _partner_product_meta(partner_meta_map, product.id)
            partner_id = str(getattr(product, "partner_id", "") or "")
            partner_pref_cache[partner_id] = partner_pref_cache.get(partner_id) or _load_partner_checkout_pref(db, partner_id)
            gst_percent = float(listing_meta.get("gst_percent") or 0)
        elif product_type == "metho_service":
            listing_meta = {
                "listing_type": "service",
                "item_kind": "service",
                "is_service": True,
                "service_booking_enabled": bool(global_service_meta.get("service_booking_enabled")),
                "service_invoice_mode": "detailed",
                "service_template_key": str(global_service_meta.get("service_template_key") or "").strip().lower(),
                "delivery_charge": max(0.0, float(global_service_meta.get("delivery_charge") or 0)),
            }

        if unit_info["unit_type"] == "piece":
            qty = max(1, int(round(qty_value or 1)))
        else:
            qty = _round_to_step(qty_value or unit_info["quantity_step"], unit_info["quantity_step"])

        is_service = bool(listing_meta.get("is_service"))
        if product_type == "associate_partner" and is_service and not bool(listing_meta.get("is_available")):
            raise HTTPException(status_code=400, detail=f"{product.name}: service is currently unavailable")
        available_stock = max(0.0, float(getattr(product, "stock", 0) or 0))
        if not is_service and qty > available_stock:
            raise HTTPException(
                status_code=400,
                detail="Insufficient stock available.",
            )
        unit_price = float(product.price)
        pricing_tiers = []
        if product_type in {"metho", "metho_service"}:
            pricing_tiers = _normalize_pricing_tiers(pricing_tier_map.get(product.id, []))
        elif product_type == "associate_partner" and enable_partner_slab_pricing:
            pricing_tiers = _normalize_pricing_tiers(pricing_tier_map.get(product.id, []))
        if product_type == "associate_partner" and unit_info["unit_type"] != "piece":
            base_subtotal = round(unit_price * float(qty), 2)
            tier_breakdown = [{"qty": float(qty), "count": 1, "price": round(unit_price, 2)}]
        else:
            base_subtotal, tier_breakdown = _calc_tiered_subtotal(int(qty), unit_price, pricing_tiers)

        gst_amount = 0.0
        pre_tax = base_subtotal
        line_total = base_subtotal
        if product_type in {"metho", "metho_service"} or (product_type == "associate_partner" and gst_percent > 0):
            gst_amount = round(base_subtotal * (max(0.0, gst_percent) / 100.0), 2)
            line_total = round(base_subtotal + gst_amount, 2)
            # Round final GST-inclusive price to nearest whole rupee
            line_total = float(round_half_up_to_whole_rupee(line_total))

        product_delivery_charge = max(0.0, float(global_service_meta.get("delivery_charge") or 0) if product_type in {"metho", "metho_service"} else float(listing_meta.get("delivery_charge") or 0))
        product_delivery_threshold = max(0.0, float(global_service_meta.get("free_delivery_threshold") or 0) if product_type in {"metho", "metho_service"} else float(listing_meta.get("free_delivery_threshold") or 0))
        category_rule = _partner_category_delivery_rule(partner_pref_cache.get(str(getattr(product, "partner_id", "") or "")), str(getattr(product, "category", "") or "")) if product_type == "associate_partner" else _category_delivery_rule(settings, str(getattr(product, "category", "") or ""))
        delivery_charge = product_delivery_charge or category_rule["delivery_charge"]
        delivery_threshold = product_delivery_threshold or category_rule["free_delivery_threshold"]
        total = round(total + float(round_half_up_to_whole_rupee(line_total)), 2)

        normalized_items.append(
            {
                "product_id": product.id,
                "name": product.name,
                "price": round(float(line_total) / max(1, qty), 2),
                "unit_base_price": round(base_subtotal / max(1, qty), 2),
                "mrp": mrp if mrp > 0 else float(product.price),
                "discount_percent": discount_percent,
                "gst_percent": gst_percent,
                "gst_amount": gst_amount,
                "pre_tax": pre_tax,
                "quantity": qty,
                "subtotal": float(round_half_up_to_whole_rupee(line_total)),
                "delivery_charge": delivery_charge,
                "delivery_total": 0.0,
                "free_delivery_threshold": delivery_threshold,
                "product_type": product_type,
                "commission_percent": global_service_meta.get("commission_percent") if product_type in {"metho", "metho_service"} else None,
                "unit_type": unit_info["unit_type"],
                "unit_label": unit_info["unit_label"],
                "quantity_step": unit_info["quantity_step"],
                "image_url": image_url,
                "pricing_tiers": pricing_tiers,
                "tier_breakdown": tier_breakdown,
                "listing_type": str(listing_meta["listing_type"] if product_type == "metho_service" else (item.get("listing_type") or listing_meta["listing_type"])).strip().lower(),
                "item_kind": str(listing_meta["item_kind"] if product_type == "metho_service" else (item.get("item_kind") or listing_meta["item_kind"])).strip().lower(),
                "is_service": bool(listing_meta["is_service"] if product_type == "metho_service" else (item.get("is_service") if item.get("is_service") is not None else listing_meta["is_service"])),
                "service_booking_enabled": bool(listing_meta["service_booking_enabled"]),
                "service_invoice_mode": str(item.get("service_invoice_mode") or listing_meta["service_invoice_mode"]).strip().lower(),
                "service_template_key": str(listing_meta["service_template_key"] if product_type == "metho_service" else (item.get("service_template_key") or listing_meta["service_template_key"])).strip(),
                "booking_available_from": str(global_service_meta.get("booking_available_from") or "") if product_type in {"metho", "metho_service"} else "",
                "booking_available_until": str(global_service_meta.get("booking_available_until") or "") if product_type in {"metho", "metho_service"} else "",
                "delivery_category": str(getattr(product, "category", "") or "").strip(),
                "pricing_unit": str(listing_meta.get("pricing_unit") or "PER_ITEM"),
                "availability": str(listing_meta.get("availability") or ""),
            }
        )

    if len(normalized_items) == 0:
        raise HTTPException(status_code=400, detail="No valid products found in order")

    merchandise_total = round(sum(float(item.get("subtotal") or 0) for item in normalized_items), 2)
    delivery_groups = {}
    for item in normalized_items:
        key = str(item.get("delivery_category") or item.get("category") or "General").strip().lower() or "general"
        group = delivery_groups.setdefault(key, {"subtotal": 0.0, "charge": 0.0, "threshold": 0.0, "first": item})
        group["subtotal"] += float(item.get("subtotal") or 0)
        group["charge"] = max(group["charge"], float(item.get("delivery_charge") or 0))
        group["threshold"] = max(group["threshold"], float(item.get("free_delivery_threshold") or 0))
    applicable_charges = []
    for group in delivery_groups.values():
        charge = 0.0 if group["threshold"] > 0 and group["subtotal"] >= group["threshold"] else float(round_half_up_to_whole_rupee(group["charge"]))
        group["applicable_charge"] = charge
        if charge > 0:
            applicable_charges.append(charge)
    cart_delivery_total = max(applicable_charges, default=0.0)
    first_delivery_group = next((group for group in delivery_groups.values() if group.get("applicable_charge", 0) == cart_delivery_total), None)
    if first_delivery_group:
        first_delivery_group["first"]["delivery_total"] = cart_delivery_total
    total = round(merchandise_total + cart_delivery_total, 2)

    member_ref = str(payload.get("member_code") or payload.get("member_id") or "").strip()
    payer_name_raw = str(payload.get("payer_name") or "").strip()
    customer_name = payer_name_raw
    customer_phone = str(payload.get("customer_phone") or "").strip()
    shipping_address = str(payload.get("shipping_address") or "").strip()
    slot_datetime = str(payload.get("slot_datetime") or "").strip()
    guest_count_raw = payload.get("guest_count")
    try:
        guest_count = int(guest_count_raw if guest_count_raw is not None else 0)
    except Exception:
        guest_count = 0
    payment_method = str(payload.get("payment_method") or "upi").strip().lower()
    customer_phone_digits = "".join(ch for ch in customer_phone if ch.isdigit())

    if str(customer_user_id or "").strip():
        customer_user = db.query(User).filter(User.id == str(customer_user_id).strip()).first()
        if customer_user:
            if not customer_name:
                customer_name = str(getattr(customer_user, "name", "") or "").strip()
            if not customer_phone_digits:
                customer_phone_digits = "".join(ch for ch in str(getattr(customer_user, "phone", "") or "") if ch.isdigit())

    if not customer_name:
        customer_name = "Customer"

    has_partner_item = False
    has_partner_physical_item = False
    has_delivery_partner_item = False
    has_service_slot_item = False
    has_restaurant_slot_item = False
    for item in normalized_items:
        item_type = str(item.get("product_type") or "").strip()
        if item_type == "associate_partner":
            has_partner_item = True
        template_key = str(item.get("service_template_key") or "").strip().lower()
        if template_key in {"courier_pickup", "parcel_delivery", "express_delivery", "same_day_delivery", "delivery_partner"}:
            has_delivery_partner_item = True
        if template_key in RESTAURANT_SLOT_TEMPLATE_KEYS and _is_service_order_item(item):
            has_restaurant_slot_item = True
        elif _is_service_order_item(item) and template_key not in TRANSPORT_TEMPLATE_KEYS:
            has_service_slot_item = True
        if item_type == "associate_partner" and not _is_service_order_item(item):
            has_partner_physical_item = True

    if has_partner_item and not customer_phone_digits:
        raise HTTPException(status_code=400, detail="Partner order requires customer mobile number")
    if has_partner_physical_item and not shipping_address:
        raise HTTPException(status_code=400, detail="Delivery address is required for partner product orders")

    if has_delivery_partner_item:
        delivery_city = ""
        delivery_pincode = ""
        for item in normalized_items:
            if str(item.get("product_type") or "").strip() != "associate_partner":
                continue
            template_key = str(item.get("service_template_key") or "").strip().lower()
            if template_key not in {"courier_pickup", "parcel_delivery", "express_delivery", "same_day_delivery", "delivery_partner"}:
                continue
            product_id = str(item.get("product_id") or "").strip()
            if not product_id:
                continue
            partner_product = db.query(PartnerProduct).filter(PartnerProduct.id == product_id).first()
            if not partner_product or not partner_product.partner_id:
                continue
            partner = db.query(AssociatePartner).filter(AssociatePartner.id == partner_product.partner_id).first()
            if not partner:
                continue
            checkout_pref = _load_partner_checkout_pref(db, partner.id)
            delivery_city = str(checkout_pref.get("delivery_city") or "").strip()
            delivery_pincode = str(checkout_pref.get("delivery_pincode") or "").strip()
            if delivery_city or delivery_pincode:
                break
        if (delivery_city or delivery_pincode) and not _delivery_area_matches(shipping_address, delivery_city, delivery_pincode):
            area_label = ", ".join([part for part in [delivery_city, delivery_pincode] if part])
            raise HTTPException(status_code=400, detail=f"Delivery is available only in {area_label}")

    if payment_method == "cod":
        if not customer_name or customer_name == "Customer":
            raise HTTPException(status_code=400, detail="COD order requires customer name")
        if not customer_phone_digits:
            raise HTTPException(status_code=400, detail="COD order requires customer phone")

    if has_service_slot_item and not slot_datetime:
        raise HTTPException(status_code=400, detail="Service slot booking requires date and time")

    has_tourism_item = any(
        str(item.get("product_type") or "").strip().lower() == "metho_service"
        and str(item.get("service_template_key") or "").strip().lower() == "tourism_booking"
        for item in normalized_items
    )
    if has_tourism_item and payload.get("tourism_terms_accepted") is not True:
        raise HTTPException(status_code=400, detail="Travel booking terms must be accepted before payment")

    if has_tourism_item:
        requested_tourism_dt = _parse_slot_datetime(slot_datetime)
        if not requested_tourism_dt:
            raise HTTPException(status_code=400, detail="Valid tourism booking date and time is required")
        for tourism_item in normalized_items:
            if str(tourism_item.get("service_template_key") or "").strip().lower() != "tourism_booking":
                continue
            available_from = _parse_slot_datetime(tourism_item.get("booking_available_from"))
            available_until = _parse_slot_datetime(tourism_item.get("booking_available_until"))
            if available_from and requested_tourism_dt < available_from:
                raise HTTPException(status_code=409, detail=f"This tour is available from {available_from.strftime('%d %b %Y, %I:%M %p')}")
            if available_until and requested_tourism_dt > available_until:
                raise HTTPException(status_code=409, detail=f"This tour is available until {available_until.strftime('%d %b %Y, %I:%M %p')}")

    if has_service_slot_item:
        requested_slot_dt = _parse_slot_datetime(slot_datetime)
        if not requested_slot_dt:
            raise HTTPException(status_code=400, detail="Invalid slot date and time format")
        slot_product_ids = _service_slot_product_ids_from_items(normalized_items)
        slot_interval_minutes = _resolve_slot_suggestion_interval_minutes(db, slot_product_ids)
        suggested_slot = _next_available_service_slot_suggestion(db, slot_datetime, slot_product_ids, slot_interval_minutes)
        if suggested_slot:
            raise HTTPException(status_code=409, detail=f"Selected slot is already booked. Try next slot: {suggested_slot}")

    if has_restaurant_slot_item:
        if guest_count <= 0:
            raise HTTPException(status_code=400, detail="Restaurant slot booking requires guest count")
        restaurant_capacity_limit = None
        for item in normalized_items:
            template_key = str(item.get("service_template_key") or "").strip().lower()
            if template_key not in RESTAURANT_SLOT_TEMPLATE_KEYS:
                continue
            product_id = str(item.get("product_id") or "").strip()
            if not product_id:
                continue
            partner_product = db.query(PartnerProduct).filter(PartnerProduct.id == product_id).first()
            if not partner_product:
                continue
            capacity = max(0, int(getattr(partner_product, "stock", 0) or 0))
            restaurant_capacity_limit = capacity if restaurant_capacity_limit is None else min(restaurant_capacity_limit, capacity)
        if restaurant_capacity_limit is not None and guest_count > restaurant_capacity_limit:
            raise HTTPException(status_code=400, detail=f"Guest count exceeds seating capacity ({restaurant_capacity_limit})")
        slot_summary = f"Restaurant Slot: {slot_datetime} | Guests: {guest_count}"
        shipping_address = f"{slot_summary} | Note: {shipping_address}" if shipping_address else slot_summary
    elif has_service_slot_item:
        slot_summary = f"Service Slot: {slot_datetime}"
        shipping_address = f"{slot_summary} | Note: {shipping_address}" if shipping_address else slot_summary

    row = PublicOrder(
        id=str(uuid.uuid4()),
        customer_user_id=customer_user_id,
        member_ref=member_ref,
        shipping_address=shipping_address,
        payment_method=payment_method,
        txn_id=str(payload.get("txn_id") or "").strip(),
        payment_screenshot_url=str(payload.get("payment_screenshot_url") or "").strip(),
        payer_name=customer_name,
        items_json=json.dumps(normalized_items),
        total_amount=total,
        status="pending_approval",
    )
    db.add(row)
    db.commit()
    _save_order_contact_phone(db, row.id, customer_phone_digits)
    if has_tourism_item:
        _save_tourism_terms_acceptance(db, row.id, customer_name, customer_phone_digits)
        db.commit()

    partner_whatsapp_urls = []
    partner_ids_seen = set()
    for item in normalized_items:
        if str(item.get("product_type") or "").strip() != "associate_partner":
            continue
        pid = str(item.get("product_id") or "").strip()
        if not pid or pid in partner_ids_seen:
            continue
        partner_product = db.query(PartnerProduct).filter(PartnerProduct.id == pid).first()
        if not partner_product or not partner_product.partner_id:
            continue
        partner_ids_seen.add(pid)
        partner = db.query(AssociatePartner).filter(AssociatePartner.id == partner_product.partner_id).first()
        if not partner:
            continue
        invoice_url = f"https://methoaayupay.com/invoice/{row.id}"
        message = (
            f"New offline partner/service order request received.\n"
            f"Order ID: ORD-{row.id[:8].upper()}\n"
            f"Customer: {customer_name}\n"
            f"Total: ₹{float(row.total_amount or 0):.2f}\n"
            f"Open Invoice: {invoice_url}"
        )
        whatsapp_url = _build_partner_whatsapp_url(partner.whatsapp_no or partner.phone, message)
        if whatsapp_url:
            partner_whatsapp_urls.append({
                "partner_id": partner.id,
                "partner_code": partner.partner_code,
                "url": whatsapp_url,
            })

    return {
        "id": row.id,
        "status": row.status,
        "total_amount": row.total_amount,
        "items": normalized_items,
        "member_whatsapp_share_url": "",
        "partner_whatsapp_url": (partner_whatsapp_urls[0]["url"] if partner_whatsapp_urls else ""),
        "partner_whatsapp_urls": partner_whatsapp_urls,
    }


@router.post("/orders/{order_id}/submit-payment")
def submit_payment(order_id: str, payload: dict, db: Session = Depends(get_db)):
    row = db.query(PublicOrder).filter(PublicOrder.id == order_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")

    row.txn_id = str(payload.get("txn_id") or row.txn_id)
    row.payment_screenshot_url = str(payload.get("payment_screenshot_url") or row.payment_screenshot_url)
    row.payer_name = str(payload.get("payer_name") or row.payer_name)
    row.status = "pending_payment" if str(row.payment_method or "").lower() in {"cash", "cod"} else "pending_approval"
    db.commit()

    return {"id": row.id, "status": row.status, "total_amount": row.total_amount}


@router.post("/payments/razorpay/order")
def create_razorpay_order(payload: dict, db: Session = Depends(get_db)):
    order_id = str((payload or {}).get("order_id") or "").strip()
    if not order_id:
        raise HTTPException(status_code=400, detail="order_id is required")

    row = db.query(PublicOrder).filter(PublicOrder.id == order_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")

    _, key_id, key_secret = _load_checkout_razorpay_settings(db)

    amount_paise = int(round(float(row.total_amount or 0) * 100))
    if amount_paise <= 0:
        raise HTTPException(status_code=400, detail="Invalid order amount")

    receipt = f"metho_{order_id[:18]}"
    rp = _razorpay_create_order(amount_paise, receipt, key_id, key_secret)
    razorpay_order_id = str(rp.get("id") or "").strip()
    if not razorpay_order_id:
        raise HTTPException(status_code=502, detail="Razorpay order id missing")

    _save_order_razorpay_ref(db, order_id, razorpay_order_id)

    return {
        "key_id": key_id,
        "amount": amount_paise,
        "currency": str(rp.get("currency") or "INR"),
        "razorpay_order_id": razorpay_order_id,
        "name": "METHOO STORE",
        "description": f"Order {order_id[:8].upper()} payment",
    }


@router.post("/payments/razorpay/verify-and-submit")
def verify_razorpay_and_submit(payload: dict, db: Session = Depends(get_db)):
    order_id = str((payload or {}).get("order_id") or "").strip()
    razorpay_order_id = str((payload or {}).get("razorpay_order_id") or "").strip()
    razorpay_payment_id = str((payload or {}).get("razorpay_payment_id") or "").strip()
    razorpay_signature = str((payload or {}).get("razorpay_signature") or "").strip()
    payer_name = str((payload or {}).get("payer_name") or "").strip()
    currency = str((payload or {}).get("currency") or "INR").strip().upper()

    if not order_id or not razorpay_order_id or not razorpay_payment_id or not razorpay_signature:
        raise HTTPException(status_code=400, detail="Missing Razorpay verification fields")
    if currency != "INR":
        raise HTTPException(status_code=400, detail="Currency mismatch")

    _, _, key_secret = _load_checkout_razorpay_settings(db)

    expected_order_id = _load_order_razorpay_ref(db, order_id)
    if expected_order_id and expected_order_id != razorpay_order_id:
        raise HTTPException(status_code=400, detail="Razorpay order mismatch")

    signed_payload = f"{razorpay_order_id}|{razorpay_payment_id}".encode("utf-8")
    expected_signature = hmac.new(key_secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_signature, razorpay_signature):
        raise HTTPException(status_code=400, detail="Invalid Razorpay signature")

    row = db.query(PublicOrder).filter(PublicOrder.id == order_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")

    received_amount = (payload or {}).get("amount")
    if received_amount is not None and round(float(received_amount), 2) != round(float(row.total_amount or 0), 2):
        raise HTTPException(status_code=400, detail="Payment amount mismatch")
    duplicate_payment = db.query(PublicOrder).filter(PublicOrder.txn_id == razorpay_payment_id, PublicOrder.id != order_id).first()
    if duplicate_payment:
        raise HTTPException(status_code=409, detail="Payment reference already used")
    if str(row.status or "").lower() == "paid" and str(row.txn_id or "").strip() == razorpay_payment_id:
        return {
            "id": row.id,
            "status": "paid",
            "total_amount": float(row.total_amount or 0),
            "auto_approved": True,
            "already_processed": True,
            "approval_reason": "Payment was already verified.",
        }

    row.txn_id = razorpay_payment_id
    if payer_name:
        row.payer_name = payer_name
    row.status = "pending_approval"
    db.commit()

    from .compat import _record_payment_once
    _record_payment_once(db, row, razorpay_payment_id, razorpay_order_id, float(row.total_amount or 0), currency)

    try:
        items = json.loads(row.items_json or "[]")
    except Exception:
        items = []
    partner_ids = set()
    if isinstance(items, list) and items and all(str(item.get("product_type") or "").lower() == "associate_partner" for item in items):
        for item in items:
            product = db.query(PartnerProduct).filter(PartnerProduct.id == str(item.get("product_id") or "")).first()
            if product:
                partner_ids.add(str(product.partner_id))
    if len(partner_ids) == 1:
        from .compat import _credit_partner_customer_payment_once
        partner = db.query(AssociatePartner).filter(AssociatePartner.id == next(iter(partner_ids))).first()
        if partner:
            _credit_partner_customer_payment_once(db, partner, row, razorpay_payment_id)

    # Auto-approve verified Razorpay orders so invoice and commission logic run immediately.
    try:
        from .compat import admin_approve_order

        approved = admin_approve_order(
            order_id=order_id,
            payload={"note": "Auto-approved via Razorpay verification"},
            db=db,
            current_user=SimpleNamespace(role="super_admin"),
        )
        from .compat import _invoice_payload
        _invoice_payload(db, order_id, SimpleNamespace(role="super_admin", id="RAZORPAY"))
        return {
            "id": order_id,
            "status": "paid",
            "total_amount": float(row.total_amount or 0),
            "auto_approved": True,
            "approval_reason": "Payment verified and order auto-approved.",
            "rewards_earned": approved.get("rewards_earned", {}),
            "commission_split": approved.get("commission_split", {}),
        }
    except HTTPException as exc:
        return {
            "id": row.id,
            "status": row.status,
            "total_amount": float(row.total_amount or 0),
            "auto_approved": False,
            "approval_reason": str(exc.detail or "Payment received. Admin approval pending."),
        }
    except Exception:
        return {
            "id": row.id,
            "status": row.status,
            "total_amount": float(row.total_amount or 0),
            "auto_approved": False,
            "approval_reason": "Payment received. Admin approval pending.",
        }


@router.get("/partner/summary")
def partner_summary(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role != "partner":
        return {
            "partner_code": "-",
            "business_name": current_user.name,
            "business_type": "",
            "commission_percent": 0,
            "total_sales": 0,
            "total_commission_paid": 0,
            "products_linked": 0,
            "current_period": "N/A",
            "this_month": {"sales": 0, "commission": 0, "orders": 0},
        }

    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        return {
            "partner_code": "MTH-PARTNER",
            "business_name": current_user.name,
            "business_type": "",
            "commission_percent": 10,
            "total_sales": 0,
            "total_commission_paid": 0,
            "products_linked": 0,
            "current_period": "N/A",
            "this_month": {"sales": 0, "commission": 0, "orders": 0},
        }

    products_linked = (
        db.query(PartnerProduct)
        .filter(PartnerProduct.partner_id == partner.id, PartnerProduct.active.is_(True))
        .count()
    )

    partner_product_ids = _partner_product_ids(db, partner.id)
    finalized_statuses = {"paid", "approved", "completed", "delivered", "processing"}
    total_sales = 0.0
    total_commission = 0.0
    month_sales = 0.0
    month_commission = 0.0
    month_orders = set()
    current_period = datetime.now(timezone.utc).strftime("%Y-%m")

    for order in db.query(PublicOrder).order_by(PublicOrder.created_at.asc()).all():
        if str(order.status or "").strip().lower() not in finalized_statuses:
            continue
        try:
            items = json.loads(order.items_json or "[]")
        except Exception:
            items = []
        order_sales = 0.0
        for item in items:
            if str(item.get("product_id") or "") not in partner_product_ids:
                continue
            order_sales += max(0.0, float(item.get("subtotal") or 0))
        order_sales = round(order_sales, 2)
        if order_sales <= 0:
            continue
        commission = round(order_sales * max(0.0, min(100.0, float(partner.commission_percent or 0))) / 100.0, 2)
        total_sales += order_sales
        total_commission += commission
        created_at = order.created_at
        if created_at and created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        if created_at and created_at.astimezone(timezone.utc).strftime("%Y-%m") == current_period:
            month_sales += order_sales
            month_commission += commission
            month_orders.add(order.id)

    return {
        "partner_code": partner.partner_code,
        "business_name": partner.business_name,
        "business_type": str(partner.business_type or ""),
        "commission_percent": float(partner.commission_percent or 0),
        "total_sales": round(total_sales, 2),
        "total_commission_paid": round(total_commission, 2),
        "products_linked": products_linked,
        "current_period": current_period,
        "this_month": {
            "sales": round(month_sales, 2),
            "commission": round(month_commission, 2),
            "orders": len(month_orders),
        },
    }


@router.get("/partner/products")
def partner_products(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role != "partner":
        return []
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        return []

    rows = (
        db.query(PartnerProduct)
        .filter(PartnerProduct.partner_id == partner.id, PartnerProduct.active.is_(True))
        .order_by(PartnerProduct.created_at.desc())
        .all()
    )
    unit_map = _load_partner_product_units(db)
    meta_map = _load_partner_product_meta(db)
    result = []
    for p in rows:
        listing_meta = _partner_product_meta(meta_map, p.id)
        opening_stock = max(0, int(listing_meta.get("opening_stock") or 0))
        current_stock = max(0, int(p.stock or 0))
        is_service = bool(listing_meta.get("is_service"))
        result.append({
            "id": p.id,
            "name": p.name,
            "category": p.category,
            "description": p.description,
            "image_url": p.image_url,
            "price": float(p.price or 0),
            "stock": current_stock,
            "opening_stock": opening_stock if not is_service else None,
            "current_stock": current_stock if not is_service else None,
            "sold_quantity": max(0, opening_stock - current_stock) if not is_service else None,
            "stock_status": ("inactive" if not p.active else "out_of_stock" if current_stock <= 0 else "low_stock" if current_stock <= 5 else "in_stock") if not is_service else "",
            "approval_status": p.approval_status,
            "active": bool(p.active),
            "partner_id": p.partner_id,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            **_partner_unit_info(unit_map, p.id),
            **listing_meta,
        })
    return result


def _partner_inventory_sector(product: PartnerProduct, meta: dict, meta_map: dict) -> str:
    if not bool(meta.get("is_service") or str(meta.get("listing_type") or "").lower() == "service"):
        return "product"
    if str(meta.get("property_type") or "").strip():
        return "property"
    from .compat import _is_delivery_service_listing, _is_transport_service_listing
    if _is_delivery_service_listing(product, meta_map):
        return "courier"
    if _is_transport_service_listing(product, meta_map):
        return "transport"
    return "service"


def _partner_inventory_item(product: PartnerProduct, meta_map: dict, unit_map: dict) -> dict:
    meta = _partner_product_meta(meta_map, product.id)
    sector = _partner_inventory_sector(product, meta, meta_map)
    price_before_gst = round(float(meta.get("price_before_gst") or product.price or 0), 2)
    gst_percent = round(float(meta.get("gst_percent") or 0), 2)
    gst_amount = round(price_before_gst * gst_percent / 100.0, 2)
    final_price = round(price_before_gst + gst_amount, 2)
    return {
        "sector": sector,
        "item_type": "product" if sector == "product" else "service",
        "item_id": product.id,
        "name": product.name,
        "status": ("IN STOCK" if float(product.stock or 0) > 0 else "OUT OF STOCK") if sector == "product" else str(meta.get("property_status") or meta.get("vehicle_status") or meta.get("availability") or "AVAILABLE").upper(),
        "category": product.category,
        "description": product.description,
        "image_url": product.image_url,
        "price": price_before_gst,
        "price_before_gst": price_before_gst,
        "purchase_cost": round(float(meta.get("purchase_cost") or 0), 2),
        "gst_percent": gst_percent,
        "gst_amount": gst_amount,
        "final_price": final_price,
        "sku": meta.get("sku") or meta.get("product_code") or "",
        "pdf_url": meta.get("pdf_url") or "",
        "listing_type": meta.get("listing_type") or ("service" if sector != "product" else "product"),
        "is_service": sector != "product",
        "is_available": meta.get("is_available", True),
        "availability": meta.get("availability") or "available",
        "service_sector": meta.get("service_sector") or "",
        "service_category": meta.get("service_category") or "",
        "service_type": meta.get("service_type") or "",
        "service_template_key": meta.get("service_template_key") or "",
        "service_area": meta.get("service_area") or "",
        "vehicle_category": meta.get("vehicle_category") or "",
        "vehicle_status": meta.get("vehicle_status") or "",
        "seating_capacity": meta.get("seating_capacity") or meta.get("capacity") or "",
        "base_fare": meta.get("base_fare") or price_before_gst,
        "per_km_rate": meta.get("per_km_rate") or "",
        "property_area": meta.get("property_area") or "",
        "property_area_unit": meta.get("property_area_unit") or "",
        "property_location": meta.get("property_location") or "",
        "enquiry_count": meta.get("enquiry_count") or 0,
        "current_stock": max(0, int(product.stock or 0)) if sector == "product" else None,
        "vehicle_type": meta.get("vehicle_type"),
        "vehicle_number": meta.get("vehicle_number"),
        "property_type": meta.get("property_type"),
        "property_listing_type": meta.get("property_listing_type"),
        "property_status": meta.get("property_status"),
        **_partner_unit_info(unit_map, product.id),
    }


@router.get("/partner/inventory")
def partner_inventory(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")
    meta_map = _load_partner_product_meta(db)
    unit_map = _load_partner_product_units(db)
    products = db.query(PartnerProduct).filter(PartnerProduct.partner_id == partner.id, PartnerProduct.active.is_(True)).order_by(PartnerProduct.created_at.desc()).all()
    return {"items": [_partner_inventory_item(product, meta_map, unit_map) for product in products]}


@router.get("/partner/inventory/{item_id}")
def partner_inventory_detail(item_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")
    product = db.query(PartnerProduct).filter(PartnerProduct.id == item_id, PartnerProduct.partner_id == partner.id, PartnerProduct.active.is_(True)).first()
    if not product:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    return _partner_inventory_item(product, _load_partner_product_meta(db), _load_partner_product_units(db))


@router.post("/partner/products")
def partner_products_create(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role != "partner":
        raise HTTPException(status_code=403, detail="Only partners can add products")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=400, detail="Partner profile not linked to this account")

    name = str((payload or {}).get("name") or "").strip()
    category = str((payload or {}).get("category") or "General").strip() or "General"
    if not name:
        raise HTTPException(status_code=400, detail="Product name is required")

    try:
        price = float((payload or {}).get("price") or 0)
    except Exception:
        price = 0
    if price <= 0:
        raise HTTPException(status_code=400, detail="Valid price is required")

    listing_type = str((payload or {}).get("listing_type") or (payload or {}).get("item_kind") or "product").strip().lower()
    is_service = bool((payload or {}).get("is_service") or (payload or {}).get("service_booking_enabled") or listing_type == "service")
    try:
        stock = int((payload or {}).get("stock") or 0)
    except Exception:
        stock = 0
    stock = 0 if is_service else max(0, stock)

    row = PartnerProduct(
        partner_id=partner.id,
        name=name,
        category=category,
        description=str((payload or {}).get("description") or "").strip(),
        image_url=str((payload or {}).get("image_url") or "").strip(),
        price=price,
        stock=stock,
        approval_status="approved",
        active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    _set_partner_product_unit(db, row.id, (payload or {}).get("unit_type"))
    create_payload = dict(payload or {})
    create_payload["opening_stock"] = stock
    _set_partner_product_meta(db, row.id, create_payload)

    return {"ok": True, "message": "Product created and live"}


@router.put("/partner/products/{product_id}")
def partner_products_update(product_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role != "partner":
        raise HTTPException(status_code=403, detail="Only partners can edit products")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=400, detail="Partner profile not linked to this account")

    product = (
        db.query(PartnerProduct)
        .filter(
            PartnerProduct.id == product_id,
            PartnerProduct.partner_id == partner.id,
            PartnerProduct.active.is_(True),
        )
        .first()
    )
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    if (payload or {}).get("name") is not None:
        name = str((payload or {}).get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Product name is required")
        product.name = name
    if (payload or {}).get("category") is not None:
        category = str((payload or {}).get("category") or "").strip() or "General"
        product.category = category
    if (payload or {}).get("description") is not None:
        product.description = str((payload or {}).get("description") or "").strip()
    if (payload or {}).get("image_url") is not None:
        product.image_url = str((payload or {}).get("image_url") or "").strip()
    if (payload or {}).get("price") is not None:
        try:
            price = float((payload or {}).get("price") or 0)
        except Exception:
            price = 0
        if price <= 0:
            raise HTTPException(status_code=400, detail="Valid price is required")
        product.price = price
    next_listing_type = str((payload or {}).get("listing_type") or (payload or {}).get("item_kind") or "").strip().lower()
    next_is_service = bool((payload or {}).get("is_service") or (payload or {}).get("service_booking_enabled") or next_listing_type == "service")
    existing_meta = _partner_product_meta(_load_partner_product_meta(db), product.id)
    is_service = next_is_service if next_listing_type or (payload or {}).get("is_service") is not None or (payload or {}).get("service_booking_enabled") is not None else bool(existing_meta.get("is_service"))
    if (payload or {}).get("stock") is not None and not is_service:
        try:
            stock = int((payload or {}).get("stock") or 0)
        except Exception:
            stock = 0
        product.stock = max(0, stock)

    if (payload or {}).get("unit_type") is not None:
        _set_partner_product_unit(db, product.id, (payload or {}).get("unit_type"))
    if any((payload or {}).get(key) is not None for key in [
        "listing_type",
        "item_kind",
        "is_service",
        "service_booking_enabled",
        "service_invoice_mode",
        "service_template_key",
        "youtube_url",
        "purchase_cost",
        "price_before_gst",
        "gst_percent",
        "pricing_unit",
        "is_available",
        "availability",
        "service_sector",
        "service_category",
        "service_type",
        "service_area",
        "district",
        "working_days",
        "working_hours",
        "advance_booking_required",
        "advance_amount",
        "vehicle_id",
        "vehicle_type",
        "vehicle_number",
        "vehicle_category",
        "seating_capacity",
        "driver_name",
        "driver_phone",
        "vehicle_status",
        "driver_status",
        "base_fare",
        "per_km_rate",
        "per_hour_rate",
        "outstation_rate",
        "night_charge",
        "additional_charge",
        "property_type",
        "property_listing_type",
        "property_area",
        "property_area_unit",
        "property_location",
        "property_status",
    ]):
        _set_partner_product_meta(db, product.id, payload)

    if is_service:
        product.stock = 0

    # Partner edits stay live unless explicitly deactivated by admin.
    product.approval_status = "approved"
    db.commit()

    return {"ok": True, "id": product_id, "message": "Product updated"}


@router.delete("/partner/products/{product_id}")
def partner_products_delete(product_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role != "partner":
        raise HTTPException(status_code=403, detail="Only partners can delete products")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=400, detail="Partner profile not linked to this account")

    product = (
        db.query(PartnerProduct)
        .filter(
            PartnerProduct.id == product_id,
            PartnerProduct.partner_id == partner.id,
            PartnerProduct.active.is_(True),
        )
        .first()
    )
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    product.active = False
    db.commit()

    mapping = _load_partner_product_units(db)
    if str(product_id) in mapping:
        mapping.pop(str(product_id), None)
        _save_partner_product_units(db, mapping)

    return {"ok": True, "id": product_id, "message": "Product deleted"}


@router.get("/partner/ledger")
def partner_ledger(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        return []
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        return []
    partner_product_ids = _partner_product_ids(db, partner.id)
    entries = []
    seen_references = set()
    balance = 0.0
    for order in db.query(PublicOrder).filter(PublicOrder.status == "paid").order_by(PublicOrder.created_at.desc()).limit(500).all():
        try:
            items = json.loads(order.items_json or "[]")
        except Exception:
            items = []
        sales = round(sum(
            max(0.0, float(item.get("subtotal") or 0))
            for item in items
            if str(item.get("product_id") or "") in partner_product_ids
        ), 2)
        if sales <= 0:
            continue
        reference_id = f"order:{order.id}"
        if reference_id in seen_references:
            continue
        seen_references.add(reference_id)
        commission = round(sales * max(0.0, min(100.0, float(partner.commission_percent or 0))) / 100.0, 2)
        balance = round(balance + commission, 2)
        created_at = order.created_at
        if created_at and created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        entries.append({
            "created_at": created_at.isoformat() if created_at else now_iso(),
            "period": created_at.astimezone(timezone.utc).strftime("%Y-%m") if created_at else datetime.now(timezone.utc).strftime("%Y-%m"),
            "ledger_id": f"ledger:{partner.id}:{order.id}",
            "reference_id": reference_id,
            "transaction_type": "SALE",
            "description": f"Partner sale {order.id}",
            "ref_order_id": order.id,
            "sales_amount": sales,
            "commission_percent": float(partner.commission_percent or 0),
            "commission_amount": commission,
            "credit": commission,
            "debit": 0.0,
            "balance": balance,
            "status": "paid",
            "timestamp": created_at.isoformat() if created_at else datetime.now(timezone.utc).isoformat(),
        })
    return entries


@router.get("/partner/reports")
def partner_reports(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")
    from .compat import _is_delivery_service_listing, _list_delivery_trips, _list_transport_trips, _load_property_enquiries
    meta_map = _load_partner_product_meta(db)
    product_ids = _partner_product_ids(db, partner.id)
    products = db.query(PartnerProduct).filter(PartnerProduct.partner_id == partner.id, PartnerProduct.active.is_(True)).all()
    paid_orders = db.query(PublicOrder).filter(PublicOrder.status == "paid").all()
    revenue = {pid: 0.0 for pid in product_ids}
    for order in paid_orders:
        try:
            items = json.loads(order.items_json or "[]")
        except Exception:
            items = []
        for item in items if isinstance(items, list) else []:
            pid = str(item.get("product_id") or "")
            if pid in revenue:
                revenue[pid] += float(item.get("subtotal") or 0)
    products_out, services_out, properties_out = [], [], []
    for product in products:
        meta = _partner_product_meta(meta_map, product.id)
        if not meta.get("is_service"):
            opening = int(meta.get("opening_stock") or product.stock or 0)
            current = max(0, int(product.stock or 0))
            products_out.append({"product": product.name, "sku": meta.get("sku"), "category": product.category, "purchase_cost": float(meta.get("purchase_cost") or 0), "price_before_gst": float(meta.get("price_before_gst") or product.price or 0), "gst_percent": float(meta.get("gst_percent") or 0), "gst_amount": round(float(meta.get("price_before_gst") or product.price or 0) * float(meta.get("gst_percent") or 0) / 100, 2), "final_price": round(float(meta.get("price_before_gst") or product.price or 0) * (1 + float(meta.get("gst_percent") or 0) / 100)), "opening_stock": opening, "current_stock": current, "sold": max(0, opening - current), "available": current, "stock_status": "OUT OF STOCK" if current == 0 else "LOW STOCK" if current <= 5 else "IN STOCK", "revenue": round(revenue.get(str(product.id), 0), 2)})
        elif str(meta.get("property_type") or "").strip():
            enquiries = _load_property_enquiries(db, str(partner.id))
            properties_out.append({"property": product.name, "property_type": meta.get("property_type"), "listing_type": meta.get("property_listing_type"), "area": meta.get("property_area"), "area_unit": meta.get("property_area_unit"), "location": meta.get("property_location") or meta.get("service_area"), "district": meta.get("district"), "city": meta.get("city"), "price": float(product.price or 0), "status": meta.get("property_status") or "AVAILABLE", "enquiries": sum(1 for item in enquiries if str(item.get("listing_id")) == str(product.id))})
        else:
            base = float(meta.get("price_before_gst") or product.price or 0)
            gst = float(meta.get("gst_percent") or 0)
            services_out.append({"service": product.name, "sector": meta.get("service_sector"), "category": product.category, "rate": base, "gst_percent": gst, "gst_amount": round(base * gst / 100, 2), "final_rate": round(base * (1 + gst / 100)), "service_area": meta.get("service_area"), "availability": meta.get("availability") or "available", "revenue": round(revenue.get(str(product.id), 0), 2)})
    transport_out = []
    for product in products:
        meta = _partner_product_meta(meta_map, product.id)
        if not meta.get("vehicle_type") or _is_delivery_service_listing(product, meta_map):
            continue
        trips = [item for item in _list_transport_trips(db, partner_id=str(partner.id), limit=1000) if str(item.get("service_product_id")) == str(product.id)]
        transport_out.append({"vehicle": product.name, "vehicle_number": meta.get("vehicle_number"), "vehicle_type": meta.get("vehicle_type"), "capacity": meta.get("seating_capacity"), "base_fare": meta.get("base_fare") or product.price, "per_km_rate": meta.get("per_km_rate"), "gst_percent": meta.get("gst_percent"), "gst_amount": round(float(meta.get("base_fare") or product.price or 0) * float(meta.get("gst_percent") or 0) / 100, 2), "final_fare": round(float(meta.get("base_fare") or product.price or 0) * (1 + float(meta.get("gst_percent") or 0) / 100)), "bookings": len(trips), "active_trips": sum(1 for item in trips if item.get("status") in {"booked", "confirmed", "on_trip"}), "completed_trips": sum(1 for item in trips if item.get("status") in {"completed", "paid"}), "cancelled_trips": sum(1 for item in trips if item.get("status") in {"rejected", "cancelled"}), "availability": meta.get("vehicle_status") or "AVAILABLE", "revenue": round(sum(float(item.get("fare_final") or item.get("fare_quote") or 0) for item in trips), 2)})
    courier_out = [{"booking_id": item.get("trip_code") or item.get("id"), "courier_service": item.get("service_name"), "pickup": item.get("pickup"), "delivery": item.get("destination"), "delivery_charge": float(item.get("fare_final") or item.get("fare_quote") or 0), "gst_percent": 0, "gst_amount": 0, "final_amount": float(item.get("fare_final") or item.get("fare_quote") or 0), "payment_status": item.get("payment_status"), "delivery_status": item.get("status"), "revenue": float(item.get("fare_final") or item.get("fare_quote") or 0)} for item in _list_delivery_trips(db, partner_id=str(partner.id), limit=1000)]
    return {"products": products_out, "services": services_out, "transport": transport_out, "courier": courier_out, "property": properties_out, "generated_at": datetime.now(timezone.utc).isoformat()}


def _is_service_order_item(item: dict | None) -> bool:
    row = item or {}
    if bool(row.get("is_service")):
        return True
    listing_type = str(row.get("listing_type") or "").strip().lower()
    item_kind = str(row.get("item_kind") or "").strip().lower()
    return listing_type == "service" or item_kind == "service"


def _partner_product_ids(db: Session, partner_id: str) -> set[str]:
    rows = db.query(PartnerProduct.id).filter(PartnerProduct.partner_id == partner_id).all()
    return {str(row[0]) for row in rows if row and row[0]}


def _partner_wallet_balance(db: Session, partner_id: str) -> float:
    key = f"partner_wallet:{partner_id}"
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row:
        return 0.0
    try:
        payload = json.loads(row.value_json or "{}")
    except Exception:
        payload = {}
    return round(float((payload or {}).get("balance") or 0), 2)


def _apply_partner_service_final_amount(items: list[dict], own_service_indexes: list[int], final_amount: float) -> list[dict]:
    next_items = [dict(it or {}) for it in (items or [])]
    current_total = round(sum(float(next_items[idx].get("subtotal") or 0) for idx in own_service_indexes), 2)

    allocations: list[float] = []
    if current_total <= 0:
        per_line = round(final_amount / max(1, len(own_service_indexes)), 2)
        allocations = [per_line for _ in own_service_indexes]
    else:
        for idx in own_service_indexes:
            line = round(float(next_items[idx].get("subtotal") or 0), 2)
            allocations.append(round((line / current_total) * final_amount, 2))

    drift = round(final_amount - sum(allocations), 2)
    if allocations:
        allocations[-1] = round(allocations[-1] + drift, 2)

    for pos, idx in enumerate(own_service_indexes):
        item = dict(next_items[idx] or {})
        line_total = round(max(0.0, allocations[pos]), 2)
        qty = float(item.get("quantity") or 1)
        if qty <= 0:
            qty = 1.0
        unit_price = round(line_total / qty, 2)
        item["price"] = unit_price
        item["unit_base_price"] = unit_price
        item["mrp"] = unit_price
        item["pre_tax"] = line_total
        item["subtotal"] = line_total
        next_items[idx] = item

    return next_items


@router.get("/partner/orders")
def partner_orders(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role != "partner":
        return []

    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        return []

    partner_product_ids = _partner_product_ids(db, partner.id)
    if not partner_product_ids:
        return []

    partner_rate = max(0.0, min(100.0, float(partner.commission_percent or 0)))
    wallet_balance = _partner_wallet_balance(db, partner.id)
    try:
        from .compat import admin_approve_order
    except Exception:
        admin_approve_order = None

    rows = db.query(PublicOrder).order_by(PublicOrder.created_at.desc()).limit(500).all()

    out = []
    for row in rows:
        try:
            items = json.loads(row.items_json or "[]")
        except Exception:
            items = []

        my_items = []
        my_sales = 0.0
        has_metho_item = False
        has_foreign_partner_item = False
        my_service_items = 0
        for item in items:
            product_type = str(item.get("product_type") or "").strip().lower()
            if product_type == "metho":
                has_metho_item = True
            product_id = str(item.get("product_id") or "").strip()
            if product_type == "associate_partner" and product_id and product_id not in partner_product_ids:
                has_foreign_partner_item = True
            if product_id not in partner_product_ids:
                continue
            line_subtotal = round(float(item.get("subtotal") or 0), 2)
            my_sales += line_subtotal
            is_service_item = _is_service_order_item(item)
            if is_service_item:
                my_service_items += 1
            my_items.append(
                {
                    "product_id": product_id,
                    "product_name": str(item.get("name") or "Product").strip() or "Product",
                    "quantity": float(item.get("quantity") or 1),
                    "subtotal": line_subtotal,
                    "listing_type": str(item.get("listing_type") or "").strip().lower(),
                    "item_kind": str(item.get("item_kind") or "").strip().lower(),
                    "is_service": is_service_item,
                }
            )

        if not my_items:
            continue

        my_sales = round(my_sales, 2)
        my_commission = round(my_sales * (partner_rate / 100.0), 2)
        status = str(row.status or "pending_approval")
        status_norm = status.strip().lower()
        delivery_name = str(row.payer_name or "Customer").strip() or "Customer"
        delivery_address = str(row.shipping_address or "").strip()

        customer_phone_digits = _load_order_contact_phone(db, row.id)
        if not customer_phone_digits and str(row.customer_user_id or "").strip():
            customer_user = db.query(User).filter(User.id == str(row.customer_user_id or "").strip()).first()
            customer_phone_digits = "".join(ch for ch in str(getattr(customer_user, "phone", "") or "") if ch.isdigit())
        # For transport bookings made before the phone-save fix, fall back to the trip's customer_phone.
        if not customer_phone_digits and str(row.shipping_address or "").startswith("Transport Trip:"):
            trip_rows = db.query(AppSetting).filter(AppSetting.key.like("transport_trip:%")).all()
            for t_row in trip_rows:
                try:
                    t_data = json.loads(t_row.value_json or "{}")
                except Exception:
                    continue
                if str(t_data.get("order_id") or "") == str(row.id):
                    customer_phone_digits = "".join(ch for ch in str(t_data.get("customer_phone") or "") if ch.isdigit())
                    break

        raw_payment_method = str(row.payment_method or "").strip().lower()
        normalized_payment_method = raw_payment_method
        if raw_payment_method in {"cash", "cod"}:
            normalized_payment_method = "cod"
        elif raw_payment_method in {"manual_upi", "upi"}:
            normalized_payment_method = "upi"
        elif raw_payment_method in {"online"}:
            normalized_payment_method = "online"
        elif raw_payment_method in {"razorpay"}:
            normalized_payment_method = "razorpay"
        elif not raw_payment_method and str(row.txn_id or "").strip().upper() == "COD":
            # Backward compatibility for legacy COD rows where payment_method was empty.
            normalized_payment_method = "cod"

        customer_whatsapp_invoice_url = ""
        if customer_phone_digits:
            invoice_link = f"https://methoaayupay.com/invoice/{row.id}"
            msg = (
                f"Invoice ready for Order ORD-{row.id[:8].upper()}\\n"
                f"Customer: {delivery_name}\\n"
                f"Amount: ₹{float(row.total_amount or 0):.2f}\\n"
                f"Open invoice: {invoice_link}"
            )
            customer_whatsapp_invoice_url = f"https://wa.me/{customer_phone_digits}?text={quote(msg)}"

        if (
            admin_approve_order
            and status_norm == "pending_approval"
            and not has_metho_item
            and not has_foreign_partner_item
            and (wallet_balance + 1e-9) >= my_commission
        ):
            try:
                admin_approve_order(
                    order_id=row.id,
                    payload={"note": "Auto-approved from partner dashboard reserve balance"},
                    db=db,
                    current_user=SimpleNamespace(role="super_admin"),
                )
                wallet_balance = round(wallet_balance - my_commission, 2)
                status = "paid"
                status_norm = "paid"
            except HTTPException:
                pass

        blocked_by_wallet_reserve = status_norm == "pending_approval" and (wallet_balance + 1e-9) < my_commission
        invoice_locked_reason = ""
        if status_norm == "pending_approval":
            if blocked_by_wallet_reserve:
                invoice_locked_reason = (
                    f"Reserve wallet কম আছে। Required ₹{my_commission:.2f}, available ₹{wallet_balance:.2f}. "
                    "Top-up করলে admin approve হবে এবং invoice unlock হবে।"
                )
            else:
                invoice_locked_reason = "Admin approval pending. Approve হলে invoice unlock হবে।"
        all_my_items_service = my_service_items > 0 and my_service_items == len(my_items)
        invoice_available = status_norm in {"paid", "approved"} or (
            status_norm == "pending_approval"
            and not has_metho_item
            and not has_foreign_partner_item
            and (wallet_balance + 1e-9) >= my_commission
        )
        out.append(
            {
                "id": row.id,
                "order_no": f"ORD-{row.id[:8].upper()}",
                "status": status,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                # Partner view stays restricted to delivery-relevant details only.
                "restricted_order_view": True,
                "delivery_name": delivery_name,
                "delivery_address": delivery_address,
                "delivery_phone": customer_phone_digits,
                "customer_whatsapp_invoice_url": customer_whatsapp_invoice_url,
                "payment_method": normalized_payment_method,
                "my_sales": my_sales,
                "my_commission": my_commission,
                "my_items": my_items,
                "invoice_available": invoice_available,
                "can_service_rate_edit": False,
                "service_rate_locked": False,
                "wallet_balance_snapshot": 0,
                "wallet_balance_available": round(wallet_balance, 2),
                "commission_reserve_required": my_commission,
                "blocked_by_wallet_reserve": blocked_by_wallet_reserve,
                "can_partner_auto_approve": not has_metho_item and not has_foreign_partner_item,
                "wallet_shortfall": round(max(0.0, my_commission - wallet_balance), 2) if blocked_by_wallet_reserve else 0.0,
                "invoice_locked_reason": invoice_locked_reason or ("Invoice ready for customer WhatsApp." if invoice_available else "Invoice access partner view-এ disabled আছে।"),
            }
        )

    return out


@router.post("/partner/orders/{order_id}/service-final-fare")
def partner_set_service_final_fare(order_id: str, payload: dict | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")

    row = db.query(PublicOrder).filter(PublicOrder.id == order_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")
    if str(row.status or "") != "pending_approval":
        raise HTTPException(status_code=400, detail="Final fare can be edited only before confirmation")

    partner_product_ids = _partner_product_ids(db, partner.id)
    if not partner_product_ids:
        raise HTTPException(status_code=400, detail="No partner products linked")

    try:
        items = json.loads(row.items_json or "[]")
    except Exception:
        items = []
    if not isinstance(items, list) or not items:
        raise HTTPException(status_code=400, detail="Order items missing")

    own_service_indexes: list[int] = []
    for idx, item in enumerate(items):
        product_id = str((item or {}).get("product_id") or "").strip()
        product_type = str((item or {}).get("product_type") or "").strip().lower()
        if product_type == "metho":
            raise HTTPException(status_code=403, detail="METHO orders are admin-only")
        if product_type == "associate_partner" and product_id and product_id not in partner_product_ids:
            raise HTTPException(status_code=403, detail="Mixed partner order cannot be edited")
        if product_id in partner_product_ids and _is_service_order_item(item):
            own_service_indexes.append(idx)

    if not own_service_indexes:
        raise HTTPException(status_code=400, detail="No editable service booking found for this partner")

    try:
        final_amount = round(float((payload or {}).get("final_amount") or 0), 2)
    except Exception:
        final_amount = 0.0
    if final_amount <= 0:
        raise HTTPException(status_code=400, detail="Valid final_amount is required")

    next_items = _apply_partner_service_final_amount(items, own_service_indexes, final_amount)
    row.items_json = json.dumps(next_items)
    row.total_amount = round(sum(float((it or {}).get("subtotal") or 0) for it in next_items), 2)
    db.commit()

    return {
        "ok": True,
        "order_id": row.id,
        "order_no": f"ORD-{row.id[:8].upper()}",
        "status": str(row.status or "pending_approval"),
        "final_amount": final_amount,
        "total_amount": float(row.total_amount or 0),
        "message": "Final fare updated. Confirm booking to lock fare and apply commission.",
    }


@router.post("/partner/orders/{order_id}/service-confirm")
def partner_confirm_service_booking(order_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")

    row = db.query(PublicOrder).filter(PublicOrder.id == order_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")
    if str(row.status or "") != "pending_approval":
        raise HTTPException(status_code=400, detail="Booking can be confirmed only once before approval")

    partner_product_ids = _partner_product_ids(db, partner.id)
    if not partner_product_ids:
        raise HTTPException(status_code=400, detail="No partner products linked")

    try:
        items = json.loads(row.items_json or "[]")
    except Exception:
        items = []
    if not isinstance(items, list) or not items:
        raise HTTPException(status_code=400, detail="Order items missing")

    own_service_items = 0
    for item in items:
        product_id = str((item or {}).get("product_id") or "").strip()
        product_type = str((item or {}).get("product_type") or "").strip().lower()
        if product_type == "metho":
            raise HTTPException(status_code=403, detail="METHO orders are admin-only")
        if product_type == "associate_partner" and product_id and product_id not in partner_product_ids:
            raise HTTPException(status_code=403, detail="Mixed partner order cannot be confirmed")
        if product_id in partner_product_ids and _is_service_order_item(item):
            own_service_items += 1

    if own_service_items <= 0:
        raise HTTPException(status_code=400, detail="No partner service booking found to confirm")

    from .compat import admin_approve_order

    approved = admin_approve_order(
        order_id=order_id,
        payload={"note": "Partner confirmed service booking with locked fare"},
        db=db,
        current_user=SimpleNamespace(role="super_admin"),
    )

    return {
        "ok": True,
        "order_id": order_id,
        "order_no": f"ORD-{order_id[:8].upper()}",
        "status": "paid",
        "auto_approved": True,
        "rewards_earned": approved.get("rewards_earned", {}),
        "commission_split": approved.get("commission_split", {}),
        "message": "Booking confirmed. Fare locked and commission debited from reserve wallet.",
    }
