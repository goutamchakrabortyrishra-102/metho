from pathlib import Path
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from ..database import get_db
from ..models import User, UserReferral
from ..schemas import LoginRequest, RegisterRequest
from ..security import create_token, decode_token, hash_password, verify_password
from ..storage import UPLOADED_OBJECTS_DIR

router = APIRouter(prefix="/api", tags=["auth"])

WELCOME_DIR = UPLOADED_OBJECTS_DIR / "welcome_letters"
WELCOME_DIR.mkdir(parents=True, exist_ok=True)

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", SMTP_USERNAME or "no-reply@metho.com")
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "METHO AAY-UPAY")
SMTP_USE_TLS = str(os.getenv("SMTP_USE_TLS", "true")).lower() in {"1", "true", "yes", "y"}
MEMBER_ID_PREFIX = "MAU"
DEFAULT_ADMIN_SPONSOR_ID = os.getenv("DEFAULT_ADMIN_SPONSOR_ID", "MAU00001").strip().upper()
ADMIN_ROLES = {"super_admin", "company_admin", "admin"}
ADMIN_LOGIN_ID = str(os.getenv("ADMIN_LOGIN_ID", "MTH-ADMIN") or "MTH-ADMIN").strip()


def member_code_for_user(user_id: str) -> str:
    normalized = str(user_id or "").strip().upper()
    if normalized.startswith(MEMBER_ID_PREFIX):
        return normalized
    clean = normalized.replace("-", "")
    return f"MTH-{clean[:6]}"


def _is_member_id(value: str) -> bool:
    text = str(value or "").strip().upper()
    return len(text) == 8 and text.startswith(MEMBER_ID_PREFIX) and text[3:].isdigit()


def _next_member_id(db: Session) -> str:
    max_suffix = 9999
    rows = db.query(User.id).filter(User.id.like(f"{MEMBER_ID_PREFIX}%")).all()
    for row in rows:
        candidate = str((row[0] if row else "") or "").strip().upper()
        if _is_member_id(candidate):
            max_suffix = max(max_suffix, int(candidate[3:]))
    return f"{MEMBER_ID_PREFIX}{max_suffix + 1:05d}"


def _resolve_user_by_identifier(db: Session, identifier: str) -> User | None:
    ref = str(identifier or "").strip().upper()
    if not ref:
        return None

    by_id = db.query(User).filter(User.id == ref).first()
    if by_id:
        return by_id

    by_email = db.query(User).filter(User.email == ref).first()
    if by_email:
        return by_email

    users = db.query(User).all()
    for candidate in users:
        if member_code_for_user(candidate.id) == ref:
            return candidate
    return None


def _resolve_primary_admin_user(db: Session) -> User | None:
    return (
        db.query(User)
        .filter(User.role.in_(list(ADMIN_ROLES)))
        .order_by(User.created_at.asc())
        .first()
    )


def _resolve_default_admin_sponsor(db: Session) -> User | None:
    preferred = _resolve_user_by_identifier(db, DEFAULT_ADMIN_SPONSOR_ID)
    if preferred:
        return preferred

    return _resolve_primary_admin_user(db)


def _resolve_login_user(db: Session, identifier: str, admin_mode: bool = False) -> User | None:
    raw = str(identifier or "").strip()
    if not raw:
        return None

    normalized = raw.upper()
    compact = normalized.replace(" ", "")
    admin_aliases = {
        "ADMIN",
        "MTHADMIN",
        "MTH-ADMIN",
        str(ADMIN_LOGIN_ID or "").strip().upper().replace(" ", ""),
    }
    if admin_mode and compact in {alias for alias in admin_aliases if alias}:
        admin_user = _resolve_primary_admin_user(db)
        if admin_user:
            return admin_user

    direct = _resolve_user_by_identifier(db, normalized)
    if direct:
        return direct

    return (
        db.query(User)
        .filter((User.email == raw) | (User.phone == raw))
        .first()
    )


def _build_login_response(user: User) -> dict:
    token = create_token(user.id, user.role)
    return {
        "token": token,
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "phone": user.phone,
            "role": user.role,
            "member_code": member_code_for_user(user.id),
        },
    }


def _login_user(payload: LoginRequest, db: Session, admin_mode: bool = False) -> dict:
    identifier = str(payload.email or "").strip()
    if not identifier:
        raise HTTPException(status_code=400, detail="Login ID is required")

    user = _resolve_login_user(db, identifier, admin_mode=admin_mode)
    if not user or not verify_password(payload.password, user.password):
        raise HTTPException(status_code=401, detail="Invalid login ID or password")

    is_admin = user.role in ADMIN_ROLES
    if admin_mode and not is_admin:
        raise HTTPException(status_code=403, detail="Admin credentials required")
    if not admin_mode and is_admin:
        raise HTTPException(status_code=403, detail="Admin users must sign in from hidden admin login")

    return _build_login_response(user)


def build_welcome_pdf(user: User) -> str:
    file_name = f"welcome-{user.id}.pdf"
    abs_path = WELCOME_DIR / file_name
    c = canvas.Canvas(str(abs_path), pagesize=A4)
    w, h = A4
    c.setFont("Helvetica-Bold", 18)
    c.drawString(50, h - 70, "Welcome to METHO AAY-UPAY")
    c.setFont("Helvetica", 11)
    c.drawString(50, h - 100, f"Name: {user.name}")
    c.drawString(50, h - 118, f"Email: {user.email}")
    c.drawString(50, h - 136, f"Member Code: {member_code_for_user(user.id)}")
    c.drawString(50, h - 170, "Thank you for registering. Keep this letter for your records.")
    c.drawString(50, h - 188, "For support, contact METHO admin team.")
    c.showPage()
    c.save()
    return f"/api/files/welcome_letters/{file_name}"


def send_welcome_email(to_email: str, user_name: str, member_code: str, welcome_letter_url: str):
    if not SMTP_HOST or not SMTP_USERNAME or not SMTP_PASSWORD:
        return False
    subject = "Welcome to METHO AAY-UPAY"
    html = (
        f"<h2>Welcome, {user_name}</h2>"
        f"<p>Your member code: <b>{member_code}</b></p>"
        f"<p>Welcome letter PDF: <a href='{welcome_letter_url}'>{welcome_letter_url}</a></p>"
    )

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_FROM_EMAIL}>"
    msg["To"] = to_email
    msg.attach(MIMEText(html, "html", "utf-8"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
            if SMTP_USE_TLS:
                server.starttls()
            server.login(SMTP_USERNAME, SMTP_PASSWORD)
            server.sendmail(SMTP_FROM_EMAIL, [to_email], msg.as_string())
        return True
    except Exception:
        return False


def get_current_user(
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization token missing")

    token = authorization.split(" ", 1)[1]
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.query(User).filter(User.id == payload["user_id"]).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def get_current_user_optional(
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
) -> User | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None

    token = authorization.split(" ", 1)[1]
    try:
        payload = decode_token(token)
    except Exception:
        return None

    user = db.query(User).filter(User.id == payload.get("user_id")).first()
    return user


@router.post("/register")
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    requested_member_id = str(payload.email or "").strip().upper()
    if len(str(payload.password or "")) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    member_id = requested_member_id if _is_member_id(requested_member_id) else _next_member_id(db)
    if db.query(User).filter(User.id == member_id).first() or db.query(User).filter(User.email == member_id).first():
        member_id = _next_member_id(db)

    user = User(
        id=member_id,
        name=payload.name,
        email=member_id,
        phone=payload.phone,
        password=hash_password(payload.password),
        role="member",
        is_active=True,
    )
    db.add(user)
    db.commit()

    requested_sponsor = (payload.sponsor_code or "").strip().upper()
    sponsor_user = _resolve_user_by_identifier(db, requested_sponsor) if requested_sponsor else None
    if not sponsor_user:
        sponsor_user = _resolve_default_admin_sponsor(db)

    sponsor_code = member_code_for_user(sponsor_user.id) if sponsor_user else requested_sponsor
    if sponsor_user and sponsor_user.id != user.id:
        existing_rel = db.query(UserReferral).filter(UserReferral.user_id == user.id).first()
        if not existing_rel:
            db.add(UserReferral(user_id=user.id, sponsor_user_id=sponsor_user.id, sponsor_code=sponsor_code))
            db.commit()

    welcome_letter_url = build_welcome_pdf(user)
    member_code = member_code_for_user(user.id)
    send_welcome_email(user.email, user.name, member_code, welcome_letter_url)

    token = create_token(user.id, user.role)
    return {
        "token": token,
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "phone": user.phone,
            "role": user.role,
            "member_code": member_code,
            "sponsor_code": sponsor_code,
        },
        "welcome_letter_url": welcome_letter_url,
    }


@router.post("/auth/register")
def register_alias(payload: RegisterRequest, db: Session = Depends(get_db)):
    return register(payload, db)


@router.post("/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    return _login_user(payload, db, admin_mode=False)


@router.post("/auth/login")
def login_alias(payload: LoginRequest, db: Session = Depends(get_db)):
    return _login_user(payload, db, admin_mode=False)


@router.post("/auth/admin/login")
def admin_login(payload: LoginRequest, db: Session = Depends(get_db)):
    return _login_user(payload, db, admin_mode=True)


@router.post("/admin/login")
def admin_login_alias(payload: LoginRequest, db: Session = Depends(get_db)):
    return _login_user(payload, db, admin_mode=True)


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "name": current_user.name,
        "email": current_user.email,
        "phone": current_user.phone,
        "role": current_user.role,
        "member_code": member_code_for_user(current_user.id),
    }


@router.get("/auth/me")
def me_alias(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "name": current_user.name,
        "email": current_user.email,
        "phone": current_user.phone,
        "role": current_user.role,
        "member_code": member_code_for_user(current_user.id),
        "first_partner_cashback_credited": False,
    }


@router.get("/auth/sponsor-info/{code}")
def sponsor_info(code: str, db: Session = Depends(get_db)):
    normalized = (code or "").strip().upper()
    if not normalized:
        raise HTTPException(status_code=404, detail="Sponsor not found")

    user = _resolve_user_by_identifier(db, normalized)
    if not user and normalized == DEFAULT_ADMIN_SPONSOR_ID:
        user = _resolve_default_admin_sponsor(db)
    if not user:
        raise HTTPException(status_code=404, detail="Sponsor not found")

    return {
        "name": user.name,
        "member_code": normalized,
        "rank": "Member",
    }
