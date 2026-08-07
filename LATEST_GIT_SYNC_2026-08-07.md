# Latest Git Sync Snapshot (2026-08-07)

This file is the quick "what changed recently" map for newcomers.

## Branch State

- Repository: `metho`
- Branch: `main`
- Snapshot date: 2026-08-07

## Recent Commits (Newest First)

1. `cd2c1e1a` - Partner registration: add city dropdown fallback cache
   - File: `src/pages/PartnerRegisterPage.jsx`
   - Effect: City dropdown can recover from API failure using local cache.

2. `a6b54215` - Make admin accounts metrics period-based and realistic
   - File: `src/pages/dashboard/AccountsPage.jsx`
   - Effect: Period selector + realistic income/expense/net ratios.

3. `0c24cbfe` - Add hot-only quick filter for external leads
   - File: `src/pages/dashboard/PartnersPage.jsx`

4. `8ac0eaf8` - Add lead scoring, dedupe, and follow-up tracker
   - File: `src/pages/dashboard/PartnersPage.jsx`

5. `0b7163ff` - Add phone-only CSV export for external leads
   - File: `src/pages/dashboard/PartnersPage.jsx`

6. `08534c2d` - Add CSV export for external leads
   - File: `src/pages/dashboard/PartnersPage.jsx`

7. `fdd14230` - Switch admin nearby leads to external business search
   - File: `src/pages/dashboard/PartnersPage.jsx`

8. `40f8e23a` - Add admin nearby offline lead finder
   - File: `src/pages/dashboard/PartnersPage.jsx`

## What A New Developer Should Read First

1. `README.md`
2. `SYSTEM_GUIDE.md`
3. `SYSTEM_GUIDE_BN.md`
4. `README_HANDOVER_BN.md`
5. `src/App.js`
6. `src/services/api.js`
7. `backend/sql_app/main.py`

## Quick Verify Commands

```bash
git status --short
git log --oneline -n 10
npm run build
```

If `npm run build` passes and changed files match your intent, the handoff is usually safe.
