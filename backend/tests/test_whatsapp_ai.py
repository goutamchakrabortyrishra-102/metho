import json
import sys
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AppSetting, CRMLead, CRMLeadActivity, CRMWhatsAppAISuggestion
from sql_app.routers.whatsapp_ai import approve_suggestion, reject_suggestion
from sql_app.whatsapp_ai import create_suggestion_for_activity, save_ai_config


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def admin():
    return SimpleNamespace(id="admin-id", role="admin")


class NoCloseSession:
    def __init__(self, session):
        self.session = session

    def __getattr__(self, name):
        return getattr(self.session, name)

    def close(self):
        pass


def install_fake_google_genai(monkeypatch, models, text="AI reply"):
    generated = []

    class FakeModels:
        @staticmethod
        def list():
            return [SimpleNamespace(name=name, supported_actions=actions) for name, actions in models]

        @staticmethod
        def generate_content(model, contents):
            generated.append((model, contents))
            return SimpleNamespace(text=text)

    class FakeClient:
        def __init__(self, **_kwargs):
            self.models = FakeModels()

    fake_genai = SimpleNamespace(Client=FakeClient)
    monkeypatch.setitem(sys.modules, "google", SimpleNamespace(genai=fake_genai))
    monkeypatch.setitem(sys.modules, "google.genai", fake_genai)
    return generated


def add_whatsapp_activity(db, text="Hello"):
    lead = CRMLead(lead_id="WA-8801712345678", business_name="WhatsApp-Ayesha", contact_person="Ayesha", phone="8801712345678", whatsapp_no="8801712345678", source="whatsapp")
    db.add(lead)
    db.flush()
    activity = CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_received", message=f"WhatsApp message received [wamid.test]: {text}")
    db.add(activity)
    db.commit()
    return lead, activity


def test_ai_suggestion_is_disabled_by_default(monkeypatch):
    db = make_session()
    try:
        _lead, activity = add_whatsapp_activity(db)
        monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", lambda: db)
        create_suggestion_for_activity(activity.id)
        assert db.query(CRMWhatsAppAISuggestion).count() == 0
    finally:
        db.close()


def test_ai_suggestion_is_idempotent_and_marks_handoff(monkeypatch):
    db = make_session()
    try:
        _lead, activity = add_whatsapp_activity(db, "I need a human agent")
        activity_id = activity.id
        save_ai_config(db, {"enabled": True})
        monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", lambda: NoCloseSession(db))
        create_suggestion_for_activity(activity_id)
        create_suggestion_for_activity(activity_id)
        suggestion = db.query(CRMWhatsAppAISuggestion).one()
        assert suggestion.human_handoff_required is True
        assert suggestion.status == "PENDING"
        assert db.query(CRMWhatsAppAISuggestion).count() == 1
    finally:
        db.close()


def test_admin_can_send_non_handoff_suggestion_and_reject_pending(monkeypatch):
    db = make_session()
    try:
        lead, activity = add_whatsapp_activity(db)
        suggestion = CRMWhatsAppAISuggestion(lead_id=lead.id, activity_id=activity.id, suggested_reply="We can help.")
        db.add(suggestion)
        db.commit()
        monkeypatch.setattr("sql_app.routers.whatsapp_ai.send_whatsapp_message", lambda *_args, **_kwargs: {"messages": [{"id": "wamid.sent"}]})
        result = approve_suggestion(suggestion.id, {}, db, admin())
        assert result["ok"] is True
        assert suggestion.status == "SENT"
        assert db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type == "whatsapp_message_sent").count() == 1

        next_activity = CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_received", message="WhatsApp message received [wamid.reject]: Later")
        db.add(next_activity)
        db.flush()
        rejected = CRMWhatsAppAISuggestion(lead_id=lead.id, activity_id=next_activity.id, suggested_reply="Later reply")
        db.add(rejected)
        db.commit()
        assert reject_suggestion(rejected.id, db, admin())["suggestion"]["status"] == "REJECTED"
    finally:
        db.close()


def test_rejecting_same_suggestion_twice_is_idempotent():
    db = make_session()
    try:
        lead, activity = add_whatsapp_activity(db)
        suggestion = CRMWhatsAppAISuggestion(lead_id=lead.id, activity_id=activity.id, suggested_reply="Later reply")
        db.add(suggestion)
        db.commit()
        first = reject_suggestion(suggestion.id, db, admin())
        second = reject_suggestion(suggestion.id, db, admin())
        assert first["suggestion"]["status"] == "REJECTED"
        assert second["already_rejected"] is True
        assert db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type == "ai_suggestion_rejected").count() == 1
    finally:
        db.close()


def test_lifecycle_event_creates_a_specific_manual_send_suggestion(monkeypatch):
    db = make_session()
    try:
        lead, _activity = add_whatsapp_activity(db)
        lifecycle = CRMLeadActivity(lead_id=lead.id, activity_type="member_activated", message="Member activated after an approved purchase")
        db.add(lifecycle)
        db.commit()
        save_ai_config(db, {"enabled": True})
        monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", lambda: NoCloseSession(db))
        create_suggestion_for_activity(lifecycle.id)
        suggestion = db.query(CRMWhatsAppAISuggestion).filter(CRMWhatsAppAISuggestion.activity_id == lifecycle.id).one()
        assert suggestion.status == "PENDING"
        assert "Smart Cycle" in suggestion.suggested_reply
    finally:
        db.close()


def test_ai_auto_send_records_reply_and_followup(monkeypatch):
    db = make_session()
    try:
        lead, activity = add_whatsapp_activity(db, "পণ্য সম্পর্কে জানতে চাই")
        sent = []
        generated = install_fake_google_genai(monkeypatch, [("models/gemini-3.6-flash", ["generateContent"])], "আপনি কোন পণ্যটি জানতে চান? নাম বা ছবি পাঠালে আমরা সঠিক তথ্য দেব।")
        save_ai_config(db, {"enabled": True, "auto_send_enabled": True, "provider": "gemini", "model": "gpt-4.1-mini", "follow_up_delay_hours": 6})
        monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", lambda: NoCloseSession(db))
        monkeypatch.setattr("sql_app.whatsapp_ai.search_web_context", lambda *_args, **_kwargs: "")
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append((recipient, text)) or {"messages": [{"id": "wamid.ai"}]})
        create_suggestion_for_activity(activity.id)
        suggestion = db.query(CRMWhatsAppAISuggestion).one()
        assert suggestion.status == "SENT"
        assert suggestion.provider_used == "gemini"
        assert suggestion.model_used == "models/gemini-3.6-flash"
        assert generated and generated[0][0] == "models/gemini-3.6-flash"
        assert sent == [("8801712345678", "আপনি কোন পণ্যটি জানতে চান? নাম বা ছবি পাঠালে আমরা সঠিক তথ্য দেব।")]
        assert db.query(CRMLeadActivity).filter(CRMLeadActivity.activity_type == "ai_suggestion_auto_sent").count() == 1
        assert lead.next_follow_up_at is not None
    finally:
        db.close()


def test_ai_auto_send_does_not_send_handoff(monkeypatch):
    db = make_session()
    try:
        _lead, activity = add_whatsapp_activity(db, "I need refund and human agent")
        sent = []
        save_ai_config(db, {"enabled": True, "auto_send_enabled": True})
        monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", lambda: NoCloseSession(db))
        monkeypatch.setattr("sql_app.whatsapp_ai._generate_reply", lambda *_args, **_kwargs: ("A team member will help.", "openai", "gpt-4.1-mini"))
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append((recipient, text)) or {"messages": [{"id": "wamid.ai"}]})
        create_suggestion_for_activity(activity.id)
        suggestion = db.query(CRMWhatsAppAISuggestion).one()
        assert suggestion.status == "PENDING"
        assert suggestion.human_handoff_required is True
        assert sent == []
    finally:
        db.close()


def test_ai_fallback_auto_sends_admin_preset(monkeypatch):
    db = make_session()
    try:
        lead, activity = add_whatsapp_activity(db, "Hello, I want more info")
        sent = []
        save_ai_config(db, {"enabled": True, "auto_send_enabled": True, "provider": "openai"})
        monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", lambda: NoCloseSession(db))
        monkeypatch.setattr("sql_app.whatsapp_ai._generate_reply", lambda *_args, **_kwargs: ("local fallback", "fallback", "local"))
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append((recipient, text)) or {"messages": [{"id": "wamid.preset"}]})
        create_suggestion_for_activity(activity.id)
        suggestion = db.query(CRMWhatsAppAISuggestion).one()
        assert suggestion.status == "SENT"
        assert suggestion.provider_used == "preset-text"
        assert sent and sent[0][0] == lead.whatsapp_no
    finally:
        db.close()


def test_ai_worker_skips_when_webhook_already_sent_a_preset(monkeypatch):
    db = make_session()
    try:
        lead, activity = add_whatsapp_activity(db, "1")
        db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_auto_reply_dispatched", message="auto-reply-for:wamid.test:text"))
        db.commit()
        save_ai_config(db, {"enabled": True, "auto_send_enabled": True})
        monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", lambda: NoCloseSession(db))
        create_suggestion_for_activity(activity.id)
        assert db.query(CRMWhatsAppAISuggestion).filter(CRMWhatsAppAISuggestion.activity_id == activity.id).count() == 0
    finally:
        db.close()


def test_saved_role_poster_takes_priority_over_stale_text_mode():
    from sql_app.whatsapp_cloud import get_configured_whatsapp_reply_mode
    db = make_session()
    try:
        update_row = db.query(AppSetting).filter(AppSetting.key == "whatsapp_cloud_integration").first()
        if update_row:
            payload = json.loads(update_row.value_json or "{}")
        else:
            payload = {}
        payload.update({"member_registration_reply_mode": "text", "member_registration_reply_image_url": "/api/files/whatsapp_posters/test.png"})
        if update_row:
            update_row.value_json = json.dumps(payload)
        else:
            db.add(AppSetting(key="whatsapp_cloud_integration", value_json=json.dumps(payload)))
        db.commit()
        assert get_configured_whatsapp_reply_mode(db, "member") == "image"
    finally:
        db.close()


def test_gemini_freeform_generation_uses_valid_configured_model(monkeypatch):
    from sql_app.whatsapp_ai import _generate_reply

    generated = install_fake_google_genai(monkeypatch, [("models/gemini-3.6-flash", ["generateContent"]), ("models/gemini-3.6-pro", ["generateContent"])])
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    reply, provider, model = _generate_reply({"system_prompt": "help", "knowledge_base": "METHO", "handoff_keywords": "", "provider": "gemini", "model": "gemini-3.6-flash"}, "Hi")
    assert (reply, provider, model) == ("AI reply", "gemini", "models/gemini-3.6-flash")
    assert generated and generated[0][0] == "models/gemini-3.6-flash"


def test_gemini_invalid_configured_model_selects_available_flash(monkeypatch):
    from sql_app.whatsapp_ai import _generate_reply

    generated = install_fake_google_genai(monkeypatch, [("models/gemini-3.6-flash", ["generateContent"])])
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    reply, provider, model = _generate_reply({"system_prompt": "help", "knowledge_base": "METHO", "handoff_keywords": "", "provider": "gemini", "model": "gpt-4.1-mini"}, "Hi")
    assert (reply, provider, model) == ("AI reply", "gemini", "models/gemini-3.6-flash")
    assert generated and generated[0][0] == "models/gemini-3.6-flash"


def test_gemini_unavailable_models_return_fallback(monkeypatch):
    from sql_app.whatsapp_ai import _generate_reply

    generated = install_fake_google_genai(monkeypatch, [("models/gemini-embedding", ["embedContent"])])
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    reply, provider, model = _generate_reply({"system_prompt": "help", "knowledge_base": "METHO", "handoff_keywords": "", "provider": "gemini", "model": "gemini-2.0-flash"}, "Hi")
    assert provider == "fallback"
    assert model == "local"
    assert "মেঠো প্রতিনিধি" in reply
    assert generated == []


def test_openai_chat_completions_generates_reply(monkeypatch):
    from sql_app.whatsapp_ai import _generate_reply

    class FakeCompletions:
        @staticmethod
        def create(**_kwargs):
            return type("Response", (), {"choices": [type("Choice", (), {"message": type("Message", (), {"content": "OpenAI reply"})()})()]})()

    class FakeClient:
        def __init__(self, **_kwargs):
            self.chat = type("Chat", (), {"completions": FakeCompletions})()

    monkeypatch.setitem(__import__("sys").modules, "openai", type("FakeOpenAI", (), {"OpenAI": FakeClient}))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    reply, provider, _model = _generate_reply({"system_prompt": "help", "knowledge_base": "METHO", "handoff_keywords": "", "provider": "openai", "model": "gpt-4.1-mini"}, "Hi")
    assert reply == "OpenAI reply"
    assert provider == "openai"


def test_openai_credit_exhaustion_falls_back_to_gemini(monkeypatch):
    from sql_app.whatsapp_ai import _generate_reply

    class FakeCompletions:
        @staticmethod
        def create(**_kwargs):
            raise RuntimeError("HTTP 429 credit_balance_exhausted")

    class FakeResponses:
        @staticmethod
        def create(**_kwargs):
            raise RuntimeError("HTTP 429 credit_balance_exhausted")

    class FakeClient:
        def __init__(self, **_kwargs):
            self.chat = SimpleNamespace(completions=FakeCompletions)
            self.responses = FakeResponses

    generated = install_fake_google_genai(monkeypatch, [("models/gemini-3.6-flash", ["generateContent"])], "Gemini reply")
    monkeypatch.setitem(sys.modules, "openai", type("FakeOpenAI", (), {"OpenAI": FakeClient}))
    monkeypatch.setenv("OPENAI_API_KEY", "openai-key")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    reply, provider, model = _generate_reply({"system_prompt": "help", "knowledge_base": "METHO", "handoff_keywords": "", "provider": "openai", "model": "gpt-4.1-mini"}, "Hi")
    assert (reply, provider, model) == ("Gemini reply", "gemini", "models/gemini-3.6-flash")
    assert generated and generated[0][0] == "models/gemini-3.6-flash"