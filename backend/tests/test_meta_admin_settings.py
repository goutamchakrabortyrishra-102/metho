import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.meta_ads import load_db_config, resolve_config
from sql_app.models import AppSetting
from sql_app.routers.settings import get_meta_settings, run_meta_settings_test, update_meta_settings


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def admin(role="admin"):
    return SimpleNamespace(role=role, id="ADMIN")


def test_admin_can_read_update_and_preserve_encrypted_meta_secrets(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setenv("META_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
        updated = update_meta_settings({"page_id": "page-1", "app_id": "app-1", "graph_api_version": "v20.0", "verify_token": "verify-secret", "app_secret": "app-secret", "access_token": "access-secret"}, db, admin())
        assert updated["page_id"] == "page-1"
        assert updated["access_token_masked"].endswith("cret")
        assert "access-secret" not in json.dumps(updated)
        preserved = update_meta_settings({"page_id": "page-2", "verify_token": "", "app_secret": "", "access_token": ""}, db, admin())
        assert preserved["page_id"] == "page-2"
        assert resolve_config(db)["access_token"] == "access-secret"
        stored = db.query(AppSetting).filter(AppSetting.key == "meta_integration").one().value_json
        assert "access-secret" not in stored
    finally:
        db.close()


def test_non_admin_cannot_read_or_update_meta_settings():
    db = make_session()
    try:
        with pytest.raises(HTTPException) as read_error:
            get_meta_settings(db, admin("member"))
        with pytest.raises(HTTPException) as update_error:
            update_meta_settings({"page_id": "page"}, db, admin("member"))
        assert read_error.value.status_code == 403
        assert update_error.value.status_code == 403
    finally:
        db.close()


def test_db_configuration_overrides_environment_and_missing_config_is_safe(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setenv("META_WEBHOOK_VERIFY_TOKEN", "env-verify")
        monkeypatch.setenv("META_APP_SECRET", "env-app")
        monkeypatch.setenv("META_ACCESS_TOKEN", "env-access")
        monkeypatch.setenv("META_PAGE_ID", "env-page")
        assert resolve_config(db)["access_token"] == "env-access"
        monkeypatch.delenv("META_PAGE_ID", raising=False)
        assert run_meta_settings_test(db, admin())["ok"] is False
        monkeypatch.setenv("META_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
        update_meta_settings({"verify_token": "db-verify", "app_secret": "db-app", "access_token": "db-access", "page_id": "db-page"}, db, admin())
        config = resolve_config(db)
        assert config["access_token"] == "db-access"
        assert config["verify_token"] == "db-verify"
        result = run_meta_settings_test(db, admin())
        assert result["ok"] is True
        assert "db-access" not in json.dumps(result)
    finally:
        db.close()


def test_secret_update_requires_encryption_key(monkeypatch):
    db = make_session()
    try:
        monkeypatch.delenv("META_SETTINGS_ENCRYPTION_KEY", raising=False)
        with pytest.raises(HTTPException, match="ENCRYPTION_KEY"):
            update_meta_settings({"access_token": "secret"}, db, admin())
    finally:
        db.close()


def test_meta_text_field_handler_accepts_field_value_contract():
    handler_source = Path(__file__).resolve().parents[2] / "src" / "pages" / "dashboard" / "SettingsPage.jsx"
    content = handler_source.read_text(encoding="utf-8")
    assert "const updateMetaField = (key) => (valueOrEvent)" in content
    assert "event.target.value" not in content[content.index("const updateMetaField"):content.index("const saveMeta")]


def test_meta_save_uses_explicit_button_event_boundary_and_put_endpoint():
    source = (Path(__file__).resolve().parents[2] / "src" / "pages" / "dashboard" / "SettingsPage.jsx").read_text(encoding="utf-8")
    assert "const handleMetaSave = (event)" in source
    assert "event.preventDefault();" in source[source.index("const handleMetaSave"):source.index("if (loading")]
    assert "event.stopPropagation();" in source[source.index("const handleMetaSave"):source.index("if (loading")]
    assert 'onClick={handleMetaSave}' in source
    assert 'api.put("/admin/settings/meta", payload)' in source


def test_meta_input_handler_normalizes_events_and_save_payload_excludes_masked_fields():
    source = (Path(__file__).resolve().parents[2] / "src" / "pages" / "dashboard" / "SettingsPage.jsx").read_text(encoding="utf-8")
    handler = source[source.index("const updateMetaField"):source.index("const testMeta")]
    assert "valueOrEvent?.target" in handler
    assert "verify_token_masked" not in handler[handler.index("const payload"):handler.index("const { data }")]
    assert "typeof metaForm[key] === \"string\"" in handler


def test_meta_save_payload_omits_empty_secrets_to_preserve_existing_values():
    source = (Path(__file__).resolve().parents[2] / "src" / "pages" / "dashboard" / "SettingsPage.jsx").read_text(encoding="utf-8")
    payload_block = source[source.index("const payload = {"):source.index("const { data }", source.index("const payload = {"))]
    assert "if (value) payload[key] = value;" in payload_block
    assert 'verify_token: ""' not in payload_block
    assert 'app_secret: ""' not in payload_block
    assert 'access_token: ""' not in payload_block
