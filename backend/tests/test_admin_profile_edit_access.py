import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AppSetting, AssociatePartner, User
from sql_app.routers.compat import admin_partners_update, admin_update_user
from sql_app.routers.rider import _profile, admin_update_rider


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def admin():
    return SimpleNamespace(role="super_admin", id="ADMIN-REAL")


def member(db, user_id, phone, pan):
    user = User(id=user_id, name=user_id, email=f"{user_id}@test.local", phone=phone, password="hashed", role="member", is_active=True)
    db.add(user)
    db.flush()
    db.add(AppSetting(key=f"user_profile:{user_id}", value_json=json.dumps({"pan_no": pan, "phone": phone})))
    db.commit()
    return user


def rider(db, user_id, phone, pan):
    user = User(id=user_id, name=user_id, email=f"{user_id}@test.local", phone=phone, password="hashed", role="rider", is_active=False)
    db.add(user)
    db.add(AppSetting(key=f"rider_profile:{user_id}", value_json=json.dumps({"pan_no": pan, "phone": phone, "bank_name": "Old Bank"})))
    db.commit()
    return user


def partner(db, partner_id, phone, pan):
    row = AssociatePartner(id=partner_id, partner_code=f"P-{partner_id}", business_name="Business", contact_person="Owner", phone=phone, email=f"{partner_id}@test.local", gst_no=pan)
    db.add(row)
    db.commit()
    return row


def test_admin_can_save_member_own_mobile_pan_and_profile():
    db = make_session()
    try:
        target = member(db, "MEMBER-1", "7908468696", "ABCDE1234F")
        result = admin_update_user(target.id, {"name": "Updated", "phone": target.phone, "pan_no": "ABCDE1234F", "dob": "1974-10-01", "address": "New Road", "aadhaar_no": "123456789012", "city": "Kolkata", "state": "WB", "pincode": "700001"}, db, admin())
        profile = json.loads(db.query(AppSetting).filter_by(key=f"user_profile:{target.id}").one().value_json)
        assert result["ok"] is True
        assert target.phone == "7908468696"
        assert profile["pan_no"] == "ABCDE1234F"
        assert profile["address"] == "New Road"
    finally:
        db.close()


def test_member_edit_blocks_other_member_but_allows_cross_role_values():
    db = make_session()
    try:
        target = member(db, "MEMBER-1", "7908468696", "ABCDE1234F")
        other = member(db, "MEMBER-2", "7000000000", "BCDEF1234G")
        partner(db, "PARTNER-1", "7000000000", "BCDEF1234G")
        rider(db, "RIDER-1", "8000000000", "CDEFG1234H")
        with pytest.raises(HTTPException, match="Phone number"):
            admin_update_user(target.id, {"phone": other.phone}, db, admin())
        with pytest.raises(HTTPException, match="PAN number"):
            admin_update_user(target.id, {"pan_no": "BCDEF1234G"}, db, admin())
        admin_update_user(target.id, {"phone": "8000000000", "pan_no": "CDEFG1234H"}, db, admin())
    finally:
        db.close()


def test_admin_can_edit_partner_full_profile_and_own_values():
    db = make_session()
    try:
        target = partner(db, "PARTNER-1", "7908468696", "ABCDE1234F")
        result = admin_partners_update(target.id, {"business_name": "Updated Business", "contact_person": "New Owner", "phone": target.phone, "gst_no": target.gst_no, "email": "new@test.local", "address": "New Address", "city": "Kolkata", "state": "WB", "pincode": "700001", "upi_id": "new@upi", "whatsapp_no": target.phone, "business_description": "Updated", "commission_percent": 12}, db, admin())
        assert result["ok"] is True
        assert target.business_name == "Updated Business"
        assert target.gst_no == "ABCDE1234F"
        assert target.upi_id == "new@upi"
    finally:
        db.close()


def test_partner_edit_blocks_other_partner_mobile_and_pan():
    db = make_session()
    try:
        target = partner(db, "PARTNER-1", "7908468696", "ABCDE1234F")
        other = partner(db, "PARTNER-2", "7000000000", "BCDEF1234G")
        with pytest.raises(HTTPException, match="another partner"):
            admin_partners_update(target.id, {"phone": other.phone}, db, admin())
        with pytest.raises(HTTPException, match="another partner"):
            admin_partners_update(target.id, {"gst_no": other.gst_no}, db, admin())
    finally:
        db.close()


def test_admin_can_edit_rider_full_profile_and_own_values():
    db = make_session()
    try:
        target = rider(db, "RIDER-1", "7908468696", "ABCDE1234F")
        result = admin_update_rider(target.id, {"name": "Updated Rider", "phone": target.phone, "pan_no": "ABCDE1234F", "bank_name": "New Bank", "bank_account_number": "123", "upi_id": "new@upi", "address": "New Address"}, db, admin())
        profile = _profile(db, target.id)
        assert result["rider"]["name"] == "Updated Rider"
        assert profile["pan_no"] == "ABCDE1234F"
        assert profile["bank_name"] == "New Bank"
    finally:
        db.close()


def test_rider_edit_blocks_other_rider_mobile_and_pan():
    db = make_session()
    try:
        target = rider(db, "RIDER-1", "7908468696", "ABCDE1234F")
        other = rider(db, "RIDER-2", "7000000000", "BCDEF1234G")
        with pytest.raises(HTTPException, match="Phone already registered"):
            admin_update_rider(target.id, {"phone": other.phone}, db, admin())
        with pytest.raises(HTTPException, match="PAN already registered"):
            admin_update_rider(target.id, {"pan_no": "BCDEF1234G"}, db, admin())
    finally:
        db.close()


def test_non_admin_cannot_use_partner_or_rider_edit_endpoints():
    db = make_session()
    try:
        target_partner = partner(db, "PARTNER-1", "7908468696", "ABCDE1234F")
        target_rider = rider(db, "RIDER-1", "8000000000", "BCDEF1234G")
        actor = SimpleNamespace(role="member", id="MEMBER-1")
        with pytest.raises(HTTPException, match="Admin access required"):
            admin_partners_update(target_partner.id, {"phone": "7000000000"}, db, actor)
        with pytest.raises(HTTPException, match="Admin credentials"):
            admin_update_rider(target_rider.id, {"phone": "7000000000"}, db, actor)
    finally:
        db.close()
