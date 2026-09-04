from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import CRMLead, CRMVoiceCallAttempt, CRMVoiceCallCampaign, User
from ..voice_caller import _call_payload, create_voice_campaign, queue_campaign_call, queue_voice_call, receive_voice_call_result, resolve_call_target
from .auth import get_current_user

router = APIRouter(prefix="/api", tags=["voice-caller"])
ADMIN_ROLES = {"super_admin", "company_admin", "admin"}


def _require_admin(current_user: User) -> None:
    if getattr(current_user, "role", "") not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")


def _lead_or_404(db: Session, lead_id: str) -> CRMLead:
    lead = db.query(CRMLead).filter(CRMLead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


@router.post("/admin/crm/voice-caller/campaigns")
def create_campaign(payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    try:
        campaign = create_voice_campaign(db, payload)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "campaign_id": campaign.id}


@router.post("/admin/crm/voice-caller/campaigns/{campaign_id}/targets/{target_type}/{target_id}")
def trigger_campaign_target(campaign_id: str, target_type: str, target_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    campaign = db.query(CRMVoiceCallCampaign).filter(CRMVoiceCallCampaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    try:
        call, created = queue_campaign_call(db, campaign, resolve_call_target(db, target_type, target_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "created": created, "call": _call_payload(call)}


@router.post("/admin/crm/leads/{lead_id}/voice-calls")
def trigger_voice_call(lead_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    call, created = queue_voice_call(db, _lead_or_404(db, lead_id))
    return {"ok": True, "created": created, "call": _call_payload(call)}


@router.get("/admin/crm/leads/{lead_id}/voice-calls")
def list_voice_calls(lead_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    _lead_or_404(db, lead_id)
    calls = db.query(CRMVoiceCallAttempt).filter(CRMVoiceCallAttempt.lead_id == lead_id).order_by(CRMVoiceCallAttempt.created_at.desc()).all()
    return {"items": [_call_payload(call) for call in calls]}


@router.post("/admin/crm/leads/{lead_id}/voice-calls/retry")
def retry_voice_call(lead_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    call, created = queue_voice_call(db, _lead_or_404(db, lead_id), retry=True)
    if not created:
        raise HTTPException(status_code=409, detail="Only failed or no-answer calls can be retried")
    return {"ok": True, "call": _call_payload(call)}


@router.post("/admin/crm/voice-calls/callback")
def receive_voice_callback(payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    try:
        call = receive_voice_call_result(db, (payload or {}).get("provider_call_id"), payload or {})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "call": _call_payload(call)}