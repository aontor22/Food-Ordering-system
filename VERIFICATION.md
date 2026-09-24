# Verification status

Current release: Step 02 — PostgreSQL + SSLCOMMERZ production hardening.

## Implemented

- PostgreSQL runtime with Prisma Migrate production deployment.
- Customer COD, manual payment and SSLCOMMERZ hosted checkout.
- SSLCOMMERZ success/IPN is never trusted by itself: the backend calls the Order Validation API and verifies transaction ID, amount and currency before marking paid.
- Failed/cancelled browser callbacks query the provider before mutating payment state.
- Provider timeouts stay processing instead of being guessed as failed.
- Gateway risk metadata is stored. Risk-flagged verified payments enter `REVIEW`, block fulfilment, and require an admin decision.
- Admin can accept a gateway-validated risk payment or send it into the gateway refund workflow.
- SSLCOMMERZ full refund initiation uses the bank transaction reference plus a merchant-generated `refund_trans_id` and stores the returned refund reference.
- Refund initiation sets `REFUND_PENDING`; only the refund-status query can move it to `REFUNDED`.
- Payment/refund reconciliation is idempotent at the application-state layer and settled/refunded transactions cannot be downgraded by browser failure callbacks.
- Public gateway callback routes use a separate higher rate limit so shared provider callback traffic is not constrained by the normal customer API limiter.
- Merchant secrets remain server-side.

## Static verification completed in this workspace

- All modified server/service/route/test JavaScript files passed `node --check`.
- PostgreSQL migration SQL and Prisma schema changes were reviewed together for matching columns/indexes.
- Gateway tests were extended with mocked risk acceptance and refund initiation/status cases. They do not call SSLCOMMERZ or charge/refund real money.

## Verification still required in your Codespace/Render environment

Dependency installation in this workspace timed out, so the complete dependency-backed suite was not rerun here. After copying the release, run:

```bash
npm install
npm run db:setup
npm test
npm run build
```

Then complete the sandbox acceptance checklist in `SSLCOMMERZ_SETUP.md` before setting `SSLCOMMERZ_LIVE=true`.

## Live deployment limits

- Real merchant credentials, public HTTPS callbacks and sandbox/live merchant configuration are account-specific and cannot be validated without your SSLCOMMERZ account.
- SSLCOMMERZ documents that live refund API use requires the merchant public IP to be registered with its live system.
- A `REFUND_PENDING` payment should not be treated as completed until the provider query reports `refunded`.
- This implementation verification is not a penetration test or payment-industry certification.
