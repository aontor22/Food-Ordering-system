# Step 14 — Admin analytics and CSV exports

Step 14 adds an admin-only analytics workspace at **Admin → Analytics**. It does not add or alter database tables, so there is no Step 14 Prisma migration. Existing Step 13 and earlier migrations remain the production schema baseline.

## Reporting rules

- Reporting uses the restaurant timezone stored in `RestaurantSetting.timezone` (default `Asia/Dhaka`).
- Preset ranges are 7, 30 and 90 days. Custom ranges are inclusive and capped at 366 days.
- **Recognized revenue** includes orders whose current status is `DELIVERED` and buckets them by `deliveredAt` (falling back to status/update timestamps for legacy rows).
- Orders placed, cancellation rate, fulfillment mix and scheduling mix are based on order creation during the selected range.
- Guest share uses the immutable `customerType` provenance from Step 09. A guest-origin order remains identifiable as guest-origin after secure account linking.
- Product and category performance uses `OrderItem` quantity and line revenue from delivered orders in the selected range. This means Step 10 size/add-on price deltas are included in product revenue.
- Ratings come from `PUBLISHED` verified-purchase reviews. Wishlist saves use current wishlist counts.
- Low-velocity products include active products with zero delivered units in the selected range so unsold products remain visible.

## CSV exports

The analytics page can export:

1. Daily sales
2. Orders
3. Products
4. Customers

Exports are admin-authenticated, use the selected date range, are rate-limited, return `Cache-Control: private, no-store`, and write an `ANALYTICS_CSV_EXPORTED` entry to the audit log. CSV cells beginning with spreadsheet formula characters (`=`, `+`, `-`, `@`) are prefixed safely before encoding to reduce formula-injection risk when the file is opened in Excel/Sheets.

Order/customer CSVs contain private customer information and should be treated as operational data. Do not upload them to public repositories or public file shares.

## API

```text
GET /api/admin/analytics?days=30
GET /api/admin/analytics?from=2026-09-01&to=2026-09-28
GET /api/admin/analytics/export?days=30&type=daily-sales
GET /api/admin/analytics/export?days=30&type=orders
GET /api/admin/analytics/export?days=30&type=products
GET /api/admin/analytics/export?days=30&type=customers
```

Supported export types are `daily-sales`, `orders`, `products`, and `customers`.

## Deployment

Step 14 introduces no environment variables and no database migration. Keep the normal production flow:

```bash
npm ci
npm run db:generate -w server
npm test
npm run build
```

Render can keep the existing pre-deploy command:

```bash
npm run db:migrate -w server
```

It will simply report that there are no new Step 14 migrations to apply.
