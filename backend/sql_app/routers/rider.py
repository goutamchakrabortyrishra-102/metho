import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AppSetting, User
from ..schemas import RiderRegisterRequest
from ..security import hash_password
from .auth import ADMIN_ROLES, get_current_user, member_code_for_user

router = APIRouter(prefix="/api", tags=["rider"])
RIDER_PROFILE_PREFIX = "rider_profile:"


def rider_profile_key(user_id: str) -> str:
    return f"{RIDER_PROFILE_PREFIX}{user_id}"


def _profile_row(db: Session, user_id: str) -> AppSetting | None:
    return db.query(AppSetting).filter(AppSetting.key == rider_profile_key(user_id)).first()


def _profile(db: Session, user_id: str) -> dict:
    row = _profile_row(db, user_id)
    if not row:
        return {}
    try:
        value = json.loads(row.value_json or "{}")
    except (TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def _save_profile(db: Session, user_id: str, value: dict) -> None:
    row = _profile_row(db, user_id)
    if row:
        row.value_json = json.dumps(value)
        row.updated_at = datetime.now(timezone.utc)
    else:
        db.add(AppSetting(
            key=rider_profile_key(user_id),
            value_json=json.dumps(value),
            updated_at=datetime.now(timezone.utc),
        ))


def _rider_response(user: User, profile: dict) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "phone": user.phone,
        "role": user.role,
        "member_code": member_code_for_user(user.id),
        "is_active": bool(user.is_active),
        **profile,
    }


def _require_admin(current_user: User) -> None:
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin credentials required")


def _rider_user(db: Session, user_id: str) -> User:
    user = db.query(User).filter(User.id == user_id, User.role == "rider").first()
    if not user:
        raise HTTPException(status_code=404, detail="Rider not found")
    return user


def _owned_rider(current_user: User, user_id: str) -> User:
    if current_user.role != "rider" or str(current_user.id) != str(user_id):
        raise HTTPException(status_code=403, detail="Rider profile ownership required")
    return current_user


@router.post("/rider/register")
def rider_register(payload: RiderRegisterRequest, db: Session = Depends(get_db)):
    phone = str(payload.phone or "").strip()
    if len(str(payload.password or "")) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if db.query(User).filter(User.phone == phone).first():
        raise HTTPException(status_code=409, detail="Phone already registered")

    user = User(
        name=payload.name.strip(),
        email=f"rider.{phone}@metho.local",
        phone=phone,
        password=hash_password(payload.password),
        role="rider",
        is_active=False,
    )
    db.add(user)
    db.flush()
    _save_profile(db, user.id, {
        "vehicle_type": payload.vehicle_type.strip(),
        "vehicle_number": payload.vehicle_number.strip(),
        "whatsapp": payload.whatsapp.strip(),
        "approval_status": "pending",
        "availability": "offline",
        "registered_at": datetime.now(timezone.utc).isoformat(),
    })
    db.commit()
    return {"message": "Rider registration submitted for admin approval", "rider": _rider_response(user, _profile(db, user.id))}


@router.get("/admin/riders")
def admin_riders(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    riders = db.query(User).filter(User.role == "rider").order_by(User.created_at.desc()).all()
    return {"riders": [_rider_response(rider, _profile(db, rider.id)) for rider in riders]}


def _set_rider_status(user_id: str, status: str, active: bool, db: Session, current_user: User) -> dict:
    _require_admin(current_user)
    rider = _rider_user(db, user_id)
    rider.is_active = active
    profile = _profile(db, rider.id)
    profile["approval_status"] = status
    _save_profile(db, rider.id, profile)
    db.commit()
    return {"rider": _rider_response(rider, profile)}


@router.post("/admin/riders/{user_id}/approve")
def admin_approve_rider(user_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _set_rider_status(user_id, "approved", True, db, current_user)


@router.post("/admin/riders/{user_id}/reject")
def admin_reject_rider(user_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _set_rider_status(user_id, "rejected", False, db, current_user)


@router.post("/admin/riders/{user_id}/activate")
def admin_activate_rider(user_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _set_rider_status(user_id, "approved", True, db, current_user)


@router.get("/rider/me")
def rider_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rider = _owned_rider(current_user, current_user.id)
    return {"rider": _rider_response(rider, _profile(db, rider.id))}


@router.get("/rider/availability")
def rider_availability(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rider = _owned_rider(current_user, current_user.id)
    return {"availability": _profile(db, rider.id).get("availability", "offline")}


@router.put("/rider/availability")
def update_rider_availability(payload: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rider = _owned_rider(current_user, current_user.id)
    availability = str(payload.get("availability") or "").strip().lower()
    if availability not in {"online", "offline"}:
        raise HTTPException(status_code=400, detail="Availability must be online or offline")
    profile = _profile(db, rider.id)
    profile["availability"] = availability
    if payload.get("latitude") is not None or payload.get("longitude") is not None:
        try:
            latitude = round(float(payload.get("latitude")), 7)
            longitude = round(float(payload.get("longitude")), 7)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Valid latitude and longitude are required")
        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            raise HTTPException(status_code=400, detail="Valid latitude and longitude are required")
        profile["latitude"] = latitude
        profile["longitude"] = longitude
    _save_profile(db, rider.id, profile)
    db.commit()
    return {"availability": availability}