import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AssociatePartner, PartnerProduct, PublicOrder
from sql_app.routers.compat import _calculate_sql_pool


def _make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_metho_and_partner_sales_both_feed_all_reward_pools():
    db = _make_session()
    try:
        now = datetime.now(timezone.utc)
        partner = AssociatePartner(
            partner_code="MTH-PARTNER-POOL",
            business_name="Pool Partner",
            commission_percent=20,
        )
        db.add(partner)
        db.flush()
        partner_product = PartnerProduct(
            partner_id=partner.id,
            name="Partner Service",
            category="Service",
            price=200,
            stock=5,
            approval_status="approved",
            active=True,
        )
        db.add(partner_product)
        db.flush()
        db.add(PublicOrder(
            customer_user_id="",
            items_json=json.dumps([
                {"product_id": "metho-product", "product_type": "metho", "subtotal": 118, "pre_tax": 100},
                {"product_id": partner_product.id, "product_type": "associate_partner", "subtotal": 200},
            ]),
            total_amount=318,
            status="paid",
            created_at=now,
        ))
        db.commit()

        pool = _calculate_sql_pool(db, now.strftime("%Y-%m"))
        assert pool["gross_sales"] == 300.0
        assert pool["commission_pool"] == 50.0
        assert pool["member_pool"] == 20.0
        assert pool["leader_pool"] == 10.0
        assert pool["mps_fund"] == 5.0
        assert pool["company_fund"] == 10.0
        assert pool["technology_reserve"] == 5.0
    finally:
        db.close()
