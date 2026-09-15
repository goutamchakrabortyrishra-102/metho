import sys
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import CRMLead, CRMLeadActivity, WhatsAppRegistrationSession
from sql_app.whatsapp_cloud import _continue_introduction, WHATSAPP_INTRODUCTION


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def _lead_and_session(db, sender="8801712345678"):
    lead = CRMLead(lead_id="WA-role", business_name="WhatsApp", contact_person="WhatsApp Lead", phone=sender, whatsapp_no=sender, source="whatsapp")
    db.add(lead)
    db.flush()
    session = WhatsAppRegistrationSession(phone=sender, wa_id=sender, lead_id=lead.id, role="", state=WHATSAPP_INTRODUCTION)
    db.add(session)
    db.commit()
    return lead, session


def test_role_matches_when_keyword_embedded_in_longer_message(monkeypatch):
    db = make_session()
    sent = []
    monkeypatch.setattr("sql_app.whatsapp_cloud._send_member_registration_reply", lambda db, recipient, text: sent.append(text) or True)
    lead, session = _lead_and_session(db)
    assert _continue_introduction(db, session, lead, "Hi I want to become a member please help", "8801712345678") is True
    assert session.role == "member"


def test_second_consecutive_fallback_still_sends_preset_then_third_hands_off(monkeypatch):
    db = make_session()
    sent = []
    monkeypatch.setattr("sql_app.whatsapp_cloud._send_member_registration_reply", lambda db, recipient, text: sent.append(text) or True)
    lead, session = _lead_and_session(db)
    assert _continue_introduction(db, session, lead, "asdkjaslkdj", "8801712345678") is True
    assert _continue_introduction(db, session, lead, "asdkjaslkdj", "8801712345678") is True
    handoff_count_before = db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type == "whatsapp_human_handoff_requested").count()
    assert handoff_count_before == 0
    assert _continue_introduction(db, session, lead, "asdkjaslkdj", "8801712345678") is True
    handoff_count_after = db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type == "whatsapp_human_handoff_requested").count()
    assert handoff_count_after == 1


def test_pasted_registration_details_trigger_human_handoff(monkeypatch):
    db = make_session()
    sent = []
    monkeypatch.setattr("sql_app.whatsapp_cloud._send_member_registration_reply", lambda db, recipient, text: sent.append(text) or True)
    lead, session = _lead_and_session(db)
    pasted = "Name- Rahim Uddin\nAddress- Village Road\nFather Name- Karim Uddin\nPin- 700001"
    assert _continue_introduction(db, session, lead, pasted, "8801712345678") is True
    saved = db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type == "whatsapp_unrouted_registration_details").first()
    assert saved is not None
    assert saved.message == pasted
    handoff = db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type == "whatsapp_human_handoff_requested").count()
    assert handoff == 1
