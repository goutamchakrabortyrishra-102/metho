import json
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    AppSetting,
    AssociatePartner,
    CRMFollowUp,
    CRMLead,
    CRMLeadActivity,
    CRMLeadSnapshot,
    CRMTask,
    Order,
    PartnerRequest,
    PublicOrder,
    User,
    UserReferral,
    CRM_ALLOWED_STAGES,
)
from .auth import get_current_user
from .partner_public import partner_register

router = APIRouter(prefix="/api", tags=["crm"])

CRM_STAGE_SEQUENCE = [
    "NEW",
    "CONTACTED",
    "INTERESTED",
    "QUALIFIED",
    "APPLICATION",
    "APPROVED",
    "CONVERTED",
    "LOST",
]

CRM_FOLLOWUP_STATUSES = {"Pending", "Completed", "Cancelled", "Overdue"}
CRM_TASK_STATUSES = {"Pending", "In Progress", "Completed", "Cancelled", "Overdue"}
CRM_TASK_PRIORITIES = {"Low", "Medium", "High", "Urgent"}
CRM_ASSIGNEE_ROLES = {"super_admin", "company_admin", "admin"}


def _require_admin_user(current_user: User):
    if getattr(current_user, "role", "") not in {"super_admin", "company_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Admin access required")


def _safe_json(value: str | None) -> list[str]:
    try:
        parsed = json.loads(value or "[]")
    except Exception:
        parsed = []
    if not isinstance(parsed, list):
        return []
    return [str(item) for item in parsed if item is not None]


def _iso(dt: datetime | None) -> str | None:
    if not dt:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc).isoformat()
    return dt.isoformat()


def _member_code_from_user(user_id: str | None) -> str:
    if not user_id:
        return ""
    return f"MTH-{str(user_id).upper().replace('-', '')[:6]}" if user_id else ""


def _resolve_crm_assignee(db: Session, user_id: str | None, required: bool = False) -> User | None:
    normalized = str(user_id or "").strip()
    if not normalized:
        if required:
            raise HTTPException(status_code=400, detail="Assigned user is required")
        return None
    user = db.query(User).filter(User.id == normalized).first()
    if not user or user.role not in CRM_ASSIGNEE_ROLES or not bool(user.is_active):
        raise HTTPException(status_code=400, detail="Assigned user must be an active admin")
    return user


def _parse_crm_datetime(value, detail: str = "Invalid due date") -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=detail) from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _lead_lookup_filters(db: Session, search: str | None = None, status: str | None = None, city: str | None = None, hot_only: bool = False):
    query = db.query(CRMLead)
    if search:
        term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                CRMLead.business_name.ilike(term),
                CRMLead.contact_person.ilike(term),
                CRMLead.phone.ilike(term),
                CRMLead.whatsapp_no.ilike(term),
                CRMLead.city.ilike(term),
                CRMLead.email.ilike(term),
            )
        )
    if status:
        query = query.filter(CRMLead.status == status.upper())
    if city:
        query = query.filter(CRMLead.city.ilike(f"%{city.strip()}%"))
    if hot_only:
        query = query.filter(CRMLead.priority_bucket.in_(["Hot", "Warm"]))
    return query.order_by(CRMLead.updated_at.desc())


def _to_lead_payload(lead: CRMLead) -> dict:
    return {
        "id": lead.id,
        "lead_id": lead.lead_id,
        "business_name": lead.business_name,
        "business_type": lead.business_type,
        "contact_person": lead.contact_person,
        "phone": lead.phone,
        "whatsapp_no": lead.whatsapp_no,
        "email": lead.email,
        "address": lead.address,
        "city": lead.city,
        "state": lead.state,
        "pincode": lead.pincode,
        "source": lead.source,
        "status": lead.status,
        "score": lead.score,
        "priority_bucket": lead.priority_bucket,
        "tags": _safe_json(lead.tags_json),
        "notes": lead.notes,
        "member_user_id": lead.member_user_id,
        "member_code": _member_code_from_user(lead.member_user_id),
        "partner_id": lead.partner_id,
        "partner_request_id": lead.partner_request_id,
        "converted_partner_id": lead.converted_partner_id,
        "assigned_user_id": lead.assigned_user_id,
        "last_contact_at": _iso(lead.last_contact_at),
        "next_follow_up_at": _iso(lead.next_follow_up_at),
        "follow_up_status": lead.follow_up_status,
        "created_by_user_id": lead.created_by_user_id,
        "created_at": _iso(lead.created_at),
        "updated_at": _iso(lead.updated_at),
    }


def _partner_conversion_state(lead: CRMLead, db: Session) -> dict:
    partner = None
    if lead.converted_partner_id or lead.partner_id:
        partner = db.query(AssociatePartner).filter(
            AssociatePartner.id == (lead.converted_partner_id or lead.partner_id)
        ).first()
    request = None
    if lead.partner_request_id:
        request = db.query(PartnerRequest).filter(PartnerRequest.id == lead.partner_request_id).first()
    if partner:
        return {"status": "approved", "label": "Already Partner", "partner_id": partner.id, "partner_code": partner.partner_code}
    if request:
        request_status = str(request.status or "pending").lower()
        return {"status": request_status, "label": "Partner request pending" if request_status == "pending" else f"Partner request {request.status}", "request_id": request.id}
    existing_partner = None
    if lead.phone:
        existing_partner = db.query(AssociatePartner).filter(AssociatePartner.phone == lead.phone).first()
    if not existing_partner and lead.email:
        existing_partner = db.query(AssociatePartner).filter(AssociatePartner.email == lead.email).first()
    if existing_partner:
        return {"status": "approved", "label": "Already Partner", "partner_id": existing_partner.id, "partner_code": existing_partner.partner_code}
    return {"status": "not_started", "label": "Not started"}


@router.get("/admin/crm/leads/{lead_id}/conversion")
def get_lead_conversion(lead_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin_user(current_user)
    lead = db.query(CRMLead).filter(CRMLead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"lead_id": lead.id, "conversion": _partner_conversion_state(lead, db)}


@router.post("/admin/crm/leads/{lead_id}/convert-to-partner")
def convert_lead_to_partner(lead_id: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin_user(current_user)
    lead = db.query(CRMLead).filter(CRMLead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    state = _partner_conversion_state(lead, db)
    if state["status"] == "approved":
        raise HTTPException(status_code=409, detail="Already Partner")
    if state["status"] == "pending":
        return {"ok": True, "reused": True, "request_id": state["request_id"], "status": "pending", "message": "Existing PartnerRequest reused"}
    if lead.status not in {"QUALIFIED", "APPLICATION", "APPROVED"}:
        raise HTTPException(status_code=400, detail="Lead must be QUALIFIED, APPLICATION, or APPROVED before conversion")

    phone = str(lead.phone or "").strip()
    email = str((payload or {}).get("login_id") or lead.email or "").strip()
    existing_member = None
    if lead.member_user_id:
        existing_member = db.query(User).filter(User.id == lead.member_user_id).first()
    if not existing_member and phone:
        existing_member = db.query(User).filter(User.phone == phone, User.role == "member").first()
    if existing_member:
        raise HTTPException(status_code=409, detail="This lead is already linked to a member")
    existing_request = None
    if phone:
        existing_request = db.query(PartnerRequest).filter(PartnerRequest.phone == phone, PartnerRequest.status.in_(["pending", "approved"])).first()
    if not existing_request and email:
        existing_request = db.query(PartnerRequest).filter(PartnerRequest.email == email, PartnerRequest.status.in_(["pending", "approved"])).first()
    if existing_request:
        if str(existing_request.status or "").lower() == "approved":
            raise HTTPException(status_code=409, detail="This lead already has an approved PartnerRequest")
        lead.partner_request_id = existing_request.id
        lead.updated_at = datetime.now(timezone.utc)
        db.add(CRMLeadActivity(lead_id=lead.id, activity_type="partner_request_reused", message="Existing PartnerRequest linked from CRM conversion", actor_user_id=current_user.id))
        db.commit()
        return {"ok": True, "reused": True, "request_id": existing_request.id, "status": "pending", "message": "Existing PartnerRequest reused"}

    sector = str((payload or {}).get("business_type") or lead.business_type or "Shop").strip()
    if sector.lower() not in {"shop", "service"}:
        sector = "Service" if "service" in sector.lower() else "Shop"
    registration_payload = {
        "login_id": email,
        "password": str((payload or {}).get("password") or "").strip(),
        "business_name": lead.business_name,
        "business_type": sector,
        "contact_person": lead.contact_person,
        "phone": phone,
        "whatsapp_no": lead.whatsapp_no or phone,
        "address": lead.address,
        "city": lead.city,
        "state": lead.state,
        "pincode": lead.pincode,
        "pan_no": str((payload or {}).get("pan_no") or "").strip().upper(),
        "aadhaar_no": str((payload or {}).get("aadhaar_no") or "").strip(),
        "gst_no": str((payload or {}).get("pan_no") or "").strip().upper(),
        "business_description": lead.notes,
        "commission_percent_ask": (payload or {}).get("commission_percent_ask") or 0,
    }
    registration_result = partner_register(registration_payload, db)
    request_id = registration_result.get("request_id")
    if not request_id:
        raise HTTPException(status_code=502, detail="Partner registration did not return a request reference")
    lead.partner_request_id = request_id
    lead.updated_at = datetime.now(timezone.utc)
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="partner_request_created", message="PartnerRequest created through authoritative partner registration flow", actor_user_id=current_user.id))
    db.commit()
    return {"ok": True, "reused": False, "request_id": request_id, "status": "pending", "message": "PartnerRequest created and awaiting admin approval"}


def _duplicate_existing_record(db: Session, business_name: str, phone: str, whatsapp_no: str, city: str) -> dict | None:
    normalized_phone = str(phone or "").strip()
    normalized_whatsapp = str(whatsapp_no or "").strip()
    business_text = str(business_name or "").strip().lower()
    city_text = str(city or "").strip().lower()

    query = db.query(CRMLead)
    if normalized_phone:
        query = query.filter(or_(CRMLead.phone == normalized_phone, CRMLead.whatsapp_no == normalized_phone))
    elif normalized_whatsapp:
        query = query.filter(or_(CRMLead.phone == normalized_whatsapp, CRMLead.whatsapp_no == normalized_whatsapp))

    candidate = query.first()
    if candidate:
        return {
            "type": "crm_lead",
            "id": candidate.id,
            "lead_id": candidate.lead_id,
            "business_name": candidate.business_name,
            "message": "Possible existing record found",
        }

    if normalized_phone:
        member = db.query(User).filter(User.phone == normalized_phone).first()
        if member:
            return {"type": "member", "id": member.id, "business_name": member.name, "message": "Possible existing record found"}

    if normalized_whatsapp:
        member = db.query(User).filter(User.phone == normalized_whatsapp).first()
        if member:
            return {"type": "member", "id": member.id, "business_name": member.name, "message": "Possible existing record found"}

    if normalized_phone:
        partner = db.query(AssociatePartner).filter(AssociatePartner.phone == normalized_phone).first()
        if partner:
            return {"type": "partner", "id": partner.id, "business_name": partner.business_name, "message": "Possible existing record found"}

    if business_text and city_text:
        existing = db.query(CRMLead).filter(
            CRMLead.business_name.ilike(f"%{business_text}%"),
            CRMLead.city.ilike(f"%{city_text}%"),
        ).first()
        if existing:
            return {"type": "crm_lead", "id": existing.id, "business_name": existing.business_name, "message": "Possible existing record found"}

    return None


@router.get("/admin/crm/leads")
def list_crm_leads(
    search: str | None = None,
    status: str | None = None,
    city: str | None = None,
    hot_only: bool = False,
    assigned_user_id: str | None = None,
    source: str | None = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_user(current_user)
    safe_limit = max(1, min(limit, 200))
    safe_offset = max(0, offset)
    query = _lead_lookup_filters(db, search=search, status=status, city=city, hot_only=hot_only)
    if assigned_user_id:
        query = query.filter(CRMLead.assigned_user_id == assigned_user_id.strip())
    if source:
        query = query.filter(CRMLead.source == source.strip())
    total = query.count()
    rows = query.limit(safe_limit).offset(safe_offset).all()
    return {
        "items": [_to_lead_payload(lead) for lead in rows],
        "count": len(rows),
        "total": total,
        "limit": safe_limit,
        "offset": safe_offset,
    }


@router.post("/admin/crm/leads")
def create_crm_lead(payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin_user(current_user)
    business_name = str((payload or {}).get("business_name") or "").strip()
    if not business_name:
        raise HTTPException(status_code=400, detail="Business name is required")

    duplicate = _duplicate_existing_record(
        db,
        business_name=business_name,
        phone=str((payload or {}).get("phone") or "").strip(),
        whatsapp_no=str((payload or {}).get("whatsapp_no") or "").strip(),
        city=str((payload or {}).get("city") or "").strip(),
    )
    if duplicate:
        raise HTTPException(status_code=409, detail=duplicate["message"])

    status = str((payload or {}).get("status") or "NEW").upper()
    if status not in {"NEW", "CONTACTED", "INTERESTED", "QUALIFIED", "APPLICATION", "APPROVED", "CONVERTED", "LOST"}:
        status = "NEW"

    lead = CRMLead(
        business_name=business_name,
        business_type=str((payload or {}).get("business_type") or "").strip(),
        contact_person=str((payload or {}).get("contact_person") or "").strip(),
        phone=str((payload or {}).get("phone") or "").strip(),
        whatsapp_no=str((payload or {}).get("whatsapp_no") or "").strip(),
        email=str((payload or {}).get("email") or "").strip(),
        address=str((payload or {}).get("address") or "").strip(),
        city=str((payload or {}).get("city") or "").strip(),
        state=str((payload or {}).get("state") or "").strip(),
        pincode=str((payload or {}).get("pincode") or "").strip(),
        source=str((payload or {}).get("source") or "manual").strip() or "manual",
        status=status,
        score=int((payload or {}).get("score") or 0),
        priority_bucket=str((payload or {}).get("priority_bucket") or "Cold").strip() or "Cold",
        tags_json=json.dumps((payload or {}).get("tags") or []),
        notes=str((payload or {}).get("notes") or "").strip(),
        member_user_id=str((payload or {}).get("member_user_id") or "") or None,
        partner_id=str((payload or {}).get("partner_id") or "") or None,
        partner_request_id=str((payload or {}).get("partner_request_id") or "") or None,
        converted_partner_id=str((payload or {}).get("converted_partner_id") or "") or None,
        follow_up_status="Pending",
        created_by_user_id=current_user.id,
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)

    activity = CRMLeadActivity(
        lead_id=lead.id,
        activity_type="lead_created",
        message=f"Lead created by {current_user.name}",
        actor_user_id=current_user.id,
    )
    db.add(activity)
    db.commit()

    return {"ok": True, "lead": _to_lead_payload(lead)}


@router.get("/admin/crm/leads/{lead_id}")
def get_crm_lead(lead_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin_user(current_user)
    lead = db.query(CRMLead).filter(CRMLead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"lead": _to_lead_payload(lead)}


@router.put("/admin/crm/leads/{lead_id}")
def update_crm_lead(lead_id: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin_user(current_user)
    lead = db.query(CRMLead).filter(CRMLead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    for field in [
        "business_name",
        "business_type",
        "contact_person",
        "phone",
        "whatsapp_no",
        "email",
        "address",
        "city",
        "state",
        "pincode",
        "source",
        "status",
        "score",
        "priority_bucket",
        "notes",
        "member_user_id",
        "partner_id",
        "partner_request_id",
        "converted_partner_id",
        "assigned_user_id",
        "follow_up_status",
    ]:
        if field in payload:
            value = payload[field]
            if field == "status":
                value = str(value or "").strip().upper()
                if value not in CRM_ALLOWED_STAGES:
                    raise HTTPException(status_code=400, detail="Invalid CRM lead stage")
            elif field == "follow_up_status":
                value = str(value or "").strip()
                if value not in CRM_FOLLOWUP_STATUSES:
                    raise HTTPException(status_code=400, detail="Invalid follow-up status")
            elif field == "priority_bucket":
                value = str(value or "").strip() or getattr(lead, field)
            elif field == "assigned_user_id":
                value = _resolve_crm_assignee(db, value).id if str(value or "").strip() else None
            setattr(lead, field, value)
    lead.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "lead": _to_lead_payload(lead)}


@router.get("/admin/crm/leads/{lead_id}/activities")
def get_crm_activities(lead_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin_user(current_user)
    rows = db.query(CRMLeadActivity).filter(CRMLeadActivity.lead_id == lead_id).order_by(CRMLeadActivity.created_at.desc()).all()
    return {"items": [{
        "id": row.id,
        "activity_type": row.activity_type,
        "message": row.message,
        "actor_user_id": row.actor_user_id,
        "created_at": _iso(row.created_at),
    } for row in rows]}


@router.post("/admin/crm/leads/{lead_id}/activities")
def create_crm_activity(lead_id: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin_user(current_user)
    lead = db.query(CRMLead).filter(CRMLead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    row = CRMLeadActivity(
        lead_id=lead.id,
        activity_type=str((payload or {}).get("activity_type") or "note").strip() or "note",
        message=str((payload or {}).get("message") or "").strip(),
        actor_user_id=current_user.id,
    )
    db.add(row)
    db.commit()
    return {"ok": True, "activity": {
        "id": row.id,
        "lead_id": lead.id,
        "activity_type": row.activity_type,
        "message": row.message,
        "actor_user_id": row.actor_user_id,
        "created_at": _iso(row.created_at),
    }}


@router.post("/admin/crm/leads/{lead_id}/followups")
def create_followup(lead_id: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin_user(current_user)
    lead = db.query(CRMLead).filter(CRMLead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    follow_up_at = (payload or {}).get("scheduled_at")
    try:
        dt = datetime.fromisoformat(str(follow_up_at).replace("Z", "+00:00")) if follow_up_at else datetime.now(timezone.utc) + timedelta(days=1)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid follow-up date") from exc
    follow_up_status = str((payload or {}).get("status") or "Pending").strip() or "Pending"
    if follow_up_status not in CRM_FOLLOWUP_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid follow-up status")
    entry = CRMFollowUp(
        lead_id=lead.id,
        scheduled_at=dt,
        status=follow_up_status,
        notes=str((payload or {}).get("notes") or "").strip(),
        created_by_user_id=current_user.id,
    )
    db.add(entry)
    lead.last_contact_at = datetime.now(timezone.utc)
    lead.next_follow_up_at = dt
    lead.follow_up_status = follow_up_status
    db.commit()
    return {"ok": True, "followup": {
        "id": entry.id,
        "lead_id": lead.id,
        "scheduled_at": _iso(entry.scheduled_at),
        "status": entry.status,
        "notes": entry.notes,
    }}


@router.post("/admin/crm/leads/{lead_id}/assignment")
def assign_crm_lead(lead_id: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin_user(current_user)
    lead = db.query(CRMLead).filter(CRMLead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    assignee = _resolve_crm_assignee(db, (payload or {}).get("assigned_user_id"))
    lead.assigned_user_id = assignee.id if assignee else None
    lead.updated_at = datetime.now(timezone.utc)
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="lead_assigned", message=f"Lead assigned to {assignee.name}" if assignee else "Lead assignment cleared", actor_user_id=current_user.id))
    db.commit()
    return {"ok": True, "lead": _to_lead_payload(lead)}


@router.get("/admin/crm/assignees")
def crm_assignees(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin_user(current_user)
    users = db.query(User).filter(User.role.in_(list(CRM_ASSIGNEE_ROLES)), User.is_active.is_(True)).order_by(User.name.asc()).all()
    return {"items": [{"id": user.id, "name": user.name, "email": user.email, "role": user.role} for user in users]}


def _task_payload(task: CRMTask) -> dict:
    return {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "due_at": _iso(task.due_at),
        "status": task.status,
        "priority": task.priority,
        "lead_id": task.lead_id,
        "customer_user_id": task.customer_user_id,
        "assigned_user_id": task.assigned_user_id,
        "created_by_user_id": task.created_by_user_id,
        "created_at": _iso(task.created_at),
        "updated_at": _iso(task.updated_at),
    }


@router.get("/admin/crm/tasks")
def list_crm_tasks(lead_id: str | None = None, assigned_user_id: str | None = None, status: str | None = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin_user(current_user)
    query = db.query(CRMTask).order_by(CRMTask.due_at.asc())
    if lead_id:
        query = query.filter(CRMTask.lead_id == lead_id.strip())
    if assigned_user_id:
        query = query.filter(CRMTask.assigned_user_id == assigned_user_id.strip())
    if status:
        query = query.filter(CRMTask.status == status.strip())
    return {"items": [_task_payload(task) for task in query.limit(200).all()]}


@router.post("/admin/crm/tasks")
def create_crm_task(payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin_user(current_user)
    data = payload or {}
    title = str(data.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Task title is required")
    lead_id = str(data.get("lead_id") or "").strip() or None
    if lead_id and not db.query(CRMLead).filter(CRMLead.id == lead_id).first():
        raise HTTPException(status_code=404, detail="Lead not found")
    customer_user_id = str(data.get("customer_user_id") or "").strip() or None
    if customer_user_id and not db.query(User).filter(User.id == customer_user_id).first():
        raise HTTPException(status_code=404, detail="Customer not found")
    status = str(data.get("status") or "Pending").strip()
    priority = str(data.get("priority") or "Medium").strip()
    if status not in CRM_TASK_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid task status")
    if priority not in CRM_TASK_PRIORITIES:
        raise HTTPException(status_code=400, detail="Invalid task priority")
    task = CRMTask(title=title, description=str(data.get("description") or data.get("note") or "").strip(), due_at=_parse_crm_datetime(data.get("due_at")), status=status, priority=priority, lead_id=lead_id, customer_user_id=customer_user_id, assigned_user_id=_resolve_crm_assignee(db, data.get("assigned_user_id"), required=True).id, created_by_user_id=current_user.id)
    db.add(task)
    db.commit()
    db.refresh(task)
    return {"ok": True, "task": _task_payload(task)}


@router.put("/admin/crm/tasks/{task_id}")
def update_crm_task(task_id: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin_user(current_user)
    task = db.query(CRMTask).filter(CRMTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    data = payload or {}
    if "title" in data:
        title = str(data.get("title") or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="Task title is required")
        task.title = title
    if "description" in data or "note" in data:
        task.description = str(data.get("description") if "description" in data else data.get("note") or "").strip()
    if "due_at" in data:
        task.due_at = _parse_crm_datetime(data.get("due_at"))
    if "status" in data:
        status = str(data.get("status") or "").strip()
        if status not in CRM_TASK_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid task status")
        task.status = status
    if "priority" in data:
        priority = str(data.get("priority") or "").strip()
        if priority not in CRM_TASK_PRIORITIES:
            raise HTTPException(status_code=400, detail="Invalid task priority")
        task.priority = priority
    if "assigned_user_id" in data:
        task.assigned_user_id = _resolve_crm_assignee(db, data.get("assigned_user_id"), required=True).id
    task.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(task)
    return {"ok": True, "task": _task_payload(task)}


@router.put("/admin/crm/followups/{followup_id}")
def update_followup(followup_id: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin_user(current_user)
    row = db.query(CRMFollowUp).filter(CRMFollowUp.id == followup_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    if "status" in payload:
        next_status = str(payload.get("status") or row.status).strip() or row.status
        if next_status not in CRM_FOLLOWUP_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid follow-up status")
        row.status = next_status
    if "notes" in payload:
        row.notes = str(payload.get("notes") or row.notes).strip()
    if "scheduled_at" in payload:
        value = payload.get("scheduled_at")
        try:
            row.scheduled_at = datetime.fromisoformat(str(value).replace("Z", "+00:00")) if value else row.scheduled_at
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="Invalid follow-up date") from exc
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "followup": {
        "id": row.id,
        "lead_id": row.lead_id,
        "scheduled_at": _iso(row.scheduled_at),
        "status": row.status,
        "notes": row.notes,
    }}


@router.get("/admin/crm/pipeline")
def crm_pipeline(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin_user(current_user)
    stage_rows = []
    for stage in CRM_STAGE_SEQUENCE:
        count = db.query(CRMLead).filter(CRMLead.status == stage).count()
        stage_rows.append({"stage": stage, "count": count})
    return {"stages": stage_rows}


@router.get("/admin/crm/dashboard")
def crm_dashboard(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin_user(current_user)
    today = datetime.now(timezone.utc)
    start_of_today = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
    start_of_month = datetime(today.year, today.month, 1, tzinfo=timezone.utc)

    leads_total = db.query(CRMLead).count()
    hot_leads = db.query(CRMLead).filter(CRMLead.priority_bucket == "Hot").count()
    pending_followups = db.query(CRMFollowUp).filter(CRMFollowUp.status == "Pending").count()
    overdue_followups = db.query(CRMFollowUp).filter(CRMFollowUp.status == "Overdue").count()

    new_members = db.query(User).filter(User.role == "member", User.created_at >= start_of_month).count()
    active_members = db.query(User).filter(User.role == "member", User.is_active.is_(True)).count()
    new_partners = db.query(AssociatePartner).filter(AssociatePartner.created_at >= start_of_month).count()
    active_partners = db.query(AssociatePartner).filter(AssociatePartner.active.is_(True)).count()
    total_orders = db.query(Order).count()
    total_sales = round(float(db.query(func.coalesce(func.sum(Order.total_amount), 0)).scalar() or 0), 2)
    pending_partner_approvals = db.query(PartnerRequest).filter(PartnerRequest.status == "pending").count()
    pending_withdrawals = db.query(AppSetting).filter(AppSetting.key.like("withdrawal:%")).count()

    return {
        "metrics": {
            "total_leads": leads_total,
            "hot_leads": hot_leads,
            "pending_followups": pending_followups,
            "overdue_followups": overdue_followups,
            "new_members": new_members,
            "active_members": active_members,
            "new_partners": new_partners,
            "active_partners": active_partners,
            "total_orders": total_orders,
            "total_sales": total_sales,
            "pending_partner_approvals": pending_partner_approvals,
            "pending_withdrawals": pending_withdrawals,
            "today": start_of_today.isoformat(),
        },
        "stages": [{"stage": stage, "count": db.query(CRMLead).filter(CRMLead.status == stage).count()} for stage in CRM_STAGE_SEQUENCE],
    }


@router.get("/admin/members/{member_id}/360")
def member_360(member_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin_user(current_user)
    user = db.query(User).filter(User.id == member_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Member not found")

    sponsor = db.query(UserReferral).filter(UserReferral.user_id == user.id).first()
    sponsor_user = db.query(User).filter(User.id == sponsor.sponsor_user_id).first() if sponsor else None

    order_rows = db.query(Order).filter(Order.user_id == user.id).order_by(Order.created_at.desc()).limit(10).all()
    total_orders = db.query(Order).filter(Order.user_id == user.id).count()
    completed_orders = db.query(Order).filter(Order.user_id == user.id, Order.status.in_(["paid", "completed", "delivered"])).count()
    total_purchase = round(float(db.query(func.coalesce(func.sum(Order.total_amount), 0)).filter(Order.user_id == user.id).scalar() or 0), 2)

    leads = db.query(CRMLead).filter(CRMLead.member_user_id == user.id).order_by(CRMLead.updated_at.desc()).all()
    lead = leads[0] if leads else None
    activities = []
    if lead:
        activities = db.query(CRMLeadActivity).filter(CRMLeadActivity.lead_id == lead.id).order_by(CRMLeadActivity.created_at.desc()).all()

    return {
        "profile": {
            "user_id": user.id,
            "name": user.name,
            "member_code": f"MTH-{str(user.id).upper().replace('-', '')[:6]}",
            "phone": user.phone,
            "email": user.email,
            "status": user.is_active,
            "join_date": _iso(user.created_at),
        },
        "network": {
            "sponsor": sponsor_user.name if sponsor_user else None,
            "sponsor_code": sponsor.sponsor_code if sponsor else None,
            "direct_referral": db.query(UserReferral).filter(UserReferral.sponsor_user_id == user.id).count(),
            "team": db.query(UserReferral).filter(UserReferral.sponsor_user_id == user.id).count(),
            "genealogy": [],
        },
        "business": {
            "total_orders": total_orders,
            "completed_orders": completed_orders,
            "total_purchase": total_purchase,
            "last_order": _iso(order_rows[0].created_at) if order_rows else None,
            "recent_orders": [{
                "id": row.id,
                "status": row.status,
                "total_amount": row.total_amount,
                "created_at": _iso(row.created_at),
            } for row in order_rows],
        },
        "finance": {
            "wallet": "existing system wallet",
            "rewards": "existing system rewards",
            "withdrawals": "existing system withdrawals",
            "ledger": "existing system ledger",
            "settlement": "existing system settlement",
        },
        "crm": {
            "lead_status": lead.status if lead else None,
            "tags": _safe_json(lead.tags_json) if lead else [],
            "notes": lead.notes if lead else "",
            "last_contact": _iso(lead.last_contact_at) if lead else None,
            "next_follow_up": _iso(lead.next_follow_up_at) if lead else None,
            "activity_timeline": [{
                "id": row.id,
                "activity_type": row.activity_type,
                "message": row.message,
                "actor_user_id": row.actor_user_id,
                "created_at": _iso(row.created_at),
            } for row in activities],
        },
    }


@router.get("/admin/ceo-dashboard")
def ceo_dashboard(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin_user(current_user)
    today = datetime.now(timezone.utc)
    start_of_month = datetime(today.year, today.month, 1, tzinfo=timezone.utc)

    daily_sales = round(float(db.query(func.coalesce(func.sum(Order.total_amount), 0)).filter(Order.created_at >= start_of_month).scalar() or 0), 2)
    total_orders = db.query(Order).count()
    new_members = db.query(User).filter(User.role == "member", User.created_at >= start_of_month).count()
    active_members = db.query(User).filter(User.role == "member", User.is_active.is_(True)).count()
    new_partners = db.query(AssociatePartner).filter(AssociatePartner.created_at >= start_of_month).count()
    active_partners = db.query(AssociatePartner).filter(AssociatePartner.active.is_(True)).count()
    new_leads = db.query(CRMLead).filter(CRMLead.created_at >= start_of_month).count()
    hot_leads = db.query(CRMLead).filter(CRMLead.priority_bucket == "Hot").count()
    pending_followups = db.query(CRMFollowUp).filter(CRMFollowUp.status == "Pending").count()
    overdue = db.query(CRMFollowUp).filter(CRMFollowUp.status == "Overdue").count()
    pending_partner_approvals = db.query(PartnerRequest).filter(PartnerRequest.status == "pending").count()
    pending_product_approvals = db.query(AppSetting).filter(AppSetting.key.like("product_approval:%")).count()
    pending_withdrawals = db.query(AppSetting).filter(AppSetting.key.like("withdrawal:%")).count()

    return {
        "today_sales": round(float(db.query(func.coalesce(func.sum(Order.total_amount), 0)).filter(Order.created_at >= datetime(today.year, today.month, today.day, tzinfo=timezone.utc)).scalar() or 0), 2),
        "monthly_sales": daily_sales,
        "total_orders": total_orders,
        "new_members": new_members,
        "active_members": active_members,
        "new_partners": new_partners,
        "active_partners": active_partners,
        "new_leads": new_leads,
        "hot_leads": hot_leads,
        "pending_followups": pending_followups,
        "overdue_followups": overdue,
        "conversion_rate": round((db.query(CRMLead).filter(CRMLead.status == "CONVERTED").count() / max(1, db.query(CRMLead).count())) * 100, 2),
        "pending_partner_approvals": pending_partner_approvals,
        "pending_product_approvals": pending_product_approvals,
        "pending_withdrawals": pending_withdrawals,
        "source": "existing system data only",
    }


@router.post("/admin/crm/lead/save-from-partners-page")
def save_from_partners_page(payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin_user(current_user)
    business_name = str((payload or {}).get("business_name") or "").strip()
    if not business_name:
        raise HTTPException(status_code=400, detail="Business name is required")

    payload = payload or {}
    duplicate = _duplicate_existing_record(
        db,
        business_name=business_name,
        phone=str(payload.get("phone") or "").strip(),
        whatsapp_no=str(payload.get("whatsapp_no") or "").strip(),
        city=str(payload.get("city") or "").strip(),
    )
    if duplicate:
        return {"ok": False, "duplicate": True, "message": duplicate["message"], "record": duplicate}

    lead = CRMLead(
        business_name=business_name,
        business_type=str(payload.get("business_type") or "").strip(),
        contact_person=str(payload.get("contact_person") or "").strip(),
        phone=str(payload.get("phone") or "").strip(),
        whatsapp_no=str(payload.get("whatsapp_no") or "").strip(),
        email=str(payload.get("email") or "").strip(),
        address=str(payload.get("address") or "").strip(),
        city=str(payload.get("city") or "").strip(),
        state=str(payload.get("state") or "").strip(),
        pincode=str(payload.get("pincode") or "").strip(),
        source="partners_page",
        status="NEW",
        score=int(payload.get("lead_score") or 0),
        priority_bucket=str(payload.get("priority_bucket") or "Cold").strip() or "Cold",
        tags_json=json.dumps(payload.get("tags") or []),
        notes=str(payload.get("notes") or "").strip(),
        created_by_user_id=current_user.id,
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return {"ok": True, "lead": _to_lead_payload(lead)}
