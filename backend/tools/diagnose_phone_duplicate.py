"""One-off READ-ONLY production diagnostic for the "Phone number already
registered" 400 on /api/register. Run this from the Render Shell for the
Metho-backend service (it already has DATABASE_URL in its environment):

    python tools/diagnose_phone_duplicate.py

Prints only non-secret fields (no password/hash/token values). Safe to
delete after use; makes no writes to the database.
"""
import json
import re
import sys
from pathlib import Path


def _find_backend_root() -> Path:
    for start in (Path(__file__).resolve().parent, Path.cwd()):
        for candidate in (start, *start.parents):
            if (candidate / "sql_app").is_dir():
                return candidate
    raise RuntimeError("Could not locate backend root containing sql_app/")


sys.path.insert(0, str(_find_backend_root()))

from sql_app.database import SessionLocal  # noqa: E402
from sql_app.models import User, AppSetting  # noqa: E402

PHONES_TO_CHECK = ["9804901958", "7278469905"]
MEMBER_ID_TO_CHECK = "MAU68903"


def norm_phone(value: str) -> str:
    return re.sub(r"\D", "", str(value or ""))


def candidates_for(phone: str) -> set[str]:
    digits = norm_phone(phone)
    c = {digits} if digits else set()
    if len(digits) >= 10:
        c.add(digits[-10:])
    return c


def matches(value: str, candidates: set[str]) -> bool:
    p = norm_phone(value)
    return bool(p) and (p in candidates or (len(p) >= 10 and p[-10:] in candidates))


def safe_profile(payload) -> dict:
    if not isinstance(payload, dict):
        return {}
    drop = {"password", "password_hash", "token", "hash", "secret"}
    return {k: v for k, v in payload.items() if k.lower() not in drop}


def check_phone(db, phone: str):
    print(f"\n===== PHONE {phone} =====")
    candidates = candidates_for(phone)
    if not candidates:
        print("  (invalid/empty phone, skipping)")
        return

    found_any = False
    for u in db.query(User).filter(User.phone != "").all():
        if matches(u.phone, candidates):
            found_any = True
            print("  [A] USER TABLE MATCH:", {
                "id": u.id, "name": u.name, "role": u.role, "phone": u.phone,
                "is_active": u.is_active, "created_at": str(u.created_at),
            })

    prefix = "member_registration_identity:phone:"
    for row in db.query(AppSetting).filter(AppSetting.key.like(f"{prefix}%")).all():
        key_phone = row.key[len(prefix):]
        if not matches(key_phone, candidates):
            continue
        found_any = True
        try:
            payload = json.loads(row.value_json or "{}") if isinstance(row.value_json, str) else {}
        except Exception:
            payload = {}
        uid = payload.get("user_id") if isinstance(payload, dict) else None
        owner = db.query(User).filter(User.id == str(uid or "")).first()
        print("  [B] member_registration_identity ROW:", {
            "key": row.key,
            "payload_user_id": uid,
            "owner_exists": bool(owner),
            "owner_role": owner.role if owner else None,
            "owner_active": owner.is_active if owner else None,
            "owner_phone": owner.phone if owner else None,
            "owner_name": owner.name if owner else None,
        })

    for row in db.query(AppSetting).filter(AppSetting.key.like("user_profile:%")).all():
        try:
            payload = json.loads(row.value_json or "{}") if isinstance(row.value_json, str) else {}
        except Exception:
            payload = {}
        if not isinstance(payload, dict):
            continue
        stored_phone = str(payload.get("phone") or "")
        if not matches(stored_phone, candidates):
            continue
        found_any = True
        uid = row.key.split(":", 1)[1] if ":" in row.key else ""
        owner = db.query(User).filter(User.id == uid).first()
        print("  [C] user_profile ROW:", {
            "key": row.key,
            "owner_exists": bool(owner),
            "owner_role": owner.role if owner else None,
            "owner_active": owner.is_active if owner else None,
            "owner_name": owner.name if owner else None,
            "owner_phone": owner.phone if owner else None,
        })

    if not found_any:
        print("  No match found in User table, member_registration_identity, or user_profile.")


def check_member_id(db, member_id: str):
    print(f"\n===== MEMBER ID {member_id} =====")
    u = db.query(User).filter(User.id == member_id).first()
    if not u:
        print("  Not found in users table.")
        return
    print("  USER:", {
        "id": u.id, "name": u.name, "role": u.role, "phone": u.phone,
        "is_active": u.is_active, "created_at": str(u.created_at),
    })
    row = db.query(AppSetting).filter(AppSetting.key == f"user_profile:{u.id}").first()
    if row:
        try:
            payload = json.loads(row.value_json or "{}") if isinstance(row.value_json, str) else {}
        except Exception:
            payload = {}
        print("  user_profile snapshot (sanitized):", safe_profile(payload))
    else:
        print("  No user_profile:<id> AppSetting row found.")

    identity_row = db.query(AppSetting).filter(
        AppSetting.key.like("member_registration_identity:pan:%")
    ).all()
    for r in identity_row:
        try:
            payload = json.loads(r.value_json or "{}") if isinstance(r.value_json, str) else {}
        except Exception:
            payload = {}
        if isinstance(payload, dict) and str(payload.get("user_id") or "") == u.id:
            print("  PAN identity key:", r.key)


def main():
    db = SessionLocal()
    try:
        for phone in PHONES_TO_CHECK:
            check_phone(db, phone)
        check_member_id(db, MEMBER_ID_TO_CHECK)
    finally:
        db.close()


if __name__ == "__main__":
    main()
