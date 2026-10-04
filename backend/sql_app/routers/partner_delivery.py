import json
import math
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AppSetting, AssociatePartner, PartnerOrderDelivery, PartnerProduct, PublicOrder, User
from .auth import ADMIN_ROLES, get_current_user
from .checkout import _resolve_partner_for_user
from .settings import load_settings

router = APIRouter(prefix="/api", tags=["partner-delivery"])
ACTIVE_JOB_STATUSES = {"assigned", "accepted", "picked_up", "out_for_delivery"}
DELIVERY_STATUSES = {"assigned", "accepted", "picked_up", "out_for_delivery", "delivered", "cancelled"}


def _setting_json(db: Session, key: str) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    try:
        value = json.loads(row.value_json or "{}") if row else {}
    except (TypeError, ValueError):
        value = {}
    return value if isinstance(value, dict) else {}


def _save_json(db: Session, key: str, value: dict) -> None:
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if row:
        row.value_json = json.dumps(value)
        row.updated_at = datetime.now(timezone.utc)
    else:
        db.add(AppSetting(key=key, value_json=json.dumps(value), updated_at=datetime.now(timezone.utc)))
    db.commit()


def _coordinates(payload: dict, prefix: str = "") -> tuple[float, float]:
    try:
        latitude = float(payload[f"{prefix}latitude"])
        longitude = float(payload[f"{prefix}longitude"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Valid latitude and longitude are required")
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise HTTPException(status_code=400, detail="Valid latitude and longitude are required")
    return round(latitude, 7), round(longitude, 7)


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0088
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    value = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    return round(radius * 2 * math.atan2(math.sqrt(value), math.sqrt(max(0.0, 1 - value))), 2)


def _partner(current_user: User, db: Session) -> AssociatePartner:
    if current_user.role != "partner":
        raise HTTPException(status_code=403, detail="Partner access only")
    partner = _resolve_partner_for_user(db, current_user)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")
    return partner


def _require_admin(current_user: User) -> None:
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")


def _partner_order(db: Session, partner_id: str, order_id: str) -> PublicOrder:
    order = db.query(PublicOrder).filter(PublicOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if str(order.status or "").lower() not in {"paid", "approved"}:
        raise HTTPException(status_code=409, detail="Delivery can be requested after the order is paid")
    try:
        items = json.loads(order.items_json or "[]")
    except (TypeError, ValueError):
        items = []
    own_ids = {str(row[0]) for row in db.query(PartnerProduct.id).filter(PartnerProduct.partner_id == partner_id).all()}
    if not any(str(item.get("product_id") or "") in own_ids and not bool(item.get("is_service")) for item in items if isinstance(item, dict)):
        raise HTTPException(status_code=403, detail="This order has no physical product from your partner account")
    return order


def _order_drop_coordinates(db: Session, order_id: str) -> tuple[float, float]:
    contact = _setting_json(db, f"order_contact:{order_id}")
    try:
        return _coordinates({"latitude": contact.get("delivery_latitude"), "longitude": contact.get("delivery_longitude")})
    except HTTPException:
        raise HTTPException(status_code=409, detail="Customer delivery location is missing. Ask the customer to share the map location during checkout.")


def _fee(db: Session, distance: float) -> tuple[float, float]:
    settings = load_settings(db)
    minimum = max(0.0, float(settings.get("partner_delivery_min_charge") or 0))
    per_km = max(0.0, float(settings.get("partner_delivery_per_km_charge") or 0))
    maximum = max(0.0, float(settings.get("partner_delivery_max_charge") or 0))
    if maximum < minimum or per_km <= 0:
        raise HTTPException(status_code=503, detail="Partner delivery charges are not configured correctly by admin")
    charge = min(maximum, max(minimum, round(distance * per_km, 2)))
    rider_share = max(0.0, min(100.0, float(settings.get("partner_delivery_rider_share_percent") if settings.get("partner_delivery_rider_share_percent") is not None else 70)))
    return round(charge, 2), round(charge * rider_share / 100, 2)


def _available_riders(db: Session, pickup_latitude: float, pickup_longitude: float) -> list[dict]:
    busy_ids = {
        str(row[0]) for row in db.query(PartnerOrderDelivery.rider_user_id)
        .filter(PartnerOrderDelivery.status.in_(ACTIVE_JOB_STATUSES)).all()
    }
    riders = db.query(User).filter(User.role == "rider", User.is_active.is_(True)).all()
    out = []
    for rider in riders:
        profile = _setting_json(db, f"rider_profile:{rider.id}")
        if profile.get("approval_status") != "approved" or profile.get("availability") != "online" or str(rider.id) in busy_ids:
            continue
        try:
            location_updated = datetime.fromisoformat(str(profile.get("location_updated_at") or "").replace("Z", "+00:00"))
            if location_updated.tzinfo is None:
                location_updated = location_updated.replace(tzinfo=timezone.utc)
            age_seconds = (datetime.now(timezone.utc) - location_updated).total_seconds()
            if age_seconds > 600 or age_seconds < -60:
                continue
        except (TypeError, ValueError):
            continue
        try:
            latitude = float(profile["latitude"])
            longitude = float(profile["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            continue
        out.append({
            "id": rider.id,
            "name": rider.name,
            "phone": rider.phone,
            "vehicle_type": profile.get("vehicle_type", ""),
            "distance_to_partner_km": _distance_km(pickup_latitude, pickup_longitude, latitude, longitude),
        })
    return sorted(out, key=lambda row: row["distance_to_partner_km"])


@router.get("/partner/delivery-location")
def get_partner_delivery_location(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = _partner(current_user, db)
    return _setting_json(db, f"partner_delivery_location:{partner.id}")


@router.put("/partner/delivery-location")
def set_partner_delivery_location(payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = _partner(current_user, db)
    latitude, longitude = _coordinates(payload)
    _save_json(db, f"partner_delivery_location:{partner.id}", {
        "latitude": latitude,
        "longitude": longitude,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True, "latitude": latitude, "longitude": longitude}


@router.get("/partner/orders/{order_id}/delivery-options")
def partner_delivery_options(order_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = _partner(current_user, db)
    _partner_order(db, partner.id, order_id)
    pickup = _setting_json(db, f"partner_delivery_location:{partner.id}")
    pickup_latitude, pickup_longitude = _coordinates(pickup)
    drop_latitude, drop_longitude = _order_drop_coordinates(db, order_id)
    distance = _distance_km(pickup_latitude, pickup_longitude, drop_latitude, drop_longitude)
    charge, earning = _fee(db, distance)
    existing = db.query(PartnerOrderDelivery).filter_by(order_id=order_id, partner_id=partner.id).first()
    return {
        "delivery": _serialize(db, existing) if existing else None,
        "distance_km": distance,
        "partner_charge": charge,
        "rider_earning": earning,
        "distance_method": "straight_line",
        "riders": _available_riders(db, pickup_latitude, pickup_longitude),
    }


def _serialize(db: Session, row: PartnerOrderDelivery) -> dict:
    partner = db.query(AssociatePartner).filter(AssociatePartner.id == row.partner_id).first()
    rider = db.query(User).filter(User.id == row.rider_user_id).first()
    order = db.query(PublicOrder).filter(PublicOrder.id == row.order_id).first()
    order_contact = _setting_json(db, f"order_contact:{row.order_id}")
    customer = db.query(User).filter(User.id == order.customer_user_id).first() if order and order.customer_user_id else None
    customer_phone = "".join(ch for ch in str(order_contact.get("customer_phone") or getattr(customer, "phone", "") or "") if ch.isdigit())
    return {
        "id": row.id,
        "order_id": row.order_id,
        "order_no": f"ORD-{row.order_id[:8].upper()}",
        "partner_id": row.partner_id,
        "partner_name": partner.business_name if partner else "Partner",
        "rider_id": row.rider_user_id,
        "rider_name": rider.name if rider else "Rider",
        "rider_phone": rider.phone if rider else "",
        "customer_name": order.payer_name if order else "Customer",
        "customer_phone": customer_phone,
        "customer_address": order.shipping_address if order else "",
        "status": row.status,
        "distance_km": row.distance_km,
        "pickup_latitude": row.pickup_latitude,
        "pickup_longitude": row.pickup_longitude,
        "drop_latitude": row.drop_latitude,
        "drop_longitude": row.drop_longitude,
        "partner_charge": row.partner_charge,
        "rider_earning": row.rider_earning,
        "partner_payment_status": row.partner_payment_status,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "accepted_at": row.accepted_at.isoformat() if row.accepted_at else None,
        "picked_up_at": row.picked_up_at.isoformat() if row.picked_up_at else None,
        "delivered_at": row.delivered_at.isoformat() if row.delivered_at else None,
    }


@router.post("/partner/orders/{order_id}/delivery")
def assign_partner_order_delivery(order_id: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = _partner(current_user, db)
    _partner_order(db, partner.id, order_id)
    existing = db.query(PartnerOrderDelivery).filter_by(order_id=order_id, partner_id=partner.id).first()
    if existing:
        return {"ok": True, "delivery": _serialize(db, existing), "duplicate": True}
    pickup = _setting_json(db, f"partner_delivery_location:{partner.id}")
    pickup_latitude, pickup_longitude = _coordinates(pickup)
    drop_latitude, drop_longitude = _order_drop_coordinates(db, order_id)
    distance = _distance_km(pickup_latitude, pickup_longitude, drop_latitude, drop_longitude)
    charge, earning = _fee(db, distance)
    candidates = _available_riders(db, pickup_latitude, pickup_longitude)
    rider_id = str((payload or {}).get("rider_id") or "")
    rider = next((item for item in candidates if item["id"] == rider_id), None)
    if not rider:
        raise HTTPException(status_code=409, detail="Selected rider is no longer available; refresh nearby riders")
    row = PartnerOrderDelivery(
        order_id=order_id,
        partner_id=partner.id,
        rider_user_id=rider_id,
        status="assigned",
        pickup_latitude=pickup_latitude,
        pickup_longitude=pickup_longitude,
        drop_latitude=drop_latitude,
        drop_longitude=drop_longitude,
        distance_km=distance,
        partner_charge=charge,
        rider_earning=earning,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "delivery": _serialize(db, row), "duplicate": False}


@router.get("/partner/deliveries")
def partner_deliveries(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = _partner(current_user, db)
    rows = db.query(PartnerOrderDelivery).filter_by(partner_id=partner.id).order_by(PartnerOrderDelivery.created_at.desc()).limit(500).all()
    return {"items": [_serialize(db, row) for row in rows]}


@router.post("/partner/deliveries/{delivery_id}/payment")
def partner_confirm_delivery_payment(delivery_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = _partner(current_user, db)
    row = db.query(PartnerOrderDelivery).filter_by(id=delivery_id, partner_id=partner.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Delivery not found")
    if row.status != "delivered":
        raise HTTPException(status_code=409, detail="Confirm rider cash payment after delivery is complete")
    if row.partner_payment_status == "due":
        row.partner_payment_status = "partner_confirmed"
        db.commit()
    return {"ok": True, "payment_status": row.partner_payment_status}


@router.get("/rider/partner-deliveries")
def rider_partner_deliveries(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "rider":
        raise HTTPException(status_code=403, detail="Rider access only")
    rows = db.query(PartnerOrderDelivery).filter_by(rider_user_id=current_user.id).order_by(PartnerOrderDelivery.created_at.desc()).limit(200).all()
    return {"items": [_serialize(db, row) for row in rows]}


@router.post("/rider/partner-deliveries/{delivery_id}/status")
def update_rider_partner_delivery(delivery_id: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "rider":
        raise HTTPException(status_code=403, detail="Rider access only")
    row = db.query(PartnerOrderDelivery).filter_by(id=delivery_id, rider_user_id=current_user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Delivery not found")
    next_status = str((payload or {}).get("status") or "").strip().lower()
    transitions = {"assigned": "accepted", "accepted": "picked_up", "picked_up": "out_for_delivery", "out_for_delivery": "delivered"}
    if transitions.get(row.status) != next_status:
        raise HTTPException(status_code=409, detail=f"Invalid delivery status transition: {row.status} to {next_status}")
    now = datetime.now(timezone.utc)
    row.status = next_status
    if next_status == "accepted":
        row.accepted_at = now
    elif next_status == "picked_up":
        row.picked_up_at = now
    elif next_status == "delivered":
        row.delivered_at = now
    db.commit()
    return {"ok": True, "delivery": _serialize(db, row)}


@router.post("/rider/partner-deliveries/{delivery_id}/payment")
def rider_confirm_delivery_payment(delivery_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "rider":
        raise HTTPException(status_code=403, detail="Rider access only")
    row = db.query(PartnerOrderDelivery).filter_by(id=delivery_id, rider_user_id=current_user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Delivery not found")
    if row.partner_payment_status != "partner_confirmed":
        raise HTTPException(status_code=409, detail="Partner must confirm cash payment first")
    row.partner_payment_status = "paid"
    db.commit()
    return {"ok": True, "payment_status": row.partner_payment_status}


@router.get("/admin/partner-deliveries")
def admin_partner_deliveries(status: str = Query(default=""), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    query = db.query(PartnerOrderDelivery)
    if status:
        query = query.filter(PartnerOrderDelivery.status == status)
    rows = query.order_by(PartnerOrderDelivery.created_at.desc()).limit(1000).all()
    items = [_serialize(db, row) for row in rows]
    partner_summary = {}
    rider_summary = {}
    for item in items:
        for summary, key, name_field in ((partner_summary, "partner_id", "partner_name"), (rider_summary, "rider_id", "rider_name")):
            group = summary.setdefault(item[key], {"id": item[key], "name": item[name_field], "total": 0, "active": 0, "completed": 0, "fee_due": 0.0})
            group["total"] += 1
            group["active"] += int(item["status"] in ACTIVE_JOB_STATUSES)
            group["completed"] += int(item["status"] == "delivered")
            if item["partner_payment_status"] != "paid":
                group["fee_due"] = round(group["fee_due"] + float(item["partner_charge"] or 0), 2)
    return {
        "items": items,
        "partner_summary": sorted(partner_summary.values(), key=lambda item: item["name"].lower()),
        "rider_summary": sorted(rider_summary.values(), key=lambda item: item["name"].lower()),
        "total": len(items),
        "active": sum(item["status"] in ACTIVE_JOB_STATUSES for item in items),
        "completed": sum(item["status"] == "delivered" for item in items),
        "working_riders": len({item["rider_id"] for item in items if item["status"] in ACTIVE_JOB_STATUSES}),
        "partner_due_total": round(sum(item["partner_charge"] for item in items if item["partner_payment_status"] != "paid"), 2),
        "rider_due_total": round(sum(item["rider_earning"] for item in items if item["partner_payment_status"] != "paid"), 2),
    }