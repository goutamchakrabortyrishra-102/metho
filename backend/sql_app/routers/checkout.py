import json
import uuid
import base64
import hashlib
import hmac
import mimetypes
from types import SimpleNamespace
import urllib.error
import urllib.request
from pathlib import Path
import os
from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AppSetting, AssociatePartner, PartnerProduct, Product, ProductMeta, PublicOrder
from ..security import decode_token
from ..storage import UPLOADED_OBJECTS_DIR
from .auth import get_current_user
from .settings import load_settings

router = APIRouter(prefix="/api", tags=["checkout"])

UPLOAD_DIR = UPLOADED_OBJECTS_DIR / "payment_screenshots"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
PARTNER_PRODUCT_UNITS_KEY = "partner_product_units"
PARTNER_PRODUCT_META_KEY = "partner_product_meta"
PARTNER_UNIT_OPTIONS = {"piece", "kg", "gram", "litre", "ml"}


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
        return 0.25
    if unit in {"gram", "ml"}:
        return 50.0
    return 1.0


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
    step = float((meta or {}).get("quantity_step") or _partner_unit_step(unit_type))
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
    return {
        "listing_type": "service" if is_service else "product",
        "item_kind": "service" if is_service else "product",
        "is_service": is_service,
        "service_booking_enabled": bool((meta or {}).get("service_booking_enabled") if (meta or {}).get("service_booking_enabled") is not None else is_service),
        "service_invoice_mode": service_invoice_mode,
        "service_template_key": str((meta or {}).get("service_template_key") or "").strip(),
    }


def _set_partner_product_meta(db: Session, product_id: str, payload: dict | None) -> dict[str, dict]:
    mapping = _load_partner_product_meta(db)
    src = payload or {}
    listing_hint = str(src.get("listing_type") or src.get("item_kind") or "").strip().lower()
    is_service = bool(src.get("is_service") or src.get("service_booking_enabled") or listing_hint == "service")
    service_invoice_mode = str(src.get("service_invoice_mode") or "detailed").strip().lower()
    if service_invoice_mode not in {"detailed", "summary_total"}:
        service_invoice_mode = "detailed"
    mapping[str(product_id)] = {
        "listing_type": "service" if is_service else "product",
        "item_kind": "service" if is_service else "product",
        "is_service": is_service,
        "service_booking_enabled": bool(src.get("service_booking_enabled") if src.get("service_booking_enabled") is not None else is_service),
        "service_invoice_mode": service_invoice_mode,
        "service_template_key": str(src.get("service_template_key") or "").strip(),
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
def get_file(path: str):
    file_path = _resolve_uploaded_file(path)
    if not file_path:
        raise HTTPException(status_code=404, detail="File not found")
    try:
        # Read and return bytes directly to avoid sendfile/mount incompatibility on some hosts.
        content = file_path.read_bytes()
        media_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        return Response(content=content, media_type=media_type)
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")


@router.get("/public-files/{path:path}")
def get_public_file(path: str):
    # Alias route used when upstream/proxy rules interfere with /api/files/* paths.
    return get_file(path)


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
    pricing_tier_map = settings.get("product_pricing_tiers") if isinstance(settings.get("product_pricing_tiers"), dict) else {}
    enable_partner_slab_pricing = bool(settings.get("enable_partner_slab_pricing", False))
    customer_user_id = ""
    auth_header = str(authorization or "")
    if auth_header.startswith("Bearer "):
        try:
            token = auth_header.split(" ", 1)[1]
            claims = decode_token(token)
            customer_user_id = str(claims.get("user_id") or "")
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
        if product:
            meta = db.query(ProductMeta).filter(ProductMeta.product_id == product.id).first()
            if meta:
                product_type = meta.product_type or "metho"
                gst_percent = float(meta.gst_percent or 0)
                mrp = float(meta.mrp or 0)
                discount_percent = float(meta.discount_percent or 0)
                image_url = meta.image_url or ""
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

        if unit_info["unit_type"] == "piece":
            qty = max(1, int(round(qty_value or 1)))
        else:
            qty = _round_to_step(qty_value or unit_info["quantity_step"], unit_info["quantity_step"])

        available_stock = max(0.0, float(getattr(product, "stock", 0) or 0))
        if qty > available_stock:
            raise HTTPException(
                status_code=400,
                detail=f"{product.name}: requested quantity {qty} exceeds available stock {available_stock}",
            )
        unit_price = float(product.price)
        pricing_tiers = []
        if product_type == "metho":
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
        if product_type == "metho":
            gst_amount = round(base_subtotal * (max(0.0, gst_percent) / 100.0), 2)
            line_total = round(base_subtotal + gst_amount, 2)

        total = round(total + line_total, 2)

        normalized_items.append(
            {
                "product_id": product.id,
                "name": product.name,
                "price": round(line_total / max(1, qty), 2),
                "unit_base_price": round(base_subtotal / max(1, qty), 2),
                "mrp": mrp if mrp > 0 else float(product.price),
                "discount_percent": discount_percent,
                "gst_percent": (gst_percent if product_type == "metho" else 0),
                "gst_amount": gst_amount,
                "pre_tax": pre_tax,
                "quantity": qty,
                "subtotal": line_total,
                "product_type": product_type,
                "unit_type": unit_info["unit_type"],
                "unit_label": unit_info["unit_label"],
                "quantity_step": unit_info["quantity_step"],
                "image_url": image_url,
                "pricing_tiers": pricing_tiers,
                "tier_breakdown": tier_breakdown,
                "listing_type": str(item.get("listing_type") or listing_meta["listing_type"]).strip().lower(),
                "item_kind": str(item.get("item_kind") or listing_meta["item_kind"]).strip().lower(),
                "is_service": bool(item.get("is_service") if item.get("is_service") is not None else listing_meta["is_service"]),
                "service_booking_enabled": bool(listing_meta["service_booking_enabled"]),
                "service_invoice_mode": str(item.get("service_invoice_mode") or listing_meta["service_invoice_mode"]).strip().lower(),
                "service_template_key": str(item.get("service_template_key") or listing_meta["service_template_key"]).strip(),
            }
        )

    if len(normalized_items) == 0:
        raise HTTPException(status_code=400, detail="No valid products found in order")

    member_ref = str(payload.get("member_code") or payload.get("member_id") or "").strip()
    row = PublicOrder(
        id=str(uuid.uuid4()),
        customer_user_id=customer_user_id,
        member_ref=member_ref,
        shipping_address=str(payload.get("shipping_address") or "").strip(),
        payment_method=str(payload.get("payment_method") or "upi"),
        txn_id=str(payload.get("txn_id") or "").strip(),
        payment_screenshot_url=str(payload.get("payment_screenshot_url") or "").strip(),
        payer_name=str(payload.get("payer_name") or "").strip(),
        items_json=json.dumps(normalized_items),
        total_amount=total,
        status="pending_approval",
    )
    db.add(row)
    db.commit()

    return {
        "id": row.id,
        "status": row.status,
        "total_amount": row.total_amount,
        "items": normalized_items,
    }


@router.post("/orders/{order_id}/submit-payment")
def submit_payment(order_id: str, payload: dict, db: Session = Depends(get_db)):
    row = db.query(PublicOrder).filter(PublicOrder.id == order_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")

    row.txn_id = str(payload.get("txn_id") or row.txn_id)
    row.payment_screenshot_url = str(payload.get("payment_screenshot_url") or row.payment_screenshot_url)
    row.payer_name = str(payload.get("payer_name") or row.payer_name)
    row.status = "pending_approval"
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

    if not order_id or not razorpay_order_id or not razorpay_payment_id or not razorpay_signature:
        raise HTTPException(status_code=400, detail="Missing Razorpay verification fields")

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

    row.txn_id = razorpay_payment_id
    if payer_name:
        row.payer_name = payer_name
    row.status = "pending_approval"
    db.commit()

    # Auto-approve verified Razorpay orders so invoice and commission logic run immediately.
    try:
        from .compat import admin_approve_order

        approved = admin_approve_order(
            order_id=order_id,
            payload={"note": "Auto-approved via Razorpay verification"},
            db=db,
            current_user=SimpleNamespace(role="super_admin"),
        )
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

    return {
        "partner_code": partner.partner_code,
        "business_name": partner.business_name,
        "business_type": str(partner.business_type or ""),
        "commission_percent": float(partner.commission_percent or 0),
        "total_sales": float(partner.total_sales or 0),
        "total_commission_paid": 0,
        "products_linked": products_linked,
        "current_period": "N/A",
        "this_month": {"sales": 0, "commission": 0, "orders": 0},
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
    return [
        {
            "id": p.id,
            "name": p.name,
            "category": p.category,
            "description": p.description,
            "image_url": p.image_url,
            "price": float(p.price or 0),
            "stock": int(p.stock or 0),
            "approval_status": p.approval_status,
            "active": bool(p.active),
            "partner_id": p.partner_id,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            **_partner_unit_info(unit_map, p.id),
            **_partner_product_meta(meta_map, p.id),
        }
        for p in rows
    ]


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

    try:
        stock = int((payload or {}).get("stock") or 0)
    except Exception:
        stock = 0
    stock = max(0, stock)

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
    _set_partner_product_meta(db, row.id, payload)

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
    if (payload or {}).get("stock") is not None:
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
    ]):
        _set_partner_product_meta(db, product.id, payload)

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
def partner_ledger(current_user=Depends(get_current_user)):
    return []


@router.get("/partner/orders")
def partner_orders(current_user=Depends(get_current_user)):
    return []
