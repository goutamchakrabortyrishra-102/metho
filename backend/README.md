# METHO Backend Guide

This backend folder is part of the same system as the React frontend in the repository root.

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
