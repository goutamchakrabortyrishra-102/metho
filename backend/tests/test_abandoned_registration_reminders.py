import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AppSetting, CRMFollowUp, CRMLead, CRMLeadActivity, CRMTask, PartnerRequest, User, WhatsAppMessageOutbox, WhatsAppRegistrationSession
from sql_app.routers.crm import record_public_registration_event
from sql_app.routers.auth import register
from sql_app.routers.partner_public import partner_register
from sql_app.routers.rider import rider_register
from sql_app.schemas import RegisterRequest, RiderRegisterRequest
from sql_app.whatsapp_ai import process_due_followups, process_message_outbox
from sql_app.whatsapp_cloud import ingest_whatsapp_message, _continue_introduction, _request_whatsapp_human_handoff, _role_registration_reply, _role_registration_url, _send_introduction, _stop_abandoned_registration_reminders
from test_whatsapp_admin_settings import message_payload


class NoCloseSession:
    def __init__(self, db):
        self.db = db

    def __call__(self):
        return self.db


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def add_tracked_lead(db, role="member", phone="8801712345678"):
    if not db.query(User).filter_by(id="ADMIN").first():
        db.add(User(id="ADMIN", name="Admin", email="admin@example.com", phone="1", password="hash", role="admin", is_active=True))
    lead = CRMLead(
        lead_id=f"WA-{role}",
        business_name="WhatsApp Lead",
        contact_person="Test Customer",
        phone=phone,
        whatsapp_no=phone,
        source="whatsapp",
        status="NEW",
    )
    db.add(lead)
    db.flush()
    db.add(WhatsAppRegistrationSession(phone=lead.phone, wa_id=lead.phone, lead_id=lead.id, role=role, state="ROLE_SELECTION"))
    db.commit()
    return lead


def open_registration(db, lead):
    return record_public_registration_event({"crm_lead_id": lead.id, "phone": lead.phone, "event_type": "registration_form_opened"}, db)


def record_recent_whatsapp_inbound(db, lead, when=None):
    db.add(CRMLeadActivity(
        lead_id=lead.id,
        activity_type="whatsapp_message_received",
        message=f"WhatsApp message received [recent-{lead.id}]: hi",
        created_at=when or datetime.now(timezone.utc) - timedelta(hours=1),
    ))
    db.commit()


def due_reminder(db, lead):
    reminder = db.query(CRMFollowUp).filter_by(lead_id=lead.id, notes="Abandoned registration reminder", status="Pending").one()
    reminder.scheduled_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    return reminder


def due_general_followup(db, lead, notes="Initial WhatsApp lead follow-up"):
    followup = CRMFollowUp(lead_id=lead.id, scheduled_at=datetime.now(timezone.utc) - timedelta(seconds=1), status="Pending", notes=notes)
    db.add(followup)
    db.commit()
    return followup


def test_opened_registration_queues_one_reminder_and_outbox_records_delivery(monkeypatch):
    db = make_session()
    try:
        lead = add_tracked_lead(db)
        open_registration(db, lead)
        assert db.query(CRMFollowUp).filter_by(lead_id=lead.id, notes="Abandoned registration reminder", status="Pending").count() == 1
        due_reminder(db, lead)
        record_recent_whatsapp_inbound(db, lead)
        db.close = lambda: None
        monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", NoCloseSession(db))
        assert process_due_followups() == 1
        assert process_due_followups() == 0
        assert db.query(WhatsAppMessageOutbox).count() == 1
        outbox = db.query(WhatsAppMessageOutbox).one()
        assert outbox.status == "pending"
        assert "crm_lead_id=" in outbox.message
        assert "prefill_phone=" in outbox.message
        assert "registration এখনও সম্পূর্ণ হয়নি" in outbox.message
        assert "Executive" in outbox.message
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append((recipient, text)) or {"messages": [{"id": "wamid.reminder"}]})
        assert process_message_outbox() == 1
        assert len(sent) == 1
        assert db.query(CRMLeadActivity).filter_by(lead_id=lead.id, activity_type="registration_reminder_sent").count() == 1
    finally:
        db.close()


def test_abandoned_reminder_repeats_without_duplicates(monkeypatch):
    db = make_session()
    try:
        lead = add_tracked_lead(db, "partner")
        open_registration(db, lead)
        due_reminder(db, lead)
        record_recent_whatsapp_inbound(db, lead)
        db.close = lambda: None
        monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", NoCloseSession(db))
        assert process_due_followups() == 1
        reminder = db.query(CRMFollowUp).filter_by(lead_id=lead.id, notes="Abandoned registration reminder", status="Pending").one()
        reminder.scheduled_at = datetime.now(timezone.utc) - timedelta(days=1)
        db.commit()
        record_recent_whatsapp_inbound(db, lead)
        assert process_due_followups() == 1
        assert db.query(WhatsAppMessageOutbox).count() == 2
        assert db.query(CRMFollowUp).filter_by(lead_id=lead.id, notes="Abandoned registration reminder", status="Pending").count() == 1
        assert reminder.status == "Pending"
    finally:
        db.close()


def test_followup_inside_24_hour_window_queues_freeform_text(monkeypatch):
    db = make_session()
    try:
        lead = add_tracked_lead(db)
        due_general_followup(db, lead)
        record_recent_whatsapp_inbound(db, lead, datetime.now(timezone.utc) - timedelta(hours=1))
        db.close = lambda: None
        monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", NoCloseSession(db))

        assert process_due_followups() == 1
        outbox = db.query(WhatsAppMessageOutbox).one()
        assert outbox.activity_type == "whatsapp_message_sent"
        assert outbox.message.startswith("👋")
        assert "_whatsapp_template" not in outbox.message
        assert "METHO" in outbox.message
    finally:
        db.close()


def test_followup_outside_24_hour_window_queues_configured_template(monkeypatch):
    from sql_app.followup_scheduler import TEMPLATE_LANGUAGE_KEY, TEMPLATE_NAME_KEY

    db = make_session()
    try:
        lead = add_tracked_lead(db)
        due_general_followup(db, lead)
        record_recent_whatsapp_inbound(db, lead, datetime.now(timezone.utc) - timedelta(hours=25))
        db.add(AppSetting(key=TEMPLATE_NAME_KEY, value_json=json.dumps("metho_followup_v1")))
        db.add(AppSetting(key=TEMPLATE_LANGUAGE_KEY, value_json=json.dumps("en_US")))
        db.commit()
        db.close = lambda: None
        monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", NoCloseSession(db))
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, **kwargs: sent.append((recipient, kwargs)) or {"messages": [{"id": "wamid.template"}]})

        assert process_due_followups() == 1
        outbox = db.query(WhatsAppMessageOutbox).one()
        template = json.loads(outbox.message)["_whatsapp_template"]
        assert template == {"name": "metho_followup_v1", "language": "en_US", "parameters": ["Test Customer"]}
        assert process_message_outbox() == 1
        assert sent == [(lead.whatsapp_no, {"template_name": "metho_followup_v1", "template_language_code": "en_US", "template_parameters": ["Test Customer"]})]
    finally:
        db.close()


def test_failed_followup_template_delivery_records_lead_activity(monkeypatch):
    from sql_app.followup_scheduler import TEMPLATE_LANGUAGE_KEY, TEMPLATE_NAME_KEY

    db = make_session()
    try:
        lead = add_tracked_lead(db)
        due_general_followup(db, lead)
        record_recent_whatsapp_inbound(db, lead, datetime.now(timezone.utc) - timedelta(hours=25))
        db.add(AppSetting(key=TEMPLATE_NAME_KEY, value_json=json.dumps("metho_followup_v1")))
        db.add(AppSetting(key=TEMPLATE_LANGUAGE_KEY, value_json=json.dumps("en_US")))
        db.commit()
        db.close = lambda: None
        monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", NoCloseSession(db))
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("template rejected")))

        assert process_due_followups() == 1
        assert process_message_outbox() == 0
        failure = db.query(CRMLeadActivity).filter_by(lead_id=lead.id, activity_type="whatsapp_followup_template_failed").one()
        assert "template rejected" in failure.message
    finally:
        db.close()


def test_completed_registration_does_not_receive_incomplete_registration_reminder(monkeypatch):
    db = make_session()
    try:
        lead = add_tracked_lead(db)
        open_registration(db, lead)
        due_reminder(db, lead)
        record_recent_whatsapp_inbound(db, lead)
        lead.member_user_id = "MAU12345"
        db.commit()
        db.close = lambda: None
        monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", NoCloseSession(db))
        assert process_due_followups() == 0
        reminder = db.query(CRMFollowUp).filter_by(lead_id=lead.id, notes="Abandoned registration reminder").one()
        assert reminder.status == "Completed"
        assert db.query(WhatsAppMessageOutbox).count() == 0
    finally:
        db.close()


def test_submitted_registration_stops_pending_and_queued_abandoned_reminders(monkeypatch):
    db = make_session()
    try:
        lead = add_tracked_lead(db)
        open_registration(db, lead)
        due_reminder(db, lead)
        record_recent_whatsapp_inbound(db, lead)
        db.close = lambda: None
        monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", NoCloseSession(db))
        assert process_due_followups() == 1
        assert db.query(WhatsAppMessageOutbox).count() == 1
        record_public_registration_event({"crm_lead_id": lead.id, "phone": lead.phone, "event_type": "registration_form_submitted"}, db)
        reminder = db.query(CRMFollowUp).filter_by(lead_id=lead.id, notes="Abandoned registration reminder").one()
        assert reminder.status == "Completed"
        assert db.query(WhatsAppMessageOutbox).filter_by(lead_id=lead.id, activity_type="registration_reminder_sent").count() == 0
        lead.member_user_id = "MAU12345"
        db.commit()
        record_public_registration_event({"crm_lead_id": lead.id, "phone": lead.phone, "event_type": "registration_form_submitted"}, db)
        reminder = db.query(CRMFollowUp).filter_by(lead_id=lead.id, notes="Abandoned registration reminder").one()
        assert reminder.status == "Completed"
        assert db.query(WhatsAppMessageOutbox).filter(WhatsAppMessageOutbox.activity_type == "registration_reminder_sent").count() == 0
        assert db.query(WhatsAppMessageOutbox).filter_by(lead_id=lead.id, activity_type="registration_confirmation_requested").count() == 1
        assert lead.status == "APPLICATION"
        session = db.query(WhatsAppRegistrationSession).filter_by(lead_id=lead.id).one()
        assert session.state == "REGISTRATION_CONFIRMATION_PENDING"
    finally:
        db.close()


def test_handoff_and_stop_cancel_only_abandoned_reminders(monkeypatch):
    db = make_session()
    try:
        lead = add_tracked_lead(db)
        open_registration(db, lead)
        session = db.query(WhatsAppRegistrationSession).one()
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud._send_member_registration_reply", lambda _db, recipient, text: sent.append((recipient, text)) or True)
        assert _request_whatsapp_human_handoff(db, lead, session, lead.phone)
        db.commit()
        reminder = db.query(CRMFollowUp).filter_by(lead_id=lead.id, notes="Abandoned registration reminder").one()
        assert reminder.status == "Cancelled"
        assert db.query(CRMTask).filter_by(lead_id=lead.id, title="WhatsApp human support requested", status="Pending").count() == 1

        second = add_tracked_lead(db, "rider", "8801712345679")
        open_registration(db, second)
        _stop_abandoned_registration_reminders(db, second, "Customer opted out")
        db.commit()
        assert db.query(CRMFollowUp).filter_by(lead_id=second.id, notes="Abandoned registration reminder", status="Cancelled").count() == 1
    finally:
        db.close()


def test_multiple_registration_opens_keep_one_reminder_chain():
    db = make_session()
    try:
        lead = add_tracked_lead(db)
        open_registration(db, lead)
        first_due = db.query(CRMFollowUp).filter_by(lead_id=lead.id, notes="Abandoned registration reminder").one().scheduled_at
        open_registration(db, lead)
        reminders = db.query(CRMFollowUp).filter_by(lead_id=lead.id, notes="Abandoned registration reminder", status="Pending").all()
        assert len(reminders) == 1
        assert reminders[0].scheduled_at >= first_due
    finally:
        db.close()


def test_role_registration_links_are_tracked_for_all_roles():
    db = make_session()
    try:
        for role in ("member", "partner", "rider"):
            reply = _role_registration_reply(db, role, "lead-123", "8801712345678")
            url = next(value for value in reply.split() if value.startswith("https://"))
            parsed = urlsplit(url)
            query = parse_qs(parsed.query)
            assert query["crm_lead_id"] == ["lead-123"]
            assert query["prefill_phone"] == ["8801712345678"]
            assert query["registration_role"] == [role]
            if role == "member":
                assert parsed.path == "/register"
    finally:
        db.close()


def test_role_registration_urls_normalize_to_public_form_routes():
    config = {
        "member_registration_url": "https://methoaayupay.com/app/register",
        "partner_registration_url": "https://methoaayupay.com/",
        "rider_registration_url": "https://methoaayupay.com/app",
    }
    assert urlsplit(_role_registration_url(config, "member")).path == "/register"
    assert urlsplit(_role_registration_url(config, "partner")).path == "/partner-register"
    assert urlsplit(_role_registration_url(config, "rider")).path == "/rider-register"


@pytest.mark.parametrize(("choice", "role"), [("1", "member"), ("Member", "member"), ("2", "partner"), ("Partner", "partner"), ("3", "rider"), ("Rider", "rider")])
def test_role_selection_starts_first_chat_registration_question(monkeypatch, choice, role):
    db = make_session()
    try:
        lead = add_tracked_lead(db, role=role)
        session = db.query(WhatsAppRegistrationSession).one()
        session.state = "INTRODUCTION"
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud._send_member_registration_reply", lambda _db, recipient, text: sent.append(text) or True)
        assert _continue_introduction(db, session, lead, choice, lead.phone)
        expected_state = {"member": "NATIVE_REG_MEMBER", "partner": "NATIVE_REG_PARTNER", "rider": "NATIVE_REG_RIDER"}[role]
        assert session.state == expected_state
        assert session.role == role
        assert len(sent) == 1
        privacy = "আপনার তথ্য শুধু রেজিস্ট্রেশনের জন্য ব্যবহার হবে"
        assert privacy in sent[0]
        assert "Terms & Conditions" not in sent[0]
        assert "WEB" not in sent[0] and "YES" not in sent[0]
        assert "http" not in sent[0]
    finally:
        db.close()


@pytest.mark.parametrize(("choice", "role"), [("1", "member"), ("2", "partner"), ("3", "rider")])
def test_web_keyword_cannot_leave_chat_registration(monkeypatch, choice, role):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append(text) or {"messages": [{"id": "wamid.reply"}]})
        from sql_app.routers.whatsapp import update_whatsapp_settings
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, SimpleNamespace(role="admin", id="ADMIN"))
        assert ingest_whatsapp_message(db, message_payload(f"wamid.{role}.hi", "Hi"), None) == "created"
        assert ingest_whatsapp_message(db, message_payload(f"wamid.{role}.pick", choice), None) == "updated"
        session = db.query(WhatsAppRegistrationSession).one()
        assert session.state == f"NATIVE_REG_{role.upper()}" and session.role == role

        assert ingest_whatsapp_message(db, message_payload(f"wamid.{role}.web", "WEB"), None) == "updated"
        assert session.state == f"NATIVE_REG_{role.upper()}"
        assert all("registration_role=" not in reply and "http" not in reply for reply in sent)
    finally:
        db.close()


@pytest.mark.parametrize(("message", "role"), [("আমি মেম্বার হতে চাই", "member"), ("আমি পার্টনার হতে চাই", "partner"), ("আমি রাইডার হতে চাই", "rider")])
def test_direct_role_intent_starts_chat_registration_without_web_link(monkeypatch, message, role):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append(text) or {"messages": [{"id": "wamid.reply"}]})
        from sql_app.routers.whatsapp import update_whatsapp_settings
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token", f"{role}_registration_url": f"https://example.com/{role}-join"}, db, SimpleNamespace(role="admin", id="ADMIN"))
        assert ingest_whatsapp_message(db, message_payload(f"wamid.{role}.direct", message), None) == "created"
        session = db.query(WhatsAppRegistrationSession).one()
        assert session.state == "INTRODUCTION"
        assert session.role == ""
        assert ingest_whatsapp_message(db, message_payload(f"wamid.{role}.choice", role), None) == "updated"
        assert session.state == f"NATIVE_REG_{role.upper()}"
        assert len(sent) == 2
        assert "আপনার তথ্য শুধু রেজিস্ট্রেশনের জন্য ব্যবহার হবে" in sent[-1]
        assert f"https://example.com/{role}-join" not in sent[-1]
        assert "registration_role=" not in sent[-1]
        assert session.role == role
    finally:
        db.close()


@pytest.mark.parametrize(("role", "state"), [("member", "MEMBER_PAN"), ("partner", "PARTNER_PAN"), ("rider", "RIDER_AADHAAR")])
def test_registration_start_command_resets_stale_native_session(monkeypatch, role, state):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append(text) or {"messages": [{"id": "wamid.reply"}]})
        from sql_app.routers.whatsapp import update_whatsapp_settings
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, SimpleNamespace(role="admin", id="ADMIN"))
        lead = add_tracked_lead(db, role=role)
        session = db.query(WhatsAppRegistrationSession).one()
        session.role = role
        session.state = state
        session.name = "Old Name"
        session.address = "Old Address"
        session.data_json = '{"pan_no":"ABCDE1234F","aadhaar_no":"123456789012"}'
        db.commit()

        assert ingest_whatsapp_message(db, message_payload("wamid.restart-registration", "Registration"), None) == "updated"
        db.refresh(session)
        assert session.state == "INTRODUCTION"
        assert session.role == ""
        assert session.name == ""
        assert session.address == ""
        assert json.loads(session.data_json) == {"language": "bn"}
        assert "আপনি Member, Partner নাকি Rider হিসেবে যুক্ত হতে চান? নিজের কথায় লিখে জানান।" in sent[-1]
        assert "1. Member" not in sent[-1]
        assert "PAN" not in sent[-1]
        assert db.query(CRMLeadActivity).filter_by(lead_id=lead.id, activity_type="whatsapp_registration_state", message=state).count() == 0
    finally:
        db.close()


@pytest.mark.parametrize(("role", "state"), [("member", "MEMBER_NAME"), ("partner", "PARTNER_BUSINESS_TYPE"), ("rider", "RIDER_NAME")])
@pytest.mark.parametrize("greeting", ["Hi", "Hello", "হাই", "হ্যালো", "নমস্কার", "Namaskar"])
def test_new_greeting_resets_any_stale_native_session(monkeypatch, role, state, greeting):
    db = make_session()
    try:
        lead = add_tracked_lead(db, role=role)
        session = db.query(WhatsAppRegistrationSession).one()
        session.state = state
        session.name = "Old Name"
        session.address = "Old Address"
        session.data_json = '{"pan_no":"ABCDE1234F","aadhaar_no":"123456789012"}'
        db.commit()
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud._send_member_registration_reply", lambda _db, recipient, text: sent.append(text) or True)

        assert ingest_whatsapp_message(db, message_payload(f"wamid.greeting-{role}-{state}-{greeting}", greeting), None) == "updated"
        db.refresh(session)
        assert session.state == "INTRODUCTION"
        assert session.role == ""
        assert session.name == ""
        assert session.address == ""
        language = "bn"
        expected_question = (
            "আপনি Member, Partner নাকি Rider হিসেবে যুক্ত হতে চান? নিজের কথায় লিখে জানান।"
            if language == "bn"
            else "Would you like to join as a Member, Partner, or Rider? Please tell me in your own words."
        )
        assert json.loads(session.data_json) == {"language": language}
        assert expected_question in sent[-1]
        assert "PAN" not in sent[-1]
        assert db.query(CRMLeadActivity).filter_by(lead_id=lead.id, activity_type="whatsapp_introduction_started").count() == 1
    finally:
        db.close()


def test_new_greeting_does_not_reset_registered_identity(monkeypatch):
    db = make_session()
    try:
        lead = add_tracked_lead(db)
        lead.member_user_id = "MAU12345"
        db.add(User(id="MAU12345", name="Active Member", email="active@example.com", phone=lead.phone, password="hash", role="member", is_active=False))
        session = db.query(WhatsAppRegistrationSession).one()
        session.state = "MEMBER_ACTIVATION_PENDING"
        session.data_json = '{"member_user_id":"MAU12345"}'
        db.commit()
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud._send_member_registration_reply", lambda _db, recipient, text: sent.append(text) or True)

        assert ingest_whatsapp_message(db, message_payload("wamid.greeting-registered", "Hello"), None) == "updated"
        db.refresh(session)
        assert session.state == "MEMBER_ACTIVATION_PENDING"
        assert session.data_json == '{"member_user_id": "MAU12345"}'
        assert sent
    finally:
        db.close()


@pytest.mark.parametrize("greeting", ["Hi", "Hello", "হাই"])
def test_fresh_greeting_starts_welcome_role_selection(monkeypatch, greeting):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud._send_member_registration_reply", lambda _db, recipient, text: sent.append(text) or True)

        assert ingest_whatsapp_message(db, message_payload(f"wamid.fresh-greeting-{greeting}", greeting), None) == "created"
        assert sent
        assert "I couldn't identify your role" not in sent[-1]
        expected_question = "আপনি Member, Partner নাকি Rider হিসেবে যুক্ত হতে চান? নিজের কথায় লিখে জানান।"
        assert expected_question in sent[-1]
        session = db.query(WhatsAppRegistrationSession).one()
        lead = db.query(CRMLead).one()
        assert session.state == "INTRODUCTION"
        assert lead.status == "CONTACTED"
        assert _send_introduction(db, session, lead, lead.phone, "bn" if any("\u0980" <= char <= "\u09ff" for char in greeting) else "en")
        assert lead.status == "CONTACTED"
        assert db.query(CRMLeadActivity).filter_by(lead_id=lead.id, activity_type="whatsapp_introduction_started").count() == 2
    finally:
        db.close()


def test_successful_website_registration_triggers_role_specific_lifecycle(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setattr("sql_app.whatsapp_ai.create_suggestion_for_activity", lambda _activity_id: None)
        monkeypatch.setattr("sql_app.routers.auth.hash_password", lambda value: "hashed")
        monkeypatch.setattr("sql_app.routers.auth.build_welcome_pdf", lambda user: "")
        monkeypatch.setattr("sql_app.routers.auth.send_welcome_email", lambda *args: False)
        monkeypatch.setattr("sql_app.routers.auth._send_registration_whatsapp_welcome", lambda *args: None)
        db.add(User(id="MAU00001", name="METHO Admin", email="admin@test.local", phone="9000000000", password="hashed", role="super_admin", is_active=True))
        member_lead = add_tracked_lead(db, "member", "8801712345678")
        partner_lead = add_tracked_lead(db, "partner", "8801712345679")
        rider_lead = add_tracked_lead(db, "rider", "8801712345680")
        member_lead.assigned_user_id = "ADMIN"
        partner_lead.assigned_user_id = "ADMIN"
        rider_lead.assigned_user_id = "ADMIN"
        db.commit()

        register(RegisterRequest(name="Member One", email="MAU12345", phone=member_lead.phone, pan_no="ABCDE1234F", password="secret1"), db)
        partner_register({"login_id": "partner-one", "password": "secret1", "business_name": "Partner One", "contact_person": "Owner", "phone": partner_lead.phone, "pan_no": "BCDEF1234G", "aadhaar_no": "123456789012"}, db)
        rider_register(RiderRegisterRequest(name="Rider One", phone=rider_lead.phone, password="secret1", vehicle_type="delivery", whatsapp=rider_lead.phone, address="Road 1", pan_no="CDEFG1234H", aadhaar_no="123456789013", agreed_to_terms=True), db)

        assert db.query(CRMLeadActivity).filter_by(lead_id=member_lead.id, activity_type="member_registration_completed").count() == 1
        assert db.query(CRMLeadActivity).filter_by(lead_id=partner_lead.id, activity_type="partner_registration_submitted").count() == 1
        assert db.query(CRMLeadActivity).filter_by(lead_id=rider_lead.id, activity_type="rider_registration_submitted").count() == 1
        assert member_lead.member_user_id
        assert partner_lead.partner_request_id
        assert rider_lead.rider_user_id
    finally:
        db.close()


@pytest.mark.parametrize("role", ["member", "partner", "rider"])
def test_successful_website_registration_syncs_whatsapp_session_and_next_message(monkeypatch, role):
    db = make_session()
    try:
        monkeypatch.setattr("sql_app.whatsapp_ai.create_suggestion_for_activity", lambda _activity_id: None)
        monkeypatch.setattr("sql_app.routers.auth.hash_password", lambda value: "hashed")
        monkeypatch.setattr("sql_app.routers.auth.build_welcome_pdf", lambda user: "")
        monkeypatch.setattr("sql_app.routers.auth.send_welcome_email", lambda *args: False)
        monkeypatch.setattr("sql_app.routers.auth._send_registration_whatsapp_welcome", lambda *args: None)
        monkeypatch.setattr("sql_app.routers.auth.record_lifecycle_event_by_phone", lambda *args: None)
        monkeypatch.setattr("sql_app.routers.partner_public.record_lifecycle_event_by_phone", lambda *args: None)
        monkeypatch.setattr("sql_app.routers.rider.record_lifecycle_event_by_phone", lambda *args: None)
        db.add(User(id="MAU00001", name="METHO Admin", email="admin@test.local", phone="9000000000", password="hashed", role="super_admin", is_active=True))
        phone = {"member": "8801712345678", "partner": "8801712345679", "rider": "8801712345680"}[role]
        lead = add_tracked_lead(db, role, phone)
        lead.assigned_user_id = "ADMIN"
        session = db.query(WhatsAppRegistrationSession).filter_by(phone=phone).one()
        session.state = "INTRODUCTION"
        session.role = ""
        db.commit()

        if role == "member":
            register(RegisterRequest(name="Member One", email="MAU12345", phone=phone, pan_no="ABCDE1234F", password="secret1"), db)
        elif role == "partner":
            partner_register({"login_id": "partner-one", "password": "secret1", "business_name": "Partner One", "contact_person": "Owner", "phone": phone, "pan_no": "BCDEF1234G", "aadhaar_no": "123456789012"}, db)
        else:
            rider_register(RiderRegisterRequest(name="Rider One", phone=phone, password="secret1", vehicle_type="delivery", whatsapp=phone, address="Road 1", pan_no="CDEFG1234H", aadhaar_no="123456789013", agreed_to_terms=True), db)

        db.refresh(lead)
        db.refresh(session)
        assert session.state.endswith("PENDING")
        assert session.role == role
        assert session.completed_at is not None
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud._send_member_registration_reply", lambda _db, recipient, text: sent.append(text) or True)
        assert ingest_whatsapp_message(db, message_payload(f"wamid.website-{role}-submitted", "submitted", sender=phone), None) == "updated"
        assert sent
        assert "1. Member" not in sent[-1]
        assert "2. Partner" not in sent[-1]
        assert "3. Rider" not in sent[-1]
        assert lead.member_user_id or lead.partner_request_id or lead.rider_user_id
    finally:
        db.close()


@pytest.mark.parametrize("role", ["member", "partner", "rider"])
def test_registration_submit_event_queues_next_whatsapp_followup(monkeypatch, role):
    db = make_session()
    try:
        monkeypatch.setattr("sql_app.whatsapp_ai.create_suggestion_for_activity", lambda _activity_id: None)
        phone = {"member": "8801712345678", "partner": "8801712345679", "rider": "8801712345680"}[role]
        lead = add_tracked_lead(db, role, phone)
        lead.assigned_user_id = "ADMIN"
        if role == "member":
            lead.member_user_id = "MAU12345"
        elif role == "partner":
            lead.partner_request_id = "partner-request-1"
        else:
            lead.rider_user_id = "MAU12346"
        db.commit()

        result = record_public_registration_event({"crm_lead_id": lead.id, "phone": phone, "event_type": "registration_form_submitted"}, db)
        assert result["linked"] is True
        assert db.query(CRMLeadActivity).filter_by(lead_id=lead.id, activity_type="registration_form_submitted").count() == 1
        followup = db.query(CRMFollowUp).filter_by(lead_id=lead.id, notes="Confirm registration status and next activation/approval step").one()
        followup.scheduled_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        record_recent_whatsapp_inbound(db, lead)
        db.commit()
        db.close = lambda: None
        monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", NoCloseSession(db))
        assert process_due_followups() == 1
        outbox = db.query(WhatsAppMessageOutbox).filter_by(lead_id=lead.id, activity_type="whatsapp_message_sent").one()
        assert outbox.status == "pending"
        assert outbox.activity_type == "whatsapp_message_sent"
        assert outbox.message.strip()
    finally:
        db.close()


def test_second_role_submit_uses_submitted_role_and_preserves_existing_identity(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setattr("sql_app.whatsapp_ai.create_suggestion_for_activity", lambda _activity_id: None)
        lead = add_tracked_lead(db, "member")
        member = User(id="MAU-MULTI-ROLE", name="Existing Member", email="multi-role-member", phone=lead.phone, password="hashed", role="member")
        request = PartnerRequest(id="partner-multi-role", phone=lead.phone, whatsapp_no=lead.phone, status="pending", business_name="Second Role Business")
        db.add_all([member, request])
        lead.member_user_id = member.id
        lead.partner_request_id = request.id
        db.commit()

        result = record_public_registration_event({
            "crm_lead_id": lead.id,
            "phone": lead.phone,
            "event_type": "registration_form_submitted",
            "registration_role": "partner",
        }, db)

        session = db.query(WhatsAppRegistrationSession).filter_by(phone=lead.phone).one()
        assert result["linked"] is True
        assert lead.member_user_id == member.id
        assert lead.partner_request_id == request.id
        assert session.role == "partner"
        assert session.state == "REGISTRATION_CONFIRMATION_PENDING"
        assert db.query(CRMLeadActivity).filter_by(lead_id=lead.id, activity_type="partner_registration_submitted").count() == 1
        assert db.query(WhatsAppMessageOutbox).filter_by(dedupe_key=f"registration-confirmation:{lead.id}:partner").count() == 1
    finally:
        db.close()


@pytest.mark.parametrize("role", ["member", "partner", "rider"])
def test_registration_submit_reconciles_changed_phone_and_registered_routing(monkeypatch, role):
    db = make_session()
    try:
        monkeypatch.setattr("sql_app.whatsapp_ai.create_suggestion_for_activity", lambda _activity_id: None)
        tracked_phone = {"member": "8801712345678", "partner": "8801712345679", "rider": "8801712345680"}[role]
        submitted_phone = {"member": "919876543210", "partner": "919876543211", "rider": "919876543212"}[role]
        lead = add_tracked_lead(db, role, tracked_phone)
        session = db.query(WhatsAppRegistrationSession).filter_by(phone=tracked_phone).one()
        if role == "member":
            db.add(User(id="MAU23451", name="Member One", email="MAU23451", phone=submitted_phone, password="hashed", role="member", is_active=False))
        elif role == "rider":
            rider = User(id="MAU23452", name="Rider One", email="rider@example.com", phone=submitted_phone, password="hashed", role="rider", is_active=False)
            db.add(rider)
            db.flush()
            db.add(AppSetting(key=f"rider_profile:{rider.id}", value_json=json.dumps({"approval_status": "pending"})))
        else:
            db.add(PartnerRequest(id="partner-request-changed-phone", phone=submitted_phone, whatsapp_no=submitted_phone, status="pending", business_name="Partner One"))
        db.commit()

        result = record_public_registration_event({"crm_lead_id": lead.id, "phone": submitted_phone, "event_type": "registration_form_submitted"}, db)
        assert result["linked"] is True
        db.refresh(lead)
        db.refresh(session)
        assert lead.member_user_id or lead.partner_request_id or lead.rider_user_id
        assert session.role == role
        assert session.state.endswith("PENDING")
        assert session.completed_at is not None
        assert db.query(CRMLeadActivity).filter_by(lead_id=lead.id, activity_type=f"{role}_registration_submitted" if role != "member" else "member_registration_completed").count() == 1

        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud._send_member_registration_reply", lambda _db, recipient, text: sent.append(text) or True)
        assert ingest_whatsapp_message(db, message_payload(f"wamid.changed-phone-{role}", "submitted", sender=tracked_phone), None) == "updated"
        assert sent
        assert "1. Member" not in sent[-1]
        assert "2. Partner" not in sent[-1]
        assert "3. Rider" not in sent[-1]
    finally:
        db.close()


def test_registration_submit_requests_whatsapp_confirmation(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setattr("sql_app.whatsapp_ai.create_suggestion_for_activity", lambda _activity_id: None)
        lead = add_tracked_lead(db, "member")
        lead.member_user_id = "MAU23451"
        db.commit()
        result = record_public_registration_event({"crm_lead_id": lead.id, "phone": lead.phone, "event_type": "registration_form_submitted"}, db)
        session = db.query(WhatsAppRegistrationSession).one()
        outbox = db.query(WhatsAppMessageOutbox).filter_by(lead_id=lead.id, activity_type="registration_confirmation_requested").one()
        assert result["linked"] is True
        assert session.state == "REGISTRATION_CONFIRMATION_PENDING"
        assert json.loads(session.data_json)["registration_confirmed"] is False
        assert outbox.message
    finally:
        db.close()


@pytest.mark.parametrize(("reply", "confirmed"), [("YES", True), ("Yes", True), ("y", True), ("হ্যাঁ", True), ("submitted", True), ("hoyeche", True), ("হয়েছে", True), ("korediyechi", True), ("করে দিয়েছি", True), ("done", True), ("NO", False), ("n", False), ("না", False), ("not submitted", False), ("not yet", False), ("হয়নি", False), ("করিনি", False)])
def test_registration_confirmation_replies_bypass_role_parser(monkeypatch, reply, confirmed):
    db = make_session()
    try:
        lead = add_tracked_lead(db, "member")
        lead.member_user_id = "MAU23451"
        db.add(User(id="MAU23451", name="Member One", email="MAU23451", phone=lead.phone, password="hashed", role="member", is_active=False))
        session = db.query(WhatsAppRegistrationSession).one()
        session.state = "REGISTRATION_CONFIRMATION_PENDING"
        session.role = "member"
        session.completed_at = datetime.now(timezone.utc)
        session.data_json = json.dumps({"member_user_id": "MAU23451", "registration_confirmed": False})
        db.commit()
        sent = []
        call_notices = []
        monkeypatch.setattr("sql_app.whatsapp_cloud._send_member_registration_reply", lambda _db, recipient, text: sent.append(text) or True)
        monkeypatch.setattr("sql_app.whatsapp_cloud._send_customer_call_notice", lambda _db, _lead, _recipient, language, **kwargs: call_notices.append(language) or "sent")
        assert ingest_whatsapp_message(db, message_payload(f"wamid.confirm-{reply}", reply), None) == "updated"
        db.refresh(session)
        assert json.loads(session.data_json)["registration_confirmed"] is confirmed
        if not confirmed:
            assert call_notices and not sent
        else:
            assert sent
            assert "1. Member" not in sent[-1]
            assert "2. Partner" not in sent[-1]
            assert "3. Rider" not in sent[-1]
    finally:
        db.close()


def test_duplicate_confirmation_does_not_create_reminder_chain(monkeypatch):
    db = make_session()
    try:
        lead = add_tracked_lead(db, "member")
        lead.member_user_id = "MAU23451"
        session = db.query(WhatsAppRegistrationSession).one()
        session.state = "REGISTRATION_CONFIRMATION_PENDING"
        session.role = "member"
        session.data_json = json.dumps({"member_user_id": "MAU23451", "registration_confirmed": False})
        db.commit()
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud._send_member_registration_reply", lambda _db, recipient, text: sent.append(text) or True)
        for message_id in ("wamid.confirm-one", "wamid.confirm-two"):
            assert ingest_whatsapp_message(db, message_payload(message_id, "YES"), None) == "updated"
        assert db.query(CRMFollowUp).filter_by(lead_id=lead.id, notes="Abandoned registration reminder", status="Pending").count() == 0
    finally:
        db.close()


def test_confirmation_pending_keeps_existing_reminder_chain_active(monkeypatch):
    db = make_session()
    try:
        lead = add_tracked_lead(db, "member")
        lead.member_user_id = "MAU23451"
        session = db.query(WhatsAppRegistrationSession).one()
        session.state = "REGISTRATION_CONFIRMATION_PENDING"
        session.data_json = json.dumps({"registration_confirmed": False})
        db.add(CRMFollowUp(lead_id=lead.id, scheduled_at=datetime.now(timezone.utc) - timedelta(seconds=1), status="Pending", notes="Abandoned registration reminder"))
        record_recent_whatsapp_inbound(db, lead)
        db.commit()
        db.close = lambda: None
        monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", NoCloseSession(db))
        assert process_due_followups() == 1
        reminder = db.query(CRMFollowUp).filter_by(lead_id=lead.id, notes="Abandoned registration reminder").one()
        assert reminder.status == "Pending"
        assert db.query(WhatsAppMessageOutbox).filter_by(lead_id=lead.id, activity_type="registration_reminder_sent").count() == 1
    finally:
        db.close()


def test_failed_website_registration_does_not_trigger_success_lifecycle(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setattr("sql_app.whatsapp_ai.create_suggestion_for_activity", lambda _activity_id: None)
        db.add(User(id="MAU00001", name="METHO Admin", email="admin@test.local", phone="9000000000", password="hashed", role="super_admin", is_active=True))
        member_lead = add_tracked_lead(db, "member", "8801712345678")
        partner_lead = add_tracked_lead(db, "partner", "8801712345679")
        rider_lead = add_tracked_lead(db, "rider", "8801712345680")

        with pytest.raises(Exception, match="PAN number"):
            register(RegisterRequest(name="Bad Member", email="MAU12345", phone=member_lead.phone, pan_no="BAD", password="secret1"), db)
        with pytest.raises(Exception, match="PAN number must be in format"):
            partner_register({"login_id": "bad-partner", "password": "secret1", "business_name": "Bad Partner", "contact_person": "Owner", "phone": partner_lead.phone, "pan_no": "BAD", "aadhaar_no": "123456789012"}, db)
        with pytest.raises(Exception, match="Aadhaar"):
            rider_register(RiderRegisterRequest(name="Bad Rider", phone=rider_lead.phone, password="secret1", vehicle_type="delivery", whatsapp=rider_lead.phone, address="Road 1", pan_no="ABCDE1234F", aadhaar_no="123", agreed_to_terms=True), db)

        success_types = ["registration_form_submitted", "member_registration_completed", "partner_registration_submitted", "rider_registration_submitted", "onboarding_started"]
        assert db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type.in_(success_types)).count() == 0
        assert not member_lead.member_user_id
        assert not partner_lead.partner_request_id
        assert not rider_lead.rider_user_id
    finally:
        db.close()
