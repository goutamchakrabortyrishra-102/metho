from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import CRMLead, CRMLeadActivity, CRMWhatsAppAISuggestion, User
from ..whatsapp_ai import resolve_ai_config, save_ai_config
from ..whatsapp_cloud import send_whatsapp_message
from .auth import get_current_user

router = APIRouter(prefix="/api/admin/crm/whatsapp-ai", tags=["whatsapp-ai"])
ADMIN_ROLES = {"super_admin", "company_admin", "admin"}


def _require_admin(current_user: User) -> None:
    if getattr(current_user, "role", "") not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")


def _suggestion_payload(suggestion: CRMWhatsAppAISuggestion) -> dict:
    return {
        "id": suggestion.id,
        "lead_id": suggestion.lead_id,
        "activity_id": suggestion.activity_id,
        "suggested_reply": suggestion.suggested_reply,
        "human_handoff_required": suggestion.human_handoff_required,
        "handoff_reason": suggestion.handoff_reason or None,
        "provider_used": suggestion.provider_used,
        "model_used": suggestion.model_used,
        "status": suggestion.status,
        "sent_reply": suggestion.sent_reply or None,
        "error_message": suggestion.error_message or None,
        "created_at": suggestion.created_at.isoformat() if suggestion.created_at else None,
    }


@router.get("/settings")
def get_settings(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    return resolve_ai_config(db)


@router.put("/settings")
def update_settings(payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    try:
        return save_ai_config(db, payload)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/suggestions")
def list_suggestions(lead_id: str = "", status: str = "PENDING", db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    query = db.query(CRMWhatsAppAISuggestion)
    if lead_id:
        query = query.filter(CRMWhatsAppAISuggestion.lead_id == lead_id)
    if status and status.upper() != "ALL":
        query = query.filter(CRMWhatsAppAISuggestion.status == status.upper())
    rows = query.order_by(CRMWhatsAppAISuggestion.created_at.desc()).limit(100).all()
    return {"items": [_suggestion_payload(row) for row in rows]}


@router.post("/suggestions/{suggestion_id}/approve")
def approve_suggestion(suggestion_id: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    suggestion = db.get(CRMWhatsAppAISuggestion, suggestion_id)
    if not suggestion or suggestion.status != "PENDING":
        raise HTTPException(status_code=400, detail="Suggestion is not pending")
    if suggestion.human_handoff_required:
        raise HTTPException(status_code=409, detail="This message requires a human handoff and cannot be sent as an AI suggestion")
    lead = db.get(CRMLead, suggestion.lead_id)
    if not lead or lead.source != "whatsapp":
        raise HTTPException(status_code=400, detail="AI suggestions can only send to WhatsApp-origin leads")
    text = str((payload or {}).get("reply") or suggestion.suggested_reply).strip()
    recipient = str(lead.whatsapp_no or lead.phone or "").strip()
    if not text or not recipient:
        raise HTTPException(status_code=400, detail="A reply and WhatsApp phone number are required")
    try:
        result = send_whatsapp_message(db, recipient, text=text)
    except Exception as exc:
        suggestion.status = "FAILED"
        suggestion.error_message = str(exc)[:500]
        db.commit()
        raise HTTPException(status_code=502, detail="WhatsApp reply could not be sent") from exc
    suggestion.status = "SENT"
    suggestion.sent_reply = text
    suggestion.error_message = ""
    lead.last_contact_at = datetime.now(timezone.utc)
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_sent", message=text, actor_user_id=current_user.id))
    db.commit()
    return {"ok": True, "suggestion": _suggestion_payload(suggestion), "message_id": ((result.get("messages") or [{}])[0]).get("id") if isinstance(result, dict) else None}


@router.post("/suggestions/{suggestion_id}/reject")
def reject_suggestion(suggestion_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    suggestion = db.get(CRMWhatsAppAISuggestion, suggestion_id)
    if not suggestion or suggestion.status != "PENDING":
        raise HTTPException(status_code=400, detail="Suggestion is not pending")
    suggestion.status = "REJECTED"
    db.commit()
    return {"ok": True, "suggestion": _suggestion_payload(suggestion)}