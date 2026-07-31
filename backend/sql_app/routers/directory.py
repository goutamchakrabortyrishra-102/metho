import json

from sqlalchemy import func
from sqlalchemy.orm import Session
from fastapi import APIRouter, Depends, HTTPException

from ..database import get_db
from ..models import AppSetting, AssociatePartner, PartnerProduct

router = APIRouter(prefix="/api", tags=["directory"])


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

    return banner_url, featured_items


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


@router.get("/directory/partners")
def partner_directory(
    city: str | None = None,
    business_type: str | None = None,
    category: str | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(AssociatePartner).filter(AssociatePartner.active.is_(True))

    if city:
        query = query.filter(func.lower(AssociatePartner.city) == city.lower())
    if business_type:
        query = query.filter(AssociatePartner.business_type == business_type)
    if q:
        like_q = f"%{q}%"
        query = query.filter(
            AssociatePartner.business_name.ilike(like_q)
            | AssociatePartner.contact_person.ilike(like_q)
        )
    if category:
        partner_ids = [
            row[0]
            for row in db.query(PartnerProduct.partner_id)
            .filter(PartnerProduct.active.is_(True), PartnerProduct.category == category)
            .distinct()
            .all()
        ]
        if partner_ids:
            query = query.filter(AssociatePartner.id.in_(partner_ids))
        else:
            return []

    rows = query.order_by(AssociatePartner.is_featured.desc(), AssociatePartner.business_name.asc()).all()
    return [_partner_to_dict(p) for p in rows]


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
            PartnerProduct.image_url.isnot(None),
            PartnerProduct.image_url != "",
        )
        .order_by(PartnerProduct.created_at.desc())
        .all()
    )

    partner_doc = _partner_to_dict(partner)
    partner_doc["banner_url"] = banner_url

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
            }
            for p in products
        ],
    }
