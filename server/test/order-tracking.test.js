import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const runId = Date.now();
const password = 'StrongPass123!';
let adminToken;
let customerToken;
let product;
let orderId;

const allDayHours = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek, isClosed: false, open24Hours: true, openTime: '00:00', closeTime: '00:00',
}));

before(async () => {
  await prisma.$connect();
  let response = await request(app).post('/api/auth/login').send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  assert.equal(response.status, 200);
  adminToken = response.body.accessToken;

  response = await request(app).patch('/api/admin/store-operations').set('Authorization', `Bearer ${adminToken}`).send({
    timezone: 'Asia/Dhaka', acceptingOrders: true, temporaryClosed: false,
    temporaryClosedReason: null, temporaryClosedUntilLocal: null, hours: allDayHours,
  });
  assert.equal(response.status, 200);

  response = await request(app).patch('/api/admin/fulfillment').set('Authorization', `Bearer ${adminToken}`).send({
    deliveryEnabled: true, pickupEnabled: true, asapEnabled: true, scheduledEnabled: true,
    deliveryLeadMinutes: 0, pickupLeadMinutes: 0, slotIntervalMinutes: 30,
    daysAhead: 2, defaultSlotCapacity: 10,
    pickupAddress: 'Tracking Test Restaurant', pickupInstructions: 'Show your order number.',
  });
  assert.equal(response.status, 200);

  response = await request(app).post('/api/auth/register').send({ name: 'Tracking Tester', email: `tracking-${runId}@example.com`, password });
  assert.equal(response.status, 201);
  customerToken = response.body.accessToken;
  product = await prisma.product.findFirst({ where: { isAvailable: true, stock: { gte: 3 } } });
  assert.ok(product);
});

test('new order starts with a persisted customer-visible tracking event', async () => {
  const response = await request(app).post('/api/orders').set('Authorization', `Bearer ${customerToken}`).send({
    items: [{ productId: product.id, quantity: 1 }],
    fulfillmentType: 'PICKUP', fulfillmentMode: 'ASAP', paymentMethod: 'COD',
    delivery: { firstName: 'Tracking', lastName: 'Tester', email: `tracking-${runId}@example.com`, phone: '01700000010' },
  });
  assert.equal(response.status, 201);
  orderId = response.body.order.id;
  assert.equal(response.body.order.status, 'PENDING');
  assert.equal(response.body.order.trackingEvents.length, 1);
  assert.equal(response.body.order.trackingEvents[0].title, 'Order placed');
  const queued = await prisma.notificationDelivery.findMany({ where: { orderId } });
  assert.ok(queued.some(item => item.eventType === 'PENDING' && item.channel === 'EMAIL'));
});

test('admin status changes create timeline events and preparation ETA', async () => {
  let response = await request(app).patch(`/api/admin/orders/${orderId}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'CONFIRMED' });
  assert.equal(response.status, 200);
  assert.ok(response.body.order.confirmedAt);
  assert.ok(await prisma.notificationDelivery.findFirst({ where: { orderId, eventType: 'CONFIRMED', channel: 'EMAIL' } }));

  response = await request(app).patch(`/api/admin/orders/${orderId}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'PREPARING', estimateMinutes: 20 });
  assert.equal(response.status, 200);
  assert.ok(response.body.order.preparingAt);
  assert.ok(response.body.order.estimatedReadyAt);
  assert.equal(response.body.order.trackingEvents.at(-1).status, 'PREPARING');
});

test('admin can revise ETA without changing order status', async () => {
  const response = await request(app).patch(`/api/admin/orders/${orderId}/eta`).set('Authorization', `Bearer ${adminToken}`).send({ minutes: 10 });
  assert.equal(response.status, 200);
  assert.equal(response.body.order.status, 'PREPARING');
  assert.equal(response.body.order.trackingEvents.at(-1).kind, 'ETA');
  assert.match(response.body.order.trackingEvents.at(-1).note, /10 minutes/);
});

test('pickup order completes through ready and delivered with full timeline', async () => {
  let response = await request(app).patch(`/api/admin/orders/${orderId}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'READY_FOR_PICKUP' });
  assert.equal(response.status, 200);
  assert.ok(response.body.order.readyAt);

  response = await request(app).patch(`/api/admin/orders/${orderId}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'DELIVERED' });
  assert.equal(response.status, 200);
  assert.ok(response.body.order.deliveredAt);
  assert.equal(response.body.order.trackingEvents.at(-1).status, 'DELIVERED');

  response = await request(app).get('/api/orders').set('Authorization', `Bearer ${customerToken}`);
  const order = response.body.orders.find(item => item.id === orderId);
  assert.ok(order);
  assert.ok(order.trackingEvents.length >= 6);
  assert.equal(order.status, 'DELIVERED');
});
