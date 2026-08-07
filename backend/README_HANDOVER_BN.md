# METHO Backend Handover Guide (Bangla)

এই folder-এ backend code আছে। AI ছাড়া সাধারণ developer-ও VS Code খুলে কাজ করতে পারবে।

## 0) Latest Backend Git Sync (2026-08-07)

সাম্প্রতিক backend-impact update (main branch verified):

1. External lead finder backend support যোগ হয়েছে (`sql_app/routers/compat.py`, `sql_app/routers/directory.py`)
2. Directory type/category filtering-এ partial matching যোগ হয়েছে (`sql_app/routers/directory.py`)
3. কিছু commerce validation update হয়েছে (quantity minimum related in `sql_app/routers/checkout.py` + compat/directory)

Commit-wise summary file: `LATEST_BACKEND_GIT_SYNC_2026-08-07.md`

## 1) কি আছে
- FastAPI backend (full + simple + sql mode)
- Main files:
  - `server.py` (full mode)
  - `server_simple.py` (simple mode)
  - `sql_app/main.py` (sql mode)
- Dependency file: `requirements.txt`

## 2) Prerequisites
- Python 3.11+ (recommended)
- pip
- VS Code + Python extension

## 3) VS Code এ run করার ধাপ
1. এই folder VS Code এ open করুন
2. Terminal খুলে virtualenv বানান:
   - `python -m venv .venv`
   - Windows: `.venv\Scripts\activate`
3. dependency install:
   - `pip install -r requirements.txt`
4. backend run (যেকোনো একটি mode):
   - Full mode: `uvicorn server:app --reload --host 0.0.0.0 --port 8000`
   - Simple mode: `uvicorn server_simple:app --reload --host 0.0.0.0 --port 8000`
   - SQL mode: `uvicorn sql_app.main:app --reload --host 0.0.0.0 --port 8000`

## 4) কোন mode কখন
- Full mode: সব business logic + Mongo ভিত্তিক flow
- Simple mode: Mongo ছাড়াই lightweight run
- SQL mode: SQL starter/compat endpoints

## 5) জরুরি endpoint check
- Health: `/api/health` (sql mode)
- Admin system health: `/api/admin/system-health`
- Settings: `/api/settings` and `/api/settings (PUT)`

## 6) কাজ শুরু করার আগে
- `.env.example` দেখে `.env` তৈরি করুন
- কোন mode ব্যবহার করবেন টিমে আগেই ঠিক করুন
- API base URL frontend team-কে জানান

## 7) বুঝতে সহায়তা
- Project flowchart দেখুন: `PROJECT_FLOWCHART.md`
- Core business rules:
  - Commission split
  - Smart cycle
  - Monthly settlement

## 8) একদম নতুন backend developer onboarding path

এই order follow করুন:

1. `README.md`
2. `README_HANDOVER_BN.md` (এই file)
3. `sql_app/main.py`
4. `sql_app/routers/compat.py`
5. `sql_app/routers/directory.py`
6. `sql_app/routers/checkout.py`

## 9) Git এর সাথে মিলিয়ে safe কাজের নিয়ম

কাজ শুরুর আগে:

1. `git fetch origin`
2. `git pull origin main`
3. `git status --short`
4. `git log --oneline -n 10`

কাজ শেষে:

1. changed endpoint গুলো curl/Postman দিয়ে verify
2. frontend side impact থাকলে route/API payload মিলিয়ে দেখুন
3. relevant docs update করুন
4. তারপর commit + push দিন
