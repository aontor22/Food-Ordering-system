import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
process.env.PAYMENT_CURRENCY = 'BDT';
const { app } = await import('../src/app.js');
const { prisma } = await import('../src/lib/prisma.js');
const { signAccessToken } = await import('../src/lib/tokens.js');

let customer, other, admin, channel, first, submission;
const credentials = {};
const run = Date.now();
const channelValues = { provider: 'BKASH', label: 'Test merchant (not real)', account: 'TEST-ACCOUNT-ONLY', instructions: 'Test instructions only. Do not send real money.', active: true };
const delivery = { firstName: 'Manual', lastName: 'Test', email: 'manual@example.com', phone: '01700000000', street: 'Test street', city: 'Dhaka', state: 'Dhaka', postalCode: '1200', country: 'Bangladesh' };
const create = () => request(app).post('/api/orders').set('Authorization', credentials.customer).send({ items: [{ productId: '1', quantity: 1 }], paymentMethod: 'MANUAL', manualChannelId: channel.id, delivery });
const submit = (order, reference) => request(app).post(`/api/payments/manual/${order.id}/submit`).set('Authorization', credentials.customer).send({ reference, sender: 'Test sender', note: 'Test receipt', amountCents: 1, status: 'PAID' });
const review = (order, id, decision, note = 'Checked test receiving account') => request(app).post(`/api/admin/payments/${order.payment.id}/manual-review`).set('Authorization', credentials.admin).send({ submissionId: id, decision, note, confirmedReceived: true });

before(async () => {
  for (const [key, role] of [['customer','CUSTOMER'],['other','CUSTOMER'],['admin','ADMIN']]) {
    const user = await prisma.user.create({ data: { name: key, email: `${key}-manual-${run}@example.com`, passwordHash: 'unused', role } });
    credentials[key] = `Bearer ${signAccessToken(user)}`;
    if (key === 'customer') customer = user;
    if (key === 'other') other = user;
    if (key === 'admin') admin = user;
  }
});
after(async () => {
  const orders = await prisma.order.findMany({ where: { userId: customer.id }, include: { items: true } });
  for (const order of orders.filter(item => item.status !== 'CANCELLED')) for (const item of order.items) await prisma.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
  await prisma.order.deleteMany({ where: { userId: customer.id } });
  if (channel) await prisma.manualPaymentChannel.delete({ where: { id: channel.id } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [customer.id, other.id, admin.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [customer.id, other.id, admin.id] } } });
  await prisma.$disconnect();
});

test('only admin can configure channels; manual checkout requires an active channel', async () => {
  let r = await request(app).get('/api/payments/options');
  assert.equal(r.body.methods.find(method => method.id === 'MANUAL').enabled, false);
  r = await request(app).post('/api/admin/payment-channels').set('Authorization', credentials.customer).send(channelValues);
  assert.equal(r.status, 403);
  r = await request(app).post('/api/admin/payment-channels').set('Authorization', credentials.admin).send(channelValues);
  assert.equal(r.status, 201); channel = r.body.channel;
  r = await request(app).get('/api/payments/options');
  assert.equal(r.body.methods.find(method => method.id === 'MANUAL').enabled, true);
  assert.equal(r.body.manualChannels[0].account, channelValues.account);
  r = await create(); assert.equal(r.status, 201); first = r.body.order;
  assert.equal(first.payment.provider, 'MANUAL');
  assert.equal(first.payment.status, 'PENDING');
  await request(app).patch(`/api/admin/payment-channels/${channel.id}`).set('Authorization', credentials.admin).send({ ...channelValues, active: false, account: 'CHANGED-TEST-ACCOUNT' });
  r = await create(); assert.equal(r.status, 409);
  r = await request(app).get(`/api/payments/manual/${first.id}`).set('Authorization', credentials.customer);
  assert.equal(r.body.payment.manualDestination.account, channelValues.account);
  await request(app).patch(`/api/admin/payment-channels/${channel.id}`).set('Authorization', credentials.admin).send(channelValues);
});

test('submission enforces ownership and derives amount/status from the order', async () => {
  let r = await request(app).get(`/api/payments/manual/${first.id}`);
  assert.equal(r.status, 401);
  r = await request(app).get(`/api/payments/manual/${first.id}`).set('Authorization', credentials.other);
  assert.equal(r.status, 404);
  r = await request(app).post(`/api/payments/manual/${first.id}/submit`).set('Authorization', credentials.other).send({ reference: 'TEST-FIRST', sender: 'Other user' });
  assert.equal(r.status, 404);
  r = await submit(first, 'TEST-FIRST'); assert.equal(r.status, 201); submission = r.body.submission;
  assert.equal(submission.amountCents, first.totalCents);
  assert.equal(submission.status, 'SUBMITTED');
  r = await request(app).get(`/api/orders/${first.id}`).set('Authorization', credentials.customer);
  assert.equal(r.body.order.status, 'PENDING');
  assert.equal(r.body.order.paymentStatus, 'REVIEW');
  r = await request(app).post(`/api/orders/${first.id}/cancel`).set('Authorization', credentials.customer);
  assert.equal(r.status, 409);
  r = await request(app).patch(`/api/admin/orders/${first.id}/status`).set('Authorization', credentials.admin).send({ status: 'CONFIRMED' });
  assert.equal(r.status, 409);
});

test('reference cannot be reused across orders, ignoring letter case and separators', async () => {
  const second = (await create()).body.order;
  const r = await submit(second, 'test first');
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'DUPLICATE_PAYMENT_REFERENCE');
  assert.equal((await prisma.payment.findUnique({ where: { orderId: second.id } })).status, 'PENDING');
});

test('approval requires admin verification, is audited and rejects stale decisions', async () => {
  let r = await request(app).post(`/api/admin/payments/${first.payment.id}/manual-review`).set('Authorization', credentials.customer).send({ submissionId: submission.id, decision: 'APPROVE', note: 'Forgery attempt', confirmedReceived: true });
  assert.equal(r.status, 403);
  r = await request(app).post(`/api/admin/payments/${first.payment.id}/manual-review`).set('Authorization', credentials.admin).send({ submissionId: submission.id, decision: 'APPROVE', note: 'No confirmation checkbox' });
  assert.equal(r.status, 400);
  r = await review(first, submission.id, 'APPROVE'); assert.equal(r.status, 200); assert.equal(r.body.payment.status, 'PAID');
  r = await review(first, submission.id, 'REJECT'); assert.equal(r.status, 409);
  const order = await prisma.order.findUnique({ where: { id: first.id } });
  assert.equal(order.status, 'CONFIRMED'); assert.equal(order.paymentStatus, 'PAID');
  r = await request(app).post(`/api/orders/${first.id}/cancel`).set('Authorization', credentials.customer);
  assert.equal(r.status, 409);
  assert.equal(await prisma.auditLog.count({ where: { entityId: first.payment.id, action: 'MANUAL_PAYMENT_APPROVED' } }), 1);
});

test('rejection exposes reason, permits corrected submission and prevents review of older evidence', async () => {
  const order = (await create()).body.order;
  const original = (await submit(order, 'TEST-INCORRECT')).body.submission;
  let r = await review(order, original.id, 'REJECT', 'Reference does not match our account statement');
  assert.equal(r.status, 200); assert.equal(r.body.payment.status, 'REJECTED');
  r = await request(app).get(`/api/payments/manual/${order.id}`).set('Authorization', credentials.customer);
  assert.match(r.body.submissions[0].reviewNote, /does not match/);
  assert.equal(r.body.submissions[0].referenceKey, undefined);
  const corrected = (await submit(order, 'TEST-CORRECTED')).body.submission;
  r = await review(order, original.id, 'APPROVE'); assert.equal(r.status, 409);
  r = await review(order, corrected.id, 'APPROVE'); assert.equal(r.status, 200);
  r = await request(app).get('/api/admin/payments').set('Authorization', credentials.admin);
  assert.equal(r.body.payments.find(item => item.id === order.payment.id).manualSubmissions.length, 2);
});

test('manual refund records money returned and permits cancellation only afterwards', async () => {
  let r = await request(app).post(`/api/admin/payments/${first.payment.id}/manual-refunded`).set('Authorization', credentials.admin).send({ note: 'Returned to test sender', confirmedReceived: true });
  assert.equal(r.status, 200); assert.equal(r.body.payment.status, 'REFUNDED');
  r = await request(app).post(`/api/admin/payments/${first.payment.id}/manual-refunded`).set('Authorization', credentials.admin).send({ note: 'Duplicate refund', confirmedReceived: true });
  assert.equal(r.status, 409);
  r = await request(app).post(`/api/orders/${first.id}/cancel`).set('Authorization', credentials.customer);
  assert.equal(r.status, 200); assert.equal(r.body.order.paymentStatus, 'REFUNDED');
  r = await submit(first, 'TEST-AFTER-CANCEL'); assert.equal(r.status, 409);
});
