# TECHNICAL EXECUTION PLAN (Bangla)

এই plan আপনার জন্য owner-level execution map।
আপনি code না বুঝলেও এই document দেখে কাজ assign, approve, এবং verify করতে পারবেন।

## 1) Objective

1. Existing business logic না বদলে system harden করা
2. Security risk কমানো
3. Solo operation stable করা
4. Issue হলে দ্রুত recover করতে পারা

Related backend spec:

1. BACKEND_OWNER_GUIDE_API_SPEC_BN.md

## 2) Priority Roadmap

### P0 (আজই / 24 ঘন্টার মধ্যে)

1. Secret exposure বন্ধ
2. Razorpay secret rotate
3. Admin account hardening

### P1 (এই সপ্তাহে)

1. Backup automation
2. Monitoring + alert
3. Withdrawal reconciliation report habit

### P2 (এই মাসে)

1. Monthly restore drill
2. Incident playbook dry run
3. Access review cleanup

## 3) Task-by-Task Owner Execution Sheet

## Task A: Backend secret exposure fix

Purpose:
Public API response-এ sensitive keys যেন না আসে

Access needed:
1. Backend code/repo access
2. Render environment settings access

Owner instruction to technical person:
1. Public settings response থেকে secret fields remove করতে হবে
2. Secret শুধু server environment থেকে read হবে
3. Any client-facing endpoint-এ secret return করা যাবে না

Time estimate:
2-4 hours

Completion proof (আপনি যা চাইবেন):
1. Before/after API response screenshot
2. Endpoint check output যেখানে secret আর দেখা যায় না
3. Short change note (কি remove করা হয়েছে)

Acceptance check (owner):
1. Settings endpoint open করে verify: secret field blank বা absent

## Task B: Razorpay key rotation

Purpose:
Compromised বা leaked secret invalid করা

Access needed:
1. Razorpay dashboard owner access
2. Render env update access

Owner instruction to technical person:
1. New key pair create
2. Backend env-এ নতুন secret set
3. Old secret revoke
4. Test payment + verify webhook

Time estimate:
1-2 hours

Completion proof:
1. Rotation timestamp
2. Test payment success screenshot
3. Old key revoked confirmation

Acceptance check (owner):
1. 1 small payment success
2. 1 failed case fallback message expected

## Task C: Admin account hardening

Purpose:
Single-owner unauthorized access risk কমানো

Access needed:
1. Admin panel account control
2. Email account security settings

Owner instruction:
1. একটাই super-admin রাখুন
2. Strong unique password set করুন
3. Email account 2FA mandatory
4. Shared password habits বন্ধ

Time estimate:
30-60 minutes

Completion proof:
1. Active admin list screenshot
2. 2FA enabled confirmation screenshot

Acceptance check (owner):
1. শুধুমাত্র আপনার account দিয়ে admin login হয়

## Task D: Daily database backup automation

Purpose:
Data loss হলে দ্রুত recover

Access needed:
1. Database server access
2. Scheduler (cron/job runner)
3. Backup storage (secure bucket/drive)

Owner instruction:
1. Daily automatic backup schedule
2. Backup retention policy (কমপক্ষে 14-30 দিন)
3. Backup completion alert

Time estimate:
3-5 hours

Completion proof:
1. Backup job schedule screenshot
2. 3 consecutive daily backup artifact list

Acceptance check (owner):
1. গত 3 দিনের backup file list present

## Task E: Monthly restore drill

Purpose:
Backup usable কিনা real test

Access needed:
1. Staging/test DB
2. Latest backup file

Owner instruction:
1. Restore করে app boot test করতে হবে
2. Critical screens open test করতে হবে

Time estimate:
2-3 hours monthly

Completion proof:
1. Restore start/end time
2. Restored environment screenshot
3. Pass/fail checklist

Acceptance check (owner):
1. Login + wallet + orders + withdrawals page open success

## Task F: Monitoring and alert

Purpose:
Problem হলে আগে থেকে notice পাওয়া

Access needed:
1. Uptime monitor tool
2. Notification channel (email/WhatsApp/Telegram)

Owner instruction:
1. Frontend URL health monitor
2. Backend health endpoint monitor
3. Alert trigger: downtime, high failure rate

Time estimate:
1-2 hours

Completion proof:
1. Monitor dashboard screenshot
2. Test alert received screenshot

Acceptance check (owner):
1. Test alert ফোন/ইমেইলে আসে

## 4) Weekly Owner Verification Script (Non-technical)

1. Payment test
1. 1টি small order করুন
2. payment success confirm করুন
3. invoice open check করুন

2. Withdrawal test
1. 1টি small withdrawal request
2. admin queue-তে request visible কিনা
3. deduction breakdown দেখাচ্ছে কিনা

3. Reward/Genealogy sanity
1. smart cycle page load
2. genealogy tree load
3. wallet transaction list normal

## 5) Sign-off Template (Owner Use)

Task name:

Assigned to:

Start date:

Completion date:

Proof received:
1.
2.
3.

Owner acceptance:
- [ ] Pass
- [ ] Rework needed

Notes:

## 6) Red-Flag Conditions (Immediate Freeze)

এই যেকোনো একটি হলে নতুন payout/major change hold করুন:

1. Payment success but invoice missing
2. Withdrawal net amount mismatch without explanation
3. Same transaction duplicate credit/debit
4. Admin unknown login activity
5. Backup job fail 2 দিন consecutively

## 7) Recommended Sequence (Exactly Follow)

1. Task A -> Task B -> Task C
2. তারপর Task D -> Task F
3. তারপর Task E monthly schedule

এই sequence follow করলে risk দ্রুত কমে, আর business downtime ছাড়াই stable হয়।
