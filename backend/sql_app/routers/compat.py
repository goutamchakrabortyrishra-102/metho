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
from urllib.parse import quote
import secrets
from PIL import Image

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AppSetting, AssociatePartner, FinancialLedgerEntry, InvoiceRecord, Order, PartnerProduct, PartnerRequest, PaymentRecord, Product, ProductMeta, PublicOrder, RewardRecord, User, UserReferral
from ..security import hash_password, verify_password
from ..storage import UPLOADED_OBJECTS_DIR
from .auth import ADMIN_LOGIN_ID, get_current_user, get_current_user_optional
from .settings import load_settings, save_settings

router = APIRouter(prefix="/api", tags=["compat"])

PDF_FONT_DIR = Path(__file__).resolve().parents[2] / "assets"
try:
    pdfmetrics.registerFont(TTFont("MethoBengali", str(PDF_FONT_DIR / "NotoSansBengali.ttf")))
    pdfmetrics.registerFont(TTFont("MethoDevanagari", str(PDF_FONT_DIR / "NotoSansDevanagari.ttf")))
    MULTILINGUAL_PDF_FONTS = True
except Exception:
    MULTILINGUAL_PDF_FONTS = False


def draw_multilingual_pdf_text(pdf, x, y, value, size=10, bold=False):
    text = str(value or "")
    if not MULTILINGUAL_PDF_FONTS:
        pdf.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        pdf.drawString(x, y, text.encode("ascii", "ignore").decode("ascii"))
        return
    segment_start = 0
    current_x = x
    for index in range(len(text) + 1):
        char = text[index] if index < len(text) else ""
        script = "bengali" if "\u0980" <= char <= "\u09ff" else "devanagari" if "\u0900" <= char <= "\u097f" else "latin"
        next_char = text[segment_start] if segment_start < index else char
        next_script = "bengali" if "\u0980" <= next_char <= "\u09ff" else "devanagari" if "\u0900" <= next_char <= "\u097f" else "latin"
        if script != next_script or index == len(text):
            segment = text[segment_start:index]
            if segment:
                font = "MethoBengali" if next_script == "bengali" else "MethoDevanagari" if next_script == "devanagari" else ("Helvetica-Bold" if bold else "Helvetica")
                pdf.setFont(font, size)
                pdf.drawString(current_x, y, segment)
                current_x += pdfmetrics.stringWidth(segment, font, size)
            segment_start = index


def _inr(value):
    return f"₹{float(value or 0):,.2f}"


def _amount_in_words(value):
    amount = int(round(float(value or 0)))
    if amount == 0:
        return "Zero Rupees Only"

    one = [
        "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
        "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
        "Eighteen", "Nineteen"
    ]
    ten = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

    def two_words(num):
        if num < 20:
            return one[num]
        return ten[num // 10] + (" " + one[num % 10] if num % 10 else "")

    def chunk_words(num):
        if num == 0:
            return ""
        if num < 100:
            return two_words(num)
        if num < 1000:
            hundreds = num // 100
            rem = num % 100
            return (one[hundreds] + " Hundred") + (" " + two_words(rem) if rem else "")
        return ""

    crore = amount // 10000000
    lakh = (amount % 10000000) // 100000
    thousand = (amount % 100000) // 1000
    remainder = amount % 1000

    parts = []
    if crore:
        parts.append(chunk_words(crore) + " Crore")
    if lakh:
        parts.append(chunk_words(lakh) + " Lakh")
    if thousand:
        parts.append(chunk_words(thousand) + " Thousand")
    if remainder:
        parts.append(chunk_words(remainder))

    return (" ".join(p for p in parts if p) or "Zero") + " Rupees Only"


def _draw_invoice_pdf(inv: dict) -> bytes:
    buff = BytesIO()
    pdf = canvas.Canvas(buff, pagesize=A4)
    width, height = A4
    left = 40
    right = width - 40
    y = height - 32

    seller = inv.get("seller") or {}
    buyer = inv.get("buyer") or {}
    payment = inv.get("payment") or {}
    items = inv.get("items") or []

    pdf.setStrokeColorRGB(0.15, 0.15, 0.15)
    pdf.setFillColorRGB(0.1, 0.1, 0.1)
    pdf.setLineWidth(1.2)
    pdf.line(left, y - 8, right, y - 8)

    draw_multilingual_pdf_text(pdf, left, y, str(seller.get("name") or "METHO Vegetable"), 18, bold=True)
    draw_multilingual_pdf_text(pdf, left, y - 18, str(seller.get("address") or ""), 8)
    draw_multilingual_pdf_text(pdf, left, y - 31, f"GSTIN: {seller.get('gst_no', '-')}  PAN: {seller.get('pan', '-')}", 8)
    draw_multilingual_pdf_text(pdf, left, y - 43, f"Email: {seller.get('email', '-')}  Phone: {seller.get('phone', '-')}", 8)

    draw_multilingual_pdf_text(pdf, right - 140, y, "TAX INVOICE", 12, bold=True)
    draw_multilingual_pdf_text(pdf, right - 140, y - 18, f"Invoice No: {inv.get('invoice_no', '-')}", 8)
    draw_multilingual_pdf_text(pdf, right - 140, y - 30, f"Order Ref: {inv.get('order_no', '-')}", 8)
    draw_multilingual_pdf_text(pdf, right - 140, y - 42, f"Date: {str(inv.get('invoice_date', ''))[:10]}", 8)

    y -= 66
    pdf.setLineWidth(0.7)
    pdf.rect(left, y - 52, right - left, 58, stroke=1, fill=0)

    draw_multilingual_pdf_text(pdf, left + 8, y - 14, "CUSTOMER / DELIVERY", 8, bold=True)
    draw_multilingual_pdf_text(pdf, left + 8, y - 28, f"Name: {buyer.get('name', '-')}", 9)
    draw_multilingual_pdf_text(pdf, left + 8, y - 40, f"Mobile: {buyer.get('phone', '-')}  Member: {buyer.get('member_code', '-')}", 8)
    draw_multilingual_pdf_text(pdf, left + 250, y - 14, "PAYMENT", 8, bold=True)
    draw_multilingual_pdf_text(pdf, left + 250, y - 28, f"Method: {str(payment.get('method') or '-').upper()}", 8)
    draw_multilingual_pdf_text(pdf, left + 250, y - 40, f"Txn ID: {payment.get('txn_id') or '-'}", 8)
    draw_multilingual_pdf_text(pdf, left + 8, y - 52, f"Delivery Address: {buyer.get('shipping_address') or 'Not provided'}", 8)

    y -= 70
    table_top = y
    row_height = 24
    header_height = 20
    start_x = [left, left + 30, left + 280, left + 346, left + 405, left + 470, left + 535]

    pdf.setFillColorRGB(0.09, 0.47, 0.38)
    pdf.rect(left, table_top - header_height, right - left, header_height, fill=1, stroke=1)
    pdf.setFillColorRGB(1, 1, 1)
    headers = ["#", "ITEM", "HSN/SAC", "QTY", "RATE (₹)", "PRE-TAX (₹)", "CGST", "SGST", "TOTAL (₹)"]
    for idx, header in enumerate(headers):
        x = start_x[idx] if idx < len(start_x) else left + 520
        if idx >= 6:
            x = left + 468 + (idx - 6) * 52
        draw_multilingual_pdf_text(pdf, x + 4, table_top - 14, header, 7, bold=True)

    pdf.setFillColorRGB(0, 0, 0)
    for index, item in enumerate(items, start=1):
        row_y = table_top - header_height - (index * row_height)
        pdf.rect(left, row_y, right - left, row_height, fill=0, stroke=1)
        values = [
            str(index),
            str(item.get("product_name", "Item")),
            str(item.get("hsn_sac", "-")),
            str(item.get("quantity", 1)),
            _inr(item.get("price") or 0),
            _inr(item.get("pre_tax") or 0),
            _inr(item.get("cgst") or 0),
            _inr(item.get("sgst") or 0),
            _inr(item.get("subtotal") or 0),
        ]
        for col_idx, value in enumerate(values):
            x = start_x[col_idx] if col_idx < len(start_x) else left + 520
            if col_idx >= 6:
                x = left + 468 + (col_idx - 6) * 52
            draw_multilingual_pdf_text(pdf, x + 4, row_y + 8, value[:28], 7)

    summary_y = table_top - header_height - (max(len(items), 1) * row_height) - 24
    pdf.line(left, summary_y + 10, right, summary_y + 10)
    draw_multilingual_pdf_text(pdf, left, summary_y - 10, "Amount in Words", 8, bold=True)
    draw_multilingual_pdf_text(pdf, left, summary_y - 24, _amount_in_words(inv.get("grand_total") or 0), 12, bold=True)

    draw_multilingual_pdf_text(pdf, right - 100, summary_y - 12, f"Delivery Charge {_inr(inv.get('delivery_charge') or 0)}", 9)
    draw_multilingual_pdf_text(pdf, right - 100, summary_y - 28, f"Taxable Value: {_inr(inv.get('subtotal_pre_tax') or 0)}", 9)
    draw_multilingual_pdf_text(pdf, right - 100, summary_y - 44, f"CGST: {_inr(inv.get('total_cgst') or 0)}", 9)
    draw_multilingual_pdf_text(pdf, right - 100, summary_y - 60, f"SGST: {_inr(inv.get('total_sgst') or 0)}", 9)
    draw_multilingual_pdf_text(pdf, right - 100, summary_y - 80, f"Grand Total {_inr(inv.get('grand_total') or 0)}", 11, bold=True)

    draw_multilingual_pdf_text(pdf, left, 36, "Powered By Metho Logistics Private Limited", 9, bold=True)
    pdf.save()
    return buff.getvalue()

PRODUCT_UPLOAD_DIR = UPLOADED_OBJECTS_DIR / "product_images"
PRODUCT_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
UPI_QR_UPLOAD_DIR = UPLOADED_OBJECTS_DIR / "payment_screenshots"
UPI_QR_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
BRANDING_UPLOAD_DIR = UPLOADED_OBJECTS_DIR / "branding_images"
BRANDING_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
TOURISM_BOOKING_IMAGE_DIR = UPLOADED_OBJECTS_DIR / "tourism_booking_images"
TOURISM_BOOKING_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
PARTNER_IMAGE_MAX_UPLOAD_BYTES = 200 * 1024
GLOBAL_IMAGE_MAX_UPLOAD_BYTES = 2 * 1024 * 1024
UPI_PROOF_MAX_UPLOAD_BYTES = 5 * 1024 * 1024
PARTNER_PRODUCT_GALLERY_MAX_UPLOAD_BYTES = 5 * 1024 * 1024
PRODUCT_IMAGE_MAX_UPLOAD_BYTES = 5 * 1024 * 1024
PARTNER_PRODUCT_UNITS_KEY = "partner_product_units"
PARTNER_UNIT_OPTIONS = {"piece", "kg", "gram", "litre", "ml"}
PARTNER_PRODUCT_META_KEY = "partner_product_meta"
TRANSPORT_SERVICE_TEMPLATE_KEYS = {"cab_airport_drop", "car_rental_daily", "bike_rental_daily"}
DELIVERY_SERVICE_TEMPLATE_KEYS = {"cargo_transport", "courier_pickup"}
HOSPITALITY_SERVICE_TEMPLATE_KEYS = {
    "hotel_standard_room",
    "hotel_deluxe_room",
    "hotel_suite_room",
    "homestay_daily_stay",
    "homestay_weekend_package",
    "restaurant_table_booking",
    "banquet_slot",
    "restaurant_takeaway_slot",
    "cafe_table_reservation",
    "rental_house_monthly",
    "flat_apartment_monthly",
}
HOSPITALITY_SERVICE_HINTS = {
    "hotel", "homestay", "home stay", "guest house", "guesthouse", "resort", "restaurant", "resturent", "cafe",
    "dining", "banquet", "stay", "takeaway", "food", "meal", "lounge", "apartment", "rental house", "flat",
}
ADMIN_ACCOUNTS_LEDGER_KEY = "admin_accounts_ledger"
CUSTOMER_ORDER_CONTACT_KEY_PREFIX = "order_contact:"
CUSTOMER_ORDER_OTP_KEY_PREFIX = "customer_mobile_otp:"
CUSTOMER_ACCESS_MODES = {"mobile_only", "mobile_otp"}
METHO_QUALIFIED_PRODUCT_TYPES = {"metho", "metho_service", "metho_vegetable"}
# METHO Vegetable is a distinct storefront but is company-owned stock like METHO products
# (not a partner product), so every 'metho'-only check below must also match it.
METHO_VEGETABLE_LIKE_PRODUCT_TYPES = {"metho", "metho_vegetable"}


def _is_metho_qualified_item(item: dict | None) -> bool:
    return str((item or {}).get("product_type") or "metho").strip().lower() in METHO_QUALIFIED_PRODUCT_TYPES


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


def _partner_unit_info(unit_map: dict[str, dict], product_id: str) -> dict:
    meta = unit_map.get(str(product_id)) if isinstance(unit_map, dict) else None
    unit_type = _normalize_partner_unit_type((meta or {}).get("unit_type"))
    step = _normalize_partner_quantity_step(unit_type, (meta or {}).get("quantity_step"))
    return {
        "unit_type": unit_type,
        "unit_label": unit_type,
        "quantity_step": step,
    }


def _round_quantity_to_step(value: float, step: float) -> float:
    safe_step = max(0.01, float(step or 1.0))
    units = round(float(value or 0) / safe_step)
    rounded = units * safe_step
    return round(max(safe_step, rounded), 4)


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


def _read_validated_image_upload(file: UploadFile, max_bytes: int = GLOBAL_IMAGE_MAX_UPLOAD_BYTES) -> tuple[str, bytes, str]:
    ext = Path(file.filename or "upload.jpg").suffix.lower() or ".jpg"
    allowed = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
    }
    mime = allowed.get(ext)
    if not mime:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    content = file.file.read()
    if len(content) > max(1, int(max_bytes or 0)):
        kb = max(1, int(max_bytes // 1024))
        raise HTTPException(status_code=400, detail=f"File too large (max {kb}KB)")
    return ext, content, mime


def _save_image_upload_with_pdf_copy(file: UploadFile, target_dir: Path, prefix: str, max_bytes: int = UPI_PROOF_MAX_UPLOAD_BYTES) -> tuple[str, str]:
    """Save original image and, when possible, an additional auto-generated PDF copy."""
    ext = Path(file.filename or f"{prefix}.jpg").suffix.lower() or ".jpg"
    if ext not in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"}:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    content = file.file.read()
    if len(content) > max(1, int(max_bytes or 0)):
        mb = max(1, round(max_bytes / (1024 * 1024)))
        raise HTTPException(status_code=400, detail=f"File too large (max {mb}MB)")

    base_name = f"{prefix}-{uuid.uuid4().hex}"
    image_name = f"{base_name}{ext}"
    image_path = target_dir / image_name
    image_path.write_bytes(content)

    pdf_name = ""
    try:
        with Image.open(BytesIO(content)) as img:
            rgb = img.convert("RGB")
            pdf_name = f"{base_name}.pdf"
            pdf_path = target_dir / pdf_name
            rgb.save(pdf_path, format="PDF")
    except Exception:
        pdf_name = ""

    return image_name, pdf_name


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


def _normalize_customer_phone(raw: str | None) -> str:
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[-10:]
    if len(digits) == 10:
        return f"91{digits}"
    if len(digits) > 12:
        return digits[-12:]
    return digits


def _phone_local10(normalized: str) -> str:
    text = str(normalized or "").strip()
    return text[-10:] if len(text) >= 10 else text


def _customer_access_secret(settings: dict | None) -> bytes:
    env_secret = str(os.getenv("CUSTOMER_ORDER_ACCESS_SECRET") or "").strip()
    configured_secret = str((settings or {}).get("customer_order_access_secret") or "").strip()
    fallback = f"{ADMIN_LOGIN_ID}|customer-mobile-access"
    return (env_secret or configured_secret or fallback).encode("utf-8")


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def _b64url_decode(text: str) -> bytes:
    safe = str(text or "").strip()
    pad = "=" * ((4 - len(safe) % 4) % 4)
    return base64.urlsafe_b64decode((safe + pad).encode("utf-8"))


def _issue_customer_access_token(phone: str, settings: dict | None) -> tuple[str, int]:
    session_minutes = int((settings or {}).get("customer_order_session_minutes") or 720)
    session_minutes = max(5, min(10080, session_minutes))
    exp_ts = int((datetime.now(timezone.utc) + timedelta(minutes=session_minutes)).timestamp())
    payload = {
        "phone": str(phone or "").strip(),
        "exp": exp_ts,
        "kind": "customer_mobile_access_v1",
    }
    payload_text = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    encoded = _b64url_encode(payload_text.encode("utf-8"))
    secret = _customer_access_secret(settings)
    signature = hmac.new(secret, encoded.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{encoded}.{signature}", exp_ts


def _verify_customer_access_token(token: str, settings: dict | None) -> str:
    raw = str(token or "").strip()
    if "." not in raw:
        raise HTTPException(status_code=401, detail="Invalid access token")
    encoded, provided_sig = raw.split(".", 1)
    expected_sig = hmac.new(
        _customer_access_secret(settings),
        encoded.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected_sig, provided_sig):
        raise HTTPException(status_code=401, detail="Invalid access token")
    try:
        payload = json.loads(_b64url_decode(encoded).decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid access token")

    exp_ts = int(payload.get("exp") or 0)
    if exp_ts <= int(datetime.now(timezone.utc).timestamp()):
        raise HTTPException(status_code=401, detail="Access token expired")
    phone = _normalize_customer_phone(payload.get("phone") or "")
    if len(phone) < 10:
        raise HTTPException(status_code=401, detail="Invalid access token")
    return phone


def _customer_otp_key(phone: str) -> str:
    return f"{CUSTOMER_ORDER_OTP_KEY_PREFIX}{str(phone or '').strip()}"


def _hash_customer_otp(phone: str, otp: str, settings: dict | None) -> str:
    secret = _customer_access_secret(settings)
    text = f"{phone}|{otp}".encode("utf-8")
    return hmac.new(secret, text, hashlib.sha256).hexdigest()


def _save_customer_otp_state(db: Session, phone: str, state: dict) -> None:
    key = _customer_otp_key(phone)
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row:
        row = AppSetting(key=key, value_json=json.dumps(state or {}), updated_at=datetime.now(timezone.utc))
        db.add(row)
    else:
        row.value_json = json.dumps(state or {})
        row.updated_at = datetime.now(timezone.utc)
    db.commit()


def _load_customer_otp_state(db: Session, phone: str) -> dict:
    key = _customer_otp_key(phone)
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row:
        return {}
    try:
        payload = json.loads(row.value_json or "{}")
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _delete_setting_key(db: Session, key: str) -> None:
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if row:
        db.delete(row)
        db.commit()


def _find_public_order_ids_by_phone(db: Session, phone: str, scan_limit: int = 5000) -> list[str]:
    normalized = _normalize_customer_phone(phone)
    local10 = _phone_local10(normalized)
    if len(local10) < 10:
        return []

    rows = (
        db.query(AppSetting)
        .filter(AppSetting.key.like(f"{CUSTOMER_ORDER_CONTACT_KEY_PREFIX}%"))
        .order_by(AppSetting.updated_at.desc())
        .limit(max(100, int(scan_limit)))
        .all()
    )

    out: list[str] = []
    seen = set()
    for row in rows:
        key = str(row.key or "")
        if not key.startswith(CUSTOMER_ORDER_CONTACT_KEY_PREFIX):
            continue
        order_id = key[len(CUSTOMER_ORDER_CONTACT_KEY_PREFIX):].strip()
        if not order_id or order_id in seen:
            continue
        try:
            payload = json.loads(row.value_json or "{}")
        except Exception:
            payload = {}
        payload_obj = payload or {}
        stored = _normalize_customer_phone(
            payload_obj.get("phone")
            or payload_obj.get("customer_phone")
            or payload_obj.get("delivery_phone")
            or ""
        )
        if not stored:
            continue
        if stored == normalized or _phone_local10(stored) == local10:
            seen.add(order_id)
            out.append(order_id)
    return out


def _serialize_public_order_list_row(row: PublicOrder, db: Session | None = None) -> dict:
    try:
        items = json.loads(row.items_json or "[]")
    except Exception:
        items = []
    metho_amount = sum(float(i.get("subtotal") or 0) for i in items if _is_metho_qualified_item(i))
    associate_amount = sum(float(i.get("subtotal") or 0) for i in items if not _is_metho_qualified_item(i))
    tourism_guide = _load_tourism_guide_assignment(db, row.id) if db and any(str(i.get("service_template_key") or "").lower() == "tourism_booking" for i in items) else {}
    contact_phone = _load_order_contact_phone_for_order(db, row.id) if db else ""
    buyer = db.query(User).filter(User.id == row.customer_user_id).first() if db and row.customer_user_id else None
    return {
        "id": row.id,
        "order_no": f"ORD-{row.id[:8].upper()}",
        "status": row.status,
        "created_at": row.created_at.isoformat() if row.created_at else now_iso(),
        "shipping_address": row.shipping_address,
        "txn_id": row.txn_id,
        "payment_screenshot_url": row.payment_screenshot_url,
        "payer_name": row.payer_name,
        "customer_name": row.payer_name or (buyer.name if buyer else ""),
        "customer_phone": contact_phone or (buyer.phone if buyer else ""),
        "member_code": member_code_for_user(buyer.id) if buyer and str(buyer.role or "").lower() == "member" else row.member_ref,
        "items": [
            {
                "product_id": i.get("product_id"),
                "product_code": i.get("product_code") or "",
                "product_name": i.get("name"),
                "quantity": i.get("quantity", 1),
                "price": float(i.get("price") or 0),
                "subtotal": float(i.get("subtotal") or 0),
                "product_type": i.get("product_type") or "metho",
                "unit_type": i.get("unit_type") or "piece",
                "unit_label": i.get("unit_label") or i.get("unit_type") or "piece",
            }
            for i in items
        ],
        "total_amount": float(row.total_amount or 0),
        "metho_amount": round(metho_amount, 2),
        "associate_amount": round(associate_amount, 2),
        "rejection_reason": "",
        "tourism_guide": tourism_guide or None,
    }


def _ensure_customer_order_access(db: Session, order_id: str, phone: str) -> PublicOrder:
    oid = str(order_id or "").strip()
    if not oid:
        raise HTTPException(status_code=400, detail="Order id is required")
    row = db.query(PublicOrder).filter(PublicOrder.id == oid).first()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")

    allowed_ids = set(_find_public_order_ids_by_phone(db, phone, scan_limit=10000))
    if oid not in allowed_ids:
        raise HTTPException(status_code=403, detail="Order does not belong to this mobile number")
    return row


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


def _user_wallet_key(user_id: str) -> str:
    return f"user_wallet:{user_id}"


def _member_purchase_activation_key(user_id: str) -> str:
    return f"member_purchase_activation:{user_id}"


def _withdrawals_key() -> str:
    return "member_withdrawals"


def _reward_pool_key(period: str) -> str:
    return f"reward_pool:{period}"


USER_WALLET_DEFAULTS = {
    "balance": 0.0,
    "total_income": 0.0,
    "total_bonus": 0.0,
    "total_withdrawn": 0.0,
    "member_reward_credited": 0.0,
    "leader_reward_credited": 0.0,
    "mps_fund_payout": 0.0,
}


def _load_json_setting(db: Session, key: str, default):
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row:
        return default.copy() if isinstance(default, dict) else default
    try:
        value = json.loads(row.value_json or "")
    except Exception:
        value = default
    return value if isinstance(value, type(default)) else default


def _save_json_setting(db: Session, key: str, value) -> None:
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    payload = json.dumps(value)
    if not row:
        db.add(AppSetting(key=key, value_json=payload, updated_at=datetime.now(timezone.utc)))
    else:
        row.value_json = payload
        row.updated_at = datetime.now(timezone.utc)


def _load_user_wallet(db: Session, user_id: str) -> dict:
    wallet = _load_json_setting(db, _user_wallet_key(user_id), USER_WALLET_DEFAULTS)
    return {key: round(float(wallet.get(key) or 0), 2) for key in USER_WALLET_DEFAULTS}


def _save_user_wallet(db: Session, user_id: str, wallet: dict) -> dict:
    normalized = {key: round(float(wallet.get(key) or 0), 2) for key in USER_WALLET_DEFAULTS}
    _save_json_setting(db, _user_wallet_key(user_id), normalized)
    return normalized


def _member_purchase_active(db: Session, user_id: str) -> bool:
    return bool(_load_json_setting(db, _member_purchase_activation_key(user_id), {}).get("active"))


def _member_payment_state_key(user_id: str) -> str:
    return f"member_payment_state:{user_id}"


def _set_member_payment_state(db: Session, user_id: str, state: str, payment_method: str = "", order_id: str = "", verified_by: str = "") -> dict:
    current = _load_json_setting(db, _member_payment_state_key(user_id), {})
    current.update({
        "approval_status": "approved" if state == "paid" else "pending",
        "payment_status": state,
        "payment_method": str(payment_method or current.get("payment_method") or "").lower(),
        "order_id": str(order_id or current.get("order_id") or ""),
    })
    if state == "paid":
        current["verified_at"] = now_iso()
        if verified_by:
            current["verified_by"] = verified_by
    _save_json_setting(db, _member_payment_state_key(user_id), current)
    return current


def _activate_member_purchase(db: Session, user: User | None, order_id: str, source: str) -> bool:
    if not user or str(user.role or "") != "member" or _member_purchase_active(db, user.id):
        return False
    user.is_active = True
    _save_json_setting(db, _member_purchase_activation_key(user.id), {
        "active": True,
        "activated_at": now_iso(),
        "activation_order_id": str(order_id or ""),
        "payment_source": str(source or "admin_approved"),
    })
    _set_member_payment_state(db, user.id, "paid", source, order_id)
    db.commit()
    return True


def _withdrawal_rates(db: Session) -> tuple[float, float]:
    settings = load_settings(db)
    tds_percent = max(0.0, min(100.0, float(settings.get("withdrawal_tds_percent") or 5)))
    admin_percent = max(0.0, min(100.0, float(settings.get("withdrawal_admin_charge_percent") or 3)))
    return tds_percent, admin_percent


def _load_withdrawals(db: Session) -> list[dict]:
    rows = _load_json_setting(db, _withdrawals_key(), [])
    return rows if isinstance(rows, list) else []


def _save_withdrawals(db: Session, rows: list[dict]) -> None:
    _save_json_setting(db, _withdrawals_key(), rows[:500])


def _period_for_datetime(value) -> str:
    current = value or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone(timezone.utc).strftime("%Y-%m")


def _order_member(db: Session, order: PublicOrder):
    if order.customer_user_id:
        return db.query(User).filter(User.id == order.customer_user_id).first()
    ref = str(order.member_ref or "").strip().upper()
    if not ref:
        return None
    # Current member ids equal their member_code directly (MAU-prefixed), so this indexed
    # lookup avoids a full user-table scan for the common case; only legacy non-MAU ids
    # (where member_code_for_user derives a different code) fall through to the scan below.
    if ref.startswith("MAU"):
        direct = db.query(User).filter(User.id == ref).first()
        if direct:
            return direct
    for candidate in db.query(User).all():
        if member_code_for_user(candidate.id).upper() == ref:
            return candidate
    return None


def _approved_member_purchases(db: Session, user_id: str, period: str | None = None) -> list[dict]:
    rows = db.query(PublicOrder).filter(PublicOrder.status == "paid").order_by(PublicOrder.created_at.asc()).all()
    out = []
    for order in rows:
        member = _order_member(db, order)
        if not member or member.id != user_id or (period and _period_for_datetime(order.created_at) != period):
            continue
        try:
            items = json.loads(order.items_json or "[]")
        except Exception:
            items = []
        metho_sales = round(sum(float(item.get("subtotal") or 0) for item in items if _is_metho_qualified_item(item)), 2)
        if metho_sales > 0:
            out.append({"order": order, "metho_sales": metho_sales})
    return out


SMART_CYCLE_SLOT_DAYS = 7
SMART_CYCLE_TOTAL_SLOTS = 5


def _smart_cycle_state_key(user_id: str) -> str:
    return f"smart_cycle_v2:{user_id}"


def _smart_cycle_history_key(user_id: str) -> str:
    return f"smart_cycle_v2_history:{user_id}"


def _smart_cycle_match_history_key(user_id: str) -> str:
    return f"smart_cycle_v2_matches:{user_id}"


def _parse_cycle_datetime(value) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def _metho_sale_excluding_gst(item: dict) -> float:
    if not _is_metho_qualified_item(item):
        return 0.0
    subtotal = max(0.0, float(item.get("pre_tax") or item.get("subtotal") or 0))
    if item.get("pre_tax") is not None:
        return round(subtotal, 2)
    gst_percent = max(0.0, float(item.get("gst_percent") or 0))
    return round(subtotal / (1 + (gst_percent / 100.0)), 2) if gst_percent > 0 else round(subtotal, 2)


def _metho_cycle_commission(item: dict, default_rate: float) -> float:
    try:
        rate = float(item.get("commission_percent")) if item.get("commission_percent") is not None else default_rate
    except (TypeError, ValueError):
        rate = default_rate
    return round(_metho_sale_excluding_gst(item) * max(0.0, min(100.0, rate)) / 100.0, 2)


def _member_has_approved_metho_sale(db: Session, user_id: str) -> bool:
    return any(_approved_member_purchases(db, user_id))


def _descendant_member_ids(db: Session, owner_id: str) -> set[str]:
    children: dict[str, list[str]] = {}
    for relation in db.query(UserReferral).all():
        children.setdefault(str(relation.sponsor_user_id), []).append(str(relation.user_id))
    seen: set[str] = set()
    queue = list(children.get(str(owner_id), []))
    while queue:
        member_id = queue.pop(0)
        if member_id in seen:
            continue
        seen.add(member_id)
        queue.extend(children.get(member_id, []))
    return seen


def _smart_cycle_network_sale(db: Session, owner_id: str, slot_start: datetime, slot_end: datetime) -> tuple[float, int]:
    eligible_ids = {str(owner_id)} | _descendant_member_ids(db, owner_id)
    active_ids = {member_id for member_id in eligible_ids if _member_has_approved_metho_sale(db, member_id)}
    sale_total = 0.0
    order_count = 0
    for order in db.query(PublicOrder).filter(PublicOrder.status == "paid").all():
        created_at = order.created_at.replace(tzinfo=timezone.utc) if order.created_at and order.created_at.tzinfo is None else order.created_at
        if not created_at or created_at < slot_start or created_at >= slot_end:
            continue
        member = _order_member(db, order)
        if not member or str(member.id) not in active_ids:
            continue
        try:
            items = json.loads(order.items_json or "[]")
        except Exception:
            items = []
        amount = round(sum(_metho_sale_excluding_gst(item) for item in items), 2)
        if amount > 0:
            sale_total += amount
            order_count += 1
    return round(sale_total, 2), order_count


def _smart_cycle_network_commission(db: Session, owner_id: str, slot_start: datetime, slot_end: datetime, default_rate: float) -> float:
    eligible_ids = {str(owner_id)} | _descendant_member_ids(db, owner_id)
    active_ids = {member_id for member_id in eligible_ids if _member_has_approved_metho_sale(db, member_id)}
    total = 0.0
    for order in db.query(PublicOrder).filter(PublicOrder.status == "paid").all():
        created_at = order.created_at.replace(tzinfo=timezone.utc) if order.created_at and order.created_at.tzinfo is None else order.created_at
        if not created_at or created_at < slot_start or created_at >= slot_end:
            continue
        member = _order_member(db, order)
        if not member or str(member.id) not in active_ids:
            continue
        try:
            items = json.loads(order.items_json or "[]")
        except Exception:
            items = []
        total += sum(_metho_cycle_commission(item, default_rate) for item in items)
    return round(total, 2)


def _load_smart_cycle_history(db: Session, user_id: str) -> list[dict]:
    history = _load_json_setting(db, _smart_cycle_history_key(user_id), [])
    return history if isinstance(history, list) else []


def _settle_completed_smart_cycles(db: Session, user_id: str, now: datetime | None = None) -> dict | None:
    now = now or datetime.now(timezone.utc)
    if not _member_has_approved_metho_sale(db, user_id):
        return None
    state = _load_json_setting(db, _smart_cycle_state_key(user_id), {})
    if not state:
        first_sale = min((entry["order"].created_at for entry in _approved_member_purchases(db, user_id)), default=now)
        first_sale = first_sale.replace(tzinfo=timezone.utc) if first_sale and first_sale.tzinfo is None else first_sale
        state = {"cycle_number": 1, "started_at": first_sale.isoformat(), "activated_at": first_sale.isoformat()}

    cycle_start = _parse_cycle_datetime(state.get("started_at"))
    cycle_number = max(1, int(state.get("cycle_number") or 1))
    cycle_seconds = SMART_CYCLE_SLOT_DAYS * SMART_CYCLE_TOTAL_SLOTS * 86400
    history = _load_smart_cycle_history(db, user_id)
    latest = None

    while now >= cycle_start + timedelta(seconds=cycle_seconds):
        slot_five_start = cycle_start + timedelta(days=SMART_CYCLE_SLOT_DAYS * 4)
        cycle_end = cycle_start + timedelta(seconds=cycle_seconds)
        eligible_sale, order_count = _smart_cycle_network_sale(db, user_id, slot_five_start, cycle_end)
        settings = load_settings(db)
        bonus_percent = max(0.0, float(settings.get("smart_cycle_bonus_percent") or 0))
        leader_match_percent = max(0.0, min(100.0, float(settings.get("leader_match_percent") or 0)))
        commission = _smart_cycle_network_commission(db, user_id, slot_five_start, cycle_end, bonus_percent)
        match_paid = 0.0
        if commission > 0:
            wallet = _load_user_wallet(db, user_id)
            wallet["balance"] += commission
            wallet["total_income"] += commission
            wallet["total_bonus"] += commission
            wallet["member_reward_credited"] += commission
            _save_user_wallet(db, user_id, wallet)
            relation = db.query(UserReferral).filter(UserReferral.user_id == user_id).first()
            if relation:
                match_paid = round(commission * leader_match_percent / 100.0, 2)
                sponsor_wallet = _load_user_wallet(db, relation.sponsor_user_id)
                sponsor_wallet["balance"] += match_paid
                sponsor_wallet["total_income"] += match_paid
                sponsor_wallet["total_bonus"] += match_paid
                sponsor_wallet["leader_reward_credited"] += match_paid
                _save_user_wallet(db, relation.sponsor_user_id, sponsor_wallet)
                sponsor_matches = _load_json_setting(db, _smart_cycle_match_history_key(relation.sponsor_user_id), [])
                sponsor_matches.insert(0, {
                    "from_member_id": user_id,
                    "from_cycle_number": cycle_number,
                    "amount": match_paid,
                    "source_commission": commission,
                    "paid_at": cycle_end.isoformat(),
                })
                _save_json_setting(db, _smart_cycle_match_history_key(relation.sponsor_user_id), sponsor_matches[:100])

        latest = {
            "cycle_number": cycle_number,
            "started_at": cycle_start.isoformat(),
            "ended_at": cycle_end.isoformat(),
            "slot_five_started_at": slot_five_start.isoformat(),
            "eligible_network_sale_excluding_gst": eligible_sale,
            "slot_five_order_count": order_count,
            "bonus_percent": bonus_percent,
            "bonus_paid": commission,
            "direct_sponsor_match_paid": match_paid,
            "status": "settled",
        }
        history.insert(0, latest)
        cycle_number += 1
        cycle_start = cycle_end

    state = {"cycle_number": cycle_number, "started_at": cycle_start.isoformat(), "activated_at": state.get("activated_at") or cycle_start.isoformat()}
    _save_json_setting(db, _smart_cycle_state_key(user_id), state)
    _save_json_setting(db, _smart_cycle_history_key(user_id), history[:100])
    return latest


def _sql_member_rank(db: Session, user_id: str, period: str | None = None) -> str:
    period = period or datetime.now(timezone.utc).strftime("%Y-%m")
    amount = round(sum(item["metho_sales"] for item in _approved_member_purchases(db, user_id, period)), 2)
    settings = load_settings(db)
    if amount >= float(settings.get("rank_diamond_bv") or 100000):
        return "Diamond"
    if amount >= float(settings.get("rank_gold_bv") or 50000):
        return "Gold"
    if amount >= float(settings.get("rank_silver_bv") or 20000):
        return "Silver"
    if amount >= float(settings.get("rank_bronze_bv") or 5000):
        return "Bronze"
    return "Starter"


def _reward_pool_snapshot(db: Session, period: str) -> dict:
    return _load_json_setting(db, _reward_pool_key(period), {
        "commission_pool": 0.0, "member_pool": 0.0, "leader_pool": 0.0,
        "mps_fund": 0.0, "company_fund": 0.0, "technology_reserve": 0.0,
        "gross_sales": 0.0,
    })


def _calculate_sql_pool(db: Session, period: str) -> dict:
    settings = load_settings(db)
    totals = {"gross_sales": 0.0, "commission_pool": 0.0, "member_pool": 0.0, "leader_pool": 0.0, "mps_fund": 0.0, "company_fund": 0.0, "technology_reserve": 0.0}
    split = {
        "member_pool": float(settings.get("commission_split_member_pool") or 0),
        "leader_pool": float(settings.get("commission_split_leader_pool") or 0),
        "mps_fund": float(settings.get("commission_split_mps_fund") or 0),
        "company_fund": float(settings.get("commission_split_company_fund") or 0),
        "technology_reserve": float(settings.get("commission_split_technology_reserve") or 0),
    }
    for order in db.query(PublicOrder).filter(PublicOrder.status == "paid").all():
        if _period_for_datetime(order.created_at) != period:
            continue
        try:
            items = json.loads(order.items_json or "[]")
        except Exception:
            items = []
        commission = 0.0
        for item in items:
            if _is_metho_qualified_item(item):
                subtotal = max(0.0, float(item.get("pre_tax") or item.get("subtotal") or 0))
                try:
                    rate = float(item.get("commission_percent")) if item.get("commission_percent") is not None else float(settings.get("metho_commission_percent") or 10)
                except (TypeError, ValueError):
                    rate = float(settings.get("metho_commission_percent") or 10)
            else:
                subtotal = max(0.0, float(item.get("subtotal") or 0))
                partner_product = db.query(PartnerProduct).filter(PartnerProduct.id == str(item.get("product_id") or "")).first()
                partner = db.query(AssociatePartner).filter(AssociatePartner.id == partner_product.partner_id).first() if partner_product else None
                rate = float(partner.commission_percent or 0) if partner else 0
            totals["gross_sales"] += subtotal
            commission += subtotal * max(0.0, min(100.0, rate)) / 100.0
        totals["commission_pool"] += commission
    totals["commission_pool"] = round(totals["commission_pool"], 2)
    totals["gross_sales"] = round(totals["gross_sales"], 2)
    for key, percent in split.items():
        totals[key] = round(totals["commission_pool"] * percent / 100.0, 2)
    return totals


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


def _partner_checkout_pref_key(partner_id: str) -> str:
    return f"partner_checkout_pref:{partner_id}"


def _normalize_category_delivery_rules(value) -> dict:
    if not isinstance(value, dict):
        return {}
    normalized = {}
    for category, rule in value.items():
        name = str(category or "").strip()
        if not name or not isinstance(rule, dict):
            continue
        normalized[name] = {
            "delivery_charge": max(0.0, float(rule.get("delivery_charge") or 0)),
            "free_delivery_threshold": max(0.0, float(rule.get("free_delivery_threshold") or 0)),
        }
    return normalized


def _partner_offer_popup_key(partner_id: str) -> str:
    return f"partner_offer_popup:{partner_id}"


def _partner_business_youtube_key(partner_id: str) -> str:
    return f"partner_business_youtube:{partner_id}"


def _partner_business_facebook_key(partner_id: str) -> str:
    return f"partner_business_facebook:{partner_id}"


def _load_partner_business_youtube(db: Session, partner_id: str) -> str:
    row = db.query(AppSetting).filter(AppSetting.key == _partner_business_youtube_key(partner_id)).first()
    if not row:
        return ""
    try:
        payload = json.loads(row.value_json or "{}")
    except Exception:
        payload = {}
    return str(payload.get("youtube_url") or "").strip()


def _save_partner_business_youtube(db: Session, partner_id: str, youtube_url: str) -> str:
    normalized = str(youtube_url or "").strip()
    payload = {"youtube_url": normalized, "updated_at": now_iso()}
    row = db.query(AppSetting).filter(AppSetting.key == _partner_business_youtube_key(partner_id)).first()
    if not row:
        row = AppSetting(key=_partner_business_youtube_key(partner_id), value_json="{}")
        db.add(row)
    row.value_json = json.dumps(payload)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return normalized


def _load_partner_business_facebook(db: Session, partner_id: str) -> str:
    row = db.query(AppSetting).filter(AppSetting.key == _partner_business_facebook_key(partner_id)).first()
    if not row:
        return ""
    try:
        payload = json.loads(row.value_json or "{}")
    except Exception:
        payload = {}
    return str(payload.get("facebook_url") or "").strip()


def _save_partner_business_facebook(db: Session, partner_id: str, facebook_url: str) -> str:
    normalized = str(facebook_url or "").strip()
    payload = {"facebook_url": normalized, "updated_at": now_iso()}
    row = db.query(AppSetting).filter(AppSetting.key == _partner_business_facebook_key(partner_id)).first()
    if not row:
        row = AppSetting(key=_partner_business_facebook_key(partner_id), value_json="{}")
        db.add(row)
    row.value_json = json.dumps(payload)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return normalized


def _normalize_partner_offer_popup(payload: dict | None, current: dict | None = None) -> dict:
    base = current or {}
    src = payload or {}
    return {
        "enabled": bool(src.get("enabled", base.get("enabled", False))),
        "title": str(src.get("title", base.get("title", "")) or "").strip()[:120],
        "message": str(src.get("message", base.get("message", "")) or "").strip()[:600],
        "cta_text": str(src.get("cta_text", base.get("cta_text", "")) or "").strip()[:60],
        "coupon_code": str(src.get("coupon_code", base.get("coupon_code", "")) or "").strip()[:60],
    }


def _load_partner_offer_popup(db: Session, partner_id: str) -> dict:
    defaults = {
        "enabled": False,
        "title": "",
        "message": "",
        "cta_text": "",
        "coupon_code": "",
    }
    row = db.query(AppSetting).filter(AppSetting.key == _partner_offer_popup_key(partner_id)).first()
    if not row:
        return defaults
    try:
        payload = json.loads(row.value_json or "{}")
        if not isinstance(payload, dict):
            return defaults
        return _normalize_partner_offer_popup(payload, defaults)
    except Exception:
        return defaults


def _save_partner_offer_popup(db: Session, partner_id: str, payload: dict | None) -> dict:
    current = _load_partner_offer_popup(db, partner_id)
    next_payload = _normalize_partner_offer_popup(payload, current)
    row = db.query(AppSetting).filter(AppSetting.key == _partner_offer_popup_key(partner_id)).first()
    if not row:
        row = AppSetting(key=_partner_offer_popup_key(partner_id), value_json="{}")
        db.add(row)
    row.value_json = json.dumps(next_payload)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return next_payload


def _load_partner_checkout_pref(db: Session, partner_id: str) -> dict:
    defaults = {
        "cod_enabled": True,
        "delivery_state": "",
        "delivery_district": "",
        "delivery_city": "",
        "delivery_pincode": "",
        "delivery_radius_km": 0,
        "slot_suggestion_interval_minutes": 30,
        "category_delivery_rules": {},
    }
    key = _partner_checkout_pref_key(partner_id)
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row:
        return defaults
    try:
        payload = json.loads(row.value_json or "{}")
        if not isinstance(payload, dict):
            return defaults
        return {
            "cod_enabled": bool(payload.get("cod_enabled", True)),
            "delivery_state": str(payload.get("delivery_state") or "").strip(),
            "delivery_district": str(payload.get("delivery_district") or "").strip(),
            "delivery_city": str(payload.get("delivery_city") or "").strip(),
            "delivery_pincode": str(payload.get("delivery_pincode") or "").strip(),
            "delivery_radius_km": max(0, int(payload.get("delivery_radius_km") or 0)),
            "slot_suggestion_interval_minutes": max(5, min(180, int(payload.get("slot_suggestion_interval_minutes") or 30))),
            "category_delivery_rules": _normalize_category_delivery_rules(payload.get("category_delivery_rules")),
        }
    except Exception:
        return defaults


def _save_partner_checkout_pref(db: Session, partner_id: str, payload: dict | None) -> dict:
    current = _load_partner_checkout_pref(db, partner_id)
    incoming = payload or {}
    next_payload = {
        "cod_enabled": bool(incoming.get("cod_enabled", current.get("cod_enabled", True))),
        "delivery_state": str(incoming.get("delivery_state") if incoming.get("delivery_state") is not None else current.get("delivery_state", "")).strip(),
        "delivery_district": str(incoming.get("delivery_district") if incoming.get("delivery_district") is not None else current.get("delivery_district", "")).strip(),
        "delivery_city": str(incoming.get("delivery_city") if incoming.get("delivery_city") is not None else current.get("delivery_city", "")).strip(),
        "delivery_pincode": str(incoming.get("delivery_pincode") if incoming.get("delivery_pincode") is not None else current.get("delivery_pincode", "")).strip(),
        "delivery_radius_km": max(0, int(incoming.get("delivery_radius_km") if incoming.get("delivery_radius_km") is not None else current.get("delivery_radius_km", 0))),
        "slot_suggestion_interval_minutes": max(5, min(180, int(incoming.get("slot_suggestion_interval_minutes") if incoming.get("slot_suggestion_interval_minutes") is not None else current.get("slot_suggestion_interval_minutes", 30)))),
        "category_delivery_rules": _normalize_category_delivery_rules(incoming.get("category_delivery_rules") if incoming.get("category_delivery_rules") is not None else current.get("category_delivery_rules", {})),
    }
    key = _partner_checkout_pref_key(partner_id)
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row:
        row = AppSetting(key=key, value_json="{}")
        db.add(row)
    row.value_json = json.dumps(next_payload)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return next_payload


def _purge_partner_related_records(db: Session, partner: AssociatePartner) -> None:
    partner_id = str(getattr(partner, "id", "") or "").strip()
    login_id = str(getattr(partner, "email", "") or "").strip()
    phone = str(getattr(partner, "phone", "") or "").strip()
    gst_no = str(getattr(partner, "gst_no", "") or "").strip()

    if partner_id:
        partner_product_ids = [
            str(row[0])
            for row in db.query(PartnerProduct.id).filter(PartnerProduct.partner_id == partner_id).all()
            if row and row[0]
        ]

        if partner_product_ids:
            units_row = db.query(AppSetting).filter(AppSetting.key == PARTNER_PRODUCT_UNITS_KEY).first()
            if units_row:
                try:
                    units_doc = json.loads(units_row.value_json or "{}")
                except Exception:
                    units_doc = {}
                if isinstance(units_doc, dict):
                    units_changed = False
                    for product_id in partner_product_ids:
                        if units_doc.pop(product_id, None) is not None:
                            units_changed = True
                    if units_changed:
                        units_row.value_json = json.dumps(units_doc)
                        units_row.updated_at = datetime.now(timezone.utc)

            meta_row = db.query(AppSetting).filter(AppSetting.key == PARTNER_PRODUCT_META_KEY).first()
            if meta_row:
                try:
                    meta_doc = json.loads(meta_row.value_json or "{}")
                except Exception:
                    meta_doc = {}
                if isinstance(meta_doc, dict):
                    meta_changed = False
                    for product_id in partner_product_ids:
                        if meta_doc.pop(product_id, None) is not None:
                            meta_changed = True
                    if meta_changed:
                        meta_row.value_json = json.dumps(meta_doc)
                        meta_row.updated_at = datetime.now(timezone.utc)

        db.query(PartnerProduct).filter(PartnerProduct.partner_id == partner_id).delete(synchronize_session=False)
        db.query(AppSetting).filter(
            AppSetting.key.in_(
                [
                    _partner_wallet_key(partner_id),
                    _partner_wallet_tx_key(partner_id),
                    _partner_topup_qr_key(partner_id),
                    _partner_payment_qr_key(partner_id),
                    _partner_banner_key(partner_id),
                    _partner_checkout_pref_key(partner_id),
                    _partner_offer_popup_key(partner_id),
                    _partner_business_youtube_key(partner_id),
                    _partner_business_facebook_key(partner_id),
                    _partner_featured_images_key(partner_id),
                    _transport_fare_presets_key(partner_id),
                ]
            )
        ).delete(synchronize_session=False)

        partner_topup_rows = db.query(AppSetting).filter(AppSetting.key.like("partner_topup:%")).all()
        topup_keys_to_delete = []
        for row in partner_topup_rows:
            try:
                doc = json.loads(row.value_json or "{}")
            except Exception:
                continue
            if str(doc.get("partner_id") or "").strip() == partner_id:
                topup_keys_to_delete.append(row.key)
        if topup_keys_to_delete:
            db.query(AppSetting).filter(AppSetting.key.in_(topup_keys_to_delete)).delete(synchronize_session=False)

        transport_rows = db.query(AppSetting).filter(AppSetting.key.like("transport_trip:%")).all()
        transport_keys_to_delete = []
        for row in transport_rows:
            try:
                doc = json.loads(row.value_json or "{}")
            except Exception:
                continue
            if str(doc.get("partner_id") or "").strip() == partner_id:
                transport_keys_to_delete.append(row.key)
        if transport_keys_to_delete:
            db.query(AppSetting).filter(AppSetting.key.in_(transport_keys_to_delete)).delete(synchronize_session=False)

        driver_rows = db.query(AppSetting).filter(AppSetting.key.like("partner_driver:%")).all()
        driver_keys_to_delete = []
        for row in driver_rows:
            try:
                doc = json.loads(row.value_json or "{}")
            except Exception:
                continue
            if str(doc.get("partner_id") or "") == partner_id:
                driver_keys_to_delete.append(row.key)
        if driver_keys_to_delete:
            db.query(AppSetting).filter(AppSetting.key.in_(driver_keys_to_delete)).delete(synchronize_session=False)

    if login_id:
        db.query(User).filter(User.email == login_id, User.role == "partner").delete(synchronize_session=False)

    related_requests = []
    if login_id:
        related_requests.extend(db.query(PartnerRequest).filter(PartnerRequest.email == login_id).all())
    if phone:
        related_requests.extend(db.query(PartnerRequest).filter(PartnerRequest.phone == phone).all())
    if gst_no:
        related_requests.extend(db.query(PartnerRequest).filter(PartnerRequest.gst_no == gst_no).all())

    seen_request_ids = set()
    for request in related_requests:
        request_id = str(getattr(request, "id", "") or "").strip()
        if not request_id or request_id in seen_request_ids:
            continue
        seen_request_ids.add(request_id)
        db.query(AppSetting).filter(
            AppSetting.key.in_([f"partner_req_creds:{request_id}", f"partner_req_kyc:{request_id}"])
        ).delete(synchronize_session=False)
        db.delete(request)


def _partner_featured_images_key(partner_id: str) -> str:
    return f"partner_featured_images:{partner_id}"


def _transport_trip_key(trip_id: str) -> str:
    return f"transport_trip:{trip_id}"


def _delivery_trip_key(trip_id: str) -> str:
    return f"delivery_trip:{trip_id}"


def _driver_key(driver_id: str) -> str:
    return f"partner_driver:{driver_id}"


def _load_driver(db: Session, driver_id: str) -> dict | None:
    row = db.query(AppSetting).filter(AppSetting.key == _driver_key(driver_id)).first()
    if not row:
        return None
    try:
        payload = json.loads(row.value_json or "{}")
    except Exception:
        payload = {}
    return payload if isinstance(payload, dict) else None


def _save_driver(db: Session, driver: dict) -> dict:
    driver_id = str(driver.get("id") or "").strip()
    if not driver_id:
        raise HTTPException(status_code=400, detail="Driver id missing")
    driver["updated_at"] = now_iso()
    row = db.query(AppSetting).filter(AppSetting.key == _driver_key(driver_id)).first()
    payload = json.dumps(driver)
    if row:
        row.value_json = payload
        row.updated_at = datetime.now(timezone.utc)
    else:
        db.add(AppSetting(key=_driver_key(driver_id), value_json=payload, updated_at=datetime.now(timezone.utc)))
    db.commit()
    return driver


def _list_drivers(db: Session, partner_id: str | None = None, include_unapproved: bool = False) -> list[dict]:
    rows = db.query(AppSetting).filter(AppSetting.key.like("partner_driver:%")).order_by(AppSetting.updated_at.desc()).all()
    result = []
    for row in rows:
        try:
            driver = json.loads(row.value_json or "{}")
        except Exception:
            continue
        if not isinstance(driver, dict):
            continue
        if partner_id and str(driver.get("partner_id") or "") != str(partner_id):
            continue
        if not include_unapproved and str(driver.get("approval_status") or "pending") != "approved":
            continue
        result.append(driver)
    return result


def _driver_snapshot(driver: dict) -> dict:
    return {
        "id": str(driver.get("id") or ""),
        "name": str(driver.get("name") or "Driver").strip(),
        "phone": "".join(ch for ch in str(driver.get("phone") or "") if ch.isdigit()),
        "whatsapp": "".join(ch for ch in str(driver.get("whatsapp") or driver.get("phone") or "") if ch.isdigit()),
        "vehicle_number": str(driver.get("vehicle_number") or "").strip(),
        "vehicle_type": str(driver.get("vehicle_type") or "").strip(),
        "service_sector": str(driver.get("service_sector") or "transport").strip().lower(),
        "live_location": driver.get("live_location") if isinstance(driver.get("live_location"), dict) else None,
    }


def _tourism_guide_key(order_id: str) -> str:
    return f"tourism_guide:{order_id}"


def _load_tourism_guide_assignment(db: Session, order_id: str) -> dict:
    return _load_json_setting(db, _tourism_guide_key(order_id), {})


def _save_tourism_guide_assignment(db: Session, order_id: str, guide: dict) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == _tourism_guide_key(order_id)).first()
    payload = json.dumps(guide)
    if row:
        row.value_json = payload
        row.updated_at = datetime.now(timezone.utc)
    else:
        db.add(AppSetting(key=_tourism_guide_key(order_id), value_json=payload, updated_at=datetime.now(timezone.utc)))
    db.commit()
    return guide


def _property_enquiry_key(enquiry_id: str) -> str:
    return f"property_enquiry:{enquiry_id}"


def _load_property_enquiries(db: Session, partner_id: str | None = None) -> list[dict]:
    rows = db.query(AppSetting).filter(AppSetting.key.like("property_enquiry:%")).order_by(AppSetting.updated_at.desc()).all()
    result = []
    for row in rows:
        try:
            enquiry = json.loads(row.value_json or "{}")
        except Exception:
            continue
        if not isinstance(enquiry, dict):
            continue
        if partner_id and str(enquiry.get("partner_id") or "") != str(partner_id):
            continue
        result.append(enquiry)
    return result


def _save_property_enquiry(db: Session, enquiry: dict) -> dict:
    enquiry_id = str(enquiry.get("id") or "").strip()
    row = db.query(AppSetting).filter(AppSetting.key == _property_enquiry_key(enquiry_id)).first()
    payload = json.dumps(enquiry)
    if row:
        row.value_json = payload
        row.updated_at = datetime.now(timezone.utc)
    else:
        db.add(AppSetting(key=_property_enquiry_key(enquiry_id), value_json=payload, updated_at=datetime.now(timezone.utc)))
    db.commit()
    return enquiry


@router.post("/property/enquiries")
def create_property_enquiry(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user_optional)):
    listing_id = str((payload or {}).get("listing_id") or "").strip()
    customer_phone = "".join(ch for ch in str((payload or {}).get("customer_phone") or getattr(current_user, "phone", "") or "") if ch.isdigit())
    customer_name = str((payload or {}).get("customer_name") or getattr(current_user, "name", "Customer") or "Customer").strip() or "Customer"
    message = str((payload or {}).get("message") or "").strip()
    if not listing_id or not message or not customer_phone:
        raise HTTPException(status_code=400, detail="listing_id, customer_phone, and message are required")
    listing = db.query(PartnerProduct).filter(PartnerProduct.id == listing_id, PartnerProduct.active.is_(True), PartnerProduct.approval_status == "approved").first()
    if not listing:
        raise HTTPException(status_code=404, detail="Property listing not found")
    meta = _load_partner_product_meta(db).get(str(listing.id), {})
    if str(meta.get("service_sector") or "").strip().lower() not in {"property buy & sell", "property", "real estate"}:
        raise HTTPException(status_code=400, detail="Selected listing is not a property listing")
    if str(meta.get("property_status") or "AVAILABLE").upper() in {"SOLD", "UNAVAILABLE", "INACTIVE"}:
        raise HTTPException(status_code=409, detail="Property listing is no longer available")
    partner_id = str(listing.partner_id)
    active_duplicate = next((item for item in _load_property_enquiries(db, partner_id) if str(item.get("listing_id")) == listing_id and str(item.get("customer_phone")) == customer_phone and str(item.get("status")) not in {"CLOSED", "REJECTED"}), None)
    if active_duplicate:
        return {"ok": True, "duplicate": True, "enquiry": {"id": active_duplicate["id"], "status": active_duplicate["status"]}}
    now = now_iso()
    enquiry = {
        "id": str(uuid.uuid4()),
        "listing_id": listing_id,
        "partner_id": partner_id,
        "customer_user_id": str(getattr(current_user, "id", "") or ""),
        "customer_name": customer_name,
        "customer_phone": customer_phone,
        "message": message,
        "status": "ENQUIRY_CREATED",
        "created_at": now,
        "updated_at": now,
    }
    return {"ok": True, "duplicate": False, "enquiry": _save_property_enquiry(db, enquiry)}


@router.get("/partner/property-enquiries")
def partner_property_enquiries(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")
    return _load_property_enquiries(db, str(partner.id))


@router.patch("/partner/property-enquiries/{enquiry_id}")
def update_property_enquiry(enquiry_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    enquiry = next((item for item in _load_property_enquiries(db, str(partner.id) if partner else "") if str(item.get("id")) == str(enquiry_id)), None)
    if not partner or not enquiry:
        raise HTTPException(status_code=404, detail="Property enquiry not found")
    next_status = str((payload or {}).get("status") or "").strip().upper()
    allowed = {"ENQUIRY_CREATED", "PARTNER_REVIEW", "CONTACTED", "NEGOTIATION", "CLOSED", "REJECTED"}
    if next_status not in allowed:
        raise HTTPException(status_code=400, detail="Invalid property enquiry status")
    enquiry["status"] = next_status
    enquiry["updated_at"] = now_iso()
    return {"ok": True, "enquiry": _save_property_enquiry(db, enquiry)}


def _transport_fare_presets_key(partner_id: str) -> str:
    return f"transport_fare_presets:{partner_id}"


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


def _load_partner_product_meta(db: Session) -> dict[str, dict]:
    row = db.query(AppSetting).filter(AppSetting.key == PARTNER_PRODUCT_META_KEY).first()
    if not row:
        return {}
    try:
        payload = json.loads(row.value_json or "{}")
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _is_transport_service_listing(item: PartnerProduct | None, meta_map: dict[str, dict] | None = None) -> bool:
    if not item:
        return False
    if _is_delivery_service_listing(item, meta_map):
        return False
    meta = (meta_map or {}).get(str(item.id), {}) if isinstance(meta_map, dict) else {}
    template_key = str(meta.get("service_template_key") or "").strip().lower()
    if template_key in TRANSPORT_SERVICE_TEMPLATE_KEYS:
        return True
    listing_type = str(meta.get("listing_type") or "").strip().lower()
    item_kind = str(meta.get("item_kind") or "").strip().lower()
    haystack = " ".join([
        str(item.category or "").lower(),
        str(item.name or "").lower(),
        str(item.description or "").lower(),
    ])
    transport_keywords = [
        "transport", "cab", "car", "car rental", "bike", "motorbike", "vehicle", "rental", "taxi", "cargo", "logistics", "carrier",
        "goods carrier", "ride", "auto", "auto rental", "auto rickshaw", "autorickshaw",
        "e-rickshaw", "erickshaw", "rickshaw", "truck", "pickup van", "van rental", "scooter rental",
    ]
    if listing_type == "service" and any(k in haystack for k in transport_keywords):
        return True
    if item_kind == "service" and any(k in haystack for k in transport_keywords):
        return True
    return False


def _is_delivery_service_listing(item: PartnerProduct | None, meta_map: dict[str, dict] | None = None) -> bool:
    if not item:
        return False
    meta = (meta_map or {}).get(str(item.id), {}) if isinstance(meta_map, dict) else {}
    template_key = str(meta.get("service_template_key") or "").strip().lower()
    if template_key in DELIVERY_SERVICE_TEMPLATE_KEYS:
        return True
    listing_type = str(meta.get("listing_type") or "").strip().lower()
    item_kind = str(meta.get("item_kind") or "").strip().lower()
    haystack = " ".join([
        str(item.category or "").lower(),
        str(item.name or "").lower(),
        str(item.description or "").lower(),
    ])
    delivery_keywords = ["delivery", "courier", "logistics", "cargo", "parcel", "shipment", "dispatch", "freight", "goods carrier"]
    if listing_type == "service" and any(k in haystack for k in delivery_keywords):
        return True
    if item_kind == "service" and any(k in haystack for k in delivery_keywords):
        return True
    return False


def _is_service_order_item(item: dict | None) -> bool:
    row = item or {}
    if bool(row.get("is_service") or row.get("service_booking_enabled")):
        return True
    listing_type = str(row.get("listing_type") or "").strip().lower()
    item_kind = str(row.get("item_kind") or "").strip().lower()
    return listing_type == "service" or item_kind == "service"


def _is_hospitality_service_order_item(item: dict | None, meta_map: dict[str, dict] | None = None) -> bool:
    row = item or {}
    if not _is_service_order_item(row):
        return False

    template_key = str(row.get("service_template_key") or "").strip().lower()
    product_id = str(row.get("product_id") or "").strip()
    if not template_key and product_id and isinstance(meta_map, dict):
        template_key = str((meta_map.get(product_id) or {}).get("service_template_key") or "").strip().lower()

    if template_key in TRANSPORT_SERVICE_TEMPLATE_KEYS:
        return False
    if template_key in HOSPITALITY_SERVICE_TEMPLATE_KEYS:
        return True

    haystack = " ".join([
        str(row.get("category") or "").lower(),
        str(row.get("name") or "").lower(),
        str(row.get("description") or "").lower(),
    ])
    return any(h in haystack for h in HOSPITALITY_SERVICE_HINTS)


def _load_order_contact_phone_for_order(db: Session, order_id: str) -> str:
    key = f"order_contact:{str(order_id or '').strip()}"
    if key == "order_contact:":
        return ""
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row:
        return ""
    try:
        payload = json.loads(row.value_json or "{}")
    except Exception:
        payload = {}
    return "".join(ch for ch in str(payload.get("customer_phone") or "") if ch.isdigit())


def _transport_partner_payment_profile(db: Session, partner: AssociatePartner, request: Request | None = None) -> dict:
    qr_row = db.query(AppSetting).filter(AppSetting.key == _partner_payment_qr_key(partner.id)).first()
    qr_url = ""
    if qr_row:
        try:
            qr_url = str(json.loads(qr_row.value_json or "{}").get("qr_url") or "").strip()
        except Exception:
            qr_url = ""
    return {
        "upi_id": str(partner.upi_id or "").strip(),
        "payee_name": str(partner.business_name or "").strip(),
        "qr_url": _file_url(qr_url, request) if request and qr_url else qr_url,
    }


def _build_partner_whatsapp_url(phone: str | None, message: str) -> str:
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    if not digits:
        return ""
    return f"https://wa.me/{digits}?text={quote(message)}"


def _save_transport_trip(db: Session, trip: dict) -> dict:
    trip_id = str((trip or {}).get("id") or "").strip()
    if not trip_id:
        raise HTTPException(status_code=400, detail="Trip id missing")
    payload = dict(trip or {})
    payload["id"] = trip_id
    payload["updated_at"] = now_iso()
    row = db.query(AppSetting).filter(AppSetting.key == _transport_trip_key(trip_id)).first()
    if not row:
        db.add(AppSetting(key=_transport_trip_key(trip_id), value_json=json.dumps(payload), updated_at=datetime.now(timezone.utc)))
    else:
        row.value_json = json.dumps(payload)
        row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return payload


def _save_delivery_trip(db: Session, trip: dict) -> dict:
    trip_id = str((trip or {}).get("id") or "").strip()
    if not trip_id:
        raise HTTPException(status_code=400, detail="Trip id missing")
    payload = dict(trip or {})
    payload["id"] = trip_id
    payload["updated_at"] = now_iso()
    row = db.query(AppSetting).filter(AppSetting.key == _delivery_trip_key(trip_id)).first()
    if not row:
        db.add(AppSetting(key=_delivery_trip_key(trip_id), value_json=json.dumps(payload), updated_at=datetime.now(timezone.utc)))
    else:
        row.value_json = json.dumps(payload)
        row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return payload


def _load_admin_accounts_ledger(db: Session) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == ADMIN_ACCOUNTS_LEDGER_KEY).first()
    if not row:
        return {"entries": [], "updated_at": now_iso()}
    try:
        payload = json.loads(row.value_json or "{}")
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    payload.setdefault("entries", [])
    payload.setdefault("updated_at", now_iso())
    return payload


def _save_admin_accounts_ledger(db: Session, payload: dict) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == ADMIN_ACCOUNTS_LEDGER_KEY).first()
    if not row:
        row = AppSetting(key=ADMIN_ACCOUNTS_LEDGER_KEY, value_json="{}")
        db.add(row)
    clean = {
        "entries": list((payload or {}).get("entries") or [])[:500],
        "updated_at": now_iso(),
    }
    row.value_json = json.dumps(clean)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return clean


def _accounts_auto_summary(db: Session) -> dict:
    # Only approved/settled orders should contribute to system income.
    income_rows = db.query(PublicOrder).filter(PublicOrder.status == "paid").all()
    income_total = 0.0
    income_items = []
    for order in income_rows:
        amount = round(float(order.total_amount or 0), 2)
        if amount <= 0:
            continue
        income_total += amount
        income_items.append(
            {
                "id": f"order:{order.id}",
                "source": "order",
                "category": "Sales Income",
                "label": f"Order {order.id}",
                "amount": amount,
                "direction": "income",
                "created_at": order.created_at.isoformat() if order.created_at else now_iso(),
            }
        )

    partner_topups = []
    pending_topup_rows = db.query(AppSetting).filter(AppSetting.key.like("partner_topup:%")).all()
    for row in pending_topup_rows:
        try:
            doc = json.loads(row.value_json or "{}")
        except Exception:
            continue
        if str(doc.get("status") or "").lower() != "approved":
            continue
        amount = round(float(doc.get("amount") or 0), 2)
        if amount <= 0:
            continue
        partner_topups.append(
            {
                "id": str(doc.get("id") or row.key),
                "source": "partner_topup",
                "category": "Partner Wallet Top-up",
                "label": str(doc.get("partner_name") or doc.get("partner_code") or "Partner top-up"),
                "amount": amount,
                "direction": "income",
                "created_at": str(doc.get("created_at") or row.updated_at.isoformat() if row.updated_at else now_iso()),
            }
        )

    withdrawals = []
    for item in WITHDRAWALS:
        if str(item.get("status") or "").lower() != "approved":
            continue
        amount = round(float(item.get("amount") or 0), 2)
        if amount <= 0:
            continue
        withdrawals.append(
            {
                "id": str(item.get("id") or ""),
                "source": "withdrawal",
                "category": "Member Withdrawal",
                "label": str(item.get("user_name") or item.get("user_member_code") or "Withdrawal"),
                "amount": amount,
                "direction": "expense",
                "created_at": str(item.get("created_at") or now_iso()),
            }
        )

    mps_claims = []
    for claim in MPS_CLAIMS:
        if str(claim.get("status") or "").lower() != "approved" or float(claim.get("amount") or 0) <= 0:
            continue
        amount = round(float(claim.get("amount") or 0), 2)
        mps_claims.append(
            {
                "id": str(claim.get("id") or ""),
                "source": "mps_claim",
                "category": "MPS Claim Payout",
                "label": str(claim.get("user_name") or "MPS claim"),
                "amount": amount,
                "direction": "expense",
                "created_at": str(claim.get("created_at") or now_iso()),
            }
        )

    expenses_total = sum(item["amount"] for item in withdrawals + mps_claims)
    return {
        "income_total": round(income_total, 2),
        "income_items": sorted(income_items + partner_topups, key=lambda item: str(item.get("created_at") or ""), reverse=True)[:200],
        "expense_total": round(expenses_total, 2),
        "expense_items": sorted(withdrawals + mps_claims, key=lambda item: str(item.get("created_at") or ""), reverse=True)[:200],
    }


def _clear_current_admin_transaction_data(db: Session) -> dict:
    owner_ids = [str((owner or {}).get("id") or "").strip() for owner in _store_owner_docs(db) if isinstance(owner, dict)]
    owner_ids = [owner_id for owner_id in owner_ids if owner_id]

    # Delete child rows first to satisfy FK constraints on stricter DB engines.
    deleted_payment_records = db.query(PaymentRecord).delete(synchronize_session=False)
    deleted_invoice_records = db.query(InvoiceRecord).delete(synchronize_session=False)
    deleted_reward_records = db.query(RewardRecord).delete(synchronize_session=False)
    deleted_public_orders = db.query(PublicOrder).delete(synchronize_session=False)
    deleted_financial_ledger_entries = db.query(FinancialLedgerEntry).delete(synchronize_session=False)
    deleted_orders = db.query(Order).delete(synchronize_session=False)

    cleared_admin_ledger = db.query(AppSetting).filter(AppSetting.key == ADMIN_ACCOUNTS_LEDGER_KEY).delete(synchronize_session=False)
    cleared_partner_topups = db.query(AppSetting).filter(AppSetting.key.like("partner_topup:%")).delete(synchronize_session=False)
    cleared_transport_bookings = db.query(AppSetting).filter(AppSetting.key.like("transport_trip:%")).delete(synchronize_session=False)
    cleared_delivery_bookings = db.query(AppSetting).filter(AppSetting.key.like("delivery_trip:%")).delete(synchronize_session=False)
    cleared_customer_order_contacts = db.query(AppSetting).filter(AppSetting.key.like("order_contact:%")).delete(synchronize_session=False)
    cleared_customer_mobile_otps = db.query(AppSetting).filter(AppSetting.key.like("customer_mobile_otp:%")).delete(synchronize_session=False)
    cleared_company_inventory = db.query(AppSetting).filter(AppSetting.key.like("company_inventory:%")).delete(synchronize_session=False)
    cleared_product_code_rows = db.query(AppSetting).filter(AppSetting.key.like("product_code:%")).delete(synchronize_session=False)
    cleared_property_enquiries = db.query(AppSetting).filter(AppSetting.key.like("property_enquiry:%")).delete(synchronize_session=False)
    cleared_partner_driver_rows = db.query(AppSetting).filter(AppSetting.key.like("partner_driver:%")).delete(synchronize_session=False)
    cleared_other_trip_rows = db.query(AppSetting).filter(AppSetting.key.like("%_trip:%")).delete(synchronize_session=False)
    cleared_other_booking_rows = db.query(AppSetting).filter(AppSetting.key.like("%_booking:%")).delete(synchronize_session=False)

    cleared_store_invoices = 0
    for owner_id in owner_ids:
        cleared_store_invoices += db.query(AppSetting).filter(AppSetting.key == _store_key(f"invoices:{owner_id}")).delete(synchronize_session=False)

    withdrawal_count = len(WITHDRAWALS)
    mps_claim_count = len(MPS_CLAIMS)
    WITHDRAWALS.clear()
    MPS_CLAIMS.clear()

    db.commit()
    return {
        "deleted_public_orders": int(deleted_public_orders or 0),
        "deleted_payment_records": int(deleted_payment_records or 0),
        "deleted_invoice_records": int(deleted_invoice_records or 0),
        "deleted_financial_ledger_entries": int(deleted_financial_ledger_entries or 0),
        "deleted_reward_records": int(deleted_reward_records or 0),
        "deleted_orders": int(deleted_orders or 0),
        "cleared_admin_ledger": int(cleared_admin_ledger or 0),
        "cleared_partner_topups": int(cleared_partner_topups or 0),
        "cleared_transport_bookings": int(cleared_transport_bookings or 0),
        "cleared_delivery_bookings": int(cleared_delivery_bookings or 0),
        "cleared_customer_order_contacts": int(cleared_customer_order_contacts or 0),
        "cleared_customer_mobile_otps": int(cleared_customer_mobile_otps or 0),
        "cleared_company_inventory": int(cleared_company_inventory or 0),
        "cleared_product_code_rows": int(cleared_product_code_rows or 0),
        "cleared_property_enquiries": int(cleared_property_enquiries or 0),
        "cleared_partner_driver_rows": int(cleared_partner_driver_rows or 0),
        "cleared_other_trip_rows": int(cleared_other_trip_rows or 0),
        "cleared_other_booking_rows": int(cleared_other_booking_rows or 0),
        "cleared_store_invoice_sets": int(cleared_store_invoices or 0),
        "cleared_withdrawals": int(withdrawal_count or 0),
        "cleared_mps_claims": int(mps_claim_count or 0),
    }


def _load_transport_trip(db: Session, trip_id: str) -> dict | None:
    row = db.query(AppSetting).filter(AppSetting.key == _transport_trip_key(trip_id)).first()
    if not row:
        return None
    try:
        payload = json.loads(row.value_json or "{}")
    except Exception:
        payload = {}
    return payload if isinstance(payload, dict) else None


def _load_delivery_trip(db: Session, trip_id: str) -> dict | None:
    row = db.query(AppSetting).filter(AppSetting.key == _delivery_trip_key(trip_id)).first()
    if not row:
        return None
    try:
        payload = json.loads(row.value_json or "{}")
    except Exception:
        payload = {}
    return payload if isinstance(payload, dict) else None


def _list_transport_trips(db: Session, partner_id: str | None = None, limit: int = 200) -> list[dict]:
    rows = db.query(AppSetting).filter(AppSetting.key.like("transport_trip:%")).order_by(AppSetting.updated_at.desc()).all()
    out: list[dict] = []
    for row in rows:
        try:
            payload = json.loads(row.value_json or "{}")
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue
        if partner_id and str(payload.get("partner_id") or "") != str(partner_id):
            continue
        out.append(payload)
        if len(out) >= max(1, int(limit)):
            break
    return out


def _list_delivery_trips(db: Session, partner_id: str | None = None, limit: int = 200) -> list[dict]:
    rows = db.query(AppSetting).filter(AppSetting.key.like("delivery_trip:%")).order_by(AppSetting.updated_at.desc()).all()
    out: list[dict] = []
    for row in rows:
        try:
            payload = json.loads(row.value_json or "{}")
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue
        if partner_id and str(payload.get("partner_id") or "") != str(partner_id):
            continue
        out.append(payload)
        if len(out) >= max(1, int(limit)):
            break
    return out


def _update_trip_location(db: Session, trip: dict, payload: dict | None) -> dict:
    try:
        latitude = round(float((payload or {}).get("latitude")), 7)
        longitude = round(float((payload or {}).get("longitude")), 7)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Valid latitude and longitude are required")
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise HTTPException(status_code=400, detail="Location coordinates are out of range")
    trip["live_location"] = {
        "latitude": latitude,
        "longitude": longitude,
        "accuracy_m": round(max(0.0, float((payload or {}).get("accuracy_m") or 0)), 1),
        "updated_at": now_iso(),
    }
    return trip


def _parse_schedule(value: str | None):
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _schedule_overlaps(start_a: str | None, end_a: str | None, start_b: str | None, end_b: str | None) -> bool:
    a_start = _parse_schedule(start_a)
    b_start = _parse_schedule(start_b)
    if not a_start or not b_start:
        return False
    a_end = _parse_schedule(end_a) or (a_start + timedelta(hours=1))
    b_end = _parse_schedule(end_b) or (b_start + timedelta(hours=1))
    return a_start < b_end and b_start < a_end


def _load_transport_fare_presets(db: Session, partner_id: str) -> list[dict]:
    row = db.query(AppSetting).filter(AppSetting.key == _transport_fare_presets_key(partner_id)).first()
    if not row:
        return []
    try:
        payload = json.loads(row.value_json or "[]")
    except Exception:
        return []
    return payload if isinstance(payload, list) else []


def _normalize_transport_fare_preset(entry: dict | None) -> dict | None:
    src = entry if isinstance(entry, dict) else {}
    preset_id = str(src.get("id") or "").strip() or str(uuid.uuid4())
    destination = str(src.get("destination") or "").strip()
    if not destination:
        return None
    try:
        fare = round(max(1.0, float(src.get("fare") or 0)), 2)
    except Exception:
        return None
    return {
        "id": preset_id,
        "service_product_id": str(src.get("service_product_id") or "").strip(),
        "destination": destination,
        "fare": fare,
        "pickup_hint": str(src.get("pickup_hint") or "").strip(),
        "notes": str(src.get("notes") or "").strip(),
        "active": bool(src.get("active") if src.get("active") is not None else True),
        "updated_at": now_iso(),
    }


def _save_transport_fare_presets(db: Session, partner_id: str, presets: list[dict]) -> list[dict]:
    normalized: list[dict] = []
    for raw in presets or []:
        item = _normalize_transport_fare_preset(raw)
        if item:
            normalized.append(item)
    row = db.query(AppSetting).filter(AppSetting.key == _transport_fare_presets_key(partner_id)).first()
    payload = json.dumps(normalized)
    if not row:
        db.add(AppSetting(key=_transport_fare_presets_key(partner_id), value_json=payload, updated_at=datetime.now(timezone.utc)))
    else:
        row.value_json = payload
        row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return normalized


def _find_transport_fare_preset(presets: list[dict], preset_id: str, service_product_id: str | None = None) -> dict | None:
    pid = str(preset_id or "").strip()
    sid = str(service_product_id or "").strip()
    if not pid:
        return None
    for item in presets or []:
        if str(item.get("id") or "") != pid:
            continue
        if sid and str(item.get("service_product_id") or "") and str(item.get("service_product_id") or "") != sid:
            continue
        if item.get("active") is False:
            return None
        return item
    return None


@router.get("/partner/transport/fare-presets")
def partner_transport_fare_presets(service_product_id: str | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")
    presets = _load_transport_fare_presets(db, partner.id)
    sid = str(service_product_id or "").strip()
    items = [p for p in presets if (not sid or not str(p.get("service_product_id") or "") or str(p.get("service_product_id") or "") == sid)]
    return {"partner_id": partner.id, "items": items}


@router.post("/partner/transport/fare-presets")
def partner_transport_save_fare_preset(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")

    normalized = _normalize_transport_fare_preset(payload)
    if not normalized:
        raise HTTPException(status_code=400, detail="destination and valid fare are required")

    service_product_id = str(normalized.get("service_product_id") or "").strip()
    if service_product_id:
        service = (
            db.query(PartnerProduct)
            .filter(
                PartnerProduct.id == service_product_id,
                PartnerProduct.partner_id == partner.id,
                PartnerProduct.active.is_(True),
                PartnerProduct.approval_status == "approved",
            )
            .first()
        )
        if not service:
            raise HTTPException(status_code=404, detail="Transport service not found")

    current = _load_transport_fare_presets(db, partner.id)
    next_items: list[dict] = []
    matched = False
    for item in current:
        if str(item.get("id") or "") == str(normalized.get("id") or ""):
            next_items.append(normalized)
            matched = True
        else:
            next_items.append(item)
    if not matched:
        next_items.append(normalized)

    saved = _save_transport_fare_presets(db, partner.id, next_items)
    return {"ok": True, "item": normalized, "items": saved}


@router.delete("/partner/transport/fare-presets/{preset_id}")
def partner_transport_delete_fare_preset(preset_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")

    target = str(preset_id or "").strip()
    current = _load_transport_fare_presets(db, partner.id)
    next_items = [item for item in current if str(item.get("id") or "") != target]
    if len(next_items) == len(current):
        raise HTTPException(status_code=404, detail="Preset not found")
    saved = _save_transport_fare_presets(db, partner.id, next_items)
    return {"ok": True, "items": saved}


@router.get("/transport/fare-presets")
def public_transport_fare_presets(partner_code: str, service_product_id: str | None = None, db: Session = Depends(get_db)):
    code = str(partner_code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="partner_code is required")
    partner = db.query(AssociatePartner).filter(AssociatePartner.partner_code == code, AssociatePartner.active.is_(True)).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    presets = _load_transport_fare_presets(db, partner.id)
    sid = str(service_product_id or "").strip()
    items = []
    for item in presets:
        if item.get("active") is False:
            continue
        item_sid = str(item.get("service_product_id") or "")
        if sid and item_sid and item_sid != sid:
            continue
        items.append(item)
    return {"partner_code": partner.partner_code, "items": items}


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
    source_product_id = str(payload.get("source_product_id") or "").strip()
    source_product = None
    source_meta = None
    if source_product_id:
        source_product = db.query(Product).filter(Product.id == source_product_id).first()
        if not source_product:
            raise HTTPException(status_code=400, detail="Invalid source product for Metho store catalog")
        source_meta = db.query(ProductMeta).filter(ProductMeta.product_id == source_product_id).first()
        source_type = str((source_meta.product_type if source_meta else "metho") or "metho").strip().lower()
        if source_type != "metho":
            raise HTTPException(status_code=400, detail="Only metho product is allowed for this catalog")
    item = {
        "id": str(uuid.uuid4()),
        "catalog_item_id": str(uuid.uuid4()),
        "name": str(payload.get("name") or (source_product.name if source_product else "")).strip(),
        "sku": str(payload.get("sku") or "").strip() or f"SKU-{uuid.uuid4().hex[:8].upper()}",
        "mrp": float(payload.get("mrp") or (source_meta.mrp if source_meta and source_meta.mrp is not None else (source_product.price if source_product else 0)) or 0),
        "price": float(payload.get("price") or (source_product.price if source_product else 0) or 0),
        "bv": float(payload.get("bv") or 0),
        "stock": max(0, int(payload.get("stock") or 0)),
        "source_product_id": source_product_id,
        "product_type": "metho",
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
        gst_percent = max(0.0, float(meta.gst_percent or 0)) if meta else 0.0
        return {
            "id": p.id,
            "product_code": _ensure_product_code(db, p.id, product_type),
            "name": p.name,
            "price": round(float(p.price or 0), 2),
            "stock": float(p.stock or 0),
            "product_type": product_type,
            "is_service": False,
            "gst_percent": gst_percent,
            "partner_id": None,
            "unit_type": "piece",
            "unit_label": "piece",
            "quantity_step": 1.0,
        }

    pp = db.query(PartnerProduct).filter(PartnerProduct.id == pid).first()
    if not pp:
        return None
    unit_info = _partner_unit_info(_load_partner_product_units(db), pp.id)
    meta = _load_partner_product_meta(db).get(str(pp.id), {})
    is_service = bool(meta.get("is_service") or str(meta.get("listing_type") or "").lower() == "service")
    return {
        "id": pp.id,
        "product_code": _ensure_product_code(db, pp.id, "associate_partner"),
        "name": pp.name,
        "price": round(float(pp.price or 0), 2),
        "stock": float(pp.stock or 0),
        "product_type": "associate_partner",
        "partner_id": pp.partner_id,
        "is_service": is_service,
        "gst_percent": max(0.0, float(meta.get("gst_percent") or 0)),
        **unit_info,
    }


def _offline_catalog_for_partner(db: Session, partner_id: str) -> list[dict]:
    unit_map = _load_partner_product_units(db)
    meta_map = _load_partner_product_meta(db)
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
    out = []
    for p in rows:
        meta = meta_map.get(str(p.id), {})
        is_service = bool(meta.get("is_service") or str(meta.get("listing_type") or "").lower() == "service")
        out.append(
            {
                "id": p.id,
                "product_code": _ensure_product_code(db, p.id, "associate_partner"),
                "name": p.name,
                "category": p.category,
                "price": round(float(p.price or 0), 2),
                "stock": float(p.stock or 0),
                "product_type": "associate_partner",
                "partner_id": p.partner_id,
                "is_service": is_service,
                **_partner_unit_info(unit_map, p.id),
            }
        )
    return out


def _offline_catalog_for_admin(db: Session) -> list[dict]:
    out: list[dict] = []
    unit_map = _load_partner_product_units(db)
    for p in db.query(Product).order_by(Product.created_at.desc()).all():
        meta = db.query(ProductMeta).filter(ProductMeta.product_id == p.id).first()
        out.append(
            {
                "id": p.id,
                "product_code": _ensure_product_code(db, p.id, (meta.product_type if meta else "metho") or "metho"),
                "name": p.name,
                "category": p.category,
                "price": round(float(p.price or 0), 2),
                "stock": float(p.stock or 0),
                "product_type": (meta.product_type if meta else "metho") or "metho",
                "partner_id": None,
                "unit_type": "piece",
                "unit_label": "piece",
                "quantity_step": 1.0,
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
                "stock": float(pp.stock or 0),
                "product_type": "associate_partner",
                "partner_id": pp.partner_id,
                **_partner_unit_info(unit_map, pp.id),
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
    reference_id = str(entry.get("reference_id") or entry.get("ref_request_id") or entry.get("ref_order_id") or entry.get("ref_payment_id") or "").strip()
    if reference_id and any(str(existing.get("reference_id") or existing.get("ref_request_id") or existing.get("ref_order_id") or existing.get("ref_payment_id") or "").strip() == reference_id for existing in txs if isinstance(existing, dict)):
        return
    entry.setdefault("ledger_id", f"partner-ledger:{partner_id}:{uuid.uuid4()}")
    entry.setdefault("reference_id", reference_id or entry["ledger_id"])
    entry.setdefault("transaction_type", entry.get("type") or "ADJUSTMENT")
    entry.setdefault("credit", round(float(entry.get("amount") or 0), 2))
    entry.setdefault("debit", 0.0)
    entry.setdefault("status", "posted")
    entry.setdefault("timestamp", entry.get("created_at") or now_iso())
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


def _record_payment_once(db: Session, order: PublicOrder, payment_id: str, provider_order_id: str, amount: float, currency: str = "INR") -> PaymentRecord:
    existing = db.query(PaymentRecord).filter(PaymentRecord.payment_id == payment_id).first()
    if existing:
        return existing
    record = PaymentRecord(
        order_id=order.id,
        provider="razorpay",
        payment_id=payment_id,
        provider_order_id=provider_order_id,
        amount=round(float(amount or 0), 2),
        currency=str(currency or "INR").upper(),
        status="verified",
    )
    db.add(record)
    db.commit()
    return record


def _append_financial_ledger(
    db: Session,
    *,
    reference_id: str,
    transaction_type: str,
    credit: float = 0,
    debit: float = 0,
    balance: float = 0,
    partner_id: str = "",
    order_id: str = "",
    status: str = "posted",
) -> FinancialLedgerEntry:
    existing = db.query(FinancialLedgerEntry).filter(FinancialLedgerEntry.reference_id == reference_id).first()
    if existing:
        return existing
    entry = FinancialLedgerEntry(
        ledger_id=f"ledger:{reference_id}",
        reference_id=reference_id,
        transaction_type=transaction_type,
        credit=round(float(credit or 0), 2),
        debit=round(float(debit or 0), 2),
        balance=round(float(balance or 0), 2),
        partner_id=str(partner_id or ""),
        order_id=str(order_id or ""),
        status=status,
    )
    db.add(entry)
    db.commit()
    return entry


def _record_invoice_once(db: Session, invoice: dict) -> InvoiceRecord:
    existing = db.query(InvoiceRecord).filter(InvoiceRecord.order_id == invoice["order_id"]).first()
    if existing:
        return existing
    record = InvoiceRecord(
        order_id=invoice["order_id"],
        invoice_no=invoice["invoice_no"],
        payload_json=json.dumps(invoice),
    )
    db.add(record)
    db.commit()
    return record


def _record_reward_once(db: Session, *, order_id: str, partner_id: str = "", reward_type: str, reference_id: str, amount: float) -> RewardRecord:
    existing = db.query(RewardRecord).filter(RewardRecord.reference_id == reference_id).first()
    if existing:
        return existing
    record = RewardRecord(
        order_id=order_id,
        partner_id=str(partner_id or ""),
        reward_type=reward_type,
        reference_id=reference_id,
        amount=round(float(amount or 0), 2),
        status="posted",
    )
    db.add(record)
    db.commit()
    return record


def _credit_partner_customer_payment_once(db: Session, partner: AssociatePartner, order: PublicOrder, payment_id: str) -> dict:
    reference_id = f"customer-payment:{payment_id or order.id}"
    existing = next((item for item in _list_partner_wallet_tx(db, partner.id) if str(item.get("reference_id") or "") == reference_id), None)
    if existing:
        return existing
    gross = round(float(order.total_amount or 0), 2)
    commission_rate = max(0.0, min(100.0, float(partner.commission_percent or 0)))
    commission = round(gross * commission_rate / 100.0, 2)
    credit = round(gross - commission, 2)
    wallet = _load_partner_wallet(db, partner.id)
    wallet["balance"] = round(float(wallet.get("balance") or 0) + credit, 2)
    wallet["total_credit"] = round(float(wallet.get("total_credit") or 0) + credit, 2)
    _save_partner_wallet(db, partner.id, wallet)
    entry = {"type": "customer_payment_credit", "transaction_type": "CUSTOMER_PAYMENT_CREDIT", "reference_id": reference_id, "ref_order_id": order.id, "ref_payment_id": payment_id, "amount": credit, "credit": credit, "debit": 0.0, "gross_amount": gross, "company_commission": commission, "description": "Verified customer payment less configured company commission", "created_at": now_iso(), "timestamp": now_iso(), "status": "posted"}
    _append_partner_wallet_tx(db, partner.id, entry)
    _append_financial_ledger(db, reference_id=reference_id, transaction_type="CUSTOMER_PAYMENT_CREDIT", credit=credit, balance=wallet["balance"], partner_id=partner.id, order_id=order.id)
    return entry


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


def _auto_approve_pending_orders_for_partner(db: Session, partner_id: str, source_note: str = "") -> dict:
    pid = str(partner_id or "").strip()
    if not pid:
        return {"attempted": 0, "approved": 0, "approved_order_ids": [], "skipped": []}

    partner_product_ids = {
        str(row[0])
        for row in db.query(PartnerProduct.id).filter(PartnerProduct.partner_id == pid).all()
        if row and row[0]
    }
    if not partner_product_ids:
        return {"attempted": 0, "approved": 0, "approved_order_ids": [], "skipped": []}

    rows = (
        db.query(PublicOrder)
        .filter(PublicOrder.status == "pending_approval")
        .order_by(PublicOrder.created_at.asc())
        .limit(500)
        .all()
    )

    attempted = 0
    approved_ids: list[str] = []
    approved_trip_ids: list[str] = []
    skipped: list[dict] = []
    note = source_note.strip() or "partner wallet credit"

    for row in rows:
        try:
            items = json.loads(row.items_json or "[]")
        except Exception:
            items = []
        if not isinstance(items, list) or not items:
            continue

        has_partner_item = False
        for item in items:
            product_id = str((item or {}).get("product_id") or "").strip()
            if product_id in partner_product_ids:
                has_partner_item = True
                break
        if not has_partner_item:
            continue

        attempted += 1
        try:
            admin_approve_order(
                order_id=row.id,
                payload={"note": f"Auto-approved after {note}"},
                db=db,
                current_user=SimpleNamespace(role="super_admin"),
            )
            approved_ids.append(str(row.id))
            for trip in _list_transport_trips(db, partner_id=pid, limit=100000):
                if str(trip.get("order_id") or "") != str(row.id) or str(trip.get("status") or "") != "booked":
                    continue
                trip["status"] = "confirmed"
                trip["confirmed_at"] = now_iso()
                trip["order_status"] = "paid"
                _save_transport_trip(db, trip)
                approved_trip_ids.append(str(trip.get("id") or ""))
            for trip in _list_delivery_trips(db, partner_id=pid, limit=100000):
                if str(trip.get("order_id") or "") != str(row.id) or str(trip.get("status") or "") != "booked":
                    continue
                trip["status"] = "confirmed"
                trip["confirmed_at"] = now_iso()
                trip["order_status"] = "paid"
                _save_delivery_trip(db, trip)
                approved_trip_ids.append(str(trip.get("id") or ""))
        except HTTPException as exc:
            skipped.append({"order_id": str(row.id), "reason": str(exc.detail or "approval blocked")})
        except Exception:
            skipped.append({"order_id": str(row.id), "reason": "approval blocked"})

    return {
        "attempted": attempted,
        "approved": len(approved_ids),
        "approved_order_ids": approved_ids,
        "approved_trip_ids": approved_trip_ids,
        "skipped": skipped[:20],
    }


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
def dashboard_overview(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    wallet_state = _load_user_wallet(db, current_user.id)
    direct_count = db.query(UserReferral).filter(UserReferral.sponsor_user_id == current_user.id).count()
    orders_count = len(_approved_member_purchases(db, current_user.id))
    return {
        "kyc_status": "approved",
        "rank": _sql_member_rank(db, current_user.id),
        "wallet_balance": wallet_state["balance"],
        "total_income": wallet_state["total_income"],
        "downline_count": direct_count,
        "orders_count": orders_count,
        "income_chart": [
            {"day": "Mon", "income": 0},
            {"day": "Tue", "income": 0},
            {"day": "Wed", "income": 0},
            {"day": "Thu", "income": 0},
            {"day": "Fri", "income": 0},
            {"day": "Sat", "income": 0},
            {"day": "Sun", "income": 0},
        ],
        "total_bonus": wallet_state["total_bonus"],
        "total_withdrawn": wallet_state["total_withdrawn"],
        "recent_transactions": [],
    }


@router.get("/wallet")
def wallet(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    return _load_user_wallet(db, current_user.id)


@router.get("/wallet/transactions")
def wallet_transactions(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    period = datetime.now(timezone.utc).strftime("%Y-%m")
    state = _load_json_setting(db, f"smart_cycle_settled:{current_user.id}:{period}", {})
    rows = []
    if state.get("bonus"):
        rows.append({"type": "smart_cycle_bonus", "amount": state["bonus"], "period": period})
    if state.get("leader_match"):
        rows.append({"type": "leader_match_reward", "amount": state["leader_match"], "period": period})
    return rows


@router.get("/wallet/withdrawals")
def wallet_withdrawals(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    return [row for row in _load_withdrawals(db) if str(row.get("user_id") or "") == str(current_user.id)]


@router.get("/wallet/monthly-projection")
def wallet_monthly_projection(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    settings = load_settings(db)
    period = datetime.now(timezone.utc).strftime("%Y-%m")
    own = round(sum(item["metho_sales"] for item in _approved_member_purchases(db, current_user.id, period)), 2)
    direct_ids = {rel.user_id for rel in db.query(UserReferral).filter(UserReferral.sponsor_user_id == current_user.id).all()}
    active_direct = sum(1 for uid in direct_ids if _approved_member_purchases(db, uid, period))
    team = round(sum(sum(x["metho_sales"] for x in _approved_member_purchases(db, uid, period)) for uid in direct_ids), 2)
    points = round(own / 100.0, 4)
    required_direct = int(settings.get("leader_min_direct_members") or 0)
    required_active = int(settings.get("leader_min_active_members") or 0)
    required_personal = float(settings.get("leader_min_personal_monthly_purchase") or 0)
    required_team = float(settings.get("leader_min_team_monthly_purchase") or 0)
    return {
        "period": period,
        "my_monthly_purchase": own,
        "my_points": points,
        "projected_point_value": 10,
        "projected_member_reward": 0,
        "leader_qualification": {
            "qualified": len(direct_ids) >= required_direct and active_direct >= required_active and own >= required_personal and team >= required_team,
            "checks": {
                "direct_members": {"actual": len(direct_ids), "required": required_direct, "pass": len(direct_ids) >= required_direct},
                "active_members": {"actual": active_direct, "required": required_active, "pass": active_direct >= required_active},
                "personal_monthly_purchase": {"actual": own, "required": required_personal, "pass": own >= required_personal},
                "team_monthly_purchase": {"actual": team, "required": required_team, "pass": team >= required_team},
            },
        },
    }


@router.post("/wallet/withdraw")
def wallet_withdraw(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    gross_amount = round(float(payload.get("amount") or 0), 2)
    if gross_amount <= 0:
        raise HTTPException(status_code=400, detail="Withdrawal amount must be greater than zero")
    settings = load_settings(db)
    minimum = max(0.0, float(settings.get("min_withdrawal") or 100))
    if gross_amount < minimum:
        raise HTTPException(status_code=400, detail=f"Minimum withdrawal is ₹{minimum:.2f}")
    wallet = _load_user_wallet(db, current_user.id)
    if gross_amount > float(wallet.get("balance") or 0):
        raise HTTPException(status_code=400, detail="Insufficient wallet balance")
    method = str(payload.get("method") or "upi").strip().lower()
    if method not in {"upi", "imps", "bank"}:
        raise HTTPException(status_code=400, detail="Unsupported withdrawal method")
    account_details = str(payload.get("account_details") or "").strip()
    if not account_details:
        raise HTTPException(status_code=400, detail="Payout account details are required")

    tds_percent, admin_percent = _withdrawal_rates(db)
    tds_amount = round(gross_amount * tds_percent / 100.0, 2)
    admin_charge_amount = round(gross_amount * admin_percent / 100.0, 2)
    net_amount = round(max(0.0, gross_amount - tds_amount - admin_charge_amount), 2)
    wallet["balance"] = round(float(wallet["balance"]) - gross_amount, 2)
    wallet["total_withdrawn"] = round(float(wallet["total_withdrawn"]) + gross_amount, 2)
    _save_user_wallet(db, current_user.id, wallet)
    rows = _load_withdrawals(db)
    entry = {
        "id": str(uuid.uuid4()),
        "user_id": current_user.id,
        "user_name": current_user.name,
        "user_member_code": member_code_for_user(current_user.id),
        "user_phone": current_user.phone,
        "user_email": current_user.email,
        "gross_amount": gross_amount,
        "amount": gross_amount,
        "tds_percent": tds_percent,
        "tds_amount": tds_amount,
        "admin_charge_percent": admin_percent,
        "admin_charge_amount": admin_charge_amount,
        "net_amount": net_amount,
        "method": method,
        "account_details": account_details,
        "status": "pending",
        "created_at": now_iso(),
        "utr": "",
        "rejection_reason": "",
    }
    rows.insert(0, entry)
    _save_withdrawals(db, rows)
    db.commit()
    return {"ok": True, "status": "pending", "withdrawal": entry, "message": "Withdrawal request submitted"}


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
                "rank": _sql_member_rank(db, u.id),
                "kyc_status": "approved",
                "role": u.role,
                "active": u.is_active,
                "purchase_active": _member_purchase_active(db, u.id),
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
                "purchase_active": _member_purchase_active(db, user.id),
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


@router.post("/auth/bootstrap-hidden-admin")
def bootstrap_hidden_admin(payload: dict | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user_optional)):
    body = payload or {}
    login_id = str(body.get("login_id") or "").strip()
    password = str(body.get("password") or "")
    reset_password = bool(body.get("reset_password", True))

    configured_login = str(ADMIN_LOGIN_ID or "").strip()
    configured_password = str(os.getenv("ADMIN_PASSWORD", "admin123") or "")
    if not configured_login or not configured_password:
        raise HTTPException(status_code=400, detail="Hidden admin bootstrap is not configured")

    if login_id.lower() != configured_login.lower() or password != configured_password:
        raise HTTPException(status_code=403, detail="Invalid bootstrap credentials")

    user = db.query(User).filter(User.email == configured_login).first()
    if not user:
        user = db.query(User).filter(User.email == configured_login.lower()).first()
    if not user:
        user = User(
            id=str(uuid.uuid4()),
            name="METHO Hidden Admin",
            email=configured_login,
            phone="9999999999",
            password=hash_password(configured_password),
            role="super_admin",
            is_active=True,
        )
        db.add(user)
        db.commit()
        return {"ok": True, "created": True, "id": user.id, "email": user.email, "role": user.role}

    user.role = "super_admin"
    user.is_active = True
    if reset_password or not verify_password(configured_password, user.password):
        user.password = hash_password(configured_password)
    db.commit()

    return {"ok": True, "created": False, "id": user.id, "email": user.email, "role": user.role}


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
            "rank": _sql_member_rank(db, user.id),
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
        "rank": _sql_member_rank(db, current_user.id),
        "children": [],
    }


@router.get("/leaderboard/referrals")
def leaderboard_referrals(period: str = "month", limit: int = 25, db: Session = Depends(get_db)):
    rows = {}
    for rel in db.query(UserReferral).all():
        sponsor = db.query(User).filter(User.id == rel.sponsor_user_id).first()
        child = db.query(User).filter(User.id == rel.user_id).first()
        if not sponsor or not child:
            continue
        if period == "month" and rel.created_at and _period_for_datetime(rel.created_at) != datetime.now(timezone.utc).strftime("%Y-%m"):
            continue
        rows[sponsor.id] = rows.get(sponsor.id, 0) + 1
    leaders = []
    for user_id, count in sorted(rows.items(), key=lambda item: item[1], reverse=True)[:max(1, min(int(limit or 25), 100))]:
        user = db.query(User).filter(User.id == user_id).first()
        leaders.append({"user_id": user_id, "name": user.name, "member_code": member_code_for_user(user_id), "rank": _sql_member_rank(db, user_id), "referral_count": count, "total_bonus_earned": _load_user_wallet(db, user_id)["total_bonus"]})
    return {"period": period, "leaders": leaders}


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
        if str(getattr(row, "status", "") or "").strip().lower() != "paid":
            # Leaderboard must only include orders after commission credit path is completed.
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
        if str(getattr(row, "status", "") or "").strip().lower() != "paid":
            # Commission not credited yet; keep it out of top-partner leaderboard.
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
def business_stats(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    period = datetime.now(timezone.utc).strftime("%Y-%m")
    own_sales = round(sum(item["metho_sales"] for item in _approved_member_purchases(db, current_user.id, period)), 2)
    direct_ids = {rel.user_id for rel in db.query(UserReferral).filter(UserReferral.sponsor_user_id == current_user.id).all()}
    team_sales = own_sales
    for user_id in direct_ids:
        team_sales += round(sum(item["metho_sales"] for item in _approved_member_purchases(db, user_id, period)), 2)
    settings = load_settings(db)
    thresholds = {
        "Bronze": float(settings.get("rank_bronze_bv") or 5000),
        "Silver": float(settings.get("rank_silver_bv") or 20000),
        "Gold": float(settings.get("rank_gold_bv") or 50000),
        "Diamond": float(settings.get("rank_diamond_bv") or 100000),
    }
    rank = "Diamond" if team_sales >= thresholds["Diamond"] else "Gold" if team_sales >= thresholds["Gold"] else "Silver" if team_sales >= thresholds["Silver"] else "Bronze" if team_sales >= thresholds["Bronze"] else "Starter"
    return {
        "total_business_volume": round(team_sales, 2),
        "mps": round(team_sales / 100.0, 2),
        "rank": rank,
        "direct_downline": len(direct_ids),
        "rank_thresholds": thresholds,
    }


@router.get("/business/cycle")
def business_cycle(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    settings = load_settings(db)
    bonus_percent = float(settings.get("smart_cycle_bonus_percent") or 10)
    leader_match_percent = max(0.0, min(100.0, float(settings.get("leader_match_percent") or 0)))
    target_bv = float(settings.get("cycle_target_bv") or 10000)
    reward_text = str(settings.get("cycle_reward_text") or f"{bonus_percent}% Smart Cycle Bonus")
    period = datetime.now(timezone.utc).strftime("%Y-%m")
    sales = round(sum(item["metho_sales"] for item in _approved_member_purchases(db, current_user.id, period)), 2)
    progress = round(min(100.0, sales / target_bv * 100.0), 2) if target_bv > 0 else 0.0
    return {
        "cycle": "Cycle-1",
        "cycle_bv": sales,
        "target_bv": target_bv,
        "progress_percentage": progress,
        "reward_at_target": reward_text,
    }


@router.get("/smart-cycle/me")
def smart_cycle_me(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    _settle_completed_smart_cycles(db, current_user.id, now)
    db.commit()
    settings = load_settings(db)
    bonus_percent = float(settings.get("smart_cycle_bonus_percent") or 10)
    leader_match_percent = max(0.0, min(100.0, float(settings.get("leader_match_percent") or 0)))
    if not _member_has_approved_metho_sale(db, current_user.id):
        return {
            "active": False,
            "message": "Your Smart Cycle activates automatically after your first approved METHO product purchase.",
            "settings": {"smart_cycle_bonus_percent": bonus_percent, "leader_match_percent": leader_match_percent, "smart_cycle_slot_days": SMART_CYCLE_SLOT_DAYS, "smart_cycle_total_slots": SMART_CYCLE_TOTAL_SLOTS},
            "past_cycles": [],
        }
    state = _load_json_setting(db, _smart_cycle_state_key(current_user.id), {})
    cycle_start = _parse_cycle_datetime(state.get("started_at"))
    elapsed_seconds = max(0.0, (now - cycle_start).total_seconds())
    elapsed_days = min(SMART_CYCLE_SLOT_DAYS * SMART_CYCLE_TOTAL_SLOTS, int(elapsed_seconds // 86400))
    current_slot = min(SMART_CYCLE_TOTAL_SLOTS, int(elapsed_seconds // (SMART_CYCLE_SLOT_DAYS * 86400)) + 1)
    slot_start = cycle_start + timedelta(days=SMART_CYCLE_SLOT_DAYS * (current_slot - 1))
    slot_end = slot_start + timedelta(days=SMART_CYCLE_SLOT_DAYS)
    network_sale, order_count = _smart_cycle_network_sale(db, current_user.id, slot_start, min(now, slot_end))
    slot_history = []
    for slot_number in range(1, current_slot + 1):
        history_start = cycle_start + timedelta(days=SMART_CYCLE_SLOT_DAYS * (slot_number - 1))
        history_end = min(now, history_start + timedelta(days=SMART_CYCLE_SLOT_DAYS))
        history_sale, history_orders = _smart_cycle_network_sale(db, current_user.id, history_start, history_end)
        slot_history.append({
            "slot": slot_number,
            "started_at": history_start.isoformat(),
            "ended_at": history_end.isoformat(),
            "network_sale_excluding_gst": history_sale,
            "order_count": history_orders,
            "status": "current" if slot_number == current_slot else "completed",
        })
    is_bonus_slot = current_slot == SMART_CYCLE_TOTAL_SLOTS
    estimated_bonus = round(network_sale * bonus_percent / 100.0, 2) if is_bonus_slot else 0.0
    direct_ids = {str(rel.user_id) for rel in db.query(UserReferral).filter(UserReferral.sponsor_user_id == current_user.id).all()}
    direct_match_estimate = 0.0
    for direct_id in direct_ids:
        direct_state = _load_json_setting(db, _smart_cycle_state_key(direct_id), {})
        if not direct_state:
            continue
        direct_start = _parse_cycle_datetime(direct_state.get("started_at"))
        direct_slot = min(SMART_CYCLE_TOTAL_SLOTS, int(max(0.0, (now - direct_start).total_seconds()) // (SMART_CYCLE_SLOT_DAYS * 86400)) + 1)
        if direct_slot != SMART_CYCLE_TOTAL_SLOTS:
            continue
        direct_slot_start = direct_start + timedelta(days=SMART_CYCLE_SLOT_DAYS * 4)
        direct_sale, _ = _smart_cycle_network_sale(db, direct_id, direct_slot_start, now)
        direct_match_estimate += round(direct_sale * bonus_percent / 100.0 * leader_match_percent / 100.0, 2)
    return {
        "active": True,
        "cycle": {"id": f"{current_user.id}:{state.get('cycle_number', 1)}", "cycle_number": int(state.get("cycle_number") or 1), "started_at": cycle_start.isoformat(), "ends_at": (cycle_start + timedelta(days=SMART_CYCLE_SLOT_DAYS * SMART_CYCLE_TOTAL_SLOTS)).isoformat(), "qualified_volume": network_sale, "metho_order_count": order_count, "fifth_slot_volume": network_sale},
        "current_slot": current_slot,
        "current_week": current_slot,
        "total_slots": SMART_CYCLE_TOTAL_SLOTS,
        "settlement_trigger_slot": SMART_CYCLE_TOTAL_SLOTS,
        "fifth_slot_volume": network_sale if is_bonus_slot else 0.0,
        "own_cycle_sale_base": network_sale,
        "direct_match_base_bonus": direct_match_estimate,
        "days_remaining": max(0, int((slot_end - now).total_seconds() // 86400)),
        "elapsed_days": elapsed_days,
        "total_days": SMART_CYCLE_SLOT_DAYS * SMART_CYCLE_TOTAL_SLOTS,
        "progress_percent": round(min(100.0, elapsed_seconds / (SMART_CYCLE_SLOT_DAYS * SMART_CYCLE_TOTAL_SLOTS * 86400) * 100), 2),
        "eligible_for_settlement": False,
        "estimated_bonus": estimated_bonus,
        "estimated_leader_match": round(direct_match_estimate, 2),
        "settings": {"smart_cycle_bonus_percent": bonus_percent, "leader_match_percent": leader_match_percent, "smart_cycle_days": SMART_CYCLE_SLOT_DAYS * SMART_CYCLE_TOTAL_SLOTS, "smart_cycle_slot_days": SMART_CYCLE_SLOT_DAYS, "smart_cycle_total_slots": SMART_CYCLE_TOTAL_SLOTS},
        "slot_history": slot_history,
        "past_cycles": _load_smart_cycle_history(db, current_user.id),
        "matching_history": _load_json_setting(db, _smart_cycle_match_history_key(current_user.id), []),
    }


@router.post("/smart-cycle/settle")
def smart_cycle_settle(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    settled = _settle_completed_smart_cycles(db, current_user.id)
    db.commit()
    if not settled:
        raise HTTPException(status_code=400, detail="Cycle payout is automatic after Slot 5 ends")
    return {"ok": True, "bonus": settled["bonus_paid"], "leader_match": settled["direct_sponsor_match_paid"], "credited_amount": settled["bonus_paid"]}


@router.get("/admin/smart-cycles")
def admin_smart_cycles(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    now = datetime.now(timezone.utc)
    rows = []
    for member in db.query(User).filter(User.role.notin_(["super_admin", "company_admin", "admin", "partner"])).all():
        if not _member_has_approved_metho_sale(db, member.id):
            continue
        _settle_completed_smart_cycles(db, member.id, now)
        state = _load_json_setting(db, _smart_cycle_state_key(member.id), {})
        started_at = _parse_cycle_datetime(state.get("started_at"))
        slot = min(SMART_CYCLE_TOTAL_SLOTS, int(max(0.0, (now - started_at).total_seconds()) // (SMART_CYCLE_SLOT_DAYS * 86400)) + 1)
        history = _load_smart_cycle_history(db, member.id)
        rows.append({
            "user_id": member.id,
            "member_name": member.name,
            "member_code": member_code_for_user(member.id),
            "cycle_number": int(state.get("cycle_number") or 1),
            "current_slot": slot,
            "started_at": started_at.isoformat(),
            "history": history,
            "matching_history": _load_json_setting(db, _smart_cycle_match_history_key(member.id), []),
        })
    db.commit()
    return rows


@router.get("/orders")
def list_orders(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    q = db.query(PublicOrder)
    if current_user.role not in {"super_admin", "company_admin", "admin"}:
        q = q.filter(PublicOrder.customer_user_id == current_user.id)
    rows = q.order_by(PublicOrder.created_at.desc()).limit(300).all()

    out = [_serialize_public_order_list_row(r, db) for r in rows]
    return out


@router.post("/customer/mobile-access/start")
def customer_mobile_access_start(payload: dict, db: Session = Depends(get_db)):
    settings = load_settings(db)
    if settings.get("customer_mobile_order_access_enabled") is False:
        raise HTTPException(status_code=403, detail="Customer mobile access is disabled")

    phone = _normalize_customer_phone((payload or {}).get("phone") or "")
    if len(_phone_local10(phone)) < 10:
        raise HTTPException(status_code=400, detail="Valid mobile number is required")

    order_ids = _find_public_order_ids_by_phone(db, phone)
    if not order_ids:
        return {
            "ok": True,
            "no_orders": True,
            "requires_otp": False,
            "order_count": 0,
            "message": "No orders found for this mobile number",
        }

    mode = str(settings.get("customer_mobile_access_mode") or "mobile_only").strip().lower()
    if mode not in CUSTOMER_ACCESS_MODES:
        mode = "mobile_only"

    if mode == "mobile_only":
        token, exp_ts = _issue_customer_access_token(phone, settings)
        return {
            "ok": True,
            "mode": mode,
            "requires_otp": False,
            "access_token": token,
            "expires_at": datetime.fromtimestamp(exp_ts, tz=timezone.utc).isoformat(),
            "order_count": len(order_ids),
        }

    otp_len = int(settings.get("customer_order_otp_length") or 6)
    otp_len = max(4, min(8, otp_len))
    otp_ttl = int(settings.get("customer_order_otp_ttl_seconds") or 300)
    otp_ttl = max(60, min(900, otp_ttl))
    max_attempts = int(settings.get("customer_order_otp_max_attempts") or 5)
    max_attempts = max(1, min(10, max_attempts))
    otp = "".join(secrets.choice("0123456789") for _ in range(otp_len))

    expires_at = datetime.now(timezone.utc) + timedelta(seconds=otp_ttl)
    otp_state = {
        "phone": phone,
        "otp_hash": _hash_customer_otp(phone, otp, settings),
        "expires_at": expires_at.isoformat(),
        "attempts_left": max_attempts,
        "updated_at": now_iso(),
    }
    _save_customer_otp_state(db, phone, otp_state)

    out = {
        "ok": True,
        "mode": mode,
        "requires_otp": True,
        "expires_in_seconds": otp_ttl,
        "order_count": len(order_ids),
        "message": "OTP generated. Verify OTP to continue.",
    }
    if bool(settings.get("customer_order_otp_debug_mode")):
        out["debug_otp"] = otp
    return out


@router.post("/customer/mobile-access/verify")
def customer_mobile_access_verify(payload: dict, db: Session = Depends(get_db)):
    settings = load_settings(db)
    if settings.get("customer_mobile_order_access_enabled") is False:
        raise HTTPException(status_code=403, detail="Customer mobile access is disabled")

    phone = _normalize_customer_phone((payload or {}).get("phone") or "")
    if len(_phone_local10(phone)) < 10:
        raise HTTPException(status_code=400, detail="Valid mobile number is required")

    mode = str(settings.get("customer_mobile_access_mode") or "mobile_only").strip().lower()
    if mode not in CUSTOMER_ACCESS_MODES:
        mode = "mobile_only"
    if mode != "mobile_otp":
        token, exp_ts = _issue_customer_access_token(phone, settings)
        return {
            "ok": True,
            "mode": "mobile_only",
            "access_token": token,
            "expires_at": datetime.fromtimestamp(exp_ts, tz=timezone.utc).isoformat(),
        }

    otp_value = str((payload or {}).get("otp") or "").strip()
    if not otp_value:
        raise HTTPException(status_code=400, detail="OTP is required")

    otp_state = _load_customer_otp_state(db, phone)
    if not otp_state:
        raise HTTPException(status_code=400, detail="OTP not found. Request a new OTP")

    try:
        expires_at = datetime.fromisoformat(str(otp_state.get("expires_at") or ""))
    except Exception:
        expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        _delete_setting_key(db, _customer_otp_key(phone))
        raise HTTPException(status_code=400, detail="OTP expired. Request a new OTP")

    provided_hash = _hash_customer_otp(phone, otp_value, settings)
    expected_hash = str(otp_state.get("otp_hash") or "")
    attempts_left = int(otp_state.get("attempts_left") or 0)
    if not expected_hash or not hmac.compare_digest(provided_hash, expected_hash):
        attempts_left = max(0, attempts_left - 1)
        if attempts_left <= 0:
            _delete_setting_key(db, _customer_otp_key(phone))
            raise HTTPException(status_code=400, detail="OTP failed too many times. Request a new OTP")
        otp_state["attempts_left"] = attempts_left
        otp_state["updated_at"] = now_iso()
        _save_customer_otp_state(db, phone, otp_state)
        raise HTTPException(status_code=400, detail=f"Invalid OTP. {attempts_left} attempt(s) left")

    _delete_setting_key(db, _customer_otp_key(phone))
    token, exp_ts = _issue_customer_access_token(phone, settings)
    return {
        "ok": True,
        "mode": "mobile_otp",
        "access_token": token,
        "expires_at": datetime.fromtimestamp(exp_ts, tz=timezone.utc).isoformat(),
    }


@router.get("/customer/mobile-access/orders")
def customer_mobile_access_orders(token: str = Query("", min_length=10), db: Session = Depends(get_db)):
    settings = load_settings(db)
    if settings.get("customer_mobile_order_access_enabled") is False:
        raise HTTPException(status_code=403, detail="Customer mobile access is disabled")

    phone = _verify_customer_access_token(token, settings)
    order_ids = _find_public_order_ids_by_phone(db, phone)
    if not order_ids:
        return []

    rows = (
        db.query(PublicOrder)
        .filter(PublicOrder.id.in_(order_ids))
        .order_by(PublicOrder.created_at.desc())
        .limit(200)
        .all()
    )
    return [_serialize_public_order_list_row(r, db) for r in rows]


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
        try:
            qty_value = float((row or {}).get("quantity") or 1)
        except Exception:
            qty_value = 1.0
        item = _get_offline_billing_product(db, product_id)
        if not item:
            raise HTTPException(status_code=400, detail=f"Product not found: {product_id}")

        if partner_scope_id and item.get("product_type") == "associate_partner" and item.get("partner_id") != partner_scope_id:
            raise HTTPException(status_code=403, detail="Partner can only bill own approved products")

        unit_type = _normalize_partner_unit_type(item.get("unit_type"))
        step = float(item.get("quantity_step") or _partner_unit_step(unit_type))
        if unit_type == "piece":
            qty = max(1, int(round(qty_value or 1)))
        else:
            qty = _round_quantity_to_step(qty_value or step, step)

        available_stock = max(0.0, float(item.get("stock") or 0))
        if not item.get("is_service") and qty > available_stock:
            raise HTTPException(
                status_code=400,
                detail=f"{item.get('name') or 'Product'}: requested quantity {qty} exceeds available stock {available_stock}",
            )

        unit_price = round(float(item.get("price") or 0), 2)
        pre_tax = round(unit_price * float(qty), 2)
        gst_percent = max(0.0, float(item.get("gst_percent") or 0))
        gst_amount = round(pre_tax * gst_percent / 100.0, 2)
        subtotal = round(pre_tax + gst_amount, 2)
        subtotal = round(subtotal)
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
                "is_service": bool(item.get("is_service")),
                "unit_type": unit_type,
                "unit_label": unit_type,
                "quantity_step": step,
                "gst_percent": gst_percent,
                "gst_amount": gst_amount,
                "pre_tax": pre_tax,
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

    if payment_mode == "cash":
        return {
            "ok": True,
            "order_id": row.id,
            "order_no": f"ORD-{row.id[:8].upper()}",
            "payment_mode": payment_mode,
            "member_code": canonical_member_code,
            "total_amount": round(total, 2),
            "status": "pending_payment",
            "approval_reason": "Cash collection is pending authorized confirmation.",
            "invoice_path": "",
            "member_whatsapp_share_url": "",
        }

    # Online offline-billing orders use the same approval pipeline as online orders.
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

    try:
        items = json.loads(row.items_json or "[]")
    except Exception:
        items = []

    is_admin = current_user.role in {"super_admin", "company_admin", "admin"}
    is_buyer = str(row.customer_user_id or "") == str(current_user.id or "")
    is_partner_order = False
    if not is_admin and not is_buyer and str(getattr(current_user, "role", "") or "") == "partner":
        partner = _resolve_partner_for_user(db, current_user)
        if partner:
            partner_product_ids = {
                str(pid)
                for (pid,) in db.query(PartnerProduct.id).filter(PartnerProduct.partner_id == partner.id).all()
                if pid
            }
            has_foreign_partner_item = any(
                str(item.get("product_type") or "").strip().lower() not in METHO_VEGETABLE_LIKE_PRODUCT_TYPES
                and str(item.get("product_id") or "") not in partner_product_ids
                for item in items
            )
            has_any_partner_item = any(str(item.get("product_id") or "") in partner_product_ids for item in items)
            has_metho_item = any(str(item.get("product_type") or "").strip().lower() in METHO_VEGETABLE_LIKE_PRODUCT_TYPES for item in items)
            is_partner_order = has_any_partner_item and not has_metho_item and not has_foreign_partner_item

    if not (is_admin or is_buyer or is_partner_order):
        raise HTTPException(status_code=403, detail="Not allowed")

    status_norm = str(row.status or "").strip().lower()
    if status_norm == "pending_approval" and getattr(current_user, "role", "") == "partner":
        partner = _resolve_partner_for_user(db, current_user)
        partner_product_ids = {
            str(pid)
            for (pid,) in db.query(PartnerProduct.id).filter(PartnerProduct.partner_id == partner.id).all()
        } if partner else set()
        own_partner_order = bool(partner_product_ids)
        commission_base = 0.0
        for item in items:
            product_type = str(item.get("product_type") or "").strip().lower()
            product_id = str(item.get("product_id") or "").strip()
            if product_type in METHO_VEGETABLE_LIKE_PRODUCT_TYPES or product_id not in partner_product_ids:
                own_partner_order = False
                break
            commission_base += float(item.get("subtotal") or 0)
        commission_percent = max(0.0, min(100.0, float(partner.commission_percent or 0))) if partner else 0.0
        commission_required = round(commission_base * commission_percent / 100.0, 2)
        wallet_row = db.query(AppSetting).filter(AppSetting.key == f"partner_wallet:{partner.id}").first() if partner else None
        try:
            wallet_payload = json.loads(wallet_row.value_json or "{}") if wallet_row else {}
        except Exception:
            wallet_payload = {}
        wallet_balance = round(float((wallet_payload or {}).get("balance") or 0), 2)
        if own_partner_order and wallet_balance + 1e-9 >= commission_required:
            admin_approve_order(
                order_id=row.id,
                payload={"note": "Auto-approved for partner invoice from reserve wallet"},
                db=db,
                current_user=SimpleNamespace(role="super_admin"),
            )
            db.refresh(row)
            status_norm = str(row.status or "").strip().lower()
    if status_norm not in {"paid", "approved"}:
        raise HTTPException(status_code=400, detail="Invoice is available only after admin approval")
    invoice_cache_key = f"invoice:{row.id}"
    cached_invoice_row = db.query(AppSetting).filter(AppSetting.key == invoice_cache_key).first()
    if cached_invoice_row:
        try:
            cached_invoice = json.loads(cached_invoice_row.value_json or "{}")
            if (
                isinstance(cached_invoice, dict)
                and cached_invoice.get("order_id") == row.id
                and cached_invoice.get("invoice_schema_version") == 5
            ):
                _record_invoice_once(db, cached_invoice)
                return cached_invoice
        except Exception:
            pass

    settings = load_settings(db)

    invoice_items = []
    subtotal_pre_tax = 0.0
    total_cgst = 0.0
    total_sgst = 0.0
    grand_total = 0.0
    for item in items:
        subtotal = float(item.get("subtotal") or 0)
        gst_rate = float(item.get("gst_percent") or 0)
        product_type = item.get("product_type") or "metho"
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
                "hsn_sac": "3004" if product_type == "metho" else ("0709" if product_type == "metho_vegetable" else "9983"),
                "quantity": float(item.get("quantity") or 1),
                "price": float(item.get("price") or 0),
                "pre_tax": pre_tax,
                "cgst": cgst,
                "sgst": sgst,
                "gst_rate": gst_rate,
                "subtotal": subtotal,
                "listing_type": str(item.get("listing_type") or "").strip().lower(),
                "item_kind": str(item.get("item_kind") or "").strip().lower(),
                "is_service": bool(item.get("is_service")),
                "service_invoice_mode": str(item.get("service_invoice_mode") or "").strip().lower(),
                "service_template_key": str(item.get("service_template_key") or "").strip(),
            }
        )

    item_types = {str(item.get("product_type") or "metho").strip().lower() for item in items}
    service_keys = {str(item.get("service_template_key") or "").strip().lower() for item in items}
    service_text = " ".join(
        f"{item.get('name') or ''} {item.get('category') or ''}" for item in items
    ).lower()
    if "tourism_booking" in service_keys:
        seller_name = "Tour & Travels"
    elif service_keys.intersection(TRANSPORT_SERVICE_TEMPLATE_KEYS | DELIVERY_SERVICE_TEMPLATE_KEYS) or any(
        word in service_text for word in ("transport", "ride", "cab", "car rental", "bike rental", "delivery", "courier")
    ):
        seller_name = "METHO Move"
    elif item_types and item_types.issubset({"metho_vegetable"}):
        seller_name = "METHO Vegetable"
    else:
        seller_name = "METHO Store"

    seller_address = "Dakshin Para, Morepukur, Rishra, Hooghly, West Bengal - 712250"
    seller_gst = settings.get("company_gst_no", "N/A")
    seller_pan = settings.get("company_pan", "N/A")
    seller_state = settings.get("company_state", "West Bengal")
    seller_state_code = settings.get("company_state_code", "19")
    seller_email = "methopvtltd@gmail.com"
    seller_upi = settings.get("upi_id", "methopvtltd@paytm")
    seller_phone = "7003805387"

    associate_partner_product_ids = [
        str(item.get("product_id") or "").strip()
        for item in items
        if str(item.get("product_type") or "").strip().lower() == "associate_partner"
    ]
    if associate_partner_product_ids and len(associate_partner_product_ids) == len(items):
        partner_products = (
            db.query(PartnerProduct)
            .filter(PartnerProduct.id.in_(associate_partner_product_ids))
            .all()
        )
        partner_ids = {
            str(pp.partner_id or "").strip()
            for pp in partner_products
            if str(pp.partner_id or "").strip()
        }
        if len(partner_ids) == 1:
            partner = db.query(AssociatePartner).filter(AssociatePartner.id == next(iter(partner_ids))).first()
            if partner:
                seller_name = str(partner.business_name or seller_name).strip() or seller_name
                seller_address = ", ".join(
                    [
                        str(partner.address or "").strip(),
                        str(partner.city or "").strip(),
                        str(partner.state or "").strip(),
                        str(partner.pincode or "").strip(),
                    ]
                ).strip(", ") or seller_address
                seller_gst = str(partner.gst_no or "").strip() or seller_gst
                seller_state = str(partner.state or "").strip() or seller_state
                seller_email = str(partner.email or "").strip() or seller_email
                seller_upi = str(partner.upi_id or "").strip() or seller_upi
                seller_phone = str(partner.phone or partner.whatsapp_no or "").strip()

    buyer = db.query(User).filter(User.id == row.customer_user_id).first() if row.customer_user_id else None
    buyer_role = str(getattr(buyer, "role", "") or "").strip().lower() if buyer else ""
    buyer_is_member_identity = bool(
        buyer and buyer_role not in {"partner", "store_owner", "metho_store_owner", "owner", "admin", "super_admin", "company_admin"}
    )

    buyer_name = str(row.payer_name or "").strip() or "Guest Customer"
    buyer_email = ""
    buyer_phone = _load_order_contact_phone_for_order(db, row.id)
    buyer_member_code = ""
    if buyer_is_member_identity:
        buyer_name = str(buyer.name or buyer_name).strip() or buyer_name
        buyer_email = str(buyer.email or "").strip()
        buyer_phone = str(buyer.phone or buyer_phone or "").strip()
        buyer_member_code = member_code_for_user(buyer.id)
    else:
        ref_text = str(row.member_ref or "").strip().upper()
        if ref_text.startswith("MTH-"):
            buyer_member_code = ref_text

    merchandise_total = round(grand_total, 2)
    item_delivery_total = round(sum(max(0.0, float(item.get("delivery_total") or 0)) for item in items), 2)
    delivery_charge = max(item_delivery_total, round(max(0.0, float(row.total_amount or 0) - merchandise_total), 2))
    invoice = {
        "invoice_schema_version": 5,
        "order_id": row.id,
        "order_no": f"ORD-{row.id[:8].upper()}",
        "invoice_no": f"INV-{row.id[:8].upper()}",
        "invoice_date": row.created_at.isoformat() if row.created_at else now_iso(),
        "status": ("paid" if row.status == "paid" else row.status),
        "seller": {
            "name": seller_name,
            "address": seller_address,
            "gst_no": seller_gst,
            "pan": seller_pan,
            "state": seller_state,
            "state_code": seller_state_code,
            "email": seller_email,
            "upi_id": seller_upi,
            "phone": seller_phone,
        },
        "buyer": {
            "name": buyer_name,
            "email": buyer_email,
            "phone": buyer_phone,
            "member_code": buyer_member_code,
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
        "grand_total": round(merchandise_total + delivery_charge, 2),
        "delivery_charge": delivery_charge,
        "notes": settings.get("invoice_terms") or settings.get("rules_and_conditions", ""),
        "einvoice": {},
    }
    db.add(AppSetting(key=invoice_cache_key, value_json=json.dumps(invoice), updated_at=datetime.now(timezone.utc)))
    db.commit()
    _record_invoice_once(db, invoice)
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
    return Response(content=_draw_invoice_pdf(inv), media_type="application/pdf")


@router.get("/customer/mobile-access/orders/{order_id}/invoice")
def customer_order_invoice(order_id: str, token: str = Query("", min_length=10), db: Session = Depends(get_db)):
    settings = load_settings(db)
    if settings.get("customer_mobile_order_access_enabled") is False:
        raise HTTPException(status_code=403, detail="Customer mobile access is disabled")
    phone = _verify_customer_access_token(token, settings)
    row = _ensure_customer_order_access(db, order_id, phone)
    pseudo_user = SimpleNamespace(role="member", id=str(row.customer_user_id or ""))
    return _invoice_payload(db, row.id, pseudo_user)


@router.get("/customer/mobile-access/orders/{order_id}/invoice/pdf")
def customer_order_invoice_pdf(order_id: str, token: str = Query("", min_length=10), db: Session = Depends(get_db)):
    settings = load_settings(db)
    if settings.get("customer_mobile_order_access_enabled") is False:
        raise HTTPException(status_code=403, detail="Customer mobile access is disabled")
    phone = _verify_customer_access_token(token, settings)
    row = _ensure_customer_order_access(db, order_id, phone)
    pseudo_user = SimpleNamespace(role="member", id=str(row.customer_user_id or ""))
    inv = _invoice_payload(db, row.id, pseudo_user)
    return Response(content=_draw_invoice_pdf(inv), media_type="application/pdf")


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
                "payment_method": str(r.payment_method or "").strip().lower(),
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


@router.get("/admin/tourism/bookings")
def admin_tourism_bookings(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    bookings = []
    for row in db.query(PublicOrder).order_by(PublicOrder.created_at.desc()).limit(1000).all():
        try:
            items = json.loads(row.items_json or "[]")
        except Exception:
            items = []
        tourism_items = [
            item for item in items
            if str(item.get("product_type") or "").strip().lower() == "metho_service"
            and str(item.get("service_template_key") or "").strip().lower() == "tourism_booking"
        ]
        if not tourism_items:
            continue
        acceptance = _load_json_setting(db, f"tourism_terms_acceptance:{row.id}", {})
        customer = _order_member(db, row)
        guide_assignment = _load_tourism_guide_assignment(db, row.id)
        bookings.append({
            "id": row.id,
            "order_no": f"ORD-{row.id[:8].upper()}",
            "status": str(row.status or "pending_approval"),
            "created_at": row.created_at.isoformat() if row.created_at else now_iso(),
            "customer_name": str(row.payer_name or getattr(customer, "name", "") or "Customer"),
            "customer_phone": str(_load_json_setting(db, f"order_contact:{row.id}", {}).get("customer_phone") or ""),
            "member_code": member_code_for_user(customer.id) if customer else str(row.member_ref or ""),
            "booking_note": str(row.shipping_address or ""),
            "payment_method": str(row.payment_method or "").lower(),
            "payment_reference": str(row.txn_id or ""),
            "payment_screenshot_url": str(row.payment_screenshot_url or ""),
            "total_amount": round(float(row.total_amount or 0), 2),
            "terms_accepted": bool(acceptance),
            "terms_accepted_at": str(acceptance.get("accepted_at") or ""),
            "terms_version": str(acceptance.get("policy_version") or ""),
            "guide": guide_assignment or None,
            "items": [{
                "product_id": item.get("product_id"),
                "name": item.get("name") or "Tourism service",
                "quantity": item.get("quantity") or 1,
                "subtotal": round(float(item.get("subtotal") or 0), 2),
                "slot_datetime": str(row.shipping_address or "").split("|", 1)[0].replace("Service Slot:", "").strip(),
            } for item in tourism_items],
        })
    summary = {
        "total_bookings": len(bookings),
        "pending_approval": sum(1 for row in bookings if row["status"] == "pending_approval"),
        "paid": sum(1 for row in bookings if row["status"] == "paid"),
        "terms_complete": sum(1 for row in bookings if row["terms_accepted"]),
        "gross_value": round(sum(float(row["total_amount"]) for row in bookings), 2),
    }
    return {"summary": summary, "items": bookings}


@router.get("/admin/tourism/guides")
def admin_tourism_guides(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    return _list_drivers(db, partner_id="admin", include_unapproved=True)


@router.post("/admin/tourism/guides")
def admin_create_tourism_guide(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    name = str((payload or {}).get("name") or "").strip()
    phone = "".join(ch for ch in str((payload or {}).get("phone") or "") if ch.isdigit())
    if not name or not phone:
        raise HTTPException(status_code=400, detail="Guide name and mobile number are required")
    guide = {
        "id": str(uuid.uuid4()),
        "partner_id": "admin",
        "partner_code": "METHO-TOURISM",
        "business_name": "METHO Tour & Travels",
        "name": name,
        "phone": phone,
        "whatsapp": "".join(ch for ch in str((payload or {}).get("whatsapp") or phone) if ch.isdigit()),
        "vehicle_number": "",
        "vehicle_type": "Tour Guide",
        "service_sector": "tourism",
        "approval_status": "approved",
        "active": True,
        "tracking_token": secrets.token_urlsafe(32),
        "live_location": None,
        "created_at": now_iso(),
    }
    saved = _save_driver(db, guide)
    return {"ok": True, "guide": saved, "tracking_path": f"/guide-track/{saved['id']}?token={saved['tracking_token']}"}


@router.post("/admin/tourism/bookings/{booking_id}/assign-guide")
def admin_assign_tourism_guide(booking_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    row = db.query(PublicOrder).filter(PublicOrder.id == booking_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Tourism booking not found")
    guide = _load_driver(db, str((payload or {}).get("guide_id") or ""))
    if not guide or guide.get("service_sector") != "tourism" or guide.get("active") is not True:
        raise HTTPException(status_code=400, detail="Active tourism guide is required")
    assignment = _driver_snapshot(guide)
    assignment["guide_id"] = guide["id"]
    assignment["tracking_token"] = ""
    return {"ok": True, "guide": _save_tourism_guide_assignment(db, booking_id, assignment)}


@router.post("/tourism/guides/{guide_id}/location")
def tourism_guide_update_location(guide_id: str, payload: dict, db: Session = Depends(get_db)):
    guide = _load_driver(db, guide_id)
    if not guide or guide.get("service_sector") != "tourism" or guide.get("active") is not True:
        raise HTTPException(status_code=404, detail="Guide not found")
    token = str((payload or {}).get("token") or "").strip()
    if not token or not secrets.compare_digest(token, str(guide.get("tracking_token") or "")):
        raise HTTPException(status_code=403, detail="Invalid guide tracking token")
    updated = _update_trip_location(db, guide, payload)
    guide["live_location"] = updated["live_location"]
    _save_driver(db, guide)
    rows = db.query(AppSetting).filter(AppSetting.key.like("tourism_guide:%")).all()
    for row in rows:
        try:
            assignment = json.loads(row.value_json or "{}")
        except Exception:
            continue
        if str(assignment.get("guide_id") or "") == str(guide_id):
            assignment["live_location"] = guide["live_location"]
            _save_tourism_guide_assignment(db, row.key.split(":", 1)[1], assignment)
    return {"ok": True, "live_location": guide["live_location"]}


@router.get("/admin/tourism/booking-images")
def admin_tourism_booking_images(current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    items = []
    for path in sorted(TOURISM_BOOKING_IMAGE_DIR.iterdir(), key=lambda item: item.stat().st_mtime, reverse=True):
        if not path.is_file() or path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"}:
            continue
        stat = path.stat()
        items.append({
            "name": path.name,
            "url": f"/api/files/tourism_booking_images/{path.name}",
            "size": stat.st_size,
            "updated_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        })
    return {"items": items[:100]}


@router.get("/tourism/booking-images")
def public_tourism_booking_images():
    items = []
    for path in sorted(TOURISM_BOOKING_IMAGE_DIR.iterdir(), key=lambda item: item.stat().st_mtime, reverse=True):
        if not path.is_file() or path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"}:
            continue
        items.append({"name": path.name, "url": f"/api/files/tourism_booking_images/{path.name}"})
    return {"items": items[:24]}


@router.post("/admin/upload/tourism-booking-image")
async def upload_tourism_booking_image(file: UploadFile = File(...), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    ext, content, _mime = _read_validated_image_upload(file, GLOBAL_IMAGE_MAX_UPLOAD_BYTES)
    name = f"tourism-booking-{uuid.uuid4().hex}{ext}"
    (TOURISM_BOOKING_IMAGE_DIR / name).write_bytes(content)
    return {"ok": True, "url": f"/api/files/tourism_booking_images/{name}", "name": name}


@router.post("/admin/orders/{order_id}/approve")
def admin_approve_order(order_id: str, payload: dict | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    row = db.query(PublicOrder).filter(PublicOrder.id == order_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")
    if row.status not in {"pending_approval", "pending_payment"}:
        raise HTTPException(status_code=400, detail=f"Only pending payment/approval orders can be approved (current: {row.status})")
    try:
        items = json.loads(row.items_json or "[]")
    except Exception:
        items = []

    metho_taxable = sum(float(i.get("pre_tax") or i.get("subtotal") or 0) for i in items if (i.get("product_type") or "metho") in METHO_VEGETABLE_LIKE_PRODUCT_TYPES)
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
        if product_type in METHO_VEGETABLE_LIKE_PRODUCT_TYPES:
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
    partner_unit_map = _load_partner_product_units(db)
    for item in items:
        try:
            qty_value = float(item.get("quantity") or 1)
        except Exception:
            qty_value = 1.0
        pid = str(item.get("product_id") or "")
        if not pid:
            continue

        p = db.query(Product).filter(Product.id == pid).first()
        if p:
            qty = max(1, int(round(qty_value or 1)))
            available = max(0, int(p.stock or 0))
            if qty > available:
                stock_errors.append(f"{p.name}: requested {qty}, available {available}")
            continue

        pp = db.query(PartnerProduct).filter(PartnerProduct.id == pid).first()
        if pp:
            if _is_service_order_item(item):
                continue
            unit_info = _partner_unit_info(partner_unit_map, pp.id)
            if unit_info["unit_type"] == "piece":
                qty = max(1, int(round(qty_value or 1)))
            else:
                qty = _round_quantity_to_step(qty_value or unit_info["quantity_step"], unit_info["quantity_step"])
            available = max(0.0, float(pp.stock or 0))
            if qty > available:
                stock_errors.append(f"{pp.name}: requested {qty}, available {available}")

    if stock_errors:
        raise HTTPException(
            status_code=400,
            detail="Cannot approve order due to insufficient stock: " + " | ".join(stock_errors),
        )

    for item in items:
        try:
            qty_value = float(item.get("quantity") or 1)
        except Exception:
            qty_value = 1.0
        pid = str(item.get("product_id") or "")
        if not pid:
            continue
        p = db.query(Product).filter(Product.id == pid).first()
        if p:
            qty = max(1, int(round(qty_value or 1)))
            p.stock = int(p.stock or 0) - qty
            continue
        pp = db.query(PartnerProduct).filter(PartnerProduct.id == pid).first()
        if pp:
            if _is_service_order_item(item):
                continue
            unit_info = _partner_unit_info(partner_unit_map, pp.id)
            if unit_info["unit_type"] == "piece":
                qty = max(1, int(round(qty_value or 1)))
            else:
                qty = _round_quantity_to_step(qty_value or unit_info["quantity_step"], unit_info["quantity_step"])
            pp.stock = float(pp.stock or 0) - float(qty)

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
                "transaction_type": "COMMISSION_RESERVE_DEBIT",
                "reference_id": f"commission-reserve:{order_id}:{partner_id}",
                "amount": round(required, 2),
                "credit": 0.0,
                "debit": round(required, 2),
                "description": f"Commission reserve used for order {order_id}",
                "ref_order_id": order_id,
                "created_at": now_iso(),
            },
        )
        _append_financial_ledger(
            db,
            reference_id=f"commission-reserve:{order_id}:{partner_id}",
            transaction_type="COMMISSION_RESERVE_DEBIT",
            debit=required,
            balance=wallet["balance"],
            partner_id=partner_id,
            order_id=order_id,
        )

    if total_commission_pool > 0:
        company_wallet["balance"] = round(float(company_wallet.get("balance") or 0) + total_commission_pool, 2)
        company_wallet["total_credit"] = round(float(company_wallet.get("total_credit") or 0) + total_commission_pool, 2)
        _save_company_commission_wallet(db, company_wallet)

    _record_reward_once(
        db,
        order_id=order_id,
        reward_type="COMMISSION_POOL_ALLOCATION",
        reference_id=f"reward:commission-pool:{order_id}",
        amount=total_commission_pool,
    )
    _append_financial_ledger(
        db,
        reference_id=f"reward:commission-pool:{order_id}",
        transaction_type="REWARD",
        debit=total_commission_pool,
        order_id=order_id,
    )

    split_member = round(total_commission_pool * (float(settings.get("commission_split_member_pool") or 0) / 100.0), 2)
    split_leader = round(total_commission_pool * (float(settings.get("commission_split_leader_pool") or 0) / 100.0), 2)
    split_mps = round(total_commission_pool * (float(settings.get("commission_split_mps_fund") or 0) / 100.0), 2)
    split_company = round(total_commission_pool * (float(settings.get("commission_split_company_fund") or 0) / 100.0), 2)
    split_tech = round(total_commission_pool * (float(settings.get("commission_split_technology_reserve") or 0) / 100.0), 2)

    row.status = "paid"
    db.commit()

    approved_member = _order_member(db, row)
    has_metho_product = any(str(item.get("product_type") or "").lower() in METHO_VEGETABLE_LIKE_PRODUCT_TYPES for item in items)
    activation_source = str(row.payment_method or "admin_confirmed").strip().lower()
    member_purchase_activated = _activate_member_purchase(
        db,
        approved_member if has_metho_product else None,
        row.id,
        activation_source,
    )
    if approved_member and has_metho_product:
        _set_member_payment_state(
            db,
            approved_member.id,
            "paid",
            activation_source,
            row.id,
            str(getattr(current_user, "id", "") or "") if activation_source != "razorpay" else "razorpay",
        )

    # A paid METHO order activates/advances the buyer's cycle and every sponsor whose network includes them.
    cycle_member = _order_member(db, row)
    cycle_owner_ids: set[str] = set()
    while cycle_member and str(cycle_member.id) not in cycle_owner_ids:
        cycle_owner_ids.add(str(cycle_member.id))
        relation = db.query(UserReferral).filter(UserReferral.user_id == cycle_member.id).first()
        cycle_member = db.query(User).filter(User.id == relation.sponsor_user_id).first() if relation else None
    for cycle_owner_id in cycle_owner_ids:
        _settle_completed_smart_cycles(db, cycle_owner_id)
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
        "member_purchase_activated": member_purchase_activated,
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
    checkout_pref = _load_partner_checkout_pref(db, partner.id)
    offer_popup = _load_partner_offer_popup(db, partner.id)
    business_youtube_url = _load_partner_business_youtube(db, partner.id)
    business_facebook_url = _load_partner_business_facebook(db, partner.id)
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
        "cod_enabled": bool(checkout_pref.get("cod_enabled", True)),
        "delivery_state": str(checkout_pref.get("delivery_state") or "").strip(),
        "delivery_district": str(checkout_pref.get("delivery_district") or "").strip(),
        "delivery_city": str(checkout_pref.get("delivery_city") or "").strip(),
        "delivery_pincode": str(checkout_pref.get("delivery_pincode") or "").strip(),
        "delivery_radius_km": max(0, int(checkout_pref.get("delivery_radius_km") or 0)),
        "slot_suggestion_interval_minutes": max(5, min(180, int(checkout_pref.get("slot_suggestion_interval_minutes") or 30))),
        "category_delivery_rules": _normalize_category_delivery_rules(checkout_pref.get("category_delivery_rules")),
        "offer_popup": offer_popup,
        "business_youtube_url": business_youtube_url,
        "business_facebook_url": business_facebook_url,
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


@router.put("/partner/payment-profile")
def partner_payment_profile_update(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")

    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")

    body = payload or {}
    if "upi_id" in body:
        partner.upi_id = str(body.get("upi_id") or "").strip()

    next_pref = _load_partner_checkout_pref(db, partner.id)
    if "cod_enabled" in body:
        next_pref["cod_enabled"] = bool(body.get("cod_enabled"))
    if "delivery_state" in body:
        next_pref["delivery_state"] = str(body.get("delivery_state") or "").strip()
    if "delivery_district" in body:
        next_pref["delivery_district"] = str(body.get("delivery_district") or "").strip()
    if "delivery_city" in body:
        next_pref["delivery_city"] = str(body.get("delivery_city") or "").strip()
    if "delivery_pincode" in body:
        next_pref["delivery_pincode"] = str(body.get("delivery_pincode") or "").strip()
    if "delivery_radius_km" in body:
        next_pref["delivery_radius_km"] = max(0, int(body.get("delivery_radius_km") or 0))
    if "slot_suggestion_interval_minutes" in body:
        next_pref["slot_suggestion_interval_minutes"] = max(5, min(180, int(body.get("slot_suggestion_interval_minutes") or 30)))
    next_offer = _load_partner_offer_popup(db, partner.id)
    next_business_youtube_url = _load_partner_business_youtube(db, partner.id)
    next_business_facebook_url = _load_partner_business_facebook(db, partner.id)
    if isinstance(body.get("offer_popup"), dict):
        next_offer = _normalize_partner_offer_popup(body.get("offer_popup"), next_offer)
    if "business_youtube_url" in body:
        next_business_youtube_url = str(body.get("business_youtube_url") or "").strip()
    if "business_facebook_url" in body:
        next_business_facebook_url = str(body.get("business_facebook_url") or "").strip()

    db.commit()
    saved_pref = _save_partner_checkout_pref(db, partner.id, next_pref)
    saved_offer = _save_partner_offer_popup(db, partner.id, next_offer)
    saved_business_youtube_url = _save_partner_business_youtube(db, partner.id, next_business_youtube_url)
    saved_business_facebook_url = _save_partner_business_facebook(db, partner.id, next_business_facebook_url)
    return {
        "ok": True,
        "partner_upi_id": str(partner.upi_id or "").strip(),
        "cod_enabled": bool(saved_pref.get("cod_enabled", True)),
        "delivery_state": str(saved_pref.get("delivery_state") or "").strip(),
        "delivery_district": str(saved_pref.get("delivery_district") or "").strip(),
        "delivery_city": str(saved_pref.get("delivery_city") or "").strip(),
        "delivery_pincode": str(saved_pref.get("delivery_pincode") or "").strip(),
        "delivery_radius_km": max(0, int(saved_pref.get("delivery_radius_km") or 0)),
        "slot_suggestion_interval_minutes": max(5, min(180, int(saved_pref.get("slot_suggestion_interval_minutes") or 30))),
        "category_delivery_rules": _normalize_category_delivery_rules(saved_pref.get("category_delivery_rules")),
        "offer_popup": saved_offer,
        "business_youtube_url": saved_business_youtube_url,
        "business_facebook_url": saved_business_facebook_url,
    }


@router.get("/partner/public-payment-profile/{partner_code}")
def partner_public_payment_profile(partner_code: str, request: Request, db: Session = Depends(get_db)):
    partner = db.query(AssociatePartner).filter(AssociatePartner.partner_code == partner_code, AssociatePartner.active.is_(True)).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    checkout_pref = _load_partner_checkout_pref(db, partner.id)
    offer_popup = _load_partner_offer_popup(db, partner.id)
    business_youtube_url = _load_partner_business_youtube(db, partner.id)
    business_facebook_url = _load_partner_business_facebook(db, partner.id)
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
        "cod_enabled": bool(checkout_pref.get("cod_enabled", True)),
        "delivery_state": str(checkout_pref.get("delivery_state") or "").strip(),
        "delivery_district": str(checkout_pref.get("delivery_district") or "").strip(),
        "delivery_city": str(checkout_pref.get("delivery_city") or "").strip(),
        "delivery_pincode": str(checkout_pref.get("delivery_pincode") or "").strip(),
        "delivery_radius_km": max(0, int(checkout_pref.get("delivery_radius_km") or 0)),
        "slot_suggestion_interval_minutes": max(5, min(180, int(checkout_pref.get("slot_suggestion_interval_minutes") or 30))),
        "offer_popup": offer_popup,
        "business_youtube_url": business_youtube_url,
        "business_facebook_url": business_facebook_url,
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


@router.post("/transport/bookings")
def create_transport_booking(payload: dict, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user_optional)):
    partner_code = str((payload or {}).get("partner_code") or "").strip()
    service_product_id = str((payload or {}).get("service_product_id") or "").strip()
    pickup = str((payload or {}).get("pickup") or "").strip()
    destination = str((payload or {}).get("destination") or "").strip()
    customer_name = str((payload or {}).get("customer_name") or getattr(current_user, "name", "Customer") or "Customer").strip() or "Customer"
    customer_phone = str((payload or {}).get("customer_phone") or getattr(current_user, "phone", "") or "").strip()
    member_ref = str((payload or {}).get("member_ref") or "").strip()
    notes = str((payload or {}).get("notes") or "").strip()
    vehicle_type = str((payload or {}).get("vehicle_type") or "").strip().lower()
    travel_date = str((payload or {}).get("travel_date") or "").strip()
    travel_end = str((payload or {}).get("travel_end") or "").strip()
    fare_preset_id = str((payload or {}).get("fare_preset_id") or "").strip()
    estimated_fare_raw = (payload or {}).get("estimated_fare")
    estimated_distance_km_raw = (payload or {}).get("estimated_distance_km")

    if not partner_code:
        raise HTTPException(status_code=400, detail="partner_code is required")
    if not service_product_id:
        raise HTTPException(status_code=400, detail="service_product_id is required")
    if not pickup and not fare_preset_id:
        raise HTTPException(status_code=400, detail="pickup is required")
    if not customer_phone:
        raise HTTPException(status_code=400, detail="customer_phone is required")

    partner = db.query(AssociatePartner).filter(AssociatePartner.partner_code == partner_code, AssociatePartner.active.is_(True)).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")

    service = (
        db.query(PartnerProduct)
        .filter(
            PartnerProduct.id == service_product_id,
            PartnerProduct.partner_id == partner.id,
            PartnerProduct.active.is_(True),
            PartnerProduct.approval_status == "approved",
        )
        .first()
    )
    if not service:
        raise HTTPException(status_code=404, detail="Transport service not found")

    meta_map = _load_partner_product_meta(db)
    if not _is_transport_service_listing(service, meta_map):
        raise HTTPException(status_code=400, detail="Selected service is not configured as transport")
    vehicle_meta = (meta_map or {}).get(str(service.id), {})
    vehicle_status = str(vehicle_meta.get("vehicle_status") or "AVAILABLE").strip().upper()
    if vehicle_status != "AVAILABLE":
        raise HTTPException(status_code=409, detail="This vehicle is not available for the selected time.")
    active_transport_statuses = {"booked", "confirmed", "on_trip"}
    duplicate_trip = next((trip for trip in _list_transport_trips(db, partner_id=str(partner.id), limit=1000) if str(trip.get("service_product_id") or "") == service_product_id and "".join(ch for ch in str(trip.get("customer_phone") or "") if ch.isdigit()) == "".join(ch for ch in customer_phone if ch.isdigit()) and str(trip.get("travel_date") or "") == travel_date and str(trip.get("status") or "") in active_transport_statuses), None)
    if duplicate_trip:
        raise HTTPException(status_code=409, detail="An active booking already exists for this vehicle and schedule.")
    overlap_trip = next((trip for trip in _list_transport_trips(db, partner_id=str(partner.id), limit=1000) if str(trip.get("service_product_id") or "") == service_product_id and str(trip.get("status") or "") in active_transport_statuses and _schedule_overlaps(travel_date, travel_end, trip.get("travel_date"), trip.get("travel_end"))), None)
    if overlap_trip:
        raise HTTPException(status_code=409, detail="Vehicle is already booked for the selected time.")

    fare_quote = round(max(1.0, float(service.price or 0)), 2)
    try:
        estimated_distance_km = max(0.0, float(estimated_distance_km_raw or 0))
    except Exception:
        estimated_distance_km = 0.0
    transport_rates = load_settings(db).get("metho_transport_rates") or {}
    vehicle_rate = float(transport_rates.get(vehicle_type) or 0) if isinstance(transport_rates, dict) else 0
    if estimated_distance_km > 0 and vehicle_rate > 0:
        fare_quote = round(max(1.0, estimated_distance_km * vehicle_rate), 2)
    try:
        estimated_fare = round(max(1.0, float(estimated_fare_raw or 0)), 2)
    except Exception:
        estimated_fare = 0
    if estimated_fare > 0 and not (estimated_distance_km > 0 and vehicle_rate > 0):
        fare_quote = estimated_fare
    selected_preset = None
    if fare_preset_id:
        presets = _load_transport_fare_presets(db, partner.id)
        selected_preset = _find_transport_fare_preset(presets, fare_preset_id, service_product_id=service_product_id)
        if not selected_preset:
            raise HTTPException(status_code=400, detail="Selected fare preset is invalid")
        preset_fare = round(float(selected_preset.get("fare") or 0), 2)
        if preset_fare > 0:
            fare_quote = preset_fare
        if not destination:
            destination = str(selected_preset.get("destination") or "").strip()
        if not pickup:
            pickup = str(selected_preset.get("pickup_hint") or "").strip() or "Preset pickup (to be confirmed)"

    if not destination:
        raise HTTPException(status_code=400, detail="destination is required")

    inferred_vehicle = "cab"
    meta = meta_map.get(str(service.id), {}) if isinstance(meta_map, dict) else {}
    template_key = str(meta.get("service_template_key") or "").strip().lower()
    if template_key == "bike_rental_daily":
        inferred_vehicle = "bike_rental"
    elif template_key == "car_rental_daily":
        inferred_vehicle = "car_rental"

    trip_id = str(uuid.uuid4())
    order_row = PublicOrder(
        id=str(uuid.uuid4()),
        customer_user_id=str(getattr(current_user, "id", "") or ""),
        member_ref=member_ref,
        shipping_address=f"Transport Trip: {pickup} -> {destination}",
        payment_method="upi",
        txn_id="",
        payment_screenshot_url="",
        payer_name=customer_name,
        items_json=json.dumps(
            [
                {
                    "product_id": service.id,
                    "name": service.name,
                    "price": fare_quote,
                    "unit_base_price": fare_quote,
                    "mrp": fare_quote,
                    "discount_percent": 0,
                    "gst_percent": 0,
                    "gst_amount": 0,
                    "pre_tax": fare_quote,
                    "quantity": 1,
                    "subtotal": fare_quote,
                    "product_type": "associate_partner",
                    "unit_type": "piece",
                    "unit_label": "piece",
                    "quantity_step": 1,
                    "image_url": str(service.image_url or ""),
                    "pricing_tiers": [],
                    "tier_breakdown": [{"qty": 1, "count": 1, "price": fare_quote}],
                    "listing_type": "service",
                    "item_kind": "service",
                    "is_service": True,
                    "service_booking_enabled": True,
                    "service_invoice_mode": "summary_total",
                    "service_template_key": template_key,
                }
            ]
        ),
        total_amount=fare_quote,
        status="pending_approval",
    )
    db.add(order_row)
    db.commit()
    db.refresh(order_row)
    # Save customer phone so partner/orders can display it instead of falling back to the user account phone.
    _customer_phone_digits = "".join(ch for ch in customer_phone if ch.isdigit())
    if _customer_phone_digits:
        _contact_key = f"order_contact:{order_row.id}"
        _contact_row = db.query(AppSetting).filter(AppSetting.key == _contact_key).first()
        if not _contact_row:
            db.add(AppSetting(key=_contact_key, value_json=json.dumps({"customer_phone": _customer_phone_digits})))
        else:
            _contact_row.value_json = json.dumps({"customer_phone": _customer_phone_digits})
        db.commit()
    trip = {
        "id": trip_id,
        "trip_code": f"TRP-{trip_id[:8].upper()}",
        "partner_id": partner.id,
        "partner_code": partner.partner_code,
        "business_name": partner.business_name,
        "service_product_id": service.id,
        "service_name": service.name,
        "service_template_key": template_key,
        "vehicle_type": vehicle_type or inferred_vehicle,
        "pickup": pickup,
        "destination": destination,
        "fare_preset_id": str(selected_preset.get("id") or "") if selected_preset else "",
        "fare_preset_destination": str(selected_preset.get("destination") or "") if selected_preset else "",
        "fare_preset_amount": float(selected_preset.get("fare") or 0) if selected_preset else 0,
        "travel_date": travel_date,
        "travel_end": travel_end,
        "notes": notes,
        "customer_name": customer_name,
        "customer_phone": customer_phone,
        "member_ref": member_ref,
        "customer_user_id": str(getattr(current_user, "id", "") or ""),
        "fare_quote": fare_quote,
        "fare_final": 0,
        "required_commission_reserve": 0,
        "status": "booked",
        "payment_status": "unpaid",
        "order_id": order_row.id,
        "created_at": now_iso(),
    }
    saved = _save_transport_trip(db, trip)
    return {
        "ok": True,
        "booking": saved,
        "order": {"id": order_row.id, "order_no": f"ORD-{order_row.id[:8].upper()}", "status": order_row.status, "auto_approved": False},
        "next_step": "Booking created with route details. Partner will set final fare first; then commission will be credited and trip auto-approved on confirm.",
        "reward_note": member_ref and "Member reference captured for reward attribution." or "Guest booking created without member reward attribution.",
        "partner_whatsapp_url": "",
    }


@router.get("/transport/bookings/{trip_id}")
def get_transport_booking(trip_id: str, request: Request, customer_phone: str | None = Query(default=None), db: Session = Depends(get_db), current_user=Depends(get_current_user_optional)):
    trip = _load_transport_trip(db, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Booking not found")

    role = str(getattr(current_user, "role", "") or "")
    user_id = str(getattr(current_user, "id", "") or "")

    def _digits(value: str | None) -> str:
        return "".join(ch for ch in str(value or "") if ch.isdigit())

    if role not in {"super_admin", "company_admin", "admin"}:
        if role == "partner":
            partner = _resolve_partner_for_user(db, current_user)
            if not partner or str(trip.get("partner_id") or "") != str(partner.id):
                raise HTTPException(status_code=403, detail="Not your booking")
        elif user_id:
            if str(trip.get("customer_user_id") or "") != user_id:
                raise HTTPException(status_code=403, detail="Not your booking")
        else:
            if not _digits(customer_phone) or _digits(customer_phone) != _digits(trip.get("customer_phone")):
                raise HTTPException(status_code=403, detail="Guest access requires matching customer phone")

    partner = db.query(AssociatePartner).filter(AssociatePartner.id == str(trip.get("partner_id") or "")).first()
    payment_profile = _transport_partner_payment_profile(db, partner, request) if partner else {"upi_id": "", "payee_name": "", "qr_url": ""}
    customer_trip = dict(trip)
    customer_trip["partner_name"] = str(getattr(partner, "business_name", "") or trip.get("business_name") or "Partner").strip()
    customer_trip["partner_phone"] = "".join(ch for ch in str(getattr(partner, "phone", "") or "").strip() if ch.isdigit())
    customer_trip["partner_whatsapp"] = "".join(ch for ch in str(getattr(partner, "whatsapp_no", "") or getattr(partner, "phone", "") or "").strip() if ch.isdigit())
    assigned_driver = _load_driver(db, str(trip.get("driver_id") or "")) if trip.get("driver_id") else None
    customer_trip["driver"] = _driver_snapshot(assigned_driver) if assigned_driver else trip.get("driver")
    return {
        "ok": True,
        "booking": customer_trip,
        "payment_profile": payment_profile if str(trip.get("status") or "") in {"completed", "paid"} else {"upi_id": "", "payee_name": "", "qr_url": ""},
    }


@router.post("/delivery/bookings")
def create_delivery_booking(payload: dict, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user_optional)):
    partner_code = str((payload or {}).get("partner_code") or "").strip()
    service_product_id = str((payload or {}).get("service_product_id") or "").strip()
    pickup = str((payload or {}).get("pickup") or "").strip()
    destination = str((payload or {}).get("destination") or "").strip()
    customer_name = str((payload or {}).get("customer_name") or getattr(current_user, "name", "Customer") or "Customer").strip() or "Customer"
    customer_phone = str((payload or {}).get("customer_phone") or getattr(current_user, "phone", "") or "").strip()
    receiver_name = str((payload or {}).get("receiver_name") or "").strip()
    receiver_phone = str((payload or {}).get("receiver_phone") or "").strip()
    member_ref = str((payload or {}).get("member_ref") or "").strip()
    notes = str((payload or {}).get("notes") or "").strip()
    travel_date = str((payload or {}).get("travel_date") or "").strip()
    estimated_fare_raw = (payload or {}).get("estimated_fare")

    if not partner_code:
        raise HTTPException(status_code=400, detail="partner_code is required")
    if not service_product_id:
        raise HTTPException(status_code=400, detail="service_product_id is required")
    if not pickup:
        raise HTTPException(status_code=400, detail="pickup is required")
    if not destination:
        raise HTTPException(status_code=400, detail="destination is required")
    if not customer_phone:
        raise HTTPException(status_code=400, detail="customer_phone is required")
    if not receiver_name:
        raise HTTPException(status_code=400, detail="receiver_name is required")
    if not receiver_phone:
        raise HTTPException(status_code=400, detail="receiver_phone is required")

    partner = db.query(AssociatePartner).filter(AssociatePartner.partner_code == partner_code, AssociatePartner.active.is_(True)).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")

    service = (
        db.query(PartnerProduct)
        .filter(
            PartnerProduct.id == service_product_id,
            PartnerProduct.partner_id == partner.id,
            PartnerProduct.active.is_(True),
            PartnerProduct.approval_status == "approved",
        )
        .first()
    )
    if not service:
        raise HTTPException(status_code=404, detail="Delivery service not found")

    meta_map = _load_partner_product_meta(db)
    if not _is_delivery_service_listing(service, meta_map):
        raise HTTPException(status_code=400, detail="Selected service is not configured as delivery")
    delivery_meta = (meta_map or {}).get(str(service.id), {})
    availability = str(delivery_meta.get("availability") or "available").strip().lower()
    if availability not in {"available", "busy"} or delivery_meta.get("is_available") is False:
        raise HTTPException(status_code=409, detail="This delivery service is currently unavailable.")
    active_delivery_statuses = {"booked", "confirmed", "pickup_assigned", "picked_up", "in_transit", "out_for_delivery"}
    duplicate_delivery = next((trip for trip in _list_delivery_trips(db, partner_id=str(partner.id), limit=1000) if str(trip.get("service_product_id") or "") == service_product_id and "".join(ch for ch in str(trip.get("customer_phone") or "") if ch.isdigit()) == "".join(ch for ch in customer_phone if ch.isdigit()) and str(trip.get("pickup") or "") == pickup and str(trip.get("destination") or "") == destination and str(trip.get("status") or "") in active_delivery_statuses), None)
    if duplicate_delivery:
        raise HTTPException(status_code=409, detail="An active delivery already exists for this route and customer.")

    fare_quote = round(max(1.0, float(service.price or 0)), 2)
    try:
        estimated_fare = round(max(1.0, float(estimated_fare_raw or 0)), 2)
    except Exception:
        estimated_fare = 0
    if estimated_fare > 0:
        fare_quote = estimated_fare

    meta = meta_map.get(str(service.id), {}) if isinstance(meta_map, dict) else {}
    template_key = str(meta.get("service_template_key") or "").strip().lower()

    trip_id = str(uuid.uuid4())
    order_row = PublicOrder(
        id=str(uuid.uuid4()),
        customer_user_id=str(getattr(current_user, "id", "") or ""),
        member_ref=member_ref,
        shipping_address=f"Delivery Trip: {pickup} -> {destination}",
        payment_method="upi",
        txn_id="",
        payment_screenshot_url="",
        payer_name=customer_name,
        items_json=json.dumps(
            [
                {
                    "product_id": service.id,
                    "name": service.name,
                    "price": fare_quote,
                    "unit_base_price": fare_quote,
                    "mrp": fare_quote,
                    "discount_percent": 0,
                    "gst_percent": 0,
                    "gst_amount": 0,
                    "pre_tax": fare_quote,
                    "quantity": 1,
                    "subtotal": fare_quote,
                    "product_type": "associate_partner",
                    "unit_type": "piece",
                    "unit_label": "piece",
                    "quantity_step": 1,
                    "image_url": str(service.image_url or ""),
                    "pricing_tiers": [],
                    "tier_breakdown": [{"qty": 1, "count": 1, "price": fare_quote}],
                    "listing_type": "service",
                    "item_kind": "service",
                    "is_service": True,
                    "service_booking_enabled": True,
                    "service_invoice_mode": "summary_total",
                    "service_template_key": template_key,
                }
            ]
        ),
        total_amount=fare_quote,
        status="pending_approval",
    )
    db.add(order_row)
    db.commit()
    db.refresh(order_row)

    _customer_phone_digits = "".join(ch for ch in customer_phone if ch.isdigit())
    if _customer_phone_digits:
        _contact_key = f"order_contact:{order_row.id}"
        _contact_row = db.query(AppSetting).filter(AppSetting.key == _contact_key).first()
        if not _contact_row:
            db.add(AppSetting(key=_contact_key, value_json=json.dumps({"customer_phone": _customer_phone_digits})))
        else:
            _contact_row.value_json = json.dumps({"customer_phone": _customer_phone_digits})
        db.commit()

    trip = {
        "id": trip_id,
        "delivery_vertical": "metho_delivery",
        "trip_code": f"DLV-{trip_id[:8].upper()}",
        "partner_id": partner.id,
        "partner_code": partner.partner_code,
        "business_name": partner.business_name,
        "service_product_id": service.id,
        "service_name": service.name,
        "service_template_key": template_key,
        "pickup": pickup,
        "destination": destination,
        "travel_date": travel_date,
        "notes": notes,
        "customer_name": customer_name,
        "customer_phone": customer_phone,
        "receiver_name": receiver_name,
        "receiver_phone": receiver_phone,
        "member_ref": member_ref,
        "customer_user_id": str(getattr(current_user, "id", "") or ""),
        "fare_quote": fare_quote,
        "fare_final": 0,
        "required_commission_reserve": 0,
        "status": "booked",
        "payment_status": "unpaid",
        "order_id": order_row.id,
        "created_at": now_iso(),
    }
    saved = _save_delivery_trip(db, trip)
    return {
        "ok": True,
        "booking": saved,
        "order": {"id": order_row.id, "order_no": f"ORD-{order_row.id[:8].upper()}", "status": order_row.status, "auto_approved": False},
        "next_step": "Booking created with pickup and destination. Partner will set the final delivery fare first; then commission will be credited and booking auto-approved on confirm.",
        "reward_note": member_ref and "Member reference captured for reward attribution." or "Guest booking created without member reward attribution.",
        "partner_whatsapp_url": "",
    }


@router.get("/delivery/bookings/{trip_id}")
def get_delivery_booking(trip_id: str, request: Request, customer_phone: str | None = Query(default=None), db: Session = Depends(get_db), current_user=Depends(get_current_user_optional)):
    trip = _load_delivery_trip(db, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Booking not found")

    role = str(getattr(current_user, "role", "") or "")
    user_id = str(getattr(current_user, "id", "") or "")

    def _digits(value: str | None) -> str:
        return "".join(ch for ch in str(value or "") if ch.isdigit())

    if role not in {"super_admin", "company_admin", "admin"}:
        if role == "partner":
            partner = _resolve_partner_for_user(db, current_user)
            if not partner or str(trip.get("partner_id") or "") != str(partner.id):
                raise HTTPException(status_code=403, detail="Not your booking")
        elif user_id:
            if str(trip.get("customer_user_id") or "") != user_id:
                raise HTTPException(status_code=403, detail="Not your booking")
        else:
            if not _digits(customer_phone) or _digits(customer_phone) != _digits(trip.get("customer_phone")):
                raise HTTPException(status_code=403, detail="Guest access requires matching customer phone")

    partner = db.query(AssociatePartner).filter(AssociatePartner.id == str(trip.get("partner_id") or "")).first()
    payment_profile = _transport_partner_payment_profile(db, partner, request) if partner else {"upi_id": "", "payee_name": "", "qr_url": ""}
    customer_trip = dict(trip)
    customer_trip["partner_name"] = str(getattr(partner, "business_name", "") or trip.get("business_name") or "Partner").strip()
    customer_trip["partner_phone"] = "".join(ch for ch in str(getattr(partner, "phone", "") or "").strip() if ch.isdigit())
    customer_trip["partner_whatsapp"] = "".join(ch for ch in str(getattr(partner, "whatsapp_no", "") or getattr(partner, "phone", "") or "").strip() if ch.isdigit())
    assigned_driver = _load_driver(db, str(trip.get("driver_id") or "")) if trip.get("driver_id") else None
    customer_trip["driver"] = _driver_snapshot(assigned_driver) if assigned_driver else trip.get("driver")
    return {
        "ok": True,
        "booking": customer_trip,
        "payment_profile": payment_profile if str(trip.get("status") or "") in {"completed", "paid"} else {"upi_id": "", "payee_name": "", "qr_url": ""},
    }


@router.get("/partner/delivery/bookings")
def partner_delivery_bookings(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")
    wallet = _load_partner_wallet(db, partner.id)
    trips = _list_delivery_trips(db, partner_id=partner.id, limit=300)
    return {
        "partner_id": partner.id,
        "partner_code": partner.partner_code,
        "wallet": wallet,
        "items": trips,
    }


@router.post("/partner/delivery/bookings/{trip_id}/fare")
def partner_delivery_update_fare(trip_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")
    trip = _load_delivery_trip(db, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Booking not found")
    if str(trip.get("partner_id") or "") != str(partner.id):
        raise HTTPException(status_code=403, detail="Not your booking")
    if str(trip.get("status") or "") not in {"booked"}:
        raise HTTPException(status_code=400, detail="Fare can be updated only before booking start")

    try:
        new_fare = round(max(1.0, float((payload or {}).get("fare_final") or 0)), 2)
    except Exception:
        raise HTTPException(status_code=400, detail="Valid fare_final required")

    trip["fare_final"] = new_fare
    trip["required_commission_reserve"] = round(new_fare * (max(0.0, float(partner.commission_percent or 0)) / 100.0), 2)
    saved = _save_delivery_trip(db, trip)

    order_id = str(trip.get("order_id") or "")
    row = db.query(PublicOrder).filter(PublicOrder.id == order_id).first()
    if row:
        try:
            items = json.loads(row.items_json or "[]")
        except Exception:
            items = []
        if isinstance(items, list) and items:
            it = dict(items[0] or {})
            it["price"] = new_fare
            it["unit_base_price"] = new_fare
            it["mrp"] = new_fare
            it["pre_tax"] = new_fare
            it["subtotal"] = new_fare
            items[0] = it
            row.items_json = json.dumps(items)
        row.total_amount = new_fare
        db.commit()

    return {"ok": True, "booking": saved}


@router.post("/partner/delivery/bookings/{trip_id}/confirm")
def partner_delivery_confirm_booking(trip_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")
    trip = _load_delivery_trip(db, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Booking not found")
    if str(trip.get("partner_id") or "") != str(partner.id):
        raise HTTPException(status_code=403, detail="Not your booking")
    if str(trip.get("status") or "") not in {"booked"}:
        raise HTTPException(status_code=400, detail="Booking can be confirmed only once before start")

    order_id = str(trip.get("order_id") or "")
    row = db.query(PublicOrder).filter(PublicOrder.id == order_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")

    fare_final = round(float(trip.get("fare_final") or 0), 2)
    if fare_final <= 0:
        raise HTTPException(status_code=400, detail="Set final fare first before confirming booking")

    required = round(float(trip.get("required_commission_reserve") or 0), 2)
    if required <= 0:
        required = round(fare_final * (max(0.0, float(partner.commission_percent or 0)) / 100.0), 2)
        trip["required_commission_reserve"] = required

    wallet = _load_partner_wallet(db, partner.id)
    available = round(float(wallet.get("balance") or 0), 2)
    if available + 1e-9 < required:
        raise HTTPException(
            status_code=400,
            detail={"code": "WALLET_INSUFFICIENT", "required_amount": required, "available_balance": available, "shortfall": round(required - available, 2)},
        )

    fare_final = round(float(trip.get("fare_final") or row.total_amount or 0), 2)
    order_items = []
    try:
        order_items = json.loads(row.items_json or "[]")
    except Exception:
        order_items = []
    if isinstance(order_items, list) and order_items:
        item = dict(order_items[0] or {})
        item["price"] = fare_final
        item["unit_base_price"] = fare_final
        item["mrp"] = fare_final
        item["pre_tax"] = fare_final
        item["subtotal"] = fare_final
        order_items[0] = item
        row.items_json = json.dumps(order_items)
    row.total_amount = fare_final
    row.status = "pending_approval"
    db.commit()

    auto_result = admin_approve_order(
        order_id=order_id,
        payload={"note": "Auto-approved delivery booking after final fare confirmation"},
        db=db,
        current_user=SimpleNamespace(role="super_admin"),
    )

    trip["status"] = "confirmed"
    trip["confirmed_at"] = now_iso()
    trip["order_status"] = "paid"
    saved = _save_delivery_trip(db, trip)

    return {
        "ok": True,
        "booking": saved,
        "order": {"id": order_id, "order_no": f"ORD-{order_id[:8].upper()}", "status": "paid", "auto_approved": True},
        "rewards_earned": auto_result.get("rewards_earned", {}),
        "commission_split": auto_result.get("commission_split", {}),
    }


@router.post("/partner/delivery/bookings/{trip_id}/complete")
def partner_delivery_complete_booking(trip_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")
    trip = _load_delivery_trip(db, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Booking not found")
    if str(trip.get("partner_id") or "") != str(partner.id):
        raise HTTPException(status_code=403, detail="Not your booking")
    if str(trip.get("status") or "") not in {"confirmed", "completed", "paid"}:
        raise HTTPException(status_code=400, detail="Delivery can be completed only after confirmation")

    trip["status"] = "completed"
    trip["completed_at"] = now_iso()
    saved = _save_delivery_trip(db, trip)

    customer_phone_digits = "".join(ch for ch in str(trip.get("customer_phone") or "") if ch.isdigit())
    receiver_name = str(trip.get("receiver_name") or "Receiver").strip() or "Receiver"
    destination = str(trip.get("destination") or "Destination").strip() or "Destination"
    partner_name = str(partner.business_name or partner.partner_code or "Partner").strip() or "Partner"
    partner_phone = "".join(ch for ch in str(partner.whatsapp_no or partner.phone or "") if ch.isdigit())
    trip_code = str(trip.get("trip_code") or trip.get("id") or "").strip()

    delivered_msg = (
        f"Delivery completed. Booking {trip_code} delivered to {receiver_name} at {destination}. "
        f"Partner: {partner_name} ({partner_phone or 'phone not set'})."
    )
    customer_whatsapp_delivered_url = _build_partner_whatsapp_url(customer_phone_digits, delivered_msg)

    return {
        "ok": True,
        "booking": saved,
        "customer_whatsapp_delivered_url": customer_whatsapp_delivered_url,
        "message": "Delivery marked completed. Share delivered update with customer from partner WhatsApp.",
    }


@router.post("/partner/delivery/bookings/{trip_id}/status")
def partner_delivery_update_status(trip_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    trip = _load_delivery_trip(db, trip_id)
    if not partner or not trip or str(trip.get("partner_id") or "") != str(partner.id):
        raise HTTPException(status_code=404, detail="Delivery booking not found")
    current = str(trip.get("status") or "booked").lower()
    requested = str((payload or {}).get("status") or "").strip().lower()
    transitions = {
        "booked": {"confirmed", "cancelled"},
        "confirmed": {"pickup_assigned", "cancelled"},
        "pickup_assigned": {"picked_up", "cancelled"},
        "picked_up": {"in_transit", "failed_delivery"},
        "in_transit": {"out_for_delivery", "failed_delivery", "returned"},
        "out_for_delivery": {"delivered", "failed_delivery", "returned"},
        "delivered": set(), "cancelled": set(), "failed_delivery": {"returned"}, "returned": set(), "paid": set(),
    }
    if requested not in transitions.get(current, set()):
        raise HTTPException(status_code=400, detail=f"Invalid delivery status transition: {current} -> {requested}")
    trip["status"] = requested
    trip["updated_at"] = now_iso()
    return {"ok": True, "booking": _save_delivery_trip(db, trip)}


def _partner_update_live_location(trip_id: str, payload: dict, db: Session, current_user, loader, saver, active_statuses: set[str]):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    trip = loader(db, trip_id)
    if not partner or not trip or str(trip.get("partner_id") or "") != str(partner.id):
        raise HTTPException(status_code=404, detail="Booking not found")
    if str(trip.get("status") or "").lower() not in active_statuses:
        raise HTTPException(status_code=400, detail="Location sharing is available only for an active booking")
    updated = _update_trip_location(db, trip, payload)
    driver_id = str(updated.get("driver_id") or "").strip()
    if driver_id:
        driver = _load_driver(db, driver_id)
        if driver and str(driver.get("partner_id") or "") == str(partner.id):
            driver["live_location"] = updated.get("live_location")
            _save_driver(db, driver)
    return {"ok": True, "booking": saver(db, updated)}


def _assign_driver_to_trip(trip_id: str, payload: dict, db: Session, current_user, loader, saver, sector: str) -> dict:
    role = getattr(current_user, "role", "")
    if role not in {"partner", "super_admin", "company_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Authorized operator access only")
    trip = loader(db, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Booking not found")
    partner = _resolve_partner_for_user(db, current_user) if role == "partner" else None
    if partner and str(trip.get("partner_id") or "") != str(partner.id):
        raise HTTPException(status_code=403, detail="Not your booking")
    driver_id = str((payload or {}).get("driver_id") or "").strip()
    driver = _load_driver(db, driver_id)
    if not driver or str(driver.get("approval_status") or "") != "approved" or driver.get("active") is False:
        raise HTTPException(status_code=400, detail="Approved active driver is required")
    if str(driver.get("partner_id") or "") != str(trip.get("partner_id") or ""):
        raise HTTPException(status_code=403, detail="Driver belongs to another partner")
    driver_sector = str(driver.get("service_sector") or "transport").strip().lower()
    if driver_sector != sector:
        raise HTTPException(status_code=400, detail="Driver sector does not match this booking")
    trip["driver_id"] = driver_id
    trip["driver"] = _driver_snapshot(driver)
    return {"ok": True, "booking": saver(db, trip)}


@router.get("/partner/drivers")
def partner_drivers(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")
    return _list_drivers(db, partner_id=partner.id, include_unapproved=True)


@router.post("/partner/drivers")
def partner_create_driver(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")
    name = str((payload or {}).get("name") or "").strip()
    phone = "".join(ch for ch in str((payload or {}).get("phone") or "") if ch.isdigit())
    sector = str((payload or {}).get("service_sector") or "transport").strip().lower()
    if not name or not phone or sector not in {"transport", "delivery"}:
        raise HTTPException(status_code=400, detail="Name, phone, and valid service sector are required")
    driver = {
        "id": str(uuid.uuid4()),
        "partner_id": str(partner.id),
        "partner_code": str(partner.partner_code or ""),
        "business_name": str(partner.business_name or ""),
        "name": name,
        "phone": phone,
        "whatsapp": "".join(ch for ch in str((payload or {}).get("whatsapp") or phone) if ch.isdigit()),
        "vehicle_number": str((payload or {}).get("vehicle_number") or "").strip(),
        "vehicle_type": str((payload or {}).get("vehicle_type") or "").strip(),
        "service_sector": sector,
        "approval_status": "pending",
        "active": False,
        "live_location": None,
        "created_at": now_iso(),
    }
    return {"ok": True, "driver": _save_driver(db, driver)}


@router.patch("/partner/drivers/{driver_id}")
def partner_update_driver(driver_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    driver = _load_driver(db, driver_id)
    if not partner or not driver or str(driver.get("partner_id") or "") != str(partner.id):
        raise HTTPException(status_code=404, detail="Driver not found")
    for key in ("name", "vehicle_number", "vehicle_type"):
        if (payload or {}).get(key) is not None:
            driver[key] = str(payload.get(key) or "").strip()
    if (payload or {}).get("phone") is not None:
        driver["phone"] = "".join(ch for ch in str(payload.get("phone") or "") if ch.isdigit())
    if (payload or {}).get("whatsapp") is not None:
        driver["whatsapp"] = "".join(ch for ch in str(payload.get("whatsapp") or "") if ch.isdigit())
    if (payload or {}).get("active") is not None and str(driver.get("approval_status")) == "approved":
        driver["active"] = bool(payload.get("active"))
    return {"ok": True, "driver": _save_driver(db, driver)}


@router.get("/admin/drivers")
def admin_drivers(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") not in {"super_admin", "company_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Admin access only")
    return _list_drivers(db, include_unapproved=True)


@router.post("/admin/drivers/{driver_id}/review")
def admin_review_driver(driver_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") not in {"super_admin", "company_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Admin access only")
    driver = _load_driver(db, driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    status = str((payload or {}).get("approval_status") or "").strip().lower()
    if status not in {"approved", "rejected"}:
        raise HTTPException(status_code=400, detail="Approval status must be approved or rejected")
    driver["approval_status"] = status
    driver["active"] = status == "approved" and bool(payload.get("active", True))
    driver["review_note"] = str((payload or {}).get("review_note") or "").strip()
    return {"ok": True, "driver": _save_driver(db, driver)}


@router.post("/partner/transport/bookings/{trip_id}/assign-driver")
def partner_assign_transport_driver(trip_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    return _assign_driver_to_trip(trip_id, payload, db, current_user, _load_transport_trip, _save_transport_trip, "transport")


@router.post("/partner/delivery/bookings/{trip_id}/assign-driver")
def partner_assign_delivery_driver(trip_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    return _assign_driver_to_trip(trip_id, payload, db, current_user, _load_delivery_trip, _save_delivery_trip, "delivery")


@router.post("/admin/transport/bookings/{trip_id}/assign-driver")
def admin_assign_transport_driver(trip_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    return _assign_driver_to_trip(trip_id, payload, db, current_user, _load_transport_trip, _save_transport_trip, "transport")


@router.post("/admin/delivery/bookings/{trip_id}/assign-driver")
def admin_assign_delivery_driver(trip_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    return _assign_driver_to_trip(trip_id, payload, db, current_user, _load_delivery_trip, _save_delivery_trip, "delivery")


@router.post("/partner/transport/bookings/{trip_id}/location")
def partner_transport_update_location(trip_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    return _partner_update_live_location(trip_id, payload, db, current_user, _load_transport_trip, _save_transport_trip, {"on_trip"})


@router.post("/partner/delivery/bookings/{trip_id}/location")
def partner_delivery_update_location(trip_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    return _partner_update_live_location(
        trip_id, payload, db, current_user, _load_delivery_trip, _save_delivery_trip,
        {"confirmed", "pickup_assigned", "picked_up", "in_transit", "out_for_delivery"},
    )


@router.get("/admin/transport/bookings")
def admin_transport_bookings(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=3, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if getattr(current_user, "role", "") not in {"super_admin", "company_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Admin access only")
    all_trips = _list_transport_trips(db, limit=100000)
    total = len(all_trips)
    page_items = all_trips[offset: offset + limit]
    return {"total": total, "offset": offset, "limit": limit, "items": page_items}


@router.get("/admin/delivery/bookings")
def admin_delivery_bookings(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=3, ge=1, le=100),
    vertical: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if getattr(current_user, "role", "") not in {"super_admin", "company_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Admin access only")
    all_trips = _list_delivery_trips(db, limit=100000)
    if vertical:
        requested_vertical = str(vertical).strip().lower()
        all_trips = [trip for trip in all_trips if str(trip.get("delivery_vertical") or "").strip().lower() == requested_vertical]
    total = len(all_trips)
    return {"total": total, "offset": offset, "limit": limit, "items": all_trips[offset: offset + limit]}


@router.get("/admin/stay-dining/bookings")
def admin_stay_dining_bookings(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=3, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if getattr(current_user, "role", "") not in {"super_admin", "company_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Admin access only")

    meta_map = _load_partner_product_meta(db)
    partner_products = db.query(PartnerProduct.id, PartnerProduct.partner_id).all()
    product_partner_map = {str(pid): str(partner_id) for pid, partner_id in partner_products if pid and partner_id}
    partners = db.query(AssociatePartner.id, AssociatePartner.business_name, AssociatePartner.partner_code).all()
    partner_name_map = {
        str(pid): (str(name or "").strip() or str(code or "").strip() or "Partner")
        for pid, name, code in partners
        if pid
    }

    rows = db.query(PublicOrder).order_by(PublicOrder.created_at.desc()).limit(3000).all()
    all_bookings: list[dict] = []
    for row in rows:
        try:
            items = json.loads(row.items_json or "[]")
        except Exception:
            items = []
        if not isinstance(items, list):
            continue

        selected_items: list[dict] = []
        partner_names: list[str] = []
        partner_seen: set[str] = set()

        for item in items:
            if not isinstance(item, dict):
                continue
            if str(item.get("product_type") or "").strip().lower() != "associate_partner":
                continue
            if not _is_hospitality_service_order_item(item, meta_map=meta_map):
                continue

            product_id = str(item.get("product_id") or "").strip()
            partner_id = product_partner_map.get(product_id, "")
            if partner_id and partner_id not in partner_seen:
                partner_seen.add(partner_id)
                partner_names.append(partner_name_map.get(partner_id, "Partner"))

            selected_items.append(
                {
                    "product_id": product_id,
                    "product_name": str(item.get("name") or "Service").strip() or "Service",
                    "quantity": float(item.get("quantity") or 1),
                    "subtotal": round(float(item.get("subtotal") or item.get("price") or 0), 2),
                    "service_template_key": str(item.get("service_template_key") or "").strip(),
                }
            )

        if not selected_items:
            continue

        all_bookings.append(
            {
                "id": row.id,
                "order_no": f"ORD-{row.id[:8].upper()}",
                "status": str(row.status or "pending_approval"),
                "created_at": row.created_at.isoformat() if row.created_at else now_iso(),
                "customer_name": str(row.payer_name or "Customer").strip() or "Customer",
                "customer_phone": _load_order_contact_phone_for_order(db, row.id),
                "booking_address": str(row.shipping_address or "").strip(),
                "payment_method": str(row.payment_method or "").strip().lower(),
                "total_amount": round(float(row.total_amount or 0), 2),
                "partners": partner_names,
                "items": selected_items,
            }
        )

    total = len(all_bookings)
    page_items = all_bookings[offset: offset + limit]
    return {"total": total, "offset": offset, "limit": limit, "items": page_items}


@router.get("/partner/transport/bookings")
def partner_transport_bookings(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")
    wallet = _load_partner_wallet(db, partner.id)
    trips = _list_transport_trips(db, partner_id=partner.id, limit=300)
    return {
        "partner_id": partner.id,
        "partner_code": partner.partner_code,
        "wallet": wallet,
        "items": trips,
    }


@router.post("/partner/transport/bookings/{trip_id}/fare")
def partner_transport_update_fare(trip_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")
    trip = _load_transport_trip(db, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Booking not found")
    if str(trip.get("partner_id") or "") != str(partner.id):
        raise HTTPException(status_code=403, detail="Not your booking")
    if str(trip.get("status") or "") not in {"booked"}:
        raise HTTPException(status_code=400, detail="Fare can be updated only before trip start")

    try:
        new_fare = round(max(1.0, float((payload or {}).get("fare_final") or 0)), 2)
    except Exception:
        raise HTTPException(status_code=400, detail="Valid fare_final required")

    trip["fare_final"] = new_fare
    trip["required_commission_reserve"] = round(new_fare * (max(0.0, float(partner.commission_percent or 0)) / 100.0), 2)
    saved = _save_transport_trip(db, trip)

    order_id = str(trip.get("order_id") or "")
    row = db.query(PublicOrder).filter(PublicOrder.id == order_id).first()
    if row:
        try:
            items = json.loads(row.items_json or "[]")
        except Exception:
            items = []
        if isinstance(items, list) and items:
            it = dict(items[0] or {})
            it["price"] = new_fare
            it["unit_base_price"] = new_fare
            it["mrp"] = new_fare
            it["pre_tax"] = new_fare
            it["subtotal"] = new_fare
            items[0] = it
            row.items_json = json.dumps(items)
        row.total_amount = new_fare
        db.commit()

    return {"ok": True, "booking": saved}


@router.post("/partner/transport/bookings/{trip_id}/confirm")
def partner_transport_confirm_booking(trip_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")
    trip = _load_transport_trip(db, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Booking not found")
    if str(trip.get("partner_id") or "") != str(partner.id):
        raise HTTPException(status_code=403, detail="Not your booking")
    if str(trip.get("status") or "") not in {"booked"}:
        raise HTTPException(status_code=400, detail="Booking can be confirmed only once before trip start")

    order_id = str(trip.get("order_id") or "")
    row = db.query(PublicOrder).filter(PublicOrder.id == order_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")

    fare_final = round(float(trip.get("fare_final") or 0), 2)
    if fare_final <= 0:
        raise HTTPException(status_code=400, detail="Set final fare first before confirming booking")

    required = round(float(trip.get("required_commission_reserve") or 0), 2)
    if required <= 0:
        required = round(fare_final * (max(0.0, float(partner.commission_percent or 0)) / 100.0), 2)
        trip["required_commission_reserve"] = required

    wallet = _load_partner_wallet(db, partner.id)
    available = round(float(wallet.get("balance") or 0), 2)
    if available + 1e-9 < required:
        raise HTTPException(
            status_code=400,
            detail={"code": "WALLET_INSUFFICIENT", "required_amount": required, "available_balance": available, "shortfall": round(required - available, 2)},
        )

    fare_final = round(float(trip.get("fare_final") or row.total_amount or 0), 2)
    order_items = []
    try:
        order_items = json.loads(row.items_json or "[]")
    except Exception:
        order_items = []
    if isinstance(order_items, list) and order_items:
        item = dict(order_items[0] or {})
        item["price"] = fare_final
        item["unit_base_price"] = fare_final
        item["mrp"] = fare_final
        item["pre_tax"] = fare_final
        item["subtotal"] = fare_final
        order_items[0] = item
        row.items_json = json.dumps(order_items)
    row.total_amount = fare_final
    row.status = "pending_approval"
    db.commit()

    auto_result = admin_approve_order(
        order_id=order_id,
        payload={"note": "Auto-approved transport booking after final fare confirmation"},
        db=db,
        current_user=SimpleNamespace(role="super_admin"),
    )

    trip["status"] = "confirmed"
    trip["confirmed_at"] = now_iso()
    trip["order_status"] = "paid"
    saved = _save_transport_trip(db, trip)

    return {
        "ok": True,
        "booking": saved,
        "order": {"id": order_id, "order_no": f"ORD-{order_id[:8].upper()}", "status": "paid", "auto_approved": True},
        "rewards_earned": auto_result.get("rewards_earned", {}),
        "commission_split": auto_result.get("commission_split", {}),
        "message": "Final fare locked, commission credited to METHO, and trip auto-approved.",
    }


@router.post("/partner/transport/bookings/{trip_id}/reject")
def partner_transport_reject_booking(trip_id: str, payload: dict | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")
    trip = _load_transport_trip(db, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Booking not found")
    if str(trip.get("partner_id") or "") != str(partner.id):
        raise HTTPException(status_code=403, detail="Not your booking")
    if str(trip.get("status") or "") not in {"booked"}:
        raise HTTPException(status_code=400, detail="Only new booked requests can be rejected")

    reason = str((payload or {}).get("reason") or "").strip() or "Rejected by partner"

    # Reject does not touch commission reserve; commission flow remains only in confirm path.
    trip["status"] = "rejected"
    trip["response_note"] = reason
    trip["rejected_at"] = now_iso()
    trip["payment_status"] = "cancelled"
    saved = _save_transport_trip(db, trip)

    order_id = str(trip.get("order_id") or "")
    row = db.query(PublicOrder).filter(PublicOrder.id == order_id).first()
    if row:
        row.status = "rejected"
        db.commit()

    return {
        "ok": True,
        "booking": saved,
        "order": {"id": order_id, "status": "rejected"},
        "message": "Booking request rejected by partner.",
    }


@router.post("/partner/transport/bookings/{trip_id}/start")
def partner_transport_start_trip(trip_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")
    trip = _load_transport_trip(db, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Booking not found")
    if str(trip.get("partner_id") or "") != str(partner.id):
        raise HTTPException(status_code=403, detail="Not your booking")
    if str(trip.get("status") or "") not in {"confirmed"}:
        raise HTTPException(status_code=400, detail="Trip cannot be started in current status")

    trip["status"] = "on_trip"
    trip["started_at"] = now_iso()
    saved = _save_transport_trip(db, trip)
    wallet = _load_partner_wallet(db, partner.id)
    return {"ok": True, "booking": saved, "wallet": wallet}


@router.post("/partner/transport/bookings/{trip_id}/complete")
def partner_transport_complete_trip(trip_id: str, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")
    trip = _load_transport_trip(db, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Booking not found")
    if str(trip.get("partner_id") or "") != str(partner.id):
        raise HTTPException(status_code=403, detail="Not your booking")
    if str(trip.get("status") or "") not in {"on_trip"}:
        raise HTTPException(status_code=400, detail="Trip can be completed only after start")

    trip["status"] = "completed"
    trip["completed_at"] = now_iso()
    saved = _save_transport_trip(db, trip)
    payment_profile = _transport_partner_payment_profile(db, partner, request)
    return {
        "ok": True,
        "booking": saved,
        "payment_profile": payment_profile,
        "message": "Show this QR/UPI to customer at destination for payment.",
    }


@router.post("/partner/transport/bookings/{trip_id}/mark-paid")
def partner_transport_mark_paid(trip_id: str, payload: dict | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")
    trip = _load_transport_trip(db, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Booking not found")
    if str(trip.get("partner_id") or "") != str(partner.id):
        raise HTTPException(status_code=403, detail="Not your booking")
    if str(trip.get("status") or "") not in {"completed", "paid"}:
        raise HTTPException(status_code=400, detail="Trip payment can be marked after completion")

    txn_id = str((payload or {}).get("txn_id") or "").strip()
    payer_name = str((payload or {}).get("payer_name") or trip.get("customer_name") or "Customer").strip()
    if not txn_id and str(trip.get("status") or "") != "paid":
        raise HTTPException(status_code=400, detail="txn_id is required")

    trip["status"] = "paid"
    trip["payment_status"] = "paid"
    trip["txn_id"] = txn_id or str(trip.get("txn_id") or "")
    trip["paid_at"] = now_iso()
    saved = _save_transport_trip(db, trip)

    order_id = str(trip.get("order_id") or "")
    row = db.query(PublicOrder).filter(PublicOrder.id == order_id).first()
    if row:
        row.txn_id = str(trip.get("txn_id") or row.txn_id or "")
        row.payer_name = payer_name or row.payer_name
        row.payment_method = "upi"
        db.commit()

    return {
        "ok": True,
        "booking": saved,
        "order": {
            "id": order_id,
            "status": (row.status if row else "paid"),
            "auto_approved": False,
        },
        "next_step": "Payment recorded. Booking was already commission-credited at confirmation; no extra admin approval is needed.",
    }


@router.post("/partner/upload/topup-proof")
async def partner_upload_topup_proof(file: UploadFile = File(...), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    image_name, pdf_name = _save_image_upload_with_pdf_copy(file, UPI_QR_UPLOAD_DIR, "partner-topup-proof", UPI_PROOF_MAX_UPLOAD_BYTES)
    return {
        "ok": True,
        "url": f"/api/files/payment_screenshots/{image_name}",
        "storage_path": f"payment_screenshots/{image_name}",
        "pdf_url": (f"/api/files/payment_screenshots/{pdf_name}" if pdf_name else ""),
        "pdf_storage_path": (f"payment_screenshots/{pdf_name}" if pdf_name else ""),
    }


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

    def _to_public_ref(value: str) -> str:
        raw = str(value or "").strip()
        if not raw:
            return ""
        if raw.startswith("data:"):
            return raw
        return _file_url(raw, request)

    # Drop stale file-path slots whose files were wiped (ephemeral storage).
    alive_items = [path if (path.startswith("data:") or not path.startswith("/")) else path for path in items]
    alive_items = [
        _to_public_ref(path) if path and (path.startswith("data:") or (BRANDING_UPLOAD_DIR / Path(path).name).exists()) else ""
        for path in items
    ]

    return {
        "partner_id": partner.id,
        "partner_code": partner.partner_code,
        "items": alive_items,
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

    ext, content, mime = _read_validated_image_upload(file, PARTNER_IMAGE_MAX_UPLOAD_BYTES)

    # Keep filesystem copy for backward compatibility, but persist featured slot as data URL
    # so the image survives storage cleanup/redeploy on ephemeral hosts.
    name = f"partner-featured-{slot}-{uuid.uuid4().hex}{ext}"
    (BRANDING_UPLOAD_DIR / name).write_bytes(content)
    data_url = f"data:{mime};base64,{base64.b64encode(content).decode('ascii')}"
    items[slot - 1] = data_url

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


@router.put("/partner/featured-images")
def partner_save_featured_images(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if getattr(current_user, "role", "") != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")

    raw_items = payload.get("items") if isinstance(payload, dict) else []
    items = ["", "", "", "", ""]
    if isinstance(raw_items, list):
        for idx in range(min(5, len(raw_items))):
            items[idx] = str(raw_items[idx] or "").strip()

    doc = {"items": items, "updated_at": now_iso()}
    row = db.query(AppSetting).filter(AppSetting.key == _partner_featured_images_key(partner.id)).first()
    if not row:
        db.add(AppSetting(key=_partner_featured_images_key(partner.id), value_json=json.dumps(doc), updated_at=datetime.now(timezone.utc)))
    else:
        row.value_json = json.dumps(doc)
        row.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "partner_id": partner.id,
        "partner_code": partner.partner_code,
        "items": items,
    }


@router.post("/admin/partner-featured-clear/{partner_code}")
def admin_clear_partner_featured(partner_code: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Admin endpoint: clear broken file-path featured image slots for a partner."""
    _require_admin_user(current_user)
    partner = db.query(AssociatePartner).filter(AssociatePartner.partner_code == partner_code).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    key = _partner_featured_images_key(partner.id)
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    cleared = 0
    if row and row.value_json:
        try:
            payload = json.loads(row.value_json or "{}")
            raw = payload.get("items") if isinstance(payload, dict) else []
            items = ["", "", "", "", ""]
            if isinstance(raw, list):
                for idx in range(min(5, len(raw))):
                    val = str(raw[idx] or "").strip()
                    if val.startswith("data:"):
                        items[idx] = val  # keep valid data URLs
                    else:
                        cleared += 1  # drop broken file paths
            row.value_json = json.dumps({"items": items, "updated_at": now_iso()})
            row.updated_at = datetime.now(timezone.utc)
            db.commit()
        except Exception:
            pass
    return {"ok": True, "partner_code": partner_code, "slots_cleared": cleared}


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
    if str(doc.get("status") or "").lower() == "approved" and str(doc.get("razorpay_payment_id") or "") == razorpay_payment_id:
        return {"ok": True, "already_processed": True, "request": doc, "wallet": _load_partner_wallet(db, partner.id), "auto_approval": {"attempted": 0, "approved": 0}}
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

    for candidate in db.query(AppSetting).filter(AppSetting.key.like("partner_topup:%")).all():
        if candidate.key == row.key:
            continue
        try:
            candidate_doc = json.loads(candidate.value_json or "{}")
        except Exception:
            candidate_doc = {}
        if str(candidate_doc.get("razorpay_payment_id") or "") == razorpay_payment_id:
            raise HTTPException(status_code=409, detail="Razorpay payment reference already credited")

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
        "transaction_type": "RAZORPAY_RECHARGE_CREDIT",
        "reference_id": f"razorpay-recharge:{razorpay_payment_id}",
        "amount": amount,
        "credit": amount,
        "debit": 0.0,
        "description": "Razorpay top-up credited instantly",
        "ref_request_id": request_id,
        "ref_payment_id": razorpay_payment_id,
        "created_at": now_iso(),
    }
    _append_partner_wallet_tx(db, partner.id, tx)
    _append_financial_ledger(
        db,
        reference_id=f"razorpay-recharge:{razorpay_payment_id}",
        transaction_type="RAZORPAY_RECHARGE_CREDIT",
        credit=amount,
        balance=wallet["balance"],
        partner_id=partner.id,
    )

    doc["status"] = "approved"
    doc["reviewed_at"] = now_iso()
    doc["review_note"] = "Auto-approved via Razorpay verification"
    doc["razorpay_order_id"] = razorpay_order_id
    doc["razorpay_payment_id"] = razorpay_payment_id
    doc["txn_id"] = razorpay_payment_id
    row.value_json = json.dumps(doc)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()

    auto = _auto_approve_pending_orders_for_partner(db, partner.id, "razorpay top-up")
    return {"ok": True, "request": doc, "wallet": wallet, "auto_approval": auto}


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

    auto = _auto_approve_pending_orders_for_partner(db, partner_id, "admin top-up approval")
    return {"ok": True, "request": doc, "wallet": wallet, "auto_approval": auto}


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
def kyc_me(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    row = db.query(AppSetting).filter(AppSetting.key == f"member_profile:{current_user.id}").first()
    try:
        profile = json.loads(row.value_json or "{}") if row else {}
    except Exception:
        profile = {}
    return {"status": "approved", "submitted_at": now_iso(), "nid_number": str(profile.get("nid_number") or ""), "address": str(profile.get("address") or "")}


@router.post("/kyc/submit")
def kyc_submit(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    key = f"member_profile:{current_user.id}"
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    profile = {
        "nid_number": str((payload or {}).get("nid_number") or "").strip(),
        "address": str((payload or {}).get("address") or "").strip(),
        "date_of_birth": str((payload or {}).get("date_of_birth") or "").strip(),
    }
    if not row:
        db.add(AppSetting(key=key, value_json=json.dumps(profile), updated_at=datetime.now(timezone.utc)))
    else:
        row.value_json = json.dumps(profile)
        row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "status": "pending", "message": "KYC submitted", "kyc": {"status": "pending", **profile}}


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
    partner_ids = {str(p.id) for p in rows}

    product_rows = db.query(PartnerProduct.id, PartnerProduct.partner_id, PartnerProduct.category).all()
    product_partner_map: dict[str, str] = {}
    product_category_map: dict[str, str] = {}
    for product_id, partner_id, category in product_rows:
        pid = str(product_id or "")
        owner = str(partner_id or "")
        if not pid or not owner:
            continue
        product_partner_map[pid] = owner
        product_category_map[pid] = str(category or "General")

    service_stats_map: dict[str, dict] = {}
    for order in db.query(PublicOrder).all():
        try:
            items = json.loads(order.items_json or "[]")
        except Exception:
            items = []
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            listing_type = str(item.get("listing_type") or item.get("item_kind") or "").strip().lower()
            is_service = bool(item.get("is_service") or item.get("service_booking_enabled") or listing_type == "service")
            if not is_service:
                continue

            product_id = str(item.get("product_id") or "").strip()
            partner_id = product_partner_map.get(product_id)
            if not partner_id or partner_id not in partner_ids:
                continue

            bucket = service_stats_map.setdefault(
                partner_id,
                {
                    "service_booking_count": 0,
                    "service_paid_booking_count": 0,
                    "service_sales_total": 0.0,
                    "service_categories": set(),
                },
            )
            bucket["service_booking_count"] += 1
            if str(order.status or "").strip().lower() in {"paid"}:
                bucket["service_paid_booking_count"] += 1

            amount = float(item.get("subtotal") or item.get("price") or 0)
            if amount > 0:
                bucket["service_sales_total"] += amount

            category = str(item.get("category") or product_category_map.get(product_id) or "General").strip()
            if category:
                bucket["service_categories"].add(category)

    transport_trip_count_map: dict[str, int] = {}
    for trip in _list_transport_trips(db, limit=1000000):
        pid = str((trip or {}).get("partner_id") or "")
        if not pid:
            continue
        transport_trip_count_map[pid] = int(transport_trip_count_map.get(pid) or 0) + 1

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
            "service_sector": str((_load_json_setting(db, f"partner_classification:partner:{p.id}", {}) or {}).get("service_sector") or ""),
            "service_category": str((_load_json_setting(db, f"partner_classification:partner:{p.id}", {}) or {}).get("service_category") or ""),
            "contact_person": p.contact_person,
            "phone": p.phone,
            "email": p.email,
            "address": p.address,
            "city": p.city,
            "state": p.state,
            "pincode": p.pincode,
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
            "service_booking_count": int((service_stats_map.get(str(p.id), {}) or {}).get("service_booking_count") or 0),
            "service_paid_booking_count": int((service_stats_map.get(str(p.id), {}) or {}).get("service_paid_booking_count") or 0),
            "service_sales_total": round(float((service_stats_map.get(str(p.id), {}) or {}).get("service_sales_total") or 0), 2),
            "service_categories": sorted(list((service_stats_map.get(str(p.id), {}) or {}).get("service_categories") or set()))[:8],
            "transport_trip_count": int(transport_trip_count_map.get(str(p.id)) or 0),
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

    _purge_partner_related_records(db, p)
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

    _purge_partner_related_records(db, p)
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
    result = []
    for r in rows:
        classification_row = db.query(AppSetting).filter(AppSetting.key == f"partner_classification:request:{r.id}").first()
        try:
            classification = json.loads(classification_row.value_json or "{}") if classification_row else {}
        except Exception:
            classification = {}
        result.append({
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
            "service_sector": classification.get("service_sector", ""),
            "service_category": classification.get("service_category", ""),
            "shop_sector": classification.get("shop_sector", ""),
            "shop_category": classification.get("shop_category", ""),
            "district": classification.get("district", ""),
        })
    return result


@router.post("/admin/partner-requests/{request_id}/approve")
def admin_partner_request_approve(request_id: str, payload: dict | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    req = db.query(PartnerRequest).filter(PartnerRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Partner request not found")
    if str(req.status or "").lower() != "pending":
        raise HTTPException(status_code=400, detail=f"Only pending partner requests can be approved (current: {req.status})")

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
        partner_code = f"MTH-PARTNER-{next_suffix:03d}"
        while partner_code in existing_codes:
            next_suffix += 1
            partner_code = f"MTH-PARTNER-{next_suffix:03d}"
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

    db.flush()
    classification_row = db.query(AppSetting).filter(
        AppSetting.key == f"partner_classification:request:{request_id}"
    ).first()
    if classification_row:
        partner_classification_key = f"partner_classification:partner:{partner.id}"
        partner_classification_row = db.query(AppSetting).filter(AppSetting.key == partner_classification_key).first()
        if partner_classification_row:
            partner_classification_row.value_json = classification_row.value_json
            partner_classification_row.updated_at = datetime.now(timezone.utc)
        else:
            db.add(AppSetting(
                key=partner_classification_key,
                value_json=classification_row.value_json,
                updated_at=datetime.now(timezone.utc),
            ))

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
def admin_mps_fund(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    settings = load_settings(db)
    period = datetime.now(timezone.utc).strftime("%Y-%m")
    pool = _calculate_sql_pool(db, period)
    approved_claims = sum(float(c.get("amount") or 0) for c in MPS_CLAIMS if c.get("status") == "approved")
    contribution = pool["mps_fund"]
    rules = {key: settings.get(key, 0) for key in ("mps_min_active_months", "mps_min_monthly_purchase", "mps_max_claim_amount", "mps_min_claim_gap_days", "mps_benefit_duration_months")}
    return {
        "balance": round(max(0.0, contribution - approved_claims), 2),
        "total_contributions": round(contribution, 2),
        "total_approved_claims": round(approved_claims, 2),
        "rules": rules,
        "available_balance": round(max(0.0, contribution - approved_claims), 2),
        "total_contribution": round(contribution, 2),
        "total_payout": round(approved_claims, 2),
    }


@router.get("/admin/mps-claims")
def admin_mps_claims(current_user=Depends(get_current_user)):
    return MPS_CLAIMS


@router.post("/admin/mps-claims")
def admin_mps_claims_create(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    settings = load_settings(db)
    amount = float(payload.get("amount") or 0)
    max_claim = float(settings.get("mps_max_claim_amount") or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Claim amount must be greater than zero")
    if max_claim > 0 and amount > max_claim:
        raise HTTPException(status_code=400, detail=f"Claim exceeds maximum allowed amount ₹{max_claim:.2f}")
    claim = {
        "id": str(uuid.uuid4()),
        "user_id": payload.get("user_id", ""),
        "user_name": "Member",
        "amount": amount,
        "reason": payload.get("reason", ""),
        "status": "pending",
        "created_at": now_iso(),
    }
    MPS_CLAIMS.insert(0, claim)
    return claim


@router.post("/admin/mps-claims/{claim_id}/approve")
def admin_mps_claims_approve(claim_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    fund = admin_mps_fund(db, current_user)
    for c in MPS_CLAIMS:
        if c["id"] == claim_id:
            if c.get("status") != "pending":
                raise HTTPException(status_code=400, detail="Claim is already decided")
            if float(c.get("amount") or 0) > float(fund.get("available_balance") or 0):
                raise HTTPException(status_code=400, detail="Insufficient MPS fund balance")
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
def settlement_preview(year: int, month: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    period = f"{year}-{str(month).zfill(2)}"
    pool = _calculate_sql_pool(db, period)
    member_totals = {}
    for order in db.query(PublicOrder).filter(PublicOrder.status == "paid").all():
        if _period_for_datetime(order.created_at) != period:
            continue
        member = _order_member(db, order)
        if not member:
            continue
        try:
            items = json.loads(order.items_json or "[]")
        except Exception:
            items = []
        amount = sum(float(item.get("subtotal") or 0) for item in items if str(item.get("product_type") or "").lower() in METHO_VEGETABLE_LIKE_PRODUCT_TYPES)
        member_totals[member.id] = member_totals.get(member.id, 0.0) + amount
    total_points = sum(max(0.0, amount) / 100.0 for amount in member_totals.values())
    point_value = round(pool["member_pool"] / total_points, 4) if total_points else 0.0
    member_lines = [{"user_id": uid, "monthly_purchase": round(amount, 2), "points": round(amount / 100.0, 4), "reward": round((amount / 100.0) * point_value, 2)} for uid, amount in member_totals.items() if amount > 0]
    settings = load_settings(db)
    leader_min_direct = int(settings.get("leader_min_direct_members") or 0)
    leader_min_active = int(settings.get("leader_min_active_members") or 0)
    leader_min_personal = float(settings.get("leader_min_personal_monthly_purchase") or settings.get("leader_min_personal_product_sales") or 0)
    leader_min_team = float(settings.get("leader_min_team_monthly_purchase") or 0)
    leader_min_days = int(settings.get("leader_min_active_days") or 0)
    leader_tiers = {
        "leader": ("Leader", 50.0, {x.strip().lower() for x in str(settings.get("leader_tier_leader_ranks") or "starter,bronze").replace("|", ",").split(",") if x.strip()}),
        "elite_leader": ("Elite Leader", 30.0, {x.strip().lower() for x in str(settings.get("leader_tier_elite_ranks") or "silver,gold").replace("|", ",").split(",") if x.strip()}),
        "crown_leader": ("Crown Leader", 20.0, {x.strip().lower() for x in str(settings.get("leader_tier_crown_ranks") or "diamond").replace("|", ",").split(",") if x.strip()}),
    }
    leader_lines = []
    leader_pool_points = {key: 0.0 for key in leader_tiers}
    for user_id, amount in member_totals.items():
        direct_ids = {rel.user_id for rel in db.query(UserReferral).filter(UserReferral.sponsor_user_id == user_id).all()}
        if len(direct_ids) < leader_min_direct or amount < leader_min_personal:
            continue
        team_amount = sum(member_totals.get(child_id, 0.0) for child_id in direct_ids)
        active_direct = sum(1 for child_id in direct_ids if member_totals.get(child_id, 0.0) > 0)
        user = db.query(User).filter(User.id == user_id).first()
        account_days = max(0, (datetime.now(timezone.utc) - (user.created_at.replace(tzinfo=timezone.utc) if user and user.created_at and user.created_at.tzinfo is None else user.created_at if user and user.created_at else datetime.now(timezone.utc))).days)
        if team_amount < leader_min_team or active_direct < leader_min_active or account_days < leader_min_days:
            continue
        rank = str(getattr(user, "role", "member") or "member").lower()
        # SQL has no separate rank column; use configured business thresholds for a stable tier.
        rank = "diamond" if team_amount >= float(settings.get("rank_diamond_bv") or 100000) else "gold" if team_amount >= float(settings.get("rank_gold_bv") or 50000) else "silver" if team_amount >= float(settings.get("rank_silver_bv") or 20000) else "bronze" if team_amount >= float(settings.get("rank_bronze_bv") or 5000) else "starter"
        tier_key = next((key for key, (_, _, ranks) in leader_tiers.items() if rank in ranks), "leader")
        points = round(amount / 100.0, 4)
        leader_pool_points[tier_key] += points
        leader_lines.append({"user_id": user_id, "monthly_purchase": round(amount, 2), "points": points, "tier": tier_key, "tier_label": leader_tiers[tier_key][0], "reward": 0.0})
    for line in leader_lines:
        key = line["tier"]
        tier_pool = round(pool["leader_pool"] * leader_tiers[key][1] / 100.0, 2)
        value = round(tier_pool / leader_pool_points[key], 4) if leader_pool_points[key] else 0.0
        line["point_value"] = value
        line["reward"] = round(line["points"] * value, 2)
    leader_rewards = round(sum(line["reward"] for line in leader_lines), 2)
    return {
        "period": period,
        "already_settled": False,
        "pool_snapshot": {"gross_sales": pool["gross_sales"], "commission_collected": pool["commission_pool"], "member_pool": pool["member_pool"], "leader_pool": pool["leader_pool"], "mps_fund_contribution": pool["mps_fund"], "company_fund": pool["company_fund"], "technology_reserve": pool["technology_reserve"]},
        "member_settlement": {"total_points": round(total_points, 4), "point_value": point_value, "total_reward_distributed": round(sum(x["reward"] for x in member_lines), 2), "lines": member_lines},
        "leader_settlement": {"qualified_count": len(leader_lines), "total_points": round(sum(leader_pool_points.values()), 4), "point_value": round(leader_rewards / sum(leader_pool_points.values()), 4) if sum(leader_pool_points.values()) else 0, "total_reward_distributed": leader_rewards, "split_percent": {key: value[1] for key, value in leader_tiers.items()}, "lines": leader_lines},
    }


@router.post("/admin/settlement/execute")
def settlement_execute(year: int, month: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    period = f"{year}-{str(month).zfill(2)}"
    key = f"sql_settlement:{period}"
    if _load_json_setting(db, key, {"settled": False}).get("settled"):
        raise HTTPException(status_code=400, detail=f"Period {period} is already settled")
    preview = settlement_preview(year, month, db, current_user)
    credited_member = 0.0
    credited_leader = 0.0
    for line in preview["member_settlement"]["lines"] + preview["leader_settlement"]["lines"]:
        amount = round(float(line.get("reward") or 0), 2)
        if amount <= 0:
            continue
        wallet_state = _load_user_wallet(db, line["user_id"])
        wallet_state["balance"] += amount
        wallet_state["total_income"] += amount
        wallet_state["total_bonus"] += amount
        if line in preview["member_settlement"]["lines"]:
            wallet_state["member_reward_credited"] += amount
            credited_member += amount
        else:
            wallet_state["leader_reward_credited"] += amount
            credited_leader += amount
        _save_user_wallet(db, line["user_id"], wallet_state)
    _save_json_setting(db, key, {"settled": True, "period": period, "member_reward": credited_member, "leader_reward": credited_leader})
    db.commit()
    return {"ok": True, "period": period, "status": "completed", "member_reward": credited_member, "leader_reward": credited_leader}


@router.get("/admin/settlements")
def settlement_history(current_user=Depends(get_current_user)):
    return []


@router.get("/admin/accounts")
def admin_accounts(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    _require_admin_user(current_user)
    auto = _accounts_auto_summary(db)
    manual = _load_admin_accounts_ledger(db)
    entries = list(manual.get("entries") or [])

    income_total = round(float(auto.get("income_total") or 0), 2)
    expense_total = round(float(auto.get("expense_total") or 0), 2)
    manual_income = 0.0
    manual_expense = 0.0
    for entry in entries:
        amount = round(float(entry.get("amount") or 0), 2)
        if str(entry.get("direction") or "expense").lower() == "income" or amount > 0 and str(entry.get("direction") or "").lower() == "income":
            manual_income += amount
        else:
            manual_expense += abs(amount)

    balance = round(income_total + manual_income - expense_total - manual_expense, 2)
    bucket_totals: dict[str, dict[str, float]] = {}
    for entry in entries:
        bucket = str(entry.get("category") or "Miscellaneous").strip() or "Miscellaneous"
        direction = str(entry.get("direction") or "expense").lower()
        amount = round(float(entry.get("amount") or 0), 2)
        stat = bucket_totals.setdefault(bucket, {"income": 0.0, "expense": 0.0})
        if direction == "income":
            stat["income"] += amount
        else:
            stat["expense"] += abs(amount)

    return {
        "summary": {
            "income_total": income_total + manual_income,
            "expense_total": expense_total + manual_expense,
            "net_balance": balance,
            "manual_income_total": round(manual_income, 2),
            "manual_expense_total": round(manual_expense, 2),
            "auto_income_total": income_total,
            "auto_expense_total": expense_total,
        },
        "auto": auto,
        "manual_entries": entries,
        "category_totals": bucket_totals,
        "last_updated": str(manual.get("updated_at") or now_iso()),
    }


@router.post("/admin/reset-current-data")
def admin_reset_current_data(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    _require_admin_user(current_user)
    result = _clear_current_admin_transaction_data(db)
    return {
        "ok": True,
        "message": "Current admin-side transaction data cleared. Fresh start ready.",
        "result": result,
    }


@router.post("/admin/accounts/entries")
def admin_accounts_add_entry(payload: dict, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    _require_admin_user(current_user)
    category = str(payload.get("category") or "Miscellaneous").strip() or "Miscellaneous"
    direction = str(payload.get("direction") or "expense").strip().lower()
    if direction not in {"income", "expense"}:
        direction = "expense"
    amount = round(abs(float(payload.get("amount") or 0)), 2)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")

    ledger = _load_admin_accounts_ledger(db)
    entries = list(ledger.get("entries") or [])
    entry = {
        "id": str(uuid.uuid4()),
        "category": category,
        "direction": direction,
        "amount": amount,
        "description": str(payload.get("description") or "").strip(),
        "reference": str(payload.get("reference") or "").strip(),
        "date": str(payload.get("date") or now_iso()),
        "created_at": now_iso(),
        "created_by": getattr(current_user, "id", ""),
        "created_by_name": getattr(current_user, "name", "Admin"),
    }
    entries.insert(0, entry)
    ledger["entries"] = entries
    saved = _save_admin_accounts_ledger(db, ledger)
    return {"ok": True, "entry": entry, "ledger": saved}


@router.get("/admin/withdrawals")
def admin_withdrawals(status_filter: str | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    rows = _load_withdrawals(db)
    if not status_filter:
        return rows
    return [row for row in rows if str(row.get("status") or "") == str(status_filter)]


@router.post("/admin/withdrawals/{withdrawal_id}/approve")
def admin_withdrawals_approve(withdrawal_id: str, payload: dict | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    rows = _load_withdrawals(db)
    for row in rows:
        if str(row.get("id") or "") != str(withdrawal_id):
            continue
        if row.get("status") != "pending":
            raise HTTPException(status_code=400, detail="Withdrawal is already decided")
        row["status"] = "approved"
        row["utr"] = str((payload or {}).get("utr") or "").strip()
        row["approved_at"] = now_iso()
        _save_withdrawals(db, rows)
        db.commit()
        return {"id": withdrawal_id, "status": "approved", "gross_amount": row.get("gross_amount"), "net_amount": row.get("net_amount"), "tds_amount": row.get("tds_amount"), "admin_charge_amount": row.get("admin_charge_amount")}
    raise HTTPException(status_code=404, detail="Withdrawal not found")


@router.post("/admin/withdrawals/{withdrawal_id}/reject")
def admin_withdrawals_reject(withdrawal_id: str, payload: dict | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    rows = _load_withdrawals(db)
    for row in rows:
        if str(row.get("id") or "") != str(withdrawal_id):
            continue
        if row.get("status") != "pending":
            raise HTTPException(status_code=400, detail="Withdrawal is already decided")
        wallet = _load_user_wallet(db, str(row.get("user_id") or ""))
        refund = float(row.get("gross_amount") or row.get("amount") or 0)
        wallet["balance"] = round(float(wallet["balance"]) + refund, 2)
        wallet["total_withdrawn"] = round(max(0.0, float(wallet["total_withdrawn"]) - refund), 2)
        _save_user_wallet(db, str(row.get("user_id") or ""), wallet)
        row["status"] = "rejected"
        row["rejection_reason"] = str((payload or {}).get("reason") or "Not approved")
        row["rejected_at"] = now_iso()
        _save_withdrawals(db, rows)
        db.commit()
        return {"id": withdrawal_id, "status": "rejected", "refund_amount": refund}
    raise HTTPException(status_code=404, detail="Withdrawal not found")


@router.post("/admin/upload/upi-qr")
async def upload_upi_qr(file: UploadFile = File(...), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    name = _save_image_upload(file, UPI_QR_UPLOAD_DIR, "upi-qr")
    saved_path = UPI_QR_UPLOAD_DIR / name
    content_type = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
    }.get(saved_path.suffix.lower(), "application/octet-stream")
    persisted_url = f"data:{content_type};base64,{base64.b64encode(saved_path.read_bytes()).decode('ascii')}"
    return {"ok": True, "url": persisted_url, "storage_url": f"/api/files/payment_screenshots/{name}"}


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
        "site_logo", "landing_hero", "landing_tourism_banner", "landing_metho_delivery_banner", "product_placeholder", "directory_hero", "social_share",
        "top_leader_1", "top_leader_2", "top_leader_3", "top_leader_4", "top_leader_5", "top_leader_6",
    }
    safe_purpose = "".join(ch for ch in str(purpose or "branding") if ch.isalnum() or ch in {"-", "_"}).strip("-_")
    safe_purpose = safe_purpose or "branding"
    if safe_purpose not in allowed_purposes:
        raise HTTPException(status_code=400, detail=f"purpose must be one of {sorted(allowed_purposes)}")
    ext, content, _mime = _read_validated_image_upload(file, GLOBAL_IMAGE_MAX_UPLOAD_BYTES)
    name = f"{safe_purpose}-{uuid.uuid4().hex}{ext}"
    (BRANDING_UPLOAD_DIR / name).write_bytes(content)
    return {"ok": True, "purpose": safe_purpose, "url": f"/api/files/branding_images/{name}"}


@router.post("/admin/upload/site-logo")
async def upload_site_logo_image(file: UploadFile = File(...), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    ext, content, _mime = _read_validated_image_upload(file, GLOBAL_IMAGE_MAX_UPLOAD_BYTES)
    name = f"site_logo-{uuid.uuid4().hex}{ext}"
    (BRANDING_UPLOAD_DIR / name).write_bytes(content)
    return {"ok": True, "purpose": "site_logo", "url": f"/api/files/branding_images/{name}"}


@router.post("/admin/upload/top-leader-image")
async def upload_top_leader_image(slot: int, file: UploadFile = File(...), current_user=Depends(get_current_user)):
    _require_admin_user(current_user)
    if slot not in {1, 2, 3, 4, 5, 6}:
        raise HTTPException(status_code=400, detail="slot must be 1 to 6")
    ext, content, _mime = _read_validated_image_upload(file, GLOBAL_IMAGE_MAX_UPLOAD_BYTES)
    name = f"top_leader_{slot}-{uuid.uuid4().hex}{ext}"
    (BRANDING_UPLOAD_DIR / name).write_bytes(content)
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
            "customer_order_session_minutes",
            "customer_order_otp_ttl_seconds",
            "customer_order_otp_length",
            "customer_order_otp_max_attempts",
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
            "metho_delivery_smart_cycle_percent",
            "metho_delivery_reward_pool_percent",
            "metho_rider_share_percent",
        ]
        for key in split_keys + ["smart_cycle_bonus_percent", "metho_commission_percent", "leader_match_percent", "first_partner_order_cashback_percent", "metho_delivery_smart_cycle_percent", "metho_delivery_reward_pool_percent", "metho_rider_share_percent"]:
            if payload.get(key) is not None:
                value = float(payload.get(key) or 0)
                if value < 0 or value > 100:
                    raise HTTPException(status_code=400, detail=f"{key} must be between 0 and 100")
        for key in non_negative_keys:
            if payload.get(key) is not None and float(payload.get(key) or 0) < 0:
                raise HTTPException(status_code=400, detail=f"{key} must be non-negative")
        if payload.get("customer_mobile_access_mode") is not None:
            mode = str(payload.get("customer_mobile_access_mode") or "").strip().lower()
            if mode not in CUSTOMER_ACCESS_MODES:
                raise HTTPException(status_code=400, detail="customer_mobile_access_mode must be mobile_only or mobile_otp")
            payload["customer_mobile_access_mode"] = mode
        if payload.get("customer_order_access_secret") is not None:
            payload["customer_order_access_secret"] = str(payload.get("customer_order_access_secret") or "").strip()
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
