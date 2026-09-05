"""Invoke the authenticated CRM manual voice-call endpoint for one lead."""

import argparse
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def main() -> int:
    parser = argparse.ArgumentParser(description="Trigger one CRM voice call through the configured provider.")
    parser.add_argument("lead_id", help="CRM lead UUID")
    parser.add_argument("--language", choices=("bn", "hi", "en"), default="bn", help="bn=Bengali, hi=Hindi, en=English")
    parser.add_argument("--base-url", default=os.getenv("METHO_API_BASE_URL", "http://localhost:8000"), help="Backend base URL")
    parser.add_argument("--token", default=os.getenv("METHO_ADMIN_TOKEN", ""), help="Admin JWT; defaults to METHO_ADMIN_TOKEN")
    args = parser.parse_args()
    if not args.token:
        print("VALIDATION ERROR: provide --token or set METHO_ADMIN_TOKEN", file=sys.stderr)
        return 2

    endpoint = f"{args.base_url.rstrip('/')}/api/admin/crm/leads/{args.lead_id}/voice-calls"
    body = json.dumps({"preferred_language": args.language}).encode("utf-8")
    request = Request(endpoint, data=body, headers={"Authorization": f"Bearer {args.token}", "Content-Type": "application/json", "Accept": "application/json"}, method="POST")
    print(f"VOICE CALL REQUEST: lead_id={args.lead_id} language={args.language} endpoint={endpoint}")
    try:
        with urlopen(request, timeout=30) as response:
            data = response.read().decode("utf-8", errors="replace")
            print(f"VOICE CALL RESPONSE: status={response.status} data={data}")
            return 0
    except HTTPError as exc:
        data = exc.read().decode("utf-8", errors="replace")
        print(f"VOICE CALL HTTP ERROR: status={exc.code} data={data}", file=sys.stderr)
        return 1
    except (URLError, OSError, TimeoutError) as exc:
        print(f"VOICE CALL NETWORK ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())