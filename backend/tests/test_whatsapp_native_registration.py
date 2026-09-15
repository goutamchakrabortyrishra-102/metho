import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.models import AppSetting, CRMFollowUp, CRMLead, CRMTask, PartnerRequest, PublicOrder, User, WhatsAppRegistrationSession
from sql_app.whatsapp_cloud import ingest_whatsapp_message
from sql_app.whatsapp_ai import process_due_followups
from test_whatsapp_admin_settings import admin, make_session, message_payload
from sql_app.routers.whatsapp import update_whatsapp_settings


def _configure(db):
    update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())


def _send_flow(db, monkeypatch, messages):
    sent = []
    monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append(text) or {"messages": [{"id": "wamid.reply"}]})
    for message_id, body in messages:
        assert ingest_whatsapp_message(db, message_payload(message_id, body), None) in {"created", "updated"}
    return sent


def test_whatsapp_partner_shop_creates_real_pending_request_and_encrypts_sensitive_data(monkeypatch):
    db = make_session()
    try:
        _configure(db)
        sent = _send_flow(db, monkeypatch, [
            ("partner-intro", "Hello"),
            ("partner-role", "2"),
            ("partner-consent", "1"),
            ("partner-type", "1"),
            ("partner-name", "Fresh Shop"),
            ("partner-contact", "Goutam"),
            ("partner-email", "shop@example.com"),
            ("partner-address", "Main Road"),
            ("partner-city", "Rishra"),
            ("partner-state", "West Bengal"),
            ("partner-pin", "712248"),
            ("partner-pan", "ABCDE1234F"),
            ("partner-aadhaar", "123456789012"),
            ("partner-confirm", "1"),
        ])
        request = db.query(PartnerRequest).one()
        session = db.query(WhatsAppRegistrationSession).one()
        assert request.status == "pending"
        assert request.business_type.startswith("Shop")
        assert session.state == "PARTNER_APPLICATION_PENDING"
        assert request.id in sent[-1]
        assert "ABCDE1234F" not in session.data_json
        assert "123456789012" not in session.data_json
        assert "sensitive_encrypted" in session.data_json
    finally:
        db.close()


def test_whatsapp_rider_registration_creates_real_pending_user(monkeypatch):
    db = make_session()
    try:
        _configure(db)
        _send_flow(db, monkeypatch, [
            ("rider-intro", "Hello"),
            ("rider-role", "3"),
            ("rider-consent", "1"),
            ("rider-name", "Rider One"),
            ("rider-vehicle", "delivery"),
            ("rider-address", "Main Road"),
            ("rider-city", "Rishra"),
            ("rider-state", "West Bengal"),
            ("rider-pin", "712248"),
            ("rider-pan", "ABCDE1234F"),
            ("rider-aadhaar", "123456789012"),
            ("rider-confirm", "1"),
        ])
        rider = db.query(User).filter(User.role == "rider").one()
        session = db.query(WhatsAppRegistrationSession).one()
        assert rider.is_active is False
        assert session.state == "RIDER_APPLICATION_PENDING"
        assert db.query(AppSetting).filter(AppSetting.key == f"rider_profile:{rider.id}").one()
        assert "ABCDE1234F" not in session.data_json
        assert "123456789012" not in session.data_json
    finally:
        db.close()


def test_whatsapp_partner_approval_stops_followup_and_starts_onboarding(monkeypatch):
    db = make_session()
    try:
        _configure(db)
        _send_flow(db, monkeypatch, [
            ("approval-partner-intro", "Hello"), ("approval-partner-role", "2"), ("approval-partner-consent", "1"),
            ("approval-partner-type", "1"), ("approval-partner-name", "Fresh Shop"), ("approval-partner-contact", "Goutam"),
            ("approval-partner-email", "approval-shop@example.com"), ("approval-partner-address", "Main Road"),
            ("approval-partner-city", "Rishra"), ("approval-partner-state", "West Bengal"), ("approval-partner-pin", "712248"),
            ("approval-partner-pan", "ABCDE1234F"), ("approval-partner-aadhaar", "123456789012"), ("approval-partner-confirm", "1"),
        ])
        request = db.query(PartnerRequest).one()
        request.status = "approved"
        db.commit()
        lead = db.query(CRMLead).one()
        assert ingest_whatsapp_message(db, message_payload("approval-partner-status", "status?"), None) == "updated"
        session = db.query(WhatsAppRegistrationSession).one()
        assert session.state == "PARTNER_ONBOARDING"
        assert db.query(CRMFollowUp).filter_by(lead_id=lead.id, status="Pending", notes="Partner approval follow-up").count() == 0
    finally:
        db.close()


def test_whatsapp_rider_approval_stops_followup_and_starts_onboarding(monkeypatch):
    db = make_session()
    try:
        _configure(db)
        _send_flow(db, monkeypatch, [
            ("approval-rider-intro", "Hello"), ("approval-rider-role", "3"), ("approval-rider-consent", "1"),
            ("approval-rider-name", "Rider One"), ("approval-rider-vehicle", "delivery"), ("approval-rider-address", "Main Road"),
            ("approval-rider-city", "Rishra"), ("approval-rider-state", "West Bengal"), ("approval-rider-pin", "712248"),
            ("approval-rider-pan", "ABCDE1234F"), ("approval-rider-aadhaar", "123456789012"), ("approval-rider-confirm", "1"),
        ])
        rider = db.query(User).filter(User.role == "rider").one()
        profile = db.query(AppSetting).filter(AppSetting.key == f"rider_profile:{rider.id}").one()
        profile.value_json = json.dumps({**json.loads(profile.value_json), "approval_status": "approved"})
        db.commit()
        assert ingest_whatsapp_message(db, message_payload("approval-rider-status", "status?"), None) == "updated"
        session = db.query(WhatsAppRegistrationSession).one()
        assert session.state == "RIDER_ONBOARDING"
    finally:
        db.close()


def test_active_member_order_status_uses_real_public_orders(monkeypatch):
    db = make_session()
    try:
        _configure(db)
        sent = _send_flow(db, monkeypatch, [
            ("order-intro", "Hello"), ("order-role", "1"), ("order-consent", "1"),
            ("order-name", "Member One"), ("order-address", "Main Road"), ("order-pan", "ABCDE1234F"), ("order-dob", "1990-01-31"),
        ])
        # Use a persisted identity fixture to exercise post-activation routing without bypassing WhatsApp status checks.
        user = User(id="MAUORDER1", name="Member One", email="MAUORDER1", phone="8801712345678", password="hash", role="member", is_active=True)
        db.add(user)
        lead = db.query(CRMLead).one()
        lead.member_user_id = user.id
        session = db.query(WhatsAppRegistrationSession).one()
        session.state = "MEMBER_REGISTERED"
        session.data_json = json.dumps({"member_user_id": user.id, "member_code": user.id})
        db.add(AppSetting(key=f"member_purchase_activation:{user.id}", value_json=json.dumps({"active": True})))
        db.add(PublicOrder(id="ORDER-1", customer_user_id=user.id, status="shipped", member_ref=user.id))
        db.commit()
        ingest_whatsapp_message(db, message_payload("order-status", "order status"), None)
        ingest_whatsapp_message(db, message_payload("order-status-2", "order status"), None)
        assert "ORDER-1: shipped" in sent[-1]
    finally:
        db.close()


def test_due_activation_followup_sends_once_and_stops_after_activation(monkeypatch):
    db = make_session()
    try:
        _configure(db)
        user = User(id="MAUFOLLOW1", name="Member One", email="MAUFOLLOW1", phone="8801712345678", password="hash", role="member", is_active=False)
        lead = CRMLead(lead_id="WA-followup", business_name="WhatsApp", contact_person="Member One", phone=user.phone, whatsapp_no=user.phone, source="whatsapp", member_user_id=user.id)
        db.add_all([user, lead])
        db.flush()
        followup = CRMFollowUp(lead_id=lead.id, scheduled_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc) - __import__("datetime").timedelta(minutes=1), status="Pending", notes="Member activation follow-up")
        db.add(followup)
        db.commit()
        db.close = lambda: None
        monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", lambda: db)
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append(text) or {"messages": [{"id": "wamid.followup"}]})
        assert process_due_followups() == 1
        assert sent
        assert followup.status == "Pending"
        user.is_active = True
        db.add(AppSetting(key=f"member_purchase_activation:{user.id}", value_json=json.dumps({"active": True})))
        db.commit()
        followup.scheduled_at = __import__("datetime").datetime.now(__import__("datetime").timezone.utc) - __import__("datetime").timedelta(minutes=1)
        db.commit()
        assert process_due_followups() == 0
        assert followup.status == "Completed"
    finally:
        db.close()


def test_member_says_paid_but_backend_pending_keeps_activation_pending(monkeypatch):
    db = make_session()
    try:
        _configure(db)
        user = User(id="MAUPENDING1", name="Member One", email="MAUPENDING1", phone="8801712345678", password="hash", role="member", is_active=False)
        lead = CRMLead(lead_id="WA-pending", business_name="WhatsApp", contact_person="Member One", phone=user.phone, whatsapp_no=user.phone, source="whatsapp", member_user_id=user.id)
        db.add_all([user, lead])
        db.flush()
        session = WhatsAppRegistrationSession(phone=user.phone, wa_id=user.phone, lead_id=lead.id, role="member", state="MEMBER_ACTIVATION_PENDING", data_json=json.dumps({"member_user_id": user.id, "member_code": user.id}))
        db.add(session)
        db.commit()
        sent = _send_flow(db, monkeypatch, [("paid-pending", "আমি payment করেছি")])
        db.refresh(session)
        assert session.state == "MEMBER_ACTIVATION_PENDING"
        assert "এখনও Active হয়নি" in sent[-1]
    finally:
        db.close()


def test_member_activation_verification_starts_onboarding_once(monkeypatch):
    db = make_session()
    try:
        _configure(db)
        user = User(id="MAUACTIVE1", name="Member One", email="MAUACTIVE1", phone="8801712345678", password="hash", role="member", is_active=True)
        lead = CRMLead(lead_id="WA-active", business_name="WhatsApp", contact_person="Member One", phone=user.phone, whatsapp_no=user.phone, source="whatsapp", member_user_id=user.id)
        db.add_all([user, lead])
        db.flush()
        db.add(AppSetting(key=f"member_purchase_activation:{user.id}", value_json=json.dumps({"active": True})))
        session = WhatsAppRegistrationSession(phone=user.phone, wa_id=user.phone, lead_id=lead.id, role="member", state="MEMBER_ACTIVATION_PENDING", data_json=json.dumps({"member_user_id": user.id, "member_code": user.id}))
        db.add(session)
        db.commit()
        sent = _send_flow(db, monkeypatch, [("active-first", "status")])
        assert session.state == "MEMBER_ONBOARDING"
        assert any("এখন Active" in item for item in sent)
        first_count = db.query(__import__("sql_app.models", fromlist=["CRMLeadActivity"]).CRMLeadActivity).filter_by(lead_id=lead.id, activity_type="onboarding_started").count()
        _send_flow(db, monkeypatch, [("active-second", "আমি মেম্বার")])
        assert session.state == "MEMBER_ONBOARDING"
        assert db.query(__import__("sql_app.models", fromlist=["CRMLeadActivity"]).CRMLeadActivity).filter_by(lead_id=lead.id, activity_type="onboarding_started").count() == first_count == 1
    finally:
        db.close()
