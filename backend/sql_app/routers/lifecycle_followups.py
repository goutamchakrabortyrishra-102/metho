from fastapi import APIRouter, Depends, HTTPException

from ..followup_scheduler import send_due_lifecycle_followups
from .auth import get_current_user

router = APIRouter(prefix="/api/admin/lifecycle-followups", tags=["lifecycle-followups"])

ADMIN_ROLES = {"super_admin", "company_admin", "admin"}


def _require_admin(current_user):
    if getattr(current_user, "role", "") not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")


@router.post("/run-now")
def run_lifecycle_followups_now(current_user=Depends(get_current_user)):
    _require_admin(current_user)
    return send_due_lifecycle_followups()