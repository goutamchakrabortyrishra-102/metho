import json
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AppSetting, PartnerRequest, User, WhatsAppMessageOutbox
from sql_app.routers.partner_public import _queue_partner_registration_welcome, partner_register
from sql_app.routers.rider import _profile, _queue_rider_registration_welcome, rider_register
from sql_app.schemas import RiderRegisterRequest


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def add_sponsor(db):
    sponsor = User(id="MAU10001", name="Sponsor", email="MAU10001", phone="9000000000", password="hashed", role="member", is_active=True)
    db.add(sponsor)
    db.commit()
    return sponsor


def partner_payload(**updates):
    payload = {
        "login_id": "partner@example.com",
        "password": "secret1",
        "business_name": "Partner Shop",
        "contact_person": "Partner One",
        "phone": "9111111111",
        "whatsapp_no": "9222222222",
        "pan_no": "ABCDE1234F",
        "aadhaar_no": "123456789012",
        "sponsor_code": "MAU10001",
    }
    payload.update(updates)
    return payload


def rider_payload(**updates):
    payload = {
        "name": "Rider One",
        "phone": "9333333333",
        "password": "secret1",
        "vehicle_type": "Bike",
        "whatsapp": "9444444444",
        "address": "Road 1",
        "pan_no": "BCDEF1234G",
        "aadhaar_no": "123456789012",
        "sponsor_code": "MAU10001",
        "agreed_to_terms": True,
    }
    payload.update(updates)
    return RiderRegisterRequest(**payload)


def test_partner_registration_persists_sponsor_and_queues_one_welcome():
    db = make_session()
    try:
        sponsor = add_sponsor(db)
        result = partner_register(partner_payload(), db)

        metadata = db.query(AppSetting).filter_by(key=f"partner_classification:request:{result['request_id']}").one()
        attribution = json.loads(metadata.value_json)
        outbox = db.query(WhatsAppMessageOutbox).one()
        assert attribution["sponsor_user_id"] == sponsor.id
        assert attribution["sponsor_code"] == sponsor.id
        assert outbox.dedupe_key == f"partner-registration-welcome:{result['request_id']}"
        assert outbox.recipient == "9222222222"
        assert "Partner One" in outbox.message
    finally:
        db.close()


def test_partner_failed_registration_queues_no_welcome():
    db = make_session()
    try:
        add_sponsor(db)
        with pytest.raises(Exception, match="Sponsor code not found"):
            partner_register(partner_payload(sponsor_code="MAU99999"), db)
        assert db.query(PartnerRequest).count() == 0
        assert db.query(WhatsAppMessageOutbox).count() == 0
    finally:
        db.close()


def test_partner_registration_rejects_self_referral():
    db = make_session()
    try:
        sponsor = add_sponsor(db)
        with pytest.raises(Exception, match="Login ID already exists"):
            partner_register(partner_payload(login_id=sponsor.email, phone="9111111111"), db)
        assert db.query(PartnerRequest).count() == 0
    finally:
        db.close()


def test_partner_queue_failure_keeps_registration_successful(monkeypatch):
    db = make_session()
    try:
        add_sponsor(db)
        monkeypatch.setattr("sql_app.whatsapp_ai.enqueue_whatsapp_message", lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("queue unavailable")))
        result = partner_register(partner_payload(), db)
        assert db.query(PartnerRequest).filter_by(id=result["request_id"]).one()
    finally:
        db.close()


def test_partner_repeated_welcome_invocation_is_deduplicated():
    db = make_session()
    try:
        add_sponsor(db)
        result = partner_register(partner_payload(), db)
        request = db.query(PartnerRequest).filter_by(id=result["request_id"]).one()
        _queue_partner_registration_welcome(db, request)
        assert db.query(WhatsAppMessageOutbox).count() == 1
    finally:
        db.close()


def test_rider_registration_persists_sponsor_and_queues_one_welcome(monkeypatch):
    db = make_session()
    try:
        sponsor = add_sponsor(db)
        monkeypatch.setattr("sql_app.routers.rider.hash_password", lambda value: "hashed")
        result = rider_register(rider_payload(), db)
        rider = db.query(User).filter_by(id=result["rider"]["id"]).one()
        outbox = db.query(WhatsAppMessageOutbox).one()
        assert _profile(db, rider.id)["sponsor_user_id"] == sponsor.id
        assert _profile(db, rider.id)["sponsor_code"] == sponsor.id
        assert outbox.dedupe_key == f"rider-registration-welcome:{rider.id}"
        assert outbox.recipient == "9444444444"
        assert "Rider One" in outbox.message
    finally:
        db.close()


def test_rider_failed_registration_queues_no_welcome():
    db = make_session()
    try:
        add_sponsor(db)
        with pytest.raises(Exception, match="Sponsor code not found"):
            rider_register(rider_payload(sponsor_code="MAU99999"), db)
        assert db.query(User).filter_by(role="rider").count() == 0
        assert db.query(WhatsAppMessageOutbox).count() == 0
    finally:
        db.close()


def test_rider_registration_rejects_self_referral():
    db = make_session()
    try:
        sponsor = add_sponsor(db)
        with pytest.raises(Exception, match="cannot sponsor itself"):
            rider_register(rider_payload(phone=sponsor.phone), db)
        assert db.query(User).filter_by(role="rider").count() == 0
    finally:
        db.close()


def test_rider_queue_failure_keeps_registration_successful(monkeypatch):
    db = make_session()
    try:
        add_sponsor(db)
        monkeypatch.setattr("sql_app.routers.rider.hash_password", lambda value: "hashed")
        monkeypatch.setattr("sql_app.whatsapp_ai.enqueue_whatsapp_message", lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("queue unavailable")))
        result = rider_register(rider_payload(), db)
        assert db.query(User).filter_by(id=result["rider"]["id"]).one()
    finally:
        db.close()


def test_rider_repeated_welcome_invocation_is_deduplicated(monkeypatch):
    db = make_session()
    try:
        add_sponsor(db)
        monkeypatch.setattr("sql_app.routers.rider.hash_password", lambda value: "hashed")
        result = rider_register(rider_payload(), db)
        rider = db.query(User).filter_by(id=result["rider"]["id"]).one()
        _queue_rider_registration_welcome(db, rider, "9444444444")
        assert db.query(WhatsAppMessageOutbox).count() == 1
    finally:
        db.close()