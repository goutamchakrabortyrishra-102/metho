import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AppSetting, PartnerRequest, User
from sql_app.routers.partner_public import _cleanup_orphaned_partner_registration


def _make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_cleanup_keeps_partner_request_and_user_records_in_place():
    db = _make_session()
    try:
        db.add(
            User(
                name="Existing Partner",
                email="same@example.com",
                phone="1111111111",
                password="hashed",
                role="partner",
            )
        )
        db.add(
            PartnerRequest(
                id="req-1",
                business_name="Demo Shop",
                business_type="Shop",
                contact_person="Demo User",
                phone="1111111111",
                email="same@example.com",
                gst_no="PAN1234567",
                status="pending",
            )
        )
        db.add(
            AppSetting(
                key="partner_req_creds:req-1",
                value_json='{"login_id": "same@example.com"}',
                updated_at=datetime.now(timezone.utc),
            )
        )
        db.commit()

        _cleanup_orphaned_partner_registration(db, "same@example.com", "1111111111", "PAN1234567")

        assert db.query(PartnerRequest).filter(PartnerRequest.id == "req-1").count() == 1
        assert db.query(User).filter(User.email == "same@example.com").count() == 1
        assert db.query(AppSetting).filter(AppSetting.key == "partner_req_creds:req-1").count() == 1
    finally:
        db.close()
