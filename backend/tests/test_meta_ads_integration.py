import hashlib
import hmac
import json
import sys
import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.meta_ads import normalize_lead, verify_signature, verify_webhook_token
from sql_app.models import CRMFollowUp, CRMLead, CRMTask, User
from sql_app.routers.meta_ads import _ingest_lead, receive_meta_webhook, verify_meta_webhook


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_webhook_verification_and_signature(monkeypatch):
    monkeypatch.setenv("META_WEBHOOK_VERIFY_TOKEN", "verify-only")
    monkeypatch.setenv("META_APP_SECRET", "app-secret")
    assert verify_webhook_token("verify-only", "123") == "123"
    assert verify_webhook_token("wrong", "123") is None
    body = b'{"object":"page"}'
    signature = "sha256=" + hmac.new(b"app-secret", body, hashlib.sha256).hexdigest()
    assert verify_signature(body, signature)
    assert not verify_signature(body, "sha256=wrong")
    assert "app-secret" not in signature


def test_meta_payload_normalization_and_ingestion_creates_followup_task(monkeypatch):
    db = make_session()
    try:
        admin = User(id="ADMIN", name="CRM Admin", email="admin@example.com", phone="1", password="x", role="admin", is_active=True)
        db.add(admin)
        db.commit()
        monkeypatch.setenv("META_CRM_DEFAULT_ASSIGNEE_ID", admin.id)
        meta = {"id": "lead-123", "field_data": [{"name": "full_name", "values": ["Alex Owner"]}, {"name": "company_name", "values": ["Alex Shop"]}, {"name": "phone_number", "values": ["9999999999"]}, {"name": "email", "values": ["alex@example.com"]}, {"name": "city", "values": ["Kolkata"]}]}
        event = {"campaign_id": "camp-1", "adset_id": "set-1", "ad_id": "ad-1", "form_id": "form-1", "page_id": "page-1"}
        normalized = normalize_lead(meta, event)
        assert normalized["source"] == "facebook"
        assert normalized["lead_id"] == "META-lead-123"
        assert "campaign_id:camp-1" in normalized["tags"]
        assert _ingest_lead(db, meta, event) == "created"
        lead = db.query(CRMLead).one()
        assert lead.source == "facebook"
        assert lead.assigned_user_id == admin.id
        assert db.query(CRMFollowUp).filter(CRMFollowUp.lead_id == lead.id).count() == 1
        assert db.query(CRMTask).filter(CRMTask.lead_id == lead.id).count() == 1
        assert _ingest_lead(db, meta, event) == "duplicate"
        assert db.query(CRMLead).count() == 1
    finally:
        db.close()


def test_malformed_meta_data_is_rejected_without_credentials(monkeypatch):
    monkeypatch.delenv("META_WEBHOOK_VERIFY_TOKEN", raising=False)
    monkeypatch.delenv("META_APP_SECRET", raising=False)
    assert verify_webhook_token("anything", "123") is None
    assert not verify_signature(b"{}", None)
    assert normalize_lead({"id": "lead-empty", "field_data": []})["source"] == "facebook"
    with pytest.raises(Exception):
        _ingest_lead(make_session(), {}, {})


def test_webhook_handler_rejects_invalid_signature_and_malformed_body(monkeypatch):
    class RequestStub:
        def __init__(self, body, signature):
            self._body = body
            self.headers = {"X-Hub-Signature-256": signature}

        async def body(self):
            return self._body

    monkeypatch.setenv("META_APP_SECRET", "app-secret")
    db = make_session()
    try:
        with pytest.raises(HTTPException, match="Invalid webhook signature"):
            asyncio.run(receive_meta_webhook(RequestStub(b"{}", "sha256=bad"), db))
        body = b"not-json"
        signature = "sha256=" + hmac.new(b"app-secret", body, hashlib.sha256).hexdigest()
        with pytest.raises(HTTPException, match="Malformed webhook payload"):
            asyncio.run(receive_meta_webhook(RequestStub(body, signature), db))
    finally:
        db.close()


def test_verification_endpoint_requires_subscribe_and_token(monkeypatch):
    monkeypatch.setenv("META_WEBHOOK_VERIFY_TOKEN", "verify-only")
    assert verify_meta_webhook("subscribe", "verify-only", "456") == 456
    with pytest.raises(HTTPException, match="Invalid webhook mode"):
        verify_meta_webhook("unsubscribe", "verify-only", "456")
    with pytest.raises(HTTPException, match="Invalid webhook verification token"):
        verify_meta_webhook("subscribe", "wrong", "456")


def test_webhook_handler_returns_503_and_rolls_back_on_database_failure(monkeypatch):
    class RequestStub:
        headers = {"X-Hub-Signature-256": ""}
        payload = b""

        async def body(self):
            return self.payload

    body = json.dumps({"entry": [{"id": "page-1", "changes": [{"value": {"leadgen_id": "lead-1"}}]}]}).encode()
    signature = "sha256=" + hmac.new(b"app-secret", body, hashlib.sha256).hexdigest()
    monkeypatch.setenv("META_APP_SECRET", "app-secret")
    monkeypatch.setattr("sql_app.routers.meta_ads.fetch_lead", lambda lead_id, db=None: {"id": lead_id, "field_data": []})

    class BrokenDb:
        rolled_back = False

        def query(self, *args, **kwargs):
            raise RuntimeError("database unavailable")

        def rollback(self):
            self.rolled_back = True

    request = RequestStub()
    request.payload = body
    request.headers = {"X-Hub-Signature-256": signature}
    db = BrokenDb()
    with pytest.raises(HTTPException, match="Meta webhook configuration unavailable") as exc_info:
        asyncio.run(receive_meta_webhook(request, db))
    assert exc_info.value.status_code == 503
    assert db.rolled_back
