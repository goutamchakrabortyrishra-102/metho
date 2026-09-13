import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import User, WhatsAppMessageOutbox
from sql_app.routers.auth import _send_registration_whatsapp_welcome, register
from sql_app.schemas import RegisterRequest
from sql_app.whatsapp_ai import process_message_outbox


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def add_admin(db):
    db.add(User(id="MAU00001", name="METHO Admin", email="admin@test.local", phone="9000000000", password="hashed", role="super_admin", is_active=True))
    db.commit()


def registration_payload(member_id="MAU12345"):
    return RegisterRequest(name="New Member", email=member_id, phone="9999999999", pan_no="ABCDE1234F", password="secret1")


def stub_non_whatsapp_welcome(monkeypatch):
    monkeypatch.setattr("sql_app.routers.auth.hash_password", lambda value: "hashed")
    monkeypatch.setattr("sql_app.routers.auth.build_welcome_pdf", lambda user: "")
    monkeypatch.setattr("sql_app.routers.auth.send_welcome_email", lambda *args: False)


def test_successful_registration_queues_one_existing_whatsapp_welcome(monkeypatch):
    db = make_session()
    try:
        add_admin(db)
        stub_non_whatsapp_welcome(monkeypatch)

        result = register(registration_payload(), db)

        assert db.query(User).filter_by(id="MAU12345").one()
        outbox = db.query(WhatsAppMessageOutbox).one()
        assert outbox.dedupe_key == "member-registration-welcome:MAU12345"
        assert outbox.recipient == "9999999999"
        assert "New Member" in outbox.message
        assert "MAU12345" in outbox.message
        assert "METHO AAY-UPAY" in outbox.message
        assert result["user"]["id"] == "MAU12345"
    finally:
        db.close()


def test_failed_registration_does_not_queue_whatsapp_welcome(monkeypatch):
    db = make_session()
    try:
        add_admin(db)
        stub_non_whatsapp_welcome(monkeypatch)

        payload = registration_payload().model_copy(update={"sponsor_code": "MAU99999"})
        with pytest.raises(Exception, match="Sponsor code not found"):
            register(payload, db)

        assert db.query(WhatsAppMessageOutbox).count() == 0
    finally:
        db.close()


def test_whatsapp_delivery_failure_keeps_registration_and_schedules_retry(monkeypatch):
    db = make_session()
    try:
        add_admin(db)
        stub_non_whatsapp_welcome(monkeypatch)
        result = register(registration_payload(), db)
        db.close = lambda: None
        monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", lambda: db)
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("temporary failure")))

        assert process_message_outbox() == 0
        outbox = db.query(WhatsAppMessageOutbox).one()
        assert result["user"]["id"] == "MAU12345"
        assert db.query(User).filter_by(id="MAU12345").one()
        assert outbox.status == "retry"
        assert outbox.attempts == 1
    finally:
        db.close()


def test_registration_retry_does_not_queue_duplicate_welcome(monkeypatch):
    db = make_session()
    try:
        add_admin(db)
        stub_non_whatsapp_welcome(monkeypatch)
        register(registration_payload(), db)
        member = db.query(User).filter_by(id="MAU12345").one()

        _send_registration_whatsapp_welcome(db, member, member.id)

        with pytest.raises(Exception, match="Phone number already registered"):
            register(registration_payload("MAU12346"), db)

        assert db.query(WhatsAppMessageOutbox).count() == 1
    finally:
        db.close()