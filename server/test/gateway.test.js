import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.SSLCOMMERZ_STORE_ID = 'test-store';
process.env.SSLCOMMERZ_STORE_PASSWORD = 'test-password';
process.env.SSLCOMMERZ_LIVE = 'false';
const { app } = await import('../src/app.js');
const { prisma } = await import('../src/lib/prisma.js');
const { approveSslCommerzRiskPayment, requestSslCommerzRefund, reconcileSslCommerzRefund, validateSslCommerzPayment, reconcileSslCommerzPayment, initiateOrderPayment } = await import('../src/services/payment.js');
let user;
let order;
const originalFetch = globalThis.fetch;
const reply = data => ({ ok: true, json: async () => data });
before(async () => {
  user = await prisma.user.create({ data: { name: 'Gateway test', email: `gateway-${Date.now()}@example.com`, passwordHash: 'unusable' } });
  order = await prisma.order.create({ data: {
    orderNumber: `GATEWAY-${Date.now()}`, userId: user.id, paymentMethod: 'ONLINE', paymentStatus: 'PROCESSING',
    subtotalCents: 1000, deliveryFeeCents: 200, totalCents: 1200,
    firstName: 'Gateway', lastName: 'Test', email: user.email, phone: '01700000000', street: 'Test street', city: 'Dhaka', state: 'Dhaka', postalCode: '1200', country: 'Bangladesh',
    payment: { create: { transactionId: `GW-${Date.now()}`, provider: 'SSLCOMMERZ', status: 'PROCESSING', amountCents: 1200, currency: 'USD', attempts: 1 } },
  }, include: { payment: true } });
});
after(async () => { globalThis.fetch = originalFetch; await prisma.order.deleteMany({ where: { userId: user.id } }); await prisma.user.delete({ where: { id: user.id } }); await prisma.$disconnect(); });
const validResult = () => ({ status: 'VALID', tran_id: order.payment.transactionId, currency_type: 'USD', currency_amount: '12.00', amount: '1500.00', risk_level: '0', bank_tran_id: 'BANK-TEST' });

test('gateway rejects wrong amount and transaction identity without marking paid', async () => {
  globalThis.fetch = async () => reply({ ...validResult(), currency_amount: '1.00' });
  await assert.rejects(validateSslCommerzPayment({ val_id: 'test' }), /amount or currency/);
  globalThis.fetch = async () => reply(validResult());
  await assert.rejects(validateSslCommerzPayment({ val_id: 'test', tran_id: 'wrong-transaction' }), /identity mismatch/);
  assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).paymentStatus, 'PROCESSING');
});
test('forged failure callback cannot mutate processing payment', async () => {
  globalThis.fetch = async () => reply({ APIConnect: 'DONE', element: [{ tran_id: order.payment.transactionId, status: 'PENDING' }] });
  const response = await request(app).post('/api/payments/sslcommerz/fail').type('form').send({ tran_id: order.payment.transactionId });
  assert.equal(response.status, 303);
  assert.equal((await prisma.payment.findUnique({ where: { id: order.payment.id } })).status, 'PROCESSING');
  await assert.rejects(initiateOrderPayment(order.id, user.id), /not confirmed a final result/);
});
test('verified risk payment blocks retry and remains under review', async () => {
  globalThis.fetch = async () => reply({ ...validResult(), risk_level: '1' });
  const result = await validateSslCommerzPayment({ val_id: 'risk' });
  assert.equal(result.review, true);
  assert.equal(result.order.paymentStatus, 'REVIEW');
});
test('admin can accept a gateway-validated risk payment', async () => {
  const accepted = await approveSslCommerzRiskPayment(order.payment.id);
  assert.equal(accepted.status, 'PAID');
  const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
  assert.equal(updatedOrder.paymentStatus, 'PAID');
  assert.equal(updatedOrder.status, 'CONFIRMED');
});

test('verified settlement is idempotent and cannot be downgraded by fail callbacks', async () => {
  globalThis.fetch = async () => reply(validResult());
  const first = await validateSslCommerzPayment({ val_id: 'paid' });
  assert.equal(first.order.paymentStatus, 'PAID');
  assert.equal(first.order.status, 'CONFIRMED');
  const again = await validateSslCommerzPayment({ val_id: 'paid' });
  assert.equal(again.paid, true);
  globalThis.fetch = async () => { throw new Error('Should not query a settled payment'); };
  const settled = await reconcileSslCommerzPayment(order.payment.transactionId);
  assert.equal(settled.paymentStatus, 'PAID');
});
test('full gateway refund stays pending until gateway confirms it', async () => {
  let refundRequestUrl = '';
  globalThis.fetch = async url => {
    refundRequestUrl = String(url);
    return reply({ APIConnect: 'DONE', bank_tran_id: 'BANK-TEST', trans_id: order.payment.transactionId, refund_ref_id: 'REF-TEST-001', status: 'success', errorReason: '' });
  };
  const requested = await requestSslCommerzRefund(order.payment.id, 'Customer requested cancellation');
  assert.equal(requested.status, 'REFUND_PENDING');
  assert.equal(requested.refundReferenceId, 'REF-TEST-001');
  assert.match(refundRequestUrl, /refund_trans_id=/);
  assert.match(refundRequestUrl, /refund_amount=12\.00/);
  assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).paymentStatus, 'REFUND_PENDING');

  globalThis.fetch = async () => reply({ APIConnect: 'DONE', bank_tran_id: 'BANK-TEST', tran_id: order.payment.transactionId, refund_ref_id: 'REF-TEST-001', status: 'refunded' });
  const refundedOrder = await reconcileSslCommerzRefund(order.payment.id);
  assert.equal(refundedOrder.paymentStatus, 'REFUNDED');
  const refundedPayment = await prisma.payment.findUnique({ where: { id: order.payment.id } });
  assert.equal(refundedPayment.status, 'REFUNDED');
  assert.equal(refundedPayment.refundStatus, 'REFUNDED');
  assert.ok(refundedPayment.refundedAt);
});

