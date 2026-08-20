import hashlib
import hmac
import json
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AppSetting, User
from sql_app.routers.direct_booking import (
    BOOKINGS_KEY,
    EARNINGS_KEY,
    _json_list,
    _save_json_list,
    admin_assign_direct_booking,
    create_direct_booking,
    direct_razorpay_order,
    rider_accept_direct_booking,
    rider_complete_direct_booking,
    verify_direct_payment,
    calculate_direct_amount,
)
from sql_app.routers.rider import _save_profile


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def user(db, role, name, active=True):
    row = User(name=name, email=f"{name.lower()}@metho.test", phone="9000000000", password="x", role=role, is_active=active)
    db.add(row)
    db.flush()
    return row


def profile(db, rider, latitude, longitude):
    _save_profile(db, rider.id, {"approval_status": "approved", "availability": "online", "latitude": latitude, "longitude": longitude})
    db.commit()


def booking_payload(member_ref=""):
    return {"service_type": "bike", "pickup": "A", "destination": "B", "customer_name": "Customer", "customer_phone": "9999999999", "member_ref": member_ref, "distance_km": 2}


def test_amount_uses_current_transport_rate():
    assert calculate_direct_amount("auto_rickshaw", {"metho_transport_rates": {"auto_rickshaw": 20}}, 3) == 60


def test_razorpay_signature_and_amount_are_verified(monkeypatch):
    db = make_session()
    try:
        booking = create_direct_booking(booking_payload(), db, None)["booking"]
        monkeypatch.setattr("sql_app.routers.direct_booking._load_checkout_razorpay_settings", lambda db: ({}, "key", "secret"))
        monkeypatch.setattr("sql_app.routers.direct_booking._razorpay_create_order", lambda *args: {"id": "rp_order"})
        direct_razorpay_order(booking["id"], db)
        payment_id = "rp_payment"
        signature = hmac.new(b"secret", b"rp_order|rp_payment", hashlib.sha256).hexdigest()
        result = verify_direct_payment(booking["id"], {"razorpay_order_id": "rp_order", "razorpay_payment_id": payment_id, "razorpay_signature": signature, "amount": booking["amount"]}, db)
        assert result["booking"]["status"] == "paid"
        wrong_amount_signature = hmac.new(b"secret", b"rp_order|other", hashlib.sha256).hexdigest()
        with pytest.raises(HTTPException, match="Payment amount mismatch"):
            verify_direct_payment(booking["id"], {"razorpay_order_id": "rp_order", "razorpay_payment_id": "other", "razorpay_signature": wrong_amount_signature, "amount": 1}, db)
    finally:
        db.close()


def test_nearest_assignment_and_ownership_are_enforced():
    db = make_session()
    try:
        admin = user(db, "admin", "Admin")
        near = user(db, "rider", "Near")
        far = user(db, "rider", "Far")
        profile(db, near, 1, 1)
        profile(db, far, 9, 9)
        booking = create_direct_booking({**booking_payload(), "pickup_latitude": 1.1, "pickup_longitude": 1.1}, db, None)["booking"]
        assigned = admin_assign_direct_booking(booking["id"], {}, db, admin)["booking"]
        assert assigned["rider_id"] == near.id
        with pytest.raises(HTTPException, match="ownership"):
            rider_accept_direct_booking(booking["id"], db, far)
    finally:
        db.close()


def test_completion_creates_one_idempotent_earning():
    db = make_session()
    try:
        rider = user(db, "rider", "Rider")
        profile(db, rider, 1, 1)
        settings = AppSetting(key="global", value_json=json.dumps({"metho_transport_rates": {"bike": 10}, "metho_rider_share_percent": 50}))
        db.add(settings)
        db.commit()
        booking = create_direct_booking(booking_payload(), db, None)["booking"]
        bookings = _json_list(db, BOOKINGS_KEY)
        stored_booking = next(item for item in bookings if item["id"] == booking["id"])
        stored_booking["status"] = "assigned"
        stored_booking["rider_id"] = rider.id
        _save_json_list(db, BOOKINGS_KEY, bookings)
        db.commit()
        rider_accept_direct_booking(booking["id"], db, rider)
        rider_complete_direct_booking(booking["id"], {}, db, rider)
        result = rider_complete_direct_booking(booking["id"], {}, db, rider)
        assert result["booking"]["status"] == "completed"
        assert len(_json_list(db, EARNINGS_KEY)) == 1
    finally:
        db.close()


def test_guest_and_member_attribution_stays_outside_smart_cycle():
    db = make_session()
    try:
        member = user(db, "member", "Member")
        guest = create_direct_booking(booking_payload(), db, None)["booking"]
        attributed = create_direct_booking(booking_payload("MAU12345"), db, member)["booking"]
        assert guest["customer_user_id"] == ""
        assert attributed["customer_user_id"] == member.id
        assert attributed["member_ref"] == "MAU12345"
        assert guest["smart_cycle"] is False and attributed["smart_cycle"] is False
    finally:
        db.close()