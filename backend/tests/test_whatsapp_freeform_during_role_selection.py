import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import CRMLeadActivity, WhatsAppRegistrationSession
from sql_app.routers.whatsapp import update_whatsapp_settings
from sql_app.whatsapp_cloud import _configured_executive_fallback, _detect_language, _has_registration_intent, _is_executive_enquiry, _is_informational_question, ingest_whatsapp_message


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def admin(role="admin"):
    return SimpleNamespace(role=role, id="ADMIN")


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


def test_info_question_during_role_selection_skips_role_fallback_and_keeps_state(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append(text) or {"messages": [{"id": "wamid.reply"}]})
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())

        assert ingest_whatsapp_message(db, message_payload("wamid.greet", "Hi"), None) == "created"
        session = db.query(WhatsAppRegistrationSession).one()
        assert session.state == "INTRODUCTION"

        sent.clear()
        assert ingest_whatsapp_message(db, message_payload("wamid.info-q", "Hello! Can I get more info on this?"), None) == "updated"
        assert session.state == "INTRODUCTION"
        assert sent
        assert "role বুঝতে পারিনি" not in sent[-1]
        assert "1. Member" not in sent[-1]

        sent.clear()
        assert ingest_whatsapp_message(db, message_payload("wamid.pick-role", "member"), None) == "updated"
        assert session.state == "ROLE_SELECTION"
        assert session.role == "member"
    finally:
        db.close()


def test_info_question_during_role_selection_sends_direct_ai_reply_with_auto_send_disabled(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append(text) or {"messages": [{"id": "wamid.reply"}]})
        monkeypatch.setattr("sql_app.whatsapp_ai._generate_reply", lambda *_args, **_kwargs: ("Direct AI answer", "gemini", "gemini-1.5-flash"))
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())

        ingest_whatsapp_message(db, message_payload("wamid.greet-ai", "Hi"), None)
        session = db.query(WhatsAppRegistrationSession).one()
        sent.clear()

        assert ingest_whatsapp_message(db, message_payload("wamid.info-ai", "Hello! Can I get more info on this?"), None) == "updated"
        assert session.state == "INTRODUCTION"
        assert sent == ["Direct AI answer"]
    finally:
        db.close()


def test_new_customer_info_question_starts_welcome_before_ai_flow(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append(text) or {"messages": [{"id": "wamid.reply"}]})
        monkeypatch.setattr("sql_app.whatsapp_ai._generate_reply", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("AI should not answer before welcome")))
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())

        assert ingest_whatsapp_message(db, message_payload("wamid.new-info-ai", "Hello! Can I get more info on this?"), None) == "created"
        session = db.query(WhatsAppRegistrationSession).one()
        assert session.state == "INTRODUCTION"
        assert sent
        assert "METHO AAY-UPAY" in sent[-1]
        assert "1 লিখুন Member" in sent[-1]
        assert "2 লিখুন Partner" in sent[-1]
        assert "3 লিখুন Rider" in sent[-1]
    finally:
        db.close()


def test_new_customer_welcome_rejects_incomplete_registration_hallucination(monkeypatch):
    db = make_session()
    try:
        sent = []
        generated_contexts = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append(text) or {"messages": [{"id": "wamid.reply"}]})

        def generate_bad_welcome(_config, _message, context, *_args, **_kwargs):
            generated_contexts.append(context)
            return "You started your METHO Registration but haven't completed it yet.", "gemini", "gemini-1.5-flash"

        monkeypatch.setattr("sql_app.whatsapp_ai._generate_reply", generate_bad_welcome)
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())

        assert ingest_whatsapp_message(db, message_payload("wamid.bad-welcome", "Hello! Can I get more info on this?"), None) == "created"
        assert generated_contexts == ["First-contact welcome. No prior registration state applies."]
        assert sent
        assert "METHO AAY-UPAY-এ আপনাকে স্বাগতম" in sent[-1]
        assert "haven't completed" not in sent[-1]
        assert "শুরু করেছিলাম" not in sent[-1]
    finally:
        db.close()


@pytest.mark.parametrize("message", ["Metho ki", "Ki ki product ache", "Smart cycle ki?", "5 slot asole ki"])
def test_short_roman_bangla_questions_use_ai_without_repeating_welcome(monkeypatch, message):
    db = make_session()
    try:
        sent = []
        ai_calls = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append(text) or {"messages": [{"id": "wamid.reply"}]})

        def generate_reply(_config, incoming, _context="", event_type="", **_kwargs):
            ai_calls.append((incoming, event_type))
            if event_type == "whatsapp_welcome":
                return "Welcome to METHO. 1. Member 2. Partner 3. Rider", "gemini", "test"
            return f"KB answer for: {incoming}", "gemini", "test"

        monkeypatch.setattr("sql_app.whatsapp_ai._generate_reply", generate_reply)
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())
        ingest_whatsapp_message(db, message_payload(f"wamid.short-welcome-{message}", "Hi"), None)
        session = db.query(WhatsAppRegistrationSession).one()
        sent.clear()
        ai_calls.clear()

        assert _is_informational_question(message) is True
        assert ingest_whatsapp_message(db, message_payload(f"wamid.short-question-{message}", message), None) == "updated"
        assert ai_calls == [(message, "whatsapp_info_question")]
        assert sent == [f"KB answer for: {message}"]
        assert session.state == "INTRODUCTION"
        assert session.role == ""
    finally:
        db.close()


def test_info_question_retries_when_ai_repeats_welcome(monkeypatch):
    db = make_session()
    try:
        sent = []
        event_types = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append(text) or {"messages": [{"id": "wamid.reply"}]})

        def generate_reply(_config, incoming, _context="", event_type="", **_kwargs):
            if event_type == "whatsapp_welcome":
                return "Welcome to METHO. 1. Member 2. Partner 3. Rider", "gemini", "test"
            event_types.append(event_type)
            if event_type == "whatsapp_info_question":
                return "Welcome to METHO. 1. Member 2. Partner 3. Rider", "gemini", "test"
            return "Smart Cycle has 5 slots.", "gemini", "test"

        monkeypatch.setattr("sql_app.whatsapp_ai._generate_reply", generate_reply)
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())
        ingest_whatsapp_message(db, message_payload("wamid.retry-welcome", "Hi"), None)
        sent.clear()

        assert ingest_whatsapp_message(db, message_payload("wamid.retry-question", "Smart cycle ki?"), None) == "updated"
        assert event_types == ["whatsapp_info_question", "whatsapp_info_question_retry"]
        assert sent == ["Smart Cycle has 5 slots."]
    finally:
        db.close()


@pytest.mark.parametrize("ai_result", [("", "fallback", "local"), RuntimeError("Gemini unavailable")])
def test_info_question_sends_executive_text_when_direct_ai_reply_is_empty_or_fails(monkeypatch, ai_result):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append(text) or {"messages": [{"id": "wamid.reply"}]})
        if isinstance(ai_result, Exception):
            monkeypatch.setattr("sql_app.whatsapp_ai._generate_reply", lambda *_args, **_kwargs: (_ for _ in ()).throw(ai_result))
        else:
            monkeypatch.setattr("sql_app.whatsapp_ai._generate_reply", lambda *_args, **_kwargs: ai_result)
        monkeypatch.setattr("sql_app.whatsapp_cloud.get_configured_whatsapp_reply", lambda *_args, **_kwargs: "")
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())

        assert ingest_whatsapp_message(db, message_payload("wamid.info-ai-fallback-welcome", "Hi"), None) == "created"
        sent.clear()
        assert ingest_whatsapp_message(db, message_payload("wamid.info-ai-fallback", "Hello! Can I get more info on this?"), None) == "updated"
        assert sent == ["For accurate information on this matter, please contact our Executive directly: 9339566110"]
    finally:
        db.close()


def test_unrecognized_text_during_role_selection_still_uses_fallback_loop(monkeypatch):
    db = make_session()
    try:
        sent = []
        # _send_member_registration_reply is mocked directly (not send_whatsapp_message) so this
        # test isolates the _continue_introduction loop-breaking logic from unrelated preset-text
        # config resolution (update_whatsapp_settings with a partial payload blanks other presets).
        monkeypatch.setattr("sql_app.whatsapp_cloud._send_member_registration_reply", lambda _db, recipient, text: sent.append(text) or True)
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())

        assert ingest_whatsapp_message(db, message_payload("wamid.greet2", "Hi"), None) == "created"
        session = db.query(WhatsAppRegistrationSession).one()

        for idx in range(3):
            ingest_whatsapp_message(db, message_payload(f"wamid.gibberish-{idx}", "asdkjaslkdj"), None)

        handoff = db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type == "whatsapp_human_handoff_requested").count()
        assert handoff == 1
    finally:
        db.close()


@pytest.mark.parametrize(
    ("message", "expected_language", "ai_reply"),
    [
        ("Smart Cycle e koyta slot ache?", "bn", "স্মার্ট সাইকেলে ৫টি স্লট আছে।"),
        ("5 slot theke ki vabe income hoy bolo", "bn", "৫ নম্বর স্লটে সাইকেল কমিশন হিসাব হয়।"),
        ("commission kaise milta hai", "hi", "कमीशन योग्य नियमों के अनुसार मिलता है।"),
    ],
)
def test_roman_script_business_questions_route_to_ai(monkeypatch, message, expected_language, ai_reply):
    db = make_session()
    try:
        sent = []
        ai_messages = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append(text) or {"messages": [{"id": "wamid.reply"}]})

        def generate_reply(_config, incoming, *_args, **_kwargs):
            ai_messages.append(incoming)
            return ai_reply, "gemini", "gemini-1.5-flash"

        monkeypatch.setattr("sql_app.whatsapp_ai._generate_reply", generate_reply)
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())

        ingest_whatsapp_message(db, message_payload(f"wamid.roman-welcome-{expected_language}", "Hi"), None)
        session = db.query(WhatsAppRegistrationSession).one()
        sent.clear()
        ai_messages.clear()

        assert _is_informational_question(message) is True
        assert _has_registration_intent(message) is False
        assert _is_executive_enquiry(message) is False
        assert _detect_language(message) == expected_language
        assert ingest_whatsapp_message(db, message_payload(f"wamid.roman-question-{expected_language}", message), None) == "updated"
        assert ai_messages == [message]
        assert sent == [ai_reply]
        assert session.state == "INTRODUCTION"
    finally:
        db.close()


def test_roman_bangla_registration_intent_and_role_selection(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append(text) or {"messages": [{"id": "wamid.reply"}]})
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())
        ingest_whatsapp_message(db, message_payload("wamid.roman-role-welcome", "Hi"), None)

        message = "ami member hote chai"
        assert _has_registration_intent(message) is True
        assert _detect_language(message) == "bn"
        assert ingest_whatsapp_message(db, message_payload("wamid.roman-member", message), None) == "updated"
        session = db.query(WhatsAppRegistrationSession).one()
        assert session.role == "member"

        session.role = ""
        session.state = "INTRODUCTION"
        assert ingest_whatsapp_message(db, message_payload("wamid.numeric-partner", "2"), None) == "updated"
        assert session.role == "partner"
    finally:
        db.close()


def test_executive_fallback_uses_input_language_when_custom_preset_does_not_match():
    db = make_session()
    try:
        update_whatsapp_settings({"preset_business_enquiry_executive": "Executive contact: 9339566110"}, db, admin())
        assert _configured_executive_fallback(db, "en") == "Executive contact: 9339566110"
        assert _configured_executive_fallback(db, "bn") == "এই বিষয়ে সঠিক তথ্যের জন্য আমাদের Executive-এর সঙ্গে সরাসরি যোগাযোগ করুন: 9339566110"
        assert _configured_executive_fallback(db, "hi") == "इस विषय में सही जानकारी के लिए हमारे Executive से सीधे संपर्क करें: 9339566110"
    finally:
        db.close()
