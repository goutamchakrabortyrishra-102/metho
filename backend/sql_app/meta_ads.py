import hashlib
import hmac
import json
import os
from urllib.parse import urlencode
from urllib.request import Request, urlopen


META_GRAPH_API_VERSION = os.getenv("META_GRAPH_API_VERSION", "v20.0").strip() or "v20.0"


def _setting(name: str) -> str:
    return str(os.getenv(name, "") or "").strip()


def verify_webhook_token(token: str, challenge: str) -> str | None:
    expected = _setting("META_WEBHOOK_VERIFY_TOKEN")
    if not expected or not hmac.compare_digest(str(token or ""), expected):
        return None
    return str(challenge or "")


def verify_signature(body: bytes, signature: str | None) -> bool:
    secret = _setting("META_APP_SECRET")
    supplied = str(signature or "").strip()
    if not secret or not supplied.startswith("sha256="):
        return False
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(supplied[7:], digest)


def fetch_lead(lead_id: str) -> dict:
    token = _setting("META_ACCESS_TOKEN")
    if not token:
        raise RuntimeError("META_ACCESS_TOKEN is not configured")
    query = urlencode({"fields": "id,created_time,field_data", "access_token": token})
    endpoint = f"https://graph.facebook.com/{META_GRAPH_API_VERSION}/{lead_id}?{query}"
    request = Request(endpoint, headers={"Accept": "application/json", "User-Agent": "metho-crm-meta-leads/1.0"})
    with urlopen(request, timeout=10) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict) or not payload.get("id"):
        raise RuntimeError("Meta lead payload is invalid")
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