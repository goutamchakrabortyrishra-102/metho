"""Resume WhatsApp "Needs human" handoffs that were opened only because the 24-hour follow-up
template was not configured (reason `scheduled_template_configuration_failure`).

Only those handoffs are resumed (via the same `resume_whatsapp_bot` the CRM "Resume" button uses).
Handoffs with any other reason are never touched. No WhatsApp message is queued or sent to anyone.

Run from the Render Shell for the Metho-backend service (DATABASE_URL already set):

    python tools/resume_template_handoffs.py                       # dry run: counts per reason + rows that WOULD be resumed
    python tools/resume_template_handoffs.py --apply               # resumes them
    python tools/resume_template_handoffs.py --report out.csv      # choose the changed-rows list path

The changed-rows list (CSV) contains one line per handoff that was (or, in a dry run, would be) resumed.
`--apply` refuses to run while the follow-up template name/language settings are still empty, because
the scheduler would immediately reopen the same handoffs; pass --force to override.

Safe to delete after use.
"""
import argparse
import csv
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


def _find_backend_root() -> Path:
    for start in (Path(__file__).resolve().parent, Path.cwd()):
        for candidate in (start, *start.parents):
            if (candidate / "sql_app").is_dir():
                return candidate
    raise RuntimeError("Could not locate backend root containing sql_app/")


sys.path.insert(0, str(_find_backend_root()))

from sql_app.database import SessionLocal  # noqa: E402
from sql_app.followup_scheduler import TEMPLATE_LANGUAGE_KEY, TEMPLATE_NAME_KEY, _setting_text  # noqa: E402
from sql_app.models import AppSetting, CRMLead  # noqa: E402
from sql_app.whatsapp_cloud import WHATSAPP_HANDOFF_ACTIVE_PREFIX, resume_whatsapp_bot  # noqa: E402

TARGET_REASONS = ("scheduled_template_configuration_failure",)
REPORT_FIELDS = ("action", "lead_id", "contact_person", "phone", "handoff_id", "reason", "active_at", "processed_at")


def _handoff_rows(db):
    for row in db.query(AppSetting).filter(AppSetting.key.like(f"{WHATSAPP_HANDOFF_ACTIVE_PREFIX}%")).order_by(AppSetting.key).all():
        try:
            data = json.loads(row.value_json or "{}")
        except (TypeError, ValueError):
            data = {}
        yield row.key[len(WHATSAPP_HANDOFF_ACTIVE_PREFIX):], data if isinstance(data, dict) else {}


def resume_template_handoffs(db, apply: bool = False, reasons=TARGET_REASONS) -> tuple[Counter, list[dict]]:
    """Return (counts per handoff reason, rows resumed or to be resumed)."""
    counts: Counter = Counter()
    changed: list[dict] = []
    for lead_id, data in list(_handoff_rows(db)):
        reason = str(data.get("reason") or "")
        counts[reason] += 1
        if reason not in reasons:
            continue
        lead = db.query(CRMLead).filter(CRMLead.id == lead_id).first()
        resumed = bool(lead) and resume_whatsapp_bot(db, lead) if apply else False
        if apply and not resumed:
            continue
        changed.append({
            "action": "resumed" if apply else "would_resume",
            "lead_id": lead_id,
            "contact_person": getattr(lead, "contact_person", "") or "",
            "phone": (getattr(lead, "whatsapp_no", "") or getattr(lead, "phone", "")) if lead else "",
            "handoff_id": data.get("handoff_id", ""),
            "reason": reason,
            "active_at": data.get("active_at", ""),
            "processed_at": datetime.now(timezone.utc).isoformat() if apply else "",
        })
    return counts, changed


def write_report(path: Path, rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=REPORT_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="actually resume the matching handoffs (default is a dry run)")
    parser.add_argument("--report", default="", help="CSV path for the changed-rows list")
    parser.add_argument("--force", action="store_true", help="apply even if the follow-up template settings are empty")
    args = parser.parse_args(argv)

    db = SessionLocal()
    try:
        if args.apply and not args.force and not (_setting_text(db, TEMPLATE_NAME_KEY, "") and _setting_text(db, TEMPLATE_LANGUAGE_KEY, "")):
            print(f"Refusing to apply: {TEMPLATE_NAME_KEY}/{TEMPLATE_LANGUAGE_KEY} are not configured; the scheduler would reopen these handoffs. Use --force to override.")
            return 2
        counts, changed = resume_template_handoffs(db, apply=args.apply)
    finally:
        db.close()

    print(f"Active handoffs: {sum(counts.values())}")
    for reason, count in counts.most_common():
        print(f"  {reason or '(no reason)'}: {count}")
    report = Path(args.report or f"resumed_template_handoffs_{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.csv")
    write_report(report, changed)
    print(f"{'Resumed' if args.apply else 'Would resume'}: {len(changed)} (list: {report})")
    if not args.apply:
        print("Dry run only. Re-run with --apply to resume.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
