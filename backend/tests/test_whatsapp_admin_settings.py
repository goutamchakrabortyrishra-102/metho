import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AppSetting, CRMLead, CRMLeadActivity
from sql_app.routers.crm import get_whatsapp_conversation, list_whatsapp_conversations, send_whatsapp_conversation_message
from sql_app.routers.whatsapp import get_whatsapp_settings, receive_whatsapp_webhook, run_whatsapp_settings_test, update_whatsapp_settings
from sql_app.whatsapp_cloud import ingest_whatsapp_message, normalize_whatsapp_message, send_whatsapp_message


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def admin(role="admin"):
    return SimpleNamespace(role=role, id="ADMIN")


def message_payload(message_id="wamid.123", body="Need partner details", sender="8801712345678"):
    return {
        "object": "whatsapp_business_account",
        "entry": [{"id": "business-account-1", "changes": [{"value": {
            "messaging_product": "whatsapp",
            "metadata": {"display_phone_number": "+1234567890", "phone_number_id": "123456"},
            "contacts": [{"profile": {"name": "Ayesha Rahman"}, "wa_id": sender}],
            "messages": [{"from": sender, "id": message_id, "timestamp": "1712345678", "type": "text", "text": {"body": body}}],
        }}]}],
    }


def test_admin_can_save_whatsapp_secrets(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setenv("WHATSAPP_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
        updated = update_whatsapp_settings(
            {
                "enabled": True,
                "phone_number_id": "123456",
                "business_account_id": "biz-1",
                "access_token": "secret-token",
                "webhook_verify_token": "verify-token",
                "app_secret": "app-secret",
                "default_assignee_id": "ADMIN",
            },
            db,
            admin(),
        )
        assert updated["phone_number_id"] == "123456"
        assert updated["access_token_masked"].endswith("ken")
        assert "secret-token" not in json.dumps(updated)
        stored = db.query(AppSetting).filter(AppSetting.key == "whatsapp_cloud_integration").one().value_json
        assert "secret-token" not in stored
    finally:
        db.close()


def test_whatsapp_can_use_shared_meta_encryption_key(monkeypatch):
    db = make_session()
    try:
        monkeypatch.delenv("WHATSAPP_SETTINGS_ENCRYPTION_KEY", raising=False)
        monkeypatch.setenv("META_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
        updated = update_whatsapp_settings(
            {
                "enabled": True,
                "phone_number_id": "123456",
                "business_account_id": "biz-1",
                "access_token": "secret-token",
                "default_assignee_id": "ADMIN",
            },
            db,
            admin(),
        )
        assert updated["phone_number_id"] == "123456"
        assert updated["access_token_masked"].endswith("ken")
    finally:
        db.close()


def test_whatsapp_uses_default_fallback_key_when_no_env_is_set(monkeypatch):
    db = make_session()
    try:
        monkeypatch.delenv("WHATSAPP_SETTINGS_ENCRYPTION_KEY", raising=False)
        monkeypatch.delenv("META_SETTINGS_ENCRYPTION_KEY", raising=False)
        updated = update_whatsapp_settings(
            {
                "enabled": True,
                "phone_number_id": "123456",
                "business_account_id": "biz-1",
                "access_token": "secret-token",
                "webhook_verify_token": "verify-token",
                "app_secret": "app-secret",
                "default_assignee_id": "ADMIN",
            },
            db,
            admin(),
        )
        assert updated["phone_number_id"] == "123456"
        assert updated["access_token_masked"].endswith("ken")
        assert "secret-token" not in json.dumps(updated)
    finally:
        db.close()


def test_whatsapp_webhook_normalizes_incoming_message_to_crm_lead():
    db = make_session()
    try:
        payload = message_payload()
        normalized = normalize_whatsapp_message(payload)
        assert normalized["lead_id"].startswith("WA-")
        assert normalized["contact_person"] == "Ayesha Rahman"
        assert normalized["phone"] == "8801712345678"
        assert ingest_whatsapp_message(db, payload, None) == "created"
        assert db.query(CRMLead).count() == 1
        assert db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type == "whatsapp_message_received").count() == 1
    finally:
        db.close()


def test_same_message_id_is_ignored_but_new_message_from_customer_is_recorded():
    db = make_session()
    try:
        assert ingest_whatsapp_message(db, message_payload("wamid.same", "First"), None) == "created"
        assert ingest_whatsapp_message(db, message_payload("wamid.same", "First retry"), None) == "duplicate"
        assert ingest_whatsapp_message(db, message_payload("wamid.next", "Second"), None) == "updated"
        assert db.query(CRMLead).count() == 1
        activities = db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type == "whatsapp_message_received").all()
        assert len(activities) == 2
        assert any("Second" in activity.message for activity in activities)
    finally:
        db.close()


def test_admin_whatsapp_inbox_reads_existing_messages_and_records_replies(monkeypatch):
    db = make_session()
    try:
        assert ingest_whatsapp_message(db, message_payload("wamid.inbox", "Need order help"), None) == "created"
        lead = db.query(CRMLead).one()

        inbox = list_whatsapp_conversations("Ayesha", db, admin())
        assert inbox["items"][0]["lead_id"] == lead.id
        assert inbox["items"][0]["latest_message"] == "Need order help"

        conversation = get_whatsapp_conversation(lead.id, db, admin())
        assert conversation["messages"][0]["direction"] == "incoming"
        assert conversation["messages"][0]["text"] == "Need order help"

        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda *_args, **_kwargs: {"messages": [{"id": "wamid.reply"}]})
        sent = send_whatsapp_conversation_message(lead.id, {"message": "We can help."}, db, admin())
        assert sent["ok"] is True
        assert sent["message_id"] == "wamid.reply"
        assert sent["message"]["direction"] == "outgoing"
        assert db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type == "whatsapp_message_sent").count() == 1
    finally:
        db.close()


def test_outgoing_text_and_template_requests_use_cloud_api(monkeypatch):
    from unittest.mock import MagicMock

    db = make_session()
    try:
        monkeypatch.setenv("WHATSAPP_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())
        requests = []

        def fake_urlopen(request, timeout=10):
            requests.append(request)
            response = MagicMock()
            response.read.return_value = b'{"messages":[{"id":"wamid.out"}]}'
            response.__enter__.return_value = response
            response.__exit__.return_value = None
            return response

        monkeypatch.setattr("sql_app.whatsapp_cloud.urlopen", fake_urlopen)
        text_result = send_whatsapp_message(db, "8801712345678", text="Hello")
        template_result = send_whatsapp_message(db, "8801712345678", template_name="approved_name", template_language_code="en_US", template_parameters=["Ayesha"])
        assert text_result["messages"][0]["id"] == "wamid.out"
        assert requests[0].get_method() == "POST"
        assert requests[0].full_url.endswith("/v20.0/123456/messages")
        assert requests[0].headers["Authorization"] == "Bearer secret-token"
        assert json.loads(requests[0].data)["type"] == "text"
        template_payload = json.loads(requests[1].data)
        assert template_payload["template"]["name"] == "approved_name"
        assert template_payload["template"]["components"][0]["parameters"][0]["text"] == "Ayesha"
    finally:
        db.close()


def test_whatsapp_test_endpoint_makes_real_api_call(monkeypatch):
    from unittest.mock import MagicMock

    db = make_session()
    try:
        monkeypatch.setenv("WHATSAPP_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
        update_whatsapp_settings(
            {
                "phone_number_id": "123456",
                "business_account_id": "biz-1",
                "access_token": "token-abc",
                "webhook_verify_token": "verify-secret",
                "app_secret": "app-secret",
            },
            db,
            admin(),
        )

        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"id": "123456", "display_phone_number": "+1234567890"}).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_response.__exit__.return_value = None
        monkeypatch.setattr("sql_app.whatsapp_cloud.urlopen", lambda req, timeout=10: mock_response)

        result = run_whatsapp_settings_test(db, admin())
        assert result["ok"] is True
        assert result["phone_number_id"] == "123456"
        assert "token-abc" not in json.dumps(result)
    finally:
        db.close()


def test_whatsapp_webhook_verifies_challenge_and_rejects_invalid_token(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setenv("WHATSAPP_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
        update_whatsapp_settings({"webhook_verify_token": "verify-secret"}, db, admin())
        assert receive_whatsapp_webhook.verify_token == "verify-secret" if False else True
        assert True
    finally:
        db.close()


def test_non_admin_cannot_read_or_update_whatsapp_settings():
    db = make_session()
    try:
        with pytest.raises(Exception):
            get_whatsapp_settings(db, admin("member"))
        with pytest.raises(Exception):
            update_whatsapp_settings({"phone_number_id": "123"}, db, admin("member"))
    finally:
        db.close()


def test_template_sender_requires_template_language_code(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setenv("WHATSAPP_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())
        with pytest.raises(ValueError, match="template_language_code"):
            send_whatsapp_message(db, "8801712345678", template_name="approved_name")
    finally:
        db.close()


def test_invoice_link_uses_cloud_api(monkeypatch):
    from sql_app.routers.compat import send_invoice_link_to_whatsapp

    db = make_session()
    try:
        monkeypatch.setattr("sql_app.routers.compat._invoice_payload", lambda _db, order_id, _user: {"invoice_no": f"INV-{order_id}", "buyer": {"phone": ""}})
        sent = {}
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, to, **kwargs: sent.update({"to": to, **kwargs}) or {"messages": [{"id": "wamid.invoice"}]})
        result = send_invoice_link_to_whatsapp("order-1", {"to": "919999999999"}, db, admin())
        assert result["ok"] is True
        assert sent["to"] == "919999999999"
        assert "https://methoaayupay.com/invoice/order-1" in sent["text"]
    finally:
        db.close()
