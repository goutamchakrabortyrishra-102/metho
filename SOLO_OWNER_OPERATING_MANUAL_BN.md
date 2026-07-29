# SOLO OWNER OPERATING MANUAL (Bangla)

এই ম্যানুয়াল এমনভাবে লেখা হয়েছে যাতে code না বুঝলেও business একা চালাতে পারেন।
Logic change না করে safe operation, routine checking, আর জরুরি সময়ে কী করবেন - সব এক জায়গায়।

Related document:

1. Technical execution map: TECHNICAL_EXECUTION_PLAN_BN.md

## 1) Operating Principle

1. একবারে একটাই change করবেন।
2. change করার আগে evidence (screenshot/note) রাখবেন।
3. change করার পরে verification না করে পরের step-এ যাবেন না।
4. build fail হলে deploy করবেন না।
5. production-এ test করতে হলে small amount / limited flow দিয়ে শুরু করবেন।

## 2) Daily Checklist (15-20 min)

### Morning Check

- [ ] Admin login সফল
- [ ] New orders count vs yesterday close count
- [ ] Pending withdrawals count
- [ ] Failed payment / rejected order আছে কিনা
- [ ] Dashboard summary value অস্বাভাবিক spike/dip আছে কিনা

### Midday Check

- [ ] Pending partner/product approvals clear
- [ ] Withdrawal queue review (pending > approved/rejected)
- [ ] 1টি sample invoice open করে buyer/member data ঠিক আছে কিনা

### Night Close

- [ ] Wallet transaction history-তে negative/duplicate entry আছে কিনা
- [ ] Settlement/reward pages load হচ্ছে কিনা
- [ ] আজকের action 5 লাইনে লিখে রাখুন (date + what changed + result)

## 3) Weekly Checklist (60-90 min)

### Finance Reconciliation

- [ ] Paid orders total এবং wallet inflow basic match
- [ ] Withdrawal approved total এবং payout record match
- [ ] Refund/reject cases cross-check

### Reward + Genealogy Health

- [ ] 10টি random member-এ reward/points abnormal কিনা
- [ ] Smart Cycle history open করে bonus/leader match value show হচ্ছে কিনা
- [ ] 5টি new referral sample এ genealogy parent mapping ঠিক আছে কিনা

### Platform Health

- [ ] Frontend page load test (Home, Login, Register, Wallet, Admin pages)
- [ ] API availability quick test (settings/health)
- [ ] Error spike থাকলে note করে রাখুন

## 4) Monthly Checklist (Month Close)

- [ ] Monthly settlement run/verify
- [ ] Withdrawal dispute close
- [ ] Statement export archive
- [ ] Settings snapshot (commission, split, cycle values) archive
- [ ] Backup restore test (একবার)

## 5) Withdrawal Control SOP (5% TDS + 3% Admin Charge)

Target model:

- Gross amount = member requested amount
- TDS = Gross × 5%
- Admin Charge = Gross × 3%
- Net Payout = Gross - TDS - Admin Charge

Operational checks:

- [ ] Member form-এ estimated deduction দেখাচ্ছে
- [ ] Admin queue-তে gross/tds/admin/net breakdown দেখাচ্ছে
- [ ] Statement-এ withdrawal summary দেখাচ্ছে

Mismatch হলে:

1. একই withdrawal ID note করুন
2. member screenshot + admin screenshot নিন
3. payout final amount compare করুন
4. issue list-এ add করুন (date, withdrawal id, expected net, actual net)

## 6) Emergency SOP (If Something Goes Wrong)

### A) Payment/Withdrawal anomaly

1. নতুন payout temporary hold করুন
2. affected IDs list করুন
3. last good state note করুন
4. 1টি corrected test flow verify না হওয়া পর্যন্ত mass action বন্ধ রাখুন

### B) Site চলছে না

1. frontend URL open test
2. backend health/settings endpoint test
3. last deploy time note
4. urgent হলে last stable release-এ rollback plan নিন

### C) Wrong settings changed

1. settings snapshot compare
2. old value restore
3. 1টি sample flow validate

## 7) Security Rules (Must Follow)

1. একটাই super-admin account রাখুন
2. password manager ব্যবহার করুন
3. email account-এ 2FA mandatory
4. key/secret chat বা screenshot-এ শেয়ার করবেন না
5. sensitive key rotate quarterly

## 8) Technical Work You Must Arrange (Minimal but Mandatory)

এগুলো business owner হিসেবে approve করবেন; কাজটি technical person/assistant দিয়ে করাতে হবে:

1. Backend secret exposure বন্ধ করা
2. Razorpay live key secret rotate করা
3. Audit log retention + backup automation
4. Database daily backup + monthly restore drill
5. Monitoring alert (API down, payment failure spike)

## 9) Command Cheatsheet (For Technical Run)

Project folder: C:/Users/pc/Desktop/Metho-Frontend

1. Install dependencies
   npm install
2. Run local
   npm start
3. Build check
   npm run build
4. Deploy frontend (Cloudflare Pages)
   npx wrangler pages deploy build --project-name metho --branch main

## 10) One-Page Daily Log Template

Date:

1. Orders check result:
2. Withdrawals check result:
3. Reward/genealogy check result:
4. Issue found (if any):
5. Action taken:
6. Pending for tomorrow:

---

এই ম্যানুয়াল follow করলে staff ছাড়া solo operation অনেক stable থাকবে।
