# Verification status

Current release: Step 03 — PostgreSQL + hardened payments + restaurant opening hours/closure controls.

## Step 03 implemented

- Database-backed restaurant timezone and weekly opening schedule.
- Closed-day, 24-hour and overnight opening windows.
- Master **Accept new orders** switch for immediate operational pauses.
- Temporary closure with reason and optional restaurant-local automatic reopening time.
- Holiday/special full-day closure records.
- Public `GET /api/store/status` state for storefront UI.
- Storefront open/closed strip and Cart/Checkout blocking while closed.
- `POST /api/orders` checks availability before processing and again inside the order transaction.
- Existing orders/payment/review flows continue even when new ordering is closed.
- Admin dashboard exposes current store status and links to the Store hours workspace.
- Admin schedule/closure changes are captured in the audit log.
- Migration defaults all seven days to 24-hour availability to avoid unexpectedly taking an existing deployment offline.

## Static verification completed in this workspace

- All server/service/route/test JavaScript files passed `node --check`.
- JSON package files parse successfully.
- PostgreSQL migration SQL and Prisma schema definitions were reviewed together for matching tables, fields and unique constraints.
- A new integration test covers public store status, admin pause, server-side order rejection, temporary closure, closure CRUD and reopening.

## Verification still required in your Codespace/Render environment

Dependency installation in this workspace timed out, so the complete Prisma/Vite dependency-backed suite was not rerun here. After copying the release, run:

```bash
npm install
npm run db:setup
npm test
npm run build
```

Then deploy the backend first so the PostgreSQL migration is applied, followed by the Vercel frontend. Configure the actual business schedule under **Admin → Store hours**.

## Existing Step 02 payment protections retained

- SSLCOMMERZ validation/IPN reconciliation, risk review and refund status tracking remain unchanged.
- Manual payment and COD flows remain available according to their existing configuration.
- Merchant secrets remain server-side.
