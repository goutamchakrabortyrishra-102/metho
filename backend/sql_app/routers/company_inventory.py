import json
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AppSetting, Product, ProductMeta
from .auth import get_current_user

router = APIRouter(prefix="/api", tags=["company-inventory"])

_INVENTORY_KEY_PREFIX = "company_inventory:"


def _round2(value: float) -> float:
    return float(Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _round_whole(value: float) -> int:
    return int(Decimal(str(value or 0)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _inventory_key(product_id: str) -> str:
    return f"{_INVENTORY_KEY_PREFIX}{product_id}"


def _read_record(db: Session, product_id: str) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == _inventory_key(product_id)).first()
    if not row:
        return {}
    try:
        value = json.loads(row.value_json or "{}")
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def get_company_inventory_record(db: Session, product_id: str) -> dict:
    return _read_record(db, product_id)


def _write_record(db: Session, product_id: str, record: dict) -> None:
    row = db.query(AppSetting).filter(AppSetting.key == _inventory_key(product_id)).first()
    payload = json.dumps(record)
    now = datetime.now(timezone.utc)
    if row:
        row.value_json = payload
        row.updated_at = now
    else:
        db.add(AppSetting(key=_inventory_key(product_id), value_json=payload, updated_at=now))


def _product_code(db: Session, product_id: str) -> str:
    row = db.query(AppSetting).filter(AppSetting.key == f"product_code:{product_id}").first()
    if not row:
        return ""
    try:
        value = json.loads(row.value_json or "{}")
        if isinstance(value, dict):
            return str(value.get("code") or "").strip().upper()
    except Exception:
        pass
    return str(row.value_json or "").strip().upper()


def sync_company_inventory(db: Session, product: Product, purchase_cost=None) -> dict:
    meta = db.query(ProductMeta).filter(ProductMeta.product_id == product.id).first()
    existing = _read_record(db, product.id)
    resolved_purchase_cost = purchase_cost
    if resolved_purchase_cost is None:
        resolved_purchase_cost = existing.get("purchase_cost", 0)
    resolved_purchase_cost = max(0.0, _round2(float(resolved_purchase_cost or 0)))
    price_before_gst = max(0.0, _round2(float(product.price or 0)))
    gst_percent = max(0.0, _round2(float(meta.gst_percent if meta else 0)))
    gst_amount = _round2(price_before_gst * gst_percent / 100.0)
    final_price = _round_whole(price_before_gst + gst_amount)
    company_stock = max(0, int(product.stock or 0))
    record = {
        "product_id": product.id,
        "sku": _product_code(db, product.id),
        "name": product.name,
        "category": product.category,
        "purchase_cost": resolved_purchase_cost,
        "price_before_gst": price_before_gst,
        "gst_percent": gst_percent,
        "gst_amount": gst_amount,
        "final_price": final_price,
        "company_stock": company_stock,
        "purchase_value": _round2(resolved_purchase_cost * company_stock),
        "selling_value": _round2(final_price * company_stock),
        "potential_margin": _round2((final_price - resolved_purchase_cost) * company_stock),
        "stock_status": "out_of_stock" if company_stock <= 0 else ("low_stock" if company_stock <= 5 else "in_stock"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    _write_record(db, product.id, record)
    return record


def _require_admin(current_user) -> None:
    if getattr(current_user, "role", "") not in {"super_admin", "company_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Insufficient permissions")


@router.get("/admin/company-inventory")
def list_company_inventory(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    rows = []
    for product in db.query(Product).order_by(Product.created_at.desc()).all():
        rows.append(sync_company_inventory(db, product))
    db.commit()
    total_units = sum(int(row["company_stock"]) for row in rows)
    return {
        "summary": {
            "total_products": len(rows),
            "total_company_units": total_units,
            "total_purchase_value": _round2(sum(row["purchase_value"] for row in rows)),
            "low_stock": sum(row["stock_status"] == "low_stock" for row in rows),
            "out_of_stock": sum(row["stock_status"] == "out_of_stock" for row in rows),
            "potential_stock_margin": _round2(sum(row["potential_margin"] for row in rows)),
        },
        "items": rows,
    }
