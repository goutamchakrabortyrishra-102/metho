# METHO System Guide

This document is the fastest way to understand the full codebase without guessing.

Use it when you need to answer four questions quickly:

1. What does this system do?
2. Which file controls which behavior?
3. If something breaks, where should I look first?
4. If I need to change a feature, which layer should I edit?

## 1. What This Repository Contains

This workspace contains two main parts:

- Frontend: React app in `src/`
- Backend: FastAPI SQL app in `backend/sql_app/`

High-level product areas:

- Public landing site
- METHO product shop
- Partner directory and partner shops
- Member dashboard
- Partner dashboard
- Admin operations and approvals
- Media upload/file serving
- Wallet, invoice, and reward flows

## 2. First Mental Model

Think of the system in this order:

1. A route opens a page.
2. The page calls the shared API client.
3. The backend router handles the request.
4. The backend reads/writes database rows or uploaded files.
5. The frontend renders returned JSON.

If you remember only one rule, remember this:

- UI problems usually start in `src/pages`, `src/components`, or `src/layouts`.
- Data or permission problems usually start in `src/services/api.js` or `backend/sql_app/routers/`.
- Media/image/PDF/file problems usually start in `src/lib/utils.js`, `src/contexts/SettingsContext.jsx`, or `backend/sql_app/routers/checkout.py`.

## 3. Frontend Entry Points

Important frontend files:

- `src/index.js`: React bootstrapping and providers
- `src/App.js`: all top-level routes and route guards
- `src/services/api.js`: shared axios client, auth token injection, 401 cleanup
- `src/contexts/AuthContext.jsx`: login state and user session access
- `src/contexts/SettingsContext.jsx`: global branding/settings fetch and asset URL resolution
- `src/lib/utils.js`: backend URL resolution and asset URL normalization
- `src/layouts/DashboardLayout.jsx`: member/admin dashboard shell and nav

### Route Groups in `src/App.js`

Public routes:

- `/` -> landing page
- `/shop` -> METHO product shop
- `/directory` -> partner directory
- `/metho-store` -> METHO store listing page
- `/partner-shop/:partnerCode` -> public partner shop
- `/gallery/:partnerCode` -> public partner gallery

Auth/account routes:

- `/login`
- `/register`
- `/forgot-password`
- `/reset-password`

Protected user routes:

- `/app/*` -> member/admin dashboard routes inside `DashboardLayout`

Protected partner route:

- `/partner` -> partner dashboard

Other protected routes:

- `/invoice/:orderId`
- `/wallet-statement`
- `/partner-payout`

### Route Guards

These are defined in `src/App.js`:

- `PrivateRoute`: any logged-in user
- `AdminRoute`: `super_admin`, `company_admin`, `admin`
- `StoreOwnerRoute`: `store_owner`, `metho_store_owner`, `owner`
- `MemberRoute`: normal member dashboard path; redirects partner users to `/partner`

## 4. Frontend Page Map

### Public pages

- `src/pages/LandingPage.jsx`: homepage sections, live METHO store block, best products, partner finder
- `src/pages/ShopPage.jsx`: public METHO product purchase flow
- `src/pages/DirectoryPage.jsx`: partner list and filters
- `src/pages/MethoStorePage.jsx`: admin-created METHO store listings
- `src/pages/PartnerShopPage.jsx`: partner storefront summary + cart flow
- `src/pages/PartnerGalleryPage.jsx`: partner product/service gallery + checkout
- `src/pages/InstallPage.jsx`: install/PWA guidance

### Dashboard pages

- `src/pages/dashboard/DashboardHome.jsx`: main member summary
- `src/pages/dashboard/ProductsPage.jsx`: product/admin product area
- `src/pages/dashboard/OrdersPage.jsx`: order history and invoice links
- `src/pages/dashboard/SettingsPage.jsx`: system settings, branding, payout settings
- `src/pages/dashboard/MethoStoreAdminPage.jsx`: METHO store owner administration
- `src/pages/dashboard/MethoStoreOwnerPage.jsx`: store owner dashboard
- `src/pages/dashboard/SystemHealthPage.jsx`: operational monitoring UI
- `src/pages/dashboard/OwnerGuidePage.jsx`: admin/owner usage guide inside app

### Partner pages

- `src/pages/PartnerDashboardPage.jsx`: partner overview, uploads, banner, featured images, wallet top-up, public shop sharing
- `src/components/PartnerProductForm.jsx`: partner product/service add/edit dialog
- `src/components/OfflineBillingPanel.jsx`: partner offline billing flow

## 5. Backend Entry Points

Important backend files:

- `backend/sql_app/main.py`: FastAPI app setup, CORS, trusted hosts, middleware, router registration, demo seeding
- `backend/sql_app/database.py`: SQLAlchemy database setup
- `backend/sql_app/models.py`: database tables/models
- `backend/sql_app/schemas.py`: request/response schemas
- `backend/sql_app/security.py`: token/password helpers
- `backend/sql_app/storage.py`: upload root resolution

### Router Map

`backend/sql_app/routers/auth.py`

- login/register/auth helpers
- current user resolution
- welcome letter generation

`backend/sql_app/routers/commerce.py`

- product listing/business product APIs
- METHO product behavior and related commerce logic

`backend/sql_app/routers/checkout.py`

- public order handling
- file serving through `/api/files/*` and `/api/public-files/*`
- upload path recovery for legacy media

`backend/sql_app/routers/compat.py`

- large compatibility/router surface
- admin uploads
- settings updates
- partner gallery/product support endpoints
- payout/wallet helper behavior

`backend/sql_app/routers/directory.py`

- public partner directory
- city/category filters
- featured partner APIs

`backend/sql_app/routers/partner_public.py`

- public partner-facing data and checkout-related partner info

`backend/sql_app/routers/settings.py`

- settings load/save helpers
- branding/policy/runtime config values

`backend/sql_app/routers/health.py`

- health and monitoring endpoints

## 6. Data Flow by Feature

### A. Login / member session

1. UI calls `src/services/api.js`
2. backend auth route validates user
3. JWT token returns to frontend
4. token is stored in `localStorage`
5. future API calls attach `Authorization` header automatically

### B. Public METHO product shopping

1. `src/pages/ShopPage.jsx` loads `/api/products`
2. only METHO products should appear there
3. cart state stays in frontend page state
4. checkout dialog submits order flow to backend

### C. Partner directory and partner shop

1. `src/pages/DirectoryPage.jsx` loads `/api/directory/partners`
2. clicking a partner opens `/partner-shop/:partnerCode`
3. shop page loads partner + products
4. gallery page shows products/services and checkout

### D. METHO store listings

1. `src/pages/MethoStorePage.jsx` is for admin-created Metho Store owners/listings
2. landing page live store block should show only Metho Store data
3. partner directory data must not be mixed into Metho Store blocks

### E. Media uploads and file serving

1. uploads are saved under `uploaded_objects` or configured persistent storage root
2. frontend usually receives a stored path like `/api/files/...`
3. frontend asset URLs are normalized in `src/lib/utils.js`
4. backend file serving and legacy path recovery live in `backend/sql_app/routers/checkout.py`

If an image/PDF is missing, check these in order:

1. Was the file actually uploaded?
2. Is the stored path valid in database/settings?
3. Does `resolveAssetUrl` build the correct URL?
4. Can `checkout.py` resolve that file from current upload roots?

## 7. Role Model

Main roles used across the app:

- `member`
- `partner`
- `admin`
- `company_admin`
- `super_admin`
- `store_owner` / `metho_store_owner` / `owner`

Quick rule:

- members use `/app/*`
- partners use `/partner`
- admins have approval/settings/ops pages
- store owners have Metho Store owner-specific pages

## 8. Where To Edit Common Requests

If the request says...

- "landing page text/card/layout" -> `src/pages/LandingPage.jsx`
- "member dashboard menu/page" -> `src/layouts/DashboardLayout.jsx` or `src/pages/dashboard/*`
- "partner shop/gallery/cart" -> `src/pages/PartnerShopPage.jsx`, `src/pages/PartnerGalleryPage.jsx`
- "partner upload form" -> `src/components/PartnerProductForm.jsx`
- "branding/logo/hero image" -> `src/pages/dashboard/SettingsPage.jsx`, `src/contexts/SettingsContext.jsx`
- "images/PDF/media 404" -> `src/lib/utils.js`, `backend/sql_app/routers/checkout.py`
- "role access wrong" -> `src/App.js` route guards and backend protected routes
- "METHO store owner/admin behavior" -> `src/pages/MethoStorePage.jsx`, `src/pages/dashboard/MethoStoreAdminPage.jsx`, `src/pages/dashboard/MethoStoreOwnerPage.jsx`, `src/services/methoStore.js`

## 9. Deployment and Environment

Frontend:

- local dev: `npm start`
- production build: `npm run build`
- current deployment workflow in this repo is Cloudflare Pages
- recent direct deploys were done with `npx wrangler pages deploy build --project-name metho --branch main --commit-dirty=true`

Backend:

- browser-facing backend URL is controlled by `REACT_APP_BACKEND_URL`
- default local backend assumption is `http://localhost:8000`
- hosted backend has been running from Render in recent work

Important environment idea:

- frontend and backend can both look healthy while uploaded media is broken if persistent upload storage is misconfigured

## 10. Safe Working Rules For Maintainers

1. Do not hardcode backend URLs inside page components.
2. Use `src/services/api.js` for API calls.
3. Keep role checks consistent with both frontend and backend expectations.
4. When changing a field, verify form input, API payload, backend save logic, and rendered output together.
5. When changing uploads, verify both the stored path and the served URL.
6. When changing store listings, keep Metho Store data and partner directory data separate.

## 11. Fast Debug Checklist

When something is wrong, use this order:

### UI not showing expected data

1. Open the page component
2. Find the API call
3. Check route params/query params
4. Check any local filtering or role-based hiding

### API returns but file/image broken

1. Inspect returned URL/path
2. Check `resolveAssetUrl`
3. Check file-serving endpoint in backend
4. Check actual uploaded file root/path

### Wrong users can access a feature

1. Check frontend route guard in `src/App.js`
2. Check page-level UI gating
3. Check backend auth/role validation for the API

### A section is showing the wrong dataset

1. Check service helper fallback order
2. Check frontend filter logic
3. Confirm the endpoint contract is really for that feature

## 12. Files To Read First As A New Developer

Read in this order:

1. `SYSTEM_GUIDE.md`
2. `README.md`
3. `AGENTS.md`
4. `src/App.js`
5. `src/services/api.js`
6. `src/layouts/DashboardLayout.jsx`
7. `backend/sql_app/main.py`
8. `backend/sql_app/routers/checkout.py`
9. `backend/sql_app/routers/compat.py`

## 13. Existing Docs Worth Keeping Open

- `PROJECT_FLOWCHART.md`
- `backend/PROJECT_FLOWCHART.md`
- `QA_RUNBOOK_BN.md`
- `README_HANDOVER_BN.md`
- `SOLO_OWNER_OPERATING_MANUAL_BN.md`
- `TECHNICAL_EXECUTION_PLAN_BN.md`

## 14. Short Summary

If you need one-sentence understanding of the whole system:

METHO is a React + FastAPI commerce and rewards platform where public users browse products and partner shops, members use a protected dashboard, partners manage their own gallery and wallet flows, admins control approvals/settings/store ownership, and uploaded media is served through backend file endpoints.
