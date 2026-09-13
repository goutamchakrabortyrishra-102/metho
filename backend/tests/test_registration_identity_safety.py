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
from sql_app.models import AppSetting, PartnerRequest, User, UserReferral
from sql_app.routers.auth import register
from sql_app.routers.compat import admin_update_user
from sql_app.routers.partner_public import partner_register
from sql_app.routers.rider import rider_register
from sql_app.schemas import RegisterRequest, RiderRegisterRequest


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def add_admin(db, user_id="ADMIN-REAL"):
    admin = User(id=user_id, name="METHO Admin", email="admin@test.local", phone="9000000000", password="hashed", role="super_admin", is_active=True)
    db.add(admin)
    db.commit()
    return admin


def add_member(db, user_id, phone, pan, sponsor_user_id=None):
    member = User(id=user_id, name=user_id, email=f"{user_id}@test.local", phone=phone, password="hashed", role="member", is_active=True)
    db.add(member)
    db.flush()
    db.add(AppSetting(key=f"user_profile:{user_id}", value_json=json.dumps({"pan_no": pan, "phone": phone})))
    if sponsor_user_id:
        db.add(UserReferral(user_id=user_id, sponsor_user_id=sponsor_user_id, sponsor_code=sponsor_user_id))
    db.commit()
    return member


def member_payload(member_id, phone, pan, sponsor_code=None):
    return RegisterRequest(
        name="New Member",
        email=member_id,
        phone=phone,
        pan_no=pan,
        password="secret1",
        sponsor_code=sponsor_code,
    )


def partner_payload(login_id, phone, pan, sponsor_code=None):
    return {
        "login_id": login_id,
        "password": "secret1",
        "business_name": "Partner Shop",
        "contact_person": "Partner One",
        "phone": phone,
        "pan_no": pan,
        "aadhaar_no": "123456789012",
        "sponsor_code": sponsor_code,
    }


def rider_payload(phone, pan, sponsor_code=None):
    return RiderRegisterRequest(
        name="Rider One",
        phone=phone,
        password="secret1",
        vehicle_type="Bike",
        whatsapp=phone,
        address="Road 1",
        pan_no=pan,
        aadhaar_no="123456789012",
        sponsor_code=sponsor_code,
        agreed_to_terms=True,
    )


def test_no_sponsor_for_all_roles_resolves_to_existing_admin(monkeypatch):
    db = make_session()
    try:
        admin = add_admin(db)
        monkeypatch.setattr("sql_app.routers.auth.hash_password", lambda value: "hashed")
        monkeypatch.setattr("sql_app.routers.auth.build_welcome_pdf", lambda user: "")
        monkeypatch.setattr("sql_app.routers.auth.send_welcome_email", lambda *args: False)
        member_result = register(member_payload("MAU12345", "9876543210", "ABCDE1234F"), db)
        partner_result = partner_register(partner_payload("partner@test.local", "9876543210", "ABCDE1234F"), db)
        rider_result = rider_register(rider_payload("9876543210", "ABCDE1234F"), db)

        member_relation = db.query(UserReferral).filter_by(user_id=member_result["user"]["id"]).one()
        partner_request = db.query(PartnerRequest).filter_by(id=partner_result["request_id"]).one()
        partner_meta = db.query(AppSetting).filter_by(key=f"partner_classification:request:{partner_request.id}").one()
        rider_profile = json.loads(db.query(AppSetting).filter_by(key=f"rider_profile:{rider_result['rider']['id']}").one().value_json)
        assert member_relation.sponsor_user_id == admin.id
        assert json.loads(partner_meta.value_json)["sponsor_user_id"] == admin.id
        assert rider_profile["sponsor_user_id"] == admin.id
    finally:
        db.close()


def test_same_mobile_and_pan_are_allowed_once_per_role(monkeypatch):
    db = make_session()
    try:
        add_admin(db)
        monkeypatch.setattr("sql_app.routers.auth.hash_password", lambda value: "hashed")
        monkeypatch.setattr("sql_app.routers.auth.build_welcome_pdf", lambda user: "")
        monkeypatch.setattr("sql_app.routers.auth.send_welcome_email", lambda *args: False)
        register(member_payload("MAU12345", "9876543210", "ABCDE1234F"), db)
        partner_register(partner_payload("partner@test.local", "9876543210", "ABCDE1234F"), db)
        rider_register(rider_payload("9876543210", "ABCDE1234F"), db)
        assert db.query(User).filter(User.role == "member").count() == 1
        assert db.query(PartnerRequest).count() == 1
        assert db.query(User).filter(User.role == "rider").count() == 1
    finally:
        db.close()


def test_same_role_duplicate_mobile_and_pan_are_rejected(monkeypatch):
    db = make_session()
    try:
        add_admin(db)
        monkeypatch.setattr("sql_app.routers.auth.hash_password", lambda value: "hashed")
        monkeypatch.setattr("sql_app.routers.auth.build_welcome_pdf", lambda user: "")
        monkeypatch.setattr("sql_app.routers.auth.send_welcome_email", lambda *args: False)
        register(member_payload("MAU12345", "9876543210", "ABCDE1234F"), db)
        with pytest.raises(HTTPException, match="Phone number already registered"):
            register(member_payload("MAU12346", "9876543210", "BCDEF1234G"), db)
        with pytest.raises(HTTPException, match="PAN number already registered"):
            register(member_payload("MAU12347", "9876543211", "ABCDE1234F"), db)

        partner_register(partner_payload("partner@test.local", "9876543210", "ABCDE1234F"), db)
        with pytest.raises(HTTPException, match="mobile number already"):
            partner_register(partner_payload("partner2@test.local", "9876543210", "BCDEF1234G"), db)
        with pytest.raises(HTTPException, match="PAN already"):
            partner_register(partner_payload("partner3@test.local", "9876543211", "ABCDE1234F"), db)

        rider_register(rider_payload("9876543210", "ABCDE1234F"), db)
        with pytest.raises(HTTPException, match="Phone already registered"):
            rider_register(rider_payload("9876543210", "BCDEF1234G"), db)
        with pytest.raises(HTTPException, match="PAN already registered"):
            rider_register(rider_payload("9876543211", "ABCDE1234F"), db)
    finally:
        db.close()


def test_maU00001_alias_resolves_existing_admin_without_new_user(monkeypatch):
    db = make_session()
    try:
        admin = add_admin(db)
        monkeypatch.setattr("sql_app.routers.auth.hash_password", lambda value: "hashed")
        monkeypatch.setattr("sql_app.routers.auth.build_welcome_pdf", lambda user: "")
        monkeypatch.setattr("sql_app.routers.auth.send_welcome_email", lambda *args: False)
        result = register(member_payload("MAU12345", "9876543210", "ABCDE1234F", "MAU00001"), db)
        relation = db.query(UserReferral).filter_by(user_id=result["user"]["id"]).one()
        assert relation.sponsor_user_id == admin.id
        assert db.query(User).filter(User.id == "MAU00001").count() == 0
        assert db.query(User).filter(User.role.in_(["admin", "company_admin", "super_admin"])).count() == 1
    finally:
        db.close()


def test_admin_sponsor_edit_allows_own_and_downline_rejects_other_branches_and_cycles():
    db = make_session()
    try:
        admin = add_admin(db)
        downline = add_member(db, "MAU10001", "9000000001", "ABCDE1234G", admin.id)
        target = add_member(db, "MAU10002", "9000000002", "ABCDE1234H", admin.id)
        unrelated = add_member(db, "MAU10003", "9000000003", "ABCDE1234I")
        ancestor = add_member(db, "MAU10004", "9000000004", "ABCDE1234J")
        db.query(UserReferral).filter_by(user_id=admin.id).delete()
        db.add(UserReferral(user_id=admin.id, sponsor_user_id=ancestor.id, sponsor_code=ancestor.id))
        child = add_member(db, "MAU10005", "9000000005", "ABCDE1234K", target.id)
        db.commit()
        actor = SimpleNamespace(role="super_admin", id=admin.id)

        admin_update_user(target.id, {"sponsor_code": admin.id}, db, actor)
        admin_update_user(target.id, {"sponsor_code": downline.id}, db, actor)
        with pytest.raises(HTTPException, match="Admin's downline"):
            admin_update_user(target.id, {"sponsor_code": unrelated.id}, db, actor)
        with pytest.raises(HTTPException, match="Admin's downline"):
            admin_update_user(target.id, {"sponsor_code": ancestor.id}, db, actor)
        with pytest.raises(HTTPException, match="downline"):
            admin_update_user(target.id, {"sponsor_code": child.id}, db, actor)
        with pytest.raises(HTTPException, match="Admin access required"):
            admin_update_user(target.id, {"sponsor_code": admin.id}, db, SimpleNamespace(role="member", id=downline.id))
    finally:
        db.close()