import json
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AppSetting, Product, ProductMeta
from sql_app.routers.checkout import create_public_order
from sql_app.routers.compat import admin_tourism_bookings


def _make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_tourism_order_requires_terms_and_records_acceptance():
    db = _make_session()
    try:
        tourism = Product(name="Weekend Tour", category="Tourism", price=2500, stock=10)
        db.add(tourism)
        db.flush()
        db.add(ProductMeta(product_id=tourism.id, product_type="metho_service", mrp=2500))
        db.add(AppSetting(key=f"product_service_meta:{tourism.id}", value_json=json.dumps({
            "is_service": True,
            "service_booking_enabled": True,
            "service_template_key": "tourism_booking",
            "commission_percent": 5,
        })))
        db.commit()

        base_payload = {
            "items": [{"product_id": tourism.id, "quantity": 1, "service_template_key": "ignored-client-value"}],
            "payer_name": "Traveller",
            "customer_phone": "9000000000",
            "slot_datetime": "2030-01-01T10:00",
        }
        with pytest.raises(HTTPException, match="Travel booking terms"):
            create_public_order(base_payload, db)

        accepted = create_public_order({**base_payload, "tourism_terms_accepted": True}, db)
        row = db.query(AppSetting).filter(AppSetting.key == f"tourism_terms_acceptance:{accepted['id']}").first()
        assert row is not None
        assert json.loads(row.value_json)["policy_version"] == "2026-08-19"

        report = admin_tourism_bookings(db, type("Admin", (), {"role": "admin"})())
        assert report["summary"]["total_bookings"] == 1
        assert report["summary"]["terms_complete"] == 1
        assert report["items"][0]["customer_phone"] == "9000000000"
    finally:
        db.close()