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

## API map

| Area | Endpoints |
| --- | --- |
| Health | `GET /api/health` |
| Auth | `POST /api/auth/register`, `login`, `refresh`, `logout`; `GET /me` |
| Catalog | `GET /api/products`, `/api/products/categories` |
| Orders | `POST/GET /api/orders`, detail, and cancellation |
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
5. Integrate a PCI-compliant payment provider before enabling online payments. The included working method is cash on delivery.

## Structure

```text
front-end/       Preact/Vite storefront, admin workspace, and API client
server/prisma/   Schema, migration, initializer, and seed
server/src/      Routes, middleware, services, and app bootstrap
server/test/     API integration tests
```
