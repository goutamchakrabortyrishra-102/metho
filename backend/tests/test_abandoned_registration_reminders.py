import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import CRMFollowUp, CRMLead, CRMLeadActivity, CRMTask, User, WhatsAppMessageOutbox, WhatsAppRegistrationSession
from sql_app.routers.crm import record_public_registration_event
from sql_app.whatsapp_ai import process_due_followups, process_message_outbox
from sql_app.whatsapp_cloud import _continue_introduction, _request_whatsapp_human_handoff, _role_registration_reply, _stop_abandoned_registration_reminders


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


def due_reminder(db, lead):
    reminder = db.query(CRMFollowUp).filter_by(lead_id=lead.id, notes="Abandoned registration reminder", status="Pending").one()
    reminder.scheduled_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    return reminder


def test_opened_registration_queues_one_reminder_and_outbox_records_delivery(monkeypatch):
    db = make_session()
    try:
        lead = add_tracked_lead(db)
        open_registration(db, lead)
        assert db.query(CRMFollowUp).filter_by(lead_id=lead.id, notes="Abandoned registration reminder", status="Pending").count() == 1
        due_reminder(db, lead)
        db.close = lambda: None
        monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", NoCloseSession(db))
        assert process_due_followups() == 1
        assert process_due_followups() == 0
        assert db.query(WhatsAppMessageOutbox).count() == 1
        outbox = db.query(WhatsAppMessageOutbox).one()
        assert outbox.status == "pending"
        assert "crm_lead_id=" in outbox.message
        assert "prefill_phone=" in outbox.message
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
        db.close = lambda: None
        monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", NoCloseSession(db))
        assert process_due_followups() == 1
        reminder = db.query(CRMFollowUp).filter_by(lead_id=lead.id, notes="Abandoned registration reminder", status="Pending").one()
        reminder.scheduled_at = datetime.now(timezone.utc) - timedelta(days=1)
        db.commit()
        assert process_due_followups() == 1
        assert db.query(WhatsAppMessageOutbox).count() == 2
        assert db.query(CRMFollowUp).filter_by(lead_id=lead.id, notes="Abandoned registration reminder", status="Pending").count() == 1
        assert reminder.status == "Pending"
    finally:
        db.close()


def test_submitted_registration_stops_pending_and_queued_abandoned_reminders(monkeypatch):
    db = make_session()
    try:
        lead = add_tracked_lead(db)
        open_registration(db, lead)
        due_reminder(db, lead)
        db.close = lambda: None
        monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", NoCloseSession(db))
        assert process_due_followups() == 1
        assert db.query(WhatsAppMessageOutbox).count() == 1
        record_public_registration_event({"crm_lead_id": lead.id, "phone": lead.phone, "event_type": "registration_form_submitted"}, db)
        reminder = db.query(CRMFollowUp).filter_by(lead_id=lead.id, notes="Abandoned registration reminder").one()
        assert reminder.status == "Completed"
        assert db.query(WhatsAppMessageOutbox).count() == 0
        assert lead.status == "APPLICATION"
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
            query = parse_qs(urlsplit(url).query)
            assert query["crm_lead_id"] == ["lead-123"]
            assert query["prefill_phone"] == ["8801712345678"]
            assert query["registration_role"] == [role]
    finally:
        db.close()


def test_role_selection_sends_tracked_link_without_starting_native_registration(monkeypatch):
    db = make_session()
    try:
        lead = add_tracked_lead(db)
        session = db.query(WhatsAppRegistrationSession).one()
        session.state = "INTRODUCTION"
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud._send_member_registration_reply", lambda _db, recipient, text: sent.append(text) or True)
        assert _continue_introduction(db, session, lead, "1", lead.phone)
        assert session.state == "ROLE_SELECTION"
        assert session.role == "member"
        assert "crm_lead_id=" in sent[0]
        assert "prefill_phone=" in sent[0]
    finally:
        db.close()
