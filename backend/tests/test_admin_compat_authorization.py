import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.routers.compat import (
    admin_mps_claims,
    admin_mps_claims_reject,
    admin_mps_fund,
    settlement_history,
    settlement_preview,
    system_health,
)
from sql_app.routers.settings import get_settings, save_settings


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def user(role):
    return SimpleNamespace(role=role, id=role.upper())


def test_member_cannot_access_admin_health_mps_or_settlement_endpoints():
    db = make_session()
    member = user("member")
    calls = [
        lambda: system_health(db, member),
        lambda: admin_mps_fund(db, member),
        lambda: admin_mps_claims(member),
        lambda: admin_mps_claims_reject("missing", {}, member),
        lambda: settlement_preview(2026, 9, db, member),
        lambda: settlement_history(member),
    ]

    try:
        for call in calls:
            with pytest.raises(HTTPException) as error:
                call()
            assert error.value.status_code == 403
    finally:
        db.close()


def test_admin_role_keeps_read_access_to_admin_compat_endpoints():
    db = make_session()
    admin = user("admin")

    try:
        assert system_health(db, admin)["overall_status"] in {"healthy", "watch", "attention"}
        assert admin_mps_fund(db, admin)["available_balance"] == 0
        assert admin_mps_claims(admin) == []
        assert settlement_preview(2026, 9, db, admin)["period"] == "2026-09"
        assert settlement_history(admin) == []
    finally:
        db.close()


def test_global_settings_hide_secrets_from_non_admin_users():
    db = make_session()

    try:
        save_settings(db, {"razorpay_key_secret": "payment-secret", "einvoice_password": "invoice-secret"})

        public_settings = get_settings(None, db)
        member_settings = get_settings(user("member"), db)
        admin_settings = get_settings(user("admin"), db)

        assert "razorpay_key_secret" not in public_settings
        assert "einvoice_password" not in member_settings
        assert admin_settings["razorpay_key_secret"] == "payment-secret"
        assert admin_settings["einvoice_password"] == "invoice-secret"
    finally:
        db.close()