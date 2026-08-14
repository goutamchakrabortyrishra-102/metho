import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import PublicOrder, User, UserReferral
from sql_app.routers.compat import _load_json_setting, _load_user_wallet, _settle_completed_smart_cycles, _smart_cycle_history_key, _smart_cycle_state_key


def _make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def _paid_metho_order(user_id, created_at, subtotal, gst_percent=0):
    return PublicOrder(
        customer_user_id=user_id,
        items_json=(
            '[{"product_id":"metho-1","product_type":"metho",'
            f'"subtotal":{subtotal},"gst_percent":{gst_percent}}}]'
        ),
        total_amount=subtotal,
        status="paid",
        created_at=created_at,
    )


def test_slot_five_pays_gst_excluded_network_sale_then_recycles():
    db = _make_session()
    try:
        now = datetime.now(timezone.utc).replace(microsecond=0)
        cycle_start = now - timedelta(days=35)
        owner = User(name="Owner", email="owner@example.com", phone="1", password="x", role="member")
        direct = User(name="Direct", email="direct@example.com", phone="2", password="x", role="member")
        db.add_all([owner, direct])
        db.flush()
        db.add(UserReferral(user_id=direct.id, sponsor_user_id=owner.id, sponsor_code="MTH-OWNER"))
        db.add(_paid_metho_order(owner.id, cycle_start, 10))
        db.add(_paid_metho_order(direct.id, cycle_start, 10))
        db.add(_paid_metho_order(direct.id, cycle_start + timedelta(days=29), 110, gst_percent=10))
        db.commit()

        _settle_completed_smart_cycles(db, direct.id, now)
        _settle_completed_smart_cycles(db, owner.id, now)
        db.commit()

        direct_wallet = _load_user_wallet(db, direct.id)
        owner_wallet = _load_user_wallet(db, owner.id)
        assert direct_wallet["member_reward_credited"] == 10.0
        assert owner_wallet["leader_reward_credited"] == 5.0
        assert owner_wallet["member_reward_credited"] == 10.0
        assert _load_json_setting(db, _smart_cycle_state_key(owner.id), {})["cycle_number"] == 2
        assert _load_json_setting(db, _smart_cycle_history_key(owner.id), [])[0]["bonus_paid"] == 10.0
    finally:
        db.close()
