import uuid
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AppSetting, PartnerRequest, User

router = APIRouter(prefix="/api", tags=["partner-public"])


@router.post("/partners/register")
def partner_register(payload: dict, db: Session = Depends(get_db)):
    login_id = str(payload.get("login_id") or payload.get("email") or "").strip()
    raw_password = str(payload.get("password") or "").strip()
    if not login_id:
        raise HTTPException(status_code=400, detail="Login ID is required")
    if len(raw_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    exists = db.query(User).filter(User.email == login_id).first()
    if exists:
        raise HTTPException(status_code=400, detail="Login ID already exists")

    request_id = str(uuid.uuid4())
    row = PartnerRequest(
        id=request_id,
        business_name=str(payload.get("business_name", "")).strip(),
        business_type=str(payload.get("business_type", "Retail Shop")).strip() or "Retail Shop",
        contact_person=str(payload.get("contact_person", "")).strip(),
        phone=str(payload.get("phone", "")).strip(),
        email=login_id,
        whatsapp_no=str(payload.get("whatsapp_no", "")).strip(),
        address=str(payload.get("address", "")).strip(),
        city=str(payload.get("city", "")).strip(),
        state=str(payload.get("state", "")).strip(),
        pincode=str(payload.get("pincode", "")).strip(),
        gst_no=str(payload.get("gst_no", "")).strip(),
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
