# METHO Backend Guide

This backend folder is part of the same system as the React frontend in the repository root.

## Latest Git-Synced Backend Update (2026-08-07)

Recent backend-impact commits verified from `main`:

1. `40f8e23a`: Added admin nearby offline lead finder support
	- Files: `sql_app/routers/compat.py`, `sql_app/routers/directory.py`
2. `55e9db2b`: Improved partial matching for directory type/category
	- File: `sql_app/routers/directory.py`
3. `f867e664`: Set partner quantity minimum to 100 gram and related validations
	- Files: `sql_app/routers/checkout.py`, `sql_app/routers/compat.py`, `sql_app/routers/directory.py`

Backend change snapshot file: `LATEST_BACKEND_GIT_SYNC_2026-08-07.md`

If you need the full picture, read the root guide first:

- `../SYSTEM_GUIDE.md`

## Current Backend Shape

The current main backend reference in this workspace is the SQL app:

- `sql_app/main.py`

That file wires:

- FastAPI app creation
- CORS and trusted hosts
- middleware and security headers
- router registration
- demo seed data for starter mode

## Backend Folder Map

- `sql_app/database.py`: database connection and session setup
- `sql_app/models.py`: SQLAlchemy models
- `sql_app/schemas.py`: request/response models
- `sql_app/security.py`: auth, password hashing, token helpers
- `sql_app/storage.py`: uploaded file root resolution
- `sql_app/routers/`: business routes

## Router Responsibilities

- `auth.py`: login, register, current user, welcome letter
- `commerce.py`: product and commerce-facing APIs
- `checkout.py`: public order flows and file serving
- `compat.py`: large compatibility/admin/partner/settings surface
- `directory.py`: partner directory APIs
- `partner_public.py`: partner public data
- `settings.py`: settings loading and saving
- `health.py`: health and monitoring endpoints

## Important Maintenance Notes

1. File and image problems are often path-resolution problems, not UI problems.
2. Uploaded assets are served through `/api/files/*` or `/api/public-files/*`.
3. Persistent storage configuration matters in production; missing uploads can survive code deploys.
4. Role-sensitive features should be enforced in backend validation, not only in frontend UI.

## Read Next

- `../README.md`
- `../PROJECT_FLOWCHART.md`
- `PROJECT_FLOWCHART.md`

## Newcomer Backend Workflow

Use this exact sequence if you are new and need to work safely:

1. Pull latest branch (`git pull origin main`).
2. Read this file once, then `README_HANDOVER_BN.md`.
3. Open `sql_app/main.py` and check router registration order.
4. Open the target route module in `sql_app/routers/`.
5. Run one request path locally before editing.
6. After edits, validate API behavior and then sync docs.
