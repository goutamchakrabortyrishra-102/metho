from datetime import datetime, timezone

from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["health"])


@router.get("")
def api_root():
    return {
        "app": "METHO AAY-UPAY ERP v3.0",
        "mode": "sql-starter",
        "status": "running",
        "time": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/health")
def health():
    return {"ok": True, "mode": "sql-starter"}
