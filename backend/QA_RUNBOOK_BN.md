# Backend QA Runbook (Bangla)

এই checklist ধরে backend verify করুন।

## A) Server Up Check
1. backend চালু করুন
2. browser বা API tool থেকে health route check করুন
3. expected: 200 response

## B) Auth + Member Basic
1. নতুন member register
2. login
3. `/api/members` data আসছে কিনা দেখুন
4. expected: new member list-এ দেখা যাবে

## C) Product Flow
1. admin login
2. product create করুন (name, price, stock, description)
3. product edit করুন
4. expected: create/edit এর পর product list update

## D) Order + Reward Base
1. test order place
2. admin থেকে approve
3. expected:
   - order status update
   - reward split/ledger data তৈরি

## E) Settings Rule Check
1. % fields এ 0 দিন
2. split total 100 ছাড়া save ট্রাই করুন
3. expected:
   - 0 allowed (valid fields)
   - split !=100 হলে validation error

## F) System Health
1. `/api/admin/system-health` hit করুন
2. expected:
   - summary object
   - health_items list
   - overall_status

## G) Settlement Preview/Execute (mode dependent)
1. preview endpoint call
2. execute endpoint call
3. expected: mode অনুযায়ী response structure

## H) Evidence Record (manual)
প্রতি step এ note রাখুন:
- endpoint
- request
- response code
- screenshot/file
- pass/fail
