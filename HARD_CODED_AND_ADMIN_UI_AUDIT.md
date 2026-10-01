# Hardcoded Data / Settings and Admin UI Audit

Audit source: the uploaded project snapshot only. This audit intentionally separates runtime business data that should be DB/API driven from stable application enums, validation rules, seed/bootstrap data, environment configuration, and purely decorative demo content.

## 1. Runtime hardcoding fixed in this update

| Area | Previous state | Update |
|---|---|---|
| Storefront categories | `ExploreMenu` still depended on `assets.js -> menu_list` for the known category set/order | Category existence/order now comes only from current available products returned by `/api/products`. `All` remains the only fixed category. |
| Category images | Category identity and imagery were coupled in `menu_list` | `assets.js` now exposes only `category_images` as optional visual metadata. Existing eight category images are preserved; they no longer create categories. |
| New category fallback | Categories without a legacy image needed an explicit frontend entry for a polished result | The first product image in that category is used when available; otherwise a neutral first-letter fallback tile is rendered. |
| Category filtering | Client/server comparisons could be case-sensitive | Client discovery normalizes category text; `/api/products?category=` uses PostgreSQL case-insensitive equality. |
| New Admin product category | Empty catalog defaulted the category field to hardcoded `Salad` | New products start with the first existing category when one exists, otherwise the field is blank and accepts a new category. |
| Currency label in coupon form | `Minimum order (USD)` was literal UI copy | Label now uses `VITE_CURRENCY`, matching the frontend formatter fallback. |
| Admin delivery-zone currency fallback | Literal `BDT` fallback | Uses API currency first, then `VITE_CURRENCY`, then `USD`. |

The Admin product save/archive flow already calls `refreshProducts()`. The StoreContext now also refreshes public products/store status every 60 seconds, on window focus, and when the tab becomes visible. Therefore a category created by Admin can appear in the storefront without a frontend code change/redeploy.

## 2. Runtime data already correctly DB/API driven — keep dynamic

No change is needed for these areas: products and product availability; product variants/add-ons; product/option inventory; reviews; wishlists; orders and status history; guest checkout records; saved addresses; delivery zones/fees/minimums/free-delivery rules; store opening hours/closures/timezone/cancellation windows; scheduled delivery/pickup settings and slot overrides; loyalty rules/balances/transactions; coupons; manual payment channels/submissions; gateway payment ledger/refunds; notifications and delivery history; analytics; monitoring event data; Admin customer/activity data; KDS workload; invoices/receipts. These are backed by Prisma models and/or server APIs in the current project.

## 3. Hardcoded business/content values that should become DB/API driven if the site is meant to be editable/white-label

These are real hardcoded values, but moving them now would require a new restaurant/public-profile configuration model and a production-safe migration. That is deliberately not mixed into this UI/category repair.

| File / area | Hardcoded value | Recommendation |
|---|---|---|
| `components/Footer/Footer.jsx` | phone, `hello@tomato.example`, `Dhaka, Bangladesh`, social placeholders, information labels | Add a public restaurant profile/settings API for contact address, phone, email, social URLs and editable footer links. The current social icons are non-link spans. |
| `components/Header/Header.jsx` | `30 min` average delivery and `4.9` rating | Derive from measured fulfilment analytics / published review aggregate, or expose controlled marketing metrics in restaurant settings. Do not present them as live metrics while literal. |
| Brand/SEO/auth/email copy across frontend/server | `Tomato`, restaurant name/copy | For a single-brand product this can remain application content. For white-label operation, store brand name, description, logo/OG image and SEO profile in public restaurant settings and expose them to both frontend and email/document services. |
| `pages/PlaceOrder/PlaceOrder.jsx`, `pages/Addresses/Addresses.jsx` | default country `Bangladesh` | If multi-country use is required, make default country part of public restaurant/checkout settings. Existing saved/order country remains user/database data. |
| `services/payment.js` | fallback city/state `Dhaka`, country `Bangladesh`, postcode `0000`, generic food category | Prefer actual order fields and a configured restaurant profile for provider-required fallbacks. This needs coordinated payment/profile changes, not a CSS-only patch. |
| `services/order-documents.js`, cancellation/order-time helpers | fallback timezone `Asia/Dhaka`, pickup text, restaurant email-from name fallback | Restaurant timezone is already DB-backed in normal operation; consolidate exceptional fallbacks around restaurant/public profile configuration. |

## 4. Environment/build configuration — should remain environment-driven, not moved to DB

The current split is appropriate for deployment/security values: `VITE_API_URL`, `VITE_SITE_URL`, `VITE_CURRENCY`, `VITE_GOOGLE_CLIENT_ID`, `DATABASE_URL`, JWT/auth encryption secrets, `CLIENT_ORIGIN`, `PUBLIC_API_URL`, `GOOGLE_CLIENT_ID`, `PAYMENT_CURRENCY`, SSLCOMMERZ credentials/environment, Cloudinary credentials/folder, SMTP credentials/from address, VAPID keys/subject, bootstrap Admin credentials, and monitoring thresholds.

`front-end/src/lib/seo.js` contains a fallback Vercel site URL. Production should set `VITE_SITE_URL`; this is deployment configuration rather than database data. `VITE_CURRENCY` and backend `PAYMENT_CURRENCY` must represent the same store currency.

## 5. Seed/bootstrap/default data — hardcoded by design; do not turn into runtime UI data

`server/prisma/seed.js` contains the original demo food catalogue/categories and bootstrap defaults. Those values are only seed/bootstrap data and are not a valid storefront source of truth. They were not changed. Prisma schema defaults such as status defaults, initial loyalty/fulfilment numbers and `Asia/Dhaka` are persistence/bootstrap defaults; live settings remain editable through existing APIs where implemented.

No existing Prisma migration was edited, deleted or regenerated in this update.

## 6. Stable application enums / workflow constants — keep in code unless the workflow itself becomes configurable

These include order status transitions, KDS lanes, payment/review/status filter choices, inventory adjustment reasons, notification event types, dietary filter keys, product sort choices, variant/add-on kinds, manual-payment provider enum (`BKASH`, `NAGAD`, `ROCKET`, `BANK`), analytics export report types, route/navigation labels, validation limits, ETA/prep quick presets, icon path definitions and PWA benefit copy. They describe application behavior, not missing database records.

If manual-payment providers are later made extensible, the frontend list and server validation/schema must be changed together; only making the dropdown dynamic would be unsafe.

## 7. Decorative/demo-only hardcoding — safe if intentionally illustrative

`components/AppDownload/AppDownload.jsx` contains a non-interactive phone mockup (`aria-hidden`) with `Dhanmondi, Dhaka`, Pizza/Burger/Rice/Drinks, sample dishes/prices, order `#1287`, times and ETA. This is promotional artwork rather than live operational data. Keep it as illustrative content, or redesign it to render live data only if the marketing mockup is expected to mirror the current menu.

## 8. Admin responsive/layout audit and fixes

The audit covered all Admin pages/components, with emphasis on table width ownership, nested grid minimum sizing, wrapping, card headers, long text, actions, badges, toolbar filters, forms, save bars, dialogs, sidebar/content width and horizontal scrolling.

### Fixes implemented

- Product table: explicit data-table width plus a real minimum width for the Product column; description wraps and clamps to two lines instead of collapsing vertically.
- Other data-heavy tables: page-specific minimum widths for Customers, Orders, Activity, Coupons, Dashboard recent orders, Analytics, Notifications, Monitoring, Payments and refund reconciliation. Narrow screens scroll the table wrapper instead of squeezing columns into unusable widths.
- Table action groups: wrap safely while retaining a usable intrinsic width.
- Monitoring: Runtime/integrations and event mix now use a shared body wrapper with consistent padding/gaps; nested items have `min-width: 0` and long source/integration text can wrap.
- Store Hours and Scheduling: former floating/sticky save bar is now a card footer, eliminating overlap/offset problems. At <=620px it stacks copy above a full-width save button.
- Payments: SSLCOMMERZ health card now has a structured heading/status row, wrapping metadata row, non-wrapping currency chip and break-safe callback URL.
- Loyalty and Delivery Zones: KPI items were missing the shared `admin-card metric-card` classes; fixed so they use the same responsive metric layout as other Admin pages.
- Header/card/toolbars/forms: flex/grid children receive correct `min-width: 0`, long helper text wraps, page/header actions wrap, and filters become full-width on small screens.
- Sidebar/content: drawer switch is at 1040px so the fixed 264px sidebar does not squeeze 1024px content. Sidebar nav itself scrolls vertically when needed.
- Dialogs: overlay owns vertical scrolling, wide/long modal contents no longer create nested vertical scroll traps; mobile dialogs become bottom sheets with full-width footer buttons.
- Complex editors/KDS/analytics/inventory: inner grids can shrink, and deliberate data-heavy rows use their own horizontal scroll containers where needed.

### Target viewport behavior

- 1366x768: fixed sidebar + full workspace; data tables keep readable columns and scroll only inside the table wrapper where needed.
- 1024x768/tablet: drawer navigation activates; content gets the full viewport width; two-column Admin grids collapse to one column.
- 390/360/320px: page/header actions and toolbars stack; metric grids become one column; save bars stack; forms use one-column global `field-grid`; cards/dialogs remain within the viewport; wide tables/editors remain intentionally horizontally scrollable inside their own wrappers.

The fixes are component/page scoped. No catch-all global `overflow-x:hidden` patch or arbitrary global table compression was added as a substitute for correcting the offending layouts.

## 9. Follow-up candidates (not required for this patch)

1. Add a `RestaurantProfile`/public-settings model for brand/contact/address/social/SEO defaults if Admin-editable storefront identity is desired.
2. Replace literal hero delivery/rating marketing numbers with measured API aggregates or remove the numerical claim.
3. Consolidate country/payment-provider fallback profile data so SSLCOMMERZ fallbacks never rely on literal Dhaka/Bangladesh values.
4. If category-specific artwork should be Admin-managed, add a Category model (name, image, sort order, active). Until then the requested behavior is correctly product-derived, with legacy/fallback imagery only.
