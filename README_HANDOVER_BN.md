# METHO Frontend Handover Guide (Bangla)

এই folder-এ frontend code আছে। AI ছাড়া সাধারণ developer-ও VS Code খুলে কাজ করতে পারবে।

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
