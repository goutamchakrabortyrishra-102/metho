import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AppSetting, AssociatePartner, PartnerOrderDelivery, PartnerProduct, PublicOrder, User
from sql_app.routers.partner_delivery import (
    admin_partner_deliveries,
    assign_partner_order_delivery,
    get_partner_delivery_location,
    partner_confirm_delivery_payment,
    partner_delivery_options,
    rider_confirm_delivery_payment,
    rider_partner_deliveries,
    set_partner_delivery_location,
    update_rider_partner_delivery,
)
from sql_app.routers.compat import settings_update
from sql_app.security import hash_password

ADMIN = SimpleNamespace(role="super_admin", id="admin")


def _setup(monkeypatch, *, status="paid", include_own_product=True, with_coords=True):
    monkeypatch.setattr("sql_app.routers.partner_delivery.load_settings", lambda _db: {
        "partner_delivery_min_charge": 20,
        "partner_delivery_per_km_charge": 8,
        "partner_delivery_max_charge": 200,
        "metho_rider_share_percent": 70,
    })
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    partner_user = User(id="pu1", name="Partner User", email="partner@example.com", phone="9000000001", password=hash_password("secret1"), role="partner", is_active=True)
    partner = AssociatePartner(partner_code="P1", business_name="Partner One", email="partner@example.com", phone="9000000001")
    rider = User(id="r1", name="Nearest Rider", email="rider1@example.com", phone="9000000002", password=hash_password("secret1"), role="rider", is_active=True)
    farther_rider = User(id="r2", name="Far Rider", email="rider2@example.com", phone="9000000003", password=hash_password("secret1"), role="rider", is_active=True)
    product = PartnerProduct(partner_id="pending", name="Sample", price=100, stock=5, approval_status="approved", active=True)
    db.add_all([partner_user, partner, rider, farther_rider])
    db.flush()
    product.partner_id = partner.id
    db.add(product)
    db.flush()
    items = [{"product_id": product.id, "product_type": "associate_partner", "name": "Sample", "quantity": 1, "subtotal": 100, "is_service": False}] if include_own_product else []
    order = PublicOrder(id="order1", customer_user_id="", member_ref="", payer_name="Customer", shipping_address="Delivery address", payment_method="razorpay", items_json=json.dumps(items), total_amount=100, status=status)
    db.add(order)
    fresh_location = datetime.now(timezone.utc).isoformat()
    db.add(AppSetting(key=f"rider_profile:{rider.id}", value_json=json.dumps({"approval_status": "approved", "availability": "online", "latitude": 22.90, "longitude": 88.40, "location_updated_at": fresh_location, "vehicle_type": "bike"})))
    db.add(AppSetting(key=f"rider_profile:{farther_rider.id}", value_json=json.dumps({"approval_status": "approved", "availability": "online", "latitude": 23.10, "longitude": 88.70, "location_updated_at": fresh_location, "vehicle_type": "bike"})))
    if with_coords:
        db.add(AppSetting(key="order_contact:order1", value_json=json.dumps({"delivery_latitude": 22.92, "delivery_longitude": 88.42})))
    db.commit()
    return db, partner_user, partner, rider, product, order


def test_partner_saves_pickup_and_sees_nearest_rider_and_capped_fee(monkeypatch):
    db, partner_user, partner, rider, _product, order = _setup(monkeypatch)
    try:
        saved = set_partner_delivery_location({"latitude": 22.90, "longitude": 88.40}, db, partner_user)
        assert saved["ok"] is True
        assert get_partner_delivery_location(db, partner_user)["latitude"] == 22.9
        options = partner_delivery_options(order.id, db, partner_user)
        assert options["riders"][0]["id"] == rider.id
        assert options["distance_method"] == "straight_line"
        assert options["partner_charge"] == 24.16
        assert options["rider_earning"] == 16.91
    finally:
        db.close()


def test_delivery_assignment_lifecycle_and_two_party_cash_confirmation(monkeypatch):
    db, partner_user, partner, rider, _product, order = _setup(monkeypatch)
    try:
        set_partner_delivery_location({"latitude": 22.90, "longitude": 88.40}, db, partner_user)
        assigned = assign_partner_order_delivery(order.id, {"rider_id": rider.id}, db, partner_user)
        job = assigned["delivery"]
        assert job["status"] == "assigned"
        assert job["partner_payment_status"] == "due"
        for status in ("accepted", "picked_up", "out_for_delivery", "delivered"):
            result = update_rider_partner_delivery(job["id"], {"status": status}, db, rider)
        assert result["delivery"]["status"] == "delivered"
        with pytest.raises(HTTPException) as error:
            rider_confirm_delivery_payment(job["id"], db, rider)
        assert error.value.status_code == 409
        assert partner_confirm_delivery_payment(job["id"], db, partner_user)["payment_status"] == "partner_confirmed"
        assert rider_confirm_delivery_payment(job["id"], db, rider)["payment_status"] == "paid"
        assert rider_partner_deliveries(db, rider)["items"][0]["partner_payment_status"] == "paid"
        db.refresh(order)
        assert order.status == "paid"
        assert order.total_amount == 100
    finally:
        db.close()


def test_delivery_rejects_unpaid_non_owned_or_missing_location(monkeypatch):
    db, partner_user, _partner, _rider, _product, order = _setup(monkeypatch, status="pending_approval", with_coords=False)
    try:
        with pytest.raises(HTTPException) as error:
            partner_delivery_options(order.id, db, partner_user)
        assert error.value.status_code == 409
        order.status = "paid"
        db.commit()
        set_partner_delivery_location({"latitude": 22.90, "longitude": 88.40}, db, partner_user)
        with pytest.raises(HTTPException) as error:
            partner_delivery_options(order.id, db, partner_user)
        assert error.value.status_code == 409
        db.add(AppSetting(key="partner_delivery_location:missing", value_json="{}"))
        db.commit()
        with pytest.raises(HTTPException):
            assign_partner_order_delivery(order.id, {"rider_id": "r1"}, db, partner_user)
        assert db.query(PartnerOrderDelivery).count() == 0
    finally:
        db.close()


def test_admin_delivery_report_counts_jobs_riders_and_unpaid_fees(monkeypatch):
    db, partner_user, _partner, rider, _product, order = _setup(monkeypatch)
    try:
        set_partner_delivery_location({"latitude": 22.90, "longitude": 88.40}, db, partner_user)
        assign_partner_order_delivery(order.id, {"rider_id": rider.id}, db, partner_user)
        report = admin_partner_deliveries("", db, ADMIN)
        assert report["total"] == 1
        assert report["active"] == 1
        assert report["working_riders"] == 1
        assert report["partner_due_total"] == 24.16
        assert report["rider_due_total"] == 16.91
        assert report["partner_summary"][0]["total"] == 1
        assert report["rider_summary"][0]["name"] == rider.name
        with pytest.raises(HTTPException) as error:
            admin_partner_deliveries("", db, SimpleNamespace(role="partner", id="p"))
        assert error.value.status_code == 403
    finally:
        db.close()


def test_only_one_delivery_per_partner_and_order_and_busy_rider_is_hidden(monkeypatch):
    db, partner_user, _partner, rider, _product, order = _setup(monkeypatch)
    try:
        set_partner_delivery_location({"latitude": 22.90, "longitude": 88.40}, db, partner_user)
        first = assign_partner_order_delivery(order.id, {"rider_id": rider.id}, db, partner_user)
        repeated = assign_partner_order_delivery(order.id, {"rider_id": rider.id}, db, partner_user)
        assert repeated["duplicate"] is True
        options = partner_delivery_options(order.id, db, partner_user)
        assert all(item["id"] != rider.id for item in options["riders"])
        assert db.query(PartnerOrderDelivery).count() == 1
    finally:
        db.close()


def test_admin_minimum_maximum_and_partner_rider_share_are_applied(monkeypatch):
    db, partner_user, _partner, _rider, _product, order = _setup(monkeypatch)
    try:
        set_partner_delivery_location({"latitude": 22.90, "longitude": 88.40}, db, partner_user)
        monkeypatch.setattr("sql_app.routers.partner_delivery.load_settings", lambda _db: {
            "partner_delivery_min_charge": 30,
            "partner_delivery_per_km_charge": 0.1,
            "partner_delivery_max_charge": 40,
            "partner_delivery_rider_share_percent": 25,
        })
        floor_options = partner_delivery_options(order.id, db, partner_user)
        assert floor_options["partner_charge"] == 30
        assert floor_options["rider_earning"] == 7.5

        monkeypatch.setattr("sql_app.routers.partner_delivery.load_settings", lambda _db: {
            "partner_delivery_min_charge": 20,
            "partner_delivery_per_km_charge": 100,
            "partner_delivery_max_charge": 35,
            "partner_delivery_rider_share_percent": 50,
        })
        cap_options = partner_delivery_options(order.id, db, partner_user)
        assert cap_options["partner_charge"] == 35
        assert cap_options["rider_earning"] == 17.5
    finally:
        db.close()


def test_admin_settings_update_changes_new_delivery_quotes_dynamically(monkeypatch):
    monkeypatch.undo()
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    partner_user = User(id="pu-dynamic", name="Partner User", email="dynamic@example.com", phone="9000000011", password=hash_password("secret1"), role="partner", is_active=True)
    partner = AssociatePartner(partner_code="P-DYNAMIC", business_name="Dynamic Partner", email="dynamic@example.com", phone="9000000011")
    rider = User(id="r-dynamic", name="Dynamic Rider", email="dynamic-rider@example.com", phone="9000000012", password=hash_password("secret1"), role="rider", is_active=True)
    product = PartnerProduct(name="Dynamic item", price=50, stock=2, approval_status="approved", active=True)
    db.add_all([partner_user, partner, rider])
    db.flush()
    product.partner_id = partner.id
    db.add(product)
    db.flush()
    order = PublicOrder(id="dynamic-order", payer_name="Customer", shipping_address="Delivery", payment_method="razorpay", items_json=json.dumps([{"product_id": product.id, "product_type": "associate_partner", "quantity": 1, "subtotal": 50, "is_service": False}]), total_amount=50, status="paid")
    profile = {"approval_status": "approved", "availability": "online", "latitude": 22.9, "longitude": 88.4, "location_updated_at": datetime.now(timezone.utc).isoformat()}
    db.add_all([order, AppSetting(key=f"rider_profile:{rider.id}", value_json=json.dumps(profile)), AppSetting(key="order_contact:dynamic-order", value_json=json.dumps({"delivery_latitude": 22.92, "delivery_longitude": 88.42}))])
    db.commit()
    try:
        set_partner_delivery_location({"latitude": 22.90, "longitude": 88.40}, db, partner_user)
        first = settings_update({"partner_delivery_min_charge": 10, "partner_delivery_per_km_charge": 1, "partner_delivery_max_charge": 100, "partner_delivery_rider_share_percent": 50}, db, ADMIN)
        first_quote = partner_delivery_options(order.id, db, partner_user)
        second = settings_update({"partner_delivery_min_charge": 30, "partner_delivery_per_km_charge": 10, "partner_delivery_max_charge": 40, "partner_delivery_rider_share_percent": 25}, db, ADMIN)
        second_quote = partner_delivery_options(order.id, db, partner_user)
        assert first["partner_delivery_per_km_charge"] == 1
        assert second["partner_delivery_per_km_charge"] == 10
        assert second_quote["partner_charge"] != first_quote["partner_charge"]
        assert second_quote["rider_earning"] == round(second_quote["partner_charge"] * 0.25, 2)
        with pytest.raises(HTTPException) as error:
            settings_update({"partner_delivery_min_charge": 80, "partner_delivery_max_charge": 20}, db, ADMIN)
        assert error.value.status_code == 400
    finally:
        db.close()


def test_stale_rider_gps_is_not_offered(monkeypatch):
    db, partner_user, _partner, rider, _product, order = _setup(monkeypatch)
    try:
        set_partner_delivery_location({"latitude": 22.90, "longitude": 88.40}, db, partner_user)
        row = db.query(AppSetting).filter_by(key=f"rider_profile:{rider.id}").one()
        profile = json.loads(row.value_json)
        profile["location_updated_at"] = (datetime.now(timezone.utc) - timedelta(minutes=11)).isoformat()
        row.value_json = json.dumps(profile)
        db.commit()
        options = partner_delivery_options(order.id, db, partner_user)
        assert rider.id not in {item["id"] for item in options["riders"]}
        assert options["riders"]
    finally:
        db.close()
