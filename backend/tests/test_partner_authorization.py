import sys
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AssociatePartner, PartnerProduct
from sql_app.routers.checkout import partner_inventory, partner_inventory_detail, partner_ledger, partner_products, partner_reports
from sql_app.routers.compat import partner_property_enquiries


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_partner_reports_inventory_ledger_and_enquiries_are_partner_scoped():
    db = make_session()
    try:
        partner_a = AssociatePartner(partner_code="MTH-AUTH-A", business_name="Partner A", email="a@example.com", active=True)
        partner_b = AssociatePartner(partner_code="MTH-AUTH-B", business_name="Partner B", email="b@example.com", active=True)
        db.add_all([partner_a, partner_b])
        db.flush()
        db.add_all([
            PartnerProduct(partner_id=partner_a.id, name="A Product", category="General", price=100, stock=2, active=True, approval_status="approved"),
            PartnerProduct(partner_id=partner_b.id, name="B Product", category="General", price=200, stock=2, active=True, approval_status="approved"),
        ])
        db.commit()
        identity_a = SimpleNamespace(role="partner", email="a@example.com", phone="")
        reports = partner_reports(db, identity_a)
        products = partner_products(db, identity_a)
        inventory = partner_inventory(db, identity_a)
        ledger = partner_ledger(db, identity_a)
        enquiries = partner_property_enquiries(db, identity_a)
        assert all(row.get("product") != "B Product" for row in reports["products"])
        assert all(row.get("name") != "B Product" for row in products)
        assert all(row.get("name") != "B Product" for row in inventory["items"])
        with pytest.raises(Exception):
            partner_inventory_detail(db.query(PartnerProduct).filter(PartnerProduct.partner_id == partner_b.id).first().id, db, identity_a)
        assert all(row.get("business_name") != "Partner B" for row in enquiries)
        assert ledger == []
        with pytest.raises(Exception):
            partner_reports(db, SimpleNamespace(role="member", email="a@example.com", phone=""))
    finally:
        db.close()
