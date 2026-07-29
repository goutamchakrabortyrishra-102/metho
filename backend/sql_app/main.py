from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging
import time

from .database import Base, SessionLocal, engine
from .models import AssociatePartner, PartnerProduct, User
from .routers import auth, checkout, commerce, compat, directory, health, partner_public, settings
from .security import hash_password

logger = logging.getLogger(__name__)


def _seed_demo_admin():
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.email == "admin@metho.com").first()
        if existing:
            # Preserve custom names; only upgrade legacy seeded label.
            if existing.name == "Demo Admin":
                existing.name = "METHO Admin"
                db.commit()
            return
        admin = User(
            name="METHO Admin",
            email="admin@metho.com",
            phone="9999999999",
            password=hash_password("admin123"),
            role="super_admin",
            is_active=True,
        )
        db.add(admin)
        db.commit()
    finally:
        db.close()


def _seed_demo_directory_data():
    db = SessionLocal()
    try:
        has_partner = db.query(AssociatePartner).first()
        if has_partner:
            return

        partner = AssociatePartner(
            partner_code="MTH-PARTNER-001",
            business_name="METHO City Mart",
            business_type="Retail Shop",
            contact_person="Partner Owner",
            phone="9876543210",
            whatsapp_no="9876543210",
            address="Main Road",
            city="Kolkata",
            state="West Bengal",
            pincode="700001",
            commission_percent=10,
            is_featured=True,
            active=True,
        )
        db.add(partner)
        db.flush()

        db.add_all(
            [
                PartnerProduct(
                    partner_id=partner.id,
                    name="Partner Grocery Combo",
                    category="Grocery",
                    description="Daily essentials pack",
                    price=699,
                    stock=25,
                    approval_status="approved",
                    active=True,
                ),
                PartnerProduct(
                    partner_id=partner.id,
                    name="Household Utility Pack",
                    category="Home & Kitchen",
                    description="Useful products for regular use",
                    price=499,
                    stock=40,
                    approval_status="approved",
                    active=True,
                ),
            ]
        )
        db.commit()
    finally:
        db.close()



def _initialize_database_with_retry(max_attempts: int = 8, delay_seconds: int = 3) -> bool:
    for attempt in range(1, max_attempts + 1):
        try:
            Base.metadata.create_all(bind=engine)
            _seed_demo_admin()
            _seed_demo_directory_data()
            logger.info("SQL starter DB initialization complete")
            return True
        except Exception as exc:
            logger.warning(
                "DB init attempt %s/%s failed: %s",
                attempt,
                max_attempts,
                str(exc),
            )
            if attempt < max_attempts:
                time.sleep(delay_seconds)
    logger.error("DB init failed after retries; service will start in degraded mode")
    return False

app = FastAPI(title="METHO AAY-UPAY ERP v3.0 (SQL Starter)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(commerce.router)
app.include_router(settings.router)
app.include_router(directory.router)
app.include_router(partner_public.router)
app.include_router(checkout.router)
app.include_router(compat.router)


@app.on_event("startup")
def startup_db_init():
    _initialize_database_with_retry()
