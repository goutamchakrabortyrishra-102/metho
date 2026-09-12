from pathlib import Path
import os
import json
from datetime import datetime, timedelta, timezone
import logging
import smtplib
import uuid
import re
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from ..database import get_db
from ..crm_automation import record_lifecycle_event_by_phone
from ..crm_identity import link_lead_to_registration
from ..models import AppSetting, CRMFollowUp, User, UserReferral
from ..schemas import LoginRequest, RegisterRequest
from ..security import create_token, decode_token, hash_password, verify_password
from ..storage import UPLOADED_OBJECTS_DIR

router = APIRouter(prefix="/api", tags=["auth"])
logger = logging.getLogger(__name__)

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
METHO_SUPPORT_WHATSAPP = "+91 9163530078"
DEFAULT_ADMIN_SPONSOR_ID = os.getenv("DEFAULT_ADMIN_SPONSOR_ID", "MAU00001").strip().upper()
ADMIN_ROLES = {"super_admin", "company_admin", "admin"}


def _normalize_member_phone(value: str) -> str:
    return re.sub(r"\D", "", str(value or ""))


def _normalize_member_pan(value: str) -> str:
    return re.sub(r"\s+", "", str(value or "")).upper()


def _member_identity_setting_key(kind: str, value: str) -> str:
    return f"member_registration_identity:{kind}:{value}"


def _member_phone_exists(db: Session, phone: str) -> bool:
    if not phone:
        return False
    phone_digits = _normalize_member_phone(phone)
    if not phone_digits:
        return False
    candidates = {phone_digits}
    if len(phone_digits) >= 10:
        candidates.add(phone_digits[-10:])
    for user in db.query(User).filter(User.role == "member", User.phone != "").all():
        existing = _normalize_member_phone(user.phone)
        if existing in candidates or (len(existing) >= 10 and existing[-10:] in candidates):
            return True
    if db.query(AppSetting).filter(AppSetting.key == _member_identity_setting_key("phone", phone_digits)).first() is not None:
        return True

    # Phone identity keys can also be mirrored by a partially-completed registration
    # payload that has not reached the dedicated identity table row yet.
    profile_rows = db.query(AppSetting).filter(AppSetting.key.like("user_profile:%")).all()
    for row in profile_rows:
        try:
            payload = json.loads(row.value_json or "{}") if isinstance(row.value_json, str) else {}
        except Exception:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        stored_phone = _normalize_member_phone(str(payload.get("phone") or ""))
        if stored_phone and stored_phone in candidates:
            return True
    return False


def _member_pan_exists(db: Session, pan_no: str) -> bool:
    if not pan_no:
        return False

    normalized_pan = _normalize_member_pan(pan_no)
    if db.query(AppSetting).filter(AppSetting.key == _member_identity_setting_key("pan", normalized_pan)).first() is not None:
        return True

    # Registration side-effect payloads store the PAN inside the user_profile:<id>
    # AppSetting record. Scan those snapshots too, because the stored identity key
    # may be absent after partial or interrupted registration attempts.
    profile_rows = db.query(AppSetting).filter(AppSetting.key.like("user_profile:%")).all()
    for row in profile_rows:
        try:
            payload = json.loads(row.value_json or "{}") if isinstance(row.value_json, str) else {}
        except Exception:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        stored_pan = _normalize_member_pan(str(payload.get("pan_no") or ""))
        if stored_pan == normalized_pan:
            return True

    return False

ADMIN_LOGIN_ID = str(os.getenv("ADMIN_LOGIN_ID", "admin@metho.com") or "admin@metho.com").strip()


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

    # Keep login resilient when stored email casing differs from user input.
    by_email_lower = db.query(User).filter(User.email == ref.lower()).first()
    if by_email_lower:
        return by_email_lower

    users = db.query(User).all()
    for candidate in users:
        if member_code_for_user(candidate.id) == ref:
            return candidate
    return None


def _resolve_default_admin_sponsor(db: Session) -> User | None:
    preferred = _resolve_user_by_identifier(db, DEFAULT_ADMIN_SPONSOR_ID)
    if preferred and preferred.role in ADMIN_ROLES and preferred.is_active:
        return preferred

    return (
        db.query(User)
        .filter(User.role.in_(list(ADMIN_ROLES)), User.is_active.is_(True))
        .order_by(User.created_at.asc())
        .first()
    )


def _resolve_login_user(db: Session, identifier: str, admin_mode: bool = False) -> User | None:
    raw = str(identifier or "").strip()
    if not raw:
        return None

    normalized = raw.upper()
    compact = normalized.replace(" ", "")
    admin_aliases = {
        "ADMIN",
        "ADMIN@METHO.COM",
        "MTHADMIN",
        "MTH-ADMIN",
        str(ADMIN_LOGIN_ID or "").strip().upper().replace(" ", ""),
    }
    if admin_mode and compact in {alias for alias in admin_aliases if alias}:
        admin_user = _resolve_default_admin_sponsor(db)
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

    if admin_mode and user.role not in ADMIN_ROLES:
        normalized_id = identifier.strip().upper().replace(" ", "")
        admin_aliases = {
            "ADMIN",
            "ADMIN@METHO.COM",
            "MTHADMIN",
            "MTH-ADMIN",
            str(ADMIN_LOGIN_ID or "").strip().upper().replace(" ", ""),
        }
        # Recovery path: if the configured hidden-admin account was downgraded,
        # promote it back on successful hidden admin credential login.
        if normalized_id in {alias for alias in admin_aliases if alias}:
            user.role = "super_admin"
            db.commit()

    is_admin = user.role in ADMIN_ROLES
    if admin_mode and not is_admin:
        raise HTTPException(status_code=403, detail="Admin credentials required")
    if not admin_mode and is_admin:
        raise HTTPException(status_code=403, detail="Admin users must sign in from hidden admin login")
    if not admin_mode and not bool(user.is_active):
        if str(user.role or "").lower() == "rider":
            raise HTTPException(status_code=403, detail="Your rider registration is awaiting admin approval.")
        if str(user.role or "").lower() == "partner":
            raise HTTPException(status_code=403, detail="Your partner registration is awaiting admin approval.")
        raise HTTPException(status_code=403, detail="Your membership is pending payment verification.")

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
    c.drawString(50, h - 154, f"WhatsApp: {user.phone or METHO_SUPPORT_WHATSAPP}")
    c.drawString(50, h - 188, "Thank you for registering. Keep this letter for your records.")
    c.drawString(50, h - 206, f"For support, WhatsApp us at {METHO_SUPPORT_WHATSAPP}.")
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


def _send_registration_whatsapp_welcome(db: Session, user: User, member_code: str) -> None:
    try:
        from ..whatsapp_cloud import public_whatsapp_image_url, send_whatsapp_image, send_whatsapp_message

        text = (
            f"🌿 Welcome to METHO AAY-UPAY™! 🎉\n\nDear {user.name},\n\n"
            "Congratulations! Your Member Registration has been successfully completed. "
            "Welcome to the METHO AAY-UPAY™ family! 🤝\n\n"
            "You can now explore opportunities to Shop, Save, Earn & Grow with METHO.\n\n"
            "🎓 Next Step: Our team will guide you through free training and help you get started.\n\n"
            f"📩 Need any help? Reply to this chat or contact our WhatsApp executive: {METHO_SUPPORT_WHATSAPP}.\n\n"
            "METHO AAY-UPAY™ — Better People | Stronger Communities | Brighter Tomorrow 🌿"
        )
        send_whatsapp_message(db, user.phone, text=text)
        row = db.query(AppSetting).filter(AppSetting.key == "global").first()
        settings = json.loads(row.value_json or "{}") if row and row.value_json else {}
        logo_url = str(settings.get("site_logo_url") or "").strip()
        if logo_url:
            send_whatsapp_image(db, user.phone, public_whatsapp_image_url(logo_url), caption=text[:1024])
    except Exception:
        logger.exception("Registration WhatsApp welcome failed: member_id=%s", member_code)


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
def register(payload: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    if isinstance(request, Session) and not isinstance(db, Session):
        request, db = None, request
    correlation_id = str(getattr(request, "headers", {}).get("X-Request-ID") or uuid.uuid4().hex[:16])
    requested_member_id = str(payload.email or "").strip().upper()
    normalized_phone = _normalize_member_phone(payload.phone)
    normalized_pan = _normalize_member_pan(payload.pan_no)
    if len(str(payload.password or "")) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if len(normalized_phone) < 10 or len(normalized_phone) > 15:
        raise HTTPException(status_code=400, detail="Phone number is required and must be 10 to 15 digits")
    if not re.fullmatch(r"[A-Z]{5}[0-9]{4}[A-Z]", normalized_pan):
        raise HTTPException(status_code=400, detail="PAN number is required and must be in format ABCDE1234F")
    if _member_phone_exists(db, normalized_phone):
        raise HTTPException(status_code=400, detail="Phone number already registered")
    if _member_pan_exists(db, normalized_pan):
        raise HTTPException(status_code=400, detail="PAN number already registered")

    member_id = requested_member_id if _is_member_id(requested_member_id) else _next_member_id(db)
    if db.query(User).filter(User.id == member_id).first() or db.query(User).filter(User.email == member_id).first():
        member_id = _next_member_id(db)

    requested_sponsor = (payload.sponsor_code or "").strip().upper()
    sponsor_user = _resolve_user_by_identifier(db, requested_sponsor) if requested_sponsor else _resolve_default_admin_sponsor(db)
    if requested_sponsor and not sponsor_user:
        raise HTTPException(status_code=400, detail="Sponsor code not found")
    if sponsor_user and (not sponsor_user.is_active or sponsor_user.role not in ADMIN_ROLES | {"member"}):
        sponsor_user = _resolve_default_admin_sponsor(db)
    if not sponsor_user:
        raise HTTPException(status_code=503, detail="Default METHO Admin sponsor is not configured")
    if sponsor_user.id == member_id:
        raise HTTPException(status_code=400, detail="A member cannot sponsor themselves")

    user = User(
        id=member_id,
        name=payload.name,
        email=member_id,
        phone=normalized_phone,
        password=hash_password(payload.password),
        role="member",
        is_active=False,
    )
    try:
        db.add(user)
        db.add(AppSetting(
            key=_member_identity_setting_key("phone", normalized_phone),
            value_json=json.dumps({"user_id": member_id, "registered_at": datetime.now(timezone.utc).isoformat()}),
            updated_at=datetime.now(timezone.utc),
        ))
        db.add(AppSetting(
            key=_member_identity_setting_key("pan", normalized_pan),
            value_json=json.dumps({"user_id": member_id, "registered_at": datetime.now(timezone.utc).isoformat()}),
            updated_at=datetime.now(timezone.utc),
        ))
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        message = str(exc).lower()
        if f"member_registration_identity:phone:{normalized_phone}".lower() in message:
            raise HTTPException(status_code=400, detail="Phone number already registered") from exc
        if f"member_registration_identity:pan:{normalized_pan}".lower() in message:
            raise HTTPException(status_code=400, detail="PAN number already registered") from exc
        logger.exception("Member registration duplicate guard failed: correlation_id=%s member_id=%s", correlation_id, member_id)
        raise HTTPException(status_code=503, detail=f"Registration could not be completed. Reference: {correlation_id}") from exc
    except Exception as exc:
        db.rollback()
        logger.exception("Member registration failed before CRM linking: correlation_id=%s member_id=%s", correlation_id, member_id)
        raise HTTPException(status_code=503, detail=f"Registration could not be completed. Reference: {correlation_id}") from exc
    registration_lead = None
    try:
        link_lead_to_registration(db, phone=user.phone, email=user.email, user_id=user.id)
        db.commit()
        profile_payload = json.dumps({
            "dob": str(payload.dob or "").strip(),
            "pan_no": normalized_pan,
            "aadhaar_no": re.sub(r"\D", "", str(payload.aadhaar_no or "")),
            "address": str(payload.address or "").strip(),
            "city": "",
            "state": "",
            "pincode": "",
        })
        profile_row = db.query(AppSetting).filter(AppSetting.key == f"user_profile:{user.id}").first()
        if profile_row:
            profile_row.value_json = profile_payload
            profile_row.updated_at = datetime.now(timezone.utc)
        else:
            db.add(AppSetting(key=f"user_profile:{user.id}", value_json=profile_payload, updated_at=datetime.now(timezone.utc)))
        db.commit()
        registration_lead = record_lifecycle_event_by_phone(db, user.phone, "member_registration_completed", f"Member registration completed: {user.id}. Activation/payment is pending.", "Complete member activation/payment and explain first purchase steps", 1)
        if registration_lead:
            welcome_due = datetime.now(timezone.utc) + timedelta(hours=1)
            welcome_notes = "Welcome message and explain how to complete registration and get help"
            existing_welcome = db.query(CRMFollowUp).filter(CRMFollowUp.lead_id == registration_lead.id, CRMFollowUp.status == "Pending", CRMFollowUp.notes == welcome_notes).first()
            if not existing_welcome:
                db.add(CRMFollowUp(lead_id=registration_lead.id, scheduled_at=welcome_due, status="Pending", notes=welcome_notes))
                registration_lead.next_follow_up_at = min(registration_lead.next_follow_up_at or welcome_due, welcome_due)
                registration_lead.follow_up_status = "Pending"
                db.commit()
        db.add(AppSetting(
            key=f"member_payment_state:{user.id}",
            value_json=json.dumps({
                "approval_status": "pending",
                "payment_status": "pending",
                "payment_method": "",
                "order_id": "",
                "registered_at": datetime.now(timezone.utc).isoformat(),
            }),
            updated_at=datetime.now(timezone.utc),
        ))
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Registration side effect failed after member creation: correlation_id=%s member_id=%s", correlation_id, user.id)

    sponsor_code = member_code_for_user(sponsor_user.id)
    try:
        existing_rel = db.query(UserReferral).filter(UserReferral.user_id == user.id).first()
        if not existing_rel:
            db.add(UserReferral(user_id=user.id, sponsor_user_id=sponsor_user.id, sponsor_code=sponsor_code))
            db.commit()
    except Exception:
        db.rollback()
        logger.exception("Registration referral link failed after member creation: correlation_id=%s member_id=%s", correlation_id, user.id)

    welcome_letter_url = ""
    try:
        welcome_letter_url = build_welcome_pdf(user)
    except Exception:
        logger.exception("Welcome letter generation failed: correlation_id=%s member_id=%s", correlation_id, user.id)
    member_code = member_code_for_user(user.id)
    try:
        send_welcome_email(user.email, user.name, member_code, welcome_letter_url)
    except Exception:
        logger.exception("Welcome email failed after member creation: correlation_id=%s member_id=%s", correlation_id, user.id)
    _send_registration_whatsapp_welcome(db, user, member_code)

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
            "is_active": False,
            "approval_status": "pending",
            "payment_status": "pending",
        },
        "welcome_letter_url": welcome_letter_url,
    }


@router.post("/auth/register")
def register_alias(payload: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    return register(payload, request, db)


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
        "member_code": member_code_for_user(user.id),
        "rank": "Member",
    }


@router.get("/auth/default-sponsor")
def default_sponsor(db: Session = Depends(get_db)):
    sponsor = _resolve_default_admin_sponsor(db)
    if not sponsor:
        raise HTTPException(status_code=503, detail="Default METHO Admin sponsor is not configured")
    return {"member_code": member_code_for_user(sponsor.id), "name": sponsor.name}
