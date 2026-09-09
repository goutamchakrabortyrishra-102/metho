import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import User, UserReferral
from sql_app.routers.auth import register
from sql_app.routers.compat import _leader_qualification_snapshot, _member_activation_datetime, admin_update_user
from sql_app.schemas import RegisterRequest
from sql_app.voice_caller import registration_type_for


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def add_user(db, member_id, role="member"):
    user = User(id=member_id, name=member_id, email=f"{member_id}@test.local", phone=member_id[-10:], password="hashed", role=role, is_active=True)
    db.add(user)
    db.flush()
    return user


def test_registration_defaults_to_admin_sponsor(monkeypatch):
    db = make_session()
    try:
        admin = add_user(db, "MAU00001", "super_admin")
        db.commit()
        monkeypatch.setattr("sql_app.routers.auth.hash_password", lambda value: "hashed")
        monkeypatch.setattr("sql_app.routers.auth.build_welcome_pdf", lambda user: "")
        monkeypatch.setattr("sql_app.routers.auth.send_welcome_email", lambda *args: False)
        result = register(RegisterRequest(name="New", email="MAU12345", phone="9999999999", pan_no="ABCDE1234F", password="secret1"), db)
        created = db.query(User).filter(User.id == "MAU12345").one()
        relation = db.query(UserReferral).filter(UserReferral.user_id == created.id).one()
        assert result["user"]["sponsor_code"] == "MAU00001"
        assert relation.sponsor_user_id == admin.id
    finally:
        db.close()


def test_registration_accepts_valid_custom_sponsor_code(monkeypatch):
    db = make_session()
    try:
        admin = add_user(db, "MAU00001", "super_admin")
        sponsor = add_user(db, "MAU10001", "member")
        db.commit()
        monkeypatch.setattr("sql_app.routers.auth.hash_password", lambda value: "hashed")
        monkeypatch.setattr("sql_app.routers.auth.build_welcome_pdf", lambda user: "")
        monkeypatch.setattr("sql_app.routers.auth.send_welcome_email", lambda *args: False)
        result = register(RegisterRequest(name="Custom Sponsor", email="MAU12346", phone="9999999998", pan_no="BCDEF1234G", password="secret1", sponsor_code="MAU10001"), db)
        relation = db.query(UserReferral).filter(UserReferral.user_id == "MAU12346").one()
        assert result["user"]["sponsor_code"] == sponsor.id
        assert relation.sponsor_user_id == sponsor.id
        assert relation.sponsor_user_id != admin.id
    finally:
        db.close()


def test_registration_rejects_unknown_sponsor_code_before_creating_member():
    db = make_session()
    try:
        add_user(db, "MAU00001", "super_admin")
        db.commit()
        with pytest.raises(Exception, match="Sponsor code not found"):
            register(RegisterRequest(name="Invalid Sponsor", email="MAU12347", phone="9999999997", pan_no="CDEFG1234H", password="secret1", sponsor_code="MAU99999"), db)
        assert db.query(User).filter(User.id == "MAU12347").count() == 0
    finally:
        db.close()


def test_member_registration_rejects_duplicate_phone(monkeypatch):
    db = make_session()
    try:
        add_user(db, "MAU00001", "super_admin")
        db.commit()
        monkeypatch.setattr("sql_app.routers.auth.hash_password", lambda value: "hashed")
        monkeypatch.setattr("sql_app.routers.auth.build_welcome_pdf", lambda user: "")
        monkeypatch.setattr("sql_app.routers.auth.send_welcome_email", lambda *args: False)
        register(RegisterRequest(name="First", email="MAU22345", phone="9999999999", pan_no="DEFGH1234I", password="secret1"), db)
        with pytest.raises(Exception, match="Phone number already registered"):
            register(RegisterRequest(name="Second", email="MAU22346", phone="+91 99999 99999", pan_no="EFGHI1234J", password="secret1"), db)
        assert db.query(User).filter(User.id == "MAU22346").count() == 0
    finally:
        db.close()


def test_member_registration_rejects_duplicate_pan(monkeypatch):
    db = make_session()
    try:
        add_user(db, "MAU00001", "super_admin")
        db.commit()
        monkeypatch.setattr("sql_app.routers.auth.hash_password", lambda value: "hashed")
        monkeypatch.setattr("sql_app.routers.auth.build_welcome_pdf", lambda user: "")
        monkeypatch.setattr("sql_app.routers.auth.send_welcome_email", lambda *args: False)
        register(RegisterRequest(name="First", email="MAU32345", phone="9888888888", pan_no="FGHIJ1234K", password="secret1"), db)
        with pytest.raises(Exception, match="PAN number already registered"):
            register(RegisterRequest(name="Second", email="MAU32346", phone="9777777777", pan_no="fghij1234k", password="secret1"), db)
        assert db.query(User).filter(User.id == "MAU32346").count() == 0
    finally:
        db.close()


def test_member_registration_requires_valid_pan_before_creating_member():
    db = make_session()
    try:
        add_user(db, "MAU00001", "super_admin")
        db.commit()
        with pytest.raises(Exception, match="PAN number is required"):
            register(RegisterRequest(name="Invalid PAN", email="MAU32347", phone="9666666666", pan_no="", password="secret1"), db)
        assert db.query(User).filter(User.id == "MAU32347").count() == 0
    finally:
        db.close()


def test_admin_sponsor_change_updates_relation_and_rejects_downline_cycle():
    db = make_session()
    try:
        admin = add_user(db, "MAU00001", "super_admin")
        parent = add_user(db, "MAU10001")
        child = add_user(db, "MAU10002")
        db.add(UserReferral(user_id=parent.id, sponsor_user_id=admin.id, sponsor_code="MAU00001"))
        db.add(UserReferral(user_id=child.id, sponsor_user_id=parent.id, sponsor_code="MAU10001"))
        db.commit()
        actor = SimpleNamespace(role="admin", id=admin.id)
        admin_update_user(parent.id, {"sponsor_code": ""}, db, actor)
        relation = db.query(UserReferral).filter(UserReferral.user_id == parent.id).one()
        assert relation.sponsor_user_id == admin.id
        with pytest.raises(Exception, match="downline"):
            admin_update_user(parent.id, {"sponsor_code": "MAU10002"}, db, actor)
    finally:
        db.close()


def test_admin_cannot_assign_sponsor_to_non_member_account():
    db = make_session()
    try:
        admin = add_user(db, "MAU00001", "super_admin")
        partner = add_user(db, "PARTNER01", "partner")
        db.commit()
        actor = SimpleNamespace(role="admin", id=admin.id)
        with pytest.raises(Exception, match="member accounts"):
            admin_update_user(partner.id, {"sponsor_code": "MAU00001"}, db, actor)
    finally:
        db.close()


def test_activation_datetime_is_available_for_cycle_start():
    db = make_session()
    try:
        member = add_user(db, "MAU10003")
        from sql_app.routers.compat import _save_json_setting, _member_purchase_activation_key

        activated_at = "2026-09-07T10:30:00+00:00"
        _save_json_setting(db, _member_purchase_activation_key(member.id), {"active": True, "activated_at": activated_at})
        db.commit()
        assert _member_activation_datetime(db, member.id).isoformat() == activated_at
    finally:
        db.close()


def test_leader_qualification_snapshot_is_read_only_and_not_qualified_without_requirements():
    db = make_session()
    try:
        member = add_user(db, "MAU10004")
        db.commit()
        snapshot = _leader_qualification_snapshot(db, member)
        assert snapshot["qualified"] is False
        assert snapshot["grade"] == "Not Qualified"
        assert snapshot["checks"]["direct_members"]["passed"] is True
        assert db.query(UserReferral).count() == 0
    finally:
        db.close()