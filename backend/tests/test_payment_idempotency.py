import sys
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import PublicOrder
from sql_app.routers.checkout import submit_payment
from sql_app.routers.compat import _invoice_payload, admin_approve_order


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_cash_payment_stays_pending_until_authorized_approval():
    db = make_session()
    try:
        row = PublicOrder(customer_user_id="", payment_method="cash", items_json="[]", total_amount=100, status="pending_payment")
        db.add(row)
        db.commit()
        result = submit_payment(row.id, {"txn_id": "CASH-001"}, db)
        assert result["status"] == "pending_payment"
        approved = admin_approve_order(row.id, {}, db, SimpleNamespace(role="super_admin", id="ADMIN"))
        assert approved["status"] == "paid"
        with pytest.raises(Exception):
            admin_approve_order(row.id, {}, db, SimpleNamespace(role="super_admin", id="ADMIN"))
    finally:
        db.close()


def test_paid_order_invoice_is_persisted_and_reused():
    db = make_session()
    try:
        row = PublicOrder(customer_user_id="CUSTOMER", payment_method="razorpay", txn_id="pay_1", items_json='[{"product_type":"metho","name":"METHO","price":100,"pre_tax":100,"subtotal":100,"quantity":1,"gst_percent":0,"gst_amount":0}]', total_amount=100, status="paid")
        db.add(row)
        db.commit()
        user = SimpleNamespace(role="super_admin", id="ADMIN")
        first = _invoice_payload(db, row.id, user)
        second = _invoice_payload(db, row.id, user)
        assert first["invoice_no"] == second["invoice_no"]
        assert db.query(__import__("sql_app.models", fromlist=["AppSetting"]).AppSetting).filter_by(key=f"invoice:{row.id}").count() == 1
    finally:
        db.close()
