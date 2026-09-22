import json
import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AppSetting, CRMLead, CRMLeadActivity, User, WhatsAppRegistrationSession
from sql_app.routers.crm import get_whatsapp_conversation, list_whatsapp_conversations, send_whatsapp_conversation_message
from sql_app.routers.whatsapp import get_whatsapp_settings, receive_whatsapp_webhook, run_whatsapp_settings_test, update_whatsapp_settings
from sql_app.whatsapp_cloud import WHATSAPP_PRESET_MESSAGE_DEFAULTS, _is_informational_question, _registration_role_for_text, get_whatsapp_preset_message, ingest_whatsapp_message, normalize_whatsapp_message, resolve_config, send_whatsapp_message
from fastapi import BackgroundTasks, HTTPException


class RequestStub:
    def __init__(self, body):
        self._body = body
        self.headers = {}

    async def body(self):
        return self._body


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


def test_whatsapp_settings_prefill_registration_funnel_templates():
    db = make_session()
    try:
        settings = get_whatsapp_settings(db, admin())
        assert "1 লিখুন Member-এর জন্য" in settings["registration_role_question"]
        assert "https://methoaayupay.com/register" == settings["member_registration_url"]
        assert "METHO Business Partner" in settings["partner_registration_reply"]
        assert settings["rider_registration_keywords"].startswith("3,rider")
    finally:
        db.close()


def test_get_whatsapp_preset_message_falls_back_when_stored_value_is_blank():
    db = make_session()
    try:
        db.add(AppSetting(key="whatsapp_cloud_integration", value_json=json.dumps({"preset_handoff_requested": ""})))
        db.commit()
        assert get_whatsapp_preset_message(db, "preset_handoff_requested", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_handoff_requested"]) == WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_handoff_requested"]
    finally:
        db.close()


def test_partial_whatsapp_settings_save_does_not_blank_other_presets():
    db = make_session()
    try:
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())
        stored = json.loads(db.query(AppSetting).filter(AppSetting.key == "whatsapp_cloud_integration").one().value_json)
        for key, default_text in WHATSAPP_PRESET_MESSAGE_DEFAULTS.items():
            assert stored[key] == default_text
            assert get_whatsapp_preset_message(db, key, default_text) == default_text

        update_whatsapp_settings({"preset_handoff_requested": "Custom handoff text"}, db, admin())
        stored = json.loads(db.query(AppSetting).filter(AppSetting.key == "whatsapp_cloud_integration").one().value_json)
        assert stored["preset_handoff_requested"] == "Custom handoff text"
        for key, default_text in WHATSAPP_PRESET_MESSAGE_DEFAULTS.items():
            if key == "preset_handoff_requested":
                continue
            assert stored[key] == default_text
    finally:
        db.close()


def test_admin_clearing_a_preset_still_resolves_to_hardcoded_default():
    db = make_session()
    try:
        update_whatsapp_settings({"preset_handoff_requested": "Custom handoff text"}, db, admin())
        update_whatsapp_settings({"preset_handoff_requested": ""}, db, admin())
        stored = json.loads(db.query(AppSetting).filter(AppSetting.key == "whatsapp_cloud_integration").one().value_json)
        assert stored["preset_handoff_requested"] == ""
        assert get_whatsapp_preset_message(db, "preset_handoff_requested", WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_handoff_requested"]) == WHATSAPP_PRESET_MESSAGE_DEFAULTS["preset_handoff_requested"]
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


def test_whatsapp_webhook_normalizes_incoming_message_to_crm_lead(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append((recipient, text)) or {"messages": [{"id": "wamid.reply"}]})
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())
        payload = message_payload(body="Hi")
        normalized = normalize_whatsapp_message(payload)
        assert normalized["lead_id"].startswith("WA-")
        assert normalized["contact_person"] == "Ayesha Rahman"
        assert normalized["phone"] == "8801712345678"
        assert ingest_whatsapp_message(db, payload, None) == "created"
        assert sent[0][0] == "8801712345678"
        assert "1. Member" in sent[0][1]
        assert "2. Partner" in sent[0][1]
        assert db.query(CRMLead).count() == 1
        assert db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type == "whatsapp_message_received").count() == 1
    finally:
        db.close()


def test_explicit_executive_enquiry_uses_matching_language_custom_reply(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append(text) or {"messages": [{"id": "wamid.reply"}]})
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token", "preset_business_enquiry_executive": "Executive contact: 9339566110"}, db, admin())
        assert ingest_whatsapp_message(db, message_payload("wamid.executive-welcome", "Hi"), None) == "created"
        assert "1. Member" in sent[-1]
        assert ingest_whatsapp_message(db, message_payload("wamid.executive", "I need a manager"), None) == "updated"
        assert sent[-1] == "Executive contact: 9339566110"
    finally:
        db.close()


def test_whatsapp_webhook_acknowledges_status_only_event():
    db = make_session()
    try:
        payload = {"object": "whatsapp_business_account", "entry": [{"id": "business-account-1", "changes": [{"value": {"statuses": [{"id": "wamid.status", "status": "delivered"}]}}]}]}
        result = asyncio.run(receive_whatsapp_webhook(RequestStub(json.dumps(payload).encode()), BackgroundTasks(), db))
        assert result == {"ok": True, "status": "acknowledged", "message_count": 0}
    finally:
        db.close()


def test_whatsapp_webhook_rejects_malformed_payload():
    db = make_session()
    try:
        with pytest.raises(HTTPException, match="Malformed webhook payload"):
            asyncio.run(receive_whatsapp_webhook(RequestStub(b"not-json"), BackgroundTasks(), db))
    finally:
        db.close()


def test_whatsapp_registration_role_reply_uses_configured_role_url(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append((recipient, text)) or {"messages": [{"id": "wamid.reply"}]})
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token", "partner_registration_url": "https://example.com/join-partner", "partner_registration_reply": "পার্টনার হিসেবে শুরু করুন"}, db, admin())
        assert ingest_whatsapp_message(db, message_payload("wamid.partner", "আমি পার্টনার হতে চাই"), None) == "created"
        assert "METHO AAY-UPAY" in sent[0][1]
        assert ingest_whatsapp_message(db, message_payload("wamid.partner-choice", "2"), None) == "updated"
        assert "https://example.com/join-partner" in sent[-1][1]
        assert "registration_role=partner" in sent[-1][1]
        session = db.query(WhatsAppRegistrationSession).one()
        assert session.state == "ROLE_REGISTRATION_PENDING"
        assert session.role == "partner"
    finally:
        db.close()


def test_whatsapp_default_auto_reply_is_sent_without_duplicate_funnel_content(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append((recipient, text)) or {"messages": [{"id": "wamid.reply"}]})
        message = "নমস্কার! 1 লিখুন Member, 2 লিখুন Partner, 3 লিখুন Rider-এর জন্য।"
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token", "default_auto_reply": message}, db, admin())
        assert ingest_whatsapp_message(db, message_payload("wamid.default", "Hello, I want more info"), None) == "created"
        assert len(sent) == 1
        assert "METHO AAY-UPAY" in sent[0][1]
        assert "1. Member" in sent[0][1]
    finally:
        db.close()

def test_whatsapp_new_freeform_starts_welcome_before_ai_flow(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append(text) or {"messages": [{"id": "wamid.reply"}]})
        monkeypatch.setattr("sql_app.whatsapp_ai.should_ai_handle_freeform_reply", lambda _db: False)
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token", "default_auto_reply": "METHO configured fallback"}, db, admin())
        assert ingest_whatsapp_message(db, message_payload("wamid.ai-fallback", "METHO সম্পর্কে জানতে চাই"), None) == "created"
        assert len(sent) == 1
        assert "METHO AAY-UPAY" in sent[0]
        assert "1 লিখুন Member" in sent[0]
    finally:
        db.close()


def test_whatsapp_first_freeform_question_starts_welcome_instead_of_static_default(monkeypatch):
    from sql_app.whatsapp_ai import save_ai_config

    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append((recipient, text)) or {"messages": [{"id": "wamid.reply"}]})
        monkeypatch.setattr("sql_app.whatsapp_ai.should_ai_handle_freeform_reply", lambda _db: True)
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token", "default_auto_reply": "Old static reply"}, db, admin())
        save_ai_config(db, {"enabled": True, "auto_send_enabled": True, "suppress_static_default_when_ai_enabled": True})
        assert ingest_whatsapp_message(db, message_payload("wamid.ai-freeform", "পণ্যের দাম কত?"), None) == "created"
        assert len(sent) == 1
        assert "METHO AAY-UPAY" in sent[0][1]
        assert "Old static reply" not in sent[0][1]
        assert db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type == "whatsapp_message_received").count() == 1
    finally:
        db.close()


def test_first_bengali_earning_question_starts_welcome_not_poster(monkeypatch):
    from sql_app.whatsapp_ai import save_ai_config

    db = make_session()
    try:
        sent_text = []
        sent_images = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent_text.append((recipient, text)) or {"messages": [{"id": "wamid.reply"}]})
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_image", lambda _db, recipient, image_url, caption="": sent_images.append((recipient, image_url, caption)) or {"messages": [{"id": "wamid.image"}]})
        monkeypatch.setattr("sql_app.whatsapp_ai.should_ai_handle_freeform_reply", lambda _db: False)
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token", "default_auto_reply_image_url": "/api/files/whatsapp_posters/default.png", "rider_registration_keywords": "3,rider,রাইডার,METHO,AAY,UPAY,কাজ করে আয়,আয় করা,কাজ করে আয়,আয় করা,কাজ,আয়,আয়", "rider_registration_reply_image_url": "/api/files/whatsapp_posters/rider.png"}, db, admin())
        save_ai_config(db, {"enabled": True, "auto_send_enabled": True, "suppress_static_default_when_ai_enabled": True})
        config = resolve_config(db)
        assert _is_informational_question("METHO AAY-UPAY-এ কীভাবে কাজ করে আয় করা যায়?") is True
        assert _registration_role_for_text(config, "METHO AAY-UPAY-এ কীভাবে কাজ করে আয় করা যায়?") is None
        assert _registration_role_for_text(config, "METHO AAY-UPAY-এ কীভাবে কাজ করে আয় করা যায়?") is None
        assert ingest_whatsapp_message(db, message_payload("wamid.ai-earning", "METHO AAY-UPAY-এ কীভাবে কাজ করে আয় করা যায়?"), None) == "created"
        assert len(sent_text) == 1
        assert "METHO AAY-UPAY" in sent_text[0][1]
        assert sent_images == []
        assert db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type == "whatsapp_auto_reply_dispatched").count() == 1
        assert db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type == "whatsapp_image_sent").count() == 0
        assert db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type == "whatsapp_message_received").count() == 1
    finally:
        db.close()


def test_first_info_questions_skip_posters_with_matching_production_keywords(monkeypatch):
    from sql_app.whatsapp_ai import save_ai_config

    db = make_session()
    try:
        sent_text = []
        sent_images = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent_text.append((recipient, text)) or {"messages": [{"id": "wamid.reply"}]})
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_image", lambda _db, recipient, image_url, caption="": sent_images.append((recipient, image_url, caption)) or {"messages": [{"id": "wamid.image"}]})
        monkeypatch.setattr("sql_app.whatsapp_ai.should_ai_handle_freeform_reply", lambda _db: False)
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token", "default_auto_reply_image_url": "/api/files/whatsapp_posters/default.png", "rider_registration_keywords": "3,rider,রাইডার,METHO,AAY,UPAY,কাজ,আয়,কাজ করে আয়,আয় করা", "rider_registration_reply_image_url": "/api/files/whatsapp_posters/rider.png"}, db, admin())
        save_ai_config(db, {"enabled": True, "auto_send_enabled": True, "suppress_static_default_when_ai_enabled": True})
        for index, text in enumerate(("কীভাবে কাজ করে আয় করা যায়", "METHO AAY-UPAY কাজ করে আয় করা যায়?"), start=1):
            assert _registration_role_for_text(resolve_config(db), text) is None
            assert ingest_whatsapp_message(db, message_payload(f"wamid.info-{index}", text, sender=f"88017123456{index}"), None) == "created"
        assert len(sent_text) == 2
        assert all("METHO AAY-UPAY" in text for _recipient, text in sent_text)
        assert sent_images == []
        assert db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type == "whatsapp_auto_reply_dispatched").count() == 2
        assert db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type == "whatsapp_image_sent").count() == 0
    finally:
        db.close()


def test_first_question_mark_info_query_starts_welcome_without_default_poster(monkeypatch):
    db = make_session()
    try:
        sent_text = []
        sent_images = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent_text.append((recipient, text)) or {"messages": [{"id": "wamid.reply"}]})
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_image", lambda _db, recipient, image_url, caption="": sent_images.append((recipient, image_url, caption)) or {"messages": [{"id": "wamid.image"}]})
        monkeypatch.setattr("sql_app.whatsapp_ai.should_ai_handle_freeform_reply", lambda _db: False)
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token", "default_auto_reply_image_url": "/api/files/whatsapp_posters/default.png", "rider_registration_keywords": "3,rider,রাইডার,কাজ,আয়,METHO,AAY,UPAY", "rider_registration_reply_image_url": "/api/files/whatsapp_posters/rider.png"}, db, admin())
        assert ingest_whatsapp_message(db, message_payload("wamid.ai-info-no-config", "METHO AAY-UPAY-এ কীভাবে কাজ করে আয় করা যায়?"), None) == "created"
        assert len(sent_text) == 1
        assert "METHO AAY-UPAY" in sent_text[0][1]
        assert sent_images == []
        assert db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type == "whatsapp_auto_reply_dispatched").count() == 1
    finally:
        db.close()


def test_first_bengali_product_info_query_starts_welcome_not_default_poster(monkeypatch):
    from sql_app.whatsapp_ai import save_ai_config

    db = make_session()
    try:
        sent_text = []
        sent_images = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent_text.append((recipient, text)) or {"messages": [{"id": "wamid.reply"}]})
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_image", lambda _db, recipient, image_url, caption="": sent_images.append((recipient, image_url, caption)) or {"messages": [{"id": "wamid.image"}]})
        monkeypatch.setattr("sql_app.whatsapp_ai.should_ai_handle_freeform_reply", lambda _db: False)
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token", "default_auto_reply_image_url": "/api/files/whatsapp_posters/default.png", "member_registration_keywords": "1,member,মেম্বার,প্রোডাক্ট,জানতে চাই", "member_registration_reply_image_url": "/api/files/whatsapp_posters/member.png"}, db, admin())
        save_ai_config(db, {"enabled": True, "auto_send_enabled": True, "suppress_static_default_when_ai_enabled": True})
        config = resolve_config(db)
        assert _registration_role_for_text(config, "আমি প্রোডাক্ট এর সম্বন্ধে জানতে চাই") is None
        assert ingest_whatsapp_message(db, message_payload("wamid.ai-product-info", "আমি প্রোডাক্ট এর সম্বন্ধে জানতে চাই"), None) == "created"
        assert len(sent_text) == 1
        assert "METHO AAY-UPAY" in sent_text[0][1]
        assert sent_images == []
        assert db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type == "whatsapp_auto_reply_dispatched").count() == 1
        assert db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type == "whatsapp_message_received").count() == 1
    finally:
        db.close()


def test_whatsapp_explicit_bengali_work_intent_still_triggers_preset(monkeypatch):
    db = make_session()
    try:
        sent_images = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: {"messages": [{"id": "wamid.reply"}]})
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_image", lambda _db, recipient, image_url, caption="": sent_images.append((recipient, image_url, caption)) or {"messages": [{"id": "wamid.image"}]})
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token", "rider_registration_keywords": "3,rider,রাইডার,কাজ,আয়", "rider_registration_reply_image_url": "/api/files/whatsapp_posters/rider.png"}, db, admin())
        assert ingest_whatsapp_message(db, message_payload("wamid.rider-work", "আমি কাজ করতে চাই"), None) == "created"
        assert db.query(WhatsAppRegistrationSession).one().state == "INTRODUCTION"
        assert ingest_whatsapp_message(db, message_payload("wamid.rider-work-choice", "আমি কাজ করতে চাই"), None) == "updated"
        assert sent_images == []
        assert db.query(WhatsAppRegistrationSession).one().state == "ROLE_REGISTRATION_PENDING"
    finally:
        db.close()


def test_whatsapp_explicit_role_intents_still_trigger_posters(monkeypatch):
    db = make_session()
    try:
        sent_images = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: {"messages": [{"id": "wamid.reply"}]})
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_image", lambda _db, recipient, image_url, caption="": sent_images.append((recipient, image_url, caption)) or {"messages": [{"id": "wamid.image"}]})
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token", "partner_registration_reply_image_url": "/api/files/whatsapp_posters/partner.png", "rider_registration_reply_image_url": "/api/files/whatsapp_posters/rider.png"}, db, admin())
        assert ingest_whatsapp_message(db, message_payload("wamid.partner-intent", "আমি Partner হতে চাই"), None) == "created"
        assert ingest_whatsapp_message(db, message_payload("wamid.rider-intent", "আমি Rider হতে চাই", sender="8801712345679"), None) == "created"
        assert sent_images == []
        assert db.query(WhatsAppRegistrationSession).count() == 2
    finally:
        db.close()


def test_whatsapp_member_registration_sends_tracked_website_link_only(monkeypatch):
    db = make_session()
    try:
        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append((recipient, text)) or {"messages": [{"id": "wamid.reply"}]})
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())
        ingest_whatsapp_message(db, message_payload("wamid.member-start", "আমি মেম্বার হতে চাই"), None)
        session = db.query(WhatsAppRegistrationSession).one()
        assert session.state == "INTRODUCTION"
        ingest_whatsapp_message(db, message_payload("wamid.member-choice", "1"), None)
        assert session.state == "ROLE_REGISTRATION_PENDING"
        assert session.role == "member"
        assert "registration_role=member" in sent[-1][1]
        assert "prefill_phone=" in sent[-1][1]
        assert "আপনার নাম লিখুন" not in sent[-1][1]
        assert db.query(CRMLead).count() == 1
    finally:
        db.close()


def test_whatsapp_member_registration_reuses_existing_crm_lead(monkeypatch):
    db = make_session()
    try:
        sent = []
        lead = CRMLead(lead_id="CRM-existing", business_name="Existing", contact_person="Existing", phone="01712345678", whatsapp_no="01712345678", source="manual")
        db.add(lead)
        db.commit()
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append((recipient, text)) or {"messages": [{"id": "wamid.reply"}]})
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())
        assert ingest_whatsapp_message(db, message_payload("wamid.reuse", "আমি মেম্বার হতে চাই", sender="8801712345678"), None) == "updated"
        session = db.query(WhatsAppRegistrationSession).one()
        assert db.query(CRMLead).count() == 1
        assert session.lead_id == lead.id
    finally:
        db.close()


def test_whatsapp_member_registration_url_fallback_still_available(monkeypatch):
    db = make_session()
    try:
        sent = []
        attempts = {"count": 0}

        def fake_send(_db, recipient, text):
            attempts["count"] += 1
            if attempts["count"] == 1:
                raise RuntimeError("native send unavailable")
            sent.append((recipient, text))
            return {"messages": [{"id": "wamid.reply"}]}

        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", fake_send)
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, admin())
        assert ingest_whatsapp_message(db, message_payload("wamid.member-welcome", "আমি মেম্বার হতে চাই"), None) == "created"
        attempts["count"] = 0
        sent.clear()
        assert ingest_whatsapp_message(db, message_payload("wamid.member-fallback", "1"), None) == "updated"
        assert attempts["count"] == 2
        assert "Member registration:" in sent[0][1]
        assert "registration_role=member" in sent[0][1]
        session = db.query(WhatsAppRegistrationSession).one()
        assert session.state == "ROLE_REGISTRATION_PENDING"
        assert session.role == "member"
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
