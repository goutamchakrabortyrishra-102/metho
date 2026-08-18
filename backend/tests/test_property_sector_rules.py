import sys
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AssociatePartner, PartnerProduct
from sql_app.routers.checkout import _partner_product_meta, _set_partner_product_meta
from sql_app.routers.compat import create_property_enquiry, update_property_enquiry
from sql_app.routers.directory import partner_directory, partner_public_page


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_property_metadata_is_searchable_and_public_safe():
    db = make_session()
    try:
        partner = AssociatePartner(
            partner_code="MTH-PROPERTY-001",
            business_name="Rishra Land Consultant",
            business_type="Property Buy & Sell",
            city="Rishra",
            state="West Bengal",
            pincode="712250",
            active=True,
        )
        db.add(partner)
        db.flush()
        listing = PartnerProduct(
            partner_id=partner.id,
            name="Residential Plot Rishra",
            category="Land Sale",
            description="Residential plot near Rishra station",
            price=2500000,
            stock=0,
            approval_status="approved",
            active=True,
        )
        db.add(listing)
        db.flush()
        _set_partner_product_meta(db, listing.id, {
            "listing_type": "service",
            "is_service": True,
            "service_sector": "Property Buy & Sell",
            "service_category": "Land Sale",
            "service_type": "Residential Plot",
            "service_area": "Rishra",
            "property_type": "Plot",
            "property_listing_type": "For Sale",
            "property_area": "3",
            "property_area_unit": "Katha",
            "property_location": "Rishra, Hooghly",
            "property_status": "AVAILABLE",
            "price_before_gst": 2500000,
        })
        db.commit()

        meta = _partner_product_meta(_set_partner_product_meta(db, listing.id, {}), listing.id)
        assert meta["property_type"] == "Plot"
        assert meta["property_listing_type"] == "For Sale"
        assert meta["property_status"] == "AVAILABLE"
        results = partner_directory(q="plot rishra", db=db)
        assert [row["partner_code"] for row in results] == ["MTH-PROPERTY-001"]
        public = partner_public_page("MTH-PROPERTY-001", db)
        assert public["products"][0]["property_type"] == "Plot"
        assert "purchase_cost" not in public["products"][0]
    finally:
        db.close()


def test_sold_property_is_excluded_from_public_page():
    db = make_session()
    try:
        partner = AssociatePartner(partner_code="MTH-PROPERTY-002", business_name="Property Agency", active=True)
        db.add(partner)
        db.flush()
        listing = PartnerProduct(partner_id=partner.id, name="Sold Flat", category="Flat Sale", price=1000000, stock=0, approval_status="approved", active=True)
        db.add(listing)
        db.flush()
        _set_partner_product_meta(db, listing.id, {
            "listing_type": "service",
            "is_service": True,
            "service_sector": "Property Buy & Sell",
            "property_type": "Flat",
            "property_status": "SOLD",
        })
        db.commit()
        assert partner_public_page("MTH-PROPERTY-002", db)["products"] == []
    finally:
        db.close()


def test_property_enquiry_is_idempotent_and_has_authorized_lifecycle():
    db = make_session()
    try:
        partner_user = SimpleNamespace(role="partner", id="PARTNER-USER", name="Agency", email="agency@example.com", phone="9000000000")
        partner = AssociatePartner(partner_code="MTH-PROPERTY-003", business_name="Agency", email="agency@example.com", active=True)
        db.add(partner)
        db.flush()
        listing = PartnerProduct(partner_id=partner.id, name="House", category="House Sale", price=900000, stock=0, approval_status="approved", active=True)
        db.add(listing)
        db.flush()
        _set_partner_product_meta(db, listing.id, {"listing_type": "service", "is_service": True, "service_sector": "Property Buy & Sell", "property_status": "AVAILABLE"})
        db.commit()

        first = create_property_enquiry({"listing_id": listing.id, "customer_phone": "9111111111", "message": "Please share details"}, db, SimpleNamespace(id="CUSTOMER", name="Customer", phone="9111111111"))
        second = create_property_enquiry({"listing_id": listing.id, "customer_phone": "9111111111", "message": "Please share details"}, db, SimpleNamespace(id="CUSTOMER", name="Customer", phone="9111111111"))
        assert first["duplicate"] is False
        assert second["duplicate"] is True
        updated = update_property_enquiry(first["enquiry"]["id"], {"status": "CONTACTED"}, db, partner_user)
        assert updated["enquiry"]["status"] == "CONTACTED"
    finally:
        db.close()
