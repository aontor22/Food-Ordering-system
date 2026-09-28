import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { linkEligibleGuestOrdersForVerifiedUser } from '../src/services/guest-orders.js';

const runId = Date.now();
const password = 'StrongPass123!';
const guestEmail = `guest-${runId}@example.com`;
let adminToken;
let product;
let deliveryZone;
let guestOrder;
let guestToken;
let linkedToken;
let guestItemId;

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
    daysAhead: 3, defaultSlotCapacity: 10,
    pickupAddress: 'Test Restaurant, Dhaka', pickupInstructions: 'Show the private order number.',
  });
  assert.equal(response.status, 200);
  product = await prisma.product.findFirst({ where: { isAvailable: true, stock: { gte: 10 } } });
  assert.ok(product);
  const zones = await request(app).get('/api/store/delivery-zones');
  assert.equal(zones.status, 200);
  deliveryZone = zones.body.zones[0];
  assert.ok(deliveryZone);
});

test('guest quote is public but cannot redeem account points', async () => {
  let response = await request(app).post('/api/orders/guest/quote').send({
    items: [{ productId: product.id, quantity: 1 }], fulfillmentType: 'DELIVERY', deliveryZoneId: deliveryZone.id, postalCode: '1200', pointsToRedeem: 0,
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.quote.loyalty.guestCheckout, true);
  assert.equal(response.body.quote.loyalty.pointsBalance, 0);

  response = await request(app).post('/api/orders/guest/quote').send({
    items: [{ productId: product.id, quantity: 1 }], fulfillmentType: 'DELIVERY', deliveryZoneId: deliveryZone.id, postalCode: '1200', pointsToRedeem: 1,
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'GUEST_POINTS_NOT_AVAILABLE');
});

test('guest can place an ASAP delivery order and only its private token can read it', async () => {
  const response = await request(app).post('/api/orders/guest').send({
    items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'COD', fulfillmentType: 'DELIVERY', fulfillmentMode: 'ASAP', deliveryZoneId: deliveryZone.id,
    delivery: { firstName: 'Guest', lastName: 'Buyer', email: guestEmail, phone: '01700000111', street: '123 Guest Road', city: 'Dhaka', state: 'Dhaka', postalCode: '1200', country: 'Bangladesh' },
  });
  assert.equal(response.status, 201);
  guestOrder = response.body.order;
  guestToken = response.body.guestAccess.token;
  guestItemId = guestOrder.items[0].id;
  assert.equal(guestOrder.customerType, 'GUEST');
  assert.equal(guestOrder.userId, null);
  assert.equal(guestOrder.pointsEarned, 0);
  assert.ok(guestToken.length > 40);
  assert.equal('guestAccessNonce' in guestOrder, false);

  let read = await request(app).get('/api/orders/guest');
  assert.equal(read.status, 401);
  read = await request(app).get('/api/orders/guest').set('X-Order-Access-Token', 'not-a-real-token-value-123456789');
  assert.equal(read.status, 401);
  read = await request(app).get('/api/orders/guest').set('X-Order-Access-Token', guestToken);
  assert.equal(read.status, 200);
  assert.equal(read.body.order.id, guestOrder.id);
  assert.equal('guestAccessNonce' in read.body.order, false);

  const predictable = await request(app).get(`/api/orders/${guestOrder.id}`);
  assert.equal(predictable.status, 401);
  const guestTokenAsAccountToken = await request(app).get('/api/orders').set('Authorization', `Bearer ${guestToken}`);
  assert.equal(guestTokenAsAccountToken.status, 401);
});

test('guest can also reserve a scheduled pickup slot without a delivery address', async () => {
  const fulfillment = await request(app).get('/api/store/fulfillment');
  const slot = fulfillment.body.options.PICKUP.slots[0];
  assert.ok(slot);
  const response = await request(app).post('/api/orders/guest').send({
    items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'COD', fulfillmentType: 'PICKUP', fulfillmentMode: 'SCHEDULED', scheduledForLocal: slot.localKey,
    delivery: { firstName: 'Pickup', lastName: 'Guest', email: `pickup-${runId}@example.com`, phone: '01700000112' },
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.order.fulfillmentType, 'PICKUP');
  assert.equal(response.body.order.fulfillmentMode, 'SCHEDULED');
  assert.equal(response.body.order.street, null);
  assert.equal(response.body.order.deliveryFeeCents, 0);
  assert.ok(response.body.guestAccess.token);
});

test('guest manual payment uses the same secure token boundary', async () => {
  let response = await request(app).post('/api/admin/payment-channels').set('Authorization', `Bearer ${adminToken}`).send({
    provider: 'BANK', label: 'Guest test bank', account: 'TEST-BANK-ACCOUNT', instructions: 'Test transfer instructions only.', active: true,
  });
  assert.equal(response.status, 201);
  const channel = response.body.channel;

  response = await request(app).post('/api/orders/guest').send({
    items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'MANUAL', manualChannelId: channel.id, fulfillmentType: 'PICKUP', fulfillmentMode: 'ASAP',
    delivery: { firstName: 'Manual', lastName: 'Guest', email: `manual-guest-${runId}@example.com`, phone: '01700000113' },
  });
  assert.equal(response.status, 201);
  const order = response.body.order;
  const token = response.body.guestAccess.token;

  let payment = await request(app).get(`/api/payments/guest/manual/${order.id}`);
  assert.equal(payment.status, 401);
  payment = await request(app).get(`/api/payments/guest/manual/${order.id}`).set('X-Order-Access-Token', token);
  assert.equal(payment.status, 200);
  assert.equal(payment.body.payment.manualDestination.account, 'TEST-BANK-ACCOUNT');

  const submission = await request(app).post(`/api/payments/guest/manual/${order.id}/submit`).set('X-Order-Access-Token', token).send({
    reference: `GUEST-${runId}`, sender: 'Guest test sender', note: 'Guest token protected submission',
  });
  assert.equal(submission.status, 201);
  assert.equal(submission.body.submission.amountCents, order.totalCents);
});

test('guest demo payment can be opened and completed only with the private order token', async () => {
  let response = await request(app).post('/api/orders/guest').send({
    items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'ONLINE', fulfillmentType: 'PICKUP', fulfillmentMode: 'ASAP',
    delivery: { firstName: 'Online', lastName: 'Guest', email: `online-guest-${runId}@example.com`, phone: '01700000114' },
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.paymentMode, 'demo');
  const order = response.body.order;
  const token = response.body.guestAccess.token;
  const paymentUrl = new URL(response.body.paymentUrl, 'http://localhost');
  const transactionId = paymentUrl.pathname.split('/').at(-1);
  const signature = paymentUrl.searchParams.get('signature');
  assert.ok(transactionId && signature);

  let session = await request(app).get(`/api/payments/guest/demo/${transactionId}`).query({ signature });
  assert.equal(session.status, 401);
  session = await request(app).get(`/api/payments/guest/demo/${transactionId}`).set('X-Order-Access-Token', token).query({ signature });
  assert.equal(session.status, 200);
  assert.equal(session.body.order.id, order.id);

  const completed = await request(app).post(`/api/payments/guest/demo/${transactionId}/complete`).set('X-Order-Access-Token', token).send({ signature, outcome: 'success' });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.order.paymentStatus, 'PAID');
  assert.equal(completed.body.order.status, 'CONFIRMED');
});

test('verified matching email can auto-link an eligible unclaimed guest order', async () => {
  const email = `verified-guest-${runId}@example.com`;
  const created = await request(app).post('/api/orders/guest').send({
    items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'COD', fulfillmentType: 'PICKUP', fulfillmentMode: 'ASAP',
    delivery: { firstName: 'Verified', lastName: 'Guest', email, phone: '01700000115' },
  });
  assert.equal(created.status, 201);
  const user = await prisma.user.create({ data: { name: 'Verified Guest', email, passwordHash: 'unused', emailVerifiedAt: new Date() } });
  const linked = await linkEligibleGuestOrdersForVerifiedUser(user.id);
  assert.equal(linked.linked, 1);
  const stored = await prisma.order.findUnique({ where: { id: created.body.order.id } });
  assert.equal(stored.userId, user.id);
  assert.equal(stored.customerType, 'GUEST');
  assert.ok(stored.guestLinkedAt);
});

test('admin sees guest provenance without receiving the guest secret', async () => {
  const response = await request(app).get('/api/admin/orders').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(response.status, 200);
  const found = response.body.orders.find(order => order.id === guestOrder.id);
  assert.ok(found);
  assert.equal(found.customerType, 'GUEST');
  assert.equal(found.userId, null);
  assert.equal('guestAccessNonce' in found, false);
  const delivery = await prisma.notificationDelivery.findFirst({ where: { orderId: guestOrder.id, eventType: 'PENDING', channel: 'EMAIL' } });
  assert.ok(delivery);
  const payload = JSON.parse(delivery.payloadJson);
  assert.equal(payload.guest, true);
  assert.equal(payload.url, null);
  assert.equal(delivery.payloadJson.includes(guestToken), false);
});

test('delivered anonymous order earns no points, wrong account cannot claim, matching token+email can link and then review', async () => {
  for (const status of ['CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
    const updated = await request(app).patch(`/api/admin/orders/${guestOrder.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status });
    assert.equal(updated.status, 200, `${status}: ${JSON.stringify(updated.body)}`);
  }
  let stored = await prisma.order.findUnique({ where: { id: guestOrder.id } });
  assert.equal(stored.userId, null);
  assert.equal(stored.pointsEarned, 0);
  assert.equal(stored.pointsAwardedAt, null);

  let response = await request(app).post('/api/auth/register').send({ name: 'Wrong Account', email: `wrong-${runId}@example.com`, password });
  assert.equal(response.status, 201);
  const wrongToken = response.body.accessToken;
  response = await request(app).post('/api/orders/guest/link').set('Authorization', `Bearer ${wrongToken}`).send({ token: guestToken });
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'GUEST_EMAIL_MISMATCH');

  response = await request(app).post('/api/auth/register').send({ name: 'Guest Buyer', email: guestEmail, password });
  assert.equal(response.status, 201);
  linkedToken = response.body.accessToken;
  response = await request(app).post('/api/orders/guest/link').set('Authorization', `Bearer ${linkedToken}`).send({ token: guestToken });
  assert.equal(response.status, 200);
  assert.ok(response.body.order.userId);
  assert.equal(response.body.order.customerType, 'GUEST');
  assert.ok(response.body.pointsAwarded > 0);
  assert.equal('guestAccessNonce' in response.body.order, false);

  stored = await prisma.order.findUnique({ where: { id: guestOrder.id }, include: { user: true } });
  assert.equal(stored.user.email, guestEmail);
  const loyalty = await request(app).get('/api/orders/loyalty').set('Authorization', `Bearer ${linkedToken}`);
  assert.equal(loyalty.status, 200);
  assert.equal(loyalty.body.loyalty.pointsBalance, stored.pointsEarned);
  assert.ok(stored.pointsEarned > 0);
  assert.equal(response.body.pointsAwarded, stored.pointsEarned);

  const relink = await request(app).post('/api/orders/guest/link').set('Authorization', `Bearer ${linkedToken}`).send({ token: guestToken });
  assert.equal(relink.status, 200);
  assert.equal(relink.body.linkedNow, false);
  assert.equal(relink.body.pointsAwarded, 0);
  assert.equal(relink.body.loyalty.pointsBalance, stored.pointsEarned);

  const adminView = await request(app).get('/api/admin/orders').set('Authorization', `Bearer ${adminToken}`);
  const linkedAdminOrder = adminView.body.orders.find(order => order.id === guestOrder.id);
  assert.equal(linkedAdminOrder.customerType, 'GUEST');
  assert.equal(linkedAdminOrder.userId, stored.userId);
  assert.equal('guestAccessNonce' in linkedAdminOrder, false);

  response = await request(app).put(`/api/orders/${guestOrder.id}/items/${guestItemId}/review`).set('Authorization', `Bearer ${linkedToken}`).send({ rating: 5, comment: 'Guest purchase linked securely after delivery.' });
  assert.equal(response.status, 201);
});
