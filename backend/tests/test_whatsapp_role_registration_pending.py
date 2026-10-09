import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.crm_identity import link_lead_to_registration
from sql_app.models import CRMLead, PartnerRequest, User, WhatsAppRegistrationSession
from sql_app.routers.whatsapp import update_whatsapp_settings
from sql_app.whatsapp_cloud import (
    WHATSAPP_INTRODUCTION,
    WHATSAPP_ROLE_REGISTRATION_PENDING,
    WHATSAPP_ROLE_SELECTION,
    _continue_introduction,
    _explicit_role_switch_for_text,
    _registration_role_for_text,
    ingest_whatsapp_message,
    resolve_config,
)


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def admin():
    return SimpleNamespace(role="admin", id="ADMIN")


def _lead_and_session(db, sender="8801712345678"):
    lead = CRMLead(lead_id="WA-pending", business_name="WhatsApp", contact_person="WhatsApp Lead", phone=sender, whatsapp_no=sender, source="whatsapp")
    db.add(lead)
    db.flush()
    session = WhatsAppRegistrationSession(phone=sender, wa_id=sender, lead_id=lead.id, role="", state=WHATSAPP_INTRODUCTION)
    db.add(session)
    db.commit()
    return lead, session


def message_payload(message_id, body, sender="8801712345678"):
    return {
        "object": "whatsapp_business_account",
        "entry": [{"id": "business-account-1", "changes": [{"value": {
            "messaging_product": "whatsapp",
            "metadata": {"display_phone_number": "+1234567890", "phone_number_id": "123456"},
            "contacts": [{"profile": {"name": "Test Customer"}, "wa_id": sender}],
            "messages": [{"from": sender, "id": message_id, "timestamp": "1712345678", "type": "text", "text": {"body": body}}],
        }}]}],
    }


def test_slash_separated_digits_do_not_resolve_to_a_role(monkeypatch):
    db = make_session()
    try:
        config = resolve_config(db)
        assert _registration_role_for_text(config, "1/2/3") is None
        # Whole-message exact match still works for the legitimate single-digit selection.
        assert _registration_role_for_text(config, "1") == "member"
        assert _registration_role_for_text(config, "2") == "partner"
        assert _registration_role_for_text(config, "3") == "rider"
    finally:
        db.close()


def test_explicit_role_switch_matcher_ignores_broad_marketing_keywords():
    # Non-identity marketing keywords (কেনাকাটা/ইনকাম/দোকান/ব্যবসা/ডেলিভারি/গাড়ি) must never
    # trigger a role switch on their own, even though the wider role-selection matcher allows them.
    assert _explicit_role_switch_for_text("আমার গাড়ি নষ্ট হয়ে গেছে") is None
    assert _explicit_role_switch_for_text("আমার একটা ব্যবসা আছে") is None
    assert _explicit_role_switch_for_text("আমি আমার ব্যবসা বাড়াতে চাই কিভাবে হবে বলুন") is None
    assert _explicit_role_switch_for_text("aj ki কেনাকাটা করব") is None
    # Explicit identity keywords/digits still work.
    assert _explicit_role_switch_for_text("1") == "member"
    assert _explicit_role_switch_for_text("2") == "partner"
    assert _explicit_role_switch_for_text("3") == "rider"
    assert _explicit_role_switch_for_text("3rider") == "rider"
    assert _explicit_role_switch_for_text("1/2/3") is None


def test_role_selection_advances_past_role_selection_state(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud._send_member_registration_reply", lambda db, recipient, text: sent.append(text) or True)
        lead, session = _lead_and_session(db)
        assert _continue_introduction(db, session, lead, "2", lead.phone) is True
        assert session.role == "partner"
        # Must not remain stuck in ROLE_SELECTION (the bug that let subsequent text re-trigger role parsing).
        assert session.state == "NATIVE_REG_PARTNER"
        assert session.state != WHATSAPP_ROLE_SELECTION
        assert "আপনার তথ্য শুধু রেজিস্ট্রেশনের জন্য ব্যবহার হবে।" in sent[-1]
        assert "ব্যবসা কোন ধরনের" in sent[-1]
    finally:
        db.close()


def test_new_customer_digits_still_select_registration_role(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud._send_member_registration_reply", lambda _db, recipient, text: sent.append(text) or True)
        lead, session = _lead_and_session(db)

        for digit, role in (("1", "member"), ("2", "partner"), ("3", "rider")):
            session.role = ""
            session.state = WHATSAPP_INTRODUCTION
            assert ingest_whatsapp_message(db, message_payload(f"wamid.new-role-{digit}", digit), None) == "updated"
            assert session.role == role
            assert session.state == f"NATIVE_REG_{role.upper()}"
            assert "আপনার তথ্য শুধু রেজিস্ট্রেশনের জন্য ব্যবহার হবে" in sent[-1]
    finally:
        db.close()


def test_ambiguous_legacy_pending_role_reenters_chat_question_without_link(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append((recipient, text)) or {"messages": [{"id": "wamid.reply"}]})
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())

        assert ingest_whatsapp_message(db, message_payload("wamid.start", "আমি পার্টনার হতে চাই"), None) == "created"
        assert ingest_whatsapp_message(db, message_payload("wamid.choice", "2"), None) == "updated"
        session = db.query(WhatsAppRegistrationSession).one()
        assert session.state == "NATIVE_REG_PARTNER"
        assert session.role == "partner"
        session.state = WHATSAPP_ROLE_REGISTRATION_PENDING
        session.data_json = '{"language":"bn","fallback_count":0}'
        db.commit()

        sent.clear()
        assert ingest_whatsapp_message(db, message_payload("wamid.ambiguous", "1/2/3"), None) == "updated"
        assert session.role == "partner"
        assert session.state == WHATSAPP_INTRODUCTION
        assert len(sent) == 1
        assert "Member:" in sent[0][1] and "Partner:" in sent[0][1] and "Rider:" in sent[0][1]
        assert "registration_role=" not in sent[0][1] and "http" not in sent[0][1]
    finally:
        db.close()


def test_explicit_digit_switches_pending_role_and_sends_new_registration_link(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append((recipient, text)) or {"messages": [{"id": "wamid.reply"}]})
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())

        assert ingest_whatsapp_message(db, message_payload("wamid.start-rider", "Hi"), None) == "created"
        assert ingest_whatsapp_message(db, message_payload("wamid.pick-rider", "3"), None) == "updated"
        session = db.query(WhatsAppRegistrationSession).one()
        assert session.state == "NATIVE_REG_RIDER"
        assert session.role == "rider"
        session.state = WHATSAPP_ROLE_REGISTRATION_PENDING
        session.data_json = '{"language":"en","fallback_count":0}'
        db.commit()

        sent.clear()
        assert ingest_whatsapp_message(db, message_payload("wamid.switch-member", "1"), None) == "updated"
        assert session.state == "NATIVE_REG_MEMBER"
        assert session.role == "member"
        assert len(sent) == 1
        assert "Your information will only be used for registration" in sent[0][1]
        assert "registration_role=" not in sent[0][1] and "http" not in sent[0][1]
    finally:
        db.close()


def test_existing_member_can_request_partner_registration_link(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append((recipient, text)) or {"messages": [{"id": "wamid.reply"}]})
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())
        lead, session = _lead_and_session(db)
        member = User(id=str(uuid.uuid4()), name="Existing Member", email=f"{uuid.uuid4()}@example.com", phone=lead.phone, password="x", role="member", is_active=False)
        db.add(member)
        lead.member_user_id = member.id
        session.role = "member"
        session.state = "MEMBER_ACTIVATION_PENDING"
        db.commit()

        assert ingest_whatsapp_message(db, message_payload("wamid.member-to-partner", "2"), None) == "updated"
        assert session.state == "NATIVE_REG_PARTNER"
        assert session.role == "partner"
        assert len(sent) == 1
        assert "আপনার তথ্য শুধু রেজিস্ট্রেশনের জন্য ব্যবহার হবে" in sent[0][1]
        assert lead.member_user_id == member.id
    finally:
        db.close()


def test_linking_second_registration_preserves_first_identity():
    db = make_session()
    try:
        lead, _session = _lead_and_session(db)
        member = User(id=str(uuid.uuid4()), name="Existing Member", email=f"{uuid.uuid4()}@example.com", phone=lead.phone, password="x", role="member")
        request = PartnerRequest(id=str(uuid.uuid4()), business_name="Second Role Business", phone=lead.phone, status="pending")
        db.add_all([member, request])
        lead.member_user_id = member.id
        db.flush()

        link_lead_to_registration(db, phone=lead.phone, partner_request_id=request.id, lead=lead)

        assert lead.member_user_id == member.id
        assert lead.partner_request_id == request.id
    finally:
        db.close()


def test_direct_digit_role_selection_unchanged(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append((recipient, text)) or {"messages": [{"id": "wamid.reply"}]})
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())

        assert ingest_whatsapp_message(db, message_payload("wamid.greet", "Hi"), None) == "created"
        session = db.query(WhatsAppRegistrationSession).one()
        assert session.state == WHATSAPP_INTRODUCTION

        assert ingest_whatsapp_message(db, message_payload("wamid.pick", "2"), None) == "updated"
        assert session.role == "partner"
        assert session.state == "NATIVE_REG_PARTNER"
        assert "Your information will only be used for registration" in sent[-1][1]
        assert "registration_role=partner" not in sent[-1][1]
    finally:
        db.close()


def test_custom_registration_url_is_not_sent_from_the_chat_flow(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append((recipient, text)) or {"messages": [{"id": "wamid.reply"}]})
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token", "partner_registration_url": "https://example.com/partner-join"}, db, admin())

        assert ingest_whatsapp_message(db, message_payload("wamid.start", "আমি পার্টনার হতে চাই"), None) == "created"
        assert ingest_whatsapp_message(db, message_payload("wamid.choice", "2"), None) == "updated"
        session = db.query(WhatsAppRegistrationSession).one()
        assert session.state == "NATIVE_REG_PARTNER"
        assert "https://example.com/partner-join" not in sent[-1][1]

        sent.clear()
        assert ingest_whatsapp_message(db, message_payload("wamid.web", "WEB"), None) == "updated"
        assert "https://example.com/partner-join" not in sent[-1][1]
        assert session.state == "NATIVE_REG_PARTNER"
    finally:
        db.close()


def test_casual_vehicle_mention_does_not_switch_pending_role_to_rider(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append((recipient, text)) or {"messages": [{"id": "wamid.reply"}]})
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())

        assert ingest_whatsapp_message(db, message_payload("wamid.start-member", "Hi"), None) == "created"
        assert ingest_whatsapp_message(db, message_payload("wamid.pick-member", "1"), None) == "updated"
        session = db.query(WhatsAppRegistrationSession).one()
        assert session.role == "member"

        sent.clear()
        # "গাড়ি" (car/vehicle) is a rider marketing keyword, but this message has no registration intent.
        assert ingest_whatsapp_message(db, message_payload("wamid.car-broke-down", "আমার গাড়ি নষ্ট হয়ে গেছে"), None) == "updated"
        assert session.role == "member"
        assert session.state == "NATIVE_REG_MEMBER"
        assert len(sent) == 1
        assert "registration_role=" not in sent[0][1] and "http" not in sent[0][1]
    finally:
        db.close()


def test_casual_business_mention_does_not_switch_pending_role_to_partner(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append((recipient, text)) or {"messages": [{"id": "wamid.reply"}]})
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())

        assert ingest_whatsapp_message(db, message_payload("wamid.start-member2", "Hi"), None) == "created"
        assert ingest_whatsapp_message(db, message_payload("wamid.pick-member2", "1"), None) == "updated"
        session = db.query(WhatsAppRegistrationSession).one()
        assert session.role == "member"

        sent.clear()
        # "ব্যবসা" (business) is a partner marketing keyword, but this is a plain statement, not a role request.
        assert ingest_whatsapp_message(db, message_payload("wamid.have-a-business", "আমার একটা ব্যবসা আছে"), None) == "updated"
        assert session.role == "member"
        assert session.state == "NATIVE_REG_MEMBER"
        assert len(sent) == 1
        assert "registration_role=" not in sent[0][1] and "http" not in sent[0][1]
    finally:
        db.close()


def test_business_question_after_member_start_does_not_change_role(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append((recipient, text)) or {"messages": [{"id": "wamid.reply"}]})

        def fake_generate_reply(_config, _message, context="", event_type="", db=None):
            if event_type == "whatsapp_role_classification":
                return "member", "gemini", "gemini-1.5-flash"
            return "AI ground-truth answer", "gemini", "gemini-1.5-flash"

        monkeypatch.setattr("sql_app.whatsapp_ai._generate_reply", fake_generate_reply)
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())

        assert ingest_whatsapp_message(db, message_payload("wamid.start-member3", "Hi"), None) == "created"
        assert ingest_whatsapp_message(db, message_payload("wamid.pick-member3", "1"), None) == "updated"
        session = db.query(WhatsAppRegistrationSession).one()
        assert session.role == "member"

        sent.clear()
        # Once Member registration begins, a business question is validated as a form answer, not a role switch.
        question = "আমি আমার ব্যবসা বাড়াতে চাই কিভাবে হবে বলুন"
        assert ingest_whatsapp_message(db, message_payload("wamid.business-question", question), None) == "updated"
        assert session.role == "member"
        assert session.state == "NATIVE_REG_MEMBER"
        assert len(sent) == 1 and "জন্ম তারিখ" in sent[0][1]
    finally:
        db.close()


def test_english_product_query_after_role_selection_gets_ai_reply_not_reminder(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append((recipient, text)) or {"messages": [{"id": "wamid.reply"}]})

        def fake_generate_reply(_config, _message, context="", event_type="", db=None):
            if event_type == "whatsapp_role_classification":
                return "partner", "gemini", "gemini-1.5-flash"
            return "Here are the product details", "gemini", "gemini-1.5-flash"

        monkeypatch.setattr("sql_app.whatsapp_ai._generate_reply", fake_generate_reply)
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())

        assert ingest_whatsapp_message(db, message_payload("wamid.start-product", "Hi"), None) == "created"
        assert ingest_whatsapp_message(db, message_payload("wamid.pick-product", "2"), None) == "updated"
        session = db.query(WhatsAppRegistrationSession).one()
        assert session.role == "partner"

        sent.clear()
        # During the Partner form, a non-choice is re-prompted instead of switching roles or sending a form link.
        assert ingest_whatsapp_message(db, message_payload("wamid.product-details", "product details"), None) == "updated"
        assert len(sent) == 1
        assert "Shop" in sent[0][1] and "Service" in sent[0][1]
        assert "registration_role=" not in sent[0][1] and "http" not in sent[0][1]
    finally:
        db.close()


def test_role_reminder_build_failure_still_sends_a_plain_fallback_reply(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append((recipient, text)) or {"messages": [{"id": "wamid.reply"}]})
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())
        lead, session = _lead_and_session(db)
        session.role = "member"
        session.state = WHATSAPP_ROLE_REGISTRATION_PENDING
        db.commit()

        monkeypatch.setattr("sql_app.whatsapp_cloud._tracked_registration_url", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("boom")))

        # A non-question, non-role-switch follow-up that hits the deterministic reminder branch; if
        # link-building throws, the customer must still get a plain-text reply, never silence.
        assert ingest_whatsapp_message(db, message_payload("wamid.ambiguous-boom", "ok thanks"), None) == "updated"
        assert len(sent) == 1
        assert sent[0][1].strip()
    finally:
        db.close()

