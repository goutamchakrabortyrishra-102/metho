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
    rider_reject_direct_booking,
    rider_complete_direct_booking,
    verify_direct_payment,
    calculate_direct_amount,
)
from sql_app.routers.whatsapp import update_whatsapp_settings
from sql_app.routers.rider import _save_profile
from sql_app.routers.settings import load_settings
from sql_app.routers.partner_public import _infer_registration_sector_fields


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
    assert calculate_direct_amount("ebike", {"metho_transport_rates": {"bike": 12}}, 3) == 36


def test_move_and_delivery_categories_use_separate_rates_with_one_km_minimum():
    rates = {"bike": 12, "e_rickshaw": 16, "auto_rickshaw": 20, "four_wheeler": 24, "bolero_maxx": 28, "vehicle_207": 30, "vehicle_407": 36, "dumper": 45, "delivery": 14}
    for category, rate in rates.items():
        assert calculate_direct_amount(category, {"metho_transport_rates": rates}, 0.2) == rate


def test_existing_settings_receive_new_vehicle_rate_defaults():
    db = make_session()
    try:
        db.add(AppSetting(key="global", value_json=json.dumps({"metho_transport_rates": {"bike": 99}})))
        db.commit()
        rates = load_settings(db)["metho_transport_rates"]
        assert rates["bike"] == 99
        assert rates["bolero_maxx"] == 28
        assert rates["dumper"] == 45
    finally:
        db.close()


def test_vehicle_sales_are_classified_as_shop_but_rentals_remain_transport():
    sale = _infer_registration_sector_fields({"business_name": "Trusted Used Car Sale"})
    dealer = _infer_registration_sector_fields({"business_name": "Trusted Car Dealership"})
    rental = _infer_registration_sector_fields({"business_name": "City Car Rental"})
    assert sale == ("Shop", "", "Others")
    assert dealer == ("Shop", "", "Others")
    assert rental == ("Service", "Transport", "")
    assert calculate_direct_amount("bike", {"metho_transport_rates": {"bike": 12}}, 0.25) == 12
    assert calculate_direct_amount("delivery", {"metho_transport_rates": {"delivery": 14}}, 0.25) == 14


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


def test_delivery_type_is_supported_like_metho_move():
    db = make_session()
    try:
        rider = user(db, "rider", "Delivery Rider")
        profile(db, rider, 1, 1)
        booking = create_direct_booking({**booking_payload(), "service_type": "delivery", "request_assignment": True}, db, None)["booking"]
        assert booking["service_type"] == "delivery"
        assert booking["rider_id"] == rider.id
    finally:
        db.close()


def test_whatsapp_admin_can_store_autoreply_templates():
    db = make_session()
    try:
        config = update_whatsapp_settings(
            {
                "phone_number_id": "123",
                "access_token": "token-abc",
                "default_auto_reply": "Welcome!",
                "customer_auto_reply": "Hi customer",
                "member_auto_reply": "Hi member",
                "partner_auto_reply": "Hi partner",
                "invoice_template": "Invoice ready",
                "order_template": "Order update",
            },
            db,
            user(db, "admin", "Admin"),
        )
        assert config["default_auto_reply"] == "Welcome!"
        assert config["customer_auto_reply"] == "Hi customer"
        assert config["invoice_template"] == "Invoice ready"
    finally:
        db.close()


def test_booking_waits_for_driver_accept_and_rejects_to_next_rider(monkeypatch):
    db = make_session()
    try:
        first = user(db, "rider", "First")
        second = user(db, "rider", "Second")
        profile(db, first, 1, 1)
        profile(db, second, 2, 2)

        booking = create_direct_booking({**booking_payload(), "request_assignment": False}, db, None)["booking"]
        assert booking["status"] == "awaiting_driver_assignment"
        assert booking["rider_id"] == ""
        assert len(booking.get("candidate_riders", [])) >= 2

        booking = admin_assign_direct_booking(booking["id"], {"rider_id": str(first.id)}, db, user(db, "admin", "Admin"))["booking"]
        assert booking["rider_id"] == first.id

        rejected = rider_reject_direct_booking(booking["id"], db, first)["booking"]
        assert rejected["rider_id"] == second.id
        assert rejected["status"] == "awaiting_driver_assignment"

        next_booking = rider_accept_direct_booking(booking["id"], db, second)
        assert next_booking["booking"]["status"] == "accepted"
    finally:
        db.close()


def test_driver_accept_generates_booking_code_and_sends_whatsapp(monkeypatch):
    db = make_session()
    try:
        rider = user(db, "rider", "Rider")
        profile(db, rider, 1, 1)
        calls = []

        def fake_send(db_obj, recipient, text=None, template_name=None, template_language_code=None, template_parameters=None):
            calls.append({"recipient": recipient, "text": text, "template_name": template_name})
            return {"messages": [{"id": "wamid.test"}]}

        monkeypatch.setattr("sql_app.routers.direct_booking.send_whatsapp_message", fake_send)
        booking = create_direct_booking({**booking_payload(), "customer_phone": "8801712345678", "request_assignment": False}, db, None)["booking"]
        booking = admin_assign_direct_booking(booking["id"], {"rider_id": str(rider.id)}, db, user(db, "admin", "Admin"))["booking"]
        accepted = rider_accept_direct_booking(booking["id"], db, rider)["booking"]

        assert accepted["booking_code"].startswith("MM-")
        assert any(call["recipient"] == "8801712345678" for call in calls)
        assert any(call["recipient"] == rider.phone for call in calls)
    finally:
        db.close()