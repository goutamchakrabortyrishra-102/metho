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


def test_role_selection_advances_past_role_selection_state(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud._send_member_registration_reply", lambda db, recipient, text: sent.append(text) or True)
        lead, session = _lead_and_session(db)
        assert _continue_introduction(db, session, lead, "2", lead.phone) is True
        assert session.role == "partner"
        # Must not remain stuck in ROLE_SELECTION (the bug that let subsequent text re-trigger role parsing).
        assert session.state == WHATSAPP_ROLE_REGISTRATION_PENDING
        assert session.state != WHATSAPP_ROLE_SELECTION
    finally:
        db.close()


def test_ambiguous_followup_after_role_selected_sends_reminder_not_full_template(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append((recipient, text)) or {"messages": [{"id": "wamid.reply"}]})
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())

        assert ingest_whatsapp_message(db, message_payload("wamid.start", "আমি পার্টনার হতে চাই"), None) == "created"
        assert ingest_whatsapp_message(db, message_payload("wamid.choice", "2"), None) == "updated"
        session = db.query(WhatsAppRegistrationSession).one()
        assert session.state == WHATSAPP_ROLE_REGISTRATION_PENDING
        assert session.role == "partner"
        first_reply = sent[-1][1]
        assert "registration_role=partner" in first_reply

        sent.clear()
        assert ingest_whatsapp_message(db, message_payload("wamid.ambiguous", "1/2/3"), None) == "updated"
        # Role must not have been silently overwritten to member by the ambiguous follow-up.
        assert session.role == "partner"
        assert len(sent) == 1
        reminder_reply = sent[0][1]
        # The full role-registration template (long explanatory intro) must not be resent verbatim.
        assert reminder_reply != first_reply
        assert "registration_role=partner" in reminder_reply
        assert "Partner" in reminder_reply
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
        assert session.state == WHATSAPP_ROLE_REGISTRATION_PENDING
        assert session.role == "rider"
        assert "registration_role=rider" in sent[-1][1]

        sent.clear()
        assert ingest_whatsapp_message(db, message_payload("wamid.switch-member", "1"), None) == "updated"
        assert session.state == WHATSAPP_ROLE_REGISTRATION_PENDING
        assert session.role == "member"
        assert len(sent) == 1
        assert "registration_role=member" in sent[0][1]
        assert "registration_role=rider" not in sent[0][1]
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
        assert session.state == WHATSAPP_ROLE_REGISTRATION_PENDING
        assert session.role == "partner"
        assert len(sent) == 1
        assert "registration_role=partner" in sent[0][1]
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
        assert "registration_role=partner" in sent[-1][1]
    finally:
        db.close()


def test_registration_link_stays_deterministic_across_followups(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append((recipient, text)) or {"messages": [{"id": "wamid.reply"}]})
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token", "partner_registration_url": "https://example.com/partner-join"}, db, admin())

        assert ingest_whatsapp_message(db, message_payload("wamid.start", "আমি পার্টনার হতে চাই"), None) == "created"
        assert ingest_whatsapp_message(db, message_payload("wamid.choice", "2"), None) == "updated"
        first_reply = sent[-1][1]
        assert "https://example.com/partner-join" in first_reply
        assert "registration_role=partner" in first_reply
        assert "prefill_phone=" in first_reply

        sent.clear()
        assert ingest_whatsapp_message(db, message_payload("wamid.ambiguous", "1/2/3"), None) == "updated"
        second_reply = sent[-1][1]
        assert "https://example.com/partner-join" in second_reply
        assert "registration_role=partner" in second_reply
        assert "prefill_phone=" in second_reply
    finally:
        db.close()
