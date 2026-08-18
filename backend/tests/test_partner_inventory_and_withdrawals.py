import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AssociatePartner, PartnerProduct, User
from sql_app.routers.checkout import _partner_product_meta, _set_partner_product_meta, create_public_order
from sql_app.routers.compat import _load_withdrawals, _save_partner_wallet, _save_user_wallet, admin_approve_order, wallet_withdraw
from sql_app.routers.directory import partner_directory
from sql_app.security import hash_password


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def partner_user(db):
    user = User(name="Partner User", email="partner@example.com", phone="9000000000", password=hash_password("secret1"), role="partner", is_active=True)
    partner = AssociatePartner(partner_code="MTH-PARTNER-INV", business_name="Partner Inventory", email=user.email, phone=user.phone, commission_percent=10, active=True)
    db.add_all([user, partner])
    db.flush()
    return user, partner


def test_service_metadata_and_unavailable_checkout_rejection():
    db = make_session()
    try:
        _user, partner = partner_user(db)
        service = PartnerProduct(partner_id=partner.id, name="AC Service", category="Home Service", price=800, stock=0, approval_status="approved", active=True)
        db.add(service)
        db.flush()
        mapping = _set_partner_product_meta(db, service.id, {
            "listing_type": "service",
            "is_service": True,
            "price_before_gst": 800,
            "gst_percent": 5,
            "pricing_unit": "PER_VISIT",
            "availability": "unavailable",
            "service_sector": "Doorstep",
            "service_category": "AC Service",
        })
        meta = _partner_product_meta(mapping, service.id)
        assert meta["inventory_type"] == "SERVICE"
        assert meta["pricing_unit"] == "PER_VISIT"
        assert meta["is_available"] is False
        with pytest.raises(Exception, match="currently unavailable"):
            create_public_order({"items": [{"product_id": service.id, "quantity": 1}]}, db)
        _set_partner_product_meta(db, service.id, {"listing_type": "service", "is_service": True, "availability": "available", "price_before_gst": 800, "gst_percent": 5, "pricing_unit": "PER_VISIT"})
        order = create_public_order({"items": [{"product_id": service.id, "quantity": 1}], "customer_phone": "9000000000", "slot_datetime": "2030-01-01T10:00"}, db)
        assert order["total_amount"] == 840
        assert order["items"][0]["gst_amount"] == 40
    finally:
        db.close()


def test_partner_product_stock_rejects_oversell_and_service_approval_does_not_deduct_stock():
    db = make_session()
    try:
        _user, partner = partner_user(db)
        product = PartnerProduct(partner_id=partner.id, name="Physical Product", category="General", price=100, stock=1, approval_status="approved", active=True)
        service = PartnerProduct(partner_id=partner.id, name="Electrician", category="Home Service", price=500, stock=0, approval_status="approved", active=True)
        db.add_all([product, service])
        db.flush()
        _set_partner_product_meta(db, service.id, {"listing_type": "service", "is_service": True, "availability": "available", "price_before_gst": 500, "gst_percent": 0})
        with pytest.raises(Exception, match="Insufficient stock available"):
            create_public_order({"items": [{"product_id": product.id, "quantity": 2}]}, db)

        _save_partner_wallet(db, partner.id, {"balance": 100, "total_credit": 100, "total_debit": 0})
        order = create_public_order({"items": [{"product_id": service.id, "quantity": 1}], "customer_phone": "9000000000", "slot_datetime": "2030-01-01T10:00"}, db)
        admin_approve_order(order["id"], {}, db, SimpleNamespace(role="super_admin", id="ADMIN"))
        assert db.query(PartnerProduct).filter(PartnerProduct.id == service.id).one().stock == 0
    finally:
        db.close()


def test_active_service_metadata_is_searchable_and_inactive_partner_is_hidden():
    db = make_session()
    try:
        _user, partner = partner_user(db)
        partner.city = "Rishra"
        service = PartnerProduct(partner_id=partner.id, name="Rapid Repair", category="Home Service", price=500, stock=0, approval_status="approved", active=True)
        hidden_partner = AssociatePartner(partner_code="MTH-PARTNER-HIDDEN", business_name="Hidden Electrician", active=False)
        db.add_all([service, hidden_partner])
        db.flush()
        _set_partner_product_meta(db, service.id, {"listing_type": "service", "is_service": True, "availability": "available", "service_sector": "Doorstep", "service_category": "Home Service", "service_type": "Electrician", "service_area": "Rishra", "district": "Hooghly"})
        db.commit()
        results = partner_directory(q="electrician rishra", db=db)
        assert [row["id"] for row in results] == [partner.id]
    finally:
        db.close()


@pytest.mark.parametrize("gross, expected_tds, expected_admin, expected_net", [
    (100, 5, 3, 92),
    (1000, 50, 30, 920),
    (10000, 500, 300, 9200),
])
def test_withdrawal_uses_settings_rates_and_debits_gross_amount(gross, expected_tds, expected_admin, expected_net):
    db = make_session()
    try:
        user = User(name="Member", email=f"member-{gross}@example.com", phone="9111111111", password=hash_password("secret1"), role="member", is_active=True)
        db.add(user)
        db.flush()
        _save_user_wallet(db, user.id, {"balance": gross, "total_income": gross, "total_bonus": 0, "total_withdrawn": 0})
        result = wallet_withdraw({"amount": gross, "method": "upi", "account_details": "member@upi"}, db, user)
        row = result["withdrawal"]
        assert row["gross_amount"] == gross
        assert row["tds_percent"] == 5
        assert row["tds_amount"] == expected_tds
        assert row["admin_charge_percent"] == 3
        assert row["admin_charge_amount"] == expected_admin
        assert row["net_amount"] == expected_net
        assert _load_withdrawals(db)[0]["id"] == row["id"]
    finally:
        db.close()
