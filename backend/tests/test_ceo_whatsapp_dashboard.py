import sys
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import CRMLead, CRMLeadActivity, User
from sql_app.routers.crm import ceo_dashboard


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_ceo_dashboard_tracks_whatsapp_registration_handoffs_and_no_response():
    db = make_session()
    try:
        admin = User(id="ADMIN", name="Admin", email="admin@test.local", phone="1", password="hash", role="admin", is_active=True)
        completed = CRMLead(lead_id="WA-completed", business_name="Completed", phone="9000000001", whatsapp_no="9000000001", source="whatsapp", status="APPLICATION", member_user_id="MAU10001")
        handoff = CRMLead(lead_id="WA-handoff", business_name="Handoff", phone="9000000002", whatsapp_no="9000000002", source="whatsapp", status="NEW")
        no_response = CRMLead(lead_id="WA-no-response", business_name="No response", phone="9000000003", whatsapp_no="9000000003", source="whatsapp", status="APPLICATION")
        db.add_all([admin, completed, handoff, no_response])
        db.flush()
        db.add_all([
            CRMLeadActivity(lead_id=completed.id, activity_type="member_registration_completed", message="Member registration completed"),
            CRMLeadActivity(lead_id=handoff.id, activity_type="whatsapp_human_handoff_requested", message="Human support requested"),
            CRMLeadActivity(lead_id=no_response.id, activity_type="registration_reminder_sent", message="Reminder one"),
            CRMLeadActivity(lead_id=no_response.id, activity_type="registration_reminder_sent", message="Reminder two"),
        ])
        db.commit()

        result = ceo_dashboard(db, SimpleNamespace(role="admin", id=admin.id))

        assert result["whatsapp_registration_started"] == 2
        assert result["whatsapp_registration_completed"] == 1
        assert result["whatsapp_human_handoffs"] == 1
        assert result["whatsapp_no_response_after_reminders"] == 1
        assert {item["lead_id"] for item in result["whatsapp_action_queue"]} == {handoff.id, no_response.id}
    finally:
        db.close()