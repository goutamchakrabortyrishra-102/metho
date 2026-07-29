# Frontend QA Runbook (Bangla)

এই checklist ধরে frontend verify করুন।

## A) App Launch
1. `npm start`
2. app open: `http://localhost:3000`
3. expected: login/landing loads without crash

## B) Login + Role Access
1. member login
2. admin login
3. expected:
   - role অনুযায়ী menu দেখাবে
   - admin pages non-admin এ block

## C) Product UI
1. Products page open
2. add/edit dialog test
3. description field লিখে save
4. expected: product card/list এ reflect

## D) Partner Product UI
1. partner dashboard open
2. add/edit product
3. image upload + description
4. expected: partner list/gallery তে update

## E) Share Features
1. referral card থেকে copy/share
2. WhatsApp share button test
3. partner product share test
4. expected: link/message generated correctly

## F) Invoice UI
1. order invoice page open
2. print/download/share action test
3. expected: PDF/download/share flow works

## G) System Health Page
1. admin থেকে System Health page open
2. initial load check
3. 30 sec wait করে auto refresh observe
4. manual Refresh button click
5. expected:
   - data auto update
   - manual refresh also works

## H) Member Page
1. members list open
2. search by name/code/email
3. expected: filter works

## I) Final UX Note
- কোন page slow/crash হলে route + console error note করুন
- pass/fail sheet maintain করুন
