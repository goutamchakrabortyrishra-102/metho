import uuid
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AppSetting, AssociatePartner, PartnerRequest, User

router = APIRouter(prefix="/api", tags=["partner-public"])


def _normalize_partner_sector(value: str) -> str:
    text = str(value or "").strip().lower()
    if text in {"service", "services", "service provider"}:
        return "Service"
    return "Shop"


@router.post("/partners/register")
def partner_register(payload: dict, db: Session = Depends(get_db)):
    login_id = str(payload.get("login_id") or payload.get("email") or "").strip()
    raw_password = str(payload.get("password") or "").strip()
    sector = _normalize_partner_sector(payload.get("business_type") or payload.get("sector"))
    phone = str(payload.get("phone", "")).strip()
    gst_no = str(payload.get("gst_no", "")).strip().upper()
    if not login_id:
        raise HTTPException(status_code=400, detail="Login ID is required")
    if len(raw_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if not phone:
        raise HTTPException(status_code=400, detail="Mobile number is required")

    exists = db.query(User).filter(User.email == login_id).first()
    if exists:
        raise HTTPException(status_code=400, detail="Login ID already exists")

    existing_request = db.query(PartnerRequest).filter(PartnerRequest.phone == phone, PartnerRequest.status.in_(["pending", "approved"])).first()
    if existing_request:
        raise HTTPException(status_code=400, detail="This mobile number already has a shop/service registration")

    existing_partner = db.query(AssociatePartner).filter(AssociatePartner.phone == phone).first()
    if existing_partner:
        raise HTTPException(status_code=400, detail="This mobile number is already linked to an existing shop/service account")

    if gst_no:
        existing_gst_request = db.query(PartnerRequest).filter(PartnerRequest.gst_no == gst_no, PartnerRequest.status.in_(["pending", "approved"])).first()
        if existing_gst_request:
            raise HTTPException(status_code=400, detail="This GST/business ID already has a shop/service registration")

        existing_gst_partner = db.query(AssociatePartner).filter(AssociatePartner.gst_no == gst_no).first()
        if existing_gst_partner:
            raise HTTPException(status_code=400, detail="This GST/business ID is already linked to an existing shop/service account")

    request_id = str(uuid.uuid4())
    row = PartnerRequest(
        id=request_id,
        business_name=str(payload.get("business_name", "")).strip(),
        business_type=sector,
        contact_person=str(payload.get("contact_person", "")).strip(),
        phone=phone,
        email=login_id,
        whatsapp_no=str(payload.get("whatsapp_no", "")).strip(),
        address=str(payload.get("address", "")).strip(),
        city=str(payload.get("city", "")).strip(),
        state=str(payload.get("state", "")).strip(),
        pincode=str(payload.get("pincode", "")).strip(),
        gst_no=gst_no,
        upi_id=str(payload.get("upi_id", "")).strip(),
        business_description=str(payload.get("business_description", "")).strip(),
        commission_percent_ask=float(payload.get("commission_percent_ask") or 0),
        status="pending",
    )
    db.add(row)
    db.add(
        AppSetting(
            key=f"partner_req_creds:{request_id}",
            value_json=json.dumps(
                {
                    "login_id": login_id,
                    "password": raw_password,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            ),
            updated_at=datetime.now(timezone.utc),
        )
    )
    db.commit()

    return {
        "request_id": request_id,
        "status": "pending",
        "login_id": login_id,
        "message": "Your partner application has been received and is pending admin approval.",
    }
