# Step 15 verification — Kitchen Display System

## Pre-deploy

1. Run `npm ci`.
2. Run `npm run db:generate -w server`.
3. Run `node --test server/test/kitchen-display.test.js`.
4. Run `npm test` with PostgreSQL configured.
5. Run `npm run build`.
6. Run `git diff --cached --check` before commit.

There is no Step 15 database migration.

## Admin / KDS

1. Open **Admin → Kitchen display** and confirm the NEW, PREPARING and READY lanes render responsively.
2. Confirm the page reports Live when the SSE connection is active.
3. Confirm only `CONFIRMED`, `PREPARING`, and `READY` orders appear on the KDS.
4. Confirm PENDING, cancelled, dispatched and delivered orders do not remain on the board.
5. Confirm a scheduled NEW order displays its schedule and is not incorrectly shown as overdue before preparation starts.
6. Confirm order-level notes, item quantities, variants/add-ons and kitchen instructions are clearly visible.
7. Confirm the Kitchen screen/fullscreen button works where the browser permits Fullscreen API access.

## Lifecycle

1. Create an ASAP COD Delivery order.
2. Confirm it from Admin Orders; verify it appears in KDS NEW.
3. Start preparing with a 20-minute target; verify status becomes PREPARING and `estimatedReadyAt` is populated.
4. Verify customer tracking shows PREPARING and the same ready estimate.
5. Mark ready; verify status becomes READY, `readyAt` is populated, and the ticket moves to READY.
6. Confirm the customer receives/sees the READY update.
7. Dispatch the delivery order with a delivery ETA; verify it leaves the KDS and becomes OUT_FOR_DELIVERY.
8. Complete it as DELIVERED and verify COD settlement/loyalty behavior remains unchanged.

## Pickup

1. Create and confirm a Pickup order.
2. Move NEW → PREPARING → READY from the KDS.
3. Verify the customer sees **Ready now — you can collect your order**.
4. Complete pickup directly from READY and verify the order becomes DELIVERED.
5. Verify historical `READY_FOR_PICKUP` orders can still move to DELIVERED.

## Payment and security regression

1. Confirm unpaid non-COD orders cannot enter fulfilment.
2. Confirm paid prepaid orders still require refund handling before cancellation.
3. Confirm manual-payment review and SSLCOMMERZ processing restrictions remain enforced.
4. Confirm the KDS endpoints require an authenticated ADMIN account.
5. Confirm guest-order access tokens and checkout idempotency values are not exposed by KDS responses.
6. Confirm KDS responses are `private, no-store` and SSE is `no-cache`.

## Existing feature regression

Recheck:

- Delivery/Pickup and ASAP/scheduled checkout
- Delivery zones and dynamic fees
- Step 10 product customizations and special instructions
- Step 11 product/option inventory concurrency
- Step 12 saved addresses and reorder
- Step 13 search/filter/sort
- Step 14 analytics/CSV exports
- Guest order tracking/account linking
- Reviews and Tomato Points
- Email/browser notifications
- PWA/offline fallback
