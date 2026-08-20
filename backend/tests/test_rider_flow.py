import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AppSetting, User
from sql_app.routers.auth import _login_user
from sql_app.routers.rider import (
    _profile,
    _set_rider_status,
    admin_riders,
    rider_me,
    rider_register,
    update_rider_availability,
)
from sql_app.schemas import LoginRequest, RiderRegisterRequest


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_rider_registration_stores_profile_and_starts_pending():
    db = make_session()
    try:
        result = rider_register(RiderRegisterRequest(
            name="Rider One", phone="9000000001", password="secret1",
            vehicle_type="Bike", vehicle_number="WB01A1234", whatsapp="9000000001", address="Road 1", pan_no="ABCDE1234D", aadhaar_no="123456789011", agreed_to_terms=True,
        ), db)
        rider = db.query(User).filter(User.id == result["rider"]["id"]).one()
        assert rider.role == "rider"
        assert rider.is_active is False
        assert _profile(db, rider.id)["vehicle_number"] == "WB01A1234"
        assert db.query(AppSetting).filter(AppSetting.key == f"rider_profile:{rider.id}").one()
    finally:
        db.close()


def test_rider_approval_allows_existing_login_and_pending_message_before_approval():
    db = make_session()
    try:
        result = rider_register(RiderRegisterRequest(
            name="Rider Two", phone="9000000002", password="secret1",
            vehicle_type="Auto", vehicle_number="WB02B2345", agreed_to_terms=True, whatsapp="9000000002", address="Road 2", pan_no="ABCDE1234F", aadhaar_no="123456789012",
        ), db)
        rider_id = result["rider"]["id"]
        rider = db.query(User).filter(User.id == rider_id).one()
        with pytest.raises(Exception, match="rider registration is awaiting"):
            _login_user(LoginRequest(email=rider.phone, password="secret1"), db)

        approved = _set_rider_status(rider.id, "approved", True, db, SimpleNamespace(role="admin"))
        assert approved["rider"]["approval_status"] == "approved"
        login = _login_user(LoginRequest(email=rider.phone, password="secret1"), db)
        assert login["user"]["role"] == "rider"
    finally:
        db.close()


def test_rider_admin_list_and_profile_endpoints_enforce_ownership():
    db = make_session()
    try:
        result = rider_register(RiderRegisterRequest(
            name="Rider Three", phone="9000000003", password="secret1",
            vehicle_type="Car", vehicle_number="WB03C3456", agreed_to_terms=True, whatsapp="9000000003", address="Road 3", pan_no="ABCDE1234G", aadhaar_no="123456789013",
        ), db)
        rider = db.query(User).filter(User.id == result["rider"]["id"]).one()
        admin = SimpleNamespace(role="super_admin", id="admin")
        assert len(admin_riders(db, admin)["riders"]) == 1
        with pytest.raises(Exception, match="ownership"):
            rider_me(SimpleNamespace(role="member", id="other", name="Member"), db)
        with pytest.raises(Exception, match="Admin credentials"):
            admin_riders(db, rider)
        rider.is_active = True
        db.commit()
        assert update_rider_availability({"availability": "online"}, rider, db)["availability"] == "online"
    finally:
        db.close()