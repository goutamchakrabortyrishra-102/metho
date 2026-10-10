import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.models import CRMLead, CRMLeadActivity, WhatsAppRegistrationSession
from sql_app.routers.crm import list_whatsapp_conversations
from sql_app.whatsapp_cloud import _request_whatsapp_human_handoff
from test_abandoned_registration_reminders import make_session

ADMIN = SimpleNamespace(role="admin", id="ADMIN")
INBOX_PAGE = Path(__file__).resolve().parents[2] / "src" / "pages" / "dashboard" / "WhatsAppInboxPage.jsx"


def add(db, number, state=None, role="", answers=None, idle_hours=1.0, name=None, **lead_fields):
    lead = CRMLead(lead_id=f"WA-{number}", business_name="WhatsApp", contact_person=name or f"Lead {number}", phone=f"88017{number:07d}", whatsapp_no=f"88017{number:07d}", source="whatsapp", **lead_fields)
    db.add(lead)
    db.flush()
    if state:
        data = {"answers": answers or {}, "nr": {"history": list(answers or {}), "retries": 0}}
        db.add(WhatsAppRegistrationSession(phone=lead.phone, wa_id=lead.phone, lead_id=lead.id, role=role, state=state, data_json=json.dumps(data)))
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_received", message=f"WhatsApp message received [m{number}]: hello", created_at=datetime.now(timezone.utc) - timedelta(hours=idle_hours)))
    db.commit()
    return lead


def listing(db, **kwargs):
    params = {"search": "", "db": db, "current_user": ADMIN, "needs_human_only": False, "registration_stalled_only": False, "stalled_after_hours": 2.0}
    params.update(kwargs)
    return {item["lead_id"]: item for item in list_whatsapp_conversations(**params)["items"]}


@pytest.fixture
def db():
    session = make_session()
    yield session
    session.close()


def seed(db):
    return {
        "stalled": add(db, 1, "NATIVE_REG_MEMBER", "member", {"name": "Ayesha", "dob": "1990-01-01"}, idle_hours=5, name="Ayesha Rahman"),
        "active": add(db, 2, "NATIVE_REG_MEMBER", "member", {"name": "B"}, idle_hours=0.2),
        "welcome": add(db, 3, "INTRODUCTION", idle_hours=30),
        "completed": add(db, 4, "MEMBER_ACTIVATION_PENDING", "member", {}, idle_hours=50),
        "web_done": add(db, 5, None, idle_hours=50, partner_request_id="PR-1"),
        "link": add(db, 6, "ROLE_REGISTRATION_PENDING", "partner", idle_hours=26),
        "partner": add(db, 7, "NATIVE_REG_PARTNER", "partner", {"business_type": "Shop", "shop_sector": "Grocery"}, idle_hours=72),
    }


def test_stalled_lead_shows_name_phone_step_and_last_message_time(db):
    leads = seed(db)
    item = listing(db)[leads["stalled"].id]
    assert item["registration_stalled"] is True
    assert item["contact_person"] == "Ayesha Rahman"
    assert item["phone"] == leads["stalled"].whatsapp_no
    assert item["registration_role"] == "member"
    assert item["registration_step"] == "pan_no"
    assert item["registration_step_label"] == "PAN"
    assert item["registration_idle_hours"] == pytest.approx(5.0, abs=0.1)
    assert item["latest_message_at"]


def test_only_in_progress_registrations_past_the_threshold_are_stalled(db):
    leads = seed(db)
    items = listing(db)
    assert {key for key, lead in leads.items() if items[lead.id]["registration_stalled"]} == {"stalled", "link", "partner"}
    for key in ("active", "welcome", "completed", "web_done"):
        item = items[leads[key].id]
        assert item["registration_stalled"] is False
        if key == "active":
            assert item["registration_step"] == "dob"
        else:
            assert item["registration_step"] == "" and item["registration_idle_hours"] is None


def test_partner_step_and_link_step_are_named(db):
    leads = seed(db)
    items = listing(db)
    assert items[leads["partner"].id]["registration_step"] == "shop_category"
    assert items[leads["partner"].id]["registration_step_label"] == "Shop Category"
    assert items[leads["link"].id]["registration_step_label"] == "ওয়েব ফর্মের লিংক পাঠানো হয়েছে"


def test_filter_returns_only_stalled_conversations(db):
    leads = seed(db)
    items = listing(db, registration_stalled_only=True)
    assert set(items) == {leads["stalled"].id, leads["link"].id, leads["partner"].id}
    assert all(item["registration_stalled"] for item in items.values())


def test_without_the_filter_every_conversation_is_still_listed(db):
    leads = seed(db)
    assert set(listing(db)) == {lead.id for lead in leads.values()}


def test_threshold_is_adjustable(db):
    leads = seed(db)
    assert leads["stalled"].id in listing(db, registration_stalled_only=True, stalled_after_hours=4)
    assert leads["stalled"].id not in listing(db, registration_stalled_only=True, stalled_after_hours=6)
    assert leads["active"].id in listing(db, registration_stalled_only=True, stalled_after_hours=0)


def test_filter_combines_with_search_and_needs_human(db):
    leads = seed(db)
    assert set(listing(db, registration_stalled_only=True, search="Ayesha")) == {leads["stalled"].id}
    _request_whatsapp_human_handoff(db, leads["partner"], None, leads["partner"].whatsapp_no, reason="explicit_human_request", notify_customer=False)
    both = listing(db, registration_stalled_only=True, needs_human_only=True)
    assert set(both) == {leads["partner"].id}
    assert both[leads["partner"].id]["needs_human"] is True


def test_existing_needs_human_behaviour_is_unchanged(db):
    leads = seed(db)
    _request_whatsapp_human_handoff(db, leads["welcome"], None, leads["welcome"].whatsapp_no, reason="ai_no_answer", notify_customer=False)
    items = listing(db, needs_human_only=True)
    assert set(items) == {leads["welcome"].id}
    assert items[leads["welcome"].id]["handoff_reason"] == "ai_no_answer"
    assert items[leads["welcome"].id]["registration_stalled"] is False


def test_only_admins_can_list(db):
    seed(db)
    with pytest.raises(HTTPException) as error:
        list_whatsapp_conversations(search="", db=db, current_user=SimpleNamespace(role="member", id="U"), needs_human_only=False, registration_stalled_only=True, stalled_after_hours=2.0)
    assert error.value.status_code == 403


def test_no_new_tables_or_columns_are_needed():
    from sql_app.database import Base
    assert not [name for name in Base.metadata.tables if "stall" in name]
    assert not [column.name for column in Base.metadata.tables["crm_leads"].columns if "stall" in column.name]


def test_inbox_page_has_the_filter_button_count_and_row_details():
    source = INBOX_PAGE.read_text(encoding="utf-8")
    assert "registrationStalledOnly" in source and "setRegistrationStalledOnly" in source
    assert "conversations.filter((c) => c.registration_stalled).length" in source
    assert "!registrationStalledOnly || conversation.registration_stalled" in source
    assert 'data-testid="inbox-registration-stalled-filter"' in source
    assert "Registration থেমে আছে (" in source
    assert 'data-testid="inbox-registration-stalled-row"' in source
    for field in ("registration_step_label", "registration_role", "latest_message_at", "conversation.phone"):
        assert field in source
