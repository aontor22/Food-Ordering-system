# Guest checkout and post-order account linking — Step 09

Step 09 allows a customer to place and track an order without creating an account while retaining the existing delivery-zone, store-hours, scheduling, inventory, pricing, payment, review, and loyalty protections.

## Security model

- A guest order keeps `userId = NULL` until it is linked and is permanently marked `customerType = GUEST` for admin provenance.
- The public order number is not an access credential. Guest read, live tracking, cancellation, manual-payment, and retry-payment APIs require the private `X-Order-Access-Token` bearer header.
- The token is a signed JWT bound to the order ID and a cryptographically random 24-byte order nonce. The raw token is not stored in PostgreSQL; only the nonce and expiration are stored. Access expires after 90 days.
- Guest API responses are `Cache-Control: no-store`, the bearer header is explicitly redacted from HTTP logs, and guest endpoints have additional rate limits.
- Email tracking URLs place the token in the URL fragment (`#access=...`) rather than the query string. The browser removes it from the address bar after reading it.
- Admin/customer API serializers never expose `guestAccessNonce`.

Treat a guest tracking link like a private receipt. Anyone who obtains the token can view that guest order until the token expires or the system is changed to revoke it.

## Account-linking policy

There are two safe paths:

1. **Explicit private-token link:** after password or Google sign-in, the browser can link a locally saved guest token only when the signed-in account email exactly matches the guest order email. Possessing an order number is never sufficient.
2. **Verified-email auto-link:** Google sign-in already validates Google's `email_verified` claim. A Google-authenticated account receives `emailVerifiedAt`, and eligible unclaimed guest orders with the same normalized email can be linked automatically.

An order already linked to another account cannot be claimed by a second account. Existing password sign-up/login is not treated as general email verification; Step 18 remains the roadmap item for full email-verification/password-reset hardening.

## Loyalty and review policy

- Anonymous guest checkout cannot redeem Tomato Points.
- An anonymous order receives no delivery points while `userId` is null.
- If it is linked before delivery, the existing delivery award runs normally.
- If it was already delivered and is securely linked later, the normal delivery award is applied once at link time. Existing unique loyalty transaction constraints prevent duplicate awards.
- Reviews remain account-only. A delivered guest purchase becomes review-eligible only after it is securely linked to the matching account.

## Database migration

Migration:

`server/prisma/migrations/20260927000000_guest_checkout/migration.sql`

It only adds nullable/defaulted fields, makes `Order.userId` and notification delivery ownership nullable, and rebuilds the notification idempotency index. Existing orders default to `customerType = REGISTERED`. It does not delete or rewrite existing orders, payments, products, reviews, points, or customers.

Production database command:

```bash
npm run db:generate -w server
npm run db:migrate -w server
```

Do **not** run `prisma migrate dev`, `prisma db push --force-reset`, or any reset command against production.

## Environment variables

Step 09 adds **no new environment variables**.

Existing backend variables remain in use:

```env
DATABASE_URL=
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
CLIENT_ORIGIN=
PUBLIC_API_URL=
PAYMENT_CURRENCY=
GOOGLE_CLIENT_ID=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_FOLDER=
SSLCOMMERZ_STORE_ID=
SSLCOMMERZ_STORE_PASSWORD=
SSLCOMMERZ_LIVE=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
SMTP_HOST=
SMTP_PORT=
SMTP_SECURE=
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=
EMAIL_FROM_NAME=
```

Existing frontend variables remain:

```env
VITE_API_URL=
VITE_CURRENCY=
VITE_GOOGLE_CLIENT_ID=
```

**Important:** `JWT_ACCESS_SECRET` now also signs guest-order access tokens. Keep the production value stable across deployments. Rotating it intentionally invalidates outstanding guest tracking tokens.

## Payment compatibility

- COD: guest order and token are created immediately.
- Manual bKash/Nagad/Rocket/Bank: the same token authorizes viewing instructions and submitting the transaction reference.
- SSLCOMMERZ: guest checkout calls the same hardened payment service and the same amount/currency/callback reconciliation used by registered orders. The guest token is never sent to SSLCOMMERZ.
- Development demo payment: guest sessions use the guest token in addition to the existing signed demo-payment session.

For gateway redirects, the current browser retains its guest token locally. A different device/browser should use the secure guest tracking link sent by email rather than relying on the public order number.

## Admin behavior

Admin → Orders displays **Guest**, **Guest · linked**, or **Registered**. A linked guest order remains historically marked `GUEST`, while `userId` records the safe account link.
