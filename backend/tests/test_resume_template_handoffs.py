import csv
import importlib.util
import json
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from sql_app.database import Base
from sql_app.models import AppSetting, CRMLead, CRMLeadActivity, WhatsAppMessageOutbox
from sql_app.whatsapp_cloud import _claim_whatsapp_handoff, is_whatsapp_handoff_active

spec = importlib.util.spec_from_file_location("resume_template_handoffs", BACKEND / "tools" / "resume_template_handoffs.py")
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)

TEMPLATE_REASON = "scheduled_template_configuration_failure"


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def add_handoff(db, number, reason):
    lead = CRMLead(lead_id=f"WA-{number}", business_name="WhatsApp", contact_person=f"Lead {number}", phone=f"88017000000{number}", whatsapp_no=f"88017000000{number}", source="whatsapp")
    db.add(lead)
    db.flush()
    assert _claim_whatsapp_handoff(db, lead.id, {"handoff_id": f"h{number}", "reason": reason})
    db.commit()
    return lead


@pytest.fixture
def db(monkeypatch):
    session = make_session()
    monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda *_a, **_k: pytest.fail("script must never send a WhatsApp message"))
    monkeypatch.setattr("sql_app.whatsapp_cloud.urlopen", lambda *_a, **_k: pytest.fail("script must never call the network"))
    yield session
    session.close()


def seed(db):
    return {
        "t1": add_handoff(db, 1, TEMPLATE_REASON),
        "t2": add_handoff(db, 2, TEMPLATE_REASON),
        "human": add_handoff(db, 3, "explicit_human_request"),
        "complaint": add_handoff(db, 4, "complaint_or_distrust"),
        "similar": add_handoff(db, 5, f"{TEMPLATE_REASON}_other"),
        "none": add_handoff(db, 6, ""),
    }


def test_dry_run_counts_by_reason_and_changes_nothing(db):
    leads = seed(db)
    counts, rows = tool.resume_template_handoffs(db, apply=False)
    assert counts == {TEMPLATE_REASON: 2, "explicit_human_request": 1, "complaint_or_distrust": 1, f"{TEMPLATE_REASON}_other": 1, "": 1}
    assert [row["lead_id"] for row in rows] == sorted([leads["t1"].id, leads["t2"].id])
    assert {row["action"] for row in rows} == {"would_resume"}
    assert all(is_whatsapp_handoff_active(db, lead.id) for lead in leads.values())
    assert db.query(CRMLeadActivity).filter_by(activity_type="whatsapp_handoff_resumed").count() == 0


def test_apply_resumes_only_template_reason_handoffs(db):
    leads = seed(db)
    counts, rows = tool.resume_template_handoffs(db, apply=True)

    assert counts[TEMPLATE_REASON] == 2
    assert not is_whatsapp_handoff_active(db, leads["t1"].id)
    assert not is_whatsapp_handoff_active(db, leads["t2"].id)
    for key in ("human", "complaint", "similar", "none"):
        assert is_whatsapp_handoff_active(db, leads[key].id), key
    assert {row["lead_id"] for row in rows} == {leads["t1"].id, leads["t2"].id}
    assert {row["action"] for row in rows} == {"resumed"}
    assert {row["handoff_id"] for row in rows} == {"h1", "h2"}
    assert {row["reason"] for row in rows} == {TEMPLATE_REASON}
    assert all(row["processed_at"] and row["active_at"] for row in rows)
    assert db.query(CRMLeadActivity).filter_by(activity_type="whatsapp_handoff_resumed").count() == 2
    assert db.query(WhatsAppMessageOutbox).count() == 0


def test_apply_twice_changes_nothing_the_second_time(db):
    seed(db)
    tool.resume_template_handoffs(db, apply=True)
    counts, rows = tool.resume_template_handoffs(db, apply=True)
    assert rows == []
    assert TEMPLATE_REASON not in counts


def test_orphan_handoff_without_lead_is_left_untouched_and_not_reported(db):
    assert _claim_whatsapp_handoff(db, "missing-lead", {"handoff_id": "orphan", "reason": TEMPLATE_REASON})
    db.commit()
    _, rows = tool.resume_template_handoffs(db, apply=True)
    assert rows == []
    assert db.query(AppSetting).filter_by(key="whatsapp_handoff_active:missing-lead").count() == 1


def test_main_writes_changed_rows_list_and_dry_run_default(db, monkeypatch, tmp_path, capsys):
    leads = seed(db)
    monkeypatch.setattr(tool, "SessionLocal", lambda: db)
    monkeypatch.setattr(db, "close", lambda: None)
    report = tmp_path / "changed.csv"

    assert tool.main(["--report", str(report)]) == 0
    assert "Dry run only" in capsys.readouterr().out
    assert is_whatsapp_handoff_active(db, leads["t1"].id)
    with report.open(encoding="utf-8") as handle:
        assert {row["action"] for row in csv.DictReader(handle)} == {"would_resume"}


def test_apply_refuses_while_followup_template_is_unconfigured(db, monkeypatch, tmp_path, capsys):
    leads = seed(db)
    monkeypatch.setattr(tool, "SessionLocal", lambda: db)
    monkeypatch.setattr(db, "close", lambda: None)

    assert tool.main(["--apply", "--report", str(tmp_path / "x.csv")]) == 2
    assert "Refusing to apply" in capsys.readouterr().out
    assert is_whatsapp_handoff_active(db, leads["t1"].id)


def test_apply_runs_once_template_is_configured(db, monkeypatch, tmp_path):
    leads = seed(db)
    db.add(AppSetting(key=tool.TEMPLATE_NAME_KEY, value_json=json.dumps("followup_24h")))
    db.add(AppSetting(key=tool.TEMPLATE_LANGUAGE_KEY, value_json=json.dumps("bn")))
    db.commit()
    monkeypatch.setattr(tool, "SessionLocal", lambda: db)
    monkeypatch.setattr(db, "close", lambda: None)
    report = tmp_path / "ok.csv"

    assert tool.main(["--apply", "--report", str(report)]) == 0
    assert not is_whatsapp_handoff_active(db, leads["t1"].id)
    assert is_whatsapp_handoff_active(db, leads["human"].id)
    with report.open(encoding="utf-8") as handle:
        assert {row["lead_id"] for row in csv.DictReader(handle)} == {leads["t1"].id, leads["t2"].id}
