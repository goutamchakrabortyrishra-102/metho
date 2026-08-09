from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AppSetting, AssociatePartner, Order, PartnerProduct, Product, ProductMeta
from ..schemas import OrderCreate, ProductCreate
from .auth import get_current_user
from .settings import load_settings, save_settings

router = APIRouter(prefix="/api", tags=["commerce"])


def _product_code_key(product_id: str) -> str:
    return f"product_code:{product_id}"


def _list_existing_codes(db: Session) -> set[str]:
    rows = db.query(AppSetting).filter(AppSetting.key.like("product_code:%")).all()
    out: set[str] = set()
    for row in rows:
        try:
            payload = row.value_json or ""
            if payload.strip().startswith("{"):
                import json

                doc = json.loads(payload)
                code = str(doc.get("code") or "").strip().upper()
            else:
                code = str(payload or "").strip().upper()
            if code:
                out.add(code)
        except Exception:
            continue
    return out


def _generate_product_code(db: Session, prefix: str) -> str:
    used = _list_existing_codes(db)
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
                import json

                doc = json.loads(payload)
                code = str(doc.get("code") or "").strip().upper()
            else:
                code = str(payload or "").strip().upper()
            if code:
                return code
        except Exception:
            pass

    prefix = "MTH" if (product_type or "metho") == "metho" else "APR"
    code = _generate_product_code(db, prefix)
    import json

    payload = json.dumps(
        {
            "code": code,
            "product_id": product_id,
            "product_type": product_type or "metho",
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    if not row:
        db.add(AppSetting(key=key, value_json=payload, updated_at=datetime.now(timezone.utc)))
    else:
        row.value_json = payload
        row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return code


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

    tiers = [{"qty": q, "price": cleaned[q]} for q in sorted(cleaned.keys())]
    return tiers


def _get_pricing_tier_map(db: Session) -> dict:
    settings = load_settings(db)
    tiers = settings.get("product_pricing_tiers")
    return tiers if isinstance(tiers, dict) else {}


def _set_product_pricing_tiers(db: Session, product_id: str, raw_tiers) -> list[dict]:
    tier_map = _get_pricing_tier_map(db)
    normalized = _normalize_pricing_tiers(raw_tiers)
    if normalized:
        tier_map[product_id] = normalized
    elif product_id in tier_map:
        del tier_map[product_id]
    save_settings(db, {"product_pricing_tiers": tier_map})
    return normalized


def _get_product_hidden_map(db: Session) -> dict:
    settings = load_settings(db)
    hidden_map = settings.get("product_hidden_map")
    if isinstance(hidden_map, dict):
        return hidden_map
    return {}


def _set_product_hidden_flag(db: Session, product_id: str, hidden: bool) -> bool:
    hidden_map = _get_product_hidden_map(db)
    if hidden:
        hidden_map[product_id] = True
    else:
        hidden_map.pop(product_id, None)
    save_settings(db, {"product_hidden_map": hidden_map})
    return bool(hidden_map.get(product_id, False))


def _get_product_youtube_map(db: Session) -> dict:
    settings = load_settings(db)
    youtube_map = settings.get("product_youtube_map")
    return youtube_map if isinstance(youtube_map, dict) else {}


def _set_product_youtube_url(db: Session, product_id: str, youtube_url: str) -> str:
    youtube_map = _get_product_youtube_map(db)
    normalized = str(youtube_url or "").strip()
    if normalized:
        youtube_map[str(product_id)] = normalized
    else:
        youtube_map.pop(str(product_id), None)
    save_settings(db, {"product_youtube_map": youtube_map})
    return normalized


def _compact_image_ref(value: str) -> str:
    return str(value or "").strip()


def _compact_public_image_url(value: str) -> str:
    return str(value or "").strip()


@router.get("/products")
def list_products(limit: int | None = None, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    products = db.query(Product).order_by(Product.created_at.desc()).all()
    meta_rows = db.query(ProductMeta).all()
    meta_map = {m.product_id: m for m in meta_rows}
    pricing_tier_map = _get_pricing_tier_map(db)
    hidden_map = _get_product_hidden_map(db)
    youtube_map = _get_product_youtube_map(db)

    out = []
    for p in products:
        if bool(hidden_map.get(p.id, False)):
            continue
        m = meta_map.get(p.id)
        mrp = float(m.mrp if m and m.mrp else p.price)
        discount_percent = float(m.discount_percent if m else 0)
        gst_percent = float(m.gst_percent if m else 0)
        price = float(p.price)
        if price <= 0:
            price = round(mrp * (1 - (discount_percent / 100)), 2)
        out.append(
            {
                "id": p.id,
                "product_code": _ensure_product_code(db, p.id, (m.product_type if m else "metho") or "metho"),
                "name": p.name,
                "category": p.category,
                "description": p.description,
                "price": price,
                "mrp": mrp,
                "discount_percent": discount_percent,
                "gst_percent": gst_percent,
                "stock": p.stock,
                "product_type": (m.product_type if m else "metho"),
                "image_url": (m.image_url if m else ""),
                "pricing_tiers": pricing_tier_map.get(p.id, []),
                "youtube_url": str(youtube_map.get(str(p.id)) or "").strip(),
                "hidden": bool(hidden_map.get(p.id, False)),
            }
        )
    is_authenticated = bool(str(authorization or "").strip())
    if not is_authenticated:
        public_limit = max(1, min(int(limit) if limit is not None else 200, 500))
        compacted = []
        for item in out[:public_limit]:
            next_item = dict(item)
            next_item["image_url"] = _compact_image_ref(next_item.get("image_url") or "")
            description = str(next_item.get("description") or "")
            if len(description) > 320:
                next_item["description"] = description[:320]
            compacted.append(next_item)
        return compacted

    if limit is not None:
        safe_limit = max(1, min(int(limit), 500))
        return out[:safe_limit]
    return out


@router.get("/products/public")
def list_public_products(limit: int = 120, db: Session = Depends(get_db)):
    safe_limit = max(1, min(int(limit), 500))
    rows = list_products(limit=safe_limit, db=db)
    for item in rows:
        item["image_url"] = _compact_public_image_url(item.get("image_url") or "")
    return rows


@router.get("/categories")
def list_categories(db: Session = Depends(get_db)):
    rows = db.query(Product.category).distinct().all()
    categories = [r[0] for r in rows if r and r[0]]
    return categories


@router.post("/seed")
def seed_products(db: Session = Depends(get_db)):
    if db.query(Product).count() > 0:
        return {"seeded": False, "message": "Already seeded"}

    defaults = [
        Product(name="METHO Immunity Booster", category="Health & Wellness", price=1200, stock=100, description="Daily wellness support."),
        Product(name="AAY Glow Face Serum", category="Beauty & Personal Care", price=850, stock=80, description="Botanical skincare serum."),
        Product(name="UPAY Pure Honey 500g", category="Nutrition", price=650, stock=150, description="Natural raw honey."),
        Product(name="Herbal Weight Care Tea", category="Health & Wellness", price=480, stock=200, description="Wellness herbal tea blend."),
    ]
    db.add_all(defaults)
    db.commit()
    return {"seeded": True, "message": "Seed complete", "products": len(defaults)}


@router.post("/products")
def create_product(payload: ProductCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role not in ("super_admin", "company_admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    product_type = (payload.product_type or "metho").strip() or "metho"

    discount_percent = max(0.0, min(95.0, float(payload.discount_percent or 0)))
    mrp = float(payload.mrp if payload.mrp is not None else payload.price)
    if mrp <= 0:
        raise HTTPException(status_code=400, detail="MRP must be greater than 0")
    effective_price = round(mrp * (1 - (discount_percent / 100)), 2)
    gst_percent = float(payload.gst_percent or 0)
    if product_type == "metho" and gst_percent < 0:
        gst_percent = 0

    if product_type == "associate_partner":
        partner_id = str(getattr(payload, "partner_id", "") or "").strip()
        partner = db.query(AssociatePartner).filter(AssociatePartner.id == partner_id).first()
        if not partner:
            raise HTTPException(status_code=400, detail="Valid partner_id is required for associate partner product")
        partner_product = PartnerProduct(
            partner_id=partner_id,
            name=payload.name,
            category=payload.category,
            description=payload.description,
            image_url=(payload.image_url or ""),
            price=effective_price,
            stock=int(payload.stock),
            approval_status="approved",
            active=True,
        )
        db.add(partner_product)
        db.commit()
        db.refresh(partner_product)
        _set_product_youtube_url(db, partner_product.id, payload.youtube_url)
        product_code = _ensure_product_code(db, partner_product.id, "associate_partner")
        saved_tiers = _set_product_pricing_tiers(db, partner_product.id, payload.pricing_tiers)
        return {
            "id": partner_product.id,
            "product_code": product_code,
            "message": "Partner product created",
            "pricing": {
                "mrp": mrp,
                "discount_percent": discount_percent,
                "final_price": effective_price,
                "gst_percent": 0,
            },
            "pricing_tiers": saved_tiers,
        }

    product = Product(
        name=payload.name,
        category=payload.category,
        description=payload.description,
        price=effective_price,
        stock=int(payload.stock),
    )
    db.add(product)
    db.flush()

    db.add(
        ProductMeta(
            product_id=product.id,
            product_type=product_type,
            image_url=(payload.image_url or "").strip(),
            mrp=mrp,
            discount_percent=discount_percent,
            gst_percent=(gst_percent if product_type == "metho" else 0),
        )
    )

    db.commit()
    db.refresh(product)
    _set_product_youtube_url(db, product.id, payload.youtube_url)
    product_code = _ensure_product_code(db, product.id, product_type)
    saved_tiers = _set_product_pricing_tiers(db, product.id, payload.pricing_tiers)
    return {
        "id": product.id,
        "product_code": product_code,
        "message": "Product created",
        "pricing": {
            "mrp": mrp,
            "discount_percent": discount_percent,
            "final_price": effective_price,
            "gst_percent": (gst_percent if product_type == "metho" else 0),
        },
        "pricing_tiers": saved_tiers,
    }


@router.put("/products/{product_id}")
def update_product(product_id: str, payload: ProductCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role not in ("super_admin", "company_admin", "admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    product_type = (payload.product_type or "metho").strip() or "metho"

    product = db.query(Product).filter(Product.id == product_id).first()
    partner_product = db.query(PartnerProduct).filter(PartnerProduct.id == product_id).first()
    if not product and not partner_product:
        raise HTTPException(status_code=404, detail="Product not found")

    discount_percent = max(0.0, min(95.0, float(payload.discount_percent or 0)))
    mrp = float(payload.mrp if payload.mrp is not None else payload.price)
    if mrp <= 0:
        raise HTTPException(status_code=400, detail="MRP must be greater than 0")
    effective_price = round(mrp * (1 - (discount_percent / 100)), 2)
    gst_percent = float(payload.gst_percent or 0)
    if product_type == "metho" and gst_percent < 0:
        gst_percent = 0

    # Prevent destructive type migration between Product and PartnerProduct tables.
    if product and product_type == "associate_partner":
        raise HTTPException(status_code=400, detail="Cannot change METHO product into associate partner product")
    if partner_product and product_type == "metho":
        raise HTTPException(status_code=400, detail="Cannot change associate partner product into METHO product")

    if partner_product:
        if product_type != "associate_partner":
            raise HTTPException(status_code=400, detail="Partner product type must be associate_partner")
        partner_id = str(getattr(payload, "partner_id", "") or "").strip() or partner_product.partner_id
        partner = db.query(AssociatePartner).filter(AssociatePartner.id == partner_id).first()
        if not partner:
            raise HTTPException(status_code=400, detail="Valid partner_id is required for associate partner product")

        partner_product.partner_id = partner_id
        partner_product.name = payload.name
        partner_product.category = payload.category
        partner_product.description = payload.description
        partner_product.image_url = (payload.image_url or "").strip()
        partner_product.price = effective_price
        partner_product.stock = int(payload.stock)
        partner_product.approval_status = "approved"
        partner_product.active = True

        db.commit()
        _set_product_youtube_url(db, partner_product.id, payload.youtube_url)
        product_code = _ensure_product_code(db, partner_product.id, "associate_partner")
        saved_tiers = _set_product_pricing_tiers(db, partner_product.id, payload.pricing_tiers)
        return {
            "id": partner_product.id,
            "product_code": product_code,
            "message": "Partner product updated",
            "pricing": {
                "mrp": mrp,
                "discount_percent": discount_percent,
                "final_price": effective_price,
                "gst_percent": 0,
            },
            "pricing_tiers": saved_tiers,
        }

    # Standard METHO product update.
    product.name = payload.name
    product.category = payload.category
    product.description = payload.description
    product.price = effective_price
    product.stock = int(payload.stock)

    meta = db.query(ProductMeta).filter(ProductMeta.product_id == product_id).first()
    if not meta:
        meta = ProductMeta(product_id=product_id)
        db.add(meta)
    meta.product_type = product_type
    meta.image_url = (payload.image_url or "").strip()
    meta.mrp = mrp
    meta.discount_percent = discount_percent
    meta.gst_percent = (gst_percent if product_type == "metho" else 0)

    db.commit()
    _set_product_youtube_url(db, product.id, payload.youtube_url)
    product_code = _ensure_product_code(db, product.id, product_type)
    saved_tiers = _set_product_pricing_tiers(db, product.id, payload.pricing_tiers)
    return {
        "id": product.id,
        "product_code": product_code,
        "message": "Product updated",
        "pricing": {
            "mrp": mrp,
            "discount_percent": discount_percent,
            "final_price": effective_price,
            "gst_percent": (gst_percent if product_type == "metho" else 0),
        },
        "pricing_tiers": saved_tiers,
    }


@router.put("/admin/products/{product_id}/pricing-tiers")
def update_product_pricing_tiers(product_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role not in ("super_admin", "company_admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    product = db.query(Product).filter(Product.id == product_id).first()
    partner_product = db.query(PartnerProduct).filter(PartnerProduct.id == product_id).first()
    if not product and not partner_product:
        raise HTTPException(status_code=404, detail="Product not found")

    tiers = payload.get("pricing_tiers")
    saved = _set_product_pricing_tiers(db, product_id, tiers)
    return {"ok": True, "product_id": product_id, "pricing_tiers": saved}


@router.patch("/products/{product_id}")
def patch_product(product_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role not in ("super_admin", "company_admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    product = db.query(Product).filter(Product.id == product_id).first()
    partner_product = db.query(PartnerProduct).filter(PartnerProduct.id == product_id).first()
    target = product or partner_product
    if not target:
        raise HTTPException(status_code=404, detail="Product not found")

    if "name" in payload:
        target.name = str(payload.get("name") or target.name)
    if "description" in payload:
        target.description = str(payload.get("description") or "")
    if "price" in payload:
        try:
            target.price = float(payload.get("price"))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid price")
    if "stock" in payload:
        try:
            target.stock = max(0, int(payload.get("stock")))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid stock")
    if "youtube_url" in payload:
        _set_product_youtube_url(db, product_id, str(payload.get("youtube_url") or ""))

    hidden = None
    if "hidden" in payload:
        hidden = _set_product_hidden_flag(db, product_id, bool(payload.get("hidden")))

    db.commit()

    return {
        "id": product_id,
        "name": target.name,
        "description": target.description,
        "price": float(target.price),
        "stock": int(target.stock),
        "hidden": bool(hidden if hidden is not None else _get_product_hidden_map(db).get(product_id, False)),
    }


@router.put("/products/{product_id}/youtube-url")
def update_product_youtube_url(product_id: str, payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role not in ("super_admin", "company_admin", "admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    product = db.query(Product).filter(Product.id == product_id).first()
    partner_product = db.query(PartnerProduct).filter(PartnerProduct.id == product_id).first()
    if not product and not partner_product:
        raise HTTPException(status_code=404, detail="Product not found")

    saved = _set_product_youtube_url(db, product_id, str(payload.get("youtube_url") or ""))
    return {"ok": True, "id": product_id, "youtube_url": saved}


@router.delete("/products/{product_id}")
def delete_product(product_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.role not in ("super_admin", "company_admin", "admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    product = db.query(Product).filter(Product.id == product_id).first()
    if product:
        meta = db.query(ProductMeta).filter(ProductMeta.product_id == product_id).first()
        if meta:
            db.delete(meta)

        db.delete(product)
        try:
            db.commit()
            return {"ok": True, "id": product_id, "mode": "hard"}
        except IntegrityError:
            # Product has dependent rows (typically order history). Hide instead of failing.
            db.rollback()
            product = db.query(Product).filter(Product.id == product_id).first()
            if product:
                product.stock = 0
                _set_product_hidden_flag(db, product_id, True)
                db.commit()
            return {"ok": True, "id": product_id, "mode": "soft"}

    partner_product = db.query(PartnerProduct).filter(PartnerProduct.id == product_id).first()
    if partner_product:
        db.delete(partner_product)
        db.commit()
        _set_product_hidden_flag(db, product_id, True)
        return {"ok": True, "id": product_id, "mode": "hard"}

    return {"ok": True, "id": product_id}


# Legacy single-item order endpoint kept for compatibility.
# Main checkout flow uses POST /api/orders from checkout.py.
@router.post("/orders/simple")
def create_order(payload: OrderCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    product = db.query(Product).filter(Product.id == payload.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    qty = max(1, int(payload.quantity))
    if product.stock < qty:
        raise HTTPException(status_code=400, detail="Insufficient stock")

    total = float(product.price) * qty
    product.stock -= qty

    order = Order(
        user_id=current_user.id,
        product_id=product.id,
        quantity=qty,
        unit_price=float(product.price),
        total_amount=total,
        status="created",
    )
    db.add(order)
    db.commit()
    db.refresh(order)

    return {
        "order_id": order.id,
        "status": order.status,
        "total_amount": order.total_amount,
    }
