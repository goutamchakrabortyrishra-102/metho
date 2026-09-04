import json
import sys
from io import BytesIO
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

PROFILE = {
    "test_endpoint_url": "https://api.voice-provider.example/v1/agents",
    "test_http_method": "GET",
    "auth_type": "bearer_token",
    "auth_header_name": "Authorization",
    "agent_list_path": "data.agents",
    "agent_id_field": "id",
    "agent_name_field": "name",
}


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
        updated = update_voice_caller_settings({"enabled": True, "provider": "vapi", "caller_id": "caller-1", "bengali_voice": "bn-voice", "hindi_voice": "hi-voice", "api_key": "voice-api-secret", "api_secret": "voice-secret", **PROFILE}, db, admin())
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
        update_voice_caller_settings({"enabled": True, "provider": "vapi", "api_key": "stored-key", **PROFILE}, db, admin())
        incomplete = run_voice_caller_settings_test(db, admin())
        assert incomplete["missing"] == ["caller_id", "bengali_voice", "hindi_voice"]
        assert incomplete["message"] == "AI voice configuration is incomplete: caller_id, bengali_voice, hindi_voice."
        update_voice_caller_settings({"caller_id": "caller-1", "bengali_voice": "bn", "hindi_voice": "hi", "api_key": "", **PROFILE}, db, admin())
        assert get_voice_caller_settings(db, admin())["configured"] is True
        assert resolve_voice_config(db)["api_key"] == "stored-key"
    finally:
        db.close()


def test_voice_caller_settings_allow_empty_or_na_api_secret(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setenv("META_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
        update_voice_caller_settings({"enabled": True, "provider": "any-provider", "caller_id": "agent-1", "bengali_voice": "bn", "hindi_voice": "hi", "api_key": "provider-key", "api_secret": "na", **PROFILE}, db, admin())
        assert resolve_voice_config(db)["api_secret"] == "na"

        update_voice_caller_settings({"api_secret": "", **PROFILE}, db, admin())
        assert resolve_voice_config(db)["api_secret"] == "na"
    finally:
        db.close()


def test_mock_voice_caller_test_response_never_connects_to_provider():
    db = make_session()
    try:
        result = run_voice_caller_settings_test(db, admin())
        assert result == {"success": True, "message": "Mock provider active"}
    finally:
        db.close()


def test_provider_test_uses_dynamic_bearer_profile(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setenv("META_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
        update_voice_caller_settings({"enabled": True, "provider": "any-provider", "caller_id": "agent-1", "bengali_voice": "bn", "hindi_voice": "hi", "api_key": "provider-key", **PROFILE}, db, admin())
        response = MagicMock()
        response.status = 200
        response.read.return_value = b'{"data": {"agents": [{"id": "agent-1", "name": "Agent One"}]}}'
        response.__enter__.return_value = response
        response.__exit__.return_value = None
        captured = {}
        monkeypatch.setattr("sql_app.routers.settings.urlopen", lambda request, timeout: captured.update({"url": request.full_url, "authorization": request.headers["Authorization"], "timeout": timeout}) or response)
        assert run_voice_caller_settings_test(db, admin()) == {"success": True, "message": "Connection Successful & Agent Verified"}
        assert captured == {"url": "https://api.voice-provider.example/v1/agents", "authorization": "Bearer provider-key", "timeout": 10}
    finally:
        db.close()


def test_provider_test_matches_name_and_reports_missing_agent(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setenv("META_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
        update_voice_caller_settings({"enabled": True, "provider": "any-provider", "caller_id": "agent-1", "bengali_voice": "bn", "hindi_voice": "hi", "api_key": "provider-key", **PROFILE}, db, admin())
        response = MagicMock()
        response.status = 200
        response.read.return_value = b'{"data": {"agents": [{"id": "other-agent", "name": "agent-1"}]}}'
        response.__enter__.return_value = response
        response.__exit__.return_value = None
        monkeypatch.setattr("sql_app.routers.settings.urlopen", lambda *_args, **_kwargs: response)
        assert run_voice_caller_settings_test(db, admin()) == {"success": True, "message": "Connection Successful & Agent Verified"}

        response.read.return_value = b'{"data": {"agents": [{"id": "other-agent", "name": "Other Agent"}]}}'
        assert run_voice_caller_settings_test(db, admin()) == {"success": False, "message": "Connected to provider, but the configured caller ID/name was not found."}
    finally:
        db.close()


def test_provider_test_supports_custom_header_and_query_parameter_authentication(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setenv("META_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
        response = MagicMock()
        response.status = 200
        response.read.return_value = b'{"data": {"agents": [{"id": "agent-1"}]}}'
        response.__enter__.return_value = response
        response.__exit__.return_value = None
        captured = []
        monkeypatch.setattr("sql_app.routers.settings.urlopen", lambda request, timeout: captured.append(request) or response)
        update_voice_caller_settings({"enabled": True, "provider": "any-provider", "caller_id": "agent-1", "bengali_voice": "bn", "hindi_voice": "hi", "api_key": "provider-key", **PROFILE, "auth_type": "custom_header", "auth_header_name": "x-api-key"}, db, admin())
        assert run_voice_caller_settings_test(db, admin())["success"] is True
        assert captured[-1].headers["X-api-key"] == "provider-key"

        update_voice_caller_settings({**PROFILE, "auth_type": "api_key_query_param", "auth_header_name": "api_key"}, db, admin())
        assert run_voice_caller_settings_test(db, admin())["success"] is True
        assert captured[-1].full_url == "https://api.voice-provider.example/v1/agents?api_key=provider-key"
    finally:
        db.close()


def test_provider_test_returns_exact_http_failure_details(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setenv("META_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
        update_voice_caller_settings({"enabled": True, "provider": "any-provider", "caller_id": "agent-1", "bengali_voice": "bn", "hindi_voice": "hi", "api_key": "provider-key", **PROFILE}, db, admin())
        monkeypatch.setattr("sql_app.routers.settings.urlopen", lambda *_args, **_kwargs: (_ for _ in ()).throw(HTTPError("https://api.voice-provider.example", 401, "Unauthorized", {}, BytesIO(b'{"detail":"Invalid API key"}'))))
        auth_response = run_voice_caller_settings_test(db, admin())
        assert auth_response.status_code == 400
        assert json.loads(auth_response.body) == {"success": False, "message": "Provider connection failed: HTTP 401 - {\"detail\":\"Invalid API key\"}"}

        monkeypatch.setattr("sql_app.routers.settings.urlopen", lambda *_args, **_kwargs: (_ for _ in ()).throw(HTTPError("https://api.voice-provider.example", 403, "Forbidden", {}, BytesIO(b"Access denied"))))
        forbidden_response = run_voice_caller_settings_test(db, admin())
        assert forbidden_response.status_code == 400
        assert json.loads(forbidden_response.body) == {"success": False, "message": "Provider connection failed: HTTP 403 - Access denied"}
    finally:
        db.close()


def test_thinnestai_key_allows_unavailable_agent_list_route(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setenv("META_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
        config = {"enabled": True, "provider": "thinnestai", "caller_id": "agent-1", "bengali_voice": "bn", "hindi_voice": "hi", "api_key": "ta_live_provider-key", **PROFILE}
        update_voice_caller_settings(config, db, admin())
        monkeypatch.setattr("sql_app.routers.settings.urlopen", lambda *_args, **_kwargs: (_ for _ in ()).throw(HTTPError("https://api.voice-provider.example", 404, "Not Found", {}, BytesIO(b"Route not found"))))
        assert run_voice_caller_settings_test(db, admin()) == {"success": True, "message": "Configuration saved and API Key validated successfully."}

        update_voice_caller_settings({"test_endpoint_url": "", **PROFILE}, db, admin())
        assert run_voice_caller_settings_test(db, admin()) == {"success": True, "message": "Configuration saved and API Key validated successfully."}
    finally:
        db.close()


def test_provider_test_returns_network_error_details(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setenv("META_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
        update_voice_caller_settings({"enabled": True, "provider": "any-provider", "caller_id": "agent-1", "bengali_voice": "bn", "hindi_voice": "hi", "api_key": "provider-key", **PROFILE}, db, admin())
        monkeypatch.setattr("sql_app.routers.settings.urlopen", lambda *_args, **_kwargs: (_ for _ in ()).throw(ConnectionError("Connection timed out")))
        response = run_voice_caller_settings_test(db, admin())
        assert response.status_code == 500
        assert json.loads(response.body) == {"success": False, "message": "Network Error: Connection timed out"}
    finally:
        db.close()