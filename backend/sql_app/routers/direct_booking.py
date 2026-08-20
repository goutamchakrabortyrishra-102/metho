import hashlib
import hmac
import json
import math
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AppSetting, User
from .auth import ADMIN_ROLES, get_current_user, get_current_user_optional
from .checkout import _load_checkout_razorpay_settings, _razorpay_create_order
from .rider import _profile, _save_profile
from .settings import load_settings

router = APIRouter(prefix="/api", tags=["metho-direct-bookings"])
BOOKINGS_KEY = "metho_direct_bookings"
EARNINGS_KEY = "metho_direct_earnings"
REWARDS_KEY = "metho_direct_rewards"
VEHICLE_TYPES = {"bike", "e_rickshaw", "auto_rickshaw", "delivery"}


def _json_list(db: Session, key: str) -> list[dict]:
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row:
        return []
    try:
        value = json.loads(row.value_json or "[]")
    except (TypeError, ValueError):
        return []
    return value if isinstance(value, list) else []


def _save_json_list(db: Session, key: str, value: list[dict]) -> None:
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    payload = json.dumps(value)
    if row:
        row.value_json = payload
        row.updated_at = datetime.now(timezone.utc)
    else:
        db.add(AppSetting(key=key, value_json=payload, updated_at=datetime.now(timezone.utc)))


def calculate_direct_amount(service_type: str, settings: dict, distance_km: float = 1) -> float:
    vehicle = str(service_type or "").strip().lower()
    if vehicle not in VEHICLE_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported METHO Move service type")
    distance = max(1.0, float(distance_km or 1))
    rates = settings.get("metho_transport_rates") or {}
    rate = float(rates.get(vehicle) or 0)
    if rate <= 0:
        raise HTTPException(status_code=400, detail="METHO transport rate is not configured")
    return round(rate * distance, 2)


def _booking_response(booking: dict, riders: dict[str, User] | None = None) -> dict:
    result = dict(booking)
    rider = (riders or {}).get(str(booking.get("rider_id") or ""))
    if rider:
        result["rider_name"] = rider.name
        result["rider_phone"] = rider.phone
    return result


def _require_admin(user: User) -> None:
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")


def _active_riders(db: Session) -> list[User]:
    riders = db.query(User).filter(User.role == "rider", User.is_active.is_(True)).all()
    return [r for r in riders if _profile(db, r.id).get("approval_status") == "approved" and _profile(db, r.id).get("availability") == "online"]


def _nearest_rider(db: Session, booking: dict, rider_id: str = "") -> User | None:
    riders = _active_riders(db)
    if rider_id:
        return next((r for r in riders if str(r.id) == str(rider_id)), None)
    latitude = booking.get("pickup_latitude")
    longitude = booking.get("pickup_longitude")
    if latitude is None or longitude is None:
        return riders[0] if riders else None
    def distance(rider: User) -> float:
        profile = _profile(db, rider.id)
        return math.hypot(float(profile.get("latitude", 0)) - float(latitude), float(profile.get("longitude", 0)) - float(longitude))
    return min(riders, key=distance, default=None)


def _assign(db: Session, booking: dict, rider_id: str = "") -> dict:
    rider = _nearest_rider(db, booking, rider_id)
    if not rider:
        raise HTTPException(status_code=404, detail="No approved online rider is available")
    booking["rider_id"] = rider.id
    booking["status"] = "assigned" if booking.get("status") == "paid" else booking.get("status")
    booking["assigned_at"] = datetime.now(timezone.utc).isoformat()
    return booking


@router.post("/metho-move/bookings")
def create_direct_booking(payload: dict, db: Session = Depends(get_db), current_user: User | None = Depends(get_current_user_optional)):
    service_type = str(payload.get("service_type") or "").strip().lower()
    pickup = str(payload.get("pickup") or "").strip()
    destination = str(payload.get("destination") or "").strip()
    name = str(payload.get("customer_name") or "").strip()
    phone = str(payload.get("customer_phone") or "").strip()
    if service_type not in VEHICLE_TYPES or not pickup or not destination or not name or not phone:
        raise HTTPException(status_code=400, detail="Vehicle, route, customer name and phone are required")
    settings = load_settings(db)
    booking = {
        "id": str(uuid.uuid4()), "service_type": service_type, "pickup": pickup, "destination": destination,
        "customer_name": name, "customer_phone": phone, "member_ref": str(payload.get("member_ref") or "").strip(),
        "customer_user_id": str(current_user.id) if current_user else "", "distance_km": max(1.0, float(payload.get("distance_km") or 1)),
        "pickup_latitude": payload.get("pickup_latitude"), "pickup_longitude": payload.get("pickup_longitude"),
        "amount": calculate_direct_amount(service_type, settings, payload.get("distance_km") or 1),
        "status": "payment_pending", "rider_id": "", "payment_id": "", "razorpay_order_id": "",
        "created_at": datetime.now(timezone.utc).isoformat(), "smart_cycle": False,
    }
    if payload.get("request_assignment"):
        _assign(db, booking)
    bookings = _json_list(db, BOOKINGS_KEY)
    bookings.append(booking)
    _save_json_list(db, BOOKINGS_KEY, bookings)
    db.commit()
    return {"booking": booking}


@router.get("/metho-move/bookings/{booking_id}")
def get_direct_booking(booking_id: str, db: Session = Depends(get_db), current_user: User | None = Depends(get_current_user_optional)):
    booking = next((item for item in _json_list(db, BOOKINGS_KEY) if item.get("id") == booking_id), None)
    if not booking:
        raise HTTPException(status_code=404, detail="METHO Move booking not found")
    if current_user and (current_user.role in ADMIN_ROLES or str(booking.get("customer_user_id") or "") == str(current_user.id)):
        return {"booking": booking}
    raise HTTPException(status_code=403, detail="Booking ownership required")


@router.post("/metho-move/bookings/{booking_id}/razorpay/order")
def direct_razorpay_order(booking_id: str, db: Session = Depends(get_db)):
    bookings = _json_list(db, BOOKINGS_KEY)
    booking = next((item for item in bookings if item.get("id") == booking_id), None)
    if not booking:
        raise HTTPException(status_code=404, detail="METHO Move booking not found")
    if booking.get("status") == "paid":
        raise HTTPException(status_code=409, detail="Booking is already paid")
    _settings, key_id, key_secret = _load_checkout_razorpay_settings(db)
    receipt = f"metho_move_{booking_id[:24]}"
    order = _razorpay_create_order(round(float(booking["amount"]) * 100), receipt, key_id, key_secret)
    booking["razorpay_order_id"] = str(order.get("id") or "")
    if not booking["razorpay_order_id"]:
        raise HTTPException(status_code=502, detail="Razorpay order id missing")
    _save_json_list(db, BOOKINGS_KEY, bookings)
    db.commit()
    return {"key_id": key_id, "amount": round(float(booking["amount"]) * 100), "currency": "INR", "razorpay_order_id": booking["razorpay_order_id"], "name": "METHO Move"}


@router.post("/metho-move/bookings/{booking_id}/razorpay/verify")
def verify_direct_payment(booking_id: str, payload: dict, db: Session = Depends(get_db)):
    bookings = _json_list(db, BOOKINGS_KEY)
    booking = next((item for item in bookings if item.get("id") == booking_id), None)
    if not booking:
        raise HTTPException(status_code=404, detail="METHO Move booking not found")
    _settings, _key_id, key_secret = _load_checkout_razorpay_settings(db)
    order_id = str(payload.get("razorpay_order_id") or "")
    payment_id = str(payload.get("razorpay_payment_id") or "")
    signature = str(payload.get("razorpay_signature") or "")
    expected = hmac.new(key_secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature) or order_id != booking.get("razorpay_order_id"):
        raise HTTPException(status_code=400, detail="Invalid Razorpay signature")
    if round(float(payload.get("amount") or 0), 2) != round(float(booking["amount"]), 2):
        raise HTTPException(status_code=400, detail="Payment amount mismatch")
    if any(item.get("payment_id") == payment_id for item in bookings if item.get("id") != booking_id):
        raise HTTPException(status_code=409, detail="Payment reference already used")
    booking.update({"payment_id": payment_id, "status": "paid", "paid_at": datetime.now(timezone.utc).isoformat()})
    if booking.get("rider_id"):
        booking["status"] = "assigned"
    _save_json_list(db, BOOKINGS_KEY, bookings)
    db.commit()
    return {"booking": booking}


@router.get("/admin/metho-move/bookings")
def admin_direct_bookings(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    riders = {str(r.id): r for r in db.query(User).filter(User.role == "rider").all()}
    return {"bookings": [_booking_response(item, riders) for item in reversed(_json_list(db, BOOKINGS_KEY))]}


@router.post("/admin/metho-move/bookings/{booking_id}/assign")
def admin_assign_direct_booking(booking_id: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    bookings = _json_list(db, BOOKINGS_KEY)
    booking = next((item for item in bookings if item.get("id") == booking_id), None)
    if not booking:
        raise HTTPException(status_code=404, detail="METHO Move booking not found")
    _assign(db, booking, str(payload.get("rider_id") or ""))
    _save_json_list(db, BOOKINGS_KEY, bookings)
    db.commit()
    return {"booking": booking}


@router.get("/rider/metho-move/bookings")
def rider_direct_bookings(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "rider":
        raise HTTPException(status_code=403, detail="Rider credentials required")
    return {"bookings": [item for item in _json_list(db, BOOKINGS_KEY) if str(item.get("rider_id")) == str(current_user.id)]}


def _rider_booking_action(booking_id: str, action: str, db: Session, current_user: User, payload: dict | None = None):
    if current_user.role != "rider":
        raise HTTPException(status_code=403, detail="Rider credentials required")
    profile = _profile(db, current_user.id)
    if not current_user.is_active or profile.get("approval_status") != "approved":
        raise HTTPException(status_code=403, detail="Rider approval required")
    bookings = _json_list(db, BOOKINGS_KEY)
    booking = next((item for item in bookings if item.get("id") == booking_id), None)
    if not booking or str(booking.get("rider_id")) != str(current_user.id):
        raise HTTPException(status_code=403, detail="Assigned booking ownership required")
    if action == "accept":
        if booking.get("status") != "assigned":
            raise HTTPException(status_code=409, detail="Booking is not ready to accept")
        booking["status"] = "accepted"
    else:
        if booking.get("status") == "completed":
            return {"booking": booking}
        if booking.get("status") not in {"accepted", "assigned"}:
            raise HTTPException(status_code=409, detail="Booking is not active")
        booking["status"] = "completed"
        earnings = _json_list(db, EARNINGS_KEY)
        if not any(item.get("booking_id") == booking_id for item in earnings):
            settings = load_settings(db)
            share = max(0.0, min(100.0, float(settings.get("metho_rider_share_percent") or 0)))
            earnings.append({"id": str(uuid.uuid4()), "booking_id": booking_id, "rider_id": current_user.id, "amount": round(float(booking["amount"]) * share / 100, 2), "share_percent": share, "status": "unpaid", "created_at": datetime.now(timezone.utc).isoformat()})
            _save_json_list(db, EARNINGS_KEY, earnings)
            if booking.get("member_ref") and booking.get("customer_user_id"):
                metho_share = round(float(booking["amount"]) * max(0.0, 100.0 - share) / 100, 2)
                smart_cycle_percent = max(0.0, min(100.0, float(settings.get("metho_delivery_smart_cycle_percent") or 0)))
                reward_pool_percent = max(0.0, min(100.0, float(settings.get("metho_delivery_reward_pool_percent") or 0)))
                rewards = _json_list(db, REWARDS_KEY)
                if not any(item.get("booking_id") == booking_id for item in rewards):
                    smart_cycle_amount = round(metho_share * smart_cycle_percent / 100, 2)
                    rewards.append({"id": str(uuid.uuid4()), "booking_id": booking_id, "member_id": booking["customer_user_id"], "member_ref": booking.get("member_ref"), "metho_share": metho_share, "smart_cycle_percent": smart_cycle_percent, "reward_pool_percent": reward_pool_percent, "amount": round(smart_cycle_amount * reward_pool_percent / 100, 2), "status": "pending", "created_at": datetime.now(timezone.utc).isoformat()})
                    _save_json_list(db, REWARDS_KEY, rewards)
    if payload and payload.get("latitude") is not None:
        _save_profile(db, current_user.id, {**profile, "latitude": payload.get("latitude"), "longitude": payload.get("longitude")})
    _save_json_list(db, BOOKINGS_KEY, bookings)
    db.commit()
    return {"booking": booking}


@router.post("/rider/metho-move/bookings/{booking_id}/accept")
def rider_accept_direct_booking(booking_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _rider_booking_action(booking_id, "accept", db, current_user)


@router.post("/rider/metho-move/bookings/{booking_id}/complete")
def rider_complete_direct_booking(booking_id: str, payload: dict | None = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _rider_booking_action(booking_id, "complete", db, current_user, payload or {})


@router.get("/admin/metho-move/earnings")
def admin_direct_earnings(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    return {"earnings": list(reversed(_json_list(db, EARNINGS_KEY)))}


@router.post("/admin/metho-move/earnings/{earning_id}/pay")
def admin_pay_direct_earning(earning_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    earnings = _json_list(db, EARNINGS_KEY)
    earning = next((item for item in earnings if item.get("id") == earning_id), None)
    if not earning:
        raise HTTPException(status_code=404, detail="Rider earning not found")
    earning.update({"status": "paid", "paid_at": datetime.now(timezone.utc).isoformat()})
    _save_json_list(db, EARNINGS_KEY, earnings)
    db.commit()
    return {"earning": earning}