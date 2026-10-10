import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.models import CRMLead, CRMLeadActivity, WhatsAppRegistrationSession
from sql_app.whatsapp_cloud import _continue_native_registration, _native_load, ingest_whatsapp_message
from test_abandoned_registration_reminders import make_session
from test_whatsapp_native_registration import Chat, env, payload  # noqa: F401  (env is a fixture)

PHONE = "8801712345678"
STATES = {"member": "NATIVE_REG_MEMBER", "partner": "NATIVE_REG_PARTNER", "rider": "NATIVE_REG_RIDER"}


def build(db, monkeypatch, role="member", answers=None, hours_ago=10, language=None, state=None):
    sent = []
    monkeypatch.setattr("sql_app.whatsapp_cloud._send_member_registration_reply", lambda _db, recipient, text: sent.append(text) or True)
    lead = CRMLead(lead_id="WA-resume", business_name="WhatsApp", contact_person="Returning", phone=PHONE, whatsapp_no=PHONE, source="whatsapp")
    db.add(lead)
    db.flush()
    answers = dict(answers or {})
    data = {"answers": {k: v for k, v in answers.items() if k != "pan_no"}, "nr": {"history": list(answers), "retries": 0}}
    if "pan_no" in answers:
        data["pan_no"] = answers["pan_no"]
    if language:
        data["language"] = language
    session = WhatsAppRegistrationSession(phone=PHONE, wa_id=PHONE, lead_id=lead.id, role=role, state=state or STATES[role], data_json=json.dumps(data))
    db.add(session)
    if hours_ago is not None:
        db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_received", message="WhatsApp message received [old]: x", created_at=datetime.now(timezone.utc) - timedelta(hours=hours_ago)))
    db.commit()
    return lead, session, sent


def say(db, lead, session, text, **kwargs):
    handled = _continue_native_registration(db, session, lead, text, PHONE, **kwargs)
    # ingest logs the received message after handling it
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_received", message=f"WhatsApp message received [{text}]: {text}"))
    db.commit()
    return handled


def snapshot(session):
    _data, answers, meta = _native_load(session)
    return answers, meta


@pytest.fixture
def db():
    session = make_session()
    yield session
    session.close()


MEMBER_PROGRESS = {"name": "Ayesha", "dob": "1990-01-01"}


def test_returning_customer_is_asked_to_continue_instead_of_hi_being_taken_as_an_answer(db, monkeypatch):
    lead, session, sent = build(db, monkeypatch, answers=MEMBER_PROGRESS)
    assert say(db, lead, session, "Hi")
    assert sent[-1].startswith("আপনার রেজিস্ট্রেশন জন্ম তারিখ পর্যন্ত হয়েছে, চালিয়ে যাই?")
    assert "1 বা YES = চালিয়ে যান" in sent[-1]
    answers, meta = snapshot(session)
    assert answers == MEMBER_PROGRESS
    assert meta["retries"] == 0 and meta["resume_prompt"] is True
    assert session.state == "NATIVE_REG_MEMBER"
    assert db.query(CRMLeadActivity).filter_by(lead_id=lead.id, activity_type="whatsapp_registration_resume_prompt").count() == 1


def test_yes_continues_from_the_step_where_it_stopped_not_from_the_start(db, monkeypatch):
    lead, session, sent = build(db, monkeypatch, answers=MEMBER_PROGRESS)
    say(db, lead, session, "Hi")
    sent.clear()

    say(db, lead, session, "1")
    assert "PAN" in sent[-1] and "আপনার পূর্ণ নাম" not in sent[-1]
    answers, meta = snapshot(session)
    assert answers == MEMBER_PROGRESS and "resume_prompt" not in meta

    say(db, lead, session, "ABCDE1234F")
    answers, _ = snapshot(session)
    assert answers["pan_no"] == "ABCDE1234F"
    assert "ঠিকানা" in sent[-1]


@pytest.mark.parametrize("language,expected,options", [
    ("en", "Your registration is done up to your date of birth. Shall we continue?", "1 or YES = continue"),
    ("hi", "आपका रजिस्ट्रेशन जन्म तिथि तक हो चुका है, जारी रखें?", "1 या YES = जारी रखें"),
    ("bn", "আপনার রেজিস্ট্রেশন জন্ম তারিখ পর্যন্ত হয়েছে, চালিয়ে যাই?", "1 বা YES = চালিয়ে যান"),
])
def test_prompt_uses_the_customers_language(db, monkeypatch, language, expected, options):
    lead, session, sent = build(db, monkeypatch, answers=MEMBER_PROGRESS, language=language)
    say(db, lead, session, "Hi")
    assert sent[-1].startswith(expected)
    assert options in sent[-1]


def test_partner_prompt_names_the_last_completed_partner_step(db, monkeypatch):
    lead, session, sent = build(db, monkeypatch, role="partner", answers={"business_type": "Shop", "shop_sector": "Grocery", "business_name": "Rahim Store"})
    say(db, lead, session, "hello")
    assert sent[-1].startswith("আপনার রেজিস্ট্রেশন ব্যবসার নাম পর্যন্ত হয়েছে, চালিয়ে যাই?")


def test_no_prompt_when_the_customer_is_actively_answering(db, monkeypatch):
    lead, session, sent = build(db, monkeypatch, answers=MEMBER_PROGRESS, hours_ago=0.1)
    say(db, lead, session, "ABCDE1234F")
    answers, meta = snapshot(session)
    assert answers["pan_no"] == "ABCDE1234F"
    assert "resume_prompt" not in meta
    assert "পর্যন্ত হয়েছে" not in sent[-1]


def test_threshold_is_six_hours(db, monkeypatch):
    lead, session, sent = build(db, monkeypatch, answers=MEMBER_PROGRESS, hours_ago=5.5)
    say(db, lead, session, "ABCDE1234F")
    assert "pan_no" in snapshot(session)[0]
    db2 = make_session()
    try:
        lead2, session2, sent2 = build(db2, monkeypatch, answers=MEMBER_PROGRESS, hours_ago=6.5)
        say(db2, lead2, session2, "ABCDE1234F")
        assert "pan_no" not in snapshot(session2)[0]
        assert "পর্যন্ত হয়েছে" in sent2[-1]
    finally:
        db2.close()


def test_registration_with_no_saved_answers_also_asks_instead_of_saving_hi_as_the_name(db, monkeypatch):
    lead, session, sent = build(db, monkeypatch, answers={})
    say(db, lead, session, "Hi")
    assert sent[-1].startswith("আপনার রেজিস্ট্রেশন শুরু হয়েছিল, চালিয়ে যাই?")
    assert snapshot(session)[0] == {}


def test_failed_attempts_do_not_accumulate_to_a_handoff_for_a_returning_customer(db, monkeypatch):
    lead, session, sent = build(db, monkeypatch, answers=MEMBER_PROGRESS)
    for text in ("Hi", "Hello"):
        say(db, lead, session, text)
    assert snapshot(session)[1]["retries"] == 0
    assert not db.query(CRMLeadActivity).filter_by(activity_type="whatsapp_native_registration_handoff").count()


def test_restart_and_cancel_still_work_directly_after_a_gap(db, monkeypatch):
    lead, session, sent = build(db, monkeypatch, answers=MEMBER_PROGRESS)
    say(db, lead, session, "RESTART")
    answers, meta = snapshot(session)
    assert answers == {} and "resume_prompt" not in meta
    assert "পূর্ণ নাম" in sent[-1]

    lead2, session2, sent2 = (None, None, None)
    db2 = make_session()
    try:
        lead2, session2, sent2 = build(db2, monkeypatch, answers=MEMBER_PROGRESS)
        say(db2, lead2, session2, "CANCEL")
        assert session2.state == "IDLE"
    finally:
        db2.close()


def test_no_answer_keeps_the_saved_progress_and_offers_restart(db, monkeypatch):
    lead, session, sent = build(db, monkeypatch, answers=MEMBER_PROGRESS)
    say(db, lead, session, "Hi")
    for _ in range(3):
        say(db, lead, session, "2")
        assert "RESTART" in sent[-1] and "CANCEL" in sent[-1]
    answers, meta = snapshot(session)
    assert answers == MEMBER_PROGRESS and meta["resume_prompt"] is True


def test_unrelated_reply_is_asked_once_more_then_treated_as_the_answer(db, monkeypatch):
    lead, session, sent = build(db, monkeypatch, answers=MEMBER_PROGRESS)
    say(db, lead, session, "Hi")
    say(db, lead, session, "ABCDE1234F")
    assert "পর্যন্ত হয়েছে" in sent[-1] and "pan_no" not in snapshot(session)[0]
    say(db, lead, session, "ABCDE1234F")
    assert snapshot(session)[0]["pan_no"] == "ABCDE1234F"
    assert "resume_prompt" not in snapshot(session)[1]


@pytest.mark.parametrize("text", ["continue", "চালিয়ে যান", "জারি রাখুন"])
def test_continue_quick_reply_resumes_without_a_second_question(db, monkeypatch, text):
    lead, session, sent = build(db, monkeypatch, answers=MEMBER_PROGRESS)
    say(db, lead, session, text)
    if text == "জারি রাখুন":
        assert "পর্যন্ত হয়েছে" in sent[-1]  # not a recognised quick reply: normal prompt
    else:
        assert "PAN" in sent[-1] and "পর্যন্ত হয়েছে" not in sent[-1]
        assert "resume_prompt" not in snapshot(session)[1]


def test_returning_at_final_review_never_submits_on_the_first_yes(db, monkeypatch):
    answers = {"name": "Ayesha", "dob": "1990-01-01", "pan_no": "ABCDE1234F", "address": "x", "sponsor_code": ""}
    lead, session, sent = build(db, monkeypatch, answers=answers, state="NATIVE_REG_CONFIRM")
    monkeypatch.setattr("sql_app.whatsapp_cloud._native_submit", lambda *_a, **_k: pytest.fail("registration must not be submitted by the resume confirmation"))
    say(db, lead, session, "Hi")
    assert "চূড়ান্ত যাচাই পর্যন্ত হয়েছে" in sent[-1]
    say(db, lead, session, "YES")
    assert "📋" in sent[-1]
    assert session.state == "NATIVE_REG_CONFIRM"


def test_non_text_message_after_a_gap_gets_the_prompt(db, monkeypatch):
    lead, session, sent = build(db, monkeypatch, answers=MEMBER_PROGRESS)
    say(db, lead, session, "", is_non_text=True)
    assert "পর্যন্ত হয়েছে" in sent[-1]
    assert snapshot(session)[1]["retries"] == 0


def test_end_to_end_through_ingest_returning_hello_is_not_taken_as_an_answer(env):
    db, monkeypatch = env
    chat = Chat(db, monkeypatch, "member")
    chat.session.state = "NATIVE_REG_MEMBER"
    chat.session.data_json = json.dumps({"answers": {"name": "Ayesha"}, "nr": {"history": ["name"], "retries": 0}})
    db.add(CRMLeadActivity(lead_id=chat.lead.id, activity_type="whatsapp_message_received", message="WhatsApp message received [old]: x", created_at=datetime.now(timezone.utc) - timedelta(days=2)))
    db.commit()

    reply = chat.say("Hello")
    assert reply.startswith("আপনার রেজিস্ট্রেশন নাম পর্যন্ত হয়েছে, চালিয়ে যাই?")
    assert "dob" not in json.loads(chat.session.data_json)["answers"]
    assert json.loads(chat.session.data_json)["answers"] == {"name": "Ayesha"}

    reply = chat.say("YES")
    assert "জন্ম তারিখ" in reply
    assert chat.session.state == "NATIVE_REG_MEMBER"
