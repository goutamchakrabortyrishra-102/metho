import json
import re
from datetime import datetime, timedelta, timezone

from .models import CRMFollowUp, CRMLead, CRMLeadActivity, WhatsAppRegistrationSession


def normalize_phone(value: str | None) -> str:
    return re.sub(r"\D", "", str(value or ""))


def phone_keys(value: str | None) -> set[str]:
    digits = normalize_phone(value)
    if not digits:
        return set()
    keys = {digits}
    if len(digits) >= 10:
        keys.add(digits[-10:])
    return keys


def find_lead_by_phone(db, *values: str | None) -> CRMLead | None:
    candidates = {key for value in values for key in phone_keys(value)}
    if not candidates:
        return None
    for lead in db.query(CRMLead).filter(CRMLead.phone != "", CRMLead.whatsapp_no != "").all():
        if phone_keys(lead.phone).intersection(candidates) or phone_keys(lead.whatsapp_no).intersection(candidates):
            return lead
    for lead in db.query(CRMLead).filter(CRMLead.phone != "").all():
        if phone_keys(lead.phone).intersection(candidates):
            return lead
    for lead in db.query(CRMLead).filter(CRMLead.whatsapp_no != "").all():
        if phone_keys(lead.whatsapp_no).intersection(candidates):
            return lead
    return None


def enrich_lead_from_contact(lead: CRMLead, *, name: str = "", phone: str = "", whatsapp_no: str = "", email: str = "") -> None:
    if name and (not lead.contact_person or lead.contact_person == "WhatsApp Lead"):
        lead.contact_person = name
    if phone and not lead.phone:
        lead.phone = phone
    if whatsapp_no and not lead.whatsapp_no:
        lead.whatsapp_no = whatsapp_no
    if email and not lead.email:
        lead.email = email


def link_lead_activity(db, lead: CRMLead, activity_type: str, message: str) -> None:
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type=activity_type, message=message))


def ensure_pending_followup(db, lead: CRMLead, *, notes: str) -> None:
    pending = db.query(CRMFollowUp).filter(CRMFollowUp.lead_id == lead.id, CRMFollowUp.status == "Pending").order_by(CRMFollowUp.scheduled_at.asc()).first()
    if pending:
        if pending.scheduled_at and not lead.next_follow_up_at:
            lead.next_follow_up_at = pending.scheduled_at
        return
    scheduled_at = datetime.now(timezone.utc) + timedelta(days=1)
    db.add(CRMFollowUp(lead_id=lead.id, scheduled_at=scheduled_at, status="Pending", notes=notes))
    lead.next_follow_up_at = scheduled_at
    lead.follow_up_status = "Pending"


def _sync_whatsapp_registration_session(db, lead: CRMLead, phone: str, *, user_id: str | None = None, partner_request_id: str | None = None, rider_user_id: str | None = None) -> None:
    session = db.query(WhatsAppRegistrationSession).filter(WhatsAppRegistrationSession.phone == phone).first()
    if not session:
        candidates = phone_keys(phone)
        if candidates:
            session = next((item for item in db.query(WhatsAppRegistrationSession).all() if phone_keys(item.phone).intersection(candidates)), None)
    if not session:
        return
    session.lead_id = lead.id
    session.completed_at = datetime.now(timezone.utc)
    session.name = ""
    session.address = ""
    if user_id:
        session.role = "member"
        session.state = "MEMBER_ACTIVATION_PENDING"
        session.data_json = json.dumps({"member_user_id": user_id}, ensure_ascii=False)
    elif partner_request_id:
        session.role = "partner"
        session.state = "PARTNER_APPLICATION_PENDING"
        session.data_json = json.dumps({"request_id": partner_request_id}, ensure_ascii=False)
    elif rider_user_id:
        session.role = "rider"
        session.state = "RIDER_APPLICATION_PENDING"
        session.data_json = json.dumps({"rider_user_id": rider_user_id}, ensure_ascii=False)


def link_lead_to_registration(db, *, phone: str, email: str = "", user_id: str | None = None, partner_request_id: str | None = None, rider_user_id: str | None = None) -> CRMLead | None:
    lead = find_lead_by_phone(db, phone)
    if not lead:
        return None
    if user_id:
        lead.member_user_id = user_id
    if partner_request_id:
        lead.partner_request_id = partner_request_id
    if rider_user_id:
        lead.rider_user_id = rider_user_id
    if lead.status == "NEW":
        lead.status = "APPLICATION"
    lead.follow_up_status = "Completed"
    lead.next_follow_up_at = None
    if email and not lead.email:
        lead.email = email
    registration_type = "member" if user_id else "partner" if partner_request_id else "rider"
    link_lead_activity(db, lead, "registration_linked", f"{registration_type.title()} registration linked to this CRM lead")
    _sync_whatsapp_registration_session(db, lead, phone, user_id=user_id, partner_request_id=partner_request_id, rider_user_id=rider_user_id)
    return lead
