import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

CRM_STAGE_NEW = "NEW"
CRM_STAGE_CONTACTED = "CONTACTED"
CRM_STAGE_INTERESTED = "INTERESTED"
CRM_STAGE_QUALIFIED = "QUALIFIED"
CRM_STAGE_APPLICATION = "APPLICATION"
CRM_STAGE_APPROVED = "APPROVED"
CRM_STAGE_CONVERTED = "CONVERTED"
CRM_STAGE_LOST = "LOST"

CRM_ALLOWED_STAGES = {
    CRM_STAGE_NEW,
    CRM_STAGE_CONTACTED,
    CRM_STAGE_INTERESTED,
    CRM_STAGE_QUALIFIED,
    CRM_STAGE_APPLICATION,
    CRM_STAGE_APPROVED,
    CRM_STAGE_CONVERTED,
    CRM_STAGE_LOST,
}


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


class CRMLead(Base):
    __tablename__ = "crm_leads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True, default=lambda: f"CRM-{uuid.uuid4().hex[:8].upper()}")
    business_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    business_type: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    contact_person: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    phone: Mapped[str] = mapped_column(String(50), nullable=False, default="", index=True)
    whatsapp_no: Mapped[str] = mapped_column(String(50), nullable=False, default="", index=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    address: Mapped[str] = mapped_column(Text, nullable=False, default="")
    city: Mapped[str] = mapped_column(String(120), nullable=False, default="", index=True)
    state: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    pincode: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    source: Mapped[str] = mapped_column(String(80), nullable=False, default="manual")
    status: Mapped[str] = mapped_column(String(40), nullable=False, default=CRM_STAGE_NEW, index=True)
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    priority_bucket: Mapped[str] = mapped_column(String(20), nullable=False, default="Cold")
    tags_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    member_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    partner_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("associate_partners.id"), nullable=True, index=True)
    partner_request_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    converted_partner_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("associate_partners.id"), nullable=True, index=True)
    assigned_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    last_contact_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    next_follow_up_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    follow_up_status: Mapped[str] = mapped_column(String(30), nullable=False, default="Pending")
    created_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc, index=True)

    member: Mapped[User | None] = relationship("User", foreign_keys=[member_user_id])
    creator: Mapped[User | None] = relationship("User", foreign_keys=[created_by_user_id])
    converted_partner: Mapped[AssociatePartner | None] = relationship("AssociatePartner", foreign_keys=[converted_partner_id])
    assignee: Mapped[User | None] = relationship("User", foreign_keys=[assigned_user_id])


class CRMLeadActivity(Base):
    __tablename__ = "crm_lead_activities"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id: Mapped[str] = mapped_column(String(36), ForeignKey("crm_leads.id"), nullable=False, index=True)
    activity_type: Mapped[str] = mapped_column(String(40), nullable=False, default="note")
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    actor_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)


class CRMVoiceCallAttempt(Base):
    __tablename__ = "crm_voice_call_attempts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("crm_leads.id"), nullable=True, index=True)
    target_type: Mapped[str] = mapped_column(String(20), nullable=False, default="LEAD", index=True)
    target_id: Mapped[str] = mapped_column(String(36), nullable=False, default="", index=True)
    target_phone: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    call_purpose: Mapped[str] = mapped_column(String(40), nullable=False, default="NEW_LEAD_QUALIFICATION", index=True)
    campaign_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("crm_voice_call_campaigns.id"), nullable=True, index=True)
    provider: Mapped[str] = mapped_column(String(40), nullable=False, default="mock")
    provider_call_id: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    idempotency_key: Mapped[str] = mapped_column(String(160), nullable=False, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="CALL_PENDING", index=True)
    outcome: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    registration_type: Mapped[str] = mapped_column(String(20), nullable=False, default="OTHER")
    language: Mapped[str] = mapped_column(String(8), nullable=False, default="")
    qualification_result_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    attempted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)
    connected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_code: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    error_message: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class CRMVoiceCallCampaign(Base):
    __tablename__ = "crm_voice_call_campaigns"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(160), nullable=False, unique=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)
    call_purpose: Mapped[str] = mapped_column(String(40), nullable=False)
    start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    allowed_call_start: Mapped[str] = mapped_column(String(5), nullable=False, default="09:00")
    allowed_call_end: Mapped[str] = mapped_column(String(5), nullable=False, default="18:00")
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    retry_delay_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    supported_languages_json: Mapped[str] = mapped_column(Text, nullable=False, default='["bn", "hi"]')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class CRMWhatsAppAISuggestion(Base):
    __tablename__ = "crm_whatsapp_ai_suggestions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id: Mapped[str] = mapped_column(String(36), ForeignKey("crm_leads.id"), nullable=False, index=True)
    activity_id: Mapped[str] = mapped_column(String(36), ForeignKey("crm_lead_activities.id"), nullable=False, unique=True, index=True)
    suggested_reply: Mapped[str] = mapped_column(Text, nullable=False, default="")
    human_handoff_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    handoff_reason: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    provider_used: Mapped[str] = mapped_column(String(50), nullable=False, default="fallback")
    model_used: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING", index=True)
    sent_reply: Mapped[str] = mapped_column(Text, nullable=False, default="")
    error_message: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class CRMFollowUp(Base):
    __tablename__ = "crm_follow_ups"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id: Mapped[str] = mapped_column(String(36), ForeignKey("crm_leads.id"), nullable=False, index=True)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="Pending")
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class CRMTask(Base):
    __tablename__ = "crm_tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="Pending", index=True)
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default="Medium")
    lead_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("crm_leads.id"), nullable=True, index=True)
    customer_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    assigned_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class CRMLeadSnapshot(Base):
    __tablename__ = "crm_lead_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id: Mapped[str] = mapped_column(String(36), ForeignKey("crm_leads.id"), nullable=False, index=True)
    snapshot_type: Mapped[str] = mapped_column(String(40), nullable=False, default="member_profile")
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)
