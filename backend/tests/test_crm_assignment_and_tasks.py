import sys
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import CRMLead, User
from sql_app.routers.crm import assign_crm_lead, create_crm_task, list_crm_tasks, update_crm_task


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_lead_assignment_requires_active_admin():
    db = make_session()
    try:
        admin = User(id="ADMIN", name="Admin", email="admin@example.com", phone="1", password="x", role="admin", is_active=True)
        member = User(id="MEMBER", name="Member", email="member@example.com", phone="2", password="x", role="member", is_active=True)
        lead = CRMLead(id="LEAD", business_name="Lead", status="NEW")
        db.add_all([admin, member, lead])
        db.commit()
        identity = SimpleNamespace(role="admin", id="ADMIN", name="Admin")

        result = assign_crm_lead(lead.id, {"assigned_user_id": admin.id}, db, identity)
        assert result["lead"]["assigned_user_id"] == admin.id
        with pytest.raises(HTTPException, match="active admin"):
            assign_crm_lead(lead.id, {"assigned_user_id": member.id}, db, identity)
    finally:
        db.close()


def test_task_lifecycle_validates_assignment_and_links_lead():
    db = make_session()
    try:
        admin = User(id="ADMIN", name="Admin", email="admin@example.com", phone="1", password="x", role="admin", is_active=True)
        lead = CRMLead(id="LEAD", business_name="Lead", status="NEW")
        db.add_all([admin, lead])
        db.commit()
        identity = SimpleNamespace(role="admin", id="ADMIN", name="Admin")

        task = create_crm_task({
            "title": "Call lead",
            "description": "Discuss proposal",
            "due_at": "2030-01-01T10:00:00Z",
            "priority": "High",
            "lead_id": lead.id,
            "assigned_user_id": admin.id,
        }, db, identity)["task"]
        assert task["status"] == "Pending"
        assert task["lead_id"] == lead.id

        updated = update_crm_task(task["id"], {"status": "Completed"}, db, identity)["task"]
        assert updated["status"] == "Completed"
        assert len(list_crm_tasks(lead_id=lead.id, db=db, current_user=identity)["items"]) == 1

        with pytest.raises(HTTPException, match="Invalid task status"):
            update_crm_task(task["id"], {"status": "Unknown"}, db, identity)
    finally:
        db.close()
