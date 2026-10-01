# Step 17 verification

1. Admin → Store operations shows ASAP cancellation window and scheduled cutoff.
2. Set ASAP window to 10 minutes. Create a COD ASAP order and cancel inside 10 minutes; order becomes CANCELLED and inventory is restored once.
3. Try the same after the window; API returns `CANCELLATION_WINDOW_CLOSED`.
4. Create a scheduled order. Verify cancellation is allowed before the configured cutoff and blocked after it.
5. Move an order to PREPARING; customer self-cancellation must be unavailable regardless of remaining time.
6. Create a PAID manual/SSLCOMMERZ order and request cancellation inside policy. Order must remain active with `cancellationRequestedAt` rather than becoming CANCELLED.
7. Admin → Payments → Cancellation & refund reconciliation shows that order and the correct next action.
8. SSLCOMMERZ paid order: request refund; while REFUND_PENDING final cancellation remains blocked. After gateway confirmation becomes REFUNDED, Admin Orders allows cancellation.
9. Manual/COD paid order: record the external/cash refund first, then cancel with a mandatory audit reason.
10. Attempt admin cancellation of any PAID order before refund; it must fail with REFUND_REQUIRED.
11. Attempt admin cancellation without a reason; it must fail with CANCELLATION_REASON_REQUIRED.
12. Guest cancellation without the private token must fail; order number alone must reveal nothing.
13. Verify cancellation restores product/variant/add-on inventory and redeemed Tomato Points only once.
14. Verify invoices/receipts continue to show payment/refund state correctly.
15. Recheck payments, KDS, scheduled slots, analytics, reorder, reviews, notifications and PWA.

Run before deployment:

```bash
npm ci
npm run db:generate -w server
node --test server/test/cancellation-policy.test.js
npm test
npm run build
```
