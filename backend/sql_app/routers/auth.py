import uuid
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

router = APIRouter(prefix="/api", tags=["auth"])

ROOT_DIR = Path(__file__).resolve().parents[2]
WELCOME_DIR = ROOT_DIR / "uploaded_objects" / "welcome_letters"
WELCOME_DIR.mkdir(parents=True, exist_ok=True)

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", SMTP_USERNAME or "no-reply@metho.com")
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "METHO AAY-UPAY")
SMTP_USE_TLS = str(os.getenv("SMTP_USE_TLS", "true")).lower() in {"1", "true", "yes", "y"}


def member_code_for_user(user_id: str) -> str:
    clean = (user_id or "").replace("-", "")
    return f"MTH-{clean[:6].upper()}"


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


@router.post("/register")
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    login_id = str(payload.email or "").strip()
    if not login_id:
        raise HTTPException(status_code=400, detail="Login ID is required")
    if len(str(payload.password or "")) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    existing = db.query(User).filter(User.email == login_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Login ID already registered")

    user = User(
        id=str(uuid.uuid4()),
        name=payload.name,
        email=login_id,
        phone=payload.phone,
        password=hash_password(payload.password),
        role="member",
        is_active=True,
    )
    db.add(user)
    db.commit()

    sponsor_code = (payload.sponsor_code or "").strip().upper()
    if sponsor_code:
        sponsor = None
        users = db.query(User).all()
        for candidate in users:
            if member_code_for_user(candidate.id) == sponsor_code and candidate.id != user.id:
                sponsor = candidate
                break
        if sponsor:
            existing_rel = db.query(UserReferral).filter(UserReferral.user_id == user.id).first()
            if not existing_rel:
                db.add(UserReferral(user_id=user.id, sponsor_user_id=sponsor.id, sponsor_code=sponsor_code))
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
    identifier = str(payload.email or "").strip()
    if not identifier:
        raise HTTPException(status_code=400, detail="Login ID is required")

    user = (
        db.query(User)
        .filter((User.email == identifier) | (User.phone == identifier))
        .first()
    )
    if not user or not verify_password(payload.password, user.password):
        raise HTTPException(status_code=401, detail="Invalid login ID or password")

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


@router.post("/auth/login")
def login_alias(payload: LoginRequest, db: Session = Depends(get_db)):
    return login(payload, db)


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

    user = None
    users = db.query(User).all()
    for candidate in users:
        if member_code_for_user(candidate.id) == normalized:
            user = candidate
            break
    if not user:
        raise HTTPException(status_code=404, detail="Sponsor not found")

    return {
        "name": user.name,
        "member_code": normalized,
        "rank": "Member",
    }
