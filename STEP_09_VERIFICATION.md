# Step 09 verification — Guest checkout

Run these checks after applying the migration and deploying both services.

## Automated checks

From the repository root:

```bash
npm ci
npm run db:generate -w server
npm test
npm run build
```

The integration suite includes `server/test/guest-checkout.test.js`, covering guest quote/create, token-only access, scheduled pickup, manual payment, development demo payment, admin provenance, no anonymous loyalty award, wrong-account rejection, safe linking, and linked-delivered review eligibility.

## Production smoke test

1. Open the storefront in an incognito/private window and keep logged out.
2. Add an available product and open checkout.
3. Confirm both **Delivery** and **Pickup** are selectable.
4. Confirm both **ASAP** and an available **Scheduled** slot work. Try an unavailable/closed slot and confirm the server rejects it.
5. For Delivery, omit an address field and confirm checkout is rejected. Select a real configured delivery zone and confirm its minimum order/fee/free-delivery rules still match the server quote.
6. Place a guest COD order with name, email, and phone. Confirm the order page opens and live tracking works without login.
7. Copy only the public order number into another private browser. Confirm it cannot reveal the guest order.
8. Copy the full private tracking link from the email. Confirm it opens the order; then confirm the browser removes `#access=...` from the visible address after loading.
9. In Admin → Orders, confirm the order is marked **Guest** and no guest token/nonce is shown.
10. Repeat with Pickup and a scheduled slot. Confirm no delivery address is required and slot-capacity rules remain enforced.
11. Repeat with an enabled manual payment channel. Confirm the guest can see only that order's payment destination and submit a transaction reference; admin review remains unchanged.
12. In a non-production environment with demo payments enabled, verify a guest online-payment success/fail/cancel round trip. For SSLCOMMERZ sandbox, verify success/fail/cancel/IPN callbacks as in the existing gateway checklist.
13. Deliver an anonymous guest order. Confirm no Tomato Points are awarded while it is unlinked.
14. Sign in/create an account with a **different** email and try to link the private guest order. Confirm the API returns an email-mismatch error and the order remains unclaimed.
15. Sign in/create the matching-email account in the original browser and link the order. Confirm it appears in My orders. If it was already delivered, confirm the normal one-time points award occurs once.
16. Refresh/relink the same order and confirm points do not duplicate.
17. Confirm a guest cannot review while anonymous. After matching-account link + Delivered status, confirm the existing review flow works.
18. Google-sign in with the same Google-verified email as an eligible unclaimed guest order and confirm the order is linked automatically.

## Security checks

- Inspect API responses and Admin network responses: `guestAccessNonce` must never appear.
- Inspect application logs: the `X-Order-Access-Token` value must be redacted.
- Guest order/payment API responses should include `Cache-Control: no-store`.
- `GET /api/orders/:id` without authentication must remain denied.
- `GET /api/orders/guest` without `X-Order-Access-Token`, with a malformed token, or with an expired token must be denied.
- Keep `JWT_ACCESS_SECRET` unchanged during ordinary deployments so existing private tracking links remain valid.
