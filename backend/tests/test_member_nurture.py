import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.member_nurture import process_member_nurture
from sql_app.models import AppSetting, CRMFollowUp, CRMLead, CRMLeadActivity, PublicOrder, User, UserReferral, WhatsAppMessageOutbox
from sql_app.whatsapp_ai import process_birthday_reminders, process_due_followups
from sql_app.whatsapp_cloud import ingest_whatsapp_message, is_scheduled_optout
from test_whatsapp_native_registration import payload

ACTIVATED = datetime(2026, 11, 1, 6, 0, tzinfo=timezone.utc)
PHONE = "919876543210"
USER_ID = "MAU20001"


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


class NoCloseSession:
    def __init__(self, db):
        self.db = db

    def __call__(self):
        return self.db


@pytest.fixture
def env(monkeypatch):
    db = make_session()
    db.add(User(id=USER_ID, name="Rahul Das", email=USER_ID, phone="9876543210", password="x", role="member", is_active=True))
    db.add(AppSetting(key=f"member_purchase_activation:{USER_ID}", value_json=json.dumps({"active": True, "activated_at": ACTIVATED.isoformat()})))
    lead = CRMLead(lead_id="WA-1", business_name="WhatsApp", contact_person="Rahul Das", phone=PHONE, whatsapp_no=PHONE, source="whatsapp", member_user_id=USER_ID)
    db.add(lead)
    db.commit()
    yield db, lead, monkeypatch
    db.close()


def at(days):
    return ACTIVATED + timedelta(days=days)


def inbound(db, lead, when):
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_received", message="hi", created_at=when))
    db.commit()


def run(db, lead, days, window=True):
    now = at(days)
    if window:
        inbound(db, lead, now - timedelta(hours=1))
    return process_member_nurture(db=db, now=now)


def sent(db):
    rows = db.query(WhatsAppMessageOutbox).filter_by(activity_type="member_nurture_sent").all()
    return {row.dedupe_key.split(f"member-nurture:{USER_ID}:")[1]: row.message for row in rows}


def add_referral(db, when):
    other = User(name="Friend", email=f"f{when.timestamp()}", phone=str(when.timestamp())[:10], password="x", role="member", is_active=False)
    db.add(other)
    db.flush()
    db.add(UserReferral(user_id=other.id, sponsor_user_id=USER_ID, sponsor_code=USER_ID, created_at=when))
    db.commit()


def add_repurchase(db, when):
    db.add(PublicOrder(customer_user_id=USER_ID, payment_method="razorpay", payer_name="M", items_json="[]", total_amount=100, status="paid", created_at=when))
    db.commit()


def test_full_cadence_for_a_quiet_member_then_recurring_monthly(env):
    db, lead, _ = env
    assert run(db, lead, 2) == 0
    assert run(db, lead, 3) == 1
    assert run(db, lead, 3) == 0
    assert "referral link" in sent(db)["day3"] or "referral" in sent(db)["day3"]
    assert "?ref=" in sent(db)["day3"] or "ref=" in sent(db)["day3"]
    assert run(db, lead, 7) == 1
    assert "Referral: 0" in sent(db)["day7"] and "Slot 2/5" in sent(db)["day7"]
    assert run(db, lead, 14) == 1
    assert "দ্বিধা" in sent(db)["day14"]
    assert run(db, lead, 21) == 1
    assert "purchase" in sent(db)["day21"]
    assert run(db, lead, 40) == 0
    assert run(db, lead, 51) == 1
    assert run(db, lead, 82) == 1
    monthly = [key for key in sent(db) if key.startswith("monthly:")]
    assert len(monthly) == 2


def test_only_the_latest_due_stage_is_sent_after_downtime(env):
    db, lead, _ = env
    assert run(db, lead, 15) == 1
    assert set(sent(db)) == {"day14"}
    state = json.loads(db.query(AppSetting).filter_by(key=f"member_nurture:{USER_ID}").one().value_json)
    assert state["stages"]["day3"] == "skipped_missed" and state["stages"]["day7"] == "skipped_missed"


def test_stale_stage_expires_instead_of_sending_late(env):
    db, lead, _ = env
    run(db, lead, 2)
    assert run(db, lead, 33) == 1
    assert [key.split(":")[0] for key in sent(db)] == ["monthly"]
    state = json.loads(db.query(AppSetting).filter_by(key=f"member_nurture:{USER_ID}").one().value_json)
    assert state["stages"]["day21"] == "skipped_expired"


def test_recently_active_member_only_gets_the_light_monthly_message(env):
    db, lead, _ = env
    add_referral(db, at(1))
    for days in (3, 7, 14, 21):
        assert run(db, lead, days) == 0
    assert run(db, lead, 31) == 1
    key, message = next(iter(sent(db).items()))
    assert key.startswith("monthly_light:") and "চমৎকার" in message


def test_recent_repurchase_also_counts_as_activity(env):
    db, lead, _ = env
    add_repurchase(db, at(2))
    for days in (3, 7, 14, 21):
        assert run(db, lead, days) == 0
    assert run(db, lead, 31) == 1
    assert next(iter(sent(db))).startswith("monthly_light:")


def test_the_activation_order_itself_does_not_count_as_activity(env):
    db, lead, _ = env
    add_repurchase(db, ACTIVATED - timedelta(hours=2))
    assert run(db, lead, 3) == 1


def test_day14_is_skipped_when_old_referral_progress_exists(env):
    db, lead, _ = env
    add_referral(db, at(-60))
    run(db, lead, 3)
    run(db, lead, 7)
    assert run(db, lead, 14) == 0
    assert "day14" not in sent(db)
    assert run(db, lead, 21) == 1


def test_legacy_member_gets_no_burst_and_first_monthly_after_30_days(env):
    db, lead, _ = env
    assert run(db, lead, 100) == 0
    assert run(db, lead, 120) == 0
    assert run(db, lead, 131) == 1
    assert next(iter(sent(db))).startswith("monthly:")


def test_outside_window_without_template_logs_needs_template_and_waits(env):
    db, lead, _ = env
    assert run(db, lead, 3, window=False) == 0
    assert run(db, lead, 3, window=False) == 0
    assert sent(db) == {}
    assert db.query(CRMLeadActivity).filter_by(lead_id=lead.id, activity_type="member_nurture_needs_template").count() == 1
    assert run(db, lead, 3, window=True) == 1
    assert "day3" in sent(db)


def test_outside_window_with_configured_template_sends_template_not_text(env):
    db, lead, monkeypatch = env
    db.add(AppSetting(key="member_nurture_template_day3", value_json=json.dumps("metho_day3")))
    db.add(AppSetting(key="member_nurture_template_language", value_json=json.dumps("en_US")))
    db.commit()
    calls = []
    monkeypatch.setattr("sql_app.member_nurture.send_whatsapp_message", lambda _db, recipient, **kwargs: calls.append((recipient, kwargs)) or {"ok": True})
    assert run(db, lead, 3, window=False) == 1
    assert calls == [(PHONE, {"template_name": "metho_day3", "template_language_code": "en_US", "template_parameters": ["Rahul"]})]
    assert sent(db) == {}


def test_failed_template_send_is_retried_later_not_every_run(env):
    db, lead, monkeypatch = env
    db.add(AppSetting(key="member_nurture_template_day3", value_json=json.dumps("metho_day3")))
    db.commit()

    def boom(*args, **kwargs):
        raise RuntimeError("template rejected")

    monkeypatch.setattr("sql_app.member_nurture.send_whatsapp_message", boom)
    assert run(db, lead, 3, window=False) == 0
    assert db.query(CRMLeadActivity).filter_by(activity_type="member_nurture_send_failed").count() == 1
    assert process_member_nurture(db=db, now=at(3) + timedelta(minutes=10)) == 0
    assert db.query(CRMLeadActivity).filter_by(activity_type="member_nurture_send_failed").count() == 1


def test_stop_keyword_sets_a_persistent_optout_that_halts_every_scheduled_send(env):
    db, lead, monkeypatch = env
    replies = []
    monkeypatch.setattr("sql_app.whatsapp_cloud._send_member_registration_reply", lambda _db, recipient, text: replies.append(text) or True)
    ingest_whatsapp_message(db, payload("STOP"), None)
    assert is_scheduled_optout(db, lead.id)
    assert "scheduled" in replies[-1]
    assert run(db, lead, 3) == 0
    assert sent(db) == {}

    monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", NoCloseSession(db))
    followup = CRMFollowUp(lead_id=lead.id, scheduled_at=datetime.now(timezone.utc) - timedelta(days=1), status="Pending", notes="Follow-up for WhatsApp Cloud lead")
    db.add(followup)
    db.commit()
    followup_id = followup.id
    assert process_due_followups() == 0
    assert db.query(CRMFollowUp).filter_by(id=followup_id).one().status == "Cancelled"


def test_old_repeating_repurchase_reminder_is_replaced_by_the_nurture_sequence(env):
    db, lead, monkeypatch = env
    monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", NoCloseSession(db))
    db.add(CRMFollowUp(lead_id=lead.id, scheduled_at=datetime.now(timezone.utc) - timedelta(days=1), status="Pending", notes="Explain Smart Cycle start, reward rules, product education, and next product purchase"))
    db.commit()
    assert process_due_followups() == 0
    assert db.query(CRMFollowUp).one().status == "Cancelled"
    assert db.query(WhatsAppMessageOutbox).count() == 0


def test_kill_switch_disables_the_sequence(env):
    db, lead, _ = env
    db.add(AppSetting(key="member_nurture_enabled", value_json=json.dumps(False)))
    db.commit()
    assert run(db, lead, 3) == 0
    assert sent(db) == {}


def test_inactive_or_unlinked_members_are_ignored(env):
    db, lead, _ = env
    db.query(User).filter_by(id=USER_ID).one().is_active = False
    db.commit()
    assert run(db, lead, 3) == 0
