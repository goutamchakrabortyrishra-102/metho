# Backend Handoff: Member Joining Instability

## Exact Problem Summary
Member registration is unstable in production. Valid signup attempts intermittently fail with HTTP 500, causing onboarding failures.

## Tested Endpoints
- POST /api/auth/register
- POST /api/register
- GET /api/auth/sponsor-info/{code}
- GET /openapi.json (contract verification)

## Expected vs Actual
### Expected
1. Valid unique user registration should always succeed.
2. Duplicate phone should return deterministic validation error.
3. Sponsor validation should return consistent field-level error.
4. Runtime validators should match OpenAPI contract.

### Actual
1. Valid payload sometimes returns HTTP 500 Internal Server Error.
2. Endpoint behavior differs between /api/auth/register and /api/register.
3. Responses vary between generic 500 and 400 validation errors.
4. Field-requirement behavior has been inconsistent during live checks.

## Reproduce Steps
1. Call POST /api/auth/register with a valid unique payload.
2. Repeat with another unique username/email and same phone.
3. Run the same checks on POST /api/register.
4. Compare status codes and error body consistency.

Sample valid payload:
{
  "name": "Live Test User",
  "email": "unique_user_xxx",
  "phone": "98XXXXXXXX",
  "password": "Test@1234",
  "pan_no": "ABCDE1234F",
  "dob": "1998-01-01",
  "sponsor_code": null
}

## Impact
- New member onboarding fails unpredictably.
- Support/admin load increases due to repeated retries.
- Conversion and trust drop on registration funnel.
- QA cannot certify one-phone-one-registration behavior reliably while 500 persists.

## Recommended Backend Fixes
1. Remove HTTP 500 for valid registration payloads.
2. Standardize one canonical registration flow across /api/auth/register and /api/register.
3. Enforce deterministic field-level errors:
   - username already exists
   - phone already exists
   - invalid sponsor code
4. Align runtime validators with OpenAPI schema.
5. Return structured JSON for server errors (with trace/correlation id where possible).

## Frontend Hardening Already Applied
- Phone format validation added.
- PAN format validation added.
- Invalid sponsor code guard added before submit.
- User-friendly error mapping improved.
- Registration fallback added in frontend when primary register endpoint fails.
- Non-registration modules were not changed.

## Current Status
Frontend is hardened. Remaining blocker is backend registration stability and response consistency.
