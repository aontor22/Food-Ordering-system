import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const runId = Date.now();
const customerEmail = `store-hours-${runId}@example.com`;
const password = 'StrongPass123!';
let adminToken;
let customerToken;
let productId;

const allDayHours = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  isClosed: false,
  open24Hours: true,
  openTime: '00:00',
  closeTime: '00:00',
}));

async function saveOperations(values = {}) {
  return request(app).patch('/api/admin/store-operations')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      timezone: 'Asia/Dhaka',
      acceptingOrders: true,
      temporaryClosed: false,
      temporaryClosedReason: null,
      temporaryClosedUntilLocal: null,
      hours: allDayHours,
      ...values,
    });
}

before(async () => {
  await prisma.$connect();
  let response = await request(app).post('/api/auth/login').send({
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  assert.equal(response.status, 200);
  adminToken = response.body.accessToken;

  response = await request(app).post('/api/auth/register').send({ name: 'Store Hours Test', email: customerEmail, password });
  assert.equal(response.status, 201);
  customerToken = response.body.accessToken;
  const products = await prisma.product.findMany({ where: { isAvailable: true, stock: { gt: 0 } }, take: 1 });
  productId = products[0].id;
});

after(async () => {
  await saveOperations();
  await prisma.restaurantClosure.deleteMany({ where: { reason: 'Store availability test closure' } });
  const user = await prisma.user.findUnique({ where: { email: customerEmail } });
  if (user) {
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.auditLog.deleteMany({ where: { actorId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.$disconnect();
});

test('public store status exposes the weekly schedule', async () => {
  const response = await request(app).get('/api/store/status');
  assert.equal(response.status, 200);
  assert.equal(Array.isArray(response.body.store.schedule), true);
  assert.equal(response.body.store.schedule.length, 7);
  assert.equal(typeof response.body.store.isOpen, 'boolean');
});

test('admin can pause orders and server blocks checkout', async () => {
  let response = await saveOperations({ acceptingOrders: false });
  assert.equal(response.status, 200);
  assert.equal(response.body.status.code, 'PAUSED');

  response = await request(app).get('/api/store/status');
  assert.equal(response.body.store.isOpen, false);
  assert.equal(response.body.store.code, 'PAUSED');

  response = await request(app).post('/api/orders').set('Authorization', `Bearer ${customerToken}`).send({
    items: [{ productId, quantity: 1 }],
    paymentMethod: 'COD',
    delivery: {
      firstName: 'Store', lastName: 'Test', email: customerEmail, phone: '01700000000',
      street: '123 Test Street', city: 'Dhaka', state: 'Dhaka', postalCode: '1200', country: 'Bangladesh',
    },
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'RESTAURANT_CLOSED');
});

test('temporary closure and holiday CRUD work and reopening restores checkout', async () => {
  let response = await saveOperations({ acceptingOrders: true, temporaryClosed: true, temporaryClosedReason: 'Kitchen maintenance' });
  assert.equal(response.status, 200);
  assert.equal(response.body.status.code, 'TEMPORARY_CLOSED');

  const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  response = await request(app).post('/api/admin/store-closures').set('Authorization', `Bearer ${adminToken}`).send({ dateKey: future, reason: 'Store availability test closure' });
  assert.equal(response.status, 201);
  const closure = response.body.closure;
  assert.equal(closure.dateKey, future);

  response = await request(app).delete(`/api/admin/store-closures/${closure.id}`).set('Authorization', `Bearer ${adminToken}`);
  assert.equal(response.status, 204);

  response = await saveOperations();
  assert.equal(response.status, 200);
  assert.equal(response.body.status.isOpen, true);
});
