"""One-off backfill for existing (already-registered) Members and Partners so they
also benefit from the newer WhatsApp engagement cadence added on 2026-09-20:

  - Members with 2+ paid orders: their "next product purchase" reorder-reminder
    follow-up used to stop after the 2nd purchase under the old cadence cap, so it
    is no longer Pending. This script re-schedules it so the (now-uncapped) reorder
    cadence in whatsapp_ai.process_due_followups() picks them up again.
  - Approved Partners: the one-time "Start Partner onboarding" follow-up was already
    sent long ago for these leads, so the new 7-day/14-day check-in chain never
    naturally starts for them. This script schedules the first 7-day check-in
    directly.

Only WhatsApp/Facebook-sourced CRM leads are touched, matching what
process_due_followups() actually processes. Leads that already have a matching
Pending follow-up are skipped (no duplicates).

Run from the Render Shell for the Metho-backend service (DATABASE_URL already set):

    python tools/backfill_engagement_followups.py            # dry run, prints counts only
    python tools/backfill_engagement_followups.py --apply     # actually creates rows

Safe to delete after use.
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


def _find_backend_root() -> Path:
    for start in (Path(__file__).resolve().parent, Path.cwd()):
        for candidate in (start, *start.parents):
            if (candidate / "sql_app").is_dir():
                return candidate
    raise RuntimeError("Could not locate backend root containing sql_app/")


sys.path.insert(0, str(_find_backend_root()))

from sql_app.database import SessionLocal  # noqa: E402
from sql_app.models import CRMFollowUp, CRMLead, PartnerRequest, PublicOrder, User  # noqa: E402

REORDER_NOTES = "Explain Smart Cycle start, reward rules, product education, and next product purchase"
PARTNER_CHECKIN_NOTES = "Partner onboarding check-in (7-day)"
WHATSAPP_SOURCES = ("whatsapp", "facebook")


def _has_pending_followup(db, lead_id: str, notes_markers: tuple[str, ...]) -> bool:
    rows = db.query(CRMFollowUp).filter(CRMFollowUp.lead_id == lead_id, CRMFollowUp.status == "Pending").all()
    return any(any(marker.lower() in str(row.notes or "").lower() for marker in notes_markers) for row in rows)


def backfill_member_reorder_reminders(db, apply: bool) -> int:
    created = 0
    members = db.query(User).filter(User.role == "member", User.is_active.is_(True)).all()
    for user in members:
        paid_orders = db.query(PublicOrder).filter(PublicOrder.status == "paid", PublicOrder.customer_user_id == user.id).count()
        if paid_orders < 2:
            continue
        lead = db.query(CRMLead).filter(CRMLead.member_user_id == user.id, CRMLead.source.in_(WHATSAPP_SOURCES)).first()
        if not lead:
            continue
        if _has_pending_followup(db, lead.id, ("next product purchase",)):
            continue
        print(f"  [member] {user.id} ({user.name}) -> lead {lead.id}: schedule reorder reminder")
        if apply:
            due = datetime.now(timezone.utc) + timedelta(minutes=5)
            db.add(CRMFollowUp(lead_id=lead.id, scheduled_at=due, status="Pending", notes=REORDER_NOTES))
            lead.follow_up_status = "Pending"
            lead.next_follow_up_at = due
        created += 1
    return created


def backfill_partner_checkins(db, apply: bool) -> int:
    created = 0
    requests = db.query(PartnerRequest).filter(PartnerRequest.status == "approved").all()
    for request in requests:
        lead = db.query(CRMLead).filter(CRMLead.partner_request_id == request.id, CRMLead.source.in_(WHATSAPP_SOURCES)).first()
        if not lead:
            continue
        if _has_pending_followup(db, lead.id, ("start partner onboarding", "partner onboarding check-in")):
            continue
        print(f"  [partner] {request.id} ({request.business_name}) -> lead {lead.id}: schedule 7-day check-in")
        if apply:
            due = datetime.now(timezone.utc) + timedelta(minutes=5)
            db.add(CRMFollowUp(lead_id=lead.id, scheduled_at=due, status="Pending", notes=PARTNER_CHECKIN_NOTES))
            lead.follow_up_status = "Pending"
            lead.next_follow_up_at = due
        created += 1
    return created


def main():
    apply = "--apply" in sys.argv
    db = SessionLocal()
    try:
        print("Scanning members for reorder-reminder backfill..." if apply else "Scanning members for reorder-reminder backfill (dry run)...")
        member_count = backfill_member_reorder_reminders(db, apply)
        print("Scanning approved partners for check-in backfill..." if apply else "Scanning approved partners for check-in backfill (dry run)...")
        partner_count = backfill_partner_checkins(db, apply)
        if apply:
            db.commit()
            print(f"\nApplied: {member_count} member reorder follow-ups + {partner_count} partner check-ins created.")
        else:
            print(f"\nDry run only, nothing written. Would create: {member_count} member reorder follow-ups + {partner_count} partner check-ins.")
            print("Re-run with --apply to actually create these follow-ups.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
