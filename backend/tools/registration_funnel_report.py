"""READ-ONLY WhatsApp registration funnel report. Never writes: the DB transaction is set read-only and rolled back.

Run from the Render Shell for the Metho-backend service (DATABASE_URL already set):

    python tools/registration_funnel_report.py            # prints the report
    python tools/registration_funnel_report.py --json f   # also writes the same numbers as JSON to f

What is counted (all from existing tables, no guesses):
  - leads:      crm_leads where source = 'whatsapp'
  - session:    whatsapp_registration_sessions (state, role, data_json answers) matched on lead_id
  - activities: crm_lead_activities  whatsapp_introduction_started (Welcome sent), whatsapp_role_selected,
                whatsapp_native_registration_started, and the newest whatsapp_message_received (idle time)
  - completed:  lead has member_user_id / partner_request_id / rider_user_id, or the session is in a completed state.
NOTE: crm_leads.status = 'APPLICATION' is set when in-chat registration STARTS, so it is reported separately and is
NOT used as the "completed" test.
"""
import argparse
import json
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path


def _find_backend_root() -> Path:
    for start in (Path(__file__).resolve().parent, Path.cwd()):
        for candidate in (start, *start.parents):
            if (candidate / "sql_app").is_dir():
                return candidate
    raise RuntimeError("Could not locate backend root containing sql_app/")


sys.path.insert(0, str(_find_backend_root()))

from sqlalchemy import func, text  # noqa: E402

from sql_app.database import SessionLocal  # noqa: E402
from sql_app.models import AppSetting, CRMLead, CRMLeadActivity, WhatsAppRegistrationSession  # noqa: E402
from sql_app.registration_progress import STEP_CONFIRM, registration_progress  # noqa: E402
from sql_app.whatsapp_cloud import WHATSAPP_HANDOFF_ACTIVE_PREFIX, _native_fields  # noqa: E402

ROLES = ("member", "partner", "rider")
IDLE_BUCKETS = (("<1h", 1), ("1-24h", 24), ("1-7d", 168), (">7d", float("inf")))


def _aware(value):
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _idle_summary(hours: list) -> dict:
    known = sorted(value for value in hours if value is not None)
    buckets = {label: 0 for label, _limit in IDLE_BUCKETS}
    for value in known:
        for label, limit in IDLE_BUCKETS:
            if value < limit:
                buckets[label] += 1
                break
    return {
        "count": len(hours),
        "no_inbound_recorded": len(hours) - len(known),
        "median_hours": round(statistics.median(known), 1) if known else None,
        "max_hours": round(known[-1], 1) if known else None,
        "buckets": buckets,
    }


def _step_order(role: str) -> list:
    return [field["key"] for field in _native_fields(role) if not field["gate"]] + [STEP_CONFIRM]


def build_funnel(db, now=None) -> dict:
    now = now or datetime.now(timezone.utc)
    leads = db.query(CRMLead).filter(CRMLead.source == "whatsapp").all()
    sessions = {row.lead_id: row for row in db.query(WhatsAppRegistrationSession).all() if row.lead_id}
    last_inbound = {
        lead_id: _aware(value)
        for lead_id, value in db.query(CRMLeadActivity.lead_id, func.max(CRMLeadActivity.created_at))
        .filter(CRMLeadActivity.activity_type == "whatsapp_message_received").group_by(CRMLeadActivity.lead_id).all()
    }
    flags = {}
    for lead_id, activity_type in db.query(CRMLeadActivity.lead_id, CRMLeadActivity.activity_type).filter(
        CRMLeadActivity.activity_type.in_(["whatsapp_introduction_started", "whatsapp_role_selected", "whatsapp_native_registration_started"])
    ).distinct().all():
        flags[lead_id] = flags.get(lead_id, set()) | {activity_type}
    handoff_ids = {row.key[len(WHATSAPP_HANDOFF_ACTIVE_PREFIX):] for row in db.query(AppSetting.key).filter(AppSetting.key.like(f"{WHATSAPP_HANDOFF_ACTIVE_PREFIX}%")).all()}

    def idle(lead):
        moment = last_inbound.get(lead.id)
        return (now - moment).total_seconds() / 3600 if moment else None

    funnel = {"total_leads": len(leads), "welcome_received": 0, "role_said": 0, "registration_started_in_chat": 0, "completed_total": 0, "completed_in_chat": 0}
    completed_by_role = {role: {"total": 0, "in_chat": 0} for role in ROLES}
    stopped = {"welcome": [], "role_selected": []}
    steps = {role: {key: {"reached": 0, "stopped_here": 0, "idle": []} for key in _step_order(role)} for role in ROLES}
    status_application = 0
    stalled_with_handoff = 0

    for lead in leads:
        session = sessions.get(lead.id)
        progress = registration_progress(lead, session)
        lead_flags = flags.get(lead.id, set())
        if lead.status == "APPLICATION":
            status_application += 1
        if "whatsapp_introduction_started" in lead_flags or progress.phase not in {"no_session", "completed"} or progress.completed_in_chat:
            funnel["welcome_received"] += 1
        if lead_flags & {"whatsapp_role_selected", "whatsapp_native_registration_started"} or progress.phase in {"role_selected", "registering"} or progress.completed_in_chat:
            funnel["role_said"] += 1
        if "whatsapp_native_registration_started" in lead_flags or progress.phase == "registering" or progress.completed_in_chat:
            funnel["registration_started_in_chat"] += 1
        if progress.phase == "completed":
            funnel["completed_total"] += 1
            if progress.role in completed_by_role:
                completed_by_role[progress.role]["total"] += 1
                if progress.completed_in_chat:
                    completed_by_role[progress.role]["in_chat"] += 1
            if progress.completed_in_chat:
                funnel["completed_in_chat"] += 1
                for key in steps.get(progress.role, {}):
                    steps[progress.role][key]["reached"] += 1
            continue
        if progress.phase in {"welcome", "role_selected"}:
            stopped[progress.phase].append(idle(lead))
        elif progress.phase == "registering" and progress.role in steps and progress.step_key in steps[progress.role]:
            row = steps[progress.role]
            for key in {*progress.completed_keys, progress.step_key}:
                if key in row:
                    row[key]["reached"] += 1
            row[progress.step_key]["stopped_here"] += 1
            row[progress.step_key]["idle"].append(idle(lead))
        if progress.in_progress and lead.id in handoff_ids:
            stalled_with_handoff += 1

    report = {
        "generated_at": now.isoformat(),
        "funnel": funnel,
        "lead_status_APPLICATION_note": f"{status_application} leads have status APPLICATION; it is set when in-chat registration starts, not on completion",
        "completed_by_role": completed_by_role,
        "stopped_before_registration": {phase: _idle_summary(hours) for phase, hours in stopped.items()},
        "stopped_in_progress_with_active_handoff": stalled_with_handoff,
        "steps": {
            role: [
                {"step": key, "label": next((f["label"] for f in _native_fields(role) if f["key"] == key), key), "reached": data["reached"], "stopped_here": data["stopped_here"], "idle": _idle_summary(data["idle"])}
                for key, data in steps[role].items()
            ]
            for role in ROLES
        },
    }
    return report


def render(report: dict) -> str:
    lines = [f"WhatsApp registration funnel ({report['generated_at']})", ""]
    funnel = report["funnel"]
    base = funnel["total_leads"] or 1
    for key, label in (("total_leads", "WhatsApp leads"), ("welcome_received", "Welcome পেয়েছে"), ("role_said", "Role বলেছে"), ("registration_started_in_chat", "চ্যাটে রেজিস্ট্রেশন শুরু"), ("completed_total", "রেজিস্ট্রেশন সম্পূর্ণ (সব পথ)"), ("completed_in_chat", "  এর মধ্যে চ্যাটে")):
        lines.append(f"  {label:<36}{funnel[key]:>7}  {100 * funnel[key] / base:5.1f}%")
    lines.append(f"  ({report['lead_status_APPLICATION_note']})")
    lines += ["", "Role অনুযায়ী সম্পূর্ণ:"]
    for role, counts in report["completed_by_role"].items():
        lines.append(f"  {role:<10} total={counts['total']}  in_chat={counts['in_chat']}")
    lines += ["", "রেজিস্ট্রেশন শুরুর আগে থেমে আছে (idle = শেষ বার্তা থেকে):"]
    for phase, summary in report["stopped_before_registration"].items():
        lines.append(f"  {phase:<14} n={summary['count']}  median={summary['median_hours']}h  max={summary['max_hours']}h  {summary['buckets']}")
    for role, rows in report["steps"].items():
        lines += ["", f"{role.title()} ধাপ (reached = সেখানে পৌঁছেছে; stopped = ঠিক এখানে থেমে আছে):"]
        for row in rows:
            idle = row["idle"]
            lines.append(f"  {row['step']:<24}{row['label']:<22} reached={row['reached']:>5} stopped={row['stopped_here']:>5} median={idle['median_hours']}h max={idle['max_hours']}h {idle['buckets']}")
    lines += ["", f"থেমে থাকা অবস্থায় active handoff আছে: {report['stopped_in_progress_with_active_handoff']}"]
    return "\n".join(lines)


def _make_read_only(db) -> None:
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        db.execute(text("SET TRANSACTION READ ONLY"))
    elif dialect == "sqlite":
        db.execute(text("PRAGMA query_only = ON"))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Read-only WhatsApp registration funnel report")
    parser.add_argument("--json", default="", help="also write the numbers to this JSON file")
    args = parser.parse_args(argv)
    db = SessionLocal()
    try:
        _make_read_only(db)
        report = build_funnel(db)
    finally:
        db.rollback()
        db.close()
    print(render(report))
    if args.json:
        Path(args.json).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
