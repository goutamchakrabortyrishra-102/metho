import hashlib
import hmac
import json
import sys
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AppSetting, AssociatePartner, FinancialLedgerEntry
from sql_app.routers.compat import _partner_topup_key, partner_wallet_topup_razorpay_verify_and_credit


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_wallet_recharge_duplicate_payment_is_not_credited_twice(monkeypatch):
    db = make_session()
    try:
        partner = AssociatePartner(partner_code="MTH-WALLET-001", business_name="Wallet Partner", email="wallet@example.com", active=True)
        db.add(partner)
        db.flush()
        request_id = "REQ-1"
        doc = {"id": request_id, "partner_id": partner.id, "amount": 100, "payment_method": "razorpay", "status": "pending", "razorpay_order_id": "order_1", "razorpay_payment_id": ""}
        db.add(AppSetting(key=_partner_topup_key(request_id), value_json=json.dumps(doc)))
        db.commit()
        monkeypatch.setattr("sql_app.routers.compat._load_razorpay_settings", lambda db: ("key", "secret"))
        signature = hmac.new(b"secret", b"order_1|pay_1", hashlib.sha256).hexdigest()
        identity = SimpleNamespace(role="partner", email=partner.email, phone="")
        payload = {"request_id": request_id, "razorpay_order_id": "order_1", "razorpay_payment_id": "pay_1", "razorpay_signature": signature}
        first = partner_wallet_topup_razorpay_verify_and_credit(payload, db, identity)
        assert first["wallet"]["balance"] == 100
        assert db.query(FinancialLedgerEntry).filter(FinancialLedgerEntry.transaction_type == "RAZORPAY_RECHARGE_CREDIT").count() == 1
        second = partner_wallet_topup_razorpay_verify_and_credit(payload, db, identity)
        assert second["already_processed"] is True
        assert second["wallet"]["balance"] == 100
        assert db.query(FinancialLedgerEntry).filter(FinancialLedgerEntry.reference_id == "razorpay-recharge:pay_1").count() == 1
    finally:
        db.close()
