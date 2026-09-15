# Backend Changes — 2026-09-15

## Scope
`backend/sql_app/whatsapp_cloud.py` — fix WhatsApp role-selection matcher looping
on valid input, and stop losing pasted registration details when a user skips
straight to sending full details before picking a role. No other files/logic
touched.

## Problem
`_continue_introduction(db, session, lead, text, recipient)` matched the
user's role choice with an **exact string equality** lookup:
```python
choices = {"1": "member", "member": "member", ...}
elif normalized in choices: ...
```
Any message that wasn't exactly `"1"`, `"member"`, etc. (e.g. "Hi, I want to
become a member please help", or a pasted block of registration details) fell
into the `else` branch and re-sent `preset_role_selection_fallback` — forever,
on every retry, with no escape hatch.

## Fix

### 1. Substring role matching (reuses existing matcher)
Replaced the exact-match `choices` dict with a call to the already-existing
`_registration_role_for_text(config, text)` (used elsewhere for website-form
intent detection). It substring-matches against the admin-configurable
`member/partner/rider_registration_keywords` lists and already guards against
informational questions via `_is_informational_question` /
`_has_registration_intent`. No changes made to that function.

### 2. Pasted-registration-details detection → human handoff
New small helper next to `_continue_introduction`:
```python
PASTED_REGISTRATION_DETAIL_MARKERS = ("name-", "address-", "pin-", "father name")

def _looks_like_pasted_registration_details(text: str) -> bool:
    ...
```
Counts marker hits (`"Name-"`, `"Address-"`, `"Pin-"`, `"Father Name"`, plus a
6-digit PIN pattern via `re.search(r"\b\d{6}\b", text)`). If 2+ markers are
present, the message is treated as pasted registration data instead of a role
choice:
- The raw text is saved as a `CRMLeadActivity`
  (`activity_type="whatsapp_unrouted_registration_details"`) so nothing is lost.
- `_request_whatsapp_human_handoff(db, lead, session, recipient)` is called so
  an admin picks it up instead of looping the user.

This check runs **before** the role-keyword check, because the existing
keyword lists include bare digits (`"1"`, `"2"`, `"3"`) as member/partner/rider
shortcuts, and a 6-digit PIN code (e.g. `700001`) can incidentally contain
`"1"` as a substring. Pasted-details detection is a more specific signal and
takes priority over that kind of incidental digit match.

### 3. Repeated-fallback counter → human handoff on 3rd loop
Session state already has a free-form `data_json` field (`_session_data` /
`_save_session_data` helpers), so no schema/model change was needed — a
`fallback_count` key is stored there instead of adding a new column:
- Any successful role match (or the "4" info command) resets `fallback_count`
  to `0`.
- Each time the fallback branch is hit, the current count is checked first:
  if it's already `>= 2` (i.e. this would be the 3rd fallback in a row), the
  counter is reset and `_request_whatsapp_human_handoff` is called instead of
  sending `preset_role_selection_fallback` a third time.
  Otherwise the counter is incremented and the fallback message is sent as
  before.

## Not touched (per constraints)
`_registration_role_for_text`, `_route_registered_member`,
`_request_whatsapp_human_handoff`, `admin_approve_order`, `compat.py`,
`checkout.py`, `auth.py`. No `WhatsAppRegistrationSession` schema/model change
(reused existing `data_json` field instead of adding a `fallback_count`
column).

## Verification
- `python -m py_compile backend/sql_app/whatsapp_cloud.py` — clean.
- `python -c "import sql_app.main"` from `backend/` — imports/boots cleanly
  (uvicorn's own `--app-dir` invocation hit an unrelated local `sys.path`
  quirk in this shell; the direct module import exercises the same import
  path FastAPI/uvicorn use and succeeded).
- Added `backend/tests/test_whatsapp_role_selection_matcher.py` (3 new tests):
  keyword-embedded-in-longer-message now matches; 3rd consecutive fallback
  triggers human handoff; pasted registration details trigger human handoff
  and are saved as a `CRMLeadActivity`. All 3 pass.
- Ran full `pytest tests/` before and after the change (via `git stash` /
  `git stash pop`): the same 26 tests fail both before and after (pre-existing,
  unrelated environment/fixture issues — e.g. missing default sponsor user,
  duplicate-webhook-id assertions). No new failures introduced by this change.
