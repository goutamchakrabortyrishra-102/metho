# Backend API Spec: Owner Guide Cloud Sync (Bangla)

এই spec backend engineer-কে সরাসরি forward করার জন্য তৈরি।
Goal: Owner Guide checklist/note data user-wise server-এ save/load হবে যাতে multi-device auto sync কাজ করে।

## 1) Scope

1. New authenticated API endpoints:
   - GET /api/auth/owner-guide
   - PUT /api/auth/owner-guide
2. Per-user isolated state storage
3. Max payload size limit + basic validation
4. Audit log entry on update

## 2) Authentication

1. Bearer token required
2. Same auth middleware as /api/auth/me
3. Unauthorized response:
   - HTTP 401
   - {"detail": "Unauthorized"}

## 3) Data Model

Storage key: owner_guide_state (JSON)

Allowed JSON shape:

{
  "businessName": "string",
  "daily": [true, false, ...],
  "weekly": [true, false, ...],
  "withdrawal": [true, false, ...],
  "dailyNotes": "string",
  "weeklyNotes": "string",
  "technicalNotes": "string",
  "updatedAt": "string"
}

Rules:

1. businessName length <= 120
2. daily array length <= 20
3. weekly array length <= 20
4. withdrawal array length <= 20
5. notes each length <= 5000
6. Full request body size <= 100KB
7. Unknown extra fields allowed but total size rule must pass

## 4) Endpoint Contract

### GET /api/auth/owner-guide

Purpose:
Current logged-in user-এর saved owner guide state return করবে

Success response (200):

{
  "state": {
    "businessName": "METHO SOLO OPS",
    "daily": [true, false, true, false, false],
    "weekly": [false, false, false, false],
    "withdrawal": [true, true, false],
    "dailyNotes": "...",
    "weeklyNotes": "...",
    "technicalNotes": "...",
    "updatedAt": "28/07/2026, 11:20:02"
  }
}

If never saved:

Option A (recommended):
{
  "state": null
}

### PUT /api/auth/owner-guide

Purpose:
Current logged-in user-এর owner guide state save/update করবে

Request body:

{
  "state": {
    "businessName": "...",
    "daily": [true, false],
    "weekly": [false],
    "withdrawal": [true],
    "dailyNotes": "...",
    "weeklyNotes": "...",
    "technicalNotes": "...",
    "updatedAt": "..."
  }
}

Success response (200):

{
  "ok": true,
  "state": {
    "businessName": "...",
    "daily": [true, false],
    "weekly": [false],
    "withdrawal": [true],
    "dailyNotes": "...",
    "weeklyNotes": "...",
    "technicalNotes": "...",
    "updatedAt": "..."
  }
}

Validation failure:

HTTP 422
{
  "detail": "Invalid owner guide payload"
}

## 5) Storage Strategy

Preferred:

1. Add nullable JSON column in user profile table:
   - owner_guide_state JSON/JSONB NULL
2. On PUT:
   - validate
   - persist in owner_guide_state
   - set updated timestamp server-side if required

Alternative:

1. Separate table owner_guide_states:
   - id
   - user_id (unique)
   - state_json
   - updated_at

## 6) Audit Logging (Recommended)

On successful PUT, add audit entry:

1. action: owner_guide_updated
2. actor: current user id
3. metadata:
   - payload_size_bytes
   - business_name_changed (bool)

## 7) Security Requirements

1. Do not expose other users' state
2. Rate limit:
   - e.g. 60 requests/min per user
3. Reject oversized payload early
4. Input sanitize for strings (basic control characters handling)

## 8) Compatibility With Current Frontend

Current frontend already চেষ্টা করে:

1. GET /auth/owner-guide
2. PUT /auth/owner-guide

So এই endpoint add করলেই cloud sync auto কাজ করবে, frontend change লাগবে না।

## 9) Test Cases (Must Pass)

1. Valid save and reload
2. Empty state save
3. Oversized notes reject with 422
4. Unauthorized token gets 401
5. User A cannot read/write User B state
6. Rapid repeated save handles correctly

## 10) Deployment Checklist

1. DB migration done
2. Endpoint deployed
3. OpenAPI updated
4. Postman or curl sanity test done
5. Frontend Owner Guide shows Sync mode: cloud
