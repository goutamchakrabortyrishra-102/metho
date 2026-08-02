import uuid
from types import SimpleNamespace
import base64
import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
import json
import zipfile
import os
import urllib.error
import urllib.request

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AppSetting, AssociatePartner, Order, PartnerProduct, PartnerRequest, Product, ProductMeta, PublicOrder, User, UserReferral
from ..security import hash_password, verify_password
from ..storage import UPLOADED_OBJECTS_DIR
from .auth import get_current_user
from .settings import load_settings, save_settings

router = APIRouter(prefix="/api", tags=["compat"])

PRODUCT_UPLOAD_DIR = UPLOADED_OBJECTS_DIR / "product_images"
PRODUCT_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
UPI_QR_UPLOAD_DIR = UPLOADED_OBJECTS_DIR / "payment_screenshots"
UPI_QR_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
BRANDING_UPLOAD_DIR = UPLOADED_OBJECTS_DIR / "branding_images"
BRANDING_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
PARTNER_IMAGE_MAX_UPLOAD_BYTES = 200 * 1024
GLOBAL_IMAGE_MAX_UPLOAD_BYTES = 200 * 1024
PARTNER_PRODUCT_GALLERY_MAX_UPLOAD_BYTES = 5 * 1024 * 1024
PRODUCT_IMAGE_MAX_UPLOAD_BYTES = 5 * 1024 * 1024


def _save_image_upload(file: UploadFile, target_dir: Path, prefix: str, max_bytes: int = GLOBAL_IMAGE_MAX_UPLOAD_BYTES) -> str:
    ext = Path(file.filename or f"{prefix}.jpg").suffix.lower() or ".jpg"
    if ext not in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"}:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    content = file.file.read()
    if len(content) > max(1, int(max_bytes or 0)):
        kb = max(1, int(max_bytes // 1024))
        raise HTTPException(status_code=400, detail=f"File too large (max {kb}KB)")
    name = f"{prefix}-{uuid.uuid4().hex}{ext}"
    target = target_dir / name
    target.write_bytes(content)
    return name


def _load_razorpay_settings(db: Session) -> tuple[str, str]:
    settings = load_settings(db)
    enabled = bool(settings.get("razorpay_enabled"))
    key_id = str(settings.get("razorpay_key_id") or "").strip()
    key_secret = str(settings.get("razorpay_key_secret") or "").strip()
    if not enabled:
        raise HTTPException(status_code=400, detail="Razorpay is disabled in settings")
    if not key_id or not key_secret:
        raise HTTPException(status_code=400, detail="Razorpay key_id/key_secret not configured")
    return key_id, key_secret


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


def member_code_for_user(user_id: str) -> str:
    normalized = str(user_id or "").strip().upper()
    if normalized.startswith("MAU"):
        return normalized
    clean = normalized.replace("-", "")
    return f"MTH-{clean[:6]}"


def _fallback_product_description(name: str, category: str, product_type: str) -> str:
    line = (
        f"{name} is a quality {category} offering from METHO designed for daily use. "
        f"Carefully curated benefits, reliable quality, and consistent value for families."
    )
    if product_type == "associate_partner":
        line = f"{name} is an associate partner listing in {category}, reviewed for quality and customer trust."
    return line


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_admin_user(current_user: User):
    if getattr(current_user, "role", "") not in {"super_admin", "company_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


AUDIT_LOGS = []
AI_REQUESTS = []
WITHDRAWALS = []
MPS_CLAIMS = []

PAYOUT_DETAIL_DEFAULTS = {
    "bank_account_holder": "",
    "bank_name": "",
    "bank_branch": "",
    "bank_account_number": "",
    "bank_ifsc": "",
    "upi_id": "",
    "upi_qr_url": "",
}

PARTNER_WALLET_DEFAULTS = {
    "balance": 0.0,
    "total_credit": 0.0,
    "total_debit": 0.0,
}

USER_PROFILE_DEFAULTS = {
    "dob": "",
    "pan_no": "",
}


def _user_payout_key(user_id: str) -> str:
    return f"user_payout:{user_id}"


def _user_profile_key(user_id: str) -> str:
    return f"user_profile:{user_id}"


def _partner_wallet_key(partner_id: str) -> str:
    return f"partner_wallet:{partner_id}"


def _partner_wallet_tx_key(partner_id: str) -> str:
    return f"partner_wallet_tx:{partner_id}"


def _partner_topup_key(request_id: str) -> str:
    return f"partner_topup:{request_id}"


def _partner_topup_qr_key(partner_id: str) -> str:
    return f"partner_topup_qr:{partner_id}"


def _partner_payment_qr_key(partner_id: str) -> str:
    return f"partner_payment_qr:{partner_id}"


def _partner_banner_key(partner_id: str) -> str:
    return f"partner_banner:{partner_id}"


def _partner_featured_images_key(partner_id: str) -> str:
    return f"partner_featured_images:{partner_id}"


def _company_commission_wallet_key() -> str:
    return "company_commission_wallet"


def _product_code_key(product_id: str) -> str:
    return f"product_code:{product_id}"


def _list_existing_product_codes(db: Session) -> set[str]:
    rows = db.query(AppSetting).filter(AppSetting.key.like("product_code:%")).all()
    used: set[str] = set()
    for row in rows:
        try:
            payload = row.value_json or ""
            if payload.strip().startswith("{"):
                doc = json.loads(payload)
                code = str(doc.get("code") or "").strip().upper()
            else:
                code = str(payload or "").strip().upper()
            if code:
                used.add(code)
        except Exception:
            continue
    return used


def _generate_product_code(db: Session, product_type: str) -> str:
    prefix = "MTH" if (product_type or "metho") == "metho" else "APR"
    used = _list_existing_product_codes(db)
    for idx in range(1, 1_000_000):
        candidate = f"{prefix}-PROD-{idx:06d}"
        if candidate not in used:
            return candidate
    raise HTTPException(status_code=500, detail="Unable to generate product code")


def _ensure_product_code(db: Session, product_id: str, product_type: str) -> str:
    key = _product_code_key(product_id)
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if row:
        try:
            payload = row.value_json or ""
            if payload.strip().startswith("{"):
                doc = json.loads(payload)
                code = str(doc.get("code") or "").strip().upper()
            else:
                code = str(payload or "").strip().upper()
            if code:
                return code
        except Exception:
            pass

    code = _generate_product_code(db, product_type)
    payload = json.dumps(
        {
            "code": code,
            "product_id": product_id,
            "product_type": product_type or "metho",
            "generated_at": now_iso(),
        }
    )
    if not row:
        db.add(AppSetting(key=key, value_json=payload, updated_at=datetime.now(timezone.utc)))
    else:
        row.value_json = payload
        row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return code


def _file_url(path: str, request: Request) -> str:
    raw = str(path or "").strip()
    if not raw:
        return ""
    forwarded_proto = str(request.headers.get("x-forwarded-proto") or "").split(",", 1)[0].strip().lower()
    forwarded_host = str(request.headers.get("x-forwarded-host") or "").split(",", 1)[0].strip()
    public_base = str(os.getenv("METHO_PUBLIC_BASE_URL") or "").strip().rstrip("/")

    if raw.startswith("http://") or raw.startswith("https://"):
        if raw.startswith("http://") and (forwarded_proto == "https" or public_base.startswith("https://")):
            return f"https://{raw[len('http://') :]}"
        return raw

    normalized = raw if raw.startswith("/") else f"/{raw}"
    if public_base:
        return f"{public_base}{normalized}"
    if forwarded_host:
        scheme = forwarded_proto or str(request.url.scheme or "https")
        if scheme not in {"http", "https"}:
            scheme = "https"
        return f"{scheme}://{forwarded_host}{normalized}"

    base = str(request.base_url).rstrip("/")
    if base.startswith("http://") and (forwarded_proto == "https" or ".onrender.com" in base):
        base = f"https://{base[len('http://') :]}"
    return f"{base}{normalized}"


def _store_key(name: str) -> str:
    return f"metho_store:{name}"


def _store_read_json(db: Session, key: str, default):
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row or not row.value_json:
        return default
    try:
        return json.loads(row.value_json)
    except Exception:
        return default


def _store_write_json(db: Session, key: str, value):
    payload = json.dumps(value)
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row:
        db.add(AppSetting(key=key, value_json=payload, updated_at=datetime.now(timezone.utc)))
    else:
        row.value_json = payload
        row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return value


def _store_owner_code(db: Session) -> str:
    owners = _store_read_json(db, _store_key("owners"), [])
    used = set()
    for owner in owners if isinstance(owners, list) else []:
        if not isinstance(owner, dict):
            continue
        code = str(owner.get("owner_code") or owner.get("code") or "").strip().upper()
        if code:
            used.add(code)
    for idx in range(1, 10000):
        code = f"MTH-STORE-{idx:04d}"
        if code not in used:
            return code
    return f"MTH-STORE-{uuid.uuid4().hex[:8].upper()}"


def _store_owner_docs(db: Session) -> list[dict]:
    rows = _store_read_json(db, _store_key("owners"), [])
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def _store_catalog_docs(db: Session) -> list[dict]:
    rows = _store_read_json(db, _store_key("catalog"), [])
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def _store_inventory_docs(db: Session, owner_id: str) -> list[dict]:
    rows = _store_read_json(db, _store_key(f"inventory:{owner_id}"), [])
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def _store_invoice_docs(db: Session, owner_id: str) -> list[dict]:
    rows = _store_read_json(db, _store_key(f"invoices:{owner_id}"), [])
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def _store_save_owner_docs(db: Session, owners: list[dict]):
    return _store_write_json(db, _store_key("owners"), owners)


def _store_save_catalog_docs(db: Session, catalog: list[dict]):
    return _store_write_json(db, _store_key("catalog"), catalog)


def _store_save_inventory_docs(db: Session, owner_id: str, inventory: list[dict]):
    return _store_write_json(db, _store_key(f"inventory:{owner_id}"), inventory)


def _store_save_invoice_docs(db: Session, owner_id: str, invoices: list[dict]):
    return _store_write_json(db, _store_key(f"invoices:{owner_id}"), invoices)


def _store_find_owner(owners: list[dict], owner_id: str) -> dict | None:
    target = str(owner_id or "").strip()
    if not target:
        return None
    for owner in owners:
        if str(owner.get("id") or "").strip() == target:
            return owner
    return None


def _store_find_catalog_item(catalog: list[dict], item_id: str) -> dict | None:
    target = str(item_id or "").strip()
    if not target:
        return None
    for item in catalog:
        candidates = [item.get("id"), item.get("catalog_item_id"), item.get("sku"), item.get("source_product_id")]
        if any(str(candidate or "").strip() == target for candidate in candidates):
            return item
    return None


def _store_public_owner(owner: dict) -> dict:
    owner_id = str(owner.get("id") or "").strip()
    store_name = str(owner.get("store_name") or owner.get("business_name") or owner.get("owner_name") or "").strip()
    owner_name = str(owner.get("owner_name") or owner.get("name") or store_name or "").strip()
    code = str(owner.get("owner_code") or owner.get("code") or "").strip()
    return {
        "id": owner_id,
        "owner_id": owner_id,
        "owner_code": code,
        "code": code,
        "owner_name": owner_name,
        "store_name": store_name or owner_name,
        "business_name": store_name or owner_name,
        "phone": str(owner.get("phone") or "").strip(),
        "email": str(owner.get("email") or "").strip(),
        "city": str(owner.get("city") or "").strip(),
        "state": str(owner.get("state") or "").strip(),
        "logo_url": str(owner.get("logo_url") or "").strip(),
        "banner_url": str(owner.get("banner_url") or "").strip(),
        "commission_percent": float(owner.get("commission_percent") or 0),
        "is_active": bool(owner.get("is_active", owner.get("active", owner.get("approved", True)))),
        "active": bool(owner.get("active", owner.get("is_active", owner.get("approved", True)))),
        "approved": bool(owner.get("approved", owner.get("active", owner.get("is_active", True)))),
        "whatsapp_no": str(owner.get("whatsapp_no") or owner.get("phone") or "").strip(),
        "address": str(owner.get("address") or "").strip(),
        "pincode": str(owner.get("pincode") or "").strip(),
        "google_map_url": str(owner.get("google_map_url") or owner.get("map_url") or owner.get("location_url") or "").strip(),
        "map_url": str(owner.get("google_map_url") or owner.get("map_url") or owner.get("location_url") or "").strip(),
        "created_at": str(owner.get("created_at") or now_iso()),
    }


def _store_private_owner(owner: dict) -> dict:
    doc = _store_public_owner(owner)
    doc["user_id"] = str(owner.get("user_id") or owner.get("id") or "").strip()
    return doc


def _store_owner_by_user_id(owners: list[dict], user_id: str) -> dict | None:
    target = str(user_id or "").strip()
    if not target:
        return None
    for owner in owners:
        if str(owner.get("user_id") or owner.get("id") or "").strip() == target:
            return owner
    return None


def _store_sync_owner_user(db: Session, owner: dict, password: str | None = None):
    owner_id = str(owner.get("id") or "").strip()
    if not owner_id:
        return None
    email = str(owner.get("email") or "").strip()
    phone = str(owner.get("phone") or "").strip()
    login_id = email or phone or f"{owner_id}@metho-store.local"
    name = str(owner.get("owner_name") or owner.get("store_name") or owner.get("business_name") or "Metho Store Owner").strip()
    user = db.query(User).filter(User.id == owner_id).first()
    if not user:
        existing = db.query(User).filter(User.email == login_id).first() if login_id else None
        if existing:
            raise HTTPException(status_code=400, detail="Login ID already in use")
        user = User(
            id=owner_id,
            name=name,
            email=login_id,
            phone=phone,
            password=hash_password(password or "store123"),
            role="store_owner",
            is_active=bool(owner.get("is_active", True)),
        )
        db.add(user)
    else:
        user.name = name
        user.email = login_id
        user.phone = phone
        user.role = "store_owner"
        user.is_active = bool(owner.get("is_active", True))
        if password:
            user.password = hash_password(password)
    db.commit()
    return user


def _store_owner_inventory_row(item: dict, quantity: int, note: str = "") -> dict:
    now = now_iso()
    return {
        "id": str(uuid.uuid4()),
        "inventory_id": str(uuid.uuid4()),
        "catalog_item_id": str(item.get("id") or item.get("catalog_item_id") or item.get("sku") or "").strip(),
        "name": str(item.get("name") or item.get("title") or item.get("sku") or "Catalog item").strip(),
        "sku": str(item.get("sku") or item.get("catalog_item_id") or item.get("id") or "").strip(),
        "quantity": max(1, int(quantity or 1)),
        "price": float(item.get("price") or item.get("unit_price") or item.get("mrp") or 0),
        "mrp": float(item.get("mrp") or 0),
        "note": str(note or "").strip(),
        "status": "allocated",
        "updated_at": now,
        "created_at": now,
    }


def _store_create_invoice(db: Session, owner: dict, payload: dict) -> dict:
    member_ref = str(payload.get("member_ref") or payload.get("member_code") or payload.get("member_id") or "").strip()
    if not member_ref:
        raise HTTPException(status_code=400, detail="Member ID is required")

    member_user = _resolve_member_user_by_ref(db, member_ref)
    if not member_user:
        raise HTTPException(status_code=404, detail="Member not found")

    items_in = payload.get("items") or []
    if not isinstance(items_in, list) or not items_in:
        raise HTTPException(status_code=400, detail="At least one item is required")

    owner_id = str(owner.get("id") or "").strip()
    inventory = _store_inventory_docs(db, owner_id)
    inventory_by_catalog_id = {}
    for row in inventory:
        catalog_item_id = str(row.get("catalog_item_id") or "").strip()
        if catalog_item_id and catalog_item_id not in inventory_by_catalog_id:
            inventory_by_catalog_id[catalog_item_id] = row

    normalized_items = []
    total = 0.0
    for raw_item in items_in:
        catalog_item_id = str((raw_item or {}).get("catalog_item_id") or "").strip()
        if not catalog_item_id:
            raise HTTPException(status_code=400, detail="Catalog item ID is required")
        inventory_row = inventory_by_catalog_id.get(catalog_item_id)
        if not inventory_row:
            raise HTTPException(status_code=404, detail=f"Inventory item not found: {catalog_item_id}")

        qty = max(1, int((raw_item or {}).get("quantity") or 1))
        available = max(0, int(inventory_row.get("quantity") or 0))
        if qty > available:
            raise HTTPException(status_code=400, detail=f"Insufficient inventory for {inventory_row.get('name') or catalog_item_id}")

        unit_price = float((raw_item or {}).get("unit_price") or inventory_row.get("price") or 0)
        subtotal = round(unit_price * qty, 2)
        total = round(total + subtotal, 2)
        inventory_row["quantity"] = available - qty
        inventory_row["updated_at"] = now_iso()
        normalized_items.append(
            {
                "catalog_item_id": catalog_item_id,
                "name": inventory_row.get("name") or catalog_item_id,
                "sku": inventory_row.get("sku") or catalog_item_id,
                "quantity": qty,
                "unit_price": round(unit_price, 2),
                "subtotal": subtotal,
            }
        )

    invoices = _store_invoice_docs(db, owner_id)
    invoice_no = str(payload.get("invoice_no") or f"MSINV-{uuid.uuid4().hex[:8].upper()}").strip()
    invoice = {
        "id": str(uuid.uuid4()),
        "invoice_no": invoice_no,
        "member_id": member_user.id,
        "member_code": member_code_for_user(member_user.id),
        "owner_id": owner_id,
        "owner_code": str(owner.get("owner_code") or owner.get("code") or "").strip(),
        "owner_name": str(owner.get("store_name") or owner.get("business_name") or owner.get("owner_name") or "Metho Store").strip(),
        "notes": str(payload.get("notes") or "").strip(),
        "items": normalized_items,
        "total": round(total, 2),
        "status": "approved",
        "created_at": now_iso(),
    }
    invoices.insert(0, invoice)
    _store_save_inventory_docs(db, owner_id, inventory)
    _store_save_invoice_docs(db, owner_id, invoices)
    return invoice


def _store_create_owner_stock_purchase(db: Session, owner: dict, payload: dict) -> dict:
    owner_id = str(owner.get("id") or "").strip()
    if not owner_id:
        raise HTTPException(status_code=400, detail="Owner not found")

    catalog_item_id = str(payload.get("catalog_item_id") or "").strip()
    if not catalog_item_id:
        raise HTTPException(status_code=400, detail="Catalog item ID is required")

    catalog = _store_catalog_docs(db)
    item = _store_find_catalog_item(catalog, catalog_item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Catalog item not found")

    quantity = max(1, int(payload.get("quantity") or 1))
    available = max(0, int(item.get("stock") or 0))
    if quantity > available:
        raise HTTPException(status_code=400, detail=f"Insufficient stock for {item.get('name') or catalog_item_id}")

    raw_unit_price = payload.get("unit_price")
    if raw_unit_price is None or str(raw_unit_price).strip() == "":
        unit_price = float(item.get("price") or item.get("mrp") or 0)
    else:
        unit_price = float(raw_unit_price or 0)
    if unit_price < 0:
        raise HTTPException(status_code=400, detail="Unit price cannot be negative")

    raw_commission = payload.get("commission_percent")
    if raw_commission is None or str(raw_commission).strip() == "":
        commission_percent = float(owner.get("commission_percent") or 0)
    else:
        commission_percent = float(raw_commission or 0)
    if commission_percent < 0 or commission_percent > 100:
        raise HTTPException(status_code=400, detail="Commission percent must be between 0 and 100")

    payment_method = str(payload.get("payment_method") or "cash").strip().lower()
    if payment_method not in {"cash", "razorpay"}:
        raise HTTPException(status_code=400, detail="payment_method must be cash or razorpay")
    payment_reference = str(payload.get("payment_reference") or "").strip()
    if payment_method == "razorpay" and not payment_reference:
        raise HTTPException(status_code=400, detail="Payment reference is required for Razorpay payment")

    gross_amount = round(unit_price * quantity, 2)
    commission_amount = round((gross_amount * commission_percent) / 100.0, 2)
    payable_amount = max(0.0, round(gross_amount - commission_amount, 2))

    item["stock"] = available - quantity
    item["updated_at"] = now_iso()

    inventory = _store_inventory_docs(db, owner_id)
    existing = None
    for row in inventory:
        if str(row.get("catalog_item_id") or "").strip() == str(item.get("catalog_item_id") or item.get("id") or "").strip():
            existing = row
            break

    note = str(payload.get("notes") or payload.get("note") or "").strip()
    if existing:
        existing["quantity"] = max(0, int(existing.get("quantity") or 0)) + quantity
        existing["price"] = unit_price
        existing["mrp"] = float(item.get("mrp") or existing.get("mrp") or 0)
        existing["name"] = item.get("name") or existing.get("name") or "Catalog item"
        existing["sku"] = item.get("sku") or existing.get("sku") or catalog_item_id
        if note:
            existing["note"] = note
        existing["status"] = "allocated"
        existing["updated_at"] = now_iso()
        inventory_row = existing
    else:
        inventory_row = _store_owner_inventory_row(item, quantity, note)
        inventory_row["price"] = unit_price
        inventory.insert(0, inventory_row)

    invoices = _store_invoice_docs(db, owner_id)
    invoice_no = str(payload.get("invoice_no") or f"MSPINV-{uuid.uuid4().hex[:8].upper()}").strip()
    purchase_invoice = {
        "id": str(uuid.uuid4()),
        "invoice_no": invoice_no,
        "flow": "owner_stock_purchase",
        "status": "paid",
        "owner_id": owner_id,
        "owner_code": str(owner.get("owner_code") or owner.get("code") or "").strip(),
        "owner_name": str(owner.get("store_name") or owner.get("business_name") or owner.get("owner_name") or "Metho Store").strip(),
        "payment_method": payment_method,
        "payment_reference": payment_reference,
        "commission_percent": round(commission_percent, 2),
        "commission_amount": commission_amount,
        "gross_amount": gross_amount,
        "payable_amount": payable_amount,
        "notes": note,
        "items": [
            {
                "catalog_item_id": str(item.get("catalog_item_id") or item.get("id") or catalog_item_id).strip(),
                "source_product_id": str(item.get("source_product_id") or "").strip(),
                "name": str(item.get("name") or item.get("title") or item.get("sku") or catalog_item_id).strip(),
                "sku": str(item.get("sku") or item.get("catalog_item_id") or item.get("id") or catalog_item_id).strip(),
                "quantity": quantity,
                "unit_price": round(unit_price, 2),
                "subtotal": gross_amount,
            }
        ],
        "total": payable_amount,
        "created_at": now_iso(),
    }

    invoices.insert(0, purchase_invoice)
    _store_save_catalog_docs(db, catalog)
    _store_save_inventory_docs(db, owner_id, inventory)
    _store_save_invoice_docs(db, owner_id, invoices)
    return purchase_invoice


@router.get("/metho-store/public/owners")
def metho_store_public_owners(db: Session = Depends(get_db)):
    owners = [_store_public_owner(owner) for owner in _store_owner_docs(db)]
    owners.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return [owner for owner in owners if bool(owner.get("is_active", True))]


@router.get("/metho-store/owners")
def metho_store_owners(db: Session = Depends(get_db)):
    owners = [_store_public_owner(owner) for owner in _store_owner_docs(db)]
    owners.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return owners


@router.get("/metho-store/admin/owners")
def metho_store_admin_owners(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    owners = [_store_private_owner(owner) for owner in _store_owner_docs(db)]
    owners.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return owners


@router.post("/metho-store/admin/owners")
def metho_store_admin_create_owner(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    owner_id = str(uuid.uuid4())
    owner = {
        "id": owner_id,
        "user_id": owner_id,
        "owner_code": _store_owner_code(db),
        "owner_name": str(payload.get("owner_name") or payload.get("name") or "").strip(),
        "store_name": str(payload.get("store_name") or payload.get("business_name") or "").strip(),
        "phone": str(payload.get("phone") or "").strip(),
        "whatsapp_no": str(payload.get("whatsapp_no") or payload.get("phone") or "").strip(),
        "email": str(payload.get("email") or "").strip(),
        "password": str(payload.get("password") or "").strip(),
        "commission_percent": float(payload.get("commission_percent") or 0),
        "address": str(payload.get("address") or "").strip(),
        "pincode": str(payload.get("pincode") or "").strip(),
        "google_map_url": str(payload.get("google_map_url") or payload.get("map_url") or payload.get("location_url") or "").strip(),
        "city": str(payload.get("city") or "").strip(),
        "state": str(payload.get("state") or "").strip(),
        "approved": False,
        "active": False,
        "is_active": False,
        "logo_url": "",
        "banner_url": "",
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    if not owner["owner_name"] or not owner["store_name"]:
        raise HTTPException(status_code=400, detail="Owner name and store name are required")
    _store_sync_owner_user(db, owner, owner["password"])
    owner.pop("password", None)
    owners = _store_owner_docs(db)
    owners.insert(0, owner)
    _store_save_owner_docs(db, owners)
    return {"message": "Owner created", "owner": _store_private_owner(owner)}


@router.put("/metho-store/admin/owners/{owner_id}")
@router.patch("/metho-store/admin/owners/{owner_id}")
def metho_store_admin_update_owner(owner_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    owners = _store_owner_docs(db)
    owner = _store_find_owner(owners, owner_id)
    if not owner:
        raise HTTPException(status_code=404, detail="Owner not found")
    for field in ["owner_name", "store_name", "phone", "email", "city", "state", "whatsapp_no", "address", "pincode"]:
        if field in payload and payload[field] is not None:
            owner[field] = str(payload.get(field) or "").strip()
    if "google_map_url" in payload or "map_url" in payload or "location_url" in payload:
        owner["google_map_url"] = str(payload.get("google_map_url") or payload.get("map_url") or payload.get("location_url") or "").strip()
    if "commission_percent" in payload and payload.get("commission_percent") is not None:
        owner["commission_percent"] = float(payload.get("commission_percent") or 0)
    new_password = str(payload.get("password") or payload.get("login_password") or "").strip()
    if new_password:
        owner["password"] = new_password
    owner["updated_at"] = now_iso()
    _store_sync_owner_user(db, owner, new_password or None)
    owner.pop("password", None)
    _store_save_owner_docs(db, owners)
    return {"message": "Owner updated", "owner": _store_private_owner(owner)}


@router.post("/metho-store/admin/owners/{owner_id}/approve")
def metho_store_admin_approve_owner(owner_id: str, payload: dict | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    owners = _store_owner_docs(db)
    owner = _store_find_owner(owners, owner_id)
    if not owner:
        raise HTTPException(status_code=404, detail="Owner not found")
    owner["approved"] = True
    owner["active"] = True
    owner["is_active"] = True
    owner["updated_at"] = now_iso()
    _store_sync_owner_user(db, owner)
    _store_save_owner_docs(db, owners)
    return {"message": "Owner approved", "owner": _store_private_owner(owner)}


@router.put("/metho-store/admin/owners/{owner_id}/active")
@router.patch("/metho-store/admin/owners/{owner_id}/active")
def metho_store_admin_owner_active(owner_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    owners = _store_owner_docs(db)
    owner = _store_find_owner(owners, owner_id)
    if not owner:
        raise HTTPException(status_code=404, detail="Owner not found")
    active = bool(payload.get("is_active", payload.get("active", True)))
    owner["active"] = active
    owner["is_active"] = active
    owner["approved"] = active or bool(owner.get("approved", False))
    owner["updated_at"] = now_iso()
    _store_sync_owner_user(db, owner)
    _store_save_owner_docs(db, owners)
    return {"message": "Owner updated", "owner": _store_private_owner(owner)}


@router.delete("/metho-store/admin/owners/{owner_id}")
def metho_store_admin_delete_owner(owner_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    owners = _store_owner_docs(db)
    owner = _store_find_owner(owners, owner_id)
    if not owner:
        raise HTTPException(status_code=404, detail="Owner not found")
    owners = [row for row in owners if str(row.get("id") or "").strip() != str(owner_id or "").strip()]
    _store_save_owner_docs(db, owners)
    db.query(User).filter(User.id == str(owner_id).strip()).delete(synchronize_session=False)
    db.commit()
    return {"message": "Owner deleted"}


@router.post("/metho-store/admin/owners/{owner_id}/reset-password")
@router.post("/metho-store/admin/owners/{owner_id}/password")
@router.put("/metho-store/admin/owners/{owner_id}/password")
@router.patch("/metho-store/admin/owners/{owner_id}/password")
def metho_store_admin_reset_owner_password(owner_id: str, payload: dict | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    owners = _store_owner_docs(db)
    owner = _store_find_owner(owners, owner_id)
    if not owner:
        raise HTTPException(status_code=404, detail="Owner not found")
    password = str((payload or {}).get("password") or "").strip() or "store123"
    user = db.query(User).filter(User.id == str(owner_id).strip()).first()
    if user:
        user.password = hash_password(password)
        user.role = "store_owner"
        db.commit()
    owner["updated_at"] = now_iso()
    _store_save_owner_docs(db, owners)
    return {"message": "Password updated", "new_password": password, "user_email": owner.get("email") or ""}


@router.get("/metho-store/admin/catalog/items")
def metho_store_admin_catalog_items(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    catalog = _store_catalog_docs(db)
    catalog.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return catalog


@router.post("/metho-store/admin/catalog/items")
def metho_store_admin_create_catalog_item(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    catalog = _store_catalog_docs(db)
    item = {
        "id": str(uuid.uuid4()),
        "catalog_item_id": str(uuid.uuid4()),
        "name": str(payload.get("name") or "").strip(),
        "sku": str(payload.get("sku") or "").strip() or f"SKU-{uuid.uuid4().hex[:8].upper()}",
        "mrp": float(payload.get("mrp") or 0),
        "price": float(payload.get("price") or 0),
        "bv": float(payload.get("bv") or 0),
        "stock": max(0, int(payload.get("stock") or 0)),
        "source_product_id": str(payload.get("source_product_id") or "").strip(),
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    if not item["name"]:
        raise HTTPException(status_code=400, detail="Catalog item name is required")
    if item["source_product_id"]:
        item["catalog_item_id"] = item["source_product_id"]
    catalog.insert(0, item)
    _store_save_catalog_docs(db, catalog)
    return {"message": "Catalog item created", "item": item}


@router.post("/metho-store/admin/owners/{owner_id}/inventory/allocate")
def metho_store_admin_allocate_inventory(owner_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    owners = _store_owner_docs(db)
    owner = _store_find_owner(owners, owner_id)
    if not owner:
        raise HTTPException(status_code=404, detail="Owner not found")
    catalog = _store_catalog_docs(db)
    catalog_item_id = str(payload.get("catalog_item_id") or "").strip()
    if not catalog_item_id:
        raise HTTPException(status_code=400, detail="Catalog item ID is required")
    item = _store_find_catalog_item(catalog, catalog_item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Catalog item not found")

    quantity = max(1, int(payload.get("quantity") or 1))
    available = max(0, int(item.get("stock") or 0))
    if quantity > available:
        raise HTTPException(status_code=400, detail=f"Insufficient stock for {item.get('name') or catalog_item_id}")

    item["stock"] = available - quantity
    item["updated_at"] = now_iso()
    inventory = _store_inventory_docs(db, owner_id)
    existing = None
    for row in inventory:
        if str(row.get("catalog_item_id") or "").strip() == catalog_item_id:
            existing = row
            break
    note = str(payload.get("note") or "").strip()
    if existing:
        existing["quantity"] = max(0, int(existing.get("quantity") or 0)) + quantity
        existing["price"] = float(item.get("price") or existing.get("price") or 0)
        existing["mrp"] = float(item.get("mrp") or existing.get("mrp") or 0)
        existing["name"] = item.get("name") or existing.get("name") or "Catalog item"
        existing["sku"] = item.get("sku") or existing.get("sku") or catalog_item_id
        existing["note"] = note or str(existing.get("note") or "")
        existing["status"] = "allocated"
        existing["updated_at"] = now_iso()
        row = existing
    else:
        row = _store_owner_inventory_row(item, quantity, note)
        inventory.insert(0, row)
    _store_save_catalog_docs(db, catalog)
    _store_save_inventory_docs(db, owner_id, inventory)
    return {"message": "Inventory allocated", "inventory": row}


@router.get("/metho-store/admin/owners/{owner_id}/inventory")
def metho_store_admin_owner_inventory(owner_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    owners = _store_owner_docs(db)
    owner = _store_find_owner(owners, owner_id)
    if not owner:
        raise HTTPException(status_code=404, detail="Owner not found")
    inventory = _store_inventory_docs(db, owner_id)
    inventory.sort(key=lambda item: str(item.get("updated_at") or item.get("created_at") or ""), reverse=True)
    return inventory


@router.get("/metho-store/admin/owners/{owner_id}/invoices")
def metho_store_admin_owner_invoices(owner_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    owners = _store_owner_docs(db)
    owner = _store_find_owner(owners, owner_id)
    if not owner:
        raise HTTPException(status_code=404, detail="Owner not found")
    invoices = _store_invoice_docs(db, owner_id)
    invoices.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return invoices


@router.post("/metho-store/admin/owners/{owner_id}/invoices")
@router.post("/metho-store/admin/owner/{owner_id}/invoices")
def metho_store_admin_create_owner_invoice(owner_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    owners = _store_owner_docs(db)
    owner = _store_find_owner(owners, owner_id)
    if not owner:
        raise HTTPException(status_code=404, detail="Owner not found")
    invoice = _store_create_invoice(db, owner, payload)
    return {"message": "Invoice created", "invoice": invoice, "invoice_no": invoice["invoice_no"]}


@router.post("/metho-store/admin/owners/{owner_id}/stock-purchase")
def metho_store_admin_owner_stock_purchase(owner_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    owners = _store_owner_docs(db)
    owner = _store_find_owner(owners, owner_id)
    if not owner:
        raise HTTPException(status_code=404, detail="Owner not found")
    invoice = _store_create_owner_stock_purchase(db, owner, payload)
    return {
        "message": "Owner stock purchase recorded and inventory updated",
        "invoice": invoice,
        "invoice_no": invoice.get("invoice_no"),
        "payable_amount": invoice.get("payable_amount"),
    }


@router.get("/metho-store/owner/me")
def metho_store_owner_me(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    owners = _store_owner_docs(db)
    owner = _store_owner_by_user_id(owners, current_user.id)
    if not owner:
        raise HTTPException(status_code=404, detail="Owner profile not found")
    return _store_private_owner(owner)


@router.get("/metho-store/owner/me/inventory")
def metho_store_owner_inventory(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    owners = _store_owner_docs(db)
    owner = _store_owner_by_user_id(owners, current_user.id)
    if not owner:
        raise HTTPException(status_code=404, detail="Owner profile not found")
    inventory = _store_inventory_docs(db, str(owner.get("id") or current_user.id))
    inventory.sort(key=lambda item: str(item.get("updated_at") or item.get("created_at") or ""), reverse=True)
    return inventory


@router.post("/metho-store/owner/invoices")
def metho_store_owner_create_invoice(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    owners = _store_owner_docs(db)
    owner = _store_owner_by_user_id(owners, current_user.id)
    if not owner:
        raise HTTPException(status_code=404, detail="Owner profile not found")
    invoice = _store_create_invoice(db, owner, payload)
    return {"message": "Invoice created", "invoice": invoice, "invoice_no": invoice["invoice_no"]}


def _normalize_payout_details(payload: dict | None, request: Request | None = None) -> dict:
    source = payload if isinstance(payload, dict) else {}
    normalized = {key: str(source.get(key) or "").strip() for key in PAYOUT_DETAIL_DEFAULTS.keys()}
    normalized["bank_ifsc"] = normalized["bank_ifsc"].upper()
    if request and normalized["upi_qr_url"]:
        normalized["upi_qr_url"] = _file_url(normalized["upi_qr_url"], request)
    return normalized


def _load_user_profile_details(db: Session, user_id: str) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == _user_profile_key(user_id)).first()
    if not row or not row.value_json:
        return USER_PROFILE_DEFAULTS.copy()
    try:
        payload = json.loads(row.value_json or "{}")
    except Exception:
        payload = {}
    return {
        "dob": str(payload.get("dob") or "").strip(),
        "pan_no": str(payload.get("pan_no") or "").strip().upper(),
    }


def _save_user_profile_details(db: Session, user_id: str, payload: dict | None) -> dict:
    current = _load_user_profile_details(db, user_id)
    source = payload if isinstance(payload, dict) else {}
    normalized = {
        "dob": str(source.get("dob") if source.get("dob") is not None else current.get("dob") or "").strip(),
        "pan_no": str(source.get("pan_no") if source.get("pan_no") is not None else current.get("pan_no") or "").strip().upper(),
    }
    row = db.query(AppSetting).filter(AppSetting.key == _user_profile_key(user_id)).first()
    if not row:
        db.add(AppSetting(key=_user_profile_key(user_id), value_json=json.dumps(normalized), updated_at=datetime.now(timezone.utc)))
    else:
        row.value_json = json.dumps(normalized)
        row.updated_at = datetime.now(timezone.utc)
    return normalized


def _resolve_user_by_member_code(db: Session, member_code: str) -> User | None:
    ref = str(member_code or "").strip().upper()
    if not ref:
        return None
    by_id = db.query(User).filter(User.id == ref).first()
    if by_id:
        return by_id

    # Legacy codes can be in MTH-XXXXXX form mapped from the first 6 chars of user id.
    if ref.startswith("MTH-"):
        prefix = ref.replace("-", "")[3:9]
        if prefix:
            by_prefix = db.query(User).filter(User.id.ilike(f"{prefix}%")).order_by(User.created_at.asc()).first()
            if by_prefix:
                return by_prefix
    return None


def _sponsor_code_for_user(db: Session, user_id: str) -> str:
    rel = db.query(UserReferral).filter(UserReferral.user_id == user_id).first()
    if not rel:
        return ""
    sponsor = db.query(User).filter(User.id == rel.sponsor_user_id).first()
    if sponsor:
        return member_code_for_user(sponsor.id)
    return str(rel.sponsor_code or "").strip().upper()


def _resolve_partner_for_user(db: Session, user: User) -> AssociatePartner | None:
    if not user:
        return None
    email = (user.email or "").strip().lower()
    phone = (user.phone or "").strip()
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


def _resolve_member_user_by_ref(db: Session, member_ref: str) -> User | None:
    ref = str(member_ref or "").strip().upper()
    if not ref:
        return None

    # Accept direct user id as member reference fallback.
    by_id = db.query(User).filter(User.id == ref).first()
    if by_id and getattr(by_id, "role", "") == "member":
        return by_id

    by_email = db.query(User).filter(User.email == ref).first()
    if by_email and getattr(by_email, "role", "") == "member":
        return by_email

    # Member code format in this stack is MAU***** for SQL ids and MTH-XXXXXX for legacy ids.
    if ref.startswith("MAU"):
        by_member_id = db.query(User).filter(User.id == ref, User.role == "member").first()
        if by_member_id:
            return by_member_id

    if ref.startswith("MTH-"):
        prefix = ref.replace("-", "")[3:9]
        if prefix:
            by_legacy_prefix = (
                db.query(User)
                .filter(User.role == "member", User.id.ilike(f"{prefix}%"))
                .order_by(User.created_at.asc())
                .first()
            )
            if by_legacy_prefix:
                return by_legacy_prefix
    return None


def _get_offline_billing_product(db: Session, product_id: str) -> dict | None:
    pid = str(product_id or "").strip()
    if not pid:
        return None

    p = db.query(Product).filter(Product.id == pid).first()
    if p:
        meta = db.query(ProductMeta).filter(ProductMeta.product_id == p.id).first()
        product_type = (meta.product_type if meta else "metho") or "metho"
        return {
            "id": p.id,
            "product_code": _ensure_product_code(db, p.id, product_type),
            "name": p.name,
            "price": round(float(p.price or 0), 2),
            "stock": int(p.stock or 0),
            "product_type": product_type,
            "partner_id": None,
        }

    pp = db.query(PartnerProduct).filter(PartnerProduct.id == pid).first()
    if not pp:
        return None
    return {
        "id": pp.id,
        "product_code": _ensure_product_code(db, pp.id, "associate_partner"),
        "name": pp.name,
        "price": round(float(pp.price or 0), 2),
        "stock": int(pp.stock or 0),
        "product_type": "associate_partner",
        "partner_id": pp.partner_id,
    }


def _offline_catalog_for_partner(db: Session, partner_id: str) -> list[dict]:
    rows = (
        db.query(PartnerProduct)
        .filter(
            PartnerProduct.partner_id == partner_id,
            PartnerProduct.approval_status == "approved",
            PartnerProduct.active.is_(True),
        )
        .order_by(PartnerProduct.created_at.desc())
        .all()
    )
    return [
        {
            "id": p.id,
            "product_code": _ensure_product_code(db, p.id, "associate_partner"),
            "name": p.name,
            "category": p.category,
            "price": round(float(p.price or 0), 2),
            "stock": int(p.stock or 0),
            "product_type": "associate_partner",
            "partner_id": p.partner_id,
        }
        for p in rows
    ]


def _offline_catalog_for_admin(db: Session) -> list[dict]:
    out: list[dict] = []
    for p in db.query(Product).order_by(Product.created_at.desc()).all():
        meta = db.query(ProductMeta).filter(ProductMeta.product_id == p.id).first()
        out.append(
            {
                "id": p.id,
                "product_code": _ensure_product_code(db, p.id, (meta.product_type if meta else "metho") or "metho"),
                "name": p.name,
                "category": p.category,
                "price": round(float(p.price or 0), 2),
                "stock": int(p.stock or 0),
                "product_type": (meta.product_type if meta else "metho") or "metho",
                "partner_id": None,
            }
        )

    for pp in (
        db.query(PartnerProduct)
        .filter(PartnerProduct.approval_status == "approved", PartnerProduct.active.is_(True))
        .order_by(PartnerProduct.created_at.desc())
        .all()
    ):
        out.append(
            {
                "id": pp.id,
                "product_code": _ensure_product_code(db, pp.id, "associate_partner"),
                "name": pp.name,
                "category": pp.category,
                "price": round(float(pp.price or 0), 2),
                "stock": int(pp.stock or 0),
                "product_type": "associate_partner",
                "partner_id": pp.partner_id,
            }
        )
    return out


def _load_partner_wallet(db: Session, partner_id: str) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == _partner_wallet_key(partner_id)).first()
    if not row:
        return PARTNER_WALLET_DEFAULTS.copy()
    try:
        payload = json.loads(row.value_json or "{}")
    except Exception:
        payload = {}
    return {
        "balance": round(float(payload.get("balance") or 0), 2),
        "total_credit": round(float(payload.get("total_credit") or 0), 2),
        "total_debit": round(float(payload.get("total_debit") or 0), 2),
    }


def _save_partner_wallet(db: Session, partner_id: str, wallet: dict) -> dict:
    normalized = {
        "balance": round(float(wallet.get("balance") or 0), 2),
        "total_credit": round(float(wallet.get("total_credit") or 0), 2),
        "total_debit": round(float(wallet.get("total_debit") or 0), 2),
    }
    row = db.query(AppSetting).filter(AppSetting.key == _partner_wallet_key(partner_id)).first()
    if not row:
        row = AppSetting(key=_partner_wallet_key(partner_id), value_json=json.dumps(normalized), updated_at=datetime.now(timezone.utc))
        db.add(row)
    else:
        row.value_json = json.dumps(normalized)
        row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return normalized


def _append_partner_wallet_tx(db: Session, partner_id: str, entry: dict):
    row = db.query(AppSetting).filter(AppSetting.key == _partner_wallet_tx_key(partner_id)).first()
    if not row:
        txs = []
    else:
        try:
            txs = json.loads(row.value_json or "[]")
        except Exception:
            txs = []
    txs.insert(0, entry)
    txs = txs[:200]
    payload = json.dumps(txs)
    if not row:
        db.add(AppSetting(key=_partner_wallet_tx_key(partner_id), value_json=payload, updated_at=datetime.now(timezone.utc)))
    else:
        row.value_json = payload
        row.updated_at = datetime.now(timezone.utc)
    db.commit()


def _list_partner_wallet_tx(db: Session, partner_id: str) -> list[dict]:
    row = db.query(AppSetting).filter(AppSetting.key == _partner_wallet_tx_key(partner_id)).first()
    if not row:
        return []
    try:
        return json.loads(row.value_json or "[]")
    except Exception:
        return []


def _load_company_commission_wallet(db: Session) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == _company_commission_wallet_key()).first()
    if not row:
        return {"balance": 0.0, "total_credit": 0.0}
    try:
        payload = json.loads(row.value_json or "{}")
    except Exception:
        payload = {}
    return {
        "balance": round(float(payload.get("balance") or 0), 2),
        "total_credit": round(float(payload.get("total_credit") or 0), 2),
    }


def _save_company_commission_wallet(db: Session, wallet: dict) -> dict:
    normalized = {
        "balance": round(float(wallet.get("balance") or 0), 2),
        "total_credit": round(float(wallet.get("total_credit") or 0), 2),
    }
    row = db.query(AppSetting).filter(AppSetting.key == _company_commission_wallet_key()).first()
    if not row:
        db.add(AppSetting(key=_company_commission_wallet_key(), value_json=json.dumps(normalized), updated_at=datetime.now(timezone.utc)))
    else:
        row.value_json = json.dumps(normalized)
        row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return normalized


def _load_user_payout_details(db: Session, user_id: str, request: Request | None = None) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == _user_payout_key(user_id)).first()
    if not row:
        return PAYOUT_DETAIL_DEFAULTS.copy()
    try:
        payload = json.loads(row.value_json or "{}")
    except Exception:
        payload = {}
    return _normalize_payout_details(payload, request)


def _save_user_payout_details(db: Session, user_id: str, payload: dict | None, request: Request | None = None) -> dict:
    normalized = _normalize_payout_details(payload)
    row = db.query(AppSetting).filter(AppSetting.key == _user_payout_key(user_id)).first()
    if not row:
        row = AppSetting(key=_user_payout_key(user_id), value_json=json.dumps(normalized), updated_at=datetime.now(timezone.utc))
        db.add(row)
    else:
        row.value_json = json.dumps(normalized)
        row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return _normalize_payout_details(normalized, request)


@router.get("/dashboard/overview")
def dashboard_overview(current_user=Depends(get_current_user)):
    return {
        "kyc_status": "approved",
        "rank": "Starter",
        "wallet_balance": 0,
        "total_income": 0,
        "downline_count": 0,
        "orders_count": 0,
        "income_chart": [
            {"day": "Mon", "income": 0},
            {"day": "Tue", "income": 0},
            {"day": "Wed", "income": 0},
            {"day": "Thu", "income": 0},
            {"day": "Fri", "income": 0},
            {"day": "Sat", "income": 0},
            {"day": "Sun", "income": 0},
        ],
        "total_bonus": 0,
        "total_withdrawn": 0,
        "recent_transactions": [],
    }


@router.get("/wallet")
def wallet(current_user=Depends(get_current_user)):
    return {
        "balance": 0,
        "total_income": 0,
        "total_bonus": 0,
        "total_withdrawn": 0,
        "member_reward_credited": 0,
        "leader_reward_credited": 0,
        "mps_fund_payout": 0,
    }


@router.get("/wallet/transactions")
def wallet_transactions(current_user=Depends(get_current_user)):
    return []


@router.get("/wallet/withdrawals")
def wallet_withdrawals(current_user=Depends(get_current_user)):
    return []


@router.get("/wallet/monthly-projection")
def wallet_monthly_projection(current_user=Depends(get_current_user)):
    return {
        "period": datetime.now().strftime("%Y-%m"),
        "my_monthly_purchase": 0,
        "my_points": 0,
        "projected_point_value": 10,
        "projected_member_reward": 0,
        "leader_qualification": {
            "qualified": False,
            "checks": {
                "direct_members": {"actual": 0, "required": 2, "pass": False},
                "personal_monthly_purchase": {"actual": 0, "required": 1000, "pass": False},
                "team_monthly_purchase": {"actual": 0, "required": 5000, "pass": False},
            },
        },
    }


@router.post("/wallet/withdraw")
def wallet_withdraw(payload: dict, current_user=Depends(get_current_user)):
    return {"ok": True, "status": "pending", "message": "Withdrawal request submitted"}


@router.get("/auth/payout-details")
def auth_payout_details(request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    return _load_user_payout_details(db, current_user.id, request)


@router.put("/auth/payout-details")
def auth_update_payout_details(payload: dict, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    return _save_user_payout_details(db, current_user.id, payload, request)


@router.get("/wallet/statement/pdf")
def wallet_statement_pdf(current_user=Depends(get_current_user)):
    content = b"%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
    return Response(content=content, media_type="application/pdf")


@router.get("/members")
def members(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    rows = db.query(User).order_by(User.created_at.desc()).limit(200).all()
    out = []
    for u in rows:
        extras = _load_user_profile_details(db, u.id)
        out.append(
            {
                "id": u.id,
                "name": u.name,
                "email": u.email,
                "phone": u.phone,
                "member_code": member_code_for_user(u.id),
                "sponsor_code": _sponsor_code_for_user(db, u.id),
                "dob": extras.get("dob") or "",
                "pan_no": extras.get("pan_no") or "",
                "rank": "Starter",
                "kyc_status": "approved",
                "role": u.role,
                "active": u.is_active,
            }
        )
    return out


@router.get("/admin/users")
def admin_users(role: str | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    query = db.query(User)
    if role:
        query = query.filter(User.role == str(role).strip())
    rows = query.order_by(User.created_at.desc()).limit(500).all()
    out = []
    for user in rows:
        extras = _load_user_profile_details(db, user.id)
        out.append(
            {
                "id": user.id,
                "name": user.name,
                "email": user.email,
                "phone": user.phone,
                "member_code": member_code_for_user(user.id),
                "sponsor_code": _sponsor_code_for_user(db, user.id),
                "dob": extras.get("dob") or "",
                "pan_no": extras.get("pan_no") or "",
                "role": user.role,
                "active": user.is_active,
                "created_at": user.created_at.isoformat() if user.created_at else now_iso(),
            }
        )
    return out


@router.post("/admin/users/{user_id}/reset-password")
def reset_member_password(user_id: str, payload: dict | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role not in {"super_admin", "company_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Admin access required")

    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    raw = str((payload or {}).get("new_password") or "").strip()
    new_password = raw or ("PW" + uuid.uuid4().hex[:8])
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    target.password = hash_password(new_password)
    db.commit()
    return {"ok": True, "user_id": user_id, "new_password": new_password}


@router.post("/admin/users/{user_id}/toggle-active")
def toggle_member_active(user_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    user = db.query(User).filter(User.id == user_id).first()
    if user:
        user.is_active = not bool(user.is_active)
        db.commit()
    return {"ok": True, "user_id": user_id, "user_name": (user.name if user else "User"), "active": (user.is_active if user else True)}


@router.post("/admin/users")
def admin_create_user(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role not in {"super_admin", "company_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Admin access required")
    email = str(payload.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    exists = db.query(User).filter(User.email == email).first()
    if exists:
        raise HTTPException(status_code=400, detail="Email already exists")

    raw_password = str(payload.get("password") or "").strip() or ("PW" + uuid.uuid4().hex[:8])
    if len(raw_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    user = User(
        name=str(payload.get("name") or "New Member").strip() or "New Member",
        email=email,
        phone=str(payload.get("phone") or "").strip(),
        password=hash_password(raw_password),
        role=str(payload.get("role") or "member").strip() or "member",
        is_active=bool(payload.get("active", True)),
    )
    db.add(user)
    db.commit()
    return {"ok": True, "id": user.id, "email": user.email, "new_password": raw_password}


@router.put("/admin/users/{user_id}")
def admin_update_user(user_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role not in {"super_admin", "company_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Admin access required")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.get("name") is not None:
        user.name = str(payload.get("name") or user.name).strip() or user.name
    if payload.get("phone") is not None:
        user.phone = str(payload.get("phone") or "").strip()
    if payload.get("role") is not None:
        user.role = str(payload.get("role") or user.role).strip() or user.role
    if payload.get("active") is not None:
        user.is_active = bool(payload.get("active"))
    if payload.get("password") is not None:
        new_password = str(payload.get("password") or "").strip()
        if new_password:
            if len(new_password) < 6:
                raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
            user.password = hash_password(new_password)

    if any(key in payload for key in ("dob", "pan_no")):
        _save_user_profile_details(db, user.id, payload)

    if "sponsor_code" in payload:
        sponsor_code = str(payload.get("sponsor_code") or "").strip().upper()
        existing_rel = db.query(UserReferral).filter(UserReferral.user_id == user.id).first()
        if sponsor_code:
            sponsor = _resolve_user_by_member_code(db, sponsor_code)
            if not sponsor or sponsor.id == user.id:
                raise HTTPException(status_code=400, detail="Valid sponsor_code required")
            if not existing_rel:
                db.add(UserReferral(user_id=user.id, sponsor_user_id=sponsor.id, sponsor_code=sponsor_code))
            else:
                existing_rel.sponsor_user_id = sponsor.id
                existing_rel.sponsor_code = sponsor_code
        elif existing_rel:
            db.delete(existing_rel)
    db.commit()
    return {"ok": True, "id": user.id}


@router.delete("/admin/users/{user_id}")
def admin_delete_user(user_id: str, hard: bool = False, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role not in {"super_admin", "company_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Admin access required")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role in {"super_admin", "company_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Cannot delete admin user")
    if hard:
        db.query(UserReferral).filter((UserReferral.user_id == user_id) | (UserReferral.sponsor_user_id == user_id)).delete(synchronize_session=False)
        db.query(AppSetting).filter((AppSetting.key == _user_profile_key(user_id)) | (AppSetting.key == _user_payout_key(user_id))).delete(synchronize_session=False)
        db.delete(user)
    else:
        user.is_active = False
    db.commit()
    return {"ok": True, "id": user_id, "hard": hard}


@router.post("/admin/users/clear-test-members")
def admin_clear_test_members(payload: dict | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role not in {"super_admin", "company_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Admin access required")

    keep_member_ids = {
        str(item or "").strip().upper()
        for item in ((payload or {}).get("keep_member_ids") or [])
        if str(item or "").strip()
    }

    member_rows = db.query(User).filter(User.role == "member").all()
    targets = [m for m in member_rows if str(m.id or "").strip().upper() not in keep_member_ids]
    if not targets:
        return {"ok": True, "deleted_members": 0, "message": "No member profiles matched for cleanup"}

    target_ids = [m.id for m in targets]

    db.query(UserReferral).filter(
        (UserReferral.user_id.in_(target_ids)) | (UserReferral.sponsor_user_id.in_(target_ids))
    ).delete(synchronize_session=False)

    db.query(Order).filter(Order.user_id.in_(target_ids)).delete(synchronize_session=False)

    db.query(PublicOrder).filter(PublicOrder.customer_user_id.in_(target_ids)).delete(synchronize_session=False)

    for member_id in target_ids:
        db.query(AppSetting).filter(
            (AppSetting.key == _user_profile_key(member_id)) |
            (AppSetting.key == _user_payout_key(member_id))
        ).delete(synchronize_session=False)

    db.query(User).filter(User.id.in_(target_ids)).delete(synchronize_session=False)
    db.commit()

    return {
        "ok": True,
        "deleted_members": len(target_ids),
        "deleted_ids": target_ids,
        "message": "Member test profiles cleared",
    }


@router.get("/genealogy/tree")
def genealogy_tree(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    users = db.query(User).all()
    users_by_id = {u.id: u for u in users}
    rels = db.query(UserReferral).all()
    children_map: dict[str, list[str]] = {}
    for rel in rels:
        children_map.setdefault(rel.sponsor_user_id, []).append(rel.user_id)

    def build_node(user_id: str, depth: int = 0):
        user = users_by_id.get(user_id)
        if not user:
            return None
        node = {
            "id": user.id,
            "name": user.name,
            "member_code": member_code_for_user(user.id),
            "rank": "Starter",
            "children": [],
        }
        # Protect against accidental cyclic relationships.
        if depth >= 8:
            return node
        for child_id in children_map.get(user_id, []):
            child = build_node(child_id, depth + 1)
            if child:
                node["children"].append(child)
        return node

    return build_node(current_user.id) or {
        "id": current_user.id,
        "name": current_user.name,
        "member_code": member_code_for_user(current_user.id),
        "rank": "Starter",
        "children": [],
    }


@router.get("/leaderboard/referrals")
def leaderboard_referrals(period: str = "month", limit: int = 25):
    return {"period": period, "leaders": []}


@router.get("/leaderboard/rank-ups")
def leaderboard_rankups(period: str = "month", limit: int = 12):
    return {"period": period, "promotions": []}


@router.get("/analytics/top-products")
def analytics_top_products(period: str = "month", limit: int = 10, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    start = None
    if period == "week":
        start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "month":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    rows = db.query(PublicOrder).order_by(PublicOrder.created_at.desc()).limit(500).all()
    totals: dict[str, dict] = {}
    for row in rows:
        if start and row.created_at and row.created_at < start:
            continue
        try:
            items = json.loads(row.items_json or "[]")
        except Exception:
            items = []
        for item in items:
            product_id = str(item.get("product_id") or "").strip()
            if not product_id:
                continue
            bucket = totals.setdefault(
                product_id,
                {
                    "product_id": product_id,
                    "name": item.get("name") or "Product",
                    "product_type": item.get("product_type") or "metho",
                    "units_sold": 0,
                    "sales_amount": 0.0,
                },
            )
            qty = int(item.get("quantity") or 1)
            subtotal = float(item.get("subtotal") or 0)
            bucket["units_sold"] += qty
            bucket["sales_amount"] += subtotal

    leaders = sorted(totals.values(), key=lambda item: (item["sales_amount"], item["units_sold"]), reverse=True)[: max(1, min(limit, 50))]
    for item in leaders:
        item["sales_amount"] = round(float(item["sales_amount"]), 2)
    return {"period": period, "products": leaders}


@router.get("/analytics/top-partners")
def analytics_top_partners(period: str = "month", limit: int = 10, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    start = None
    if period == "week":
        start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "month":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    partner_map = {p.id: p for p in db.query(AssociatePartner).all()}
    rows = db.query(PublicOrder).order_by(PublicOrder.created_at.desc()).limit(500).all()
    totals: dict[str, dict] = {}
    for row in rows:
        if start and row.created_at and row.created_at < start:
            continue
        try:
            items = json.loads(row.items_json or "[]")
        except Exception:
            items = []
        for item in items:
            if (item.get("product_type") or "metho") != "associate_partner":
                continue
            product_id = str(item.get("product_id") or "").strip()
            partner_id = None
            if product_id:
                product = db.query(PartnerProduct).filter(PartnerProduct.id == product_id).first()
                partner_id = product.partner_id if product else None
            if not partner_id:
                continue
            partner = partner_map.get(partner_id)
            bucket = totals.setdefault(
                partner_id,
                {
                    "partner_id": partner_id,
                    "partner_code": getattr(partner, "partner_code", "") or "",
                    "business_name": getattr(partner, "business_name", "") or "Partner",
                    "units_sold": 0,
                    "sales_amount": 0.0,
                },
            )
            qty = int(item.get("quantity") or 1)
            subtotal = float(item.get("subtotal") or 0)
            bucket["units_sold"] += qty
            bucket["sales_amount"] += subtotal

    leaders = sorted(totals.values(), key=lambda item: (item["sales_amount"], item["units_sold"]), reverse=True)[: max(1, min(limit, 50))]
    for item in leaders:
        item["sales_amount"] = round(float(item["sales_amount"]), 2)
    return {"period": period, "partners": leaders}


@router.get("/business/stats")
def business_stats(current_user=Depends(get_current_user)):
    return {
        "total_business_volume": 0,
        "mps": 0,
        "rank": "Starter",
        "direct_downline": 0,
        "rank_thresholds": {"Bronze": 5000, "Silver": 20000, "Gold": 50000, "Diamond": 100000},
    }


@router.get("/business/cycle")
def business_cycle(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    settings = load_settings(db)
    bonus_percent = float(settings.get("smart_cycle_bonus_percent") or 10)
    target_bv = float(settings.get("cycle_target_bv") or 10000)
    reward_text = str(settings.get("cycle_reward_text") or f"{bonus_percent}% Smart Cycle Bonus")
    return {
        "cycle": "Cycle-1",
        "cycle_bv": 0,
        "target_bv": target_bv,
        "progress_percentage": 0,
        "reward_at_target": reward_text,
    }


@router.get("/smart-cycle/me")
def smart_cycle_me(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    settings = load_settings(db)
    bonus_percent = float(settings.get("smart_cycle_bonus_percent") or 10)
    slot_days = max(1, int(round(float(settings.get("smart_cycle_days") or 28) / 4.0)))
    return {
        "current_cycle": {"name": "Cycle-1", "slot_days": slot_days, "total_slots": 5, "current_slot": 1, "progress_percent": 0},
        "summary": {"qualified_sales": 0, "bonus_percent": bonus_percent, "estimated_bonus": 0, "status": "in_progress"},
        "history": [],
    }


@router.post("/smart-cycle/settle")
def smart_cycle_settle(current_user=Depends(get_current_user)):
    return {"ok": True, "message": "Smart cycle settled", "credited_amount": 0}


@router.get("/orders")
def list_orders(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    q = db.query(PublicOrder)
    if current_user.role not in {"super_admin", "company_admin", "admin"}:
        q = q.filter(PublicOrder.customer_user_id == current_user.id)
    rows = q.order_by(PublicOrder.created_at.desc()).limit(300).all()

    out = []
    for r in rows:
        try:
            items = json.loads(r.items_json or "[]")
        except Exception:
            items = []
        metho_amount = sum(float(i.get("subtotal") or 0) for i in items if i.get("product_type") == "metho")
        associate_amount = sum(float(i.get("subtotal") or 0) for i in items if i.get("product_type") != "metho")
        out.append(
            {
                "id": r.id,
                "order_no": f"ORD-{r.id[:8].upper()}",
                "status": r.status,
                "created_at": r.created_at.isoformat() if r.created_at else now_iso(),
                "shipping_address": r.shipping_address,
                "txn_id": r.txn_id,
                "payment_screenshot_url": r.payment_screenshot_url,
                "payer_name": r.payer_name,
                "items": [
                    {
                        "product_id": i.get("product_id"),
                        "product_code": i.get("product_code") or "",
                        "product_name": i.get("name"),
                        "quantity": i.get("quantity", 1),
                        "price": float(i.get("price") or 0),
                        "subtotal": float(i.get("subtotal") or 0),
                        "product_type": i.get("product_type") or "metho",
                    }
                    for i in items
                ],
                "total_amount": float(r.total_amount or 0),
                "metho_amount": round(metho_amount, 2),
                "associate_amount": round(associate_amount, 2),
                "rejection_reason": "",
            }
        )
    return out


@router.get("/offline-billing/member/{member_ref}")
def offline_billing_member_lookup(member_ref: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") not in {"partner", "super_admin", "company_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Not allowed")

    user = _resolve_member_user_by_ref(db, member_ref)
    if not user:
        raise HTTPException(status_code=404, detail="Member not found")
    return {
        "id": user.id,
        "name": user.name,
        "phone": user.phone,
        "email": user.email,
        "member_code": member_code_for_user(user.id),
    }


@router.get("/offline-billing/products")
def offline_billing_products(partner_id: str | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    role = getattr(current_user, "role", "")
    if role == "partner":
        partner = _resolve_partner_for_user(db, current_user)
        if not partner:
            raise HTTPException(status_code=404, detail="Partner profile not found")
        return {
            "scope": "partner",
            "partner_id": partner.id,
            "products": _offline_catalog_for_partner(db, partner.id),
        }
    if role in {"super_admin", "company_admin", "admin"}:
        partner_scope = str(partner_id or "").strip()
        products = _offline_catalog_for_admin(db)
        if partner_scope:
            products = [
                p
                for p in products
                if (p.get("product_type") == "metho") or (str(p.get("partner_id") or "") == partner_scope)
            ]
        return {
            "scope": "admin",
            "products": products,
        }
    raise HTTPException(status_code=403, detail="Not allowed")


@router.get("/offline-billing/admin/partners")
def offline_billing_admin_partners(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    rows = (
        db.query(AssociatePartner)
        .filter(AssociatePartner.active.is_(True))
        .order_by(AssociatePartner.business_name.asc())
        .all()
    )
    return [
        {
            "id": p.id,
            "partner_code": p.partner_code,
            "business_name": p.business_name,
        }
        for p in rows
    ]


@router.post("/offline-billing/orders")
def offline_billing_create_order(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    role = getattr(current_user, "role", "")
    if role not in {"partner", "super_admin", "company_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Not allowed")

    member_ref = str(payload.get("member_ref") or payload.get("member_code") or payload.get("member_id") or "").strip()
    if not member_ref:
        raise HTTPException(status_code=400, detail="Member ID is required")

    items_in = payload.get("items") or []
    if not isinstance(items_in, list) or len(items_in) == 0:
        raise HTTPException(status_code=400, detail="At least one product is required")

    payment_mode = str(payload.get("payment_mode") or payload.get("payment_method") or "cash").strip().lower()
    if payment_mode not in {"cash", "online"}:
        raise HTTPException(status_code=400, detail="Payment mode must be cash or online")

    partner_scope_id = None
    if role == "partner":
        partner = _resolve_partner_for_user(db, current_user)
        if not partner:
            raise HTTPException(status_code=404, detail="Partner profile not found")
        partner_scope_id = partner.id

    normalized_items = []
    total = 0.0
    for row in items_in:
        product_id = str((row or {}).get("product_id") or "").strip()
        qty = max(1, int((row or {}).get("quantity") or 1))
        item = _get_offline_billing_product(db, product_id)
        if not item:
            raise HTTPException(status_code=400, detail=f"Product not found: {product_id}")

        if partner_scope_id and item.get("product_type") == "associate_partner" and item.get("partner_id") != partner_scope_id:
            raise HTTPException(status_code=403, detail="Partner can only bill own approved products")

        unit_price = round(float(item.get("price") or 0), 2)
        subtotal = round(unit_price * qty, 2)
        total = round(total + subtotal, 2)
        normalized_items.append(
            {
                "product_id": item["id"],
                "product_code": item.get("product_code") or "",
                "name": item["name"],
                "price": unit_price,
                "quantity": qty,
                "subtotal": subtotal,
                "product_type": item.get("product_type") or "metho",
                "gst_percent": 0,
                "gst_amount": 0,
                "pre_tax": subtotal,
            }
        )

    member_user = _resolve_member_user_by_ref(db, member_ref)
    customer_user_id = member_user.id if member_user else ""
    canonical_member_code = member_code_for_user(member_user.id) if member_user else member_ref

    member_phone_raw = str((member_user.phone if member_user else "") or "").strip()
    member_phone_digits = "".join(ch for ch in member_phone_raw if ch.isdigit())
    if len(member_phone_digits) == 10:
        member_phone_digits = f"91{member_phone_digits}"
    elif len(member_phone_digits) > 12:
        member_phone_digits = member_phone_digits[-12:]

    row = PublicOrder(
        id=str(uuid.uuid4()),
        customer_user_id=customer_user_id,
        member_ref=canonical_member_code,
        shipping_address=str(payload.get("shipping_address") or "Offline counter sale").strip(),
        payment_method=payment_mode,
        txn_id=str(payload.get("txn_id") or "").strip(),
        payment_screenshot_url="",
        payer_name=str(payload.get("payer_name") or payload.get("customer_name") or (member_user.name if member_user else "Offline Customer")).strip(),
        items_json=json.dumps(normalized_items),
        total_amount=round(total, 2),
        status="pending_approval",
    )
    db.add(row)
    db.commit()

    # Use the same approval pipeline as online orders so wallet reserve + commission split rules stay identical.
    try:
        admin_approve_order(
            order_id=row.id,
            payload={"note": "Auto-approved from offline billing"},
            db=db,
            current_user=SimpleNamespace(role="super_admin"),
        )
        row = db.query(PublicOrder).filter(PublicOrder.id == row.id).first() or row
    except HTTPException as exc:
        return {
            "ok": True,
            "order_id": row.id,
            "order_no": f"ORD-{row.id[:8].upper()}",
            "payment_mode": payment_mode,
            "member_code": canonical_member_code,
            "total_amount": round(total, 2),
            "status": "pending_approval",
            "approval_reason": str(exc.detail or "Wallet reserve or stock check pending."),
            "invoice_path": "",
            "member_whatsapp_share_url": "",
        }

    invoice_path = f"/invoice/{row.id}"
    whatsapp_msg = f"METHO invoice ready. Invoice No: INV-{row.id[:8].upper()}\nView/Download: {invoice_path}"
    whatsapp_share_url = f"https://wa.me/{member_phone_digits}?text={urllib.parse.quote(whatsapp_msg)}" if member_phone_digits else ""

    return {
        "ok": True,
        "order_id": row.id,
        "order_no": f"ORD-{row.id[:8].upper()}",
        "invoice_no": f"INV-{row.id[:8].upper()}",
        "invoice_path": invoice_path,
        "payment_mode": payment_mode,
        "member_code": canonical_member_code,
        "total_amount": round(total, 2),
        "status": "paid",
        "member_whatsapp_share_url": whatsapp_share_url,
    }


def _invoice_payload(db: Session, order_id: str, current_user: User):
    row = db.query(PublicOrder).filter(PublicOrder.id == order_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")
    if current_user.role not in {"super_admin", "company_admin", "admin"} and row.customer_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not allowed")
    if str(row.status or "") != "paid":
        raise HTTPException(status_code=400, detail="Invoice is available only after admin approval")

    settings = load_settings(db)
    try:
        items = json.loads(row.items_json or "[]")
    except Exception:
        items = []

    invoice_items = []
    subtotal_pre_tax = 0.0
    total_cgst = 0.0
    total_sgst = 0.0
    grand_total = 0.0
    for item in items:
        subtotal = float(item.get("subtotal") or 0)
        gst_rate = float(item.get("gst_percent") or 0)
        product_type = item.get("product_type") or "metho"
        if product_type != "metho":
            gst_rate = 0.0
        pre_tax = round(subtotal - float(item.get("gst_amount") or 0), 2)
        if pre_tax < 0:
            pre_tax = subtotal
        gst_total = round(subtotal - pre_tax, 2)
        cgst = round(gst_total / 2, 2)
        sgst = round(gst_total - cgst, 2)

        subtotal_pre_tax += pre_tax
        total_cgst += cgst
        total_sgst += sgst
        grand_total += subtotal
        invoice_items.append(
            {
                "product_code": item.get("product_code") or "",
                "product_name": item.get("name") or "Product",
                "product_type": product_type,
                "hsn_sac": "3004" if product_type == "metho" else "9983",
                "quantity": int(item.get("quantity") or 1),
                "price": float(item.get("price") or 0),
                "pre_tax": pre_tax,
                "cgst": cgst,
                "sgst": sgst,
                "gst_rate": gst_rate,
                "subtotal": subtotal,
            }
        )

    buyer = db.query(User).filter(User.id == row.customer_user_id).first() if row.customer_user_id else None
    invoice = {
        "order_id": row.id,
        "order_no": f"ORD-{row.id[:8].upper()}",
        "invoice_no": f"INV-{row.id[:8].upper()}",
        "invoice_date": row.created_at.isoformat() if row.created_at else now_iso(),
        "status": ("paid" if row.status == "paid" else row.status),
        "seller": {
            "name": settings.get("site_title", "METHO AAY-UPAY"),
            "address": settings.get("company_address", "India"),
            "gst_no": settings.get("company_gst_no", "N/A"),
            "pan": settings.get("company_pan", "N/A"),
            "state": settings.get("company_state", "West Bengal"),
            "state_code": settings.get("company_state_code", "19"),
            "email": settings.get("company_email", "admin@metho.com"),
            "upi_id": settings.get("upi_id", "methopvtltd@paytm"),
        },
        "buyer": {
            "name": (buyer.name if buyer else "Guest Customer"),
            "email": (buyer.email if buyer else ""),
            "phone": (buyer.phone if buyer else ""),
            "member_code": (member_code_for_user(buyer.id) if buyer else row.member_ref),
            "shipping_address": row.shipping_address,
        },
        "payment": {
            "method": row.payment_method,
            "txn_id": row.txn_id,
        },
        "items": invoice_items,
        "subtotal_pre_tax": round(subtotal_pre_tax, 2),
        "total_cgst": round(total_cgst, 2),
        "total_sgst": round(total_sgst, 2),
        "grand_total": round(grand_total, 2),
        "notes": settings.get("invoice_terms") or settings.get("rules_and_conditions", ""),
        "einvoice": {},
    }
    return invoice


@router.get("/orders/{order_id}/invoice")
def order_invoice(order_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    return _invoice_payload(db, order_id, current_user)


@router.get("/orders/{order_id}/invoice.json")
def order_invoice_json(order_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    return _invoice_payload(db, order_id, current_user)


@router.get("/orders/{order_id}/invoice/pdf")
def order_invoice_pdf(order_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    inv = _invoice_payload(db, order_id, current_user)
    buff = BytesIO()
    c = canvas.Canvas(buff, pagesize=A4)
    w, h = A4
    y = h - 50
    c.setFont("Helvetica-Bold", 16)
    c.drawString(40, y, inv["seller"]["name"])
    y -= 22
    c.setFont("Helvetica", 10)
    c.drawString(40, y, f"Invoice: {inv['invoice_no']}  Order: {inv['order_no']}")
    y -= 16
    c.drawString(40, y, f"Buyer: {inv['buyer']['name']}  Member: {inv['buyer']['member_code'] or '-'}")
    y -= 16
    c.drawString(40, y, f"Total: INR {inv['grand_total']:.2f}  (Taxable: {inv['subtotal_pre_tax']:.2f}, GST: {(inv['total_cgst'] + inv['total_sgst']):.2f})")
    y -= 24
    for idx, item in enumerate(inv["items"], start=1):
        if y < 70:
            c.showPage()
            y = h - 50
        c.drawString(40, y, f"{idx}. {item['product_name']} x{item['quantity']} [{item['product_type']}]  INR {item['subtotal']:.2f}")
        y -= 14
    c.showPage()
    c.save()
    pdf = buff.getvalue()
    return Response(content=pdf, media_type="application/pdf")


@router.get("/admin/invoices/bulk-zip")
def admin_invoices_bulk_zip(year: int, month: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role not in {"super_admin", "company_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Admin access required")

    rows = db.query(PublicOrder).order_by(PublicOrder.created_at.desc()).limit(1000).all()
    month_key = f"{year}-{str(month).zfill(2)}"
    filtered = []
    for r in rows:
        created = r.created_at.isoformat() if r.created_at else ""
        if created.startswith(month_key):
            filtered.append(r)

    mem = BytesIO()
    with zipfile.ZipFile(mem, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for r in filtered:
            inv = _invoice_payload(db, r.id, current_user)
            base = f"{inv['invoice_no']}"
            zf.writestr(f"{base}.json", json.dumps(inv, indent=2))
            html = f"<html><body><h3>{inv['invoice_no']}</h3><p>Order: {inv['order_no']}</p><p>Total: {inv['grand_total']}</p></body></html>"
            zf.writestr(f"{base}.html", html)

    return Response(content=mem.getvalue(), media_type="application/zip")


@router.get("/admin/orders/pending")
def admin_pending_orders(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    rows = (
        db.query(PublicOrder)
        .filter(PublicOrder.status.in_(["pending_approval", "pending_payment", "rejected"]))
        .order_by(PublicOrder.created_at.desc())
        .limit(300)
        .all()
    )
    out = []
    for r in rows:
        user = db.query(User).filter(User.id == r.customer_user_id).first() if r.customer_user_id else None
        try:
            items = json.loads(r.items_json or "[]")
        except Exception:
            items = []
        out.append(
            {
                "id": r.id,
                "order_no": f"ORD-{r.id[:8].upper()}",
                "status": r.status,
                "created_at": r.created_at.isoformat() if r.created_at else now_iso(),
                "payment_submitted_at": r.created_at.isoformat() if r.created_at else now_iso(),
                "shipping_address": r.shipping_address,
                "txn_id": r.txn_id,
                "payment_screenshot_url": r.payment_screenshot_url,
                "payer_name": r.payer_name,
                "user_name": (user.name if user else "Guest User"),
                "user_email": (user.email if user else ""),
                "user_member_code": (member_code_for_user(user.id) if user else r.member_ref),
                "items": [
                    {
                        "product_id": i.get("product_id"),
                        "product_code": i.get("product_code") or "",
                        "product_name": i.get("name"),
                        "quantity": i.get("quantity", 1),
                        "subtotal": float(i.get("subtotal") or 0),
                        "product_type": i.get("product_type") or "metho",
                    }
                    for i in items
                ],
                "total_amount": float(r.total_amount or 0),
            }
        )
    return out


@router.post("/admin/orders/{order_id}/approve")
def admin_approve_order(order_id: str, payload: dict | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    row = db.query(PublicOrder).filter(PublicOrder.id == order_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")
    if row.status != "pending_approval":
        raise HTTPException(status_code=400, detail=f"Only pending_approval orders can be approved (current: {row.status})")
    try:
        items = json.loads(row.items_json or "[]")
    except Exception:
        items = []

    metho_taxable = sum(float(i.get("pre_tax") or i.get("subtotal") or 0) for i in items if (i.get("product_type") or "metho") == "metho")
    commission_base_ex_gst = round(metho_taxable, 2)
    settings = load_settings(db)
    metho_commission_percent = max(0.0, min(100.0, float(settings.get("metho_commission_percent", 10) or 10)))
    metho_commission_pool = round(commission_base_ex_gst * (metho_commission_percent / 100.0), 2)

    partner_product_cache: dict[str, PartnerProduct | None] = {}
    partner_cache: dict[str, AssociatePartner | None] = {}
    partner_rate_cache: dict[str, float] = {}
    partner_commission_base = 0.0
    partner_commission_pool = 0.0
    partner_reserve_required: dict[str, float] = {}

    for item in items:
        product_type = (item.get("product_type") or "metho").strip()
        if product_type == "metho":
            continue
        pid = str(item.get("product_id") or "").strip()
        if not pid:
            continue

        pp = partner_product_cache.get(pid)
        if pid not in partner_product_cache:
            pp = db.query(PartnerProduct).filter(PartnerProduct.id == pid).first()
            partner_product_cache[pid] = pp
        if not pp:
            continue

        partner_obj = partner_cache.get(pp.partner_id)
        if pp.partner_id not in partner_cache:
            partner_obj = db.query(AssociatePartner).filter(AssociatePartner.id == pp.partner_id).first()
            partner_cache[pp.partner_id] = partner_obj

        partner_rate = partner_rate_cache.get(pp.partner_id)
        if partner_rate is None:
            partner_rate = max(0.0, min(100.0, float((partner_obj.commission_percent if partner_obj else 0) or 0)))
            partner_rate_cache[pp.partner_id] = partner_rate

        partner_line_base = float(item.get("subtotal") or 0)
        partner_line_commission = partner_line_base * (partner_rate / 100.0)
        partner_commission_base += partner_line_base
        partner_commission_pool += partner_line_commission
        partner_reserve_required[pp.partner_id] = round(float(partner_reserve_required.get(pp.partner_id) or 0) + partner_line_commission, 2)

    partner_commission_base = round(partner_commission_base, 2)
    partner_commission_pool = round(partner_commission_pool, 2)
    total_commission_pool = round(metho_commission_pool + partner_commission_pool, 2)

    insufficient = []
    for partner_id, required in partner_reserve_required.items():
        wallet = _load_partner_wallet(db, partner_id)
        if float(wallet.get("balance") or 0) + 1e-9 < required:
            partner = partner_cache.get(partner_id)
            insufficient.append(
                {
                    "partner_id": partner_id,
                    "partner_code": getattr(partner, "partner_code", "") or "",
                    "business_name": getattr(partner, "business_name", "") or "Partner",
                    "required": round(required, 2),
                    "available": round(float(wallet.get("balance") or 0), 2),
                }
            )

    if insufficient:
        first = insufficient[0]
        raise HTTPException(
            status_code=400,
            detail=(
                f"Partner wallet reserve insufficient for {first['business_name']} ({first['partner_code']}). "
                f"Required ₹{first['required']}, available ₹{first['available']}."
            ),
        )

    # Inventory check + adjustment on approval (admin is the final controller).
    stock_errors = []
    for item in items:
        qty = max(1, int(item.get("quantity") or 1))
        pid = str(item.get("product_id") or "")
        if not pid:
            continue

        p = db.query(Product).filter(Product.id == pid).first()
        if p:
            available = max(0, int(p.stock or 0))
            if qty > available:
                stock_errors.append(f"{p.name}: requested {qty}, available {available}")
            continue

        pp = db.query(PartnerProduct).filter(PartnerProduct.id == pid).first()
        if pp:
            available = max(0, int(pp.stock or 0))
            if qty > available:
                stock_errors.append(f"{pp.name}: requested {qty}, available {available}")

    if stock_errors:
        raise HTTPException(
            status_code=400,
            detail="Cannot approve order due to insufficient stock: " + " | ".join(stock_errors),
        )

    for item in items:
        qty = max(1, int(item.get("quantity") or 1))
        pid = str(item.get("product_id") or "")
        if not pid:
            continue
        p = db.query(Product).filter(Product.id == pid).first()
        if p:
            p.stock = int(p.stock or 0) - qty
            continue
        pp = db.query(PartnerProduct).filter(PartnerProduct.id == pid).first()
        if pp:
            pp.stock = int(pp.stock or 0) - qty

    company_wallet = _load_company_commission_wallet(db)

    for partner_id, required in partner_reserve_required.items():
        if required <= 0:
            continue
        wallet = _load_partner_wallet(db, partner_id)
        wallet["balance"] = round(float(wallet.get("balance") or 0) - required, 2)
        wallet["total_debit"] = round(float(wallet.get("total_debit") or 0) + required, 2)
        _save_partner_wallet(db, partner_id, wallet)
        _append_partner_wallet_tx(
            db,
            partner_id,
            {
                "id": str(uuid.uuid4()),
                "type": "commission_debit",
                "amount": round(required, 2),
                "description": f"Commission reserve used for order {order_id}",
                "ref_order_id": order_id,
                "created_at": now_iso(),
            },
        )

    if total_commission_pool > 0:
        company_wallet["balance"] = round(float(company_wallet.get("balance") or 0) + total_commission_pool, 2)
        company_wallet["total_credit"] = round(float(company_wallet.get("total_credit") or 0) + total_commission_pool, 2)
        _save_company_commission_wallet(db, company_wallet)

    split_member = round(total_commission_pool * (float(settings.get("commission_split_member_pool") or 0) / 100.0), 2)
    split_leader = round(total_commission_pool * (float(settings.get("commission_split_leader_pool") or 0) / 100.0), 2)
    split_mps = round(total_commission_pool * (float(settings.get("commission_split_mps_fund") or 0) / 100.0), 2)
    split_company = round(total_commission_pool * (float(settings.get("commission_split_company_fund") or 0) / 100.0), 2)
    split_tech = round(total_commission_pool * (float(settings.get("commission_split_technology_reserve") or 0) / 100.0), 2)

    row.status = "paid"
    db.commit()

    return {
        "ok": True,
        "order_id": order_id,
        "status": "paid",
        "rewards_earned": {
            "commission_pool": total_commission_pool,
            "commission_base_excluding_gst": commission_base_ex_gst,
            "metho_commission_percent": metho_commission_percent,
            "metho_commission_pool": metho_commission_pool,
            "partner_commission_base": partner_commission_base,
            "partner_commission_pool": partner_commission_pool,
        },
        "commission_split": {
            "member_pool": split_member,
            "leader_pool": split_leader,
            "mps_fund": split_mps,
            "company_fund": split_company,
            "technology_reserve": split_tech,
        },
        "company_commission_wallet": company_wallet,
    }


@router.post("/admin/orders/{order_id}/reject")
def admin_reject_order(order_id: str, payload: dict | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    row = db.query(PublicOrder).filter(PublicOrder.id == order_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")
    row.status = "rejected"
    db.commit()
    return {"ok": True, "order_id": order_id, "status": "rejected", "reason": (payload or {}).get("reason", "")}


@router.post("/admin/orders/{order_id}/einvoice/submit")
def admin_submit_einvoice(order_id: str, current_user=Depends(get_current_user)):
    return {"ok": True, "order_id": order_id, "irn": "DEMO-IRN-001"}


@router.get("/admin/products/pending")
def admin_products_pending(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    rows = db.query(PartnerProduct).filter(PartnerProduct.approval_status == "pending").order_by(PartnerProduct.created_at.desc()).all()
    return [
        {
            "id": p.id,
            "product_code": _ensure_product_code(db, p.id, "associate_partner"),
            "name": p.name,
            "category": p.category,
            "description": p.description,
            "price": p.price,
            "stock": p.stock,
            "product_type": "associate_partner",
            "image_url": p.image_url,
        }
        for p in rows
    ]


@router.post("/admin/products/{product_id}/approve")
def admin_product_approve(product_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    p = db.query(PartnerProduct).filter(PartnerProduct.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    p.approval_status = "approved"
    p.active = True
    db.commit()
    return {"ok": True, "id": product_id, "status": "approved"}


@router.post("/admin/products/{product_id}/reject")
def admin_product_reject(product_id: str, payload: dict | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    p = db.query(PartnerProduct).filter(PartnerProduct.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    p.approval_status = "rejected"
    p.active = False
    db.commit()
    return {"ok": True, "id": product_id, "status": "rejected", "reason": (payload or {}).get("reason", "")}


@router.delete("/products/{product_id}")
def admin_delete_product(product_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    p = db.query(Product).filter(Product.id == product_id).first()
    if p:
        m = db.query(ProductMeta).filter(ProductMeta.product_id == product_id).first()
        if m:
            db.delete(m)
        db.delete(p)
        db.commit()
    return {"ok": True, "id": product_id}


@router.post("/auth/change-password")
def auth_change_password(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    current_password = str((payload or {}).get("current_password") or "").strip()
    new_password = str((payload or {}).get("new_password") or "").strip()

    if not current_password or not new_password:
        raise HTTPException(status_code=400, detail="current_password and new_password are required")
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    db_user = db.query(User).filter(User.id == current_user.id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    if not verify_password(current_password, db_user.password):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    db_user.password = hash_password(new_password)
    db.commit()
    return {"ok": True, "message": "Password changed"}


@router.post("/auth/forgot-password")
def auth_forgot_password(payload: dict):
    return {"ok": True, "message": "If account exists, reset instructions were sent"}


@router.post("/auth/reset-password")
def auth_reset_password(payload: dict):
    return {"ok": True, "message": "Password reset successful"}


@router.post("/upload/upi-qr")
async def upload_member_upi_qr(request: Request, file: UploadFile = File(...), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    name = _save_image_upload(file, UPI_QR_UPLOAD_DIR, "member-upi-qr")
    relative_url = f"/api/files/payment_screenshots/{name}"
    current = _load_user_payout_details(db, current_user.id)
    current["upi_qr_url"] = relative_url
    saved = _save_user_payout_details(db, current_user.id, current, request)
    return {"ok": True, "url": saved["upi_qr_url"], "storage_path": f"payment_screenshots/{name}"}


@router.get("/partner/payment-profile")
def partner_payment_profile(request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")

    wallet = _load_partner_wallet(db, partner.id)
    settings = load_settings(db)
    topup_qr_row = db.query(AppSetting).filter(AppSetting.key == _partner_topup_qr_key(partner.id)).first()
    topup_qr = ""
    if topup_qr_row:
        try:
            topup_qr = str(json.loads(topup_qr_row.value_json or "{}").get("qr_url") or "").strip()
        except Exception:
            topup_qr = ""

    partner_payment_qr_row = db.query(AppSetting).filter(AppSetting.key == _partner_payment_qr_key(partner.id)).first()
    partner_payment_qr = ""
    if partner_payment_qr_row:
        try:
            partner_payment_qr = str(json.loads(partner_payment_qr_row.value_json or "{}").get("qr_url") or "").strip()
        except Exception:
            partner_payment_qr = ""

    return {
        "partner_id": partner.id,
        "partner_code": partner.partner_code,
        "business_name": partner.business_name,
        "partner_upi_id": partner.upi_id,
        "partner_qr_url": _file_url(partner_payment_qr, request) if partner_payment_qr else "",
        "metho_upi_id": str(settings.get("upi_id") or "").strip(),
        "metho_upi_payee_name": str(settings.get("upi_payee_name") or "METHO Logistics Pvt Ltd").strip(),
        "metho_upi_qr_url": _file_url(str(settings.get("upi_qr_url") or ""), request) if settings.get("upi_qr_url") else "",
        "metho_topup_qr_url": _file_url(topup_qr, request) if topup_qr else "",
        "metho_bank_account_holder": str(settings.get("metho_bank_account_holder") or "").strip(),
        "metho_bank_name": str(settings.get("metho_bank_name") or "").strip(),
        "metho_bank_branch": str(settings.get("metho_bank_branch") or "").strip(),
        "metho_bank_account_number": str(settings.get("metho_bank_account_number") or "").strip(),
        "metho_bank_ifsc": str(settings.get("metho_bank_ifsc") or "").strip().upper(),
        "commission_percent": round(float(partner.commission_percent or 0), 2),
        "wallet": wallet,
        "wallet_transactions": _list_partner_wallet_tx(db, partner.id)[:20],
    }


@router.get("/partner/public-payment-profile/{partner_code}")
def partner_public_payment_profile(partner_code: str, request: Request, db: Session = Depends(get_db)):
    partner = db.query(AssociatePartner).filter(AssociatePartner.partner_code == partner_code, AssociatePartner.active.is_(True)).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    qr_row = db.query(AppSetting).filter(AppSetting.key == _partner_payment_qr_key(partner.id)).first()
    qr_url = ""
    if qr_row:
        try:
            qr_url = str(json.loads(qr_row.value_json or "{}").get("qr_url") or "").strip()
        except Exception:
            qr_url = ""
    return {
        "partner_code": partner.partner_code,
        "business_name": partner.business_name,
        "upi_id": str(partner.upi_id or "").strip(),
        "payee_name": str(partner.business_name or "").strip(),
        "qr_url": _file_url(qr_url, request) if qr_url else "",
    }


@router.post("/partner/upload/payment-qr")
async def partner_upload_payment_qr(file: UploadFile = File(...), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")

    name = _save_image_upload(file, BRANDING_UPLOAD_DIR, "partner-payment-qr", PARTNER_IMAGE_MAX_UPLOAD_BYTES)
    relative_url = f"/api/files/branding_images/{name}"
    payload = {"qr_url": relative_url, "updated_at": now_iso()}
    row = db.query(AppSetting).filter(AppSetting.key == _partner_payment_qr_key(partner.id)).first()
    if not row:
        db.add(AppSetting(key=_partner_payment_qr_key(partner.id), value_json=json.dumps(payload), updated_at=datetime.now(timezone.utc)))
    else:
        row.value_json = json.dumps(payload)
        row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "url": relative_url}


@router.post("/partner/upload/topup-proof")
async def partner_upload_topup_proof(file: UploadFile = File(...), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    name = _save_image_upload(file, UPI_QR_UPLOAD_DIR, "partner-topup-proof", PARTNER_IMAGE_MAX_UPLOAD_BYTES)
    return {"ok": True, "url": f"/api/files/payment_screenshots/{name}", "storage_path": f"payment_screenshots/{name}"}


@router.post("/partner/upload/product-image")
async def partner_upload_product_image(file: UploadFile = File(...), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    name = _save_image_upload(file, PRODUCT_UPLOAD_DIR, "partner-product", PARTNER_PRODUCT_GALLERY_MAX_UPLOAD_BYTES)
    return {"ok": True, "url": f"/api/files/product_images/{name}", "storage_path": f"product_images/{name}"}


@router.post("/partner/upload/product-pdf")
async def partner_upload_product_pdf(file: UploadFile = File(...), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")

    filename = str(file.filename or "catalog.pdf").strip().lower()
    content_type = str(getattr(file, "content_type", "") or "").strip().lower()
    if not (filename.endswith(".pdf") or content_type == "application/pdf"):
        raise HTTPException(status_code=400, detail="Only PDF file allowed")

    content = await file.read()
    if len(content) > PARTNER_PRODUCT_GALLERY_MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 5MB)")

    name = f"partner-product-{uuid.uuid4().hex}.pdf"
    target = PRODUCT_UPLOAD_DIR / name
    target.write_bytes(content)
    return {"ok": True, "url": f"/api/files/product_images/{name}", "pdf_url": f"/api/files/product_images/{name}", "storage_path": f"product_images/{name}"}


@router.get("/partner/banner")
def partner_banner(request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")

    row = db.query(AppSetting).filter(AppSetting.key == _partner_banner_key(partner.id)).first()
    banner_url = ""
    if row and row.value_json:
        try:
            banner_url = str(json.loads(row.value_json or "{}").get("banner_url") or "").strip()
        except Exception:
            banner_url = ""
    return {
        "partner_id": partner.id,
        "partner_code": partner.partner_code,
        "banner_url": _file_url(banner_url, request) if banner_url else "",
    }


@router.post("/partner/upload/shop-banner")
async def partner_upload_shop_banner(file: UploadFile = File(...), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")

    name = _save_image_upload(file, BRANDING_UPLOAD_DIR, "partner-shop-banner", PARTNER_IMAGE_MAX_UPLOAD_BYTES)
    relative_url = f"/api/files/branding_images/{name}"
    payload = {"banner_url": relative_url, "updated_at": now_iso()}
    row = db.query(AppSetting).filter(AppSetting.key == _partner_banner_key(partner.id)).first()
    if not row:
        db.add(AppSetting(key=_partner_banner_key(partner.id), value_json=json.dumps(payload), updated_at=datetime.now(timezone.utc)))
    else:
        row.value_json = json.dumps(payload)
        row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "url": relative_url}


@router.get("/partner/featured-images")
def partner_featured_images(request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")

    row = db.query(AppSetting).filter(AppSetting.key == _partner_featured_images_key(partner.id)).first()
    items = ["", "", "", "", ""]
    if row and row.value_json:
        try:
            payload = json.loads(row.value_json or "{}")
            raw_items = payload.get("items") if isinstance(payload, dict) else []
            if isinstance(raw_items, list):
                for idx in range(min(5, len(raw_items))):
                    items[idx] = str(raw_items[idx] or "").strip()
        except Exception:
            items = ["", "", "", "", ""]

    return {
        "partner_id": partner.id,
        "partner_code": partner.partner_code,
        "items": [(_file_url(path, request) if path else "") for path in items],
    }


@router.post("/partner/upload/featured-image/{slot}")
async def partner_upload_featured_image(slot: int, file: UploadFile = File(...), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    if slot < 1 or slot > 5:
        raise HTTPException(status_code=400, detail="Slot must be between 1 and 5")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")

    row = db.query(AppSetting).filter(AppSetting.key == _partner_featured_images_key(partner.id)).first()
    items = ["", "", "", "", ""]
    if row and row.value_json:
        try:
            payload = json.loads(row.value_json or "{}")
            raw_items = payload.get("items") if isinstance(payload, dict) else []
            if isinstance(raw_items, list):
                for idx in range(min(5, len(raw_items))):
                    items[idx] = str(raw_items[idx] or "").strip()
        except Exception:
            items = ["", "", "", "", ""]

    name = _save_image_upload(file, BRANDING_UPLOAD_DIR, f"partner-featured-{slot}", PARTNER_IMAGE_MAX_UPLOAD_BYTES)
    items[slot - 1] = f"/api/files/branding_images/{name}"

    payload = {"items": items, "updated_at": now_iso()}
    if not row:
        db.add(AppSetting(key=_partner_featured_images_key(partner.id), value_json=json.dumps(payload), updated_at=datetime.now(timezone.utc)))
    else:
        row.value_json = json.dumps(payload)
        row.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "partner_id": partner.id,
        "partner_code": partner.partner_code,
        "items": items,
    }


@router.post("/partner/wallet/topup-request")
def partner_wallet_topup_request(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")

    amount = round(float(payload.get("amount") or 0), 2)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Top-up amount must be greater than 0")

    payment_method = str(payload.get("payment_method") or "manual_upi").strip().lower()
    if payment_method not in {"manual_upi", "razorpay"}:
        payment_method = "manual_upi"

    txn_id = str(payload.get("txn_id") or "").strip()
    proof_url = str(payload.get("proof_url") or "").strip()
    if payment_method == "manual_upi":
        if not txn_id:
            raise HTTPException(status_code=400, detail="Transaction ID is required")
        if not proof_url:
            raise HTTPException(status_code=400, detail="Payment proof is required")

    request_id = str(uuid.uuid4())
    doc = {
        "id": request_id,
        "partner_id": partner.id,
        "partner_code": partner.partner_code,
        "business_name": partner.business_name,
        "amount": amount,
        "payment_method": payment_method,
        "txn_id": txn_id,
        "proof_url": proof_url,
        "status": "pending",
        "created_at": now_iso(),
        "reviewed_at": None,
        "review_note": "",
        "razorpay_order_id": "",
        "razorpay_payment_id": "",
    }
    db.add(AppSetting(key=_partner_topup_key(request_id), value_json=json.dumps(doc), updated_at=datetime.now(timezone.utc)))
    db.commit()
    return {"ok": True, "request": doc}


@router.post("/partner/wallet/topup-razorpay/order")
def partner_wallet_topup_razorpay_order(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")

    request_id = str((payload or {}).get("request_id") or "").strip()
    if not request_id:
        raise HTTPException(status_code=400, detail="request_id is required")

    row = db.query(AppSetting).filter(AppSetting.key == _partner_topup_key(request_id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Top-up request not found")

    try:
        doc = json.loads(row.value_json or "{}")
    except Exception:
        doc = {}

    if str(doc.get("partner_id") or "") != str(partner.id):
        raise HTTPException(status_code=403, detail="This request does not belong to you")
    if str(doc.get("status") or "").lower() != "pending":
        raise HTTPException(status_code=400, detail="Only pending request can open Razorpay order")
    if str(doc.get("payment_method") or "manual_upi").lower() != "razorpay":
        raise HTTPException(status_code=400, detail="Request is not created for Razorpay payment")

    key_id, key_secret = _load_razorpay_settings(db)
    amount_paise = int(round(float(doc.get("amount") or 0) * 100))
    if amount_paise <= 0:
        raise HTTPException(status_code=400, detail="Invalid top-up amount")

    receipt = f"ptop_{request_id[:18]}"
    rp = _razorpay_create_order(amount_paise, receipt, key_id, key_secret)
    razorpay_order_id = str(rp.get("id") or "").strip()
    if not razorpay_order_id:
        raise HTTPException(status_code=502, detail="Razorpay order id missing")

    doc["razorpay_order_id"] = razorpay_order_id
    row.value_json = json.dumps(doc)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "key_id": key_id,
        "amount": amount_paise,
        "currency": str(rp.get("currency") or "INR"),
        "razorpay_order_id": razorpay_order_id,
        "name": "METHOO STORE",
        "description": f"Partner wallet top-up {request_id[:8].upper()}",
    }


@router.post("/partner/wallet/topup-razorpay/verify-and-credit")
def partner_wallet_topup_razorpay_verify_and_credit(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")

    request_id = str((payload or {}).get("request_id") or "").strip()
    razorpay_order_id = str((payload or {}).get("razorpay_order_id") or "").strip()
    razorpay_payment_id = str((payload or {}).get("razorpay_payment_id") or "").strip()
    razorpay_signature = str((payload or {}).get("razorpay_signature") or "").strip()
    if not request_id or not razorpay_order_id or not razorpay_payment_id or not razorpay_signature:
        raise HTTPException(status_code=400, detail="Missing Razorpay verification fields")

    row = db.query(AppSetting).filter(AppSetting.key == _partner_topup_key(request_id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Top-up request not found")

    try:
        doc = json.loads(row.value_json or "{}")
    except Exception:
        doc = {}

    if str(doc.get("partner_id") or "") != str(partner.id):
        raise HTTPException(status_code=403, detail="This request does not belong to you")
    if str(doc.get("status") or "").lower() != "pending":
        raise HTTPException(status_code=400, detail="Only pending request can be verified")
    if str(doc.get("payment_method") or "manual_upi").lower() != "razorpay":
        raise HTTPException(status_code=400, detail="Request is not created for Razorpay payment")

    expected_order_id = str(doc.get("razorpay_order_id") or "").strip()
    if expected_order_id and expected_order_id != razorpay_order_id:
        raise HTTPException(status_code=400, detail="Razorpay order mismatch")

    _, key_secret = _load_razorpay_settings(db)
    signed_payload = f"{razorpay_order_id}|{razorpay_payment_id}".encode("utf-8")
    expected_signature = hmac.new(key_secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_signature, razorpay_signature):
        raise HTTPException(status_code=400, detail="Invalid Razorpay signature")

    amount = round(float(doc.get("amount") or 0), 2)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Invalid top-up amount")

    wallet = _load_partner_wallet(db, partner.id)
    wallet["balance"] = round(float(wallet.get("balance") or 0) + amount, 2)
    wallet["total_credit"] = round(float(wallet.get("total_credit") or 0) + amount, 2)
    _save_partner_wallet(db, partner.id, wallet)

    tx = {
        "id": str(uuid.uuid4()),
        "type": "topup_credit_razorpay",
        "amount": amount,
        "description": "Razorpay top-up credited instantly",
        "ref_request_id": request_id,
        "ref_payment_id": razorpay_payment_id,
        "created_at": now_iso(),
    }
    _append_partner_wallet_tx(db, partner.id, tx)

    doc["status"] = "approved"
    doc["reviewed_at"] = now_iso()
    doc["review_note"] = "Auto-approved via Razorpay verification"
    doc["razorpay_order_id"] = razorpay_order_id
    doc["razorpay_payment_id"] = razorpay_payment_id
    doc["txn_id"] = razorpay_payment_id
    row.value_json = json.dumps(doc)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {"ok": True, "request": doc, "wallet": wallet}


@router.get("/admin/partner-wallet/topup-requests")
def admin_partner_wallet_topup_requests(status_filter: str | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    rows = db.query(AppSetting).filter(AppSetting.key.like("partner_topup:%")).order_by(AppSetting.updated_at.desc()).all()
    out = []
    for row in rows:
        try:
            doc = json.loads(row.value_json or "{}")
        except Exception:
            continue
        if status_filter and str(doc.get("status") or "").lower() != status_filter.lower():
            continue
        out.append(doc)
    return out


@router.post("/admin/partner-wallet/topup-requests/{request_id}/approve")
def admin_approve_partner_topup(request_id: str, payload: dict | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    row = db.query(AppSetting).filter(AppSetting.key == _partner_topup_key(request_id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Top-up request not found")
    try:
        doc = json.loads(row.value_json or "{}")
    except Exception:
        doc = {}
    if str(doc.get("status") or "").lower() != "pending":
        raise HTTPException(status_code=400, detail="Only pending request can be approved")

    partner_id = str(doc.get("partner_id") or "")
    amount = round(float(doc.get("amount") or 0), 2)
    wallet = _load_partner_wallet(db, partner_id)
    wallet["balance"] = round(float(wallet.get("balance") or 0) + amount, 2)
    wallet["total_credit"] = round(float(wallet.get("total_credit") or 0) + amount, 2)
    _save_partner_wallet(db, partner_id, wallet)

    tx = {
        "id": str(uuid.uuid4()),
        "type": "topup_credit",
        "amount": amount,
        "description": "Admin approved wallet top-up",
        "ref_request_id": request_id,
        "created_at": now_iso(),
    }
    _append_partner_wallet_tx(db, partner_id, tx)

    doc["status"] = "approved"
    doc["reviewed_at"] = now_iso()
    doc["review_note"] = str((payload or {}).get("note") or "")
    row.value_json = json.dumps(doc)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "request": doc, "wallet": wallet}


@router.post("/admin/partner-wallet/topup-requests/{request_id}/reject")
def admin_reject_partner_topup(request_id: str, payload: dict | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    row = db.query(AppSetting).filter(AppSetting.key == _partner_topup_key(request_id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Top-up request not found")
    try:
        doc = json.loads(row.value_json or "{}")
    except Exception:
        doc = {}
    if str(doc.get("status") or "").lower() != "pending":
        raise HTTPException(status_code=400, detail="Only pending request can be rejected")

    doc["status"] = "rejected"
    doc["reviewed_at"] = now_iso()
    doc["review_note"] = str((payload or {}).get("note") or "")
    row.value_json = json.dumps(doc)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "request": doc}


@router.post("/admin/partners/{partner_id}/upload-metho-topup-qr")
async def admin_upload_partner_metho_topup_qr(partner_id: str, file: UploadFile = File(...), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    partner = db.query(AssociatePartner).filter(AssociatePartner.id == partner_id).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    name = _save_image_upload(file, BRANDING_UPLOAD_DIR, "partner-topup-qr")
    relative_url = f"/api/files/branding_images/{name}"
    payload = {"qr_url": relative_url, "updated_at": now_iso()}
    row = db.query(AppSetting).filter(AppSetting.key == _partner_topup_qr_key(partner_id)).first()
    if not row:
        db.add(AppSetting(key=_partner_topup_qr_key(partner_id), value_json=json.dumps(payload), updated_at=datetime.now(timezone.utc)))
    else:
        row.value_json = json.dumps(payload)
        row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "url": relative_url}


@router.get("/kyc/me")
def kyc_me(current_user=Depends(get_current_user)):
    return {"status": "approved", "submitted_at": now_iso(), "nid_number": "", "address": ""}


@router.post("/kyc/submit")
def kyc_submit(payload: dict, current_user=Depends(get_current_user)):
    return {"ok": True, "status": "pending", "message": "KYC submitted"}


@router.get("/admin/system-health")
def system_health(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    total_users = db.query(User).count()
    total_orders = db.query(Order).count()
    total_products = db.query(Product).count()
    total_revenue = db.query(Order).with_entities(Order.total_amount).all()
    total_revenue_value = sum(float(r[0] or 0) for r in total_revenue)

    pending_withdrawals = len([w for w in WITHDRAWALS if str(w.get("status", "")).lower() == "pending"])
    pending_ai_requests = len([r for r in AI_REQUESTS if str(r.get("status", "")).lower() in {"pending", "submitted", "open"}])

    health_items = [
        {"key": "users", "label": "Total Users", "value": total_users, "severity": "ok"},
        {"key": "orders", "label": "Total Orders", "value": total_orders, "severity": "ok"},
        {"key": "products", "label": "Products", "value": total_products, "severity": "ok"},
        {"key": "withdrawals", "label": "Pending WD", "value": pending_withdrawals, "severity": "warning" if pending_withdrawals else "ok"},
        {"key": "ai", "label": "Pending AI", "value": pending_ai_requests, "severity": "warning" if pending_ai_requests else "ok"},
        {"key": "services", "label": "Services", "value": "2/2", "severity": "ok"},
    ]

    overall_status = "healthy"
    if any(i["severity"] == "high" for i in health_items):
        overall_status = "attention"
    elif any(i["severity"] == "warning" for i in health_items):
        overall_status = "watch"

    return {
        "overall_status": overall_status,
        "health_items": health_items,
        "summary": {
            "total_users": total_users,
            "total_orders": total_orders,
            "total_products": total_products,
            "total_revenue": total_revenue_value,
            "total_company_reserve": 0,
        },
        "recent_notifications": [],
        "recent_ai_requests": AI_REQUESTS[:10],
        "recent_audit_logs": AUDIT_LOGS[:20],
        "server_time": now_iso(),
        "database": {"status": "ok", "mode": "sql-starter"},
        "services": [
            {"name": "api", "status": "ok"},
            {"name": "auth", "status": "ok"},
        ],
    }


@router.get("/admin/partners")
def admin_partners(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    rows = db.query(AssociatePartner).order_by(AssociatePartner.created_at.desc()).all()
    pending_rows = db.query(AppSetting).filter(AppSetting.key.like("partner_topup:%")).all()
    pending_map: dict[str, int] = {}
    for row in pending_rows:
        try:
            doc = json.loads(row.value_json or "{}")
        except Exception:
            continue
        if str(doc.get("status") or "").lower() != "pending":
            continue
        pid = str(doc.get("partner_id") or "")
        if pid:
            pending_map[pid] = int(pending_map.get(pid) or 0) + 1

    return [
        {
            "id": p.id,
            "partner_code": p.partner_code,
            "business_name": p.business_name,
            "business_type": p.business_type,
            "contact_person": p.contact_person,
            "phone": p.phone,
            "email": p.email,
            "address": p.address,
            "gst_no": p.gst_no,
            "commission_percent": p.commission_percent,
            "agreement_percent": p.commission_percent,
            "upi_id": p.upi_id,
            "whatsapp_no": p.whatsapp_no,
            "notes": "",
            "active": p.active,
            "is_featured": p.is_featured,
            "total_sales": p.total_sales,
            "total_commission_paid": round(float(_load_partner_wallet(db, p.id).get("total_debit") or 0), 2),
            "wallet": _load_partner_wallet(db, p.id),
            "pending_topup_requests": int(pending_map.get(p.id) or 0),
        }
        for p in rows
    ]


@router.get("/partners")
def partners_list(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    rows = (
        db.query(AssociatePartner)
        .filter(AssociatePartner.active.is_(True))
        .order_by(AssociatePartner.business_name.asc())
        .all()
    )
    return [
        {
            "id": p.id,
            "partner_code": p.partner_code,
            "business_name": p.business_name,
            "business_type": p.business_type,
            "contact_person": p.contact_person,
            "phone": p.phone,
            "email": p.email,
            "address": p.address,
            "city": p.city,
            "state": p.state,
            "pincode": p.pincode,
            "gst_no": p.gst_no,
            "commission_percent": p.commission_percent,
            "active": p.active,
            "is_featured": p.is_featured,
            "total_sales": p.total_sales,
        }
        for p in rows
    ]


@router.post("/admin/partners")
def admin_partners_create(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)

    existing_codes = {
        str(row.partner_code or "").strip().upper()
        for row in db.query(AssociatePartner.partner_code).all()
        if row.partner_code
    }
    max_suffix = 0
    for code in existing_codes:
        if code.startswith("MTH-PARTNER-"):
            suffix = code.replace("MTH-PARTNER-", "", 1)
            if suffix.isdigit():
                max_suffix = max(max_suffix, int(suffix))
    next_suffix = max_suffix + 1
    code = f"MTH-PARTNER-{next_suffix:03d}"
    while code in existing_codes:
        next_suffix += 1
        code = f"MTH-PARTNER-{next_suffix:03d}"

    p = AssociatePartner(
        partner_code=code,
        business_name=str(payload.get("business_name") or "Partner Business"),
        business_type=str(payload.get("business_type") or "Retail Shop"),
        contact_person=str(payload.get("contact_person") or ""),
        phone=str(payload.get("phone") or ""),
        email=str(payload.get("email") or ""),
        address=str(payload.get("address") or ""),
        gst_no=str(payload.get("gst_no") or ""),
        upi_id=str(payload.get("upi_id") or ""),
        whatsapp_no=str(payload.get("whatsapp_no") or ""),
        commission_percent=float(payload.get("commission_percent") or 10),
        active=bool(payload.get("active", True)),
    )
    try:
        db.add(p)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Partner code conflict. Please retry.")
    return {"ok": True, "id": p.id, "partner_code": p.partner_code}


@router.put("/admin/partners/{partner_id}")
def admin_partners_update(partner_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    p = db.query(AssociatePartner).filter(AssociatePartner.id == partner_id).first()
    if p:
        p.business_name = str(payload.get("business_name") or p.business_name)
        p.business_type = str(payload.get("business_type") or p.business_type)
        p.contact_person = str(payload.get("contact_person") or p.contact_person)
        p.phone = str(payload.get("phone") or p.phone)
        p.email = str(payload.get("email") or p.email)
        p.address = str(payload.get("address") or p.address)
        p.gst_no = str(payload.get("gst_no") or p.gst_no)
        p.upi_id = str(payload.get("upi_id") or p.upi_id)
        p.whatsapp_no = str(payload.get("whatsapp_no") or p.whatsapp_no)
        p.commission_percent = float(payload.get("commission_percent") or p.commission_percent)
        p.active = bool(payload.get("active", p.active))
        db.commit()
    return {"ok": True, "id": partner_id}


@router.delete("/admin/partners/{partner_id}")
def admin_partners_delete(
    partner_id: str,
    permanent: bool = False,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _require_admin_user(current_user)
    p = db.query(AssociatePartner).filter(AssociatePartner.id == partner_id).first()
    if not p:
        return {"ok": True, "id": partner_id, "permanent": bool(permanent)}

    if not permanent:
        p.active = False
        db.commit()
        return {"ok": True, "id": partner_id, "active": False, "permanent": False}

    db.query(PartnerProduct).filter(PartnerProduct.partner_id == partner_id).delete(synchronize_session=False)
    db.query(AppSetting).filter(
        AppSetting.key.in_(
            [
                _partner_wallet_key(partner_id),
                _partner_wallet_tx_key(partner_id),
                _partner_topup_qr_key(partner_id),
                _partner_payment_qr_key(partner_id),
            ]
        )
    ).delete(synchronize_session=False)
    db.delete(p)
    db.commit()
    return {"ok": True, "id": partner_id, "permanent": True}


@router.post("/admin/partners/{partner_id}/reactivate")
def admin_partners_reactivate(partner_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    p = db.query(AssociatePartner).filter(AssociatePartner.id == partner_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Partner not found")
    p.active = True
    db.commit()
    return {"ok": True, "id": partner_id, "active": True}


@router.delete("/admin/partners/{partner_id}/permanent")
def admin_partners_permanent_delete(partner_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    p = db.query(AssociatePartner).filter(AssociatePartner.id == partner_id).first()
    if not p:
        return {"ok": True, "id": partner_id, "permanent": True}

    db.query(PartnerProduct).filter(PartnerProduct.partner_id == partner_id).delete(synchronize_session=False)
    db.query(AppSetting).filter(
        AppSetting.key.in_(
            [
                _partner_wallet_key(partner_id),
                _partner_wallet_tx_key(partner_id),
                _partner_topup_qr_key(partner_id),
                _partner_payment_qr_key(partner_id),
            ]
        )
    ).delete(synchronize_session=False)
    db.delete(p)
    db.commit()
    return {"ok": True, "id": partner_id, "permanent": True}


@router.get("/admin/partners/{partner_id}/ledger")
def admin_partners_ledger(partner_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    p = db.query(AssociatePartner).filter(AssociatePartner.id == partner_id).first()
    if not p:
        return {"partner": {}, "entries": []}
    return {
        "partner": {
            "partner_code": p.partner_code,
            "business_name": p.business_name,
            "business_type": p.business_type,
            "contact_person": p.contact_person,
            "phone": p.phone,
            "gst_no": p.gst_no,
            "commission_percent": p.commission_percent,
            "total_sales": p.total_sales,
            "total_commission_paid": 0,
        },
        "entries": [],
    }


@router.post("/admin/partners/{partner_id}/toggle-featured")
def admin_partner_toggle_featured(partner_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    p = db.query(AssociatePartner).filter(AssociatePartner.id == partner_id).first()
    if p:
        p.is_featured = not bool(p.is_featured)
        db.commit()
    return {"ok": True, "id": partner_id, "is_featured": (p.is_featured if p else False)}


@router.post("/admin/partners/{partner_id}/reset-password")
def admin_partner_reset_password(partner_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role not in {"super_admin", "company_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Admin access required")

    partner = db.query(AssociatePartner).filter(AssociatePartner.id == partner_id).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")

    if not partner.email:
        raise HTTPException(status_code=404, detail="Partner has no linked login email")

    target = db.query(User).filter(User.email == partner.email).first()
    if not target:
        raise HTTPException(status_code=404, detail="Partner login user not found")

    new_password = "AP" + uuid.uuid4().hex[:8]
    target.password = hash_password(new_password)
    db.commit()

    return {
        "ok": True,
        "partner_id": partner_id,
        "new_password": new_password,
        "user_email": target.email,
    }


@router.get("/admin/partner-requests")
def admin_partner_requests(status_filter: str | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    q = db.query(PartnerRequest)
    if status_filter:
        q = q.filter(PartnerRequest.status == status_filter)
    rows = q.order_by(PartnerRequest.created_at.desc()).all()
    return [
        {
            "id": r.id,
            "status": r.status,
            "business_type": r.business_type,
            "business_name": r.business_name,
            "contact_person": r.contact_person,
            "phone": r.phone,
            "email": r.email,
            "city": r.city,
            "state": r.state,
            "address": r.address,
            "pincode": r.pincode,
            "business_description": r.business_description,
            "commission_percent_ask": r.commission_percent_ask,
            "gst_no": r.gst_no,
            "linked_partner_code": "",
            "rejection_reason": "",
            "created_at": r.created_at.isoformat() if r.created_at else now_iso(),
        }
        for r in rows
    ]


@router.post("/admin/partner-requests/{request_id}/approve")
def admin_partner_request_approve(request_id: str, payload: dict | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    req = db.query(PartnerRequest).filter(PartnerRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Partner request not found")

    requested_commission = float(getattr(req, "commission_percent_ask", 0) or 10)

    cred_row = db.query(AppSetting).filter(AppSetting.key == f"partner_req_creds:{request_id}").first()
    cred_doc = {}
    if cred_row:
        try:
            cred_doc = json.loads(cred_row.value_json or "{}")
        except Exception:
            cred_doc = {}

    login_id = str((cred_doc.get("login_id") if isinstance(cred_doc, dict) else "") or req.email or req.phone or "").strip()
    if not login_id:
        raise HTTPException(status_code=400, detail="Partner request has no login ID")

    login_password = str((cred_doc.get("password") if isinstance(cred_doc, dict) else "") or "").strip()
    if len(login_password) < 6:
        login_password = "AP" + uuid.uuid4().hex[:8]

    user = db.query(User).filter(User.email == login_id).first()
    if user:
        user.role = "partner"
        user.is_active = True
        if req.contact_person and not str(user.name or "").strip():
            user.name = req.contact_person
        if req.phone:
            user.phone = req.phone
        user.password = hash_password(login_password)
    else:
        user = User(
            name=str(req.contact_person or req.business_name or "Partner").strip() or "Partner",
            email=login_id,
            phone=str(req.phone or "").strip(),
            password=hash_password(login_password),
            role="partner",
            is_active=True,
        )
        db.add(user)

    partner = db.query(AssociatePartner).filter(AssociatePartner.email == login_id).first()
    if not partner:
        partner_code = "MTH-PARTNER-" + str(db.query(AssociatePartner).count() + 1).zfill(3)
        partner = AssociatePartner(
            partner_code=partner_code,
            business_name=str(req.business_name or "Partner Business").strip() or "Partner Business",
            business_type=str(req.business_type or "Retail Shop").strip() or "Retail Shop",
            contact_person=str(req.contact_person or "").strip(),
            phone=str(req.phone or "").strip(),
            email=login_id,
            whatsapp_no=str(req.whatsapp_no or req.phone or "").strip(),
            address=str(req.address or "").strip(),
            city=str(req.city or "").strip(),
            state=str(req.state or "").strip(),
            pincode=str(req.pincode or "").strip(),
            gst_no=str(req.gst_no or "").strip(),
            upi_id=str(req.upi_id or "").strip(),
            commission_percent=requested_commission,
            active=True,
        )
        db.add(partner)
    else:
        partner.business_name = str(req.business_name or partner.business_name).strip() or partner.business_name
        partner.business_type = str(req.business_type or partner.business_type).strip() or partner.business_type
        partner.contact_person = str(req.contact_person or partner.contact_person).strip()
        partner.phone = str(req.phone or partner.phone).strip()
        partner.email = login_id
        partner.whatsapp_no = str(req.whatsapp_no or req.phone or partner.whatsapp_no).strip()
        partner.address = str(req.address or partner.address).strip()
        partner.city = str(req.city or partner.city).strip()
        partner.state = str(req.state or partner.state).strip()
        partner.pincode = str(req.pincode or partner.pincode).strip()
        partner.gst_no = str(req.gst_no or partner.gst_no).strip()
        partner.upi_id = str(req.upi_id or partner.upi_id).strip()
        partner.commission_percent = requested_commission
        partner.active = True

    req.status = "approved"
    db.commit()

    partner_code = str(getattr(partner, "partner_code", "") or "")

    if cred_row and isinstance(cred_doc, dict):
        cred_doc["password"] = ""
        cred_doc["approved_at"] = now_iso()
        cred_row.value_json = json.dumps(cred_doc)
        cred_row.updated_at = datetime.now(timezone.utc)
        db.commit()

    return {
        "id": request_id,
        "status": "approved",
        "email": login_id,
        "login_email": login_id,
        "commission_percent": requested_commission,
        "password": login_password,
        "login_password": login_password,
        "partner_code": partner_code,
        "partner_id": partner.id,
    }


@router.post("/admin/partner-requests/{request_id}/reject")
def admin_partner_request_reject(request_id: str, payload: dict | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    req = db.query(PartnerRequest).filter(PartnerRequest.id == request_id).first()
    if req:
        req.status = "rejected"
        db.commit()
    return {"id": request_id, "status": "rejected"}


@router.get("/admin/mps-fund")
def admin_mps_fund(current_user=Depends(get_current_user)):
    # Keep canonical keys used by frontend admin pages and legacy aliases.
    return {
        "balance": 0,
        "total_contributions": 0,
        "total_approved_claims": 0,
        "rules": {
            "mps_min_active_months": 0,
            "mps_min_monthly_purchase": 0,
            "mps_max_claim_amount": 0,
            "mps_min_claim_gap_days": 0,
            "mps_benefit_duration_months": 0,
        },
        "available_balance": 0,
        "total_contribution": 0,
        "total_payout": 0,
    }


@router.get("/admin/mps-claims")
def admin_mps_claims(current_user=Depends(get_current_user)):
    return MPS_CLAIMS


@router.post("/admin/mps-claims")
def admin_mps_claims_create(payload: dict, current_user=Depends(get_current_user)):
    claim = {
        "id": str(uuid.uuid4()),
        "user_id": payload.get("user_id", ""),
        "user_name": "Member",
        "amount": float(payload.get("amount") or 0),
        "reason": payload.get("reason", ""),
        "status": "pending",
        "created_at": now_iso(),
    }
    MPS_CLAIMS.insert(0, claim)
    return claim


@router.post("/admin/mps-claims/{claim_id}/approve")
def admin_mps_claims_approve(claim_id: str, current_user=Depends(get_current_user)):
    for c in MPS_CLAIMS:
        if c["id"] == claim_id:
            c["status"] = "approved"
    return {"id": claim_id, "status": "approved"}


@router.post("/admin/mps-claims/{claim_id}/reject")
def admin_mps_claims_reject(claim_id: str, payload: dict | None = None, current_user=Depends(get_current_user)):
    for c in MPS_CLAIMS:
        if c["id"] == claim_id:
            c["status"] = "rejected"
            c["note"] = (payload or {}).get("note", "")
    return {"id": claim_id, "status": "rejected"}


@router.get("/admin/settlement/preview")
def settlement_preview(year: int, month: int, current_user=Depends(get_current_user)):
    period = f"{year}-{str(month).zfill(2)}"
    return {
        "period": period,
        "already_settled": False,
        "pool_snapshot": {
            "gross_sales": 0,
            "commission_collected": 0,
            "member_pool": 0,
            "leader_pool": 0,
            "mps_fund_contribution": 0,
            "company_fund": 0,
            "technology_reserve": 0,
        },
        "member_settlement": {"total_points": 0, "point_value": 0, "total_reward_distributed": 0, "lines": []},
        "leader_settlement": {"qualified_count": 0, "total_points": 0, "point_value": 0, "total_reward_distributed": 0, "lines": []},
    }


@router.post("/admin/settlement/execute")
def settlement_execute(year: int, month: int, current_user=Depends(get_current_user)):
    return {"ok": True, "period": f"{year}-{str(month).zfill(2)}", "status": "completed"}


@router.get("/admin/settlements")
def settlement_history(current_user=Depends(get_current_user)):
    return []


@router.get("/admin/withdrawals")
def admin_withdrawals(status_filter: str | None = None, current_user=Depends(get_current_user)):
    if not status_filter:
        return WITHDRAWALS
    return [w for w in WITHDRAWALS if w.get("status") == status_filter]


@router.post("/admin/withdrawals/{withdrawal_id}/approve")
def admin_withdrawals_approve(withdrawal_id: str, payload: dict | None = None, current_user=Depends(get_current_user)):
    for w in WITHDRAWALS:
        if w.get("id") == withdrawal_id:
            w["status"] = "approved"
            w["utr"] = (payload or {}).get("utr", "")
    return {"id": withdrawal_id, "status": "approved"}


@router.post("/admin/withdrawals/{withdrawal_id}/reject")
def admin_withdrawals_reject(withdrawal_id: str, payload: dict | None = None, current_user=Depends(get_current_user)):
    for w in WITHDRAWALS:
        if w.get("id") == withdrawal_id:
            w["status"] = "rejected"
            w["rejection_reason"] = (payload or {}).get("reason", "")
    return {"id": withdrawal_id, "status": "rejected"}


@router.post("/admin/upload/upi-qr")
async def upload_upi_qr(file: UploadFile = File(...), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    name = _save_image_upload(file, UPI_QR_UPLOAD_DIR, "upi-qr")
    return {"ok": True, "url": f"/api/files/payment_screenshots/{name}"}


@router.post("/admin/upload/product-image")
async def upload_product_image(file: UploadFile = File(...), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    ext = Path(file.filename or "product.jpg").suffix.lower() or ".jpg"
    if ext not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    content = await file.read()
    if len(content) > PRODUCT_IMAGE_MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 5MB)")
    name = f"product-{uuid.uuid4().hex}{ext}"
    target = PRODUCT_UPLOAD_DIR / name
    target.write_bytes(content)
    return {"ok": True, "url": f"/api/files/product_images/{name}"}


@router.post("/admin/products/generate-description")
def generate_product_description(payload: dict, current_user=Depends(get_current_user)):
    name = str(payload.get("name") or "Product").strip()
    category = str(payload.get("category") or "General").strip()
    product_type = str(payload.get("product_type") or "metho").strip()
    prompt = (
        "Write a concise ecommerce product description in simple English. "
        "Length 45-70 words, no markdown, no emojis, no fake medical claims. "
        f"Product Name: {name}\n"
        f"Category: {category}\n"
        f"Type: {product_type}\n"
    )

    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    gemini_key = (os.getenv("GEMINI_API_KEY", "") or os.getenv("GOOGLE_API_KEY", "")).strip()

    if openai_key:
        try:
            from openai import OpenAI

            client = OpenAI(api_key=openai_key)
            resp = client.responses.create(
                model="gpt-4.1-mini",
                input=prompt,
                max_output_tokens=180,
            )
            text = (resp.output_text or "").strip()
            if text:
                return {"description": text, "provider": "openai"}
        except Exception:
            pass

    if gemini_key:
        try:
            import google.generativeai as genai

            genai.configure(api_key=gemini_key)
            model = genai.GenerativeModel("gemini-1.5-flash")
            resp = model.generate_content(prompt)
            text = (getattr(resp, "text", "") or "").strip()
            if text:
                return {"description": text, "provider": "gemini"}
        except Exception:
            pass

    return {"description": _fallback_product_description(name, category, product_type), "provider": "fallback"}


@router.post("/admin/upload/branding-image")
async def upload_branding_image(purpose: str, file: UploadFile = File(...), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    allowed_purposes = {
        "site_logo", "landing_hero", "product_placeholder", "directory_hero", "social_share",
        "top_leader_1", "top_leader_2", "top_leader_3", "top_leader_4", "top_leader_5", "top_leader_6",
    }
    safe_purpose = "".join(ch for ch in str(purpose or "branding") if ch.isalnum() or ch in {"-", "_"}).strip("-_")
    safe_purpose = safe_purpose or "branding"
    if safe_purpose not in allowed_purposes:
        raise HTTPException(status_code=400, detail=f"purpose must be one of {sorted(allowed_purposes)}")
    name = _save_image_upload(file, BRANDING_UPLOAD_DIR, safe_purpose)
    return {"ok": True, "purpose": safe_purpose, "url": f"/api/files/branding_images/{name}"}


@router.post("/admin/upload/site-logo")
async def upload_site_logo_image(file: UploadFile = File(...), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    name = _save_image_upload(file, BRANDING_UPLOAD_DIR, "site_logo")
    return {"ok": True, "purpose": "site_logo", "url": f"/api/files/branding_images/{name}"}


@router.post("/admin/upload/top-leader-image")
async def upload_top_leader_image(slot: int, file: UploadFile = File(...), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    if slot not in {1, 2, 3, 4, 5, 6}:
        raise HTTPException(status_code=400, detail="slot must be 1 to 6")
    name = _save_image_upload(file, BRANDING_UPLOAD_DIR, f"top_leader_{slot}")
    return {"ok": True, "purpose": f"top_leader_{slot}", "url": f"/api/files/branding_images/{name}"}


@router.put("/settings")
def settings_update(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    # Backward compatibility: older frontend sends partner_commission_percent.
    # Map it to metho_commission_percent when the new key is absent.
    if isinstance(payload, dict):
        if payload.get("metho_commission_percent") is None and payload.get("partner_commission_percent") is not None:
            payload["metho_commission_percent"] = payload.get("partner_commission_percent")
        split_keys = [
            "commission_split_member_pool",
            "commission_split_leader_pool",
            "commission_split_mps_fund",
            "commission_split_company_fund",
            "commission_split_technology_reserve",
        ]
        non_negative_keys = [
            "smart_cycle_bonus_percent",
            "metho_commission_percent",
            "leader_match_percent",
            "smart_cycle_days",
            "min_withdrawal",
            "cycle_target_bv",
            "rank_bronze_bv",
            "rank_silver_bv",
            "rank_gold_bv",
            "rank_diamond_bv",
            "referral_signup_bonus",
            "leader_min_direct_members",
            "leader_min_active_members",
            "leader_min_personal_monthly_purchase",
            "leader_min_team_monthly_purchase",
            "leader_min_active_days",
            "mps_min_active_months",
            "mps_min_monthly_purchase",
            "mps_max_claim_amount",
            "mps_min_claim_gap_days",
            "mps_benefit_duration_months",
            "first_partner_order_cashback_percent",
            "first_partner_order_cashback_max",
        ]
        for key in split_keys + ["smart_cycle_bonus_percent", "metho_commission_percent", "leader_match_percent", "first_partner_order_cashback_percent"]:
            if payload.get(key) is not None:
                value = float(payload.get(key) or 0)
                if value < 0 or value > 100:
                    raise HTTPException(status_code=400, detail=f"{key} must be between 0 and 100")
        for key in non_negative_keys:
            if payload.get(key) is not None and float(payload.get(key) or 0) < 0:
                raise HTTPException(status_code=400, detail=f"{key} must be non-negative")
        if payload.get("smart_cycle_days") is not None and int(payload.get("smart_cycle_days") or 0) < 1:
            raise HTTPException(status_code=400, detail="smart_cycle_days must be >= 1")
        current = load_settings(db)
        merged = {**current, **payload}
        total_split = sum(float(merged.get(key) or 0) for key in split_keys)
        if abs(total_split - 100.0) > 0.01:
            raise HTTPException(status_code=400, detail=f"Commission split must sum to 100 (got {total_split})")
    return save_settings(db, payload)


@router.get("/admin/audit-logs")
def audit_logs(module: str | None = None, action: str | None = None, limit: int = 100, current_user=Depends(get_current_user)):
    logs = AUDIT_LOGS
    if module:
        logs = [l for l in logs if l.get("module") == module]
    if action:
        logs = [l for l in logs if l.get("action") == action]
    return logs[:limit]


@router.get("/admin/ai-upgrade/requests")
def ai_requests(current_user=Depends(get_current_user)):
    return AI_REQUESTS


@router.post("/admin/ai-upgrade/plan")
def ai_plan(payload: dict, current_user=Depends(get_current_user)):
    req = {
        "id": str(uuid.uuid4()),
        "title": payload.get("title") or "AI Upgrade Request",
        "prompt": payload.get("prompt") or "",
        "status": "draft_plan",
        "admin_note": "",
        "affected_modules": [],
        "risk_level": "low",
        "created_at": now_iso(),
    }
    AI_REQUESTS.insert(0, req)
    return req


@router.post("/admin/ai-upgrade/requests/{request_id}/status")
def ai_status(request_id: str, payload: dict, current_user=Depends(get_current_user)):
    for r in AI_REQUESTS:
        if r["id"] == request_id:
            r["status"] = payload.get("status", r["status"])
            r["admin_note"] = payload.get("admin_note", r.get("admin_note", ""))
            return r
    return {"id": request_id, "status": payload.get("status", "draft_plan"), "admin_note": payload.get("admin_note", "")}


@router.post("/admin/ai-upgrade/requests/{request_id}/generate-draft")
def ai_generate_draft(request_id: str, current_user=Depends(get_current_user)):
    for r in AI_REQUESTS:
        if r["id"] == request_id:
            r["draft_patch"] = "# Draft patch preview\nNo-op preview generated in SQL starter mode."
            return r
    return {"id": request_id, "draft_patch": "# Draft patch preview\nNo-op preview generated in SQL starter mode."}
