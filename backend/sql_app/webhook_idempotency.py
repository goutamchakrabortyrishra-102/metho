from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError

from .models import WebhookIdempotencyKey


def claim_webhook_event(db, source: str, event_key: str) -> bool:
    key = str(event_key or "").strip()
    if not key:
        return True
    existing = db.query(WebhookIdempotencyKey).filter(WebhookIdempotencyKey.event_key == key).first()
    if existing:
        if existing.status == "failed":
            existing.status = "processing"
            existing.processed_at = None
            db.commit()
            return True
        return False
    try:
        db.add(WebhookIdempotencyKey(source=str(source or "unknown").strip()[:40], event_key=key, status="processing"))
        db.commit()
        return True
    except IntegrityError:
        db.rollback()
        return False


def mark_webhook_event(db, event_key: str, status: str) -> None:
    row = db.query(WebhookIdempotencyKey).filter(WebhookIdempotencyKey.event_key == str(event_key or "").strip()).first()
    if not row:
        return
    row.status = str(status or "processed").strip()[:20]
    row.processed_at = datetime.now(timezone.utc) if row.status == "processed" else None
    db.commit()
