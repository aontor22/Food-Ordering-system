import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const runId = Date.now();
const email = `test-${runId}@example.com`;
const adminEmail = `admin-test-${runId}@example.com`;
const adminPassword = 'AdminTest123!';
const testProductId = `test-product-${runId}`;
const testCouponCode = `TEST${String(runId).slice(-6)}`;
let token;
let adminToken;
let adminUserId;
let orderProductId;
let codOrderId;
let codPaymentId;

before(async () => {
  await prisma.$connect();
  const admin = await prisma.user.create({ data: { name: 'Test Administrator', email: adminEmail, role: 'ADMIN', passwordHash: await bcrypt.hash(adminPassword, 4) } });
  adminUserId = admin.id;
});
after(async () => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    const orders = await prisma.order.findMany({ where: { userId: user.id }, include: { items: true } });
    for (const order of orders.filter(order => order.status !== 'CANCELLED')) for (const item of order.items) await prisma.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
    await prisma.order.deleteMany({ where: { userId: user.id } });
    await prisma.auditLog.deleteMany({ where: { actorId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.product.deleteMany({ where: { id: testProductId } });
  await prisma.coupon.deleteMany({ where: { code: testCouponCode } });
  await prisma.auditLog.deleteMany({ where: { actorId: adminUserId } });
  await prisma.user.deleteMany({ where: { email: adminEmail } });
  await prisma.$disconnect();
});
test('health endpoint', async () => { const r = await request(app).get('/api/health'); assert.equal(r.status, 200); assert.equal(r.body.status, 'ok'); });
test('register, authenticate, list products, and place order', async () => {
  let r = await request(app).post('/api/auth/register').send({ name: 'Test User', email, password: 'StrongPass123!' }); assert.equal(r.status, 201); token = r.body.accessToken;
  r = await request(app).get('/api/products'); assert.equal(r.status, 200); assert.ok(r.body.products.length >= 1);
  orderProductId = r.body.products[0].id;
  r = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({ items: [{ productId: orderProductId, quantity: 1 }], paymentMethod: 'COD', delivery: { firstName: 'Test', lastName: 'User', email, phone: '01700000000', street: '123 Test Street', city: 'Dhaka', state: 'Dhaka', postalCode: '1200', country: 'Bangladesh' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.order.items.length, 1);
  assert.equal(r.body.order.payment.provider, 'COD');
  assert.equal(r.body.order.payment.status, 'PENDING');
  codOrderId = r.body.order.id;
  codPaymentId = r.body.order.payment.id;
});
test('rejects unauthenticated order access', async () => { const r = await request(app).get('/api/orders'); assert.equal(r.status, 401); });
test('supports a server-controlled online payment journey', async () => {
  let r = await request(app).get('/api/payments/options');
  assert.equal(r.status, 200);
  const online = r.body.methods.find(method => method.id === 'ONLINE');
  assert.equal(online.enabled, true);
  assert.equal(online.mode, 'demo');

  r = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({ items: [{ productId: orderProductId, quantity: 1 }], paymentMethod: 'ONLINE', delivery: { firstName: 'Test', lastName: 'User', email, phone: '01700000000', street: '123 Test Street', city: 'Dhaka', state: 'Dhaka', postalCode: '1200', country: 'Bangladesh' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.order.payment.provider, 'DEMO');
  assert.equal(r.body.order.payment.status, 'PROCESSING');
  assert.equal(r.body.paymentMode, 'demo');
  assert.ok(r.body.paymentUrl.startsWith('/payment/demo/'));
  const onlineOrder = r.body.order;
  const paymentUrl = new URL(r.body.paymentUrl, 'http://localhost:5173');
  const transactionId = paymentUrl.pathname.split('/').at(-1);
  const signature = paymentUrl.searchParams.get('signature');

  r = await request(app).get(`/api/payments/demo/${transactionId}`).query({ signature });
  assert.equal(r.status, 401);
  r = await request(app).get(`/api/payments/demo/${transactionId}`).query({ signature }).set('Authorization', `Bearer ${token}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.order.id, onlineOrder.id);

  r = await request(app).post('/api/auth/login').send({ email: adminEmail, password: adminPassword });
  assert.equal(r.status, 200);
  adminToken = r.body.accessToken;
  r = await request(app).patch(`/api/admin/orders/${onlineOrder.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'CONFIRMED' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'PAYMENT_REQUIRED');

  r = await request(app).post(`/api/payments/demo/${transactionId}/complete`).set('Authorization', `Bearer ${token}`).send({ signature, outcome: 'success' });
  assert.equal(r.status, 200);
  assert.equal(r.body.order.paymentStatus, 'PAID');
  assert.equal(r.body.order.payment.status, 'PAID');
  assert.equal(r.body.order.status, 'CONFIRMED');

  r = await request(app).post(`/api/orders/${onlineOrder.id}/cancel`).set('Authorization', `Bearer ${token}`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'REFUND_REQUIRED');
  r = await request(app).post(`/api/admin/payments/${onlineOrder.payment.id}/cash-received`).set('Authorization', `Bearer ${adminToken}`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'GATEWAY_VERIFICATION_REQUIRED');
});
test('enforces admin authorization and supports management operations', async () => {
  let r = await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${token}`);
  assert.equal(r.status, 403);

  if (!adminToken) {
    r = await request(app).post('/api/auth/login').send({ email: adminEmail, password: adminPassword });
    assert.equal(r.status, 200);
    adminToken = r.body.accessToken;
  }

  r = await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(r.status, 200);
  assert.ok(r.body.metrics);
  assert.ok(Array.isArray(r.body.revenueByDay));

  r = await request(app).get('/api/admin/media').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.configured, false);
  assert.equal(typeof r.body.legacyImageCount, 'number');
  r = await request(app).post('/api/admin/media/signature').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, 'CLOUDINARY_NOT_CONFIGURED');

  r = await request(app).post('/api/admin/products').set('Authorization', `Bearer ${adminToken}`).send({ id: testProductId, name: 'Test Meal', description: 'Created by the API integration test', category: 'Test', imageUrl: null, priceCents: 1299, stock: 5, isAvailable: true });
  assert.equal(r.status, 201);
  assert.equal(r.body.product.id, testProductId);

  r = await request(app).patch(`/api/admin/products/${testProductId}`).set('Authorization', `Bearer ${adminToken}`).send({ stock: 9 });
  assert.equal(r.status, 200);
  assert.equal(r.body.product.stock, 9);

  r = await request(app).post('/api/admin/coupons').set('Authorization', `Bearer ${adminToken}`).send({ code: testCouponCode, percentOff: 15, minimumCents: 1000, active: true, expiresAt: null });
  assert.equal(r.status, 201);

  r = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(r.status, 200);
  assert.ok(r.body.users.some(user => user.email === email));

  r = await request(app).get('/api/admin/payments').set('Authorization', `Bearer ${token}`);
  assert.equal(r.status, 403);
  r = await request(app).get('/api/admin/payments').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(r.status, 200);
  assert.ok(r.body.payments.some(payment => payment.provider === 'DEMO' && payment.status === 'PAID'));
  assert.ok(r.body.payments.some(payment => payment.id === codPaymentId && payment.order.id === codOrderId));

  r = await request(app).post(`/api/admin/payments/${codPaymentId}/cash-received`).set('Authorization', `Bearer ${adminToken}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.payment.status, 'PAID');
  r = await request(app).post(`/api/admin/payments/${codPaymentId}/cash-refunded`).set('Authorization', `Bearer ${adminToken}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.payment.status, 'REFUNDED');
  r = await request(app).post(`/api/admin/payments/${codPaymentId}/cash-received`).set('Authorization', `Bearer ${adminToken}`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'PAYMENT_REFUNDED');

  r = await request(app).get('/api/admin/audit-logs').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(r.status, 200);
  assert.ok(r.body.logs.some(log => log.action === 'PRODUCT_CREATED'));
  r = await request(app).post('/api/admin/payment-channels').set('Authorization', `Bearer ${adminToken}`).send({ provider: 'BKASH', label: 'Test merchant', account: 'TEST-ACCOUNT', instructions: 'Test only; never pay', active: true });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'CURRENCY_MISMATCH');
});

test('failed demo payment can retry, invalid signatures and cancelled sessions cannot settle', async () => {
  const auth = `Bearer ${token}`;
  const created = await request(app).post('/api/orders').set('Authorization', auth).send({ items: [{ productId: orderProductId, quantity: 1 }], paymentMethod: 'ONLINE', delivery: { firstName: 'Test', lastName: 'User', email, phone: '01700000000', street: '123 Test Street', city: 'Dhaka', state: 'Dhaka', postalCode: '1200', country: 'Bangladesh' } });
  assert.equal(created.status, 201);
  const url = new URL(created.body.paymentUrl, 'http://localhost');
  const transaction = url.pathname.split('/').at(-1);
  const signature = url.searchParams.get('signature');
  let r = await request(app).post(`/api/payments/demo/${transaction}/complete`).set('Authorization', auth).send({ signature: 'invalid-signature', outcome: 'success' });
  assert.equal(r.status, 404);
  r = await request(app).post(`/api/payments/demo/${transaction}/complete`).set('Authorization', auth).send({ signature, outcome: 'fail' });
  assert.equal(r.body.order.paymentStatus, 'FAILED');
  r = await request(app).post(`/api/payments/orders/${created.body.order.id}/initiate`).set('Authorization', `Bearer ${adminToken}`);
  assert.equal(r.status, 404);
  r = await request(app).post(`/api/payments/orders/${created.body.order.id}/initiate`).set('Authorization', auth);
  assert.equal(r.status, 200);
  const retry = new URL(r.body.paymentUrl, 'http://localhost');
  assert.notEqual(retry.pathname.split('/').at(-1), transaction);
  r = await request(app).post(`/api/orders/${created.body.order.id}/cancel`).set('Authorization', auth);
  assert.equal(r.status, 200);
  r = await request(app).post(`/api/payments/demo/${retry.pathname.split('/').at(-1)}/complete`).set('Authorization', auth).send({ signature: retry.searchParams.get('signature'), outcome: 'success' });
  assert.equal(r.status, 409);
  r = await request(app).post(`/api/orders/${created.body.order.id}/cancel`).set('Authorization', auth);
  assert.equal(r.status, 409);
});

test('disabling an account invalidates its existing access token', async () => {
  const user = await prisma.user.findUnique({ where: { email } });
  await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
  const r = await request(app).get('/api/orders').set('Authorization', `Bearer ${token}`);
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, 'ACCOUNT_DISABLED');
});

test('COD orders keep a one-to-one payment ledger record', async () => {
  const record = await prisma.payment.findUnique({ where: { orderId: codOrderId } });
  assert.ok(record);
  assert.equal(record.id, codPaymentId);
  assert.equal(record.provider, 'COD');
});
