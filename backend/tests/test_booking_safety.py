import sys
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AssociatePartner, AppSetting, PartnerProduct, PublicOrder
from sql_app.routers.compat import _auto_approve_pending_orders_for_partner, _load_partner_wallet, _load_transport_trip, _save_delivery_trip, _save_partner_wallet, _save_transport_trip, _schedule_overlaps, partner_delivery_confirm_booking, partner_delivery_update_status


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_transport_interval_overlap_rules():
    assert _schedule_overlaps("2030-01-01T10:00+00:00", "2030-01-01T12:00+00:00", "2030-01-01T11:00+00:00", "2030-01-01T13:00+00:00")
    assert _schedule_overlaps("2030-01-01T10:00+00:00", "2030-01-01T12:00+00:00", "2030-01-01T09:00+00:00", "2030-01-01T11:00+00:00")
    assert _schedule_overlaps("2030-01-01T10:00+00:00", "2030-01-01T12:00+00:00", "2030-01-01T10:30+00:00", "2030-01-01T11:30+00:00")
    assert _schedule_overlaps("2030-01-01T10:00+00:00", "2030-01-01T12:00+00:00", "2030-01-01T09:00+00:00", "2030-01-01T13:00+00:00")
    assert not _schedule_overlaps("2030-01-01T10:00+00:00", "2030-01-01T12:00+00:00", "2030-01-01T12:00+00:00", "2030-01-01T14:00+00:00")


def test_courier_status_machine_rejects_invalid_and_accepts_valid_steps():
    db = make_session()
    try:
        partner = AssociatePartner(partner_code="MTH-COURIER-SAFE", business_name="Courier", email="courier-safe@example.com", active=True)
        db.add(partner)
        db.flush()
        _save_delivery_trip(db, {"id": "DEL-1", "partner_id": partner.id, "status": "booked"})
        identity = SimpleNamespace(role="partner", email=partner.email, phone="")
        current = "DEL-1"
        for next_status in ("confirmed", "pickup_assigned", "picked_up", "in_transit", "out_for_delivery", "delivered"):
            result = partner_delivery_update_status(current, {"status": next_status}, db, identity)
            assert result["booking"]["status"] == next_status
        with pytest.raises(Exception):
            partner_delivery_update_status(current, {"status": "picked_up"}, db, identity)
    finally:
        db.close()


def test_delivery_confirmation_wallet_insufficient_then_recharge_and_retry():
    db = make_session()
    try:
        partner = AssociatePartner(partner_code="MTH-WALLET-CONFIRM", business_name="Wallet Courier", email="wallet-confirm@example.com", commission_percent=10, active=True)
        db.add(partner)
        db.flush()
        product = PartnerProduct(partner_id=partner.id, name="Courier Service", category="Courier", price=100, stock=0, active=True, approval_status="approved")
        db.add(product)
        db.flush()
        order = PublicOrder(payment_method="cash", total_amount=100, status="pending_approval", items_json='[{"product_id":"%s","product_type":"associate_partner","listing_type":"service","is_service":true,"name":"Courier Service","price":100,"subtotal":100,"pre_tax":100,"quantity":1,"gst_percent":0,"gst_amount":0}]' % product.id)
        db.add(order)
        db.commit()
        _save_delivery_trip(db, {"id": "DEL-WALLET-CONFIRM", "partner_id": partner.id, "order_id": order.id, "status": "booked", "fare_final": 100, "required_commission_reserve": 10})
        identity = SimpleNamespace(role="partner", email=partner.email, phone="")

        with pytest.raises(Exception) as exc_info:
            partner_delivery_confirm_booking("DEL-WALLET-CONFIRM", db, identity)
        detail = exc_info.value.detail
        assert detail["code"] == "WALLET_INSUFFICIENT"
        assert detail["required_amount"] == 10
        assert detail["available_balance"] == 0
        assert detail["shortfall"] == 10
        assert _load_partner_wallet(db, partner.id)["balance"] == 0
        assert db.query(PublicOrder).one().status == "pending_approval"
        assert db.query(AppSetting).filter(AppSetting.key == "partner_wallet_tx:%s" % partner.id).count() == 0

        _save_partner_wallet(db, partner.id, {"balance": 10, "total_credit": 10, "total_debit": 0})
        confirmed = partner_delivery_confirm_booking("DEL-WALLET-CONFIRM", db, identity)
        assert confirmed["booking"]["status"] == "confirmed"
        assert _load_partner_wallet(db, partner.id)["balance"] == 0
    finally:
        db.close()


def test_wallet_credit_auto_confirms_linked_transport_trip(monkeypatch):
    db = make_session()
    try:
        partner = AssociatePartner(partner_code="MTH-AUTO-TRIP", business_name="Auto Trip Partner", email="auto-trip@example.com", commission_percent=10, active=True)
        db.add(partner)
        db.flush()
        product = PartnerProduct(partner_id=partner.id, name="Cab Service", category="Transport", price=100, stock=0, active=True, approval_status="approved")
        db.add(product)
        db.flush()
        order = PublicOrder(status="pending_approval", total_amount=100, items_json='[{"product_id":"%s","product_type":"associate_partner","listing_type":"service","is_service":true}]' % product.id)
        db.add(order)
        db.commit()
        _save_transport_trip(db, {"id": "TRIP-AUTO", "partner_id": partner.id, "order_id": order.id, "status": "booked", "fare_final": 100})
        monkeypatch.setattr("sql_app.routers.compat.admin_approve_order", lambda **kwargs: {"rewards_earned": {}, "commission_split": {}})
        result = _auto_approve_pending_orders_for_partner(db, partner.id, "test wallet credit")
        assert result["approved"] == 1
        assert result["approved_trip_ids"] == ["TRIP-AUTO"]
        assert _load_transport_trip(db, "TRIP-AUTO")["status"] == "confirmed"
    finally:
        db.close()


@pytest.mark.parametrize("path, terminal", [
    (["confirmed"], "cancelled"),
    (["confirmed", "pickup_assigned", "picked_up", "in_transit"], "failed_delivery"),
    (["confirmed", "pickup_assigned", "picked_up", "in_transit", "failed_delivery"], "returned"),
])
def test_courier_terminal_states_are_server_authoritative(path, terminal):
    db = make_session()
    try:
        partner = AssociatePartner(partner_code=f"MTH-COURIER-{terminal}", business_name="Courier", email=f"{terminal}@example.com", active=True)
        db.add(partner)
        db.flush()
        _save_delivery_trip(db, {"id": f"DEL-{terminal}", "partner_id": partner.id, "status": "booked"})
        identity = SimpleNamespace(role="partner", email=partner.email, phone="")
        for status in path:
            partner_delivery_update_status(f"DEL-{terminal}", {"status": status}, db, identity)
        result = partner_delivery_update_status(f"DEL-{terminal}", {"status": terminal}, db, identity)
        assert result["booking"]["status"] == terminal
        with pytest.raises(Exception):
            partner_delivery_update_status(f"DEL-{terminal}", {"status": "delivered"}, db, identity)
    finally:
        db.close()
