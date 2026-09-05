import hashlib
import hmac
import json
import math
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AppSetting, User
from ..whatsapp_cloud import send_whatsapp_message
from .auth import ADMIN_ROLES, get_current_user, get_current_user_optional
from .checkout import _load_checkout_razorpay_settings, _razorpay_create_order
from .rider import _profile, _save_profile
from .settings import load_settings

router = APIRouter(prefix="/api", tags=["metho-direct-bookings"])
BOOKINGS_KEY = "metho_direct_bookings"
EARNINGS_KEY = "metho_direct_earnings"
REWARDS_KEY = "metho_direct_rewards"
VEHICLE_TYPES = {"bike", "ebike", "e_rickshaw", "auto_rickshaw", "four_wheeler", "bolero_maxx", "vehicle_207", "vehicle_407", "dumper", "delivery"}


def _validated_distance_km(value) -> float:
    try:
        distance = float(value or 0)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Distance must be a valid number") from exc
    if not math.isfinite(distance) or distance <= 0:
        raise HTTPException(status_code=400, detail="A positive road distance is required")
    return min(distance, 10000.0)


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
    rate = float(rates.get("bike" if vehicle == "ebike" else vehicle) or 0)
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


def _normalize_phone(value: str | None) -> str:
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    return digits


def _generate_booking_code() -> str:
    return f"MM-{uuid.uuid4().hex[:8].upper()}"


def _candidate_rider_ids(db: Session, booking: dict, rider_id: str = "") -> list[str]:
    riders = _active_riders(db)
    if not riders:
        return []
    latitude = booking.get("pickup_latitude")
    longitude = booking.get("pickup_longitude")
    if latitude is None or longitude is None:
        ordered = riders
    else:
        def distance(rider: User) -> float:
            profile = _profile(db, rider.id)
            return math.hypot(float(profile.get("latitude", 0)) - float(latitude), float(profile.get("longitude", 0)) - float(longitude))
        ordered = sorted(riders, key=distance)
    if rider_id:
        ordered = [r for r in ordered if str(r.id) == str(rider_id)] + [r for r in ordered if str(r.id) != str(rider_id)]
    return [str(r.id) for r in ordered]


def _assign_next_driver(db: Session, booking: dict, preferred_rider_id: str = "") -> dict:
    candidates = _candidate_rider_ids(db, booking, preferred_rider_id)
    if not candidates:
        booking["rider_id"] = ""
        booking["status"] = "awaiting_driver_assignment"
        booking["candidate_riders"] = []
        return booking
    rider_id = candidates[0]
    rider = db.query(User).filter(User.id == rider_id).first()
    if not rider:
        booking["rider_id"] = ""
        booking["status"] = "awaiting_driver_assignment"
        booking["candidate_riders"] = candidates[1:]
        return booking
    booking["rider_id"] = rider.id
    booking["status"] = "awaiting_driver_assignment"
    booking["assigned_at"] = datetime.now(timezone.utc).isoformat()
    booking["candidate_riders"] = candidates
    return booking


def _assign_next_available_driver(db: Session, booking: dict, excluded_rider_id: str) -> dict:
    candidates = [rider_id for rider_id in _candidate_rider_ids(db, booking) if str(rider_id) != str(excluded_rider_id)]
    booking["candidate_riders"] = candidates
    if not candidates:
        booking["rider_id"] = ""
        booking["status"] = "awaiting_driver_assignment"
        return booking
    rider = db.query(User).filter(User.id == candidates[0]).first()
    if not rider:
        return _assign_next_available_driver(db, booking, candidates[0])
    booking["rider_id"] = rider.id
    booking["status"] = "awaiting_driver_assignment"
    booking["assigned_at"] = datetime.now(timezone.utc).isoformat()
    return booking


def _notify_booking_status(db: Session, booking: dict, rider: User | None = None) -> None:
    if not booking.get("customer_phone"):
        return
    service_label = "METHO Delivery" if booking.get("service_type") == "delivery" else "METHO Move"
    text = (
        f"{service_label} booking {booking.get('booking_code') or booking.get('id')[:8].upper()} has been accepted. "
        f"Pickup: {booking.get('pickup')} | Destination: {booking.get('destination')}"
    )
    try:
        send_whatsapp_message(db, _normalize_phone(booking.get("customer_phone")), text=text)
    except Exception:
        pass
    if rider and rider.phone:
        try:
            driver_text = (
                f"You accepted {service_label} booking {booking.get('booking_code') or booking.get('id')[:8].upper()}. "
                f"Customer: {booking.get('customer_name')} | Phone: {booking.get('customer_phone')} | Pickup: {booking.get('pickup')}"
            )
            send_whatsapp_message(db, _normalize_phone(rider.phone), text=driver_text)
        except Exception:
            pass


def _assign(db: Session, booking: dict, rider_id: str = "") -> dict:
    rider = _nearest_rider(db, booking, rider_id)
    if not rider:
        raise HTTPException(status_code=404, detail="No approved online rider is available")
    booking["rider_id"] = rider.id
    booking["status"] = "awaiting_driver_assignment"
    booking["assigned_at"] = datetime.now(timezone.utc).isoformat()
    booking["candidate_riders"] = _candidate_rider_ids(db, booking, rider_id)
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
        "customer_user_id": str(current_user.id) if current_user else "", "distance_km": _validated_distance_km(payload.get("distance_km")),
        "pickup_latitude": payload.get("pickup_latitude"), "pickup_longitude": payload.get("pickup_longitude"),
        "amount": calculate_direct_amount(service_type, settings, payload.get("distance_km") or 1),
        "status": "awaiting_driver_assignment", "rider_id": "", "payment_id": "", "razorpay_order_id": "",
        "created_at": datetime.now(timezone.utc).isoformat(), "smart_cycle": False, "candidate_riders": [], "booking_code": "", "access_token": secrets.token_urlsafe(24),
    }
    booking["candidate_riders"] = _candidate_rider_ids(db, booking)
    if payload.get("request_assignment") and booking["candidate_riders"]:
        _assign(db, booking, booking["candidate_riders"][0])
    bookings = _json_list(db, BOOKINGS_KEY)
    bookings.append(booking)
    _save_json_list(db, BOOKINGS_KEY, bookings)
    db.commit()
    return {"booking": booking}


@router.get("/metho-move/bookings/{booking_id}")
def get_direct_booking(booking_id: str, access_token: str = "", db: Session = Depends(get_db), current_user: User | None = Depends(get_current_user_optional)):
    booking = next((item for item in _json_list(db, BOOKINGS_KEY) if item.get("id") == booking_id), None)
    if not booking:
        raise HTTPException(status_code=404, detail="METHO Move booking not found")
    token_matches = bool(access_token and secrets.compare_digest(str(booking.get("access_token") or ""), access_token))
    if token_matches or (current_user and (current_user.role in ADMIN_ROLES or str(booking.get("customer_user_id") or "") == str(current_user.id))):
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
    rider_id = str(payload.get("rider_id") or "").strip()
    if rider_id:
        rider = db.query(User).filter(User.id == rider_id).first()
        if not rider or rider.role != "rider":
            raise HTTPException(status_code=400, detail="Invalid rider selected")
    else:
        rider = _nearest_rider(db, booking)
        if not rider:
            raise HTTPException(status_code=404, detail="No approved online rider is available")
        rider_id = str(rider.id)
    booking["rider_id"] = rider_id
    booking["status"] = "awaiting_driver_assignment"
    booking["assigned_at"] = datetime.now(timezone.utc).isoformat()
    booking["candidate_riders"] = _candidate_rider_ids(db, booking, rider_id)
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
    if not booking:
        raise HTTPException(status_code=404, detail="METHO Move booking not found")

    if str(booking.get("rider_id") or "") != str(current_user.id):
        if booking.get("status") == "accepted" and booking.get("rider_id"):
            booking["rider_id"] = ""
            booking["status"] = "awaiting_driver_assignment"
            booking["candidate_riders"] = _candidate_rider_ids(db, booking)
            _save_json_list(db, BOOKINGS_KEY, bookings)
            db.commit()
            return {"booking": booking}
        raise HTTPException(status_code=403, detail="Assigned booking ownership required")

    if action == "accept":
        if booking.get("status") not in {"assigned", "awaiting_driver_assignment"}:
            raise HTTPException(status_code=409, detail="Booking is not ready to accept")
        booking["status"] = "accepted"
        if not booking.get("booking_code"):
            booking["booking_code"] = _generate_booking_code()
        _notify_booking_status(db, booking, current_user)
    else:
        if booking.get("status") == "completed":
            return {"booking": booking}
        if booking.get("status") not in {"paid", "accepted", "assigned", "awaiting_driver_assignment"}:
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


@router.post("/rider/metho-move/bookings/{booking_id}/reject")
def rider_reject_direct_booking(booking_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "rider":
        raise HTTPException(status_code=403, detail="Rider credentials required")
    profile = _profile(db, current_user.id)
    if not current_user.is_active or profile.get("approval_status") != "approved":
        raise HTTPException(status_code=403, detail="Rider approval required")
    bookings = _json_list(db, BOOKINGS_KEY)
    booking = next((item for item in bookings if item.get("id") == booking_id), None)
    if not booking:
        raise HTTPException(status_code=404, detail="METHO Move booking not found")
    if str(booking.get("rider_id") or "") != str(current_user.id):
        raise HTTPException(status_code=403, detail="Assigned booking ownership required")
    if booking.get("status") not in {"assigned", "awaiting_driver_assignment"}:
        raise HTTPException(status_code=409, detail="Booking is no longer waiting for a rider")
    _assign_next_available_driver(db, booking, str(current_user.id))
    _save_json_list(db, BOOKINGS_KEY, bookings)
    db.commit()
    return {"booking": booking}


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