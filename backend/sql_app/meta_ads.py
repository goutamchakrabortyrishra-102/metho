import hashlib
import hmac
import json
import os
from urllib.parse import urlencode
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import logging

from cryptography.fernet import Fernet, InvalidToken

from .models import AppSetting


META_GRAPH_API_VERSION = os.getenv("META_GRAPH_API_VERSION", "v20.0").strip() or "v20.0"
logger = logging.getLogger(__name__)


class MetaGraphAPIError(RuntimeError):
    def __init__(self, message: str, status_code: int | None = None, response_body: str = ""):
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body


def _setting(name: str) -> str:
    return str(os.getenv(name, "") or "").strip()


def _clean_secret(value: str) -> str:
    cleaned = str(value or "").strip()
    if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] and cleaned[0] in {"'", '"'}:
        cleaned = cleaned[1:-1].strip()
    return cleaned


def _encryption_key() -> bytes:
    key = _setting("META_SETTINGS_ENCRYPTION_KEY")
    if not key:
        raise RuntimeError("META_SETTINGS_ENCRYPTION_KEY is not configured")
    return key.encode("utf-8")


def encrypt_secret(value: str) -> str:
    return Fernet(_encryption_key()).encrypt(str(value).encode("utf-8")).decode("utf-8")


def decrypt_secret(value: str) -> str:
    try:
        return _clean_secret(Fernet(_encryption_key()).decrypt(str(value).encode("utf-8")).decode("utf-8"))
    except (InvalidToken, ValueError, TypeError) as exc:
        raise RuntimeError("Stored Meta secret could not be decrypted") from exc


def load_db_config(db) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == "meta_integration").first()
    if not row:
        return {}
    try:
        payload = json.loads(row.value_json or "{}")
    except json.JSONDecodeError:
        return {}
    if not isinstance(payload, dict):
        return {}
    result = {key: str(payload.get(key) or "").strip() for key in ("enabled", "page_id", "app_id", "graph_api_version", "default_assignee_id") if key in payload}
    for key in ("verify_token", "app_secret", "access_token"):
        if payload.get(key):
            result[key] = decrypt_secret(payload[key]).strip()
    return result


def resolve_config(db=None) -> dict:
    db_config = load_db_config(db) if db is not None else {}
    return {
        "enabled": str(db_config.get("enabled", True)).strip().lower() not in {"false", "0", "no", "off"},
        "page_id": str(db_config.get("page_id") or _setting("META_PAGE_ID")),
        "app_id": str(db_config.get("app_id") or _setting("META_APP_ID")),
        "graph_api_version": str(db_config.get("graph_api_version") or META_GRAPH_API_VERSION),
        "default_assignee_id": str(db_config.get("default_assignee_id") or _setting("META_CRM_DEFAULT_ASSIGNEE_ID")),
        "verify_token": _clean_secret(db_config.get("verify_token") or _setting("META_WEBHOOK_VERIFY_TOKEN")),
        "app_secret": _clean_secret(db_config.get("app_secret") or _setting("META_APP_SECRET")),
        "access_token": _clean_secret(db_config.get("access_token") or _setting("META_ACCESS_TOKEN")),
    }


def verify_webhook_token(token: str, challenge: str, db=None) -> str | None:
    expected = resolve_config(db).get("verify_token")
    if not expected or not hmac.compare_digest(str(token or ""), expected):
        return None
    return str(challenge or "")


def verify_signature(body: bytes, signature: str | None, db=None) -> bool:
    secret = resolve_config(db).get("app_secret")
    supplied = str(signature or "").strip()
    if not secret or not supplied.startswith("sha256="):
        return False
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(supplied[7:], digest)


def test_meta_config(db=None) -> dict:
    """Test Meta Graph API connectivity with current configuration.

    Makes a safe, read-only API call to verify:
    - Access token is valid
    - Page ID exists
    - Credentials work together

    Returns dict with 'ok', 'page_name', 'page_id', 'graph_api_version'.
    Raises RuntimeError if test fails.
    """
    from urllib.error import HTTPError

    config = resolve_config(db)
    token = config.get("access_token")
    page_id = config.get("page_id")
    if not token:
        raise RuntimeError("access_token not configured")
    if not page_id:
        raise RuntimeError("page_id not configured")

    query = urlencode({"fields": "id,name", "access_token": token})
    endpoint = f"https://graph.facebook.com/{config['graph_api_version']}/{page_id}?{query}"
    request = Request(endpoint, headers={"Accept": "application/json", "User-Agent": "metho-crm-meta-config-test/1.0"})
    try:
        with urlopen(request, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        try:
            error_response = json.loads(exc.read().decode("utf-8"))
            error_detail = error_response.get("error", {})
            if isinstance(error_detail, dict):
                error_msg = error_detail.get("message", str(exc))
            else:
                error_msg = str(error_detail)
        except Exception:
            error_msg = str(exc)
        raise RuntimeError(f"Meta API error: {error_msg}") from exc
    except Exception as exc:
        raise RuntimeError(f"Meta API request failed: {str(exc)}") from exc

    if not isinstance(payload, dict) or not payload.get("id"):
        error_msg = payload.get("error", {}).get("message", "Unknown error") if isinstance(payload.get("error"), dict) else str(payload.get("error", "Invalid response"))
        raise RuntimeError(f"Meta API error: {error_msg}")

    return {
        "ok": True,
        "page_id": str(payload.get("id", "")),
        "page_name": str(payload.get("name", "")),
        "graph_api_version": config["graph_api_version"],
    }


def fetch_lead(lead_id: str, db=None) -> dict:
    config = resolve_config(db)
    if not config.get("enabled"):
        raise RuntimeError("Meta integration is disabled")
    token = config.get("access_token")
    if not token:
        raise RuntimeError("META_ACCESS_TOKEN is not configured")
    query = urlencode({"fields": "id,created_time,field_data", "access_token": token})
    endpoint = f"https://graph.facebook.com/{config['graph_api_version']}/{lead_id}?{query}"
    request = Request(endpoint, headers={"Accept": "application/json", "User-Agent": "metho-crm-meta-leads/1.0"})
    try:
        with urlopen(request, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        response_body = exc.read().decode("utf-8", errors="replace")
        logger.error(
            "Meta Graph API lead retrieval failed: leadgen_id=%s status=%s response=%s",
            lead_id,
            exc.code,
            response_body,
        )
        raise MetaGraphAPIError("Meta Graph API rejected lead retrieval", exc.code, response_body) from exc
    except (URLError, TimeoutError, OSError) as exc:
        logger.exception("Meta Graph API lead retrieval network failure: leadgen_id=%s", lead_id)
        raise MetaGraphAPIError("Meta Graph API request failed") from exc
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        logger.exception("Meta Graph API returned an invalid lead payload: leadgen_id=%s", lead_id)
        raise MetaGraphAPIError("Meta Graph API returned an invalid lead payload") from exc
    if not isinstance(payload, dict) or not payload.get("id"):
        response_body = json.dumps(payload, ensure_ascii=True)
        logger.error("Meta Graph API returned an invalid lead payload: leadgen_id=%s response=%s", lead_id, response_body)
        raise MetaGraphAPIError("Meta lead payload is invalid", response_body=response_body)
    return payload


def webhook_lead_ids(payload: dict) -> list[str]:
    ids = []
    if not isinstance(payload, dict):
        return ids
    for entry in payload.get("entry") or []:
        for change in (entry or {}).get("changes") or []:
            value = (change or {}).get("value") or {}
            lead_id = str(value.get("leadgen_id") or "").strip()
            if lead_id and lead_id not in ids:
                ids.append(lead_id)
    return ids


def normalize_lead(meta_payload: dict, event: dict | None = None) -> dict:
    if not isinstance(meta_payload, dict):
        raise ValueError("Meta lead payload must be an object")
    fields = {}
    for item in meta_payload.get("field_data") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip().lower()
        values = item.get("values") or []
        if name and values:
            fields[name] = str(values[0] or "").strip()
    event = event or {}
    lead_id = str(meta_payload.get("id") or "").strip()
    if not lead_id:
        raise ValueError("Meta lead id is required")
    campaign_id = str(event.get("campaign_id") or "").strip()
    adset_id = str(event.get("adset_id") or "").strip()
    ad_id = str(event.get("ad_id") or "").strip()
    metadata = {"meta_lead_id": lead_id}
    adgroup_id = str(event.get("adgroup_id") or "").strip()
    created_time = str(meta_payload.get("created_time") or event.get("created_time") or "").strip()
    event_time = str(event.get("event_time") or "").strip()
    for key, value in (("campaign_id", campaign_id), ("adset_id", adset_id), ("adgroup_id", adgroup_id), ("ad_id", ad_id), ("form_id", str(event.get("form_id") or "").strip()), ("page_id", str(event.get("page_id") or "").strip()), ("created_time", created_time), ("event_time", event_time)):
        if value:
            metadata[key] = value
    name = fields.get("full_name") or fields.get("name") or "Meta Lead"
    return {
        "external_lead_id": lead_id,
        "lead_id": f"META-{lead_id}",
        "business_name": fields.get("company_name") or fields.get("business_name") or name,
        "contact_person": name,
        "phone": fields.get("phone_number") or fields.get("phone") or "",
        "whatsapp_no": fields.get("whatsapp_number") or fields.get("phone_number") or fields.get("phone") or "",
        "email": fields.get("email") or "",
        "city": fields.get("city") or fields.get("location") or "",
        "state": fields.get("state") or "",
        "pincode": fields.get("zip_code") or fields.get("pincode") or "",
        "address": fields.get("address") or "",
        "source": "facebook",
        "tags": ["meta_lead_ads", "source_type:leadgen"] + [f"{key}:{value}" for key, value in metadata.items() if key != "meta_lead_id"],
        "metadata": metadata,
    }