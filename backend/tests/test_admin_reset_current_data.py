import sys
from pathlib import Path

from sqlalchemy import event
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AppSetting, FinancialLedgerEntry, InvoiceRecord, Order, PaymentRecord, Product, PublicOrder, RewardRecord, User
from sql_app.routers.compat import _clear_current_admin_transaction_data


def make_session():
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_clear_current_admin_transaction_data_keeps_master_data_and_clears_current_history():
    db = make_session()
    try:
        admin = User(name="Admin", email="admin@example.com", phone="9999999999", password="hash", role="super_admin")
        product = Product(name="Demo Product", category="General", price=100, stock=10)
        db.add_all([admin, product])
        db.flush()

        db.add(PublicOrder(id="order-1", customer_user_id=admin.id, member_ref="M1", total_amount=100, items_json="[]"))
        db.flush()

        db.add_all([
            PaymentRecord(order_id="order-1", payment_id="pay-1", provider_order_id="po-1", amount=100),
            InvoiceRecord(order_id="order-1", invoice_no="INV-1", payload_json="{}"),
            FinancialLedgerEntry(ledger_id="ledger-1", reference_id="ref-1", partner_id="", order_id="order-1", credit=100, debit=0, balance=100),
            RewardRecord(order_id="order-1", partner_id="", reward_type="referral", reference_id="reward-1", amount=25),
            Order(user_id=admin.id, product_id=product.id, quantity=2, unit_price=100, total_amount=200),
            AppSetting(key="transport_trip:test-1", value_json='{"id":"test-1"}'),
            AppSetting(key="company_inventory:test-product", value_json='{"product_id":"test-product"}'),
            AppSetting(key="product_code:test-product", value_json='{"code":"DEMO"}'),
        ])
        db.commit()

        result = _clear_current_admin_transaction_data(db)

        assert db.query(PublicOrder).count() == 0
        assert db.query(PaymentRecord).count() == 0
        assert db.query(InvoiceRecord).count() == 0
        assert db.query(FinancialLedgerEntry).count() == 0
        assert db.query(RewardRecord).count() == 0
        assert db.query(Order).count() == 0
        assert db.query(Product).filter(Product.id == product.id).count() == 1
        assert db.query(User).filter(User.role == "super_admin").count() == 1
        assert db.query(AppSetting).filter(AppSetting.key.like("transport_trip:%")).count() == 0
        assert db.query(AppSetting).filter(AppSetting.key.like("company_inventory:%")).count() == 0
        assert db.query(AppSetting).filter(AppSetting.key.like("product_code:%")).count() == 0
        assert result["deleted_public_orders"] >= 1
    finally:
        db.close()
