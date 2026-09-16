import sys
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import CRMLeadActivity, WhatsAppRegistrationSession
from sql_app.routers.whatsapp import update_whatsapp_settings
from sql_app.whatsapp_cloud import ingest_whatsapp_message


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
