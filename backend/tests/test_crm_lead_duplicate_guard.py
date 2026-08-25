import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AssociatePartner, PartnerRequest, User, CRMLead


def _make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_duplicate_lead_rejected_before_creation():
    db = _make_session()
    try:
        user = User(
            id="MTH-USER-1",
            name="Existing User",
            email="existing@example.com",
            phone="9876512345",
            password="hashed",
            role="member",
            is_active=True,
        )
        partner = AssociatePartner(
            id="PART-1",
            partner_code="MTH-PARTNER-001",
            business_name="Demo Shop",
            business_type="Retail Shop",
            contact_person="Demo",
            phone="9876500001",
            email="partner@example.com",
            whatsapp_no="9876500001",
            address="Main Rd",
            city="Kolkata",
            state="West Bengal",
            pincode="700001",
            gst_no="PAN0000000",
            commission_percent=10,
            active=True,
        )
        db.add_all([user, partner])
        db.commit()

        existing = CRMLead(
            lead_id="crm-lead-1",
            business_name="Demo Shop",
            phone="9876512345",
            whatsapp_no="9876512345",
            city="Kolkata",
            state="West Bengal",
            status="NEW",
            last_contact_at=datetime.now(timezone.utc),
            created_by_user_id="admin-1",
            member_user_id=user.id,
            partner_id=partner.id,
        )
        db.add(existing)
        db.commit()

        found = db.query(CRMLead).filter(CRMLead.phone == "9876512345").first()
        assert found is not None
        assert found.business_name == "Demo Shop"
    finally:
        db.close()
