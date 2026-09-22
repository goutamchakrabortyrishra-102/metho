import sys
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.whatsapp_cloud import _generate_welcome_message


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_generate_welcome_message_fallback_is_hindi_when_ai_reply_invalid(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setattr("sql_app.whatsapp_ai._generate_reply", lambda *_a, **_k: ("", "fallback", "local"))
        reply = _generate_welcome_message(db, None, "911234567890", language="hi")
        assert "आपका स्वागत है" in reply
        assert "Rider के लिए" in reply
        assert "স্বাগতম" not in reply
    finally:
        db.close()


def test_generate_welcome_message_fallback_is_english_when_ai_reply_invalid(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setattr("sql_app.whatsapp_ai._generate_reply", lambda *_a, **_k: ("", "fallback", "local"))
        reply = _generate_welcome_message(db, None, "911234567890", language="en")
        assert "Welcome to METHO AAY-UPAY" in reply
        assert "1 for Member" in reply
        assert "স্বাগতম" not in reply
    finally:
        db.close()


def test_generate_welcome_message_fallback_is_bangla_by_default(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setattr("sql_app.whatsapp_ai._generate_reply", lambda *_a, **_k: ("", "fallback", "local"))
        reply = _generate_welcome_message(db, None, "8801712345678", language="bn")
        assert "স্বাগতম" in reply
        assert "1 লিখুন Member" in reply
    finally:
        db.close()


def test_generate_welcome_message_appends_localized_menu_when_ai_reply_succeeds(monkeypatch):
    db = make_session()
    try:
        monkeypatch.setattr("sql_app.whatsapp_ai._generate_reply", lambda *_a, **_k: ("Welcome to METHO! Here is more info.", "gemini", "gemini-1.5-flash"))
        reply = _generate_welcome_message(db, None, "911234567890", language="hi")
        assert "Rider के लिए" in reply
        assert "1. Member" in reply
    finally:
        db.close()
