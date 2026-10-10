import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.followup_scheduler import TEMPLATE_LANGUAGE_KEY, TEMPLATE_NAME_KEY
from sql_app.models import AppSetting, CRMFollowUp, CRMLeadActivity, CRMTask, WhatsAppMessageOutbox
from sql_app.routers.whatsapp import update_whatsapp_settings
from sql_app.whatsapp_ai import FOLLOWUP_STATUS_NO_TEMPLATE, process_due_followups, process_message_outbox
from sql_app.whatsapp_cloud import _request_whatsapp_human_handoff, ingest_whatsapp_message, is_whatsapp_handoff_active
from test_abandoned_registration_reminders import NoCloseSession, add_tracked_lead, due_general_followup, make_session, record_recent_whatsapp_inbound
from test_whatsapp_admin_settings import message_payload

NOTES = "Initial WhatsApp lead follow-up"


def old_leads(db, count=3):
    leads = []
    for index in range(count):
        lead = add_tracked_lead(db, role=f"old-{index}", phone=f"880171000000{index + 1}")
        due_general_followup(db, lead)
        record_recent_whatsapp_inbound(db, lead, datetime.now(timezone.utc) - timedelta(hours=25))
        leads.append(lead)
    return leads


def use(db, monkeypatch):
    db.close = lambda: None
    monkeypatch.setattr("sql_app.whatsapp_ai.SessionLocal", NoCloseSession(db))


def configure_executive(db):
    update_whatsapp_settings({
        "executive_handoff_number": "+91 98765 43210",
        "executive_handoff_template_name": "executive_handoff_v1",
        "executive_handoff_template_language": "en_US",
    }, db, SimpleNamespace(role="admin", id="ADMIN"))


def set_followup_template(db, name="metho_followup_v1", language="en_US"):
    for key, value in ((TEMPLATE_NAME_KEY, name), (TEMPLATE_LANGUAGE_KEY, language)):
        row = db.query(AppSetting).filter_by(key=key).first()
        if row:
            row.value_json = json.dumps(value)
        else:
            db.add(AppSetting(key=key, value_json=json.dumps(value)))
    db.commit()


def test_three_old_followups_without_template_create_no_handoff_and_no_task(monkeypatch):
    db = make_session()
    try:
        leads = old_leads(db)
        use(db, monkeypatch)

        assert process_due_followups() == 0
        for lead in leads:
            followup = db.query(CRMFollowUp).filter_by(lead_id=lead.id, notes=NOTES).one()
            assert followup.status == FOLLOWUP_STATUS_NO_TEMPLATE
            assert not is_whatsapp_handoff_active(db, lead.id)
            assert db.query(CRMTask).filter_by(lead_id=lead.id).count() == 0
            assert db.query(CRMLeadActivity).filter_by(lead_id=lead.id, activity_type="whatsapp_human_handoff_requested").count() == 0
        assert db.query(AppSetting).filter(AppSetting.key.like("whatsapp_handoff_active:%")).count() == 0
        assert db.query(WhatsAppMessageOutbox).count() == 0
    finally:
        db.close()


def test_reason_is_recorded_on_each_lead_and_repeat_runs_add_nothing(monkeypatch):
    db = make_session()
    try:
        leads = old_leads(db)
        use(db, monkeypatch)

        process_due_followups()
        for lead in leads:
            note = db.query(CRMLeadActivity).filter_by(lead_id=lead.id, activity_type="whatsapp_followup_template_missing").one()
            assert TEMPLATE_NAME_KEY in note.message and TEMPLATE_LANGUAGE_KEY in note.message
            assert db.query(CRMLeadActivity).filter_by(lead_id=lead.id, activity_type="crm_followup_due").count() == 0

        before = db.query(CRMLeadActivity).count()
        assert process_due_followups() == 0
        assert db.query(CRMLeadActivity).count() == before
        assert db.query(CRMFollowUp).filter_by(status=FOLLOWUP_STATUS_NO_TEMPLATE).count() == 3
    finally:
        db.close()


def test_reason_is_written_to_the_log(monkeypatch, caplog):
    db = make_session()
    try:
        old_leads(db, 1)
        use(db, monkeypatch)
        with caplog.at_level("WARNING", logger="sql_app.whatsapp_ai"):
            process_due_followups()
        assert any(TEMPLATE_NAME_KEY in record.getMessage() for record in caplog.records)
    finally:
        db.close()


def test_bot_stays_active_for_a_lead_with_a_parked_followup(monkeypatch):
    db = make_session()
    try:
        lead = old_leads(db, 1)[0]
        use(db, monkeypatch)
        process_due_followups()

        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append(text) or {"messages": [{"id": "wamid.reply"}]})
        update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token"}, db, SimpleNamespace(role="admin", id="ADMIN"))
        assert ingest_whatsapp_message(db, message_payload("wamid.after-park", "Hi", sender=lead.whatsapp_no), None) == "updated"
        assert sent
        assert not is_whatsapp_handoff_active(db, lead.id)
    finally:
        db.close()


def test_template_set_later_sends_the_parked_followups_with_the_template(monkeypatch):
    db = make_session()
    try:
        leads = old_leads(db)
        use(db, monkeypatch)
        process_due_followups()
        assert db.query(WhatsAppMessageOutbox).count() == 0

        set_followup_template(db)
        assert process_due_followups() == 3
        outbox = db.query(WhatsAppMessageOutbox).order_by(WhatsAppMessageOutbox.recipient).all()
        assert [row.recipient for row in outbox] == sorted(lead.whatsapp_no for lead in leads)
        for row in outbox:
            assert json.loads(row.message)["_whatsapp_template"] == {"name": "metho_followup_v1", "language": "en_US", "parameters": ["Test Customer"]}
        assert db.query(CRMFollowUp).filter_by(status=FOLLOWUP_STATUS_NO_TEMPLATE).count() == 0
        assert db.query(AppSetting).filter(AppSetting.key.like("whatsapp_handoff_active:%")).count() == 0

        sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, **kwargs: sent.append((recipient, kwargs)) or {"messages": [{"id": "wamid.t"}]})
        assert process_message_outbox() == 3
        assert {kwargs["template_name"] for _recipient, kwargs in sent} == {"metho_followup_v1"}
    finally:
        db.close()


@pytest.mark.parametrize("only", [TEMPLATE_NAME_KEY, TEMPLATE_LANGUAGE_KEY])
def test_half_configured_template_keeps_followups_parked(monkeypatch, only):
    db = make_session()
    try:
        old_leads(db, 1)
        use(db, monkeypatch)
        process_due_followups()
        db.add(AppSetting(key=only, value_json=json.dumps("x")))
        db.commit()

        assert process_due_followups() == 0
        assert db.query(CRMFollowUp).filter_by(status=FOLLOWUP_STATUS_NO_TEMPLATE).count() == 1
        assert db.query(WhatsAppMessageOutbox).count() == 0
    finally:
        db.close()


def test_parked_followup_of_a_lead_that_later_got_a_handoff_is_cancelled_not_sent(monkeypatch):
    db = make_session()
    try:
        lead = old_leads(db, 1)[0]
        use(db, monkeypatch)
        process_due_followups()
        _request_whatsapp_human_handoff(db, lead, None, lead.whatsapp_no, reason="explicit_human_request", notify_customer=False)

        set_followup_template(db)
        assert process_due_followups() == 0
        assert db.query(CRMFollowUp).filter_by(lead_id=lead.id, notes=NOTES).one().status == "Cancelled"
        assert db.query(WhatsAppMessageOutbox).filter_by(lead_id=lead.id, activity_type="whatsapp_message_sent").count() == 0
    finally:
        db.close()


def test_executive_gets_at_most_one_aggregated_summary_per_day(monkeypatch):
    db = make_session()
    try:
        configure_executive(db)
        old_leads(db)
        use(db, monkeypatch)

        process_due_followups()
        process_due_followups()
        process_due_followups()
        summaries = db.query(WhatsAppMessageOutbox).filter_by(activity_type="executive_handoff_notification").all()
        assert len(summaries) == 1
        assert summaries[0].dedupe_key == f"followup-template-missing-summary:{datetime.now(timezone.utc):%Y-%m-%d}"
        template = json.loads(summaries[0].message)["_whatsapp_template"]
        assert template["name"] == "executive_handoff_v1"
        assert template["parameters"][0] == "Multiple WhatsApp leads"
        assert "3 follow-up(s)" in template["parameters"][2]
        assert db.query(CRMTask).count() == 0
    finally:
        db.close()


def test_no_summary_when_nothing_is_waiting_or_executive_is_unconfigured(monkeypatch):
    db = make_session()
    try:
        use(db, monkeypatch)
        configure_executive(db)
        assert process_due_followups() == 0
        assert db.query(WhatsAppMessageOutbox).count() == 0

        old_leads(db, 1)
        update_whatsapp_settings({"executive_handoff_number": "", "executive_handoff_template_name": "", "executive_handoff_template_language": ""}, db, SimpleNamespace(role="admin", id="ADMIN"))
        process_due_followups()
        assert db.query(WhatsAppMessageOutbox).count() == 0
        assert db.query(CRMLeadActivity).filter_by(activity_type="executive_handoff_notification_failed").count() == 0
    finally:
        db.close()


def test_summary_stops_once_template_is_configured(monkeypatch):
    db = make_session()
    try:
        configure_executive(db)
        old_leads(db)
        use(db, monkeypatch)
        process_due_followups()
        db.query(WhatsAppMessageOutbox).delete()
        db.commit()

        set_followup_template(db)
        process_due_followups()
        assert db.query(WhatsAppMessageOutbox).filter_by(activity_type="executive_handoff_notification").count() == 0
    finally:
        db.close()


@pytest.mark.parametrize("reason", ["ai_no_answer", "unclear_introduction_x3", "explicit_human_request", "complaint_or_distrust"])
def test_other_handoff_reasons_still_create_handoff_and_task(monkeypatch, reason):
    db = make_session()
    try:
        lead = add_tracked_lead(db)
        use(db, monkeypatch)

        assert _request_whatsapp_human_handoff(db, lead, None, lead.whatsapp_no, reason=reason, notify_customer=False)
        assert is_whatsapp_handoff_active(db, lead.id)
        row = db.query(AppSetting).filter_by(key=f"whatsapp_handoff_active:{lead.id}").one()
        assert json.loads(row.value_json)["reason"] == reason
        assert db.query(CRMTask).filter_by(lead_id=lead.id, title="WhatsApp human support requested").count() == 1
        assert db.query(CRMLeadActivity).filter_by(lead_id=lead.id, activity_type="whatsapp_human_handoff_requested").count() == 1
    finally:
        db.close()


def test_followup_inside_24_hours_is_unaffected_without_template(monkeypatch):
    db = make_session()
    try:
        lead = add_tracked_lead(db)
        due_general_followup(db, lead)
        record_recent_whatsapp_inbound(db, lead, datetime.now(timezone.utc) - timedelta(hours=1))
        use(db, monkeypatch)

        assert process_due_followups() == 1
        assert db.query(CRMFollowUp).filter_by(status=FOLLOWUP_STATUS_NO_TEMPLATE).count() == 0
        assert "_whatsapp_template" not in db.query(WhatsAppMessageOutbox).one().message
    finally:
        db.close()
