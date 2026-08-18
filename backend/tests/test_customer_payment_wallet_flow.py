import sys
import hashlib
import hmac
import json
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AssociatePartner, FinancialLedgerEntry, InvoiceRecord, PartnerProduct, PaymentRecord, PublicOrder, RewardRecord
from sql_app.routers.checkout import _save_order_razorpay_ref, verify_razorpay_and_submit
from sql_app.routers.compat import _credit_partner_customer_payment_once, _list_partner_wallet_tx, _load_partner_wallet, _invoice_payload


def test_verified_customer_payment_credits_existing_wallet_once_after_commission():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        partner = AssociatePartner(partner_code="MTH-PAYMENT-WALLET", business_name="Payment Partner", commission_percent=10, active=True)
        db.add(partner)
        db.flush()
        product = PartnerProduct(partner_id=partner.id, name="Partner Service", price=1000, stock=0, active=True, approval_status="approved")
        db.add(product)
        db.flush()
        order = PublicOrder(customer_user_id="", payment_method="razorpay", txn_id="pay-customer-1", total_amount=1000, status="paid", items_json="[]")
        db.add(order)
        db.commit()
        first = _credit_partner_customer_payment_once(db, partner, order, "pay-customer-1")
        second = _credit_partner_customer_payment_once(db, partner, order, "pay-customer-1")
        assert first["transaction_type"] == "CUSTOMER_PAYMENT_CREDIT"
        assert first["gross_amount"] == 1000
        assert first["company_commission"] == 100
        assert first["credit"] == 900
        assert second["reference_id"] == first["reference_id"]
        assert _load_partner_wallet(db, partner.id)["balance"] == 900
        assert len([tx for tx in _list_partner_wallet_tx(db, partner.id) if tx.get("reference_id") == first["reference_id"]]) == 1
        assert db.query(FinancialLedgerEntry).filter(FinancialLedgerEntry.reference_id == first["reference_id"]).count() == 1
    finally:
        db.close()


def test_verified_partner_customer_payment_route_reconciles_wallet_reserve_invoice_and_callback(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        partner = AssociatePartner(partner_code="MTH-E2E-PAY", business_name="E2E Partner", email="e2e@example.com", commission_percent=10, active=True)
        db.add(partner)
        db.flush()
        product = PartnerProduct(partner_id=partner.id, name="Partner Booking", price=1000, stock=1, active=True, approval_status="approved")
        db.add(product)
        db.flush()
        order = PublicOrder(customer_user_id="", payment_method="razorpay", total_amount=1000, status="pending_approval", items_json=json.dumps([{"product_id": product.id, "product_type": "associate_partner", "listing_type": "service", "is_service": True, "name": product.name, "price": 1000, "pre_tax": 1000, "subtotal": 1000, "quantity": 1, "gst_percent": 0, "gst_amount": 0}]))
        db.add(order)
        db.commit()
        _save_order_razorpay_ref(db, order.id, "order_e2e")
        monkeypatch.setattr("sql_app.routers.checkout._load_checkout_razorpay_settings", lambda db: ({}, "key", "secret"))
        monkeypatch.setattr("sql_app.routers.compat.load_settings", lambda db: {"commission_split_member_pool": 40, "commission_split_leader_pool": 20, "commission_split_mps_fund": 10, "commission_split_company_fund": 20, "commission_split_technology_reserve": 10, "metho_commission_percent": 10})
        signature = hmac.new(b"secret", b"order_e2e|pay_e2e", hashlib.sha256).hexdigest()
        payload = {"order_id": order.id, "razorpay_order_id": "order_e2e", "razorpay_payment_id": "pay_e2e", "razorpay_signature": signature, "amount": 1000, "currency": "INR"}
        first = verify_razorpay_and_submit(payload, db)
        second = verify_razorpay_and_submit(payload, db)
        assert first["status"] == "paid"
        assert second["already_processed"] is True
        assert db.query(PublicOrder).one().txn_id == "pay_e2e"
        assert db.query(PaymentRecord).count() == 1
        assert db.query(InvoiceRecord).count() == 1
        assert db.query(RewardRecord).filter(RewardRecord.order_id == order.id).count() == 1
        transactions = _list_partner_wallet_tx(db, partner.id)
        customer_credits = [tx for tx in transactions if tx.get("transaction_type") == "CUSTOMER_PAYMENT_CREDIT"]
        reserve_debits = [tx for tx in transactions if tx.get("transaction_type") == "COMMISSION_RESERVE_DEBIT"]
        assert len(customer_credits) == 1
        assert len(reserve_debits) == 1
        assert customer_credits[0]["reference_id"] != reserve_debits[0]["reference_id"]
        assert customer_credits[0]["credit"] == 900
        assert reserve_debits[0]["debit"] == 100
        assert db.query(FinancialLedgerEntry).filter(FinancialLedgerEntry.order_id == order.id).count() == 3
        assert _load_partner_wallet(db, partner.id)["balance"] == 800
        invoice = _invoice_payload(db, order.id, type("Admin", (), {"role": "super_admin", "id": "ADMIN"})())
        assert invoice["grand_total"] == 1000
        assert _invoice_payload(db, order.id, type("Admin", (), {"role": "super_admin", "id": "ADMIN"})())["invoice_no"] == invoice["invoice_no"]
        assert db.query(PaymentRecord).count() == 1
        assert db.query(InvoiceRecord).count() == 1
        assert db.query(RewardRecord).filter(RewardRecord.order_id == order.id).count() == 1
    finally:
        db.close()
