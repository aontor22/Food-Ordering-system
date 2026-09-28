# Step 17 — Cancellation, Refund & Reconciliation

Step 17 centralizes customer cancellation windows and admin refund/reconciliation rules.

## Customer cancellation policy

- ASAP orders: customer self-cancellation is allowed only within `RestaurantSetting.customerCancelWindowMinutes` after order creation and only while status is `PENDING` or `CONFIRMED`.
- Scheduled orders: customer self-cancellation is allowed only until `scheduledCancelLeadMinutes` before the scheduled local slot, and only while status is `PENDING` or `CONFIRMED`.
- Preparation or later (`PREPARING`, `READY`, `OUT_FOR_DELIVERY`, `DELIVERED`) cannot be self-cancelled.
- Payment review/gateway processing blocks cancellation until reconciliation is complete.
- If money is already recorded as paid, a customer cancellation request is stored but the order is not marked `CANCELLED` until the refund is reconciled.

Defaults:
- ASAP self-cancel window: 10 minutes
- Scheduled cutoff: 60 minutes before slot

Admins can change both under Admin → Store operations.

## Paid cancellation flow

1. Customer submits cancellation within policy.
2. Order stores `cancellationRequestedAt` and `cancellationRequestReason`.
3. Admin → Payments shows the refund/reconciliation queue.
4. Refund action depends on provider:
   - SSLCOMMERZ: request gateway refund, wait for `REFUNDED` confirmation.
   - Manual payment: record the already-completed external refund.
   - COD/cash: record the already-returned cash.
5. Once payment is `REFUNDED`, admin cancels the order with a mandatory reason.
6. Inventory is restored and eligible Tomato Points are restored by the existing cancellation transaction.

A paid order cannot be finally cancelled before its refund is recorded/confirmed.

## Security and accounting

- Guest cancellation still requires the Step 09 private guest access token.
- Customer cancellation windows are computed on the server.
- Admin cancellation requires an audit reason.
- `refundReconciliation()` derives the next required action from payment/provider state.
- Existing full-refund semantics are preserved; Step 17 does not introduce partial refunds.
- No new environment variables are required.
