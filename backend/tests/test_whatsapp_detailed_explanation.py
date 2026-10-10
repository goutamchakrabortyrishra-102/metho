import json
import re
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AppSetting, WhatsAppRegistrationSession
from sql_app.routers.whatsapp import update_whatsapp_settings
from sql_app.whatsapp_cloud import _detailed_explanation, _is_detail_request, ingest_whatsapp_message

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


def setup(monkeypatch, db, classification):
    sent = []
    monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append(text) or {"messages": [{"id": "wamid.reply"}]})

    def generate_reply(_config, _incoming, context="", event_type="", **_kwargs):
        if event_type == "whatsapp_role_classification":
            return classification, "gemini", "gemini-1.5-flash"
        return "", "gemini", "gemini-1.5-flash"

    monkeypatch.setattr("sql_app.whatsapp_ai._generate_reply", generate_reply)
    monkeypatch.setattr("sql_app.whatsapp_cloud._send_direct_ai_reply", lambda *_args, **_kwargs: pytest.fail("detail request must not use the free-form AI path"))
    update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token", "customer_call_number": "9339566110"}, db, SimpleNamespace(role="admin", id="ADMIN"))
    return sent


@pytest.mark.parametrize("message", [
    "Bujiye bolun", "details bolo", "kivabe hoy", "ki vabe hoy", "বুঝিয়ে বলুন", "বিস্তারিত বলুন", "কীভাবে হয়", "explain", "Please explain", "samjhao",
    "समझाइए", "tell me in detail",
])
def test_detail_requests_are_recognised(message):
    assert _is_detail_request(message)


@pytest.mark.parametrize("message", ["Ok", "Yes", "Member", "2", "hello", "I want to join", "আমি মেম্বার হতে চাই", "https://example.com"])
def test_non_detail_messages_are_not_detail_requests(message):
    assert not _is_detail_request(message)


@pytest.mark.parametrize("language,question", [("bn", BN_QUESTION), ("en", EN_QUESTION)])
def test_detailed_explanation_content(language, question):
    reply = _detailed_explanation(language)
    assert reply.count(question) == 1
    assert reply.endswith(question)
    assert reply.count("Member") >= 2 and reply.count("Partner") >= 2 and reply.count("Rider") >= 2
    assert ("২-৩ মিনিট" if language == "bn" else "2–3 minutes") in reply
    assert ("চ্যাটে" if language == "bn" else "in this chat") in reply
    lowered = reply.casefold()
    for prohibited in ("guarantee", "গ্যারান্টি", "নিশ্চিত আয়", "₹", "টাকা", "rs.", "rupee", "%", "binary", "বাইনারি", "mlm", "no investment", "কোনো বিনিয়োগ"):
        assert prohibited not in lowered
    assert not re.search(r"\d{3,}", reply)


def test_hindi_detailed_explanation_ends_with_role_question():
    reply = _detailed_explanation("hi")
    assert reply.endswith("आप Member, Partner या Rider के रूप में जुड़ना चाहेंगे? अपने शब्दों में बताइए।")
    assert "2–3 मिनट" in reply


@pytest.mark.parametrize("classification", ["unclear", "question"])
@pytest.mark.parametrize("message,question", [
    ("Bujiye bolun", BN_QUESTION),
    ("details bolo", BN_QUESTION),
    ("kivabe hoy", BN_QUESTION),
    ("বুঝিয়ে বলুন", BN_QUESTION),
    ("Please explain how this works", EN_QUESTION),
])
def test_detail_request_gets_full_explanation_not_short_summary(monkeypatch, classification, message, question):
    db = make_session()
    try:
        sent = setup(monkeypatch, db, classification)
        ingest_whatsapp_message(db, message_payload("wamid.hi", "Hello! Can I get more info on this?"), None)
        sent.clear()

        assert ingest_whatsapp_message(db, message_payload("wamid.detail", message), None) == "updated"
        assert len(sent) == 1
        reply = sent[0]
        assert reply.endswith(question)
        assert reply.count(question) == 1
        assert ("Member কী" in reply) or ("What a Member is" in reply)
        assert ("Partner কী" in reply) or ("What a Partner is" in reply)
        assert ("Rider কী" in reply) or ("What a Rider is" in reply)
        assert "Member: METHO পণ্য কিনে ID চালু। Partner:" not in reply
        assert db.query(WhatsAppRegistrationSession).one().state == "INTRODUCTION"
    finally:
        db.close()


def test_repeated_detail_requests_never_escalate_to_handoff(monkeypatch):
    db = make_session()
    try:
        sent = setup(monkeypatch, db, "unclear")
        ingest_whatsapp_message(db, message_payload("wamid.hi", "Hello! Can I get more info on this?"), None)
        for index in range(4):
            sent.clear()
            ingest_whatsapp_message(db, message_payload(f"wamid.detail-{index}", f"Bujiye bolun {'ektu' * index}"), None)
            assert sent and sent[0].endswith(BN_QUESTION)
        assert db.query(WhatsAppRegistrationSession).one().state == "INTRODUCTION"
        assert not db.query(AppSetting).filter(AppSetting.key.like("whatsapp_handoff_active:%")).count()
    finally:
        db.close()


def test_role_choice_still_starts_registration_even_with_detail_words(monkeypatch):
    db = make_session()
    try:
        sent = setup(monkeypatch, db, "partner")
        ingest_whatsapp_message(db, message_payload("wamid.hi", "Hello! Can I get more info on this?"), None)
        ingest_whatsapp_message(db, message_payload("wamid.pick", "Partner details bolo"), None)
        assert db.query(WhatsAppRegistrationSession).one().state == "NATIVE_REG_PARTNER"
    finally:
        db.close()


def test_complaint_with_detail_word_still_hands_off(monkeypatch):
    db = make_session()
    try:
        sent = setup(monkeypatch, db, "complaint")
        ingest_whatsapp_message(db, message_payload("wamid.hi", "Hello! Can I get more info on this?"), None)
        sent.clear()
        ingest_whatsapp_message(db, message_payload("wamid.complaint", "explain this fraud to me"), None)
        assert db.query(AppSetting).filter(AppSetting.key.like("whatsapp_handoff_active:%")).count() == 1
        assert all("Member কী" not in text and "What a Member is" not in text for text in sent)
    finally:
        db.close()


def test_short_ambiguous_reply_keeps_short_summary(monkeypatch):
    db = make_session()
    try:
        sent = setup(monkeypatch, db, "unclear")
        ingest_whatsapp_message(db, message_payload("wamid.hi", "Hello! Can I get more info on this?"), None)
        sent.clear()
        ingest_whatsapp_message(db, message_payload("wamid.maybe", "maybe"), None)
        assert sent and "Member কী" not in sent[0] and sent[0].startswith("Member: METHO পণ্য কিনে ID চালু।")
    finally:
        db.close()
