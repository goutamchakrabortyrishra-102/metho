from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import JSONResponse
from collections import defaultdict, deque
from threading import Lock
import os
import logging
import time

from .database import Base, SessionLocal, engine
from .models import AssociatePartner, PartnerProduct, User
from .routers import auth, checkout, commerce, compat, company_inventory, crm, directory, direct_booking, health, meta_ads, partner_public, rider, settings
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
for _required_origin in ("https://methoaayupay.com", "https://www.methoaayupay.com", "https://metho-bmz.pages.dev"):
    if _required_origin not in CORS_ALLOW_ORIGINS:
        CORS_ALLOW_ORIGINS.append(_required_origin)
ALLOW_CREDENTIALS = "*" not in CORS_ALLOW_ORIGINS
ALLOWED_HOSTS = _csv_env("ALLOWED_HOSTS", DEFAULT_ALLOWED_HOSTS)

# Request-window limiter for brute-force and upload abuse mitigation.
RATE_LIMIT_WINDOW_SECONDS = _int_env("RATE_LIMIT_WINDOW_SECONDS", 60)
RATE_LIMIT_LOGIN = _int_env("RATE_LIMIT_LOGIN", 20)
RATE_LIMIT_REGISTER = _int_env("RATE_LIMIT_REGISTER", 10)
RATE_LIMIT_PASSWORD = _int_env("RATE_LIMIT_PASSWORD", 8)
RATE_LIMIT_UPLOAD = _int_env("RATE_LIMIT_UPLOAD", 30)
RATE_LIMIT_STORE_MAX_KEYS = max(1000, _int_env("RATE_LIMIT_STORE_MAX_KEYS", 20000))
RATE_LIMIT_CLEANUP_INTERVAL_SECONDS = _int_env("RATE_LIMIT_CLEANUP_INTERVAL_SECONDS", 300)
GZIP_MINIMUM_SIZE = _int_env("GZIP_MINIMUM_SIZE", 1024)
GZIP_COMPRESS_LEVEL = max(1, min(9, _int_env("GZIP_COMPRESS_LEVEL", 6)))
ENABLE_BANDWIDTH_METRICS = str(os.getenv("ENABLE_BANDWIDTH_METRICS", "1") or "1").strip().lower() not in {"0", "false", "off", "no"}
BANDWIDTH_METRICS_WINDOW_MINUTES = _int_env("BANDWIDTH_METRICS_WINDOW_MINUTES", 240)
BANDWIDTH_METRICS_MAX_EVENTS = max(1000, _int_env("BANDWIDTH_METRICS_MAX_EVENTS", 5000))
METRICS_API_KEY = str(os.getenv("METRICS_API_KEY", "") or "").strip()
ADMIN_LOGIN_ID = str(os.getenv("ADMIN_LOGIN_ID", "admin@metho.com") or "admin@metho.com").strip()
ADMIN_PASSWORD = str(os.getenv("ADMIN_PASSWORD", "admin123") or "admin123")
ADMIN_DISPLAY_NAME = str(os.getenv("ADMIN_DISPLAY_NAME", "METHO Admin") or "METHO Admin").strip()
ADMIN_PHONE = str(os.getenv("ADMIN_PHONE", "9999999999") or "9999999999").strip()

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
_rate_limit_last_cleanup = 0.0
_bandwidth_events: deque[dict] = deque(maxlen=BANDWIDTH_METRICS_MAX_EVENTS)
_bandwidth_lock = Lock()

PUBLIC_RESOURCE_PATH_PREFIXES = (
    "/api/files/",
    "/api/public-files/",
    "/api/products/",
)


def _rate_limit_key(client_ip: str, path: str) -> str:
    return f"{client_ip}:{path}"


def _cleanup_rate_limit_store(now_ts: float) -> None:
    global _rate_limit_last_cleanup

    interval = max(30, int(RATE_LIMIT_CLEANUP_INTERVAL_SECONDS or 300))
    if (now_ts - _rate_limit_last_cleanup) < interval:
        return

    window_start = now_ts - RATE_LIMIT_WINDOW_SECONDS
    keys = list(_rate_limit_store.keys())
    removed = 0

    for key in keys:
        bucket = _rate_limit_store.get(key)
        if not bucket:
            _rate_limit_store.pop(key, None)
            removed += 1
            continue
        while bucket and bucket[0] < window_start:
            bucket.popleft()
        if not bucket:
            _rate_limit_store.pop(key, None)
            removed += 1

    # Safety valve for traffic spikes with massive unique IP churn.
    if len(_rate_limit_store) > RATE_LIMIT_STORE_MAX_KEYS:
        sorted_keys = sorted(
            _rate_limit_store.keys(),
            key=lambda k: _rate_limit_store[k][-1] if _rate_limit_store.get(k) else 0,
        )
        excess = len(_rate_limit_store) - RATE_LIMIT_STORE_MAX_KEYS
        for key in sorted_keys[:excess]:
            _rate_limit_store.pop(key, None)
            removed += 1

    _rate_limit_last_cleanup = now_ts
    if removed:
        logger.info("Rate-limit store cleanup removed %s stale keys", removed)


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
        _cleanup_rate_limit_store(now_ts)
        bucket = _rate_limit_store[key]
        while bucket and bucket[0] < window_start:
            bucket.popleft()
        if len(bucket) >= limit:
            retry_after = max(1, int(bucket[0] + RATE_LIMIT_WINDOW_SECONDS - now_ts))
            return True, retry_after
        bucket.append(now_ts)
    return False, 0


def _safe_int(value, fallback: int = 0) -> int:
    try:
        parsed = int(str(value or "0").strip())
        return parsed if parsed >= 0 else fallback
    except Exception:
        return fallback


def _capture_bandwidth_event(path: str, route_key: str, status_code: int, response_bytes: int) -> None:
    if not ENABLE_BANDWIDTH_METRICS:
        return
    now_ts = time.time()
    event = {
        "ts": now_ts,
        "path": str(path or ""),
        "route": str(route_key or path or "unknown"),
        "status": int(status_code or 0),
        "bytes": max(0, int(response_bytes or 0)),
    }
    with _bandwidth_lock:
        _bandwidth_events.append(event)


def _summarize_bandwidth(minutes: int = 60, top: int = 20) -> dict:
    safe_minutes = max(1, int(minutes or 60))
    safe_top = max(1, min(100, int(top or 20)))
    cutoff = time.time() - (safe_minutes * 60)

    grouped: dict[str, dict] = {}
    total_bytes = 0
    total_hits = 0

    with _bandwidth_lock:
        for event in list(_bandwidth_events):
            if float(event.get("ts") or 0) < cutoff:
                continue
            route = str(event.get("route") or event.get("path") or "unknown")
            item = grouped.setdefault(
                route,
                {
                    "route": route,
                    "hits": 0,
                    "bytes": 0,
                    "avg_bytes": 0,
                    "status_2xx": 0,
                    "status_3xx": 0,
                    "status_4xx": 0,
                    "status_5xx": 0,
                },
            )
            byte_count = _safe_int(event.get("bytes"), 0)
            status = _safe_int(event.get("status"), 0)
            item["hits"] += 1
            item["bytes"] += byte_count
            if 200 <= status <= 299:
                item["status_2xx"] += 1
            elif 300 <= status <= 399:
                item["status_3xx"] += 1
            elif 400 <= status <= 499:
                item["status_4xx"] += 1
            elif status >= 500:
                item["status_5xx"] += 1

            total_bytes += byte_count
            total_hits += 1

    rows = list(grouped.values())
    for row in rows:
        hits = max(1, int(row.get("hits") or 0))
        row["avg_bytes"] = int(round(float(row.get("bytes") or 0) / hits))

    rows.sort(key=lambda r: (int(r.get("bytes") or 0), int(r.get("hits") or 0)), reverse=True)
    top_rows = rows[:safe_top]

    return {
        "window_minutes": safe_minutes,
        "event_buffer_size": len(_bandwidth_events),
        "totals": {
            "hits": total_hits,
            "bytes": total_bytes,
            "megabytes": round(total_bytes / (1024 * 1024), 3),
            "gigabytes": round(total_bytes / (1024 * 1024 * 1024), 4),
        },
        "top_routes": top_rows,
    }


def _seed_demo_admin():
    db = SessionLocal()
    try:
        configured_login = str(ADMIN_LOGIN_ID or "").strip()
        configured_login_lower = configured_login.lower()

        # First prefer the configured hidden admin account by login/email, even if role was downgraded.
        existing_by_login = None
        if configured_login:
            existing_by_login = db.query(User).filter(User.email == configured_login).first()
        if not existing_by_login and configured_login_lower:
            existing_by_login = db.query(User).filter(User.email == configured_login_lower).first()

        if existing_by_login:
            existing_by_login.name = ADMIN_DISPLAY_NAME or existing_by_login.name
            if configured_login:
                existing_by_login.email = configured_login
            existing_by_login.phone = ADMIN_PHONE or existing_by_login.phone
            existing_by_login.role = "super_admin"
            existing_by_login.is_active = True
            if ADMIN_PASSWORD:
                existing_by_login.password = hash_password(ADMIN_PASSWORD)
            db.commit()
            return

        existing = (
            db.query(User)
            .filter(User.role.in_(["super_admin", "company_admin", "admin"]))
            .order_by(User.created_at.asc())
            .first()
        )
        if existing:
            existing.name = ADMIN_DISPLAY_NAME or existing.name
            existing.email = ADMIN_LOGIN_ID or existing.email
            existing.phone = ADMIN_PHONE or existing.phone
            existing.role = existing.role or "super_admin"
            if ADMIN_PASSWORD:
                existing.password = hash_password(ADMIN_PASSWORD)
            db.commit()
            return
        admin = User(
            name=ADMIN_DISPLAY_NAME,
            email=ADMIN_LOGIN_ID,
            phone=ADMIN_PHONE,
            password=hash_password(ADMIN_PASSWORD),
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
    allow_credentials=ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(
    GZipMiddleware,
    minimum_size=max(256, int(GZIP_MINIMUM_SIZE or 1024)),
    compresslevel=int(GZIP_COMPRESS_LEVEL),
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
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)")
    resource_policy = "cross-origin" if request.url.path.startswith(PUBLIC_RESOURCE_PATH_PREFIXES) else "same-site"
    response.headers.setdefault("Cross-Origin-Resource-Policy", resource_policy)
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    response.headers.setdefault("Cross-Origin-Embedder-Policy", "unsafe-none")
    if request.url.scheme == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
    return response


@app.middleware("http")
async def bandwidth_metrics_middleware(request: Request, call_next):
    response = await call_next(request)
    if ENABLE_BANDWIDTH_METRICS and request.url.path.startswith("/api/"):
        route_path = request.scope.get("route").path if request.scope.get("route") else request.url.path
        content_len = _safe_int(response.headers.get("content-length"), 0)
        _capture_bandwidth_event(
            path=request.url.path,
            route_key=str(route_path or request.url.path),
            status_code=int(getattr(response, "status_code", 0) or 0),
            response_bytes=content_len,
        )
    return response


@app.get("/api/admin/system-bandwidth")
def admin_system_bandwidth(
    minutes: int = 60,
    top: int = 20,
    x_metrics_key: str | None = Header(default=None, alias="X-Metrics-Key"),
):
    if METRICS_API_KEY and str(x_metrics_key or "").strip() != METRICS_API_KEY:
        raise HTTPException(status_code=403, detail="Metrics key required")
    return _summarize_bandwidth(minutes=minutes, top=top)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(commerce.router)
app.include_router(company_inventory.router)
app.include_router(settings.router)
app.include_router(directory.router)
app.include_router(partner_public.router)
app.include_router(rider.router)
app.include_router(direct_booking.router)
app.include_router(checkout.router)
app.include_router(crm.router)
app.include_router(meta_ads.router)
app.include_router(compat.router)


@app.on_event("startup")
def startup_db_init():
    _initialize_database_with_retry()
