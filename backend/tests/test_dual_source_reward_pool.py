import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AssociatePartner, AppSetting, PartnerProduct, PublicOrder, User, UserReferral
from sql_app.routers.compat import (
    _calculate_sql_pool,
    _load_user_wallet,
    _settle_completed_smart_cycles,
    admin_approve_order,
)
from sql_app.security import hash_password


def _make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def _settings():
    return {
        "metho_commission_percent": 10,
        "smart_cycle_bonus_percent": 10,
        "leader_match_percent": 50,
        "commission_split_member_pool": 40,
        "commission_split_leader_pool": 20,
        "commission_split_mps_fund": 10,
        "commission_split_company_fund": 20,
        "commission_split_technology_reserve": 10,
    }


def _patch_settings(monkeypatch):
    monkeypatch.setattr("sql_app.routers.compat.load_settings", lambda db: _settings())


def _add_partner_sale(db, partner_id, amount=100):
    product = PartnerProduct(
        partner_id=partner_id,
        name="Partner Service",
        category="Service",
        price=amount,
        stock=5,
        approval_status="approved",
        active=True,
    )
    db.add(product)
    db.flush()
    return product


def _add_order(db, member_id, items, created_at=None, status="paid"):
    order = PublicOrder(
        customer_user_id=member_id,
        items_json=json.dumps(items),
        total_amount=sum(float(item.get("subtotal") or 0) for item in items),
        status=status,
        payment_method="cash",
        created_at=created_at or datetime.now(timezone.utc),
    )
    db.add(order)
    db.flush()
    return order


def test_metho_and_partner_sales_feed_common_reward_pools_but_only_metho_is_cycle_eligible(monkeypatch):
    db = _make_session()
    _patch_settings(monkeypatch)
    try:
        partner = AssociatePartner(partner_code="MTH-PARTNER-POOL", business_name="Pool Partner", commission_percent=20)
        member = User(name="Member", email="pool@example.com", phone="9999999999", password=hash_password("secret1"), role="member", is_active=True)
        db.add_all([partner, member])
        db.flush()
        partner_product = _add_partner_sale(db, partner.id)
        _add_order(db, member.id, [
            {"product_id": "metho-product", "product_type": "metho", "subtotal": 100, "pre_tax": 100},
            {"product_id": partner_product.id, "product_type": "associate_partner", "subtotal": 100},
        ])
        db.commit()

        pool = _calculate_sql_pool(db, datetime.now(timezone.utc).strftime("%Y-%m"))
        assert pool["commission_pool"] == 30.0
        assert pool["member_pool"] == 12.0
        assert pool["leader_pool"] == 6.0
        assert pool["mps_fund"] == 3.0
        assert pool["company_fund"] == 6.0
        assert pool["technology_reserve"] == 3.0
        assert sum(pool[key] for key in ("member_pool", "leader_pool", "mps_fund", "company_fund", "technology_reserve")) == pool["commission_pool"]
    finally:
        db.close()


def test_partner_only_has_no_smart_cycle_or_leader_match(monkeypatch):
    db = _make_session()
    _patch_settings(monkeypatch)
    try:
        sponsor = User(name="Sponsor", email="sponsor@example.com", phone="9000000000", password=hash_password("secret1"), role="member", is_active=True)
        member = User(name="Member", email="partner-only@example.com", phone="9000000001", password=hash_password("secret1"), role="member", is_active=True)
        partner = AssociatePartner(partner_code="MTH-PARTNER-ONLY", business_name="Partner", commission_percent=20)
        db.add_all([sponsor, member, partner])
        db.flush()
        db.add(UserReferral(user_id=member.id, sponsor_user_id=sponsor.id, sponsor_code="SPONSOR"))
        product = _add_partner_sale(db, partner.id)
        _add_order(db, member.id, [{"product_id": product.id, "product_type": "associate_partner", "subtotal": 100}])
        db.commit()

        assert _settle_completed_smart_cycles(db, member.id, datetime.now(timezone.utc) + timedelta(days=40)) is None
        assert _load_user_wallet(db, member.id)["balance"] == 0.0
        assert _load_user_wallet(db, sponsor.id)["balance"] == 0.0
        pool = _calculate_sql_pool(db, datetime.now(timezone.utc).strftime("%Y-%m"))
        assert pool["commission_pool"] == 20.0
    finally:
        db.close()


def test_metho_smart_cycle_and_leader_match_use_configured_percentages(monkeypatch):
    db = _make_session()
    _patch_settings(monkeypatch)
    try:
        sponsor = User(name="Sponsor", email="sponsor2@example.com", phone="9000000010", password=hash_password("secret1"), role="member", is_active=True)
        member = User(name="Member", email="metho-only@example.com", phone="9000000011", password=hash_password("secret1"), role="member", is_active=True)
        db.add_all([sponsor, member])
        db.flush()
        db.add(UserReferral(user_id=member.id, sponsor_user_id=sponsor.id, sponsor_code="SPONSOR2"))
        cycle_start = datetime.now(timezone.utc) - timedelta(days=40)
        _add_order(db, member.id, [{"product_id": "activation", "product_type": "metho", "subtotal": 118, "pre_tax": 100}], cycle_start)
        slot_five_sale = datetime.now(timezone.utc) - timedelta(days=10)
        _add_order(db, member.id, [{"product_id": "metho-product", "product_type": "metho", "subtotal": 118, "pre_tax": 100, "gst_percent": 18}], slot_five_sale)
        db.commit()

        settled = _settle_completed_smart_cycles(db, member.id, datetime.now(timezone.utc))
        assert settled["bonus_paid"] == 10.0
        assert settled["direct_sponsor_match_paid"] == 5.0
        assert _load_user_wallet(db, member.id)["balance"] == 10.0
        assert _load_user_wallet(db, sponsor.id)["balance"] == 5.0
    finally:
        db.close()


def test_duplicate_order_approval_does_not_duplicate_rewards(monkeypatch):
    db = _make_session()
    _patch_settings(monkeypatch)
    try:
        member = User(name="Member", email="duplicate@example.com", phone="9000000020", password=hash_password("secret1"), role="member", is_active=True)
        db.add(member)
        db.flush()
        order = _add_order(db, member.id, [{"product_id": "metho-product", "product_type": "metho", "subtotal": 100, "pre_tax": 100}], status="pending_approval")
        db.commit()

        first = admin_approve_order(order.id, {}, db, SimpleNamespace(role="super_admin", id="ADMIN"))
        assert first["rewards_earned"]["commission_pool"] == 10.0
        with pytest.raises(Exception):
            admin_approve_order(order.id, {}, db, SimpleNamespace(role="super_admin", id="ADMIN"))
    finally:
        db.close()
