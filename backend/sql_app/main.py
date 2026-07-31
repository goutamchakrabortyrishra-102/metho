from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import JSONResponse
from collections import defaultdict, deque
from threading import Lock
import os
import logging
import time

from .database import Base, SessionLocal, engine
from .models import AssociatePartner, PartnerProduct, User
from .routers import auth, checkout, commerce, compat, directory, health, partner_public, settings
from .security import hash_password

logger = logging.getLogger(__name__)


def _csv_env(name: str, default: list[str]) -> list[str]:
    raw = (os.getenv(name, "") or "").strip()
    if not raw:
        return default
    values = [item.strip() for item in raw.split(",")]
    return [item for item in values if item]


def _int_env(name: str, default: int) -> int:
    try:
        value = int((os.getenv(name, "") or "").strip())
        return value if value > 0 else default
    except Exception:
        return default


DEFAULT_CORS_ORIGINS = [
    "https://methoaayupay.com",
    "https://www.methoaayupay.com",
    "https://metho-bmz.pages.dev",
    "https://*.metho-bmz.pages.dev",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
DEFAULT_ALLOWED_HOSTS = [
    "localhost",
    "127.0.0.1",
    "metho-backend.onrender.com",
    "*.onrender.com",
    "methoaayupay.com",
    "www.methoaayupay.com",
    "*.metho-bmz.pages.dev",
]

CORS_ALLOW_ORIGINS = _csv_env("CORS_ALLOW_ORIGINS", DEFAULT_CORS_ORIGINS)
ALLOWED_HOSTS = _csv_env("ALLOWED_HOSTS", DEFAULT_ALLOWED_HOSTS)

# Request-window limiter for brute-force and upload abuse mitigation.
RATE_LIMIT_WINDOW_SECONDS = _int_env("RATE_LIMIT_WINDOW_SECONDS", 60)
RATE_LIMIT_LOGIN = _int_env("RATE_LIMIT_LOGIN", 20)
RATE_LIMIT_REGISTER = _int_env("RATE_LIMIT_REGISTER", 10)
RATE_LIMIT_PASSWORD = _int_env("RATE_LIMIT_PASSWORD", 8)
RATE_LIMIT_UPLOAD = _int_env("RATE_LIMIT_UPLOAD", 30)

SENSITIVE_RATE_LIMITS: list[tuple[str, int]] = [
    ("/api/login", RATE_LIMIT_LOGIN),
    ("/api/auth/login", RATE_LIMIT_LOGIN),
    ("/api/register", RATE_LIMIT_REGISTER),
    ("/api/auth/register", RATE_LIMIT_REGISTER),
    ("/api/auth/forgot-password", RATE_LIMIT_PASSWORD),
    ("/api/auth/reset-password", RATE_LIMIT_PASSWORD),
    ("/api/upload/", RATE_LIMIT_UPLOAD),
    ("/api/partner/upload/", RATE_LIMIT_UPLOAD),
    ("/api/admin/upload/", RATE_LIMIT_UPLOAD),
]

_rate_limit_store: dict[str, deque[float]] = defaultdict(deque)
_rate_limit_lock = Lock()


def _rate_limit_key(client_ip: str, path: str) -> str:
    return f"{client_ip}:{path}"


def _match_rate_limit(path: str) -> tuple[str, int] | None:
    for prefix, limit in SENSITIVE_RATE_LIMITS:
        if path == prefix or path.startswith(prefix):
            return prefix, limit
    return None


def _is_rate_limited(client_ip: str, path: str, now_ts: float) -> tuple[bool, int]:
    matched = _match_rate_limit(path)
    if not matched:
        return False, 0
    prefix, limit = matched
    key = _rate_limit_key(client_ip, prefix)
    window_start = now_ts - RATE_LIMIT_WINDOW_SECONDS

    with _rate_limit_lock:
        bucket = _rate_limit_store[key]
        while bucket and bucket[0] < window_start:
            bucket.popleft()
        if len(bucket) >= limit:
            retry_after = max(1, int(bucket[0] + RATE_LIMIT_WINDOW_SECONDS - now_ts))
            return True, retry_after
        bucket.append(now_ts)
    return False, 0


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

app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_origin_regex=r"https://([a-z0-9-]+\.)*metho-bmz\.pages\.dev",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    client_ip = request.client.host if request.client and request.client.host else "unknown"
    limited, retry_after = _is_rate_limited(client_ip, request.url.path, time.time())
    if limited:
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": str(retry_after)},
            content={"detail": "Too many requests, please try again shortly."},
        )
    return await call_next(request)


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault("Cross-Origin-Resource-Policy", "same-site")
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    response.headers.setdefault("Cross-Origin-Embedder-Policy", "unsafe-none")
    if request.url.scheme == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
    return response

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
