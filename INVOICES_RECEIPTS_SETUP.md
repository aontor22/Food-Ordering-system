# Step 16 — Invoice and receipt workflow

Step 16 adds secure printable/downloadable order documents without introducing a second billing database or rewriting historical orders.

## Document policy

- **Invoice**: available for any authorized order. It is the billing/order summary and reflects the exact stored order-item snapshots, discounts, Tomato Points discount, delivery fee and total.
- **Payment receipt**: available only after payment is recorded as `PAID` or `REFUNDED`. Unpaid COD/manual/online orders cannot generate a receipt.
- A refunded receipt remains available and clearly shows the recorded refund information.
- Historical menu/product edits do not alter old documents because order-item names, prices and customization snapshots are read from `OrderItem`.

## Access control

Registered customers may access documents only for orders whose `userId` matches their account.

Guest orders use the existing Step 09 private, signed, expiring `X-Order-Access-Token`. The human-readable order number and database order ID are not sufficient to retrieve a guest invoice or receipt.

Administrators can access order documents from Admin → Orders. Admin document downloads are written to the existing audit log as `ORDER_DOCUMENT_EXPORTED`.

Every document response is `private, no-store` and `Pragma: no-cache`.

## Format

The server generates a self-contained UTF-8 HTML document. This keeps customer/product text Unicode-safe without adding a server-side browser, font binary, or PDF rendering dependency.

- **Print / Save PDF** opens the standalone document and triggers the browser print flow. Modern browsers can save the result as PDF.
- **Download** saves a standalone `.html` copy that can be reopened and printed later.

The document contains no guest bearer token, refresh token, password, gateway password, checkout idempotency key, or other credential.

## Seller identity

The document uses:

- `EMAIL_FROM_NAME` as the restaurant display/legal name (fallback: `Tomato Restaurant`)
- `EMAIL_FROM` as the restaurant email when configured
- the current Fulfillment/Pickup address as the restaurant address when configured
- the current Restaurant timezone for displayed timestamps

Step 16 adds no new environment variable.

## Endpoints

Authenticated customer:

- `GET /api/orders/:id/documents/invoice`
- `GET /api/orders/:id/documents/receipt`

Guest customer:

- `GET /api/orders/guest/documents/invoice`
- `GET /api/orders/guest/documents/receipt`
- requires `X-Order-Access-Token`

Administrator:

- `GET /api/admin/orders/:id/documents/invoice`
- `GET /api/admin/orders/:id/documents/receipt`

Query controls:

- `?print=1` — auto-opens the browser print/save-PDF flow
- `?download=1` — sends the standalone HTML as an attachment

## Production deployment

There is no Step 16 Prisma migration. Keep the normal production pre-deploy command:

```bash
npm run db:migrate -w server
```

It will only apply any earlier migration that is still pending.
