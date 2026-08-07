# METHO Frontend Handover Guide (Bangla)

এই folder-এ frontend code আছে। AI ছাড়া সাধারণ developer-ও VS Code খুলে কাজ করতে পারবে।

## 0) Latest Git Sync (2026-08-07)

সাম্প্রতিক verified updates:

1. Partner registration city dropdown fallback cache যোগ হয়েছে (`src/pages/PartnerRegisterPage.jsx`)
2. Admin accounts page realistic period analytics পেয়েছে (`src/pages/dashboard/AccountsPage.jsx`)
3. Admin partners page-এ external lead workflow (search/export/scoring/follow-up) update হয়েছে (`src/pages/dashboard/PartnersPage.jsx`)

Commit-wise summary: `LATEST_GIT_SYNC_2026-08-07.md`

## 1) কি আছে
- React + CRACO frontend
- Main app code: `src/`
- API client: `src/services/api`

## 2) Prerequisites



- Node.js 18+ (recommended)
- npm
- VS Code + ESLint extension

## 3) VS Code এ run করার ধাপ
1. এই folder VS Code এ open করুন
2. Terminal খুলে install করুন:
   - `npm install`
3. dev server চালান:
   - `npm start`
4. production build:
   - `npm run build`

## 4) API connect
- Backend URL `.env` বা config থেকে set করুন
- Backend চলতে হবে (default: port 8000)

## 5) গুরুত্বপূর্ণ pages
- Admin Settings
- Products
- Members
- System Health
- Partner pages
- Invoice page

## 6) Human-friendly কাজের নিয়ম
- নতুন feature আগে route + UI mapping লিখুন
- data field add করলে form + api payload + page render তিন জায়গায় মিলান
- manual QA checklist maintain করুন

## 7) বুঝতে সহায়তা
- Flowchart দেখুন: `PROJECT_FLOWCHART.md`
- Solo owner operation manual: `SOLO_OWNER_OPERATING_MANUAL_BN.md`

## 8) একদম নতুন developer onboarding path

এই order follow করলে confusion কম হবে:

1. `README.md`
2. `SYSTEM_GUIDE.md`
3. `SYSTEM_GUIDE_BN.md`
4. `src/App.js` (route map)
5. `src/services/api.js` (API client)
6. `src/pages/dashboard/` (admin/member pages)
7. `backend/sql_app/main.py` (backend boot)

## 9) Git-এর সাথে মিলিয়ে কাজ করার rule

যেকোনো কাজ শুরু করার আগে:

1. `git fetch origin`
2. `git pull origin main`
3. `git status --short`
4. `git log --oneline -n 10`

কাজ শেষ হলে:

1. `npm run build`
2. `git status --short` দেখে changed files verify
3. concise commit message দিন
4. `git push origin main`

## 10) Change করলে কি কি validate করবেন

1. Route ঠিক আছে কিনা (`src/App.js`)
2. API path ঠিক আছে কিনা (`src/services/api.js` + page file)
3. backend endpoint match করছে কিনা (`backend/sql_app/routers/*`)
4. UI render ও form behavior ঠিক আছে কিনা
5. Role guard impact আছে কিনা (member/admin/partner)
