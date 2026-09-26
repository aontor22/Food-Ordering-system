import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const runId = Date.now();
const password = 'StrongPass123!';
let adminToken;
let firstToken;
let secondToken;
let product;
let scheduledSlot;

const allDayHours = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  isClosed: false,
  open24Hours: true,
  openTime: '00:00',
  closeTime: '00:00',
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
    daysAhead: 2, defaultSlotCapacity: 1,
    pickupAddress: 'Test Restaurant, Dhaka', pickupInstructions: 'Show your order number.',
  });
  assert.equal(response.status, 200);

  response = await request(app).post('/api/auth/register').send({ name: 'Schedule Tester One', email: `schedule-one-${runId}@example.com`, password });
  assert.equal(response.status, 201);
  firstToken = response.body.accessToken;
  response = await request(app).post('/api/auth/register').send({ name: 'Schedule Tester Two', email: `schedule-two-${runId}@example.com`, password });
  assert.equal(response.status, 201);
  secondToken = response.body.accessToken;

  product = await prisma.product.findFirst({ where: { isAvailable: true, stock: { gte: 5 } } });
  assert.ok(product);
});

test('public fulfilment endpoint exposes ASAP and scheduled pickup slots', async () => {
  const response = await request(app).get('/api/store/fulfillment');
  assert.equal(response.status, 200);
  assert.equal(response.body.options.PICKUP.enabled, true);
  assert.equal(response.body.options.PICKUP.asapAvailable, true);
  assert.ok(response.body.options.PICKUP.slots.length > 0);
  scheduledSlot = response.body.options.PICKUP.slots[0];
  assert.equal(scheduledSlot.remaining, 1);
});

test('pickup quote has no delivery-zone requirement or delivery fee', async () => {
  const response = await request(app).post('/api/orders/quote').set('Authorization', `Bearer ${firstToken}`).send({
    items: [{ productId: product.id, quantity: 1 }], fulfillmentType: 'PICKUP', pointsToRedeem: 0,
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.quote.fulfillmentType, 'PICKUP');
  assert.equal(response.body.quote.deliveryZone, null);
  assert.equal(response.body.quote.deliveryFeeCents, 0);
});

test('scheduled pickup can be placed without a delivery address and stores slot snapshot', async () => {
  const email = `schedule-one-${runId}@example.com`;
  const response = await request(app).post('/api/orders').set('Authorization', `Bearer ${firstToken}`).send({
    items: [{ productId: product.id, quantity: 1 }],
    fulfillmentType: 'PICKUP', fulfillmentMode: 'SCHEDULED', scheduledForLocal: scheduledSlot.localKey,
    paymentMethod: 'COD',
    delivery: { firstName: 'Schedule', lastName: 'One', email, phone: '01700000001', notes: 'Pickup test' },
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.order.fulfillmentType, 'PICKUP');
  assert.equal(response.body.order.fulfillmentMode, 'SCHEDULED');
  assert.equal(response.body.order.scheduledForLocal, scheduledSlot.localKey);
  assert.equal(response.body.order.deliveryFeeCents, 0);
  assert.equal(response.body.order.street, null);
});

test('full slot disappears and a second customer cannot overbook it', async () => {
  let response = await request(app).get('/api/store/fulfillment');
  assert.equal(response.status, 200);
  assert.equal(response.body.options.PICKUP.slots.some(slot => slot.localKey === scheduledSlot.localKey), false);

  response = await request(app).post('/api/orders').set('Authorization', `Bearer ${secondToken}`).send({
    items: [{ productId: product.id, quantity: 1 }],
    fulfillmentType: 'PICKUP', fulfillmentMode: 'SCHEDULED', scheduledForLocal: scheduledSlot.localKey,
    paymentMethod: 'COD',
    delivery: { firstName: 'Schedule', lastName: 'Two', email: `schedule-two-${runId}@example.com`, phone: '01700000002' },
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'SLOT_UNAVAILABLE');
});

test('admin can close a specific future slot with an override', async () => {
  let response = await request(app).get('/api/store/fulfillment');
  const candidate = response.body.options.DELIVERY.slots[0];
  assert.ok(candidate);

  response = await request(app).post('/api/admin/fulfillment/slot-overrides').set('Authorization', `Bearer ${adminToken}`).send({
    dateKey: candidate.dateKey, timeKey: candidate.timeKey, fulfillmentType: 'DELIVERY', disabled: true, capacity: null, note: 'Integration test closure',
  });
  assert.equal(response.status, 201);
  const override = response.body.override;

  response = await request(app).get('/api/store/fulfillment');
  assert.equal(response.body.options.DELIVERY.slots.some(slot => slot.localKey === candidate.localKey), false);

  response = await request(app).delete(`/api/admin/fulfillment/slot-overrides/${override.id}`).set('Authorization', `Bearer ${adminToken}`);
  assert.equal(response.status, 204);
});
