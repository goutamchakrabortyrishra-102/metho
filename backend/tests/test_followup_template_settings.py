import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.followup_scheduler import TEMPLATE_LANGUAGE_KEY, TEMPLATE_NAME_KEY, _setting_text
from sql_app.models import AppSetting
from sql_app.routers.whatsapp import get_whatsapp_settings, update_whatsapp_settings
from test_abandoned_registration_reminders import make_session

ADMIN = SimpleNamespace(role="admin", id="ADMIN")
SETTINGS_PAGE = Path(__file__).resolve().parents[2] / "src" / "pages" / "dashboard" / "SettingsPage.jsx"


def test_fields_default_to_empty_in_settings_response():
    db = make_session()
    try:
        data = get_whatsapp_settings(db, ADMIN)
        assert data[TEMPLATE_NAME_KEY] == ""
        assert data[TEMPLATE_LANGUAGE_KEY] == ""
    finally:
        db.close()


def test_save_persists_and_survives_reload_and_is_what_the_scheduler_reads():
    db = make_session()
    try:
        saved = update_whatsapp_settings({TEMPLATE_NAME_KEY: "  metho_followup_v1 ", TEMPLATE_LANGUAGE_KEY: "en_US"}, db, ADMIN)
        assert saved[TEMPLATE_NAME_KEY] == "metho_followup_v1"
        assert saved[TEMPLATE_LANGUAGE_KEY] == "en_US"

        db.expire_all()
        reloaded = get_whatsapp_settings(db, ADMIN)
        assert reloaded[TEMPLATE_NAME_KEY] == "metho_followup_v1"
        assert reloaded[TEMPLATE_LANGUAGE_KEY] == "en_US"
        assert _setting_text(db, TEMPLATE_NAME_KEY, "") == "metho_followup_v1"
        assert _setting_text(db, TEMPLATE_LANGUAGE_KEY, "") == "en_US"
        assert json.loads(db.query(AppSetting).filter_by(key=TEMPLATE_NAME_KEY).one().value_json) == "metho_followup_v1"
    finally:
        db.close()


def test_update_overwrites_existing_value_without_duplicate_rows():
    db = make_session()
    try:
        update_whatsapp_settings({TEMPLATE_NAME_KEY: "one", TEMPLATE_LANGUAGE_KEY: "en"}, db, ADMIN)
        update_whatsapp_settings({TEMPLATE_NAME_KEY: "two"}, db, ADMIN)
        assert db.query(AppSetting).filter_by(key=TEMPLATE_NAME_KEY).count() == 1
        data = get_whatsapp_settings(db, ADMIN)
        assert data[TEMPLATE_NAME_KEY] == "two"
        assert data[TEMPLATE_LANGUAGE_KEY] == "en"
    finally:
        db.close()


def test_saving_other_settings_does_not_wipe_template_values():
    db = make_session()
    try:
        update_whatsapp_settings({TEMPLATE_NAME_KEY: "keep_me", TEMPLATE_LANGUAGE_KEY: "en_US"}, db, ADMIN)
        data = update_whatsapp_settings({"customer_call_number": "9339566110"}, db, ADMIN)
        assert data[TEMPLATE_NAME_KEY] == "keep_me"
        assert data[TEMPLATE_LANGUAGE_KEY] == "en_US"
    finally:
        db.close()


def test_blank_value_clears_the_setting():
    db = make_session()
    try:
        update_whatsapp_settings({TEMPLATE_NAME_KEY: "x", TEMPLATE_LANGUAGE_KEY: "en"}, db, ADMIN)
        data = update_whatsapp_settings({TEMPLATE_NAME_KEY: "   "}, db, ADMIN)
        assert data[TEMPLATE_NAME_KEY] == ""
        assert data[TEMPLATE_LANGUAGE_KEY] == "en"
        assert db.query(AppSetting).filter_by(key=TEMPLATE_NAME_KEY).count() == 0
    finally:
        db.close()


def test_non_admin_cannot_change_the_template_settings():
    from fastapi import HTTPException

    db = make_session()
    try:
        with pytest.raises(HTTPException) as error:
            update_whatsapp_settings({TEMPLATE_NAME_KEY: "x"}, db, SimpleNamespace(role="member", id="U"))
        assert error.value.status_code == 403
        assert db.query(AppSetting).filter_by(key=TEMPLATE_NAME_KEY).count() == 0
    finally:
        db.close()


def test_settings_page_has_both_fields_and_sends_them_on_save():
    source = SETTINGS_PAGE.read_text(encoding="utf-8")
    for key, test_id in ((TEMPLATE_NAME_KEY, "settings-whatsapp-followup-template-name"), (TEMPLATE_LANGUAGE_KEY, "settings-whatsapp-followup-template-language")):
        assert f'testId="{test_id}"' in source
        assert f'value={{whatsappForm.{key} || ""}}' in source
        assert f'onChange={{updateWhatsappField("{key}")}}' in source
        assert f'{key}: String(whatsappForm.{key} || "").trim()' in source
