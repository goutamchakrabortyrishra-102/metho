"""Authenticate an admin and print a ready-to-run manual voice-call test command."""

import argparse
import getpass
import json
import os
import shlex
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ADMIN_ROLES = {"admin", "company_admin", "super_admin"}
REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Content-Type": "application/json",
}


def request_json(url: str, method: str, payload: dict | None = None, token: str = "") -> dict:
    headers = dict(REQUEST_HEADERS)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    request = Request(url, data=data, headers=headers, method=method)
    with urlopen(request, timeout=30) as response:
        response_data = response.read().decode("utf-8", errors="replace")
        return json.loads(response_data) if response_data else {}


def main() -> int:
    parser = argparse.ArgumentParser(description="Get a deployed admin JWT and prepare a manual voice-call command.")
    parser.add_argument("--lead-id", default="2d27211d-b122-42b3-badd-ea69433ef8c3", help="CRM lead UUID")
    parser.add_argument("--language", choices=("bn", "hi", "en"), default="bn")
    parser.add_argument("--base-url", default="https://methoaayupay.com")
    parser.add_argument("--admin-id", default=os.getenv("METHO_ADMIN_LOGIN_ID", "admin@metho.com"))
    args = parser.parse_args()
    password = os.getenv("METHO_ADMIN_PASSWORD") or getpass.getpass("Admin password: ")
    if not password:
        print("VALIDATION ERROR: an admin password is required.", file=sys.stderr)
        return 2

    base_url = args.base_url.rstrip("/")
    try:
        print(f"ADMIN LOGIN REQUEST: endpoint={base_url}/api/auth/admin/login admin_id={args.admin_id}")
        login = request_json(f"{base_url}/api/auth/admin/login", "POST", {"email": args.admin_id, "password": password})
        token = str(login.get("token") or "")
        if not token:
            print("AUTH ERROR: login response did not contain a token.", file=sys.stderr)
            return 1
        profile = request_json(f"{base_url}/api/me", "GET", token=token)
        if str(profile.get("role") or "").lower() not in ADMIN_ROLES:
            print("AUTH ERROR: authenticated account does not have an admin role.", file=sys.stderr)
            return 1
        command = "python backend/tools/test_manual_voice_call.py {lead_id} --language {language} --base-url {base_url} --token {token}".format(
            lead_id=shlex.quote(args.lead_id), language=args.language, base_url=shlex.quote(base_url), token=shlex.quote(token)
        )
        print(f"ADMIN LOGIN RESPONSE: user_id={profile.get('id')} role={profile.get('role')}")
        print("READY COMMAND:")
        print(command)
        return 0
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        print(f"HTTP ERROR: status={error.code} data={body}", file=sys.stderr)
        return 1
    except (URLError, OSError, TimeoutError, json.JSONDecodeError) as error:
        print(f"NETWORK OR RESPONSE ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())