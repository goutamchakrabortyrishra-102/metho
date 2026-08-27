from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..whatsapp_dispatch import load_provider_config, save_provider_config, send_via_active_provider
from .auth import get_current_user
from .whatsapp import _mask_secret, _require_admin

router = APIRouter(prefix="/api", tags=["whatsapp-web"])


@router.get("/admin/whatsapp-web/settings")
def get_provider_settings(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    config = load_provider_config(db)
    return {
        "active_provider": config["active_provider"],
        "service_url": config["service_url"],
        "service_token_masked": _mask_secret(config["service_token"]),
        "configured": bool(config["service_url"] and config["service_token"]),
    }


@router.put("/admin/whatsapp-web/settings")
def update_provider_settings(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    data = payload if isinstance(payload, dict) else {}
    try:
        save_provider_config(
            db,
            active_provider=data.get("active_provider"),
            service_url=data.get("service_url"),
            service_token=data.get("service_token"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return get_provider_settings(db, current_user)


@router.get("/admin/whatsapp-web/status")
def get_whatsapp_web_status(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    from .. import whatsapp_web_client

    config = load_provider_config(db)
    if not config["service_url"]:
        return {"ok": False, "configured": False, "error": "WhatsApp Web service is not configured yet"}
    try:
        return {"ok": True, "configured": True, **whatsapp_web_client.get_status(config)}
    except RuntimeError as exc:
        return {"ok": False, "configured": True, "error": str(exc)}


@router.get("/admin/whatsapp-web/qr")
def get_whatsapp_web_qr(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    from .. import whatsapp_web_client

    config = load_provider_config(db)
    if not config["service_url"]:
        return {"ok": False, "configured": False, "error": "WhatsApp Web service is not configured yet"}
    try:
        return {"ok": True, "configured": True, **whatsapp_web_client.get_qr(config)}
    except RuntimeError as exc:
        return {"ok": False, "configured": True, "error": str(exc)}


@router.post("/admin/whatsapp-web/send-test")
def send_test_message(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    data = payload if isinstance(payload, dict) else {}
    to = str(data.get("to") or "").strip()
    message = str(data.get("message") or "METHO WhatsApp automation test message.").strip()
    if not to:
        raise HTTPException(status_code=400, detail="Recipient (to) is required")
    try:
        result = send_via_active_provider(db, to, text=message)
        return {"ok": True, "result": result}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
