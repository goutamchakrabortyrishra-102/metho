# AGENTS

AI coding agents should use this file as the fast-start guide for this repository.

## Read This First

- Primary newcomer guide: [SYSTEM_GUIDE.md](SYSTEM_GUIDE.md)
- Bangla-first newcomer guide: [SYSTEM_GUIDE_BN.md](SYSTEM_GUIDE_BN.md)
- Root overview for GitHub readers: [README.md](README.md)
- Backend boot path: `backend/sql_app/main.py`

## Scope

- Repository: Metho Frontend (React + CRACO).
- Keep instructions minimal here; follow linked docs for deeper details.

## First Steps

1. Install dependencies: npm install
2. Start dev server: npm start
3. Build for production: npm run build
4. Run tests: npm test

## Required Environment

- Copy .env.example to .env.
- Set REACT_APP_BACKEND_URL to the browser-reachable backend URL.
- Default local backend is [http://localhost:8000](http://localhost:8000).

## Code Map

- App entry and route tree: src/App.js
- React root providers: src/index.js
- API client and auth token handling: src/services/api.js
- Global settings and branding resolution: src/contexts/SettingsContext.jsx
- Asset URL normalization: src/lib/utils.js
- Pages: src/pages and src/pages/dashboard
- Layouts: src/layouts
- Shared components: src/components
- Context providers: src/contexts
- Backend router modules: backend/sql_app/routers

## Project Conventions

- Use alias imports via @ for src (configured in craco.config.js).
- Add protected routes under PrivateRoute; admin-only pages must use AdminRoute.
- Backend calls should go through src/services/api.js to keep auth interceptor behavior consistent.
- Keep Metho Store data and partner directory data separate. Do not use partner-directory fallbacks for Metho Store UI blocks.
- Preserve existing React Query defaults in src/index.js unless there is a clear performance reason.
- Follow current UI/flow behavior described by QA and handover docs before refactoring route/page behavior.

## Pitfalls To Avoid

- Do not hardcode backend URLs in page components; use the API client.
- If a change affects role access, verify both member and admin paths.
- If a change affects images/PDFs/uploads, verify stored path, resolved URL, and backend file serving together.
- This codebase contains vercel.json, but deployment and verification should stay aligned with Cloudflare-hosted frontend workflows when applying ops/deployment changes.

## Validation Checklist For Changes

1. Run npm start and verify app loads without runtime crash.
2. Verify role-based route behavior for changed pages.
3. If data fields change, validate form input, API payload, and rendered output together.
4. For sharing or invoice features, manually test copy/share/download/print flows.
5. Run npm run build before handoff.

## Reference Docs (Link, Do Not Duplicate)

- Full system map: [SYSTEM_GUIDE.md](SYSTEM_GUIDE.md)
- Bangla-first system map: [SYSTEM_GUIDE_BN.md](SYSTEM_GUIDE_BN.md)
- Flow and architecture overview: [PROJECT_FLOWCHART.md](PROJECT_FLOWCHART.md)
- QA verification checklist: [QA_RUNBOOK_BN.md](QA_RUNBOOK_BN.md)
- Handover and setup notes: [README_HANDOVER_BN.md](README_HANDOVER_BN.md)
