# METHO Codebase Guide

This repository contains the METHO frontend and the active FastAPI backend used by the frontend in the same workspace.

If you are opening this project for the first time, do not start by guessing files. Start here:

1. Read `SYSTEM_GUIDE.md`
2. Read `SYSTEM_GUIDE_BN.md` if you want the same map in Bangla-first form
3. Read `AGENTS.md`
4. Open `src/App.js`
5. Open `backend/sql_app/main.py`

## What This Project Does

METHO combines:

- METHO product commerce
- associate partner directory and partner shops
- member dashboard and referral/reward flows
- partner dashboard and product/service uploads
- admin approvals, settings, and monitoring
- Metho Store owner flows

## Main Folders

- `src/`: React frontend
- `backend/`: backend code and backend docs
- `build/`: generated production build output
- `public/`: static public assets

## Fast Start

### Frontend

1. `npm install`
2. `npm start`
3. `npm run build`

### Backend

Use the SQL backend in `backend/sql_app/` as the main reference point for current hosted behavior.

## Best Starting Files

- `SYSTEM_GUIDE.md`: full human-readable map of the system
- `SYSTEM_GUIDE_BN.md`: Bangla-first guide for owners/operators/newcomers
- `src/App.js`: route tree and role guards
- `src/services/api.js`: shared API client
- `src/layouts/DashboardLayout.jsx`: dashboard shell and nav
- `backend/sql_app/main.py`: backend app boot and middleware
- `backend/sql_app/routers/`: business route modules

## Existing Reference Docs

- `PROJECT_FLOWCHART.md`
- `backend/PROJECT_FLOWCHART.md`
- `QA_RUNBOOK_BN.md`
- `README_HANDOVER_BN.md`
- `SOLO_OWNER_OPERATING_MANUAL_BN.md`

## Maintenance Rule

When changing behavior, trace all four layers together:

1. route/page
2. API call
3. backend route
4. rendered output or saved file

That prevents most regressions in this codebase.
