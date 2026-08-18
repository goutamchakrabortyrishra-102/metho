import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def now_utc():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    phone: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="member")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    orders: Mapped[list["Order"]] = relationship("Order", back_populates="user", cascade="all, delete-orphan")


class Product(Base):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(120), nullable=False, default="General")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    price: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    stock: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    orders: Mapped[list["Order"]] = relationship("Order", back_populates="product")


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    product_id: Mapped[str] = mapped_column(String(36), ForeignKey("products.id"), nullable=False, index=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    unit_price: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    total_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="created")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    user: Mapped[User] = relationship("User", back_populates="orders")
    product: Mapped[Product] = relationship("Product", back_populates="orders")


class AssociatePartner(Base):
    __tablename__ = "associate_partners"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    partner_code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False, index=True)
    business_name: Mapped[str] = mapped_column(String(255), nullable=False)
    business_type: Mapped[str] = mapped_column(String(80), nullable=False, default="Retail Shop")
    contact_person: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    phone: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    email: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    whatsapp_no: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    address: Mapped[str] = mapped_column(Text, nullable=False, default="")
    city: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    state: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    pincode: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    gst_no: Mapped[str] = mapped_column(String(30), nullable=False, default="")
    upi_id: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    logo_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    commission_percent: Mapped[float] = mapped_column(Float, nullable=False, default=10)
    total_sales: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    is_featured: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class PartnerProduct(Base):
    __tablename__ = "partner_products"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    partner_id: Mapped[str] = mapped_column(String(36), ForeignKey("associate_partners.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(120), nullable=False, default="General")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    image_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    price: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    stock: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    approval_status: Mapped[str] = mapped_column(String(30), nullable=False, default="approved")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class PartnerRequest(Base):
    __tablename__ = "partner_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    business_name: Mapped[str] = mapped_column(String(255), nullable=False)
    business_type: Mapped[str] = mapped_column(String(80), nullable=False, default="Retail Shop")
    contact_person: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    phone: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    email: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    whatsapp_no: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    address: Mapped[str] = mapped_column(Text, nullable=False, default="")
    city: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    state: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    pincode: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    gst_no: Mapped[str] = mapped_column(String(30), nullable=False, default="")
    upi_id: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    business_description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    commission_percent_ask: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class PublicOrder(Base):
    __tablename__ = "public_orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    customer_user_id: Mapped[str] = mapped_column(String(36), nullable=False, default="")
    member_ref: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    shipping_address: Mapped[str] = mapped_column(Text, nullable=False, default="")
    payment_method: Mapped[str] = mapped_column(String(30), nullable=False, default="upi")
    txn_id: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    payment_screenshot_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    payer_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    items_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    total_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending_approval")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class PaymentRecord(Base):
    __tablename__ = "payment_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    order_id: Mapped[str] = mapped_column(String(36), ForeignKey("public_orders.id"), nullable=False, unique=True, index=True)
    provider: Mapped[str] = mapped_column(String(30), nullable=False, default="razorpay")
    payment_id: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    provider_order_id: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="INR")
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="verified")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class InvoiceRecord(Base):
    __tablename__ = "invoice_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    order_id: Mapped[str] = mapped_column(String(36), ForeignKey("public_orders.id"), nullable=False, unique=True, index=True)
    invoice_no: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class FinancialLedgerEntry(Base):
    __tablename__ = "financial_ledger_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    ledger_id: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    reference_id: Mapped[str] = mapped_column(String(160), nullable=False, unique=True, index=True)
    partner_id: Mapped[str] = mapped_column(String(36), nullable=False, default="", index=True)
    order_id: Mapped[str] = mapped_column(String(36), nullable=False, default="", index=True)
    transaction_type: Mapped[str] = mapped_column(String(60), nullable=False, default="ADJUSTMENT")
    credit: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    debit: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    balance: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="posted")
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)


class RewardRecord(Base):
    __tablename__ = "reward_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    order_id: Mapped[str] = mapped_column(String(36), ForeignKey("public_orders.id"), nullable=False, index=True)
    partner_id: Mapped[str] = mapped_column(String(36), nullable=False, default="", index=True)
    reward_type: Mapped[str] = mapped_column(String(60), nullable=False)
    reference_id: Mapped[str] = mapped_column(String(160), nullable=False, unique=True, index=True)
    amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="posted")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value_json: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class ProductMeta(Base):
    __tablename__ = "product_meta"

    product_id: Mapped[str] = mapped_column(String(36), ForeignKey("products.id"), primary_key=True)
    product_type: Mapped[str] = mapped_column(String(30), nullable=False, default="metho")
    image_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    mrp: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    discount_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    gst_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class UserReferral(Base):
    __tablename__ = "user_referrals"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), primary_key=True)
    sponsor_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    sponsor_code: Mapped[str] = mapped_column(String(30), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
