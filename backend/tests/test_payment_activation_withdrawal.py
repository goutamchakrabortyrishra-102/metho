import sys
import json
from pathlib import Path
from types import SimpleNamespace
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AppSetting, User
from sql_app.routers.compat import (
    _load_user_wallet,
    _member_purchase_active,
    _save_user_wallet,
    _activate_member_purchase,
    kyc_submit,
    _record_user_wallet_earning,
    process_due_kyc_forfeitures,
    admin_kyc_reward_accounts,
    admin_restore_kyc_forfeiture,
    admin_withdrawals_approve,
    admin_withdrawals_reject,
    wallet_withdraw,
)


def _make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def _admin():
    return SimpleNamespace(role="super_admin", id="ADMIN")


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
        with pytest.raises(HTTPException, match="Complete PAN and Aadhaar KYC"):
            wallet_withdraw(
                {"amount": 1000, "method": "upi", "account_details": "member@upi"},
                db=db,
                current_user=member,
            )
        kyc_submit({"pan_no": "ABCDE1234F", "aadhaar_no": "123456789012"}, db=db, current_user=member)
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


def test_kyc_month_end_forfeiture_is_dry_runnable_and_idempotent():
    db = _make_session()
    try:
        member = User(name="Member", email="forfeit@example.com", phone="9999999998", password="x", role="member")
        db.add(member)
        db.commit()
        _save_user_wallet(db, member.id, {"balance": 125, "total_income": 125})
        _record_user_wallet_earning(
            db,
            member.id,
            125,
            "smart_cycle",
            "cycle:october:member",
            datetime(2026, 10, 20, 12, tzinfo=timezone.utc),
        )
        db.commit()
        earning_row = db.query(AppSetting).filter(AppSetting.key.like(f"user_wallet_earning:{member.id}:%")).one()

        preview = process_due_kyc_forfeitures(db, datetime(2026, 11, 1, 0, tzinfo=timezone.utc), dry_run=True)
        assert preview["processed"] == 1
        assert preview["forfeited"][0]["amount"] == 125
        assert _load_user_wallet(db, member.id)["balance"] == 125
        assert json.loads(earning_row.value_json)["status"] == "pending_kyc"

        from sql_app.routers.settings import save_settings
        save_settings(db, {"kyc_reward_forfeiture_enabled": True, "kyc_reward_rule_start_date": "2026-10-10", "kyc_reward_grace_days": 0})
        result = process_due_kyc_forfeitures(db, datetime(2026, 11, 1, 0, tzinfo=timezone.utc))
        assert result["processed"] == 1
        assert _load_user_wallet(db, member.id)["balance"] == 0
        stored = json.loads(earning_row.value_json)
        assert stored["amount"] == 125
        assert stored["status"] == "forfeited_kyc"

        kyc_submit({"pan_no": "ABCDE1234F", "aadhaar_no": "123456789012"}, db=db, current_user=member)
        assert _load_user_wallet(db, member.id)["balance"] == 0

        repeated = process_due_kyc_forfeitures(db, datetime(2026, 11, 2, 0, tzinfo=timezone.utc))
        assert repeated["processed"] == 0
        assert _load_user_wallet(db, member.id)["balance"] == 0
    finally:
        db.close()


def test_kyc_completed_before_month_end_preserves_pending_reward():
    db = _make_session()
    try:
        member = User(name="Member", email="early-kyc@example.com", phone="9999999997", password="x", role="member")
        db.add(member)
        db.commit()
        _save_user_wallet(db, member.id, {"balance": 80, "total_income": 80})
        _record_user_wallet_earning(db, member.id, 80, "monthly_member_reward", "pool:october:early", datetime(2026, 10, 20, 12, tzinfo=timezone.utc))
        db.commit()
        kyc_submit({"pan_no": "BCDEF1234G", "aadhaar_no": "234567890123"}, db=db, current_user=member)

        result = process_due_kyc_forfeitures(db, datetime(2026, 11, 1, 0, tzinfo=timezone.utc), dry_run=True)
        earning = db.query(AppSetting).filter(AppSetting.key.like(f"user_wallet_earning:{member.id}:%")).one()
        assert result["processed"] == 0
        assert _load_user_wallet(db, member.id)["balance"] == 80
        assert json.loads(earning.value_json)["status"] == "eligible"
    finally:
        db.close()


def test_admin_lists_and_restores_forfeited_reward_with_reason():
    db = _make_session()
    try:
        member = User(name="Member", email="override@example.com", phone="9999999996", password="x", role="member")
        db.add(member)
        db.commit()
        _save_user_wallet(db, member.id, {"balance": 0, "total_income": 50})
        _record_user_wallet_earning(db, member.id, 50, "smart_cycle", "cycle:override", datetime(2026, 10, 20, 12, tzinfo=timezone.utc))
        db.commit()
        earning = db.query(AppSetting).filter(AppSetting.key.like(f"user_wallet_earning:{member.id}:%")).one()
        doc = json.loads(earning.value_json)
        doc["status"] = "forfeited_kyc"
        earning.value_json = json.dumps(doc)
        db.commit()

        accounts = admin_kyc_reward_accounts(db=db, current_user=_admin())
        member_account = next(item for item in accounts if item["user_id"] == member.id)
        assert member_account["forfeited_kyc_rewards"] == 50

        restored = admin_restore_kyc_forfeiture(member.id, earning.key.rsplit(":", 1)[-1], {"reason": "Verified documents received"}, db=db, current_user=_admin())
        assert restored["amount_restored"] == 50
        assert _load_user_wallet(db, member.id)["balance"] == 50
        assert json.loads(earning.value_json)["status"] == "restored_kyc_override"
        with pytest.raises(HTTPException, match="Only a forfeited KYC reward"):
            admin_restore_kyc_forfeiture(member.id, earning.key.rsplit(":", 1)[-1], {"reason": "Repeat"}, db=db, current_user=_admin())
    finally:
        db.close()
