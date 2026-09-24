# SSLCOMMERZ production setup — Step 02

This release keeps COD and manual payment, and hardens the existing SSLCOMMERZ hosted-checkout path for production use.

## 1. Render environment

Use the Render backend service environment (never Vercel frontend variables) for merchant secrets:

```env
NODE_ENV=production
PUBLIC_API_URL=https://YOUR-RENDER-SERVICE.onrender.com
CLIENT_ORIGIN=https://YOUR-VERCEL-SITE.vercel.app
PAYMENT_CURRENCY=BDT
ENABLE_DEMO_PAYMENTS=false
SSLCOMMERZ_STORE_ID=your_store_id
SSLCOMMERZ_STORE_PASSWORD=your_store_password
SSLCOMMERZ_LIVE=false
```

Keep `SSLCOMMERZ_LIVE=false` while testing the sandbox. The same `PAYMENT_CURRENCY` must match the actual prices stored by the application and `VITE_CURRENCY` on the frontend. Currency environment changes do not convert historical prices/orders.

For live mode, set `SSLCOMMERZ_LIVE=true` only after sandbox checkout, IPN, reconciliation and refund tests pass. Live mode requires an HTTPS `PUBLIC_API_URL`.

## 2. Callback/IPN endpoints

The server sends these callback URLs when creating a hosted payment session:

```text
POST PUBLIC_API_URL/api/payments/sslcommerz/success
POST PUBLIC_API_URL/api/payments/sslcommerz/fail
POST PUBLIC_API_URL/api/payments/sslcommerz/cancel
POST PUBLIC_API_URL/api/payments/sslcommerz/ipn
```

Configure the merchant IPN/listener URL to the `/ipn` endpoint as well. Do not point callbacks at Vercel; they must reach the Render backend directly.

A browser redirect is not treated as proof of payment. The backend calls the SSLCOMMERZ Order Validation API and verifies transaction ID, amount and currency before marking an order paid.

## 3. Admin payment operations

Admin → Payments now shows gateway environment/status and stores bank reference, risk level/card metadata (when returned), last provider check, and refund metadata.

- `Check gateway`: queries SSLCOMMERZ before changing a processing/failed attempt.
- `Accept risk payment`: available only after SSLCOMMERZ validated the payment but returned a risk flag. This is an operator decision; fulfilment remains blocked until accepted.
- `Refund payment`: available for a paid or risk-reviewed SSLCOMMERZ transaction. It sends a **full refund** request for the original amount.
- `Check refund`: queries the refund reference. The order remains `REFUND_PENDING` until SSLCOMMERZ returns `refunded`.

The application does not mark a refund complete merely because the refund request was accepted.

## 4. Refund API requirement

SSLCOMMERZ requires `bank_tran_id`, a merchant-generated `refund_trans_id`, refund amount/reason and merchant credentials. The current SSLCOMMERZ sandbox documentation notes that `refund_trans_id` is mandatory for refund initiation. Live refund API access also requires the merchant public IP to be registered with SSLCOMMERZ.

If the live refund API returns an IP/authentication error, contact SSLCOMMERZ/merchant support and register the public egress IP used by the Render service. Do not work around this by exposing merchant credentials in the browser.

## 5. Deploy

After copying Step 02 files:

```bash
npm install
npm run db:setup
npm test
npm run build
```

`db:setup` applies the new PostgreSQL migration that adds gateway risk/refund metadata to `Payment` without resetting existing orders.

Then deploy the backend first (Render), followed by the frontend (Vercel).

## 6. Sandbox acceptance test

Before live mode, verify all of these with a sandbox merchant account:

1. Successful hosted payment redirects back and becomes `PAID` only after server validation.
2. Failed/cancelled attempts stay retryable and do not become paid from a forged browser callback.
3. IPN can reach the Render backend over public HTTPS.
4. Amount/currency mismatch is rejected.
5. A risk-flagged payment enters `REVIEW` and cannot fulfil until accepted/refunded.
6. Admin full-refund request enters `REFUND_PENDING`.
7. `Check refund` changes the payment to `REFUNDED` only after the gateway reports `refunded`.
8. A refunded prepaid order can then follow the normal cancellation workflow.
