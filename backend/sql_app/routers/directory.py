import json
from urllib import parse as urlparse
from urllib import request as urlrequest

from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from fastapi import APIRouter, Depends, HTTPException

from ..database import get_db
from ..models import AppSetting, AssociatePartner, PartnerProduct
from ..storage import UPLOADED_OBJECTS_DIR


def _search_tokens(value: str | None) -> list[str]:
    return [token for token in str(value or "").lower().replace(",", " ").split() if token]


def _featured_url_alive(url: str) -> bool:
    """data URLs always alive; file paths alive only if file exists on disk."""
    raw = str(url or "").strip()
    if not raw:
        return False
    if raw.startswith("data:"):
        return True
    for prefix in ("/api/files/", "/api/public-files/"):
        if raw.startswith(prefix):
            return (UPLOADED_OBJECTS_DIR / raw[len(prefix):]).exists()
    return True


def _lookup_pincode_geo(pin: str, city: str, state: str) -> tuple[float | None, float | None]:
    # Best-effort geocode for admin nearby filtering. Failures should not break pincode lookup.
    query = ", ".join([part for part in [pin, city, state, "India"] if str(part or "").strip()])
    if not query:
        return (None, None)
    endpoint = f"https://nominatim.openstreetmap.org/search?format=json&limit=1&q={urlparse.quote(query)}"
    req = urlrequest.Request(endpoint, headers={"User-Agent": "metho-directory/1.0"})
    try:
        with urlrequest.urlopen(req, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception:
        return (None, None)
    if not isinstance(payload, list) or not payload:
        return (None, None)
    top = payload[0] if isinstance(payload[0], dict) else {}
    try:
        lat = float(top.get("lat"))
        lng = float(top.get("lon"))
        return (lat, lng)
    except Exception:
        return (None, None)

router = APIRouter(prefix="/api", tags=["directory"])
PARTNER_PRODUCT_UNITS_KEY = "partner_product_units"
PARTNER_PRODUCT_META_KEY = "partner_product_meta"
SHOP_SECTOR_KEYWORDS = {
    "vegetables": ["vegetable", "vegetables", "veg", "sabji"],
    "grocery": ["grocery", "groceries", "kirana", "rice", "dal", "atta", "masala", "oil"],
    "cosmetics-beauty": ["cosmetic", "cosmetics", "beauty", "makeup", "skincare", "personal care"],
    "others": ["electronics", "hardware", "stationery", "household", "fashion", "general"],
}
DELIVERY_RATE_HINTS = {
    "delivery",
    "courier",
    "logistics",
    "cargo",
    "parcel",
    "shipment",
    "dispatch",
    "freight",
    "goods carrier",
    "pickup",
    "drop",
    "delivery partner",
    "courier_pickup",
    "cargo_transport",
}


def _load_partner_product_units(db: Session) -> dict[str, dict]:
    row = db.query(AppSetting).filter(AppSetting.key == PARTNER_PRODUCT_UNITS_KEY).first()
    if not row:
        return {}
    try:
        payload = json.loads(row.value_json or "{}")
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _unit_info_for_product(unit_map: dict[str, dict], product_id: str) -> dict:
    meta = unit_map.get(str(product_id)) if isinstance(unit_map, dict) else None
    unit_type = str((meta or {}).get("unit_type") or "piece").strip().lower() or "piece"
    if unit_type not in {"piece", "kg", "gram", "litre", "ml"}:
        unit_type = "piece"
    default_step = 1.0 if unit_type == "piece" else 0.1 if unit_type in {"kg", "litre"} else 100.0
    try:
        step = float((meta or {}).get("quantity_step") or 0)
    except Exception:
        step = 0.0
    if step <= 0:
        step = default_step
    elif unit_type in {"kg", "litre"} and abs(step - 0.25) < 0.0001:
        step = default_step
    elif unit_type in {"gram", "ml"} and abs(step - 50.0) < 0.0001:
        step = default_step
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


def _load_partner_classification_meta(db: Session, prefix: str = "partner") -> dict[str, dict]:
    rows = db.query(AppSetting).filter(AppSetting.key.like(f"partner_classification:{prefix}:%")).all()
    result = {}
    for row in rows:
        partner_id = str(row.key or "").rsplit(":", 1)[-1]
        try:
            value = json.loads(row.value_json or "{}")
        except Exception:
            value = {}
        result[partner_id] = value if isinstance(value, dict) else {}
    return result


def _service_meta_for_product(meta_map: dict[str, dict], product_id: str) -> dict:
    meta = meta_map.get(str(product_id)) if isinstance(meta_map, dict) else None
    listing_type = str((meta or {}).get("listing_type") or "product").strip().lower()
    if listing_type not in {"product", "service"}:
        listing_type = "product"
    is_service = bool((meta or {}).get("is_service") or listing_type == "service")
    mode = str((meta or {}).get("service_invoice_mode") or "detailed").strip().lower()
    if mode not in {"detailed", "summary_total"}:
        mode = "detailed"
    pdf_url = str((meta or {}).get("pdf_url") or (meta or {}).get("product_pdf_url") or "").strip()
    youtube_url = str((meta or {}).get("youtube_url") or "").strip()
    price_before_gst = max(0.0, float((meta or {}).get("price_before_gst") or 0))
    gst_percent = max(0.0, float((meta or {}).get("gst_percent") or 0))
    gst_amount = round(price_before_gst * gst_percent / 100.0, 2)
    final_customer_rate = round(price_before_gst + gst_amount)
    availability = str((meta or {}).get("availability") or ("available" if is_service else "")).strip().lower()
    if availability not in {"available", "unavailable", "temporarily_closed"}:
        availability = "available" if is_service else ""
    return {
        "listing_type": "service" if is_service else "product",
        "item_kind": "service" if is_service else "product",
        "is_service": is_service,
        "service_booking_enabled": bool((meta or {}).get("service_booking_enabled") if (meta or {}).get("service_booking_enabled") is not None else is_service),
        "service_invoice_mode": mode,
        "service_template_key": str((meta or {}).get("service_template_key") or "").strip(),
        "pdf_url": pdf_url,
        "product_pdf_url": pdf_url,
        "youtube_url": youtube_url,
        "inventory_type": "SERVICE" if is_service else "PRODUCT",
        "price_before_gst": price_before_gst,
        "gst_percent": gst_percent,
        "gst_amount": gst_amount,
        "final_customer_rate": final_customer_rate,
        "pricing_unit": str((meta or {}).get("pricing_unit") or ("PER_VISIT" if is_service else "PER_ITEM")).strip().upper(),
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
        "vehicle_id": str((meta or {}).get("vehicle_id") or product_id).strip(),
        "vehicle_type": str((meta or {}).get("vehicle_type") or "").strip(),
        "vehicle_number": str((meta or {}).get("vehicle_number") or "").strip().upper(),
        "vehicle_category": str((meta or {}).get("vehicle_category") or "").strip(),
        "seating_capacity": max(0, int((meta or {}).get("seating_capacity") or 0)),
        "vehicle_status": str((meta or {}).get("vehicle_status") or ("AVAILABLE" if is_service else "")).strip().upper(),
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


def _partner_banner_and_featured(db: Session, partner_id: str) -> tuple[str, list[str]]:
    banner_url = ""
    featured_items = ["", "", "", "", ""]

    banner_row = db.query(AppSetting).filter(AppSetting.key == f"partner_banner:{partner_id}").first()
    if banner_row and banner_row.value_json:
        try:
            banner_payload = json.loads(banner_row.value_json or "{}")
            banner_url = str(banner_payload.get("banner_url") or "").strip()
        except Exception:
            banner_url = ""

    featured_row = db.query(AppSetting).filter(AppSetting.key == f"partner_featured_images:{partner_id}").first()
    if featured_row and featured_row.value_json:
        try:
            featured_payload = json.loads(featured_row.value_json or "{}")
            raw_items = featured_payload.get("items") if isinstance(featured_payload, dict) else []
            if isinstance(raw_items, list):
                for idx in range(min(5, len(raw_items))):
                    featured_items[idx] = str(raw_items[idx] or "").strip()
        except Exception:
            featured_items = ["", "", "", "", ""]

    # Drop paths whose files no longer exist on disk (ephemeral storage wipe).
    featured_items = [item if _featured_url_alive(item) else "" for item in featured_items]

    return banner_url, featured_items


def _partner_business_youtube_url(db: Session, partner_id: str) -> str:
    row = db.query(AppSetting).filter(AppSetting.key == f"partner_business_youtube:{partner_id}").first()
    if not row:
        return ""
    try:
        payload = json.loads(row.value_json or "{}")
    except Exception:
        payload = {}
    return str(payload.get("youtube_url") or "").strip()


def _partner_business_facebook_url(db: Session, partner_id: str) -> str:
    row = db.query(AppSetting).filter(AppSetting.key == f"partner_business_facebook:{partner_id}").first()
    if not row:
        return ""
    try:
        payload = json.loads(row.value_json or "{}")
    except Exception:
        payload = {}
    return str(payload.get("facebook_url") or "").strip()


def _partner_to_dict(p: AssociatePartner, classification: dict | None = None):
    classification = classification if isinstance(classification, dict) else {}
    return {
        "id": p.id,
        "partner_code": p.partner_code,
        "business_name": p.business_name,
        "business_type": p.business_type,
        "city": p.city,
        "state": p.state,
        "address": p.address,
        "pincode": p.pincode,
        "phone": p.phone,
        "whatsapp_no": p.whatsapp_no,
        "contact_person": p.contact_person,
        "logo_url": p.logo_url,
        "is_featured": p.is_featured,
        "active": p.active,
        "service_sector": str(classification.get("service_sector") or ""),
        "service_category": str(classification.get("service_category") or ""),
        "shop_sector": str(classification.get("shop_sector") or ""),
        "shop_category": str(classification.get("shop_category") or ""),
        "district": str(classification.get("district") or ""),
    }


def _is_delivery_service_product(product: PartnerProduct, meta_map: dict[str, dict]) -> bool:
    meta = _service_meta_for_product(meta_map, str(getattr(product, "id", "") or ""))
    if not meta.get("is_service"):
        return False
    haystack = " ".join(
        [
            str(getattr(product, "name", "") or ""),
            str(getattr(product, "category", "") or ""),
            str(getattr(product, "description", "") or ""),
            str(meta.get("service_template_key") or ""),
        ]
    ).lower()
    return any(hint in haystack for hint in DELIVERY_RATE_HINTS)


def _is_delivery_focus_query(business_type: str | None, q: str | None) -> bool:
    type_tokens = _search_tokens(business_type)
    q_tokens = _search_tokens(q)
    type_joined = " ".join(type_tokens)
    q_joined = " ".join(q_tokens)
    looks_service = "service" in type_joined
    looks_delivery = any(hint in q_joined for hint in DELIVERY_RATE_HINTS)
    return looks_service and looks_delivery


@router.get("/directory/partners")
def partner_directory(
    city: str | None = None,
    pincode: str | None = None,
    business_type: str | None = None,
    category: str | None = None,
    service_sector: str | None = None,
    shop_sector: str | None = None,
    district: str | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(AssociatePartner).filter(AssociatePartner.active.is_(True))

    if city:
        query = query.filter(func.lower(AssociatePartner.city) == city.lower())
    if pincode:
        query = query.filter(AssociatePartner.pincode == str(pincode).strip())
    if business_type:
        type_tokens = _search_tokens(business_type)
        for token in type_tokens:
            like_type = f"%{token}%"
            query = query.filter(AssociatePartner.business_type.ilike(like_type))
    rows = query.order_by(AssociatePartner.is_featured.desc(), AssociatePartner.business_name.asc()).all()
    classification_map = _load_partner_classification_meta(db)
    product_meta = _load_partner_product_meta(db)
    products_by_partner = {}
    for product in db.query(PartnerProduct).filter(PartnerProduct.active.is_(True)).all():
        products_by_partner.setdefault(str(product.partner_id), []).append(product)

    requested_category = str(category or "").strip().lower()
    requested_service_sector = str(service_sector or "").strip().lower()
    requested_shop_sector = str(shop_sector or "").strip().lower()
    requested_district = str(district or "").strip().lower()
    tokens = _search_tokens(q)
    ranked = []
    for partner in rows:
        classification = classification_map.get(str(partner.id), {})
        product_rows = products_by_partner.get(str(partner.id), [])
        product_text = " ".join(
            " ".join([
                str(item.name or ""), str(item.category or ""), str(item.description or ""),
                str(_service_meta_for_product(product_meta, item.id).get("service_template_key") or ""),
                str(_service_meta_for_product(product_meta, item.id).get("service_sector") or ""),
                str(_service_meta_for_product(product_meta, item.id).get("service_category") or ""),
                str(_service_meta_for_product(product_meta, item.id).get("service_type") or ""),
                str(_service_meta_for_product(product_meta, item.id).get("service_area") or ""),
                str(_service_meta_for_product(product_meta, item.id).get("district") or ""),
            ]) for item in product_rows
        ).lower()
        partner_text = " ".join([
            str(partner.business_name or ""), str(partner.contact_person or ""), str(partner.business_type or ""),
            str(partner.city or ""), str(partner.state or ""), str(partner.address or ""), str(partner.pincode or ""),
            str(partner.partner_code or ""), json.dumps(classification), product_text,
        ]).lower()
        service_sector_value = str(classification.get("service_sector") or "").strip().lower()
        shop_sector_value = str(classification.get("shop_sector") or "").strip().lower()
        category_text = " ".join([
            str(classification.get("service_category") or ""), str(classification.get("shop_category") or ""), product_text,
        ]).lower()
        if requested_district and requested_district not in str(classification.get("district") or "").lower():
            continue
        if requested_service_sector and requested_service_sector not in service_sector_value and requested_service_sector not in partner_text:
            continue
        if requested_shop_sector:
            shop_keywords = SHOP_SECTOR_KEYWORDS.get(requested_shop_sector, [requested_shop_sector])
            if not any(keyword in (shop_sector_value + " " + category_text + " " + partner_text) for keyword in shop_keywords):
                continue
        if requested_category and requested_category not in category_text:
            continue
        if tokens and not all(token in partner_text for token in tokens):
            continue
        score = 0
        exact_sector = requested_service_sector or requested_shop_sector
        if exact_sector and exact_sector in (service_sector_value + " " + shop_sector_value): score += 100
        if requested_category and requested_category in category_text: score += 75
        for token in tokens:
            if token in service_sector_value or token in shop_sector_value: score += 50
            elif token in category_text: score += 35
            elif token in str(partner.business_name or "").lower(): score += 25
            else: score += 10
        if city and str(partner.city or "").lower() == city.lower(): score += 20
        if district and district.lower() == str(classification.get("district") or "").lower(): score += 20
        if pincode and str(partner.pincode or "").strip() == str(pincode).strip(): score += 20
        ranked.append((score, bool(partner.is_featured), str(partner.business_name or "").lower(), partner, classification))

    ranked.sort(key=lambda item: (-item[0], not item[1], item[2]))
    payload = [_partner_to_dict(item[3], item[4]) for item in ranked]
    rows = [item[3] for item in ranked]

    if not rows or not _is_delivery_focus_query(business_type, q):
        return payload

    partner_ids = [str(p.id) for p in rows if str(getattr(p, "id", "") or "").strip()]
    if not partner_ids:
        return payload

    meta_map = _load_partner_product_meta(db)
    products = (
        db.query(PartnerProduct)
        .filter(
            PartnerProduct.active.is_(True),
            PartnerProduct.partner_id.in_(partner_ids),
        )
        .all()
    )

    delivery_prices_by_partner: dict[str, list[float]] = {}
    delivery_count_by_partner: dict[str, int] = {}
    for product in products:
        pid = str(getattr(product, "partner_id", "") or "")
        if not pid:
            continue
        if not _is_delivery_service_product(product, meta_map):
            continue
        delivery_count_by_partner[pid] = int(delivery_count_by_partner.get(pid, 0)) + 1
        try:
            price_value = float(getattr(product, "price", 0) or 0)
        except Exception:
            price_value = 0
        if price_value > 0:
            delivery_prices_by_partner.setdefault(pid, []).append(round(price_value, 2))

    for partner_payload in payload:
        pid = str(partner_payload.get("id") or "")
        prices = delivery_prices_by_partner.get(pid, [])
        service_count = int(delivery_count_by_partner.get(pid, 0))
        if prices:
            min_rate = round(min(prices), 2)
            max_rate = round(max(prices), 2)
            avg_rate = round(sum(prices) / len(prices), 2)
        else:
            min_rate = None
            max_rate = None
            avg_rate = None

        partner_payload["delivery_service_count"] = service_count
        partner_payload["delivery_min_rate"] = min_rate
        partner_payload["delivery_max_rate"] = max_rate
        partner_payload["delivery_avg_rate"] = avg_rate
        partner_payload["delivery_has_services"] = service_count > 0
        partner_payload["delivery_rate_currency"] = "INR"

    return payload


@router.get("/directory/featured-partners")
def featured_partners(db: Session = Depends(get_db)):
    rows = (
        db.query(AssociatePartner)
        .filter(AssociatePartner.active.is_(True), AssociatePartner.is_featured.is_(True))
        .order_by(AssociatePartner.business_name.asc())
        .limit(3)
        .all()
    )
    return [_partner_to_dict(p) for p in rows]


@router.get("/directory/categories")
def list_directory_categories(db: Session = Depends(get_db)):
    rows = (
        db.query(PartnerProduct.category)
        .filter(PartnerProduct.active.is_(True))
        .distinct()
        .all()
    )
    return sorted([r[0] for r in rows if r and r[0]])


@router.get("/directory/cities")
def list_cities(db: Session = Depends(get_db)):
    rows = (
        db.query(AssociatePartner.city)
        .filter(AssociatePartner.active.is_(True), AssociatePartner.city != "")
        .distinct()
        .all()
    )
    return sorted([r[0] for r in rows if r and r[0]])


@router.get("/directory/pincode-lookup")
def pincode_lookup(pincode: str):
    pin = "".join(ch for ch in str(pincode or "") if ch.isdigit())
    if len(pin) != 6:
        raise HTTPException(status_code=400, detail="pincode must be 6 digits")

    endpoint = f"https://api.postalpincode.in/pincode/{urlparse.quote(pin)}"
    try:
        with urlrequest.urlopen(endpoint, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=502, detail="Could not reach pincode service")

    if not isinstance(payload, list) or not payload:
        raise HTTPException(status_code=404, detail="Pincode not found")

    first = payload[0] if isinstance(payload[0], dict) else {}
    status = str(first.get("Status") or "").strip().lower()
    offices = first.get("PostOffice") if isinstance(first.get("PostOffice"), list) else []
    if status != "success" or not offices:
        raise HTTPException(status_code=404, detail="Pincode not found")

    city_options = []
    state = ""
    for office in offices:
        if not isinstance(office, dict):
            continue
        district = str(office.get("District") or office.get("Division") or "").strip()
        if district and district not in city_options:
            city_options.append(district)
        if not state:
            state = str(office.get("State") or "").strip()

    if not city_options:
        raise HTTPException(status_code=404, detail="City not found for this pincode")

    latitude, longitude = _lookup_pincode_geo(pin, city_options[0], state)

    return {
        "pincode": pin,
        "city": city_options[0],
        "city_options": city_options,
        "state": state,
        "latitude": latitude,
        "longitude": longitude,
    }


@router.get("/directory/partner/{partner_code}")
def partner_public_page(partner_code: str, db: Session = Depends(get_db)):
    partner = (
        db.query(AssociatePartner)
        .filter(AssociatePartner.partner_code == partner_code, AssociatePartner.active.is_(True))
        .first()
    )
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")

    banner_url, featured_items = _partner_banner_and_featured(db, partner.id)

    products = (
        db.query(PartnerProduct)
        .filter(
            PartnerProduct.partner_id == partner.id,
            PartnerProduct.active.is_(True),
            PartnerProduct.approval_status == "approved",
        )
        .order_by(PartnerProduct.created_at.desc())
        .all()
    )
    unit_map = _load_partner_product_units(db)
    meta_map = _load_partner_product_meta(db)
    products = [
        product for product in products
        if str(_service_meta_for_product(meta_map, product.id).get("property_status") or "AVAILABLE").upper()
        not in {"SOLD", "UNAVAILABLE", "INACTIVE"}
    ]

    partner_doc = _partner_to_dict(partner, _load_partner_classification_meta(db).get(str(partner.id), {}))
    partner_doc["banner_url"] = banner_url
    partner_doc["business_youtube_url"] = _partner_business_youtube_url(db, partner.id)
    partner_doc["business_facebook_url"] = _partner_business_facebook_url(db, partner.id)

    return {
        "partner": partner_doc,
        "featured_images": {"items": featured_items},
        "products": [
            {
                "id": p.id,
                "name": p.name,
                "category": p.category,
                "description": p.description,
                "image_url": p.image_url,
                "price": p.price,
                "stock": p.stock,
                "product_type": "associate_partner",
                "partner_id": p.partner_id,
                **_unit_info_for_product(unit_map, p.id),
                **_service_meta_for_product(meta_map, p.id),
            }
            for p in products
        ],
    }
