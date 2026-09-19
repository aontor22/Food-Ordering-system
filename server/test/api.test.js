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

before(async () => {
  await prisma.$connect();
  const admin = await prisma.user.create({ data: { name: 'Test Administrator', email: adminEmail, role: 'ADMIN', passwordHash: await bcrypt.hash(adminPassword, 4) } });
  adminUserId = admin.id;
});
after(async () => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    const orders = await prisma.order.findMany({ where: { userId: user.id }, include: { items: true } });
    for (const order of orders) for (const item of order.items) await prisma.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
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
  r = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({ items: [{ productId: r.body.products[0].id, quantity: 1 }], paymentMethod: 'COD', delivery: { firstName: 'Test', lastName: 'User', email, phone: '01700000000', street: '123 Test Street', city: 'Dhaka', state: 'Dhaka', postalCode: '1200', country: 'Bangladesh' } }); assert.equal(r.status, 201); assert.equal(r.body.order.items.length, 1);
});
test('rejects unauthenticated order access', async () => { const r = await request(app).get('/api/orders'); assert.equal(r.status, 401); });
test('enforces admin authorization and supports management operations', async () => {
  let r = await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${token}`);
  assert.equal(r.status, 403);

  r = await request(app).post('/api/auth/login').send({ email: adminEmail, password: adminPassword });
  assert.equal(r.status, 200);
  adminToken = r.body.accessToken;

  r = await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(r.status, 200);
  assert.ok(r.body.metrics);
  assert.ok(Array.isArray(r.body.revenueByDay));

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

  r = await request(app).get('/api/admin/audit-logs').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(r.status, 200);
  assert.ok(r.body.logs.some(log => log.action === 'PRODUCT_CREATED'));
});
