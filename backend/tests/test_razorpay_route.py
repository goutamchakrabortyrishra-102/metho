import hashlib
import hmac
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AppSetting, PublicOrder
from sql_app.routers.checkout import _save_order_razorpay_ref, verify_razorpay_and_submit


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def setup_order(db, status="pending_approval"):
    row = PublicOrder(customer_user_id="", payment_method="razorpay", items_json="[]", total_amount=1000, status=status)
    db.add(row)
    db.commit()
    _save_order_razorpay_ref(db, row.id, "order_rp_1")
    return row


def payload(signature="bad", amount=1000, payment_id="pay_1"):
    return {"order_id": "ORDER", "razorpay_order_id": "order_rp_1", "razorpay_payment_id": payment_id, "razorpay_signature": signature, "amount": amount}


def test_razorpay_invalid_signature_and_amount_are_rejected(monkeypatch):
    db = make_session()
    try:
        row = setup_order(db)
        monkeypatch.setattr("sql_app.routers.checkout._load_checkout_razorpay_settings", lambda db: ({}, "key", "secret"))
        body = payload()
        body["order_id"] = row.id
        with pytest.raises(Exception, match="Invalid Razorpay signature"):
            verify_razorpay_and_submit(body, db)
        signature = hmac.new(b"secret", b"order_rp_1|pay_1", hashlib.sha256).hexdigest()
        body = payload(signature=signature, amount=900)
        body["order_id"] = row.id
        with pytest.raises(Exception, match="Payment amount mismatch"):
            verify_razorpay_and_submit(body, db)
        assert db.query(PublicOrder).one().status == "pending_approval"
    finally:
        db.close()


def test_razorpay_duplicate_payment_reference_is_rejected(monkeypatch):
    db = make_session()
    try:
        first = PublicOrder(customer_user_id="", payment_method="razorpay", items_json="[]", total_amount=1000, status="paid", txn_id="pay_used")
        second = setup_order(db)
        db.add(first)
        db.commit()
        _save_order_razorpay_ref(db, second.id, "order_rp_1")
        monkeypatch.setattr("sql_app.routers.checkout._load_checkout_razorpay_settings", lambda db: ({}, "key", "secret"))
        signature = hmac.new(b"secret", b"order_rp_1|pay_used", hashlib.sha256).hexdigest()
        body = payload(signature=signature, payment_id="pay_used")
        body["order_id"] = second.id
        with pytest.raises(Exception, match="Payment reference already used"):
            verify_razorpay_and_submit(body, db)
    finally:
        db.close()


def test_razorpay_wrong_currency_is_rejected(monkeypatch):
    db = make_session()
    try:
        row = setup_order(db)
        monkeypatch.setattr("sql_app.routers.checkout._load_checkout_razorpay_settings", lambda db: ({}, "key", "secret"))
        signature = hmac.new(b"secret", b"order_rp_1|pay_currency", hashlib.sha256).hexdigest()
        body = payload(signature=signature, payment_id="pay_currency")
        body["order_id"] = row.id
        body["currency"] = "USD"
        with pytest.raises(Exception, match="Currency mismatch"):
            verify_razorpay_and_submit(body, db)
        assert db.query(PublicOrder).one().status == "pending_approval"
    finally:
        db.close()
