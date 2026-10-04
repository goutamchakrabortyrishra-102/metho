import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import FinancialLedgerEntry, Product, PublicOrder, User
from sql_app.routers.compat import (
    _load_company_commission_wallet,
    admin_cancel_refund_order,
    admin_reject_order,
    create_offline_sale,
    offline_sale_member_lookup,
)
from sql_app.security import hash_password

ADMIN = SimpleNamespace(role="super_admin", id="ADMIN")


def _setup(monkeypatch):
    monkeypatch.setattr("sql_app.routers.compat.load_settings", lambda db: {"metho_commission_percent": 10})
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    member = User(id="MAU0001", name="Ayesha", email="ayesha@example.com", phone="9000000001", password=hash_password("secret1"), role="member", is_active=True)
    product = Product(name="METHO Tonic", category="Health", price=100, stock=10)
    db.add_all([member, product])
    db.commit()
    return db, member, product


def test_member_lookup_returns_details_and_unknown_member_404(monkeypatch):
    db, member, _product = _setup(monkeypatch)
    try:
        found = offline_sale_member_lookup("MAU0001", db, ADMIN)
        assert found["name"] == "Ayesha" and found["phone"] == "9000000001" and found["member_code"] == "MAU0001"
        assert offline_sale_member_lookup("9000000001", db, ADMIN)["id"] == member.id
        with pytest.raises(HTTPException) as exc:
            offline_sale_member_lookup("MAU9999", db, ADMIN)
        assert exc.value.status_code == 404
    finally:
        db.close()


def test_offline_cash_sale_goes_through_online_pipeline(monkeypatch):
    db, member, product = _setup(monkeypatch)
    try:
        result = create_offline_sale({"member_code": "MAU0001", "items": [{"product_id": product.id, "quantity": 2}], "client_ref": "k1"}, db, ADMIN)
        assert result["status"] == "paid" and result["invoice_no"].startswith("INV-")
        order = db.query(PublicOrder).one()
        assert order.payment_method == "cash" and order.customer_user_id == member.id and order.payer_name == "Ayesha"
        db.refresh(product)
        assert product.stock == 8
        assert _load_company_commission_wallet(db)["balance"] > 0
        assert db.query(FinancialLedgerEntry).filter(FinancialLedgerEntry.order_id == order.id).count() >= 1

        again = create_offline_sale({"member_code": "MAU0001", "items": [{"product_id": product.id, "quantity": 2}], "client_ref": "k1"}, db, ADMIN)
        assert again["duplicate"] is True and again["order_id"] == result["order_id"]
        assert db.query(PublicOrder).count() == 1
        db.refresh(product)
        assert product.stock == 8
    finally:
        db.close()


def test_offline_sale_rejects_unknown_member_and_non_admin(monkeypatch):
    db, _member, product = _setup(monkeypatch)
    try:
        with pytest.raises(HTTPException) as exc:
            create_offline_sale({"member_code": "MAU9999", "items": [{"product_id": product.id, "quantity": 1}]}, db, ADMIN)
        assert exc.value.status_code == 404
        with pytest.raises(HTTPException):
            create_offline_sale({"items": [{"product_id": product.id, "quantity": 1}]}, db, SimpleNamespace(role="member", id="X"))
        assert db.query(PublicOrder).count() == 0
    finally:
        db.close()


def test_cancel_refund_restores_stock_and_reverses_commission_once(monkeypatch):
    db, _member, product = _setup(monkeypatch)
    try:
        sale = create_offline_sale({"member_code": "MAU0001", "items": [{"product_id": product.id, "quantity": 3}]}, db, ADMIN)
        order_id = sale["order_id"]
        pool_before = _load_company_commission_wallet(db)["balance"]
        assert pool_before > 0

        with pytest.raises(HTTPException) as exc:
            admin_cancel_refund_order(order_id, {"reason": ""}, db, ADMIN)
        assert exc.value.status_code == 400

        result = admin_cancel_refund_order(order_id, {"reason": "Customer returned"}, db, ADMIN)
        assert result["status"] == "refunded" and result["commission_pool_reversed"] == pool_before
        db.refresh(product)
        assert product.stock == 10
        assert _load_company_commission_wallet(db)["balance"] == 0.0
        assert db.query(PublicOrder).one().status == "refunded"

        again = admin_cancel_refund_order(order_id, {"reason": "retry"}, db, ADMIN)
        assert again["already_refunded"] is True
        db.refresh(product)
        assert product.stock == 10
        assert _load_company_commission_wallet(db)["balance"] == 0.0
    finally:
        db.close()


def test_cancel_refund_blocks_gateway_and_unpaid_orders(monkeypatch):
    db, _member, _product = _setup(monkeypatch)
    try:
        razorpay = PublicOrder(payment_method="razorpay", items_json="[]", total_amount=100, status="paid")
        pending = PublicOrder(payment_method="cash", items_json="[]", total_amount=100, status="pending_payment")
        db.add_all([razorpay, pending])
        db.commit()
        for order in (razorpay, pending):
            with pytest.raises(HTTPException) as exc:
                admin_cancel_refund_order(order.id, {"reason": "x"}, db, ADMIN)
            assert exc.value.status_code == 400
        with pytest.raises(HTTPException):
            admin_cancel_refund_order(pending.id, {"reason": "x"}, db, SimpleNamespace(role="member", id="X"))
    finally:
        db.close()


def test_reject_requires_admin_and_only_pending_orders(monkeypatch):
    db, _member, product = _setup(monkeypatch)
    try:
        pending = PublicOrder(payment_method="upi", items_json="[]", total_amount=100, status="pending_approval")
        db.add(pending)
        db.commit()
        with pytest.raises(HTTPException) as exc:
            admin_reject_order(pending.id, {"reason": "x"}, db, SimpleNamespace(role="member", id="X"))
        assert exc.value.status_code in {401, 403}
        assert db.query(PublicOrder).filter(PublicOrder.id == pending.id).one().status == "pending_approval"

        assert admin_reject_order(pending.id, {"reason": "bad proof"}, db, ADMIN)["status"] == "rejected"
        assert admin_reject_order(pending.id, {}, db, ADMIN)["status"] == "rejected"

        sale = create_offline_sale({"items": [{"product_id": product.id, "quantity": 1}]}, db, ADMIN)
        with pytest.raises(HTTPException) as exc:
            admin_reject_order(sale["order_id"], {}, db, ADMIN)
        assert exc.value.status_code == 400
        assert db.query(PublicOrder).filter(PublicOrder.id == sale["order_id"]).one().status == "paid"
    finally:
        db.close()
