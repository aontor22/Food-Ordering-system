import test from 'node:test';
import assert from 'node:assert/strict';
import { cancellationPolicy, localKeyToDate, refundReconciliation } from '../src/services/cancellation-policy-core.js';

const now = new Date('2026-09-28T04:00:00.000Z');
const settings = { customerCancelWindowMinutes: 10, scheduledCancelLeadMinutes: 60, timezone: 'Asia/Dhaka' };
const base = { status:'CONFIRMED', paymentMethod:'COD', paymentStatus:'PENDING', createdAt:new Date(now.getTime()-5*60000), fulfillmentMode:'ASAP', fulfillmentType:'DELIVERY', payment:{ provider:'COD', status:'PENDING' } };

test('ASAP cancellation respects configured window', () => {
  assert.equal(cancellationPolicy(base, settings, now).allowed, true);
  const late = { ...base, createdAt:new Date(now.getTime()-11*60000) };
  assert.equal(cancellationPolicy(late, settings, now).code, 'CANCELLATION_WINDOW_CLOSED');
});

test('scheduled cancellation uses restaurant-local cutoff', () => {
  const scheduledDate = localKeyToDate('2026-09-28T12:00', 'Asia/Dhaka');
  assert.equal(scheduledDate.toISOString(), '2026-09-28T06:00:00.000Z');
  const order = { ...base, fulfillmentMode:'SCHEDULED', scheduledForLocal:'2026-09-28T12:00', schedulingTimezone:'Asia/Dhaka' };
  assert.equal(cancellationPolicy(order, settings, now).allowed, true);
  assert.equal(cancellationPolicy(order, settings, new Date('2026-09-28T05:30:01.000Z')).allowed, false);
});

test('paid orders require refund and reconciliation identifies next action', () => {
  const paid = { ...base, paymentMethod:'ONLINE', paymentStatus:'PAID', payment:{ provider:'SSLCOMMERZ', status:'PAID' } };
  const policy = cancellationPolicy(paid, settings, now);
  assert.equal(policy.allowed, false);
  assert.equal(policy.refundRequired, true);
  assert.equal(refundReconciliation(paid.payment, paid).action, 'GATEWAY_REFUND');
  assert.equal(refundReconciliation({ provider:'SSLCOMMERZ', status:'REFUND_PENDING' }, paid).action, 'CHECK_REFUND');
  assert.equal(refundReconciliation({ provider:'SSLCOMMERZ', status:'REFUNDED' }, paid).action, 'CANCEL_ORDER');
});
