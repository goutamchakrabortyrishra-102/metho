import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AssociatePartner, CRMLead, PartnerRequest, User
from sql_app.routers.compat import admin_partner_request_approve
from sql_app.routers.crm import convert_lead_to_partner, get_lead_conversion


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def admin():
    return SimpleNamespace(role="super_admin", id="ADMIN", name="Admin")


def lead(db, **values):
    fields = {
        "business_name": "Conversion Shop",
        "business_type": "Shop",
        "contact_person": "Owner",
        "phone": "8888888888",
        "whatsapp_no": "8888888888",
        "email": "conversion@example.com",
        "city": "Kolkata",
        "status": "QUALIFIED",
        "created_by_user_id": "ADMIN",
    }
    fields.update(values)
    row = CRMLead(
        **fields,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def registration_payload():
    return {
        "login_id": "conversion@example.com",
        "password": "secret1",
        "pan_no": "ABCDE1234F",
        "aadhaar_no": "123456789012",
        "business_type": "Shop",
    }


def test_conversion_creates_pending_request_without_partner_then_approval_links_crm():
    db = make_session()
    try:
        row = lead(db)
        result = convert_lead_to_partner(row.id, registration_payload(), db, admin())
        request = db.query(PartnerRequest).filter(PartnerRequest.id == result["request_id"]).one()
        assert result["status"] == "pending"
        assert request.status == "pending"
        assert row.partner_request_id == request.id
        assert row.status == "QUALIFIED"
        assert db.query(AssociatePartner).count() == 0

        approved = admin_partner_request_approve(request.id, {}, db, admin())
        db.refresh(row)
        assert approved["status"] == "approved"
        assert db.query(AssociatePartner).count() == 1
        assert row.status == "CONVERTED"
        assert row.converted_partner_id == approved["partner_id"]
    finally:
        db.close()


def test_conversion_is_idempotent_for_pending_request_and_rejects_after_approval():
    db = make_session()
    try:
        row = lead(db)
        first = convert_lead_to_partner(row.id, registration_payload(), db, admin())
        second = convert_lead_to_partner(row.id, registration_payload(), db, admin())
        assert first["request_id"] == second["request_id"]
        assert second["reused"] is True
        assert db.query(PartnerRequest).count() == 1

        admin_partner_request_approve(first["request_id"], {}, db, admin())
        with pytest.raises(Exception, match="Already Partner"):
            convert_lead_to_partner(row.id, registration_payload(), db, admin())
        assert db.query(PartnerRequest).count() == 1
        assert db.query(AssociatePartner).count() == 1
    finally:
        db.close()


def test_conversion_reuses_existing_pending_request_and_unauthorized_is_rejected():
    db = make_session()
    try:
        request = PartnerRequest(
            id="REQ-EXISTING",
            business_name="Conversion Shop",
            business_type="Shop",
            contact_person="Owner",
            phone="8888888888",
            email="conversion@example.com",
            status="pending",
        )
        db.add(request)
        db.commit()
        row = lead(db)
        result = convert_lead_to_partner(row.id, registration_payload(), db, admin())
        assert result["reused"] is True
        assert result["request_id"] == request.id
        assert db.query(PartnerRequest).count() == 1
        with pytest.raises(Exception, match="Admin access required"):
            get_lead_conversion(row.id, db, SimpleNamespace(role="member", id="MEMBER"))
    finally:
        db.close()


def test_conversion_requires_eligible_stage():
    db = make_session()
    try:
        row = lead(db, status="NEW")
        with pytest.raises(Exception, match="must be QUALIFIED"):
            convert_lead_to_partner(row.id, registration_payload(), db, admin())
        assert db.query(PartnerRequest).count() == 0
    finally:
        db.close()
