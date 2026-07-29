# COMPREHENSIVE BUSINESS FLOW TEST CHECKLIST

**Date:** 2026-07-28
**Tester:** AI Agent
**Frontend:** https://cd2ecaaa.metho-bmz.pages.dev
**Backend:** https://metho-backend.onrender.com

---

## 1. ADMIN FLOWS

### 1.1 Partner Management (Admin → Partners)
- [ ] Load Associate Partners page
- [ ] View active partner count (33/33)
- [ ] View total partner sales (₹0)
- [ ] View commission collected (₹579.8)
- [ ] Select partner from dropdown
- [ ] View selected partner actions dropdown
- [ ] Test Delete Demo/Test Partners button
  - [ ] Click "Delete Demo/Test Partners"
  - [ ] Confirm dialog appears
  - [ ] Type "DELETE_DEMO_PARTNERS" exactly
  - [ ] Verify success message shows deleted count
  - [ ] Verify partner list refreshes

### 1.2 Product Management (Admin → Products)
- [ ] View product list
- [ ] Create new product
  - [ ] Single product form
  - [ ] Add to cart (stock validation)
  - [ ] Verify can't exceed stock
- [ ] Bulk product import
  - [ ] Upload CSV/JSON
  - [ ] Verify associate_partner type requires partner_id
- [ ] Edit existing product
- [ ] Delete product
- [ ] View product stock levels

### 1.3 Member Management (Admin → Members)
- [ ] View all members
- [ ] Search member by code/name
- [ ] View member details
- [ ] View member balance
- [ ] Check member role (regular/leader)

### 1.4 Order Management (Admin → Orders)
- [ ] View all orders
- [ ] Filter by status
- [ ] View order details
- [ ] Process order

### 1.5 Commission & Payouts (Admin → Settlement)
- [ ] View monthly commission summary
- [ ] View commission breakdown by partner
- [ ] Verify commission calculation accuracy

---

## 2. MEMBER FLOWS

### 2.1 Smart Cycle™ (Member Dashboard → Smart Cycle)
- [ ] Load Smart Cycle page
- [ ] Verify no loading error
- [ ] View personal cycle level
- [ ] View commission percentage
- [ ] View pool allocation percentages (5 pools)
- [ ] Verify commission earnings displayed

### 2.2 Member Rewards (Member Dashboard)
- [ ] View member reward balance
- [ ] View reward history
- [ ] Claim available rewards
- [ ] Verify reward deduction logic

### 2.3 Member Wallet (Member Dashboard → Wallet)
- [ ] View wallet balance
- [ ] View transaction history
- [ ] View statement/export functionality
- [ ] Verify wallet updates after purchases

### 2.4 Member Referral (Member Dashboard → Referral)
- [ ] View referral code
- [ ] View referred members count
- [ ] View referral commission
- [ ] Copy/share referral link

---

## 3. PARTNER FLOWS

### 3.1 Partner Dashboard (Partner Dashboard)
- [ ] Load partner dashboard
- [ ] View overview metrics
  - [ ] Total sales
  - [ ] Active products
  - [ ] Commission earned
  - [ ] Pending payouts

### 3.2 Partner Gallery Upload (Partner → Product Upload)
- [ ] Upload new product/service
- [ ] Add product to own gallery
- [ ] Set price & stock
- [ ] Add product image
- [ ] Verify product appears in gallery
- [ ] Add gallery items to cart
  - [ ] Verify stock validation
  - [ ] Can't add more than available stock

### 3.3 Partner Wallet Top-Up (Partner Dashboard)
- [ ] View wallet balance
- [ ] Click "Top-Up Wallet"
- [ ] Enter amount
- [ ] Select payment method (UPI/Razorpay)
- [ ] Complete payment
- [ ] Verify wallet balance updates

### 3.4 Partner Shop (Partner → Shop View)
- [ ] View own gallery in shop
- [ ] Verify partner name/branding
- [ ] View commission earned from shop sales
- [ ] Check partner rating/reviews

### 3.5 Partner Payout (Partner Dashboard → Payout Statement)
- [ ] View pending payout amount
- [ ] View payout history
- [ ] Initiate payout request
- [ ] Verify payout status tracking

---

## 4. GUEST & MEMBER SHOPPING FLOWS

### 4.1 Product Browsing (Shop Page)
- [ ] Load shop page
- [ ] View all products/partners
- [ ] Filter by category
- [ ] Search for product
- [ ] View product details
- [ ] View partner info

### 4.2 Service Booking (Shop → Services)
- [ ] View available services
- [ ] Select service
- [ ] Choose date/time slot
- [ ] View service details
- [ ] Add service to cart

### 4.3 Guest Cart (Shop → Cart)
- [ ] Add product to cart
- [ ] Add service to cart
- [ ] Update product quantity
  - [ ] Verify stock limit enforcement
  - [ ] Auto-clamp if stock reduced
- [ ] Remove item from cart
- [ ] View cart total

### 4.4 Checkout Flow (Cart → UPI Payment Dialog)
- [ ] View cart summary
- [ ] Verify shipping address required for products
- [ ] Verify shipping address NOT required for services-only
- [ ] Enter shipping address (if needed)
- [ ] Select payment method
  - [ ] UPI option available
  - [ ] Razorpay option available (if enabled)
- [ ] Enter amount
- [ ] Complete payment
- [ ] Verify order confirmation

### 4.5 Member Purchase Flow
- [ ] Same as 4.1-4.4
- [ ] Verify reward credit added to member account
- [ ] Verify commission added to partner account
- [ ] Verify member balance updated

---

## 5. COMMISSION & POOL FLOWS

### 5.1 Direct Partner Commission
- [ ] Partner makes sale
- [ ] Commission % based on Smart Cycle level
- [ ] Verify commission added to partner wallet
- [ ] Verify admin sees commission in summary

### 5.2 Matching Bonus Pool (Pool 1)
- [ ] Verify matching bonus criteria met
- [ ] Verify bonus added to pool allocation
- [ ] Verify member reward generated

### 5.3 Leader Reward Pools (Pools 2-5)
- [ ] Verify leader bonus calculation
- [ ] Verify team performance aggregation
- [ ] Verify reward distribution to team members
- [ ] Verify leader gets designated percentage

### 5.4 Pool Distribution
- [ ] Pool 1: Matching Bonus (%) 
- [ ] Pool 2: Leader Reward - Direct (%)
- [ ] Pool 3: Leader Reward - Team (%)
- [ ] Pool 4: Overflow Pool (%)
- [ ] Pool 5: MLM/Network Pool (%)
- [ ] Verify total = 100%

---

## 6. ASSOCIATE PARTNER FEATURES

### 6.1 Partner Product Linking
- [ ] Create product as associate_partner type
- [ ] Verify partner_id is mandatory
- [ ] Product appears in partner's gallery
- [ ] Partner can edit their products
- [ ] Partner cannot see other partners' products

### 6.2 Partner Commission Structure
- [ ] Partner receives commission on direct sales
- [ ] Verify commission % matches contract/level
- [ ] Verify commission doesn't double-count

---

## 7. ERROR HANDLING & EDGE CASES

### 7.1 Stock Management
- [ ] Product stock = 0 → can't add to cart
- [ ] Product stock = 5 → can only add max 5
- [ ] Stock reduced while in cart → auto-clamp and show message
- [ ] Stock increased → can add more

### 7.2 Payment Errors
- [ ] Invalid payment gateway response → show error, allow retry
- [ ] Network timeout → show error, allow retry
- [ ] Insufficient wallet balance → show error
- [ ] Payment successful but order creation fails → handle gracefully

### 7.3 Form Validation
- [ ] Empty required fields → show error
- [ ] Invalid email/phone → show error
- [ ] Mismatched password → show error
- [ ] Partner delete confirmation text mismatch → show helpful error with typed text

### 7.4 Authentication
- [ ] Unauthorized access to admin pages → redirect to login
- [ ] Unauthorized access to partner dashboard → show access denied
- [ ] Session expiry → redirect to login
- [ ] Invalid token → clear and redirect

---

## 8. CRITICAL DATA ACCURACY CHECKS

- [ ] Smart Cycle level = commission %
- [ ] Commission = sale amount × member level %
- [ ] Pool percentages sum to 100%
- [ ] Wallet balance = opening + credits - debits
- [ ] Partner sales count = confirmed orders
- [ ] Member reward balance = earned - claimed

---

## TEST EXECUTION NOTES

**Status:** ⏳ Pending (Backend offline - awaiting service restart)
**Last Updated:** 2026-07-28 16:55
**Blockers:** Backend API connectivity (https://metho-backend.onrender.com)

**To Run Full Test:**
1. Ensure backend is online and responding
2. Access frontend at https://cd2ecaaa.metho-bmz.pages.dev
3. Login with test credentials
4. Follow sections 1-8 above
5. Document any failures with screenshots
6. Report findings

---
