# Step 16 verification — Invoice and receipt workflow

## Pre-deploy

1. Run `npm ci`.
2. Run `npm run db:generate -w server`.
3. Run `node --test server/test/order-documents.test.js`.
4. Run `npm test` with PostgreSQL configured.
5. Run `npm run build`.
6. Run `git diff --cached --check` before commit.

There is no Step 16 database migration.

## Registered customer

1. Place a COD order and open My Orders.
2. Confirm Invoice → Print / PDF opens a print-ready standalone document.
3. Confirm Invoice → Download saves `tomato-invoice-<order>.html`.
4. Before COD collection, confirm Payment receipt actions are disabled.
5. Complete delivery so COD payment is recorded as paid.
6. Confirm receipt actions become available without changing the invoice totals.
7. Confirm variants/add-ons, kitchen instructions, coupon discount, Tomato Points discount and delivery fee match the historical order.
8. Confirm another account cannot retrieve the document using the first account's order ID.

## Guest order

1. Place an anonymous order and open the private Guest Tracking page.
2. Confirm invoice actions work using the private guest-order token.
3. Remove the token/use another browser and confirm order ID/order number alone cannot access the document.
4. Confirm the downloaded standalone document contains no guest token.
5. Pay the guest order and confirm the receipt appears only after payment is recorded.
6. Link the guest order to the matching account and confirm the same historical documents are available from My Orders.

## Payments/refunds

1. Manual: before admin approval, receipt must be unavailable; after approval, receipt must be available.
2. SSLCOMMERZ/demo: receipt must remain unavailable while processing/review and become available after `PAID`.
3. COD: receipt becomes available only after cash is recorded (normally delivery or Admin Payments cash-received).
4. For a refunded payment, confirm the receipt is still available and visibly shows the refund amount/date/reference when stored.
5. Confirm a cancelled unpaid order may still have an invoice but never a false paid receipt.

## Admin

1. Open Admin → Orders and expand an order.
2. Confirm invoice print/download actions work for Guest and Registered orders.
3. Confirm paid orders also expose receipt actions.
4. Download a document and verify Admin → Activity contains `ORDER_DOCUMENT_EXPORTED`.
5. Confirm admin document responses do not include guest access nonce/token or checkout idempotency keys.

## Security/content

1. Verify document responses send `Cache-Control: private, no-store` and `Pragma: no-cache`.
2. Verify customer/order notes containing `<`, `>`, `&`, quotes or HTML are rendered as text, not executed.
3. Verify files contain no authorization header, cookie, guest token, refresh token, password, SSLCOMMERZ store password or Cloudinary secret.
4. Confirm the browser print layout is usable on A4 and on mobile.
5. Test Unicode product/customer text in the standalone HTML document.

## Existing feature regression

Recheck:

- Guest checkout and secure account linking
- Manual/COD/SSLCOMMERZ payment flows
- Delivery/Pickup and ASAP/scheduled checkout
- Step 10 variants/add-ons/special instructions
- Step 11 inventory concurrency
- Step 12 addresses/reorder
- Step 13 search/filter/sort
- Step 14 analytics/CSV
- Step 15 KDS lifecycle
- Reviews, Tomato Points, notifications and PWA
