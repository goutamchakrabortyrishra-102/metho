import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import WhatsAppRegistrationSession
from sql_app.routers.whatsapp import update_whatsapp_settings
from sql_app.whatsapp_cloud import _conversation_language_signal, ingest_whatsapp_message

META_DEFAULT = "Hello! Can I get more info on this?"
BN_QUESTION = "আপনি Member, Partner নাকি Rider হিসেবে যুক্ত হতে চান? নিজের কথায় লিখে জানান।"
EN_QUESTION = "Would you like to join as a Member, Partner, or Rider? Please tell me in your own words."


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def message_payload(message_id, body, sender="8801712345678"):
    return {
        "object": "whatsapp_business_account",
        "entry": [{"id": "business-account-1", "changes": [{"value": {
            "messaging_product": "whatsapp",
            "metadata": {"display_phone_number": "+1234567890", "phone_number_id": "123456"},
            "contacts": [{"profile": {"name": "Ayesha Rahman"}, "wa_id": sender}],
            "messages": [{"from": sender, "id": message_id, "timestamp": "1712345678", "type": "text", "text": {"body": body}}],
        }}]}],
    }


def setup(monkeypatch, db, **settings):
    sent = []
    monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append(text) or {"messages": [{"id": "wamid.reply"}]})

    def generate_reply(_config, _incoming, context="", event_type="", **_kwargs):
        if event_type == "whatsapp_role_classification":
            return "unclear", "gemini", "gemini-1.5-flash"
        return "", "gemini", "gemini-1.5-flash"

    monkeypatch.setattr("sql_app.whatsapp_ai._generate_reply", generate_reply)
    update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token", **settings}, db, SimpleNamespace(role="admin", id="ADMIN"))
    return sent


@pytest.mark.parametrize("message", [
    META_DEFAULT, "hi! can i get more info on this?", "Can I get more info on this", "Ok", "Yes", "ok thanks", "Hello", "Link",
    "https://example.com/post/1", "https://example.com/post/1 ok", "👍", "1", "হ্যাঁ", "",
])
def test_ambiguous_or_meta_default_messages_give_no_language_signal(message):
    assert _conversation_language_signal(message) is None


@pytest.mark.parametrize("message,expected", [
    ("Bujiye bolun", "bn"),
    ("details bolo", "bn"),
    ("kivabe hoy", "bn"),
    ("আমি জানতে চাই", "bn"),
    ("বুঝিয়ে বলুন", "bn"),
    ("Please tell me about the rewards", "en"),
    ("I want to join as a rider", "en"),
    ("mujhe batao kaise milta hai", "hi"),
    ("मुझे जानकारी चाहिए", "hi"),
])
def test_meaningful_messages_give_language_signal(message, expected):
    assert _conversation_language_signal(message) == expected


def test_meta_default_first_message_gets_bangla_welcome_then_follows_latest_meaningful_language(monkeypatch):
    db = make_session()
    try:
        sent = setup(monkeypatch, db)

        assert ingest_whatsapp_message(db, message_payload("wamid.1", META_DEFAULT), None) == "created"
        assert "নমস্কার! METHO AAY-UPAY-এ স্বাগতম।" in sent[-1]
        assert BN_QUESTION in sent[-1]
        assert "Welcome to METHO" not in sent[-1]
        session = db.query(WhatsAppRegistrationSession).one()
        assert json.loads(session.data_json)["language"] == "bn"

        sent.clear()
        ingest_whatsapp_message(db, message_payload("wamid.2", "Bujiye bolun"), None)
        assert BN_QUESTION in sent[-1]
        assert EN_QUESTION not in sent[-1]

        sent.clear()
        ingest_whatsapp_message(db, message_payload("wamid.3", "I want to know about the rewards"), None)
        assert EN_QUESTION in sent[-1]
        assert BN_QUESTION not in sent[-1]
        assert json.loads(db.query(WhatsAppRegistrationSession).one().data_json)["language"] == "en"
    finally:
        db.close()


def test_short_or_ambiguous_message_keeps_session_language(monkeypatch):
    db = make_session()
    try:
        sent = setup(monkeypatch, db)
        ingest_whatsapp_message(db, message_payload("wamid.1", "I want to know about the rewards"), None)
        assert EN_QUESTION in sent[-1]

        for index, text in enumerate(("Ok", "Yes", "https://example.com/post/1")):
            sent.clear()
            ingest_whatsapp_message(db, message_payload(f"wamid.amb-{index}", text), None)
            assert sent, text
            assert BN_QUESTION not in sent[-1], text
            assert json.loads(db.query(WhatsAppRegistrationSession).one().data_json)["language"] == "en", text
    finally:
        db.close()


def test_first_welcome_language_follows_configurable_default(monkeypatch):
    db = make_session()
    try:
        sent = setup(monkeypatch, db, default_language="en")
        ingest_whatsapp_message(db, message_payload("wamid.1", META_DEFAULT), None)
        assert "Welcome to METHO AAY-UPAY" in sent[-1]
        assert EN_QUESTION in sent[-1]
    finally:
        db.close()


def test_invalid_default_language_falls_back_to_bangla(monkeypatch):
    db = make_session()
    try:
        sent = setup(monkeypatch, db, default_language="fr")
        ingest_whatsapp_message(db, message_payload("wamid.1", META_DEFAULT), None)
        assert BN_QUESTION in sent[-1]
    finally:
        db.close()
