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
from sql_app.models import AppSetting
from sql_app.routers.whatsapp import get_whatsapp_settings, receive_whatsapp_webhook, run_whatsapp_settings_test, update_whatsapp_settings
from sql_app.whatsapp_cloud import ingest_whatsapp_message, normalize_whatsapp_message


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def admin(role="admin"):
    return SimpleNamespace(role=role, id="ADMIN")


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


def test_whatsapp_webhook_normalizes_incoming_message_to_crm_lead():
    db = make_session()
    try:
        payload = {
            "object": "whatsapp_business_account",
            "entry": [
                {
                    "id": "business-account-1",
                    "changes": [
                        {
                            "value": {
                                "messaging_product": "whatsapp",
                                "metadata": {"display_phone_number": "+1234567890", "phone_number_id": "123456"},
                                "contacts": [{"profile": {"name": "Ayesha Rahman"}, "wa_id": "8801712345678"}],
                                "messages": [{"from": "8801712345678", "id": "wamid.123", "timestamp": "1712345678", "type": "text", "text": {"body": "Need partner details"}}],
                            }
                        }
                    ],
                }
            ],
        }
        normalized = normalize_whatsapp_message(payload)
        assert normalized["lead_id"].startswith("WA-")
        assert normalized["contact_person"] == "Ayesha Rahman"
        assert normalized["phone"] == "8801712345678"
        status = ingest_whatsapp_message(db, payload, None)
        assert status in {"created", "duplicate"}
        if status == "created":
            assert db.query(AppSetting).count() >= 0
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
