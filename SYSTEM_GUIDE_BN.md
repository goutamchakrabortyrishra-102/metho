# METHO System Guide (Bangla)

এই guide-এর উদ্দেশ্য খুব সহজ:

- folder খুলে ভয় না পাওয়া
- কোন code কোথায় আছে দ্রুত বোঝা
- কোন সমস্যা হলে কোথায় দেখতে হবে জানা
- নতুন developer, operator, owner, বা support person যেন একই document দেখে system ধরতে পারে

যদি আপনি একদম নতুন হন, তাহলে এই file থেকে শুরু করুন।

## 1. এই project আসলে কী?

এই system একসাথে কয়েকটা জিনিস চালায়:

- METHO product sell করা
- partner shop/service directory দেখানো
- member dashboard চালানো
- partner dashboard দিয়ে product/service upload করা
- admin দিয়ে approval, settings, monitoring করা
- Metho Store owner flow চালানো
- image, PDF, invoice, wallet, reward flow handle করা

সহজ ভাষায়:

এটা শুধু একটা website না। এটা commerce + partner + member + admin + media + reward system একসাথে।

## 2. Project-এর 2টা main অংশ

### Frontend

এখানে page, button, form, layout, visible UI থাকে।

Location:

- `src/`

### Backend

এখানে API, database, auth, business rule, file serving, upload logic থাকে।

Location:

- `backend/sql_app/`

## 3. প্রথমে কোন file দেখবেন

এই order-এ দেখলে system দ্রুত বোঝা যায়:

1. `README.md`
2. `SYSTEM_GUIDE.md`
3. `SYSTEM_GUIDE_BN.md`
4. `src/App.js`
5. `src/services/api.js`
6. `backend/sql_app/main.py`

## 4. System কীভাবে কাজ করে

খুব basic flow:

1. user একটা page open করে
2. page backend-এ API call দেয়
3. backend data নিয়ে response দেয়
4. frontend সেই data screen-এ দেখায়

মানে:

page -> API -> backend route -> data -> UI

এটাই almost সব জায়গার basic structure।

## 5. Frontend-এর সবচেয়ে important file

### `src/App.js`

এখানে সব route define করা আছে।

যেমন:

- `/` -> landing page
- `/shop` -> METHO product shop
- `/directory` -> partner directory
- `/metho-store` -> Metho Store listings
- `/partner-shop/:partnerCode` -> public partner shop
- `/gallery/:partnerCode` -> public partner gallery
- `/partner` -> partner dashboard
- `/app/*` -> member/admin dashboard

যদি route বা access behavior বুঝতে চান, এখান থেকেই শুরু করবেন।

### `src/services/api.js`

সব API call এই shared client দিয়ে করা উচিত।

এখানে:

- backend base URL set হয়
- token header attach হয়
- 401 হলে local auth clear হয়

### `src/layouts/DashboardLayout.jsx`

member/admin dashboard-এর sidebar, top bar, menu logic এখানে আছে।

### `src/contexts/AuthContext.jsx`

user login state, user info, logout behavior এখানে থাকে।

### `src/contexts/SettingsContext.jsx`

global settings, branding image, logo, hero image ইত্যাদি load হয়।

### `src/lib/utils.js`

backend URL resolve, asset URL normalize, file/image link build করার মতো কাজ এখানে হয়।

image/PDF problem হলে এটা খুব important file।

## 6. Public pages কোথায় আছে

### `src/pages/LandingPage.jsx`

এই file-এ homepage-এর বড় বড় public section আছে:

- hero section
- best products
- live Metho Store block
- partner finder
- feature sections

### `src/pages/ShopPage.jsx`

এখানে public METHO product shop আছে।

### `src/pages/DirectoryPage.jsx`

এখানে partner shop/service directory আছে।

### `src/pages/MethoStorePage.jsx`

এখানে admin-created Metho Store listing দেখানো হয়।

### `src/pages/PartnerShopPage.jsx`

partner public shop, cart, contact, share, services, product cards এখানে।

### `src/pages/PartnerGalleryPage.jsx`

partner gallery full listing, modal view, cart bar, checkout flow এখানে।

## 7. Dashboard pages কোথায় আছে

সব dashboard pages:

- `src/pages/dashboard/`

important কিছু:

- `DashboardHome.jsx`
- `ProductsPage.jsx`
- `OrdersPage.jsx`
- `SettingsPage.jsx`
- `SystemHealthPage.jsx`
- `MethoStoreAdminPage.jsx`
- `MethoStoreOwnerPage.jsx`

## 8. Partner dashboard কোথায়

### `src/pages/PartnerDashboardPage.jsx`

partner dashboard-এর বড় logic এখানে:

- partner summary
- product upload tab
- featured image
- banner upload
- partner wallet top-up
- QR / UPI settings
- public shop link sharing

### `src/components/PartnerProductForm.jsx`

partner product/service add-edit dialog এখানে।

## 9. Backend কোথা থেকে শুরু করবেন

### `backend/sql_app/main.py`

এই file backend-এর main entry point।

এখানে আছে:

- FastAPI app creation
- CORS
- trusted hosts
- middleware
- router registration
- কিছু starter seed logic

যদি backend app startup behavior বুঝতে চান, এই file আগে দেখুন।

## 10. Backend router map

সব router folder:

- `backend/sql_app/routers/`

### `auth.py`

- login
- register
- current user
- welcome letter PDF

### `commerce.py`

- product/commerce related APIs

### `checkout.py`

- public order logic
- file serving
- upload path recovery

image/PDF/file issue হলে এটা সবচেয়ে important backend file-এর একটা।

### `compat.py`

এই file খুব বড় এবং অনেক feature এখানে জমা আছে।

এর মধ্যে আছে:

- settings update
- admin uploads
- partner upload support
- wallet/payout related compatibility logic
- mixed business flows

### `directory.py`

- public partner directory
- filter data
- featured partner list

### `partner_public.py`

- partner public data APIs

### `settings.py`

- settings load/save helpers

### `health.py`

- health / monitoring APIs

## 11. কোন problem হলে কোথায় দেখবেন

### UI / layout problem

দেখবেন:

- `src/pages/...`
- `src/components/...`
- `src/layouts/...`

### data wrong আসছে

দেখবেন:

- page-এর API call
- `src/services/api.js`
- backend router file

### role/access wrong

দেখবেন:

- `src/App.js`
- route guard
- backend role validation

### image/PDF/file 404

দেখবেন:

- `src/lib/utils.js`
- `src/contexts/SettingsContext.jsx`
- `backend/sql_app/routers/checkout.py`
- actual uploaded file path

### partner data আর Metho Store data mix হয়ে গেছে

দেখবেন:

- `src/services/methoStore.js`
- landing page section source
- `/directory/partners` fallback accidentally use হচ্ছে কিনা

## 12. Role model সহজ ভাষায়

main role:

- `member`
- `partner`
- `admin`
- `company_admin`
- `super_admin`
- `store_owner` / `metho_store_owner` / `owner`

quick meaning:

- member -> member dashboard use করে
- partner -> partner dashboard use করে
- admin -> approval/settings/control pages use করে
- store owner -> Metho Store owner side use করে

## 13. Common task অনুযায়ী file map

যদি কেউ বলে:

### "landing page change করতে হবে"

দেখুন:

- `src/pages/LandingPage.jsx`

### "partner shop/cart/gallery ঠিক করতে হবে"

দেখুন:

- `src/pages/PartnerShopPage.jsx`
- `src/pages/PartnerGalleryPage.jsx`

### "partner upload form change করতে হবে"

দেখুন:

- `src/components/PartnerProductForm.jsx`

### "admin settings / branding image / logo"

দেখুন:

- `src/pages/dashboard/SettingsPage.jsx`
- `src/contexts/SettingsContext.jsx`

### "media file serve হচ্ছে না"

দেখুন:

- `src/lib/utils.js`
- `backend/sql_app/routers/checkout.py`

### "Metho Store আর partner listing আলাদা রাখতে হবে"

দেখুন:

- `src/services/methoStore.js`
- `src/pages/MethoStorePage.jsx`
- `src/pages/LandingPage.jsx`

## 14. Safe কাজের নিয়ম

এই project-এ blind edit করলে ভুল হওয়ার chance বেশি। তাই সবসময় এই rule follow করুন:

1. page কোন API call করছে দেখুন
2. backend কোন route সেটা দেখুন
3. data save কোথায় হচ্ছে দেখুন
4. render condition আছে কিনা দেখুন

একটা field change করলে 4 জায়গা check করুন:

1. input form
2. API payload
3. backend save logic
4. UI output

## 15. Deploy/simple workflow

frontend local run:

1. `npm install`
2. `npm start`
3. `npm run build`

frontend deploy history এই repo-তে mainly Cloudflare Pages oriented।

backend hosted behavior recent work-এ Render-এর দিকে ছিল।

## 16. সবচেয়ে important reality

এই system-এ অনেক bug code logic থেকে না, data/source confusion থেকে আসে।

যেমন:

- wrong endpoint use
- partner data আর Metho Store data mix
- old uploaded image path
- role gate mismatch
- frontend hide করেছে কিন্তু backend allow করছে

তাই fix করার সময় শুধু UI না, data source-ও verify করবেন।

## 17. যদি খুব কম সময় থাকে

তাহলে অন্তত এই 5টা file দেখুন:

1. `src/App.js`
2. `src/services/api.js`
3. `src/pages/LandingPage.jsx`
4. `backend/sql_app/main.py`
5. `backend/sql_app/routers/checkout.py`

## 18. এক লাইনের summary

METHO হলো এমন একটি React + FastAPI system যেখানে public shopping, partner commerce, member dashboard, admin control, store owner flow, image/PDF/media handling, এবং reward logic একসাথে কাজ করে।
