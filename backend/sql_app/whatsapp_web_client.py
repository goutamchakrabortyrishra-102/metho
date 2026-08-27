"""HTTP client for the standalone WhatsApp Web microservice.

Fully isolated from whatsapp_cloud.py (Meta Cloud API) — this module is only
used when an admin explicitly switches the active provider to "whatsapp_web".
Every function fails with a clean RuntimeError instead of raising unhandled
exceptions, so a disconnected/misconfigured WhatsApp Web service can never
crash the FastAPI process.
"""
import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_TIMEOUT = 12


def _base_url(config: dict) -> str:
    url = str((config or {}).get("service_url") or os.getenv("WHATSAPP_WEB_SERVICE_URL", "") or "").strip()
    return url.rstrip("/")


def _token(config: dict) -> str:
    return str((config or {}).get("service_token") or os.getenv("WHATSAPP_WEB_SERVICE_TOKEN", "") or "").strip()


def _request(config: dict, method: str, path: str, payload: dict | None = None) -> dict:
    base_url = _base_url(config)
    token = _token(config)
    if not base_url:
        raise RuntimeError("WhatsApp Web service URL is not configured")
    if not token:
        raise RuntimeError("WhatsApp Web service token is not configured")

    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(
        f"{base_url}{path}",
        data=body,
        method=method,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "x-service-token": token,
        },
    )
    try:
        with urlopen(request, timeout=DEFAULT_TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        try:
            detail = json.loads(exc.read().decode("utf-8")).get("error", str(exc))
        except Exception:
            detail = str(exc)
        raise RuntimeError(f"WhatsApp Web service error: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"WhatsApp Web service unreachable: {exc.reason}") from exc
    except Exception as exc:
        raise RuntimeError(f"WhatsApp Web service request failed: {exc}") from exc


def get_status(config: dict) -> dict:
    return _request(config, "GET", "/status")


def get_qr(config: dict) -> dict:
    return _request(config, "GET", "/qr")


def send_text_message(config: dict, to: str, message: str) -> dict:
    return _request(config, "POST", "/send-text", {"to": to, "message": message})


def send_pdf_invoice(config: dict, to: str, pdf_base64: str, filename: str, caption: str = "Invoice") -> dict:
    return _request(config, "POST", "/send-pdf", {"to": to, "pdf_base64": pdf_base64, "filename": filename, "caption": caption})
