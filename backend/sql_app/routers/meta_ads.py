import json
import hashlib
import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..meta_ads import fetch_lead, normalize_lead, resolve_config, verify_signature, verify_webhook_token, webhook_lead_ids
from ..models import CRMFollowUp, CRMLead, CRMLeadActivity, CRMTask, User

router = APIRouter(prefix="/api", tags=["meta-ads"])


def _admin_assignee(db: Session) -> User | None:
    configured = resolve_config(db).get("default_assignee_id")
    query = db.query(User).filter(User.role.in_(["super_admin", "company_admin", "admin"]), User.is_active.is_(True))
    if configured:
        return query.filter(User.id == configured).first()
    return query.order_by(User.created_at.asc()).first()


def _ingest_lead(db: Session, meta_payload: dict, event: dict) -> str:
    normalized = normalize_lead(meta_payload, event)
    external_id = normalized["external_lead_id"]
    existing = db.query(CRMLead).filter(CRMLead.lead_id == normalized["lead_id"]).first()
    if existing:
        return "duplicate"
    lead = CRMLead(
        id=hashlib.sha256(external_id.encode("utf-8")).hexdigest()[:36],
        lead_id=normalized["lead_id"],
        business_name=normalized["business_name"],
        business_type="Meta Lead",
        contact_person=normalized["contact_person"],
        phone=normalized["phone"],
        whatsapp_no=normalized["whatsapp_no"],
        email=normalized["email"],
        address=normalized["address"],
        city=normalized["city"],
        state=normalized["state"],
        pincode=normalized["pincode"],
        source=normalized["source"],
        tags_json=json.dumps(normalized["tags"]),
        notes=json.dumps(normalized["metadata"], sort_keys=True),
        status="NEW",
        priority_bucket="Cold",
    )
    assignee = _admin_assignee(db)
    if assignee:
        lead.assigned_user_id = assignee.id
    db.add(lead)
    db.flush()
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="meta_lead_received", message=f"Meta Lead Ads lead received: {external_id}"))
    db.add(CRMFollowUp(lead_id=lead.id, scheduled_at=datetime.now(timezone.utc) + timedelta(days=1), status="Pending", notes="Initial follow-up for Meta/Facebook Lead Ads lead"))
    if assignee:
        db.add(CRMTask(title="Initial Meta lead follow-up", description="Contact and qualify new Meta/Facebook Lead Ads lead", due_at=datetime.now(timezone.utc) + timedelta(days=1), status="Pending", priority="High", lead_id=lead.id, assigned_user_id=assignee.id, created_by_user_id=assignee.id))
    db.commit()
    return "created"


@router.get("/webhooks/meta/leads")
@router.get("/webhooks/facebook")
def verify_meta_webhook(mode: str | None = Query(default=None, alias="hub.mode"), token: str | None = Query(default=None, alias="hub.verify_token"), challenge: str | None = Query(default=None, alias="hub.challenge")):
    if mode != "subscribe":
        raise HTTPException(status_code=400, detail="Invalid webhook mode")
    verified = verify_webhook_token(token or "", challenge or "")
    if verified is None:
        raise HTTPException(status_code=403, detail="Invalid webhook verification token")
    return int(verified) if verified.isdigit() else verified


@router.post("/webhooks/meta/leads")
@router.post("/webhooks/facebook")
async def receive_meta_webhook(request: Request, db: Session = Depends(get_db)):
    body = await request.body()
    try:
        signature_valid = verify_signature(body, request.headers.get("X-Hub-Signature-256"), db)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="Meta webhook configuration unavailable") from exc
    if not signature_valid:
        raise HTTPException(status_code=403, detail="Invalid webhook signature")
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Malformed webhook payload") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Webhook payload must be an object")
    lead_ids = webhook_lead_ids(payload)
    if not lead_ids:
        raise HTTPException(status_code=400, detail="No Meta lead event found")
    results = []
    for entry in payload.get("entry") or []:
        for change in (entry or {}).get("changes") or []:
            value = (change or {}).get("value") or {}
            event = {**value, "page_id": str((entry or {}).get("id") or value.get("page_id") or "").strip(), "event_time": str(payload.get("time") or "").strip()}
            lead_id = str(event.get("leadgen_id") or "").strip()
            if not lead_id:
                continue
            try:
                meta_payload = fetch_lead(lead_id, db)
            except Exception as exc:
                raise HTTPException(status_code=502, detail="Meta lead could not be retrieved") from exc
            try:
                results.append({"lead_id": lead_id, "status": _ingest_lead(db, meta_payload, event)})
            except Exception as exc:
                db.rollback()
                raise HTTPException(status_code=503, detail="Meta lead could not be stored") from exc
    return {"ok": True, "results": results}