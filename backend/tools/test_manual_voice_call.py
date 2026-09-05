"""Invoke the authenticated CRM manual voice-call endpoint for one lead."""

import argparse
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Content-Type": "application/json",
}


def request_json(url: str, payload: dict, token: str = "") -> dict:
    headers = dict(REQUEST_HEADERS)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    with urlopen(request, timeout=30) as response:
        data = response.read().decode("utf-8", errors="replace")
        return json.loads(data) if data else {}


def login_for_token(base_url: str, email: str, password: str) -> str:
    if not email or not password:
        raise ValueError("provide --token, or both --email/--password (or ADMIN_EMAIL/ADMIN_PASSWORD)")
    endpoint = f"{base_url}/api/auth/admin/login"
    print(f"ADMIN LOGIN REQUEST: endpoint={endpoint} email={email}")
    response = request_json(endpoint, {"email": email, "password": password})
    token = str(response.get("token") or "")
    if not token:
        raise ValueError("admin login response did not contain a token")
    print("ADMIN LOGIN RESPONSE: fresh JWT received")
    return token


def main() -> int:
    parser = argparse.ArgumentParser(description="Trigger one CRM voice call through the configured provider.")
    parser.add_argument("lead_id", help="CRM lead UUID")
    parser.add_argument("--language", choices=("bn", "hi", "en"), default="bn", help="bn=Bengali, hi=Hindi, en=English")
    parser.add_argument("--base-url", default=os.getenv("METHO_API_BASE_URL", "http://localhost:8000"), help="Backend base URL")
    parser.add_argument("--token", default=os.getenv("METHO_ADMIN_TOKEN", ""), help="Admin JWT; defaults to METHO_ADMIN_TOKEN")
    parser.add_argument("--email", default=os.getenv("ADMIN_EMAIL", ""), help="Admin email; defaults to ADMIN_EMAIL")
    parser.add_argument("--password", default=os.getenv("ADMIN_PASSWORD", ""), help="Admin password; defaults to ADMIN_PASSWORD")
    args = parser.parse_args()
    try:
        base_url = args.base_url.rstrip("/")
        token = args.token or login_for_token(base_url, args.email, args.password)
        endpoint = f"{base_url}/api/admin/crm/leads/{args.lead_id}/voice-calls"
        body = json.dumps({"preferred_language": args.language}).encode("utf-8")
        headers = {**REQUEST_HEADERS, "Authorization": f"Bearer {token}"}
        request = Request(endpoint, data=body, headers=headers, method="POST")
        print(f"VOICE CALL REQUEST: lead_id={args.lead_id} language={args.language} endpoint={endpoint}")
        with urlopen(request, timeout=30) as response:
            data = response.read().decode("utf-8", errors="replace")
            print(f"VOICE CALL RESPONSE: status={response.status} data={data}")
            return 0
    except ValueError as exc:
        print(f"VALIDATION ERROR: {exc}", file=sys.stderr)
        return 2
    except HTTPError as exc:
        data = exc.read().decode("utf-8", errors="replace")
        print(f"VOICE CALL HTTP ERROR: status={exc.code} data={data}", file=sys.stderr)
        return 1
    except (URLError, OSError, TimeoutError) as exc:
        print(f"VOICE CALL NETWORK ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())