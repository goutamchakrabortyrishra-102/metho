from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError

from .models import WebhookIdempotencyKey


def _stored_event_key(source: str, event_key: str) -> str:
    normalized_source = str(source or "unknown").strip().lower()[:40] or "unknown"
    return f"{normalized_source}:{str(event_key or '').strip()}"


def claim_webhook_event(db, source: str, event_key: str) -> bool:
    key = str(event_key or "").strip()
    if not key:
        return True
    storage_key = _stored_event_key(source, key)
    existing = db.query(WebhookIdempotencyKey).filter(WebhookIdempotencyKey.event_key == storage_key).first()
    if not existing:
        legacy = db.query(WebhookIdempotencyKey).filter(WebhookIdempotencyKey.event_key == key).first()
        if legacy and str(legacy.source or "").strip().lower() == str(source or "").strip().lower():
            existing = legacy
    if existing:
        if existing.status == "failed":
            existing.status = "processing"
            existing.processed_at = None
            db.commit()
            return True
        return False
    try:
        db.add(WebhookIdempotencyKey(source=str(source or "unknown").strip()[:40], event_key=storage_key, status="processing"))
        db.commit()
        return True
    except IntegrityError:
        db.rollback()
        return False


def mark_webhook_event(db, event_key: str, status: str, source: str = "unknown") -> None:
    key = str(event_key or "").strip()
    row = db.query(WebhookIdempotencyKey).filter(WebhookIdempotencyKey.event_key == _stored_event_key(source, key)).first()
    if not row:
        legacy = db.query(WebhookIdempotencyKey).filter(WebhookIdempotencyKey.event_key == key).first()
        if legacy and str(legacy.source or "").strip().lower() == str(source or "").strip().lower():
            row = legacy
    if not row:
        return
    row.status = str(status or "processed").strip()[:20]
    row.processed_at = datetime.now(timezone.utc) if row.status == "processed" else None
    db.commit()
