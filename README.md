# Food Ordering System — Full Stack

A working Preact storefront and responsive restaurant admin dashboard with a Node.js/Express API, relational SQLite database, secure authentication, inventory-aware ordering, coupons, and audited management workflows.

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
- Admin Payments ledger with transaction filters, cash collection/refund records, and gateway-controlled online statuses
- SSLCOMMERZ hosted checkout, validated success/IPN callbacks, and server-side failure/cancellation reconciliation

## Quick start

Requires Node.js 22+ (Node 24 recommended).

```bash
npm install
cp server/.env.example server/.env
cp front-end/.env.example front-end/.env
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

Tests use a temporary SQLite database and include mocked provider responses for amount validation, risk review, replay/idempotency, failed-payment retry, and role/ownership checks. They do not charge money or call a live merchant account.

## Payments and upgrading

After copying updated files into an existing project, keep your existing `.env` and database, stop the server, then run `npm install`, `npm run db:setup`, and `npm run dev`. The initializer adds the Payment table and backfills existing COD orders without deleting orders/users. Back up your SQLite database before upgrading. Do not mix the bundled initializer with `prisma migrate deploy` against an already initialized database without first baselining migrations.

At checkout choose **Cash on delivery** or **Online payment (demo)**. The demo lets you test success/failure/cancel without charging money. My orders shows payment status and offers retry. Open `/admin/payments` as an administrator to view the ledger. **Cash received** records money already collected, and **Mark refunded** records cash already returned; these buttons do not transfer money. Delivery also records COD collection. Online orders cannot enter fulfilment until verified paid.

For real SSLCOMMERZ integration, set `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`, `SSLCOMMERZ_LIVE=false` for sandbox, and public HTTPS values for `PUBLIC_API_URL` and the first `CLIENT_ORIGIN`. In Codespaces use the forwarded API URL for `PUBLIC_API_URL` and ensure the gateway can reach its callbacks without GitHub authentication. Add the storefront origin to `CLIENT_ORIGIN` (keep localhost too when using the development proxy). Configure the merchant IPN URL as `PUBLIC_API_URL/api/payments/sslcommerz/ipn`.

`PAYMENT_CURRENCY` and frontend `VITE_CURRENCY` must match (default USD; use BDT if your prices are in taka). Changing these variables does not convert stored prices. Test on the provider sandbox before setting `SSLCOMMERZ_LIVE=true`. Demo payments are always disabled with `NODE_ENV=production`; without gateway credentials, only COD is available.

Gateway timeouts remain processing until verified; retry checks the provider before starting another attempt. Risk-review transactions block fulfilment. Online refund initiation and risk-review resolution are not automated in this release; reconcile them through the merchant dashboard and an operator workflow before release. No live payment was made during local verification. See the [official SSLCOMMERZ integration documentation](https://developer.sslcommerz.com/doc/v4/).

## API map

| Area | Endpoints |
| --- | --- |
| Health | `GET /api/health` |
| Auth | `POST /api/auth/register`, `login`, `refresh`, `logout`; `GET /me` |
| Catalog | `GET /api/products`, `/api/products/categories` |
| Orders | `POST/GET /api/orders`, detail, and cancellation |
| Payments | `GET /api/payments/options`, `POST /api/payments/orders/:orderId/initiate`, authenticated demo routes, SSLCOMMERZ callback routes |
| Admin payments | `GET /api/admin/payments`, `POST /api/admin/payments/:id/cash-received`, `cash-refunded` |
| Admin dashboard | `GET /api/admin/dashboard` |
| Admin products | List, create, update, archive and restore under `/api/admin/products` |
| Admin orders | List and controlled status transitions under `/api/admin/orders` |
| Admin customers | Account list and active-state management under `/api/admin/users` |
| Admin coupons | List, create, update and disable under `/api/admin/coupons` |
| Admin audit | `GET /api/admin/audit-logs` |

## Production checklist

1. Generate two different random JWT secrets of at least 32 characters.
2. Set exact HTTPS frontend origin(s) in `CLIENT_ORIGIN`.
3. Replace the seed admin password and never commit `.env` or `dev.db`.
4. Use HTTPS and persistent SQLite storage. For multi-instance scale, migrate Prisma to PostgreSQL.
5. Configure and validate SSLCOMMERZ sandbox callbacks, currency, and public HTTPS URLs before enabling live online payments. Complete merchant refund/review operations for your deployment.

## Structure

```text
front-end/       Preact/Vite storefront, admin workspace, and API client
server/prisma/   Schema, migration, initializer, and seed
server/src/      Routes, middleware, services, and app bootstrap
server/test/     API integration tests
```
