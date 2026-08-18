import sys
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AppSetting, AssociatePartner, PartnerProduct
from sql_app.routers.checkout import _set_partner_product_meta
from sql_app.routers.directory import partner_directory, partner_public_page

FORBIDDEN = {"purchase_cost", "wallet", "commission", "total_sales", "internal_margin", "admin_settings", "driver_phone", "private_phone", "payment_secret", "api_key", "token", "password", "private_credentials", "internal_ledger", "admin_only_fields"}


def walk_keys(value):
    if isinstance(value, dict):
        for key, child in value.items():
            yield str(key).lower()
            yield from walk_keys(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_keys(child)


def test_public_partner_responses_expose_no_forbidden_fields():
    engine = create_engine("sqlite:///:memory:")
    db = sessionmaker(bind=engine)()
    Base.metadata.create_all(engine)
    try:
        partner = AssociatePartner(partner_code="MTH-SECURE-001", business_name="Secure Partner", business_type="Property Buy & Sell", active=True)
        db.add(partner)
        db.flush()
        listing = PartnerProduct(partner_id=partner.id, name="Property", category="Plot Sale", price=100, stock=0, active=True, approval_status="approved")
        db.add(listing)
        db.flush()
        _set_partner_product_meta(db, listing.id, {"listing_type": "service", "is_service": True, "service_sector": "Property Buy & Sell", "property_type": "Plot", "property_status": "AVAILABLE", "purchase_cost": 10, "driver_phone": "9999999999"})
        db.commit()
        payload = partner_public_page(partner.partner_code, db)
        directory = partner_directory(q="plot", db=db)
        assert not (set(walk_keys(payload)) & FORBIDDEN)
        assert not (set(walk_keys(directory)) & FORBIDDEN)
    finally:
        db.close()
