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


def _partner_to_dict(p: AssociatePartner):
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
        "commission_percent": p.commission_percent,
        "total_sales": p.total_sales,
        "is_featured": p.is_featured,
        "active": p.active,
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
    shop_sector: str | None = None,
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
    if q:
        tokens = _search_tokens(q)
        search_fields = [
            AssociatePartner.business_name,
            AssociatePartner.contact_person,
            AssociatePartner.business_type,
            AssociatePartner.city,
            AssociatePartner.state,
            AssociatePartner.address,
            AssociatePartner.pincode,
            AssociatePartner.partner_code,
        ]
        for token in tokens:
            like_q = f"%{token}%"
            query = query.filter(or_(*[field.ilike(like_q) for field in search_fields]))
    if category:
        category_tokens = _search_tokens(category)
        category_filters = [PartnerProduct.active.is_(True)]
        for token in category_tokens:
            like_category = f"%{token}%"
            category_filters.append(PartnerProduct.category.ilike(like_category))
        partner_ids = [
            row[0]
            for row in db.query(PartnerProduct.partner_id)
            .filter(*category_filters)
            .distinct()
            .all()
        ]
        if partner_ids:
            query = query.filter(AssociatePartner.id.in_(partner_ids))
        else:
            return []

    normalized_shop_sector = str(shop_sector or "").strip().lower()
    if normalized_shop_sector:
        keywords = SHOP_SECTOR_KEYWORDS.get(normalized_shop_sector, [])
        if keywords:
            keyword_filters = []
            for kw in keywords:
                like_kw = f"%{kw}%"
                keyword_filters.extend([
                    PartnerProduct.name.ilike(like_kw),
                    PartnerProduct.category.ilike(like_kw),
                    PartnerProduct.description.ilike(like_kw),
                ])
            partner_ids = [
                row[0]
                for row in db.query(PartnerProduct.partner_id)
                .filter(PartnerProduct.active.is_(True), or_(*keyword_filters))
                .distinct()
                .all()
            ]
            if partner_ids:
                query = query.filter(AssociatePartner.id.in_(partner_ids))
            else:
                return []

    rows = query.order_by(AssociatePartner.is_featured.desc(), AssociatePartner.business_name.asc()).all()
    payload = [_partner_to_dict(p) for p in rows]

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

    partner_doc = _partner_to_dict(partner)
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
