"""Time-based WhatsApp nudges (day 3/7/14/21, then monthly) for activated members.

Runs from the existing WhatsApp follow-up worker. Free-form text is only sent inside the
24-hour customer window; outside it an approved template is used, or the stage waits.
"""
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_

from .crm_identity import find_lead_by_phone
from .database import SessionLocal
from .followup_scheduler import _hours_since_last_inbound, _lead_display_name, _setting_text
from .models import AppSetting, CRMLead, CRMLeadActivity, PublicOrder, User, UserReferral
from .whatsapp_ai import enqueue_whatsapp_message
from .whatsapp_cloud import DEFAULT_MEMBER_ACTIVATION_URL, _member_referral_link, get_whatsapp_preset_message, is_scheduled_optout, resolve_config, send_whatsapp_message

logger = logging.getLogger(__name__)

ENABLED_KEY = "member_nurture_enabled"
STATE_PREFIX = "member_nurture:"
ACTIVATION_PREFIX = "member_purchase_activation:"
TEMPLATE_KEY_PREFIX = "member_nurture_template_"
TEMPLATE_LANGUAGE_KEY = "member_nurture_template_language"
STAGES = (("day3", 3), ("day7", 7), ("day14", 14), ("day21", 21))
STAGE_EXPIRY_DAYS = 10
MONTHLY_DAYS = 30
RECENT_ACTIVITY_DAYS = 30
SEND_RETRY_HOURS = 1

NURTURE_PRESET_DEFAULTS = {
    "day3": "👋 {name}, METHO-তে আপনার ৩ দিন পূর্ণ হলো! আপনার Smart Cycle চলছে। বন্ধু-পরিবারকে যুক্ত করতে আপনার referral link শেয়ার করুন: {referral_link}\n\nসাহায্য লাগলে এখানে reply করুন। (বন্ধ করতে STOP লিখুন)",
    "day7": "📊 {name}, আপনার ১ সপ্তাহের অগ্রগতি:\n• Referral: {referral_count} জন\n• Smart Cycle: Cycle {cycle_number}, Slot {slot}/5\nএগিয়ে চলুন, আরও একজনকে যুক্ত করুন: {referral_link}\n\n(বন্ধ করতে STOP লিখুন)",
    "day14": "🌱 {name}, কাউকে referral করতে একটু দ্বিধা হওয়া স্বাভাবিক। আপনাকে কিছু বিক্রি করতে হবে না—শুধু বলুন METHO-তে কেনাকাটায় সুবিধা আছে, আর link-টি দিন। একজনকে দিয়েই শুরু করুন: {referral_link}\n\nপ্রশ্ন থাকলে এখানে লিখুন। (বন্ধ করতে STOP লিখুন)",
    "day21": "🛒 {name}, আপনার Smart Cycle সচল রাখতে পরের purchase করার সময় হয়েছে। METHO product দেখুন: {shop_url}\n\n(বন্ধ করতে STOP লিখুন)",
    "monthly": "🔔 {name}, এই মাসের METHO reminder:\n🛒 পরের purchase করুন: {shop_url}\n👥 Team বাড়াতে আপনার referral link: {referral_link}\nএখন আপনার referral: {referral_count} জন।\n\n(বন্ধ করতে STOP লিখুন)",
    "monthly_light": "🌟 {name}, চমৎকার চালিয়ে যাচ্ছেন! এখন আপনার referral: {referral_count} জন। আরও বাড়াতে আপনার link: {referral_link}\n\n(বন্ধ করতে STOP লিখুন)",
}

_last_run = 0.0


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _parse(value) -> datetime | None:
    try:
        return _aware(datetime.fromisoformat(str(value).replace("Z", "+00:00")))
    except (TypeError, ValueError):
        return None


def is_enabled(db) -> bool:
    row = db.query(AppSetting).filter(AppSetting.key == ENABLED_KEY).first()
    if not row:
        return True
    try:
        value = json.loads(row.value_json)
    except (TypeError, ValueError):
        value = row.value_json
    return value if isinstance(value, bool) else str(value).strip().lower() not in {"0", "false", "off", "no", "disabled"}


def _load_state(db, user_id: str) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == f"{STATE_PREFIX}{user_id}").first()
    try:
        state = json.loads(row.value_json) if row else {}
    except (TypeError, ValueError):
        state = {}
    return state if isinstance(state, dict) else {}


def _save_state(db, user_id: str, state: dict, now: datetime) -> None:
    key = f"{STATE_PREFIX}{user_id}"
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if row:
        row.value_json = json.dumps(state)
        row.updated_at = now
    else:
        db.add(AppSetting(key=key, value_json=json.dumps(state), updated_at=now))
    db.commit()


def _metrics(db, user: User, activated_at: datetime, now: datetime) -> dict:
    referrals = db.query(UserReferral).filter(UserReferral.sponsor_user_id == user.id).all()
    recent_cutoff = now - timedelta(days=RECENT_ACTIVITY_DAYS)
    referrals_recent = sum(1 for row in referrals if (_aware(row.created_at) or now) >= recent_cutoff)
    orders = db.query(PublicOrder).filter(
        PublicOrder.status == "paid",
        or_(PublicOrder.customer_user_id == user.id, PublicOrder.member_ref == user.id),
    ).all()
    # The order that activated the member is created before activation, so only later orders count as repurchases.
    repurchases = [date for date in (_aware(order.created_at) for order in orders) if date and date > activated_at]
    last_purchase = max(repurchases) if repurchases else None
    return {
        "referrals_total": len(referrals),
        "referrals_recent": referrals_recent,
        "repurchase_count": len(repurchases),
        "last_purchase": last_purchase,
        "recent_active": referrals_recent > 0 or bool(last_purchase and last_purchase >= recent_cutoff),
    }


def _cycle_info(db, user_id: str, activated_at: datetime, now: datetime) -> tuple[int, int]:
    from .routers.compat import SMART_CYCLE_SLOT_DAYS, SMART_CYCLE_TOTAL_SLOTS

    row = db.query(AppSetting).filter(AppSetting.key == f"smart_cycle_v2:{user_id}").first()
    try:
        state = json.loads(row.value_json) if row else {}
    except (TypeError, ValueError):
        state = {}
    state = state if isinstance(state, dict) else {}
    started = _parse(state.get("started_at")) or activated_at
    cycle_days = SMART_CYCLE_SLOT_DAYS * SMART_CYCLE_TOTAL_SLOTS
    elapsed = max(0, (now - started).days) % cycle_days
    slot = min(SMART_CYCLE_TOTAL_SLOTS, elapsed // SMART_CYCLE_SLOT_DAYS + 1)
    return max(1, int(state.get("cycle_number") or 1)), int(slot)


def _find_lead(db, user: User) -> CRMLead | None:
    lead = db.query(CRMLead).filter(CRMLead.member_user_id == user.id).first()
    if lead is None and user.phone:
        lead = find_lead_by_phone(db, user.phone, user.phone)
    return lead


def _pick_kind(state: dict, days: float, metrics: dict, activated_at: datetime, now: datetime) -> str | None:
    stages = state.setdefault("stages", {})
    due = [(key, offset) for key, offset in STAGES if days >= offset and key not in stages]
    if due:
        for key, _ in due[:-1]:
            stages[key] = "skipped_missed"
        key, offset = due[-1]
        if days - offset > STAGE_EXPIRY_DAYS:
            stages[key] = "skipped_expired"
        elif metrics["recent_active"]:
            stages[key] = "skipped_active"
        elif key == "day14" and metrics["referrals_total"] > 0:
            stages[key] = "skipped_progress"
        elif key == "day21" and metrics["repurchase_count"] > 0:
            stages[key] = "skipped_repurchased"
        else:
            return key
    if all(key in stages for key, _ in STAGES):
        last = _parse(state.get("last_sent_at")) or activated_at
        if now - last >= timedelta(days=MONTHLY_DAYS):
            return "monthly_light" if metrics["recent_active"] else "monthly"
    return None


def _log_needs_template(db, lead: CRMLead, state: dict, kind: str, now: datetime) -> None:
    marker = kind if kind in {key for key, _ in STAGES} else f"{kind}:{now:%Y-%m}"
    logged = state.setdefault("needs_template_logged", [])
    if marker in logged:
        return
    logged.append(marker)
    logger.warning("Member nurture %s for lead %s is outside the 24h window and has no approved template configured (needs template)", kind, lead.id)
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="member_nurture_needs_template", message=f"Scheduled member message '{kind}' needs an approved WhatsApp template (24h window closed)."))


def _deliver(db, user: User, lead: CRMLead, kind: str, state: dict, values: dict, now: datetime) -> bool:
    recipient = str(lead.whatsapp_no or lead.phone or "").strip()
    if not recipient:
        return False
    if _hours_since_last_inbound(db, lead.id, now) < 24:
        text = get_whatsapp_preset_message(db, f"preset_member_nurture_{kind}", NURTURE_PRESET_DEFAULTS[kind], **values)
        suffix = kind if kind in {key for key, _ in STAGES} else f"{kind}:{now:%Y-%m-%d}"
        enqueue_whatsapp_message(db, f"member-nurture:{user.id}:{suffix}", recipient, text, lead.id, "member_nurture_sent")
        return True
    template_name = _setting_text(db, f"{TEMPLATE_KEY_PREFIX}{kind}", "")
    if not template_name:
        _log_needs_template(db, lead, state, kind, now)
        return False
    try:
        send_whatsapp_message(db, recipient, template_name=template_name, template_language_code=_setting_text(db, TEMPLATE_LANGUAGE_KEY, "en"), template_parameters=[values["name"]])
    except Exception as exc:
        logger.exception("Member nurture template send failed: user_id=%s kind=%s", user.id, kind)
        state["retry_after"] = (now + timedelta(hours=SEND_RETRY_HOURS)).isoformat()
        db.add(CRMLeadActivity(lead_id=lead.id, activity_type="member_nurture_send_failed", message=str(exc)[:500]))
        return False
    db.add(CRMLeadActivity(lead_id=lead.id, activity_type="member_nurture_sent", message=f"Template '{template_name}' sent for member message '{kind}'."))
    return True


def _process_member(db, user: User, activated_at: datetime, now: datetime) -> bool:
    lead = _find_lead(db, user)
    if lead is None or is_scheduled_optout(db, lead.id):
        return False
    state = _load_state(db, user.id)
    days = (now - activated_at).total_seconds() / 86400
    if not state.get("initialized"):
        state["initialized"] = True
        if days > STAGES[-1][1] + STAGE_EXPIRY_DAYS:
            # Members activated long before this feature shipped start their monthly clock now instead of getting a burst.
            state["stages"] = {key: "skipped_legacy" for key, _ in STAGES}
            state["last_sent_at"] = now.isoformat()
    retry_after = _parse(state.get("retry_after"))
    if retry_after and retry_after > now:
        return False
    metrics = _metrics(db, user, activated_at, now)
    kind = _pick_kind(state, days, metrics, activated_at, now)
    sent = False
    if kind:
        cycle_number, slot = _cycle_info(db, user.id, activated_at, now)
        member_code = user.id
        values = {
            "name": (_lead_display_name(lead) if not user.name else str(user.name).split()[0]),
            "referral_link": _member_referral_link(resolve_config(db), member_code),
            "referral_count": metrics["referrals_total"],
            "cycle_number": cycle_number,
            "slot": slot,
            "shop_url": DEFAULT_MEMBER_ACTIVATION_URL,
        }
        if _deliver(db, user, lead, kind, state, values, now):
            sent = True
            state.pop("retry_after", None)
            state["last_sent_at"] = now.isoformat()
            if kind in {key for key, _ in STAGES}:
                state["stages"][kind] = "sent"
    _save_state(db, user.id, state, now)
    return sent


def process_member_nurture(db=None, now: datetime | None = None, limit: int = 100, throttle: bool = False) -> int:
    global _last_run
    if throttle:
        interval = max(60, int(os.getenv("MEMBER_NURTURE_INTERVAL_SECONDS", "3600") or 3600))
        if time.monotonic() - _last_run < interval and _last_run:
            return 0
        _last_run = time.monotonic()
    owns_session = db is None
    db = db or SessionLocal()
    sent_count = 0
    try:
        if not is_enabled(db):
            return 0
        now = now or datetime.now(timezone.utc)
        rows = db.query(AppSetting).filter(AppSetting.key.like(f"{ACTIVATION_PREFIX}%")).all()
        for row in rows:
            if sent_count >= limit:
                break
            try:
                activation = json.loads(row.value_json or "{}")
            except (TypeError, ValueError):
                continue
            activated_at = _parse(activation.get("activated_at")) if isinstance(activation, dict) and activation.get("active") else None
            if activated_at is None:
                continue
            user = db.query(User).filter(User.id == row.key[len(ACTIVATION_PREFIX):], User.role == "member", User.is_active.is_(True)).first()
            if user is None:
                continue
            try:
                if _process_member(db, user, activated_at, now):
                    sent_count += 1
            except Exception:
                db.rollback()
                logger.exception("Member nurture failed: user_id=%s", user.id)
        return sent_count
    finally:
        if owns_session:
            db.close()
