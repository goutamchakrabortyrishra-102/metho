import base64

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


@router.get("/admin/whatsapp-web/storage")
def get_whatsapp_web_storage(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    from .. import whatsapp_web_client

    config = load_provider_config(db)
    if not config["service_url"]:
        return {"ok": False, "configured": False, "error": "WhatsApp Web service is not configured yet"}
    try:
        return {"ok": True, "configured": True, **whatsapp_web_client.get_storage(config)}
    except RuntimeError as exc:
        return {"ok": False, "configured": True, "error": str(exc)}


@router.post("/admin/whatsapp-web/storage/cleanup")
def cleanup_whatsapp_web_storage(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    from .. import whatsapp_web_client

    config = load_provider_config(db)
    if not config["service_url"]:
        raise HTTPException(status_code=400, detail="WhatsApp Web service is not configured yet")
    try:
        return {"ok": True, **whatsapp_web_client.cleanup_storage(config)}
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


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


@router.post("/admin/whatsapp-web/send-pdf")
def send_pdf_message(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_admin(current_user)
    data = payload if isinstance(payload, dict) else {}
    recipient = str(data.get("to") or "").strip()
    encoded_pdf = str(data.get("pdf_base64") or "").strip()
    if not recipient or not encoded_pdf:
        raise HTTPException(status_code=400, detail="Recipient and PDF file are required")
    if load_provider_config(db)["active_provider"] != "whatsapp_web":
        raise HTTPException(status_code=409, detail="Switch WhatsApp Web Automation to WhatsApp Web before sending PDFs.")
    try:
        pdf_bytes = base64.b64decode(encoded_pdf, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="PDF file encoding is invalid") from exc
    if not pdf_bytes or len(pdf_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="PDF file must be between 1 byte and 10 MB")
    try:
        result = send_via_active_provider(
            db,
            recipient,
            pdf_bytes=pdf_bytes,
            pdf_filename=str(data.get("filename") or "document.pdf").strip(),
            pdf_caption=str(data.get("caption") or "METHO document").strip(),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"ok": True, "result": result}


@router.post("/orders/{order_id}/invoice/whatsapp")
def send_invoice_to_customer_whatsapp(
    order_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Send an authorized order invoice through the connected WhatsApp Web session."""
    from .compat import _draw_invoice_pdf, _invoice_payload

    recipient = str((payload or {}).get("to") or "").strip()
    if not recipient:
        raise HTTPException(status_code=400, detail="Customer WhatsApp number is required")
    if load_provider_config(db)["active_provider"] != "whatsapp_web":
        raise HTTPException(
            status_code=409,
            detail="Switch WhatsApp Web Automation to WhatsApp Web before sending invoice PDFs.",
        )

    invoice = _invoice_payload(db, order_id, current_user)
    filename = f"{str(invoice.get('invoice_no') or 'invoice').replace('/', '_')}.pdf"
    caption = str((payload or {}).get("caption") or f"METHO invoice {invoice.get('invoice_no') or ''}").strip()
    try:
        result = send_via_active_provider(
            db,
            recipient,
            pdf_bytes=_draw_invoice_pdf(invoice),
            pdf_filename=filename,
            pdf_caption=caption,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"ok": True, "invoice_no": invoice.get("invoice_no"), "result": result}
