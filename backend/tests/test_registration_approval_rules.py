import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import PartnerRequest, Product, ProductMeta, PublicOrder, User
from sql_app.routers.auth import _login_user, register
from sql_app.routers.compat import _activate_member_purchase, _member_payment_state_key, admin_approve_order
from sql_app.routers.partner_public import partner_register
from sql_app.schemas import LoginRequest, RegisterRequest
from sql_app.security import hash_password


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def admin():
    return SimpleNamespace(role="super_admin", id="ADMIN")


def test_member_registration_stays_inactive_and_login_is_denied(monkeypatch):
    db = make_session()
    monkeypatch.setattr("sql_app.routers.auth.build_welcome_pdf", lambda user: "")
    try:
        result = register(RegisterRequest(name="Member", email="MAU12345", phone="9999999999", password="secret1"), db)
        member = db.query(User).filter(User.id == result["user"]["id"]).one()
        assert member.is_active is False
        with pytest.raises(Exception, match="pending payment verification"):
            _login_user(LoginRequest(email=member.email, password="secret1"), db)
    finally:
        db.close()


def test_paid_member_order_activates_exact_member_once():
    db = make_session()
    try:
        member = User(name="Member", email="member@example.com", phone="9999999999", password=hash_password("secret1"), role="member", is_active=False)
        product = Product(name="Activation Product", category="General", price=100, stock=2)
        db.add_all([member, product])
        db.flush()
        db.add(ProductMeta(product_id=product.id, product_type="metho", gst_percent=5))
        order = PublicOrder(
            customer_user_id=member.id,
            payment_method="razorpay",
            payer_name="Member",
            items_json='[{"product_id":"%s","product_type":"metho","quantity":1,"subtotal":105,"pre_tax":100}]' % product.id,
            total_amount=105,
            status="pending_approval",
        )
        db.add(order)
        db.commit()
        result = admin_approve_order(order.id, {}, db, admin())
        assert result["member_purchase_activated"] is True
        assert db.query(User).filter(User.id == member.id).one().is_active is True
        assert _activate_member_purchase(db, member, "duplicate-order", "razorpay") is False
        assert db.query(User).filter(User.id == member.id).one().is_active is True
    finally:
        db.close()


def test_partner_registration_is_pending_until_admin_approval():
    db = make_session()
    try:
        result = partner_register({
            "login_id": "partner@example.com",
            "password": "secret1",
            "business_name": "Pending Shop",
            "contact_person": "Owner",
            "phone": "8888888888",
            "pan_no": "ABCDE1234F",
            "aadhaar_no": "123456789012",
        }, db)
        request = db.query(PartnerRequest).filter(PartnerRequest.id == result["request_id"]).one()
        assert request.status == "pending"
    finally:
        db.close()