# Latest Backend Git Sync Snapshot (2026-08-07)

This file tracks recent backend-impact changes for fast onboarding.

## Branch Context

- Repository: metho
- Branch: main
- Snapshot date: 2026-08-07

## Recent Backend-Impact Commits (Newest First)

1. 40f8e23a - Add admin nearby offline lead finder
   - Files:
     - sql_app/routers/compat.py
     - sql_app/routers/directory.py
   - Notes:
     - Added backend support used by admin external lead flow.

2. 55e9db2b - Use partial matching for directory type/category
   - File:
     - sql_app/routers/directory.py
   - Notes:
     - Directory filtering became more tolerant for partial user input.

3. f867e664 - Set partner quantity minimum to 100 gram
   - Files:
     - sql_app/routers/checkout.py
     - sql_app/routers/compat.py
     - sql_app/routers/directory.py
   - Notes:
     - Commerce and related compatibility paths updated around minimum quantity behavior.

## Backend Files To Read First

1. sql_app/main.py
2. sql_app/routers/compat.py
3. sql_app/routers/directory.py
4. sql_app/routers/checkout.py
5. sql_app/models.py
6. sql_app/schemas.py

## Quick Verification Commands

```bash
git status --short
git log --oneline -n 10
```

If possible, validate changed routes with one request path before and after edits.
