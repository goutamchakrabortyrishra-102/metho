# METHO Codebase Guide

This repository contains the METHO frontend and the active FastAPI backend used by the frontend in the same workspace.

## Git-Synced Update Snapshot (2026-08-07)

Latest verified changes from `main` (newest first):

1. `cd2c1e1a`: Partner registration city dropdown fallback cache in `src/pages/PartnerRegisterPage.jsx`
2. `a6b54215`: Admin accounts page made period-based and realistic in `src/pages/dashboard/AccountsPage.jsx`
3. `0c24cbfe`: Hot-only quick filter for external leads in `src/pages/dashboard/PartnersPage.jsx`
4. `8ac0eaf8`: Lead scoring, dedupe, and follow-up tracker in `src/pages/dashboard/PartnersPage.jsx`
5. `0b7163ff`: Phone-only CSV export for external leads in `src/pages/dashboard/PartnersPage.jsx`
6. `08534c2d`: CSV export for external leads in `src/pages/dashboard/PartnersPage.jsx`
7. `fdd14230`: Switched nearby search to external business lead generation in `src/pages/dashboard/PartnersPage.jsx`
8. `40f8e23a`: Added admin nearby offline lead finder in `src/pages/dashboard/PartnersPage.jsx`

Detailed note: `LATEST_GIT_SYNC_2026-08-07.md`

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

## New Developer Zero-Confusion Workflow

If someone is completely new to this codebase, follow this exact sequence:

1. Read `SYSTEM_GUIDE.md`
2. Read `SYSTEM_GUIDE_BN.md` (Bangla-first map)
3. Read `README_HANDOVER_BN.md`
4. Open route map in `src/App.js`
5. Open API client in `src/services/api.js`
6. Open backend boot in `backend/sql_app/main.py`
7. Run frontend locally (`npm start`)
8. Build once (`npm run build`) before any handoff

For syncing with latest upstream changes before work:

1. `git fetch origin`
2. `git pull origin main`
3. `git log --oneline -n 10`
4. `git status --short`

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
