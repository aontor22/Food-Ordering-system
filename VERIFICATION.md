# Customer and admin payment update

Verified locally on 19 September 2026.

## Delivered

- Customer checkout offers COD and configured online payment, with a development-only demo.
- Payment results use authenticated server data, not URL success flags. Orders expose payment status, retry/continue, and permitted cancellation.
- Admin Payments lists transaction details, filters, cash received/refunded actions, and gateway status checks. Online payments cannot be manually marked paid.
- Online fulfilment requires verified payment. Cancellation and cash settlement read current state within database transactions. Refunded cash cannot be collected again.
- Gateway settlement validates transaction identity, amount, currency, and risk. Failure/cancel notifications trigger a server-to-server query. Duplicate settlement cannot downgrade paid status.
- Existing COD orders are backfilled into the ledger on database setup. Re-running setup preserves the records.
- Disabled accounts lose access immediately, including previously issued access tokens.

## Verification

- `npm test`: 12 passing integration tests, isolated temporary SQLite database.
- Gateway verification tests use mocked provider responses; no money charged.
- `npm run build`: passed, 128 frontend modules.
- `npm audit --omit=dev`: zero reported production dependency vulnerabilities at check time.
- Server JavaScript syntax checks passed.
- Production smoke checks passed for `/admin/payments`, `/payment/result`, `/orders`, unknown API 404, unauthenticated payment rejection, and disabled production demo.
- Visual browser verification was attempted but Chromium download timed out; no claim of completed visual/browser end-to-end testing.

## Deployment limits

Real SSLCOMMERZ credentials and public HTTPS callbacks must be configured and tested in the merchant sandbox before live use. Automated online refunds and operator risk-review resolution are not included. Ambiguous gateway sessions remain processing until verified; they are not assumed failed. The admin ledger shows the latest 250 payment records. This is implementation verification, not an independent penetration test.

See README.md for upgrade commands, environment variables, and payment operation details.

Gateway protocol reference: https://developer.sslcommerz.com/doc/v4/
