# Member Joining Backend Bug Report

## Scope
- Area: Member registration flow
- Frontend route: /register
- Backend base: https://metho-backend.onrender.com
- Endpoints tested:
  - /api/auth/register
  - /api/register

## Summary
Member registration is unstable due to server-side failures and inconsistent validation responses. Frontend validations are now improved, but backend errors still block smooth onboarding.

## Observed Issues

1. Intermittent/Internal Failure on registration
- Endpoint: /api/auth/register
- Result: HTTP 500 Internal Server Error (plain text response)
- Impact: Valid new members fail to register.

2. Inconsistent behavior between registration endpoints
- Endpoint: /api/register
- Result: Sometimes HTTP 400 with "Username already registered", sometimes HTTP 500.
- Impact: Registration outcomes are not reliable for clean payloads.

3. DOB contract mismatch with product requirement
- OpenAPI schema says dob is nullable/optional in RegisterRequest.
- Runtime responses have shown "Date of birth is required" in previous live attempts.
- Impact: Business rule uncertainty and user confusion.

4. One-phone-one-registration rule not reliably verifiable
- Due to server 500 during first valid registration, duplicate-phone scenario cannot be deterministically verified every run.
- Impact: Onboarding QA cannot fully certify uniqueness behavior.

## OpenAPI Contract Snapshot (from live openapi.json)
RegisterRequest required fields currently list:
- name
- email
- phone
- password
- pan_no

Non-required fields in schema:
- dob (nullable)
- sponsor_code (nullable)

## Reproduction (example)
Use a unique username and phone each attempt.

POST /api/auth/register
Payload:
{
  "name": "Live Test",
  "email": "unique_user_12345",
  "phone": "9800123456",
  "password": "Test@1234",
  "pan_no": "ABCDE1234F",
  "dob": "1998-01-01",
  "sponsor_code": null
}

Observed in multiple runs:
- HTTP 500 Internal Server Error

POST /api/register with similar payload has returned:
- HTTP 400 {"detail":"Username already registered"} in some runs
- HTTP 500 Internal Server Error in other runs

## Expected Behavior

1. Valid payload with unique username + unique phone must consistently succeed.
2. Duplicate phone should return deterministic validation error (e.g., 400 with clear message).
3. DOB policy should be consistent with contract:
- If optional: allow null/empty.
- If required by business: update OpenAPI schema and error text consistently.
4. Error body for 500 should not be plain text only; include trace id or structured error for diagnosis.

## User Impact
- New members cannot reliably onboard.
- Admin support load increases due to repeated failed attempts.
- Confusion around DOB requirement and duplicate checks.

## Recommended Backend Actions

1. Check registration service logs around recent requests that return 500.
2. Normalize registration logic to a single stable endpoint path.
3. Enforce unique checks with clear, field-specific error messages:
- username already exists
- phone already exists
- invalid sponsor code
4. Align runtime validators and OpenAPI contract for dob.
5. Return structured error JSON for all failures, including 500 class errors where safe.

## Frontend Status
Frontend already hardened to reduce user friction:
- Phone format validation
- PAN format validation
- Sponsor code invalid guard
- Clear user-facing error messages
- Registration endpoint fallback attempt when primary endpoint fails

Remaining blocker is backend stability and consistent validation behavior.
