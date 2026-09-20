import json
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AppSetting, CRMLead, PartnerRequest, User, WhatsAppRegistrationSession
from sql_app.routers.whatsapp import update_whatsapp_settings
from sql_app.whatsapp_cloud import WHATSAPP_PRESET_MESSAGE_DEFAULTS, ingest_whatsapp_message


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


def _setup(db, phone="8801712345678"):
    update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())
    lead = CRMLead(phone=phone, whatsapp_no=phone, source="whatsapp")
    db.add(lead)
    db.flush()
    return lead


def _capture_ai(monkeypatch, sent, reply_text="AI ground-truth answer"):
    contexts = []
    monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append(text) or {"messages": [{"id": "wamid.reply"}]})

    def fake_generate_reply(_config, _message, context="", event_type="", db=None):
        contexts.append((event_type, context))
        return reply_text, "gemini", "gemini-1.5-flash"

    monkeypatch.setattr("sql_app.whatsapp_ai._generate_reply", fake_generate_reply)
    return contexts


def test_registration_confirmation_pending_informational_question_gets_ai_reply(monkeypatch):
    db = make_session()
    try:
        sent = []
        contexts = _capture_ai(monkeypatch, sent)
        lead = _setup(db)
        session = WhatsAppRegistrationSession(phone=lead.phone, wa_id=lead.phone, lead_id=lead.id, role="member", state="REGISTRATION_CONFIRMATION_PENDING")
        db.add(session)
        db.commit()

        result = ingest_whatsapp_message(db, message_payload("wamid.q1", "What is the status of my registration?"), None)
        assert result == "updated"
        assert sent == ["AI ground-truth answer"]
        assert contexts[0][0] == "whatsapp_status_question"
        assert session.state == "REGISTRATION_CONFIRMATION_PENDING"
    finally:
        db.close()


def test_registration_confirmation_pending_gibberish_still_resends_deterministic_prompt(monkeypatch):
    db = make_session()
    try:
        sent = []
        _capture_ai(monkeypatch, sent)
        lead = _setup(db)
        session = WhatsAppRegistrationSession(phone=lead.phone, wa_id=lead.phone, lead_id=lead.id, role="member", state="REGISTRATION_CONFIRMATION_PENDING")
        db.add(session)
        db.commit()

        ingest_whatsapp_message(db, message_payload("wamid.gib1", "asdkjhqweiuh"), None)
        assert "Submit" in sent[-1] or "Yes" in sent[-1]
    finally:
        db.close()


def test_partner_application_pending_informational_question_uses_status_context(monkeypatch):
    db = make_session()
    try:
        sent = []
        contexts = _capture_ai(monkeypatch, sent)
        lead = _setup(db)
        request = PartnerRequest(id=str(uuid.uuid4()), business_name="Green Grocery", status="pending")
        db.add(request)
        lead.partner_request_id = request.id
        session = WhatsAppRegistrationSession(phone=lead.phone, wa_id=lead.phone, lead_id=lead.id, role="partner", state="PARTNER_APPLICATION_PENDING", data_json=json.dumps({"request_id": request.id}))
        db.add(session)
        db.commit()

        ingest_whatsapp_message(db, message_payload("wamid.p1", "When will my partner application be approved?"), None)
        assert sent == ["AI ground-truth answer"]
        assert "Partner application status: pending" in contexts[0][1]
        assert "Green Grocery" in contexts[0][1]
    finally:
        db.close()


def test_partner_onboarding_freeform_question_gets_ai_reply_instead_of_incomplete_message(monkeypatch):
    db = make_session()
    try:
        sent = []
        contexts = _capture_ai(monkeypatch, sent)
        lead = _setup(db)
        request = PartnerRequest(id=str(uuid.uuid4()), business_name="Green Grocery", status="approved")
        db.add(request)
        lead.partner_request_id = request.id
        session = WhatsAppRegistrationSession(phone=lead.phone, wa_id=lead.phone, lead_id=lead.id, role="partner", state="PARTNER_ONBOARDING", data_json=json.dumps({"request_id": request.id}))
        db.add(session)
        db.commit()

        ingest_whatsapp_message(db, message_payload("wamid.p2", "How do I list my first product?"), None)
        assert sent == ["AI ground-truth answer"]
        assert "registration incomplete" not in sent[-1].lower()
        assert "Partner application status: approved" in contexts[0][1]
    finally:
        db.close()


def test_rider_application_pending_informational_question_uses_status_context(monkeypatch):
    db = make_session()
    try:
        sent = []
        contexts = _capture_ai(monkeypatch, sent)
        lead = _setup(db)
        rider = User(id=str(uuid.uuid4()), name="Rahim Rider", email=f"{uuid.uuid4()}@example.com", password="x", role="rider")
        db.add(rider)
        lead.rider_user_id = rider.id
        db.add(AppSetting(key=f"rider_profile:{rider.id}", value_json=json.dumps({"approval_status": "pending"})))
        session = WhatsAppRegistrationSession(phone=lead.phone, wa_id=lead.phone, lead_id=lead.id, role="rider", state="RIDER_APPLICATION_PENDING", data_json=json.dumps({"rider_user_id": rider.id}))
        db.add(session)
        db.commit()

        ingest_whatsapp_message(db, message_payload("wamid.r1", "Is my rider application approved yet?"), None)
        assert sent == ["AI ground-truth answer"]
        assert "Rider application status: pending" in contexts[0][1]
    finally:
        db.close()


def test_rider_onboarding_freeform_question_gets_ai_reply_instead_of_incomplete_message(monkeypatch):
    db = make_session()
    try:
        sent = []
        contexts = _capture_ai(monkeypatch, sent)
        lead = _setup(db)
        rider = User(id=str(uuid.uuid4()), name="Rahim Rider", email=f"{uuid.uuid4()}@example.com", password="x", role="rider")
        db.add(rider)
        lead.rider_user_id = rider.id
        db.add(AppSetting(key=f"rider_profile:{rider.id}", value_json=json.dumps({"approval_status": "approved"})))
        session = WhatsAppRegistrationSession(phone=lead.phone, wa_id=lead.phone, lead_id=lead.id, role="rider", state="RIDER_ONBOARDING", data_json=json.dumps({"rider_user_id": rider.id}))
        db.add(session)
        db.commit()

        ingest_whatsapp_message(db, message_payload("wamid.r2", "When does my first delivery shift start?"), None)
        assert sent == ["AI ground-truth answer"]
        assert "registration incomplete" not in sent[-1].lower()
        assert "Rider application status: approved" in contexts[0][1]
    finally:
        db.close()


def test_member_activation_pending_informational_question_uses_status_context(monkeypatch):
    db = make_session()
    try:
        sent = []
        contexts = _capture_ai(monkeypatch, sent)
        lead = _setup(db)
        member = User(id=str(uuid.uuid4()), name="Ayesha Member", email=f"{uuid.uuid4()}@example.com", password="x", role="member", is_active=False)
        db.add(member)
        lead.member_user_id = member.id
        session = WhatsAppRegistrationSession(phone=lead.phone, wa_id=lead.phone, lead_id=lead.id, role="member", state="MEMBER_ACTIVATION_PENDING", data_json=json.dumps({"member_user_id": member.id, "member_code": "M-100"}))
        db.add(session)
        db.commit()

        ingest_whatsapp_message(db, message_payload("wamid.m1", "How do I activate my member account?"), None)
        assert sent == ["AI ground-truth answer"]
        assert "Member account active: no" in contexts[0][1]
        assert member.id in contexts[0][1]
    finally:
        db.close()


def test_member_onboarding_informational_question_uses_status_context_not_generic_reply(monkeypatch):
    db = make_session()
    try:
        sent = []
        contexts = _capture_ai(monkeypatch, sent)
        lead = _setup(db)
        member = User(id=str(uuid.uuid4()), name="Ayesha Member", email=f"{uuid.uuid4()}@example.com", password="x", role="member", is_active=True)
        db.add(member)
        lead.member_user_id = member.id
        session = WhatsAppRegistrationSession(phone=lead.phone, wa_id=lead.phone, lead_id=lead.id, role="member", state="MEMBER_ONBOARDING", data_json=json.dumps({"member_user_id": member.id, "member_code": "M-200"}))
        db.add(session)
        db.commit()
        monkeypatch.setattr("sql_app.routers.compat._member_purchase_active", lambda _db, _user_id: True)

        ingest_whatsapp_message(db, message_payload("wamid.m2", "What rewards can I get from Smart Cycle?"), None)
        assert sent == ["AI ground-truth answer"]
        assert "Member account active: yes" in contexts[0][1]
        assert member.id in contexts[0][1]
    finally:
        db.close()


def test_member_onboarding_order_query_still_uses_deterministic_order_lookup(monkeypatch):
    db = make_session()
    try:
        sent = []
        _capture_ai(monkeypatch, sent)
        lead = _setup(db)
        member = User(id=str(uuid.uuid4()), name="Ayesha Member", email=f"{uuid.uuid4()}@example.com", password="x", role="member", is_active=True)
        db.add(member)
        lead.member_user_id = member.id
        session = WhatsAppRegistrationSession(phone=lead.phone, wa_id=lead.phone, lead_id=lead.id, role="member", state="MEMBER_ONBOARDING", data_json=json.dumps({"member_user_id": member.id, "member_code": "M-300"}))
        db.add(session)
        db.commit()
        monkeypatch.setattr("sql_app.routers.compat._member_purchase_active", lambda _db, _user_id: True)

        ingest_whatsapp_message(db, message_payload("wamid.m3", "order status"), None)
        assert sent == [WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_no_orders_found"]]
    finally:
        db.close()
