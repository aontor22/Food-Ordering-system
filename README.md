# Food Ordering System — Full Stack

A working Preact storefront and responsive restaurant admin dashboard with a Node.js/Express API, PostgreSQL database, secure authentication, inventory-aware ordering, coupons, and audited management workflows.

## Included

- Registration/login/logout and automatic session refresh
- Short-lived JWT access tokens and rotating, hashed refresh sessions in HTTP-only cookies
- Product catalog, persistent cart, and database-backed checkout
- Server-calculated totals, transactional stock control, coupons, and cancellation
- Protected admin dashboard with revenue/order analytics, recent orders, status distribution, and top products
- Admin product inventory, order fulfilment, customer access, coupon, and activity-log management
- Validated order-status transitions and automatic stock restoration when an admin cancels an order
- Customer order ownership and server-enforced administrator authorization on every management API
- Validation, role checks, CORS allowlist, secure headers, rate limits, audit logs, and sanitized errors
- Prisma schema, seed data (32 products and `WELCOME10` coupon), and integration tests
- Responsive design system with desktop/mobile navigation, accessible controls, loading and empty states
- Searchable/filterable catalog, redesigned cart and checkout, order confirmation, and customer order history
- Sensitive authorization, cookie, and `Set-Cookie` headers redacted from request logs
- Customer COD/online checkout, development demo payment, verified payment result, and retry from My orders
- Admin Payments ledger with transaction filters, cash collection/refund records, gateway reconciliation, risk-review decisions, and SSLCOMMERZ refund tracking
- SSLCOMMERZ hosted checkout, validated success/IPN callbacks, server-side failure/cancellation reconciliation, risk review, and full gateway refund workflow
- Server-enforced restaurant opening hours, overnight schedules, emergency ordering pause, temporary closures, holiday closures, and customer-facing open/closed status
- Guest checkout for Delivery/Pickup and ASAP/scheduled orders, with private expiring order access, secure tracking/payment actions, matching-account linking, and admin Guest/Registered provenance
- Product variants/sizes, add-ons, per-item kitchen instructions, server-authoritative customization pricing, and immutable order-item snapshots
- Stronger product/variant/add-on inventory controls with atomic reservations, checkout idempotency, optimistic admin stock updates, cancellation restoration, low-stock states, and an inventory ledger
- Account-saved delivery addresses with a default location and one-click reorder that rebuilds the cart against current menu choices, prices, limits, and stock
- Advanced menu discovery with full-catalog search, explicit Vegetarian/Vegan/Halal/Gluten-free product labels, price/rating filters, and price/rating/delivered-order popularity sorting

## Quick start

Requires Node.js 22+ (Node 24 recommended).

```bash
npm install
cp server/.env.example server/.env
cp front-end/.env.example front-end/.env
docker compose up -d db
npm run db:setup
npm run dev
```

Open `http://localhost:5173`; the API runs on `http://localhost:4000`.

Customer storefront: `http://localhost:5173/`  
Admin workspace: `http://localhost:5173/admin`

### GitHub Codespaces

Open the forwarded **5173** port to view the website. Port **4000** is the API and is not the customer interface. The Vite development server proxies `/api` to port 4000, so the default `VITE_API_URL=/api` works with Codespaces forwarded domains without exposing the API port or adding a temporary domain to CORS.

Development seed admin: `admin@example.com` / `ChangeMe123!`. Change these values before deployment.

## Verification

```bash
npm test
npm run build
```

Tests use an isolated temporary PostgreSQL schema and include mocked provider responses for amount validation, risk review, replay/idempotency, failed-payment retry, gateway refund initiation/status, and role/ownership checks. They do not charge money or call a live merchant account.


## PostgreSQL database

The runtime database is PostgreSQL. For local development, `docker compose up -d db` starts PostgreSQL 16 and the example `DATABASE_URL` connects to it. Production deploys use `prisma migrate deploy`; do not use `prisma migrate dev` against production. On Render, create Render Postgres in the same region as the API and set `DATABASE_URL` to its Internal Database URL. See `POSTGRESQL_SETUP.md` for the exact setup and optional legacy SQLite import.

## Payments and upgrading

### Manual payments (no SSLCOMMERZ account needed)

1. For bKash/Nagad/Rocket, set `PAYMENT_CURRENCY=BDT` in `server/.env` and `VITE_CURRENCY=BDT` in `front-end/.env`. Restart development servers (or rebuild the production frontend). Check product prices and `DELIVERY_FEE_CENTS`: 6000 means ৳60 with BDT. Currency changes do not convert prices or historical orders. Mobile channels cannot be enabled while the store uses USD.
2. Run `npm run db:setup` after installing or deploying. It generates Prisma Client, applies pending PostgreSQL migrations, and seeds missing defaults without resetting existing rows.
3. Sign in as admin → **Payments → Manual payment accounts & instructions**. Add a provider (bKash/Nagad/Rocket/Bank), label, actual merchant/account number, and instructions. Enable and save it. No fictitious recipient is preconfigured.
4. Customer selects **Manual payment** and an account at checkout, places the order, then sees the exact amount/currency and receiving instructions. After paying through the chosen channel, they submit the transaction ID, sender identifier and optional note. No PIN, OTP or password is requested.
5. The order remains pending with payment **Awaiting verification**. Admin → Payments → **Review & approve** shows the amount, recipient, sender and transaction ID. Verify these against the receiving account, add a note and confirm receipt before approving. Only then does the order become confirmed/paid. Rejection requires a customer-visible reason and permits a corrected reference.
6. Duplicate transaction references are blocked (including case/separator variants). A rejected reference remains reserved to prevent reuse: the customer should contact the restaurant if the original reference was correct, not pay again simply to resubmit. Under-review and paid manual orders cannot be cancelled until review/refund is handled. **Record refund** only records money already returned; it does not transfer money.

Channel edits affect new orders. Existing orders retain their original destination and instructions. No gateway setup credentials are required for this manual workflow; any provider/account charges are separate. Registered customer details and review history are restricted to the account owner and administrators; guest order access additionally requires its private expiring guest token.

Database changes are now managed by Prisma Migrate on PostgreSQL. After copying updated files, set a PostgreSQL `DATABASE_URL`, then run `npm install`, `npm run db:setup`, and `npm run dev`. `db:setup` generates Prisma Client, applies only pending migrations, and runs the idempotent seed. If you need to preserve data from a local legacy SQLite file, follow `POSTGRESQL_SETUP.md` and run the included `db:import:sqlite` helper after creating the PostgreSQL schema.

At checkout choose **Cash on delivery** or **Online payment (demo)**. The demo lets you test success/failure/cancel without charging money. My orders shows payment status and offers retry. Open `/admin/payments` as an administrator to view the ledger. **Cash received** records money already collected, and **Mark refunded** records cash already returned; these buttons do not transfer money. Delivery also records COD collection. Online orders cannot enter fulfilment until verified paid.

For real SSLCOMMERZ integration, set `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`, `SSLCOMMERZ_LIVE=false` for sandbox, and public HTTPS values for `PUBLIC_API_URL` and the first `CLIENT_ORIGIN`. In Codespaces use the forwarded API URL for `PUBLIC_API_URL` and ensure the gateway can reach its callbacks without GitHub authentication. Add the storefront origin to `CLIENT_ORIGIN` (keep localhost too when using the development proxy). Configure the merchant IPN URL as `PUBLIC_API_URL/api/payments/sslcommerz/ipn`.

`PAYMENT_CURRENCY` and frontend `VITE_CURRENCY` must match (default USD; use BDT if your prices are in taka). Changing these variables does not convert stored prices. Test on the provider sandbox before setting `SSLCOMMERZ_LIVE=true`. Demo payments are always disabled with `NODE_ENV=production`; without gateway credentials, only COD is available.

Gateway timeouts remain processing until verified; retry checks the provider before starting another attempt. Risk-review transactions block fulfilment until an administrator either accepts the gateway-validated payment or refunds it. Paid SSLCOMMERZ transactions can be refunded from Admin → Payments; the system sends a full-refund request, records the gateway refund reference, keeps the payment in `REFUND_PENDING`, and only marks it `REFUNDED` after a status query confirms completion. Live refund API calls require the merchant public IP to be registered with SSLCOMMERZ. No live payment or refund is made by the test suite. See `SSLCOMMERZ_SETUP.md` and the [official SSLCOMMERZ integration documentation](https://developer.sslcommerz.com/doc/v4/).

## Cloudinary product images

Product image files can be stored on Cloudinary instead of the application database or Render filesystem. The browser uploads image bytes directly to Cloudinary using a short-lived signature generated by the authenticated admin API; the Cloudinary API secret never reaches the browser. PostgreSQL stores only `imageUrl` and `imagePublicId`; image bytes remain on Cloudinary.

Set these backend environment variables on Render (and in `server/.env` for local development):

```env
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
CLOUDINARY_FOLDER=tomato/products
CLOUDINARY_AUTO_MIGRATE=false
```

Run `npm run db:setup` after installing the update. The repository keeps only lightweight WebP bootstrap images under `front-end/public/seed-food/`; these are used only until a seeded product is migrated. Existing historical `/food_*.png` rows are still recognized. Use **Admin → Products → Move images to Cloudinary**, or set `CLOUDINARY_AUTO_MIGRATE=true` for one deployment; the server migrates local product images in the background and skips products that already have a Cloudinary public ID. After migration, customers load product images from Cloudinary and PostgreSQL stores only the URL/public ID.

New or replacement images are selected in Admin → Products. The file goes from the browser directly to Cloudinary; the backend only signs the upload and stores the returned URL/public ID. Replaced Cloudinary assets are deleted after the product update succeeds, and an uploaded asset is cleaned up if saving the product fails. Keep `CLOUDINARY_API_SECRET` server-side only.


## Asset cleanup

The frontend no longer bundles the old 32-product mock image catalog or legacy PNG UI icons. Seed product images are compact WebP files in `front-end/public/seed-food/` so a fresh database still has visible bootstrap images before Cloudinary migration. The hero and category artwork are also WebP. Duplicate public hero/Vite/Preact starter assets and the unused legacy Prisma initializer were removed. This keeps the repository and Vite bundle substantially smaller without removing runtime features.

## Store opening hours & closures

Admin → **Store hours** controls the restaurant timezone, weekly schedule, 24-hour/closed days, emergency **Accept new orders** switch, temporary closures, and full-day holiday/special closures. Customers can keep browsing the menu while the restaurant is closed, but Cart/Checkout clearly show the closure and the API rejects new orders server-side. Existing orders are never cancelled by a schedule change.

The migration intentionally defaults all seven days to **Open 24 hours** so deploying this release cannot unexpectedly take an existing store offline. After deployment, configure your real schedule. See `STORE_HOURS_SETUP.md`.


## Order notifications

Step 07 adds transactional email and browser Web Push for order lifecycle events. Customer preferences live at **Account → Notifications**; delivery health and retries live at **Admin → Notifications**. The API uses a PostgreSQL outbox (`NotificationDelivery`) so provider failures do not roll back valid order operations.

For email, configure backend-only generic SMTP variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, `EMAIL_FROM_NAME`). For browser push, run `npm run push:keys -w server` and configure `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` on Render. Never place SMTP credentials or the VAPID private key in Vercel/frontend variables. See `NOTIFICATIONS_SETUP.md` and `STEP_07_VERIFICATION.md`.

## API map

| Area | Endpoints |
| --- | --- |
| Health | `GET /api/health` |
| Store status | `GET /api/store/status` |
| Auth | `POST /api/auth/register`, `login`, `refresh`, `logout`; `GET /me` |
| Catalog | `GET /api/products`, `/api/products/categories` |
| Orders | Authenticated `POST/GET /api/orders`, detail, cancellation, reviews, live tracking, and `POST /api/orders/:id/reorder`; guest quote/create/private tracking/cancel/link under `/api/orders/guest*` |
| Saved addresses | Account-owned CRUD under `/api/addresses`, including default-address selection |
| Customer notifications | `GET /api/notifications`, preferences, push subscriptions, test delivery |
| Payments | `GET /api/payments/options`; authenticated and private-token guest payment/manual routes; SSLCOMMERZ callback routes |
| Admin payments | `GET /api/admin/payments`; cash receive/refund; gateway status check; risk acceptance; SSLCOMMERZ refund request/status under `/api/admin/payments/:id/*` |
| Manual customer payments | `GET /api/payments/manual/:orderId`, `POST /api/payments/manual/:orderId/submit` |
| Manual admin operations | `GET/POST /api/admin/payment-channels`, `PATCH /api/admin/payment-channels/:id`, `POST /api/admin/payments/:id/manual-review`, `manual-refunded` |
| Admin dashboard | `GET /api/admin/dashboard` |
| Admin analytics | Range-aware dashboard and CSV exports under `/api/admin/analytics` |
| Admin notifications | Delivery monitor, queue processing and retry under `/api/admin/notifications` |
| Admin store operations | `GET/PATCH /api/admin/store-operations`, `POST /api/admin/store-closures`, `DELETE /api/admin/store-closures/:id` |
| Admin products | List, create, update, archive and restore under `/api/admin/products` |
| Admin media | Cloudinary status/signature/cleanup/migration under `/api/admin/media` |
| Admin orders | List and controlled status transitions under `/api/admin/orders` |
| Admin kitchen | Live KDS snapshot/SSE under `/api/admin/kitchen` and `/api/admin/kitchen/live` |
| Admin customers | Account list and active-state management under `/api/admin/users` |
| Admin coupons | List, create, update and disable under `/api/admin/coupons` |
| Admin audit | `GET /api/admin/audit-logs` |

## Production checklist

1. Generate two different random JWT secrets of at least 32 characters.
2. Set exact HTTPS frontend origin(s) in `CLIENT_ORIGIN`.
3. Replace the seed admin password and never commit `.env` or database credentials.
4. Use a managed PostgreSQL database; on Render, use the database Internal URL when the API and database are in the same region.
5. Configure Cloudinary credentials for product image uploads; keep `CLOUDINARY_API_SECRET` only on the backend.
6. Configure and validate SSLCOMMERZ sandbox callbacks, currency, public HTTPS URLs, risk-review handling, and refund flow before enabling live online payments. Register the Render service public IP with SSLCOMMERZ if required for live refund API access.
7. Configure SMTP and/or VAPID Web Push, verify test notifications, and monitor Admin → Notifications before relying on customer messaging.
8. Keep `JWT_ACCESS_SECRET` stable during normal deployments because Step 09 guest-order access tokens are signed with it; rotating the secret intentionally invalidates outstanding guest tracking links.

## Structure

```text
front-end/       Preact/Vite storefront, admin workspace, and API client
server/prisma/   PostgreSQL schema, migrations, and seed
server/src/      Routes, middleware, services, and app bootstrap
server/test/     API integration tests
```

## Progressive Web App (Step 08)

The storefront is installable as a PWA on supported browsers. The production build injects its final hashed Vite assets into the service-worker precache list, provides an offline fallback, preserves browser push notifications, and shows an in-app update prompt when a newer deployment is ready. See `PWA_SETUP.md` and `STEP_08_VERIFICATION.md`.

## Guest checkout (Step 09)

Customers can now use Delivery or Pickup, ASAP or scheduled slots, and COD/manual/online payment without an account. Existing server-side pricing, opening-hour, zone, capacity, stock, and payment checks are reused. Guest order numbers are not credentials: private access uses a signed expiring bearer token, while account linking requires the private token plus the matching account email (or a Google-verified matching email for eligible automatic linking). Anonymous orders cannot redeem or earn Tomato Points and cannot review until safely account-linked. See `GUEST_CHECKOUT_SETUP.md` and `STEP_09_VERIFICATION.md`.

## Product customizations (Step 10)

Products can now have admin-managed single-select **Variant/Size** groups and multi-select **Add-on** groups with required/optional selection rules, default choices, availability, ordering, and non-negative price adjustments. The cart stores configured lines rather than only product quantities, so the same dish can appear multiple times with different choices and kitchen notes. Checkout never trusts browser pricing: the API reloads the current product/options, validates every selection, enforces stock using the aggregate product quantity, recalculates the configured unit price, and stores an immutable snapshot on each `OrderItem`. Historical orders therefore keep the purchased names/prices even when menu choices are later renamed or changed. Existing pre-Step-10 carts are migrated locally into line records, and existing order rows are backfilled with their original unit price as `baseUnitPriceCents`. See `PRODUCT_CUSTOMIZATIONS_SETUP.md` and `STEP_10_VERIFICATION.md`.

## Inventory & concurrency safeguards (Step 11)

Admin → **Inventory** is now the authoritative place to change live product and tracked variant/add-on stock. Checkout reserves product and option quantities atomically inside serializable PostgreSQL transactions, retries transient write conflicts, prevents negative stock, and uses a unique browser checkout request ID so network retries/double-submits cannot create duplicate orders or reserve inventory twice. Existing product options remain untracked after migration until an administrator explicitly enables option-level stock tracking. Cancellations restore the exact inventory originally reserved, and every automatic/manual movement is written to an inventory adjustment ledger. See `INVENTORY_CONCURRENCY_SETUP.md` and `STEP_11_VERIFICATION.md`.
## Saved addresses & one-click reorder (Step 12)

Signed-in customers can store up to ten delivery addresses, mark one as the default, edit/remove them, and select a saved location during checkout. Saved addresses are account-owned convenience records only: choosing one fills the checkout form, while the normal server-side delivery-zone, postal-code, fee, minimum-order, opening-hour, scheduling, pricing, payment and stock validation still runs for the new order. Guest checkout remains unchanged and does not persist private addresses to an account.

**Reorder** on My Orders never duplicates the historical order record or copies its old total, coupon, points redemption, payment status, delivery fee or schedule. The API reconstructs cart lines from immutable `OrderItem` product/customization snapshots and validates those product/option IDs against the current menu and Step 11 inventory rules. Fully valid orders reload in one click; if some lines are no longer orderable, only the validated lines are loaded and the customer is told what was skipped. Account-linked former guest orders can use the same reorder path because normal order ownership applies after linking. See `SAVED_ADDRESSES_REORDER_SETUP.md` and `STEP_12_VERIFICATION.md`.


## Advanced search & dietary discovery (Step 13)

The public catalogue now exposes explicit **Vegetarian**, **Vegan**, **Halal** and **Gluten-free** attributes maintained by administrators. Existing products migrate as unclassified (`false`) rather than being guessed from names, so production dietary claims remain an explicit restaurant decision. The customer menu supports multi-term search across product name, description, category, customization group names and option names, plus dietary filters, optional price range, minimum rating, and sorting by base price, verified-review rating or popularity.

Popularity is derived from the total quantity in **DELIVERED** orders only; pending, failed and cancelled orders do not inflate it. Ratings use only `PUBLISHED` verified-order reviews. The product API remains `Cache-Control: no-store` because the same response carries Step 11 live stock/option availability. See `PRODUCT_DISCOVERY_SETUP.md` and `STEP_13_VERIFICATION.md`.

## Admin analytics & CSV exports (Step 14)

Admin → **Analytics** adds range-aware reporting for delivered revenue, average order value, placed/cancelled orders, guest-vs-registered demand, repeat customers, fulfillment/scheduling/payment mix, top customers, product/category performance and low-velocity active products. Revenue is recognized only when an order is delivered; product performance uses delivered `OrderItem` quantity and line totals so Step 10 customization price deltas are reflected. Reporting follows the restaurant timezone and supports 7/30/90-day presets plus custom ranges up to 366 days.

Administrators can export Daily sales, Orders, Products and Customers CSV files for the selected period. Exports are authenticated, rate-limited, audited, `no-store`, and spreadsheet-formula-safe. Step 14 is read-only apart from its audit-log entry and adds no Prisma migration or environment variables. See `ANALYTICS_EXPORTS_SETUP.md` and `STEP_14_VERIFICATION.md`.

## Kitchen Display System (Step 15)

Admin → **Kitchen display** provides a live three-lane production board: **NEW**, **PREPARING**, and **READY**. It does not create a second kitchen-only database state. Instead, the lanes map to the shared order lifecycle (`CONFIRMED` → `PREPARING` → `READY`), so the existing payment gates, tracking events, notifications, admin audit trail, inventory/cancellation rules, COD settlement and loyalty logic stay authoritative.

Timers are derived from the already persisted order timestamps. NEW ASAP tickets show confirmation wait time; scheduled NEW tickets show the requested schedule without being falsely marked overdue; PREPARING tickets compare against the live `estimatedReadyAt`; and READY tickets show how long the finished order has been waiting for pickup or delivery dispatch. Pickup can complete directly from READY, while delivery moves from READY to `OUT_FOR_DELIVERY` with a selectable ETA. Historical `READY_FOR_PICKUP` orders remain supported for backwards compatibility. Step 15 adds no Prisma migration or environment variable. See `KITCHEN_DISPLAY_SETUP.md` and `STEP_15_VERIFICATION.md`.

