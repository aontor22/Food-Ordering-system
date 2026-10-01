# Step 11 verification checklist

## Database and migration

- Run `npm run db:generate -w server`.
- Run `npm run db:migrate -w server` with a PostgreSQL `DATABASE_URL`.
- Confirm migration `20260927020000_inventory_concurrency` is applied.
- Confirm existing products/orders are preserved and existing product options default to `trackStock=false`.

## Product inventory

1. Open Admin → Inventory and confirm all products appear with current stock, low-stock thresholds and status.
2. Adjust one product from its current stock to a new physical count. Refresh and confirm the new value plus a ledger entry.
3. Open the same inventory page in two browser tabs. Adjust in tab A, then submit the stale value from tab B. Tab B must be rejected and must not overwrite tab A.
4. Verify Product editing no longer changes live stock for existing products and directs administrators to Inventory instead.

## Variant/add-on inventory

1. In Admin → Products, create or edit a product option and enable **Track**.
2. For a new tracked option, set opening stock and low-stock alert threshold. For an existing tracked option, use Admin → Inventory to change the live stock.
3. Confirm low-stock and sold-out option states appear on the customer customizer.
4. Place an order using a tracked option. Product stock and option stock must both decrease by the purchased quantity.
5. Try ordering more of that option than remains across multiple differently-configured cart lines. Checkout must reject the combined quantity.
6. Cancel an eligible order. Product stock and the exact tracked option stock must be restored.

## Concurrency and idempotency

1. Put a product/variant at stock 1 and attempt two near-simultaneous checkouts. At most one order may reserve the last unit; stock must never become negative.
2. Double-click/retry checkout during a slow request. The stable `clientRequestId` must produce one order and one inventory reservation; only its digest should be stored server-side.
3. Retry the same checkout after a network interruption and confirm the existing order is returned instead of a duplicate.
4. Confirm changing the human-readable order number or using a checkout request ID does not grant guest-order access; Step 09's guest token remains required.

## Existing feature regression

- Registered and Guest checkout both work.
- Delivery/Pickup and ASAP/scheduled fulfilment still enforce existing rules.
- COD/manual/SSLCOMMERZ totals remain server-authoritative.
- Step 10 sizes/add-ons/special instructions remain visible in cart, confirmation, tracking, email and admin order views.
- Guest account linking, Tomato Points, reviews, wishlist, live tracking, notifications and PWA flows still operate under their existing security rules.

## Commands

```bash
npm ci
npm run db:generate -w server
npm test
npm run build
```
