# Step 14 verification — analytics and CSV exports

## Pre-deploy

```bash
npm ci
npm run db:generate -w server
node --test server/test/admin-analytics.test.js
npm test
npm run build
```

No Step 14 database migration is required.

## Admin analytics

1. Sign in as an administrator and open **Admin → Analytics**.
2. Confirm 7, 30 and 90 day presets load successfully.
3. Apply a valid custom From/To range and confirm the heading reports the configured restaurant timezone.
4. Try a custom range longer than 366 days; the server must reject it.
5. Confirm Recognized revenue and AOV use delivered orders only.
6. Confirm cancellation rate and order-status mix use orders placed during the selected period.
7. Deliver a test order and verify revenue/product/category/customer metrics increase after refresh.
8. Cancel an order and verify it does not contribute to recognized revenue/product sales.
9. Confirm guest-origin orders affect Guest order share, including a guest order that was later securely linked to an account.
10. Confirm Delivery/Pickup and ASAP/Scheduled mixes reflect the selected period.
11. Verify top products include configured variant/add-on line revenue from Step 10.
12. Verify low-velocity active products can show zero units sold.
13. Confirm Top rated/review-derived values only reflect published reviews.
14. Verify the layout on desktop, tablet and mobile.

## CSV exports

1. Export Daily sales CSV and verify the filename contains the selected date range.
2. Export Orders CSV and confirm it contains only orders placed within the selected range.
3. Export Products CSV and confirm current stock/availability plus period units/revenue are included.
4. Export Customers CSV and confirm account status, points and range order/revenue metrics are included.
5. Confirm export responses use `text/csv`, `private, no-store`, and attachment filenames.
6. Check **Admin → Activity log** for `ANALYTICS_CSV_EXPORTED` after an export.
7. Verify a non-admin user receives `403` for analytics and export endpoints.
8. Verify exported names/emails beginning with `=`, `+`, `-` or `@` are prefixed safely when opened as CSV.

## Regression

Recheck customer browsing/search, cart customizations, inventory reservations, Guest Checkout/private tracking, saved addresses/reorder, payments, reviews, Tomato Points, notifications, scheduling, delivery zones and PWA install/offline behavior. Step 14 is read-only apart from export audit-log entries.
