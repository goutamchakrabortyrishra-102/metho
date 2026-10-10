import importlib.util
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy.exc import OperationalError

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from sql_app.models import CRMLead, CRMLeadActivity, WhatsAppRegistrationSession
from sql_app.registration_progress import registration_progress, step_label
from test_abandoned_registration_reminders import make_session

spec = importlib.util.spec_from_file_location("registration_funnel_report", BACKEND / "tools" / "registration_funnel_report.py")
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)

NOW = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)


def add_lead(db, number, state=None, role="", answers=None, history=None, ago_hours=None, source="whatsapp", status="NEW", completed=False, **ids):
    lead = CRMLead(lead_id=f"WA-{number}", business_name="WhatsApp", contact_person=f"Lead {number}", phone=f"88017{number:07d}", whatsapp_no=f"88017{number:07d}", source=source, status=status, **ids)
    db.add(lead)
    db.flush()
    if state:
        data = {"answers": answers or {}, "nr": {"history": history if history is not None else list((answers or {}).keys()), "retries": 0}}
        db.add(WhatsAppRegistrationSession(phone=lead.phone, wa_id=lead.phone, lead_id=lead.id, role=role, state=state, data_json=json.dumps(data), completed_at=NOW if completed else None))
    if ago_hours is not None:
        db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_received", message="WhatsApp message received [m]: x", created_at=NOW - timedelta(hours=ago_hours)))
    db.commit()
    return lead


def mark(db, lead, *types):
    for activity_type in types:
        db.add(CRMLeadActivity(lead_id=lead.id, activity_type=activity_type, message="x", created_at=NOW - timedelta(days=9)))
    db.commit()


@pytest.fixture
def db():
    session = make_session()
    yield session
    session.close()


def seed(db):
    welcome = add_lead(db, 1, "INTRODUCTION", ago_hours=30)
    mark(db, welcome, "whatsapp_introduction_started")
    link = add_lead(db, 2, "ROLE_REGISTRATION_PENDING", role="member", ago_hours=3)
    mark(db, link, "whatsapp_introduction_started", "whatsapp_role_selected")
    dob = add_lead(db, 3, "NATIVE_REG_MEMBER", "member", {"name": "A"}, ago_hours=5, status="APPLICATION")
    mark(db, dob, "whatsapp_introduction_started", "whatsapp_role_selected", "whatsapp_native_registration_started")
    address = add_lead(db, 4, "NATIVE_REG_MEMBER", "member", {"name": "A", "dob": "1990-01-01", "pan_no": "ABCDE1234F"}, ago_hours=48, status="APPLICATION")
    mark(db, address, "whatsapp_introduction_started", "whatsapp_role_selected", "whatsapp_native_registration_started")
    confirm = add_lead(db, 5, "NATIVE_REG_CONFIRM", "member", {"name": "A", "dob": "1990-01-01", "pan_no": "ABCDE1234F", "address": "x", "sponsor_code": ""}, ago_hours=200, status="APPLICATION")
    mark(db, confirm, "whatsapp_introduction_started", "whatsapp_role_selected", "whatsapp_native_registration_started")
    partner = add_lead(db, 6, "NATIVE_REG_PARTNER", "partner", {}, ago_hours=0.5, status="APPLICATION")
    mark(db, partner, "whatsapp_introduction_started", "whatsapp_role_selected", "whatsapp_native_registration_started")
    done = add_lead(db, 7, "MEMBER_ACTIVATION_PENDING", "member", {}, ago_hours=1, status="APPLICATION", completed=True)
    mark(db, done, "whatsapp_introduction_started", "whatsapp_role_selected", "whatsapp_native_registration_started")
    add_lead(db, 8, None, ago_hours=2, partner_request_id="PR-1", status="APPLICATION")
    add_lead(db, 9, "NATIVE_REG_MEMBER", "member", {}, ago_hours=1, source="facebook")
    return db


def test_funnel_counts_by_stage(db):
    report = tool.build_funnel(seed(db), NOW)
    funnel = report["funnel"]
    assert funnel == {"total_leads": 8, "welcome_received": 7, "role_said": 6, "registration_started_in_chat": 5, "completed_total": 2, "completed_in_chat": 1}
    assert report["completed_by_role"] == {"member": {"total": 1, "in_chat": 1}, "partner": {"total": 1, "in_chat": 0}, "rider": {"total": 0, "in_chat": 0}}


def test_application_status_is_reported_but_not_treated_as_completed(db):
    report = tool.build_funnel(seed(db), NOW)
    assert "6 leads have status APPLICATION" in report["lead_status_APPLICATION_note"]
    assert report["funnel"]["completed_total"] == 2


def test_stops_per_step_with_real_step_names_and_idle_time(db):
    report = tool.build_funnel(seed(db), NOW)
    member = {row["step"]: row for row in report["steps"]["member"]}
    assert list(member) == ["name", "dob", "pan_no", "address", "sponsor_code", "confirm"]
    assert member["dob"]["stopped_here"] == 1 and member["dob"]["idle"]["median_hours"] == 5.0
    assert member["address"]["stopped_here"] == 1 and member["address"]["idle"]["median_hours"] == 48.0
    assert member["confirm"]["stopped_here"] == 1 and member["confirm"]["idle"]["buckets"][">7d"] == 1
    assert member["name"]["stopped_here"] == 0
    assert member["name"]["reached"] == 4  # 3 in progress + 1 completed in chat
    assert member["dob"]["reached"] == 4
    assert member["pan_no"]["reached"] == 3
    assert member["confirm"]["reached"] == 2
    partner = {row["step"]: row for row in report["steps"]["partner"]}
    assert partner["business_type"]["stopped_here"] == 1
    assert partner["business_type"]["idle"]["buckets"]["<1h"] == 1


def test_stopped_before_registration_summaries(db):
    report = tool.build_funnel(seed(db), NOW)
    assert report["stopped_before_registration"]["welcome"]["count"] == 1
    assert report["stopped_before_registration"]["welcome"]["median_hours"] == 30.0
    assert report["stopped_before_registration"]["role_selected"]["count"] == 1
    assert report["stopped_before_registration"]["role_selected"]["median_hours"] == 3.0


def test_non_whatsapp_leads_are_excluded(db):
    seed(db)
    assert tool.build_funnel(db, NOW)["funnel"]["total_leads"] == 8


def test_progress_helper_names_the_current_step(db):
    lead = add_lead(db, 20, "NATIVE_REG_RIDER", "rider", {"name": "R"})
    progress = registration_progress(lead, db.query(WhatsAppRegistrationSession).one())
    assert (progress.phase, progress.role, progress.step_key, progress.completed_keys) == ("registering", "rider", "vehicle_type", ("name",))
    assert step_label("rider", "vehicle_type") == "যানবাহন"
    assert step_label("rider", "vehicle_type", "en") == "your vehicle category"


def test_render_mentions_every_section(db):
    text = tool.render(tool.build_funnel(seed(db), NOW))
    for needle in ("Welcome পেয়েছে", "Role বলেছে", "Member ধাপ", "Partner ধাপ", "Rider ধাপ", "pan_no", "APPLICATION"):
        assert needle in text


def test_script_is_read_only_and_leaves_no_rows_changed(db, monkeypatch, tmp_path, capsys):
    seed(db)
    before = (db.query(CRMLead).count(), db.query(CRMLeadActivity).count(), db.query(WhatsAppRegistrationSession).count())
    monkeypatch.setattr(tool, "SessionLocal", lambda: db)
    monkeypatch.setattr(db, "close", lambda: None)
    output = tmp_path / "funnel.json"

    assert tool.main(["--json", str(output)]) == 0
    assert "Welcome পেয়েছে" in capsys.readouterr().out
    assert json.loads(output.read_text(encoding="utf-8"))["funnel"]["total_leads"] == 8
    after = (db.query(CRMLead).count(), db.query(CRMLeadActivity).count(), db.query(WhatsAppRegistrationSession).count())
    assert before == after


def test_read_only_mode_rejects_writes(db):
    tool._make_read_only(db)
    db.add(CRMLead(lead_id="WA-x", source="whatsapp"))
    with pytest.raises(OperationalError):
        db.flush()
    db.rollback()


def test_source_contains_no_write_statements():
    source = (BACKEND / "tools" / "registration_funnel_report.py").read_text(encoding="utf-8")
    for forbidden in (".commit(", ".add(", ".delete(", ".merge(", ".update(", "INSERT ", "UPDATE ", "DELETE "):
        assert forbidden not in source
