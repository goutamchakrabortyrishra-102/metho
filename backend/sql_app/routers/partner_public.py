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


def _compose_partner_description(payload: dict, sector: str) -> str:
    base = str(payload.get("business_description", "") or "").strip()
    if sector != "Service":
        return base

    service_sector = str(payload.get("service_sector") or "").strip()
    service_category = str(payload.get("service_category") or "").strip()
    meta_parts = []
    if service_sector:
        meta_parts.append(f"Primary Sector: {service_sector}")
    if service_category:
        meta_parts.append(f"Template/Category: {service_category}")
    if not meta_parts:
        return base

    meta_line = "[Service Registration Meta] " + " | ".join(meta_parts)
    if not base:
        return meta_line
    if meta_line in base:
        return base
    return f"{base}\n\n{meta_line}"


@router.post("/partners/register")
def partner_register(payload: dict, db: Session = Depends(get_db)):
    login_id = str(payload.get("login_id") or payload.get("email") or "").strip()
    raw_password = str(payload.get("password") or "").strip()
    sector = _normalize_partner_sector(payload.get("business_type") or payload.get("sector"))
    phone = str(payload.get("phone", "")).strip()
    pan_no = str(payload.get("pan_no") or payload.get("gst_no") or "").strip().upper()
    aadhaar_no = "".join(ch for ch in str(payload.get("aadhaar_no") or "") if ch.isdigit())
    if not login_id:
        raise HTTPException(status_code=400, detail="Login ID is required")
    if len(raw_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if not phone:
        raise HTTPException(status_code=400, detail="Mobile number is required")
    if not pan_no:
        raise HTTPException(status_code=400, detail="PAN number is required")
    if not aadhaar_no:
        raise HTTPException(status_code=400, detail="Aadhaar number is required")
    if len(aadhaar_no) != 12:
        raise HTTPException(status_code=400, detail="Aadhaar number must be 12 digits")

    exists = db.query(User).filter(User.email == login_id).first()
    if exists:
        raise HTTPException(status_code=400, detail="Login ID already exists")

    existing_request = db.query(PartnerRequest).filter(PartnerRequest.phone == phone, PartnerRequest.status.in_(["pending", "approved"])).first()
    if existing_request:
        raise HTTPException(status_code=400, detail="This mobile number already has a shop/service registration")

    existing_partner = db.query(AssociatePartner).filter(AssociatePartner.phone == phone).first()
    if existing_partner:
        raise HTTPException(status_code=400, detail="This mobile number is already linked to an existing shop/service account")

    existing_gst_request = db.query(PartnerRequest).filter(PartnerRequest.gst_no == pan_no, PartnerRequest.status.in_(["pending", "approved"])).first()
    if existing_gst_request:
        raise HTTPException(status_code=400, detail="This PAN already has a shop/service registration")

    existing_gst_partner = db.query(AssociatePartner).filter(AssociatePartner.gst_no == pan_no).first()
    if existing_gst_partner:
        raise HTTPException(status_code=400, detail="This PAN is already linked to an existing shop/service account")

    request_id = str(uuid.uuid4())
    composed_description = _compose_partner_description(payload, sector)

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
        gst_no=pan_no,
        upi_id=str(payload.get("upi_id", "")).strip(),
        business_description=composed_description,
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
    db.add(
        AppSetting(
            key=f"partner_req_kyc:{request_id}",
            value_json=json.dumps(
                {
                    "pan_no": pan_no,
                    "aadhaar_no": aadhaar_no,
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
