import sys
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import User
from sql_app.routers.compat import (
    _load_user_wallet,
    _member_purchase_active,
    _save_user_wallet,
    _activate_member_purchase,
    admin_withdrawals_approve,
    admin_withdrawals_reject,
    wallet_withdraw,
)


def _make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def _admin():
    return SimpleNamespace(role="super_admin")


def test_purchase_activation_and_withdrawal_net_payout_or_refund():
    db = _make_session()
    try:
        member = User(name="Member", email="member@example.com", phone="9999999999", password="x", role="member")
        db.add(member)
        db.commit()

        assert _activate_member_purchase(db, member, "order-1", "razorpay") is True
        assert _member_purchase_active(db, member.id) is True
        assert _activate_member_purchase(db, member, "order-2", "upi") is False

        _save_user_wallet(db, member.id, {"balance": 1000, "total_income": 1000})
        pending = wallet_withdraw(
            {"amount": 1000, "method": "upi", "account_details": "member@upi"},
            db=db,
            current_user=member,
        )["withdrawal"]
        assert pending["tds_amount"] == 50.0
        assert pending["admin_charge_amount"] == 30.0
        assert pending["net_amount"] == 920.0
        assert _load_user_wallet(db, member.id)["balance"] == 0.0

        approved = admin_withdrawals_approve(pending["id"], {"utr": "UTR-1"}, db=db, current_user=_admin())
        assert approved["net_amount"] == 920.0

        _save_user_wallet(db, member.id, {"balance": 1000, "total_income": 1000})
        rejected = wallet_withdraw(
            {"amount": 1000, "method": "bank", "account_details": "123456"},
            db=db,
            current_user=member,
        )["withdrawal"]
        admin_withdrawals_reject(rejected["id"], {"reason": "Verification failed"}, db=db, current_user=_admin())
        assert _load_user_wallet(db, member.id)["balance"] == 1000.0
    finally:
        db.close()
