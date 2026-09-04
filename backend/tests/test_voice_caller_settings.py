import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock
from urllib.error import HTTPError

from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AppSetting
from sql_app.routers.settings import get_voice_caller_settings, run_voice_caller_settings_test, update_voice_caller_settings
from sql_app.voice_caller import resolve_voice_config


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def admin():
    return SimpleNamespace(role="admin")


def test_voice_caller_settings_encrypt_and_mask_secrets(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setenv("META_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
        updated = update_voice_caller_settings({"enabled": True, "provider": "vapi", "caller_id": "caller-1", "bengali_voice": "bn-voice", "hindi_voice": "hi-voice", "api_key": "voice-api-secret", "api_secret": "voice-secret"}, db, admin())
        assert updated["api_key_masked"].endswith("cret")
        assert "voice-api-secret" not in json.dumps(updated)
        assert resolve_voice_config(db)["api_key"] == "voice-api-secret"
        stored = db.query(AppSetting).filter(AppSetting.key == "ai_voice_caller").one().value_json
        assert "voice-api-secret" not in stored
    finally:
        db.close()


def test_voice_caller_settings_preserve_secrets_and_validate_missing_values(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setenv("META_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
        update_voice_caller_settings({"enabled": True, "provider": "vapi", "api_key": "stored-key"}, db, admin())
        assert run_voice_caller_settings_test(db, admin())["missing"] == ["caller_id", "bengali_voice", "hindi_voice"]
        update_voice_caller_settings({"caller_id": "caller-1", "bengali_voice": "bn", "hindi_voice": "hi", "api_key": ""}, db, admin())
        assert get_voice_caller_settings(db, admin())["configured"] is True
        assert resolve_voice_config(db)["api_key"] == "stored-key"
    finally:
        db.close()


def test_mock_voice_caller_test_response_never_connects_to_provider():
    db = make_session()
    try:
        result = run_voice_caller_settings_test(db, admin())
        assert result == {"success": True, "message": "Mock provider active"}
    finally:
        db.close()


def test_dvaarik_test_validates_agent_with_bearer_key(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setenv("META_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
        update_voice_caller_settings({"enabled": True, "provider": "dvaarik", "caller_id": "agent-1", "bengali_voice": "bn", "hindi_voice": "hi", "api_key": "dvaarik-key"}, db, admin())
        response = MagicMock()
        response.status = 200
        response.__enter__.return_value = response
        response.__exit__.return_value = None
        captured = {}
        monkeypatch.setattr("sql_app.routers.settings.urlopen", lambda request, timeout: captured.update({"url": request.full_url, "authorization": request.headers["Authorization"], "timeout": timeout}) or response)
        assert run_voice_caller_settings_test(db, admin()) == {"success": True, "message": "Dvaarik API key & Agent ID validated successfully!"}
        assert captured == {"url": "https://api.dvaarik.com/v1/agents/agent-1", "authorization": "Bearer dvaarik-key", "timeout": 5}
    finally:
        db.close()


def test_dvaarik_test_maps_auth_and_missing_agent_errors(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setenv("META_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
        update_voice_caller_settings({"enabled": True, "provider": "dvaarik", "caller_id": "agent-1", "bengali_voice": "bn", "hindi_voice": "hi", "api_key": "dvaarik-key"}, db, admin())
        monkeypatch.setattr("sql_app.routers.settings.urlopen", lambda *_args, **_kwargs: (_ for _ in ()).throw(HTTPError("https://api.dvaarik.com", 401, "Unauthorized", {}, None)))
        auth_response = run_voice_caller_settings_test(db, admin())
        assert auth_response.status_code == 400
        assert json.loads(auth_response.body) == {"success": False, "message": "Dvaarik authentication failed. Invalid API Key."}
        monkeypatch.setattr("sql_app.routers.settings.urlopen", lambda *_args, **_kwargs: (_ for _ in ()).throw(HTTPError("https://api.dvaarik.com", 404, "Not found", {}, None)))
        agent_response = run_voice_caller_settings_test(db, admin())
        assert agent_response.status_code == 400
        assert json.loads(agent_response.body) == {"success": False, "message": "Dvaarik Agent ID not found. Check Caller/Provider ID."}
    finally:
        db.close()