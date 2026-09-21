import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const runId = Date.now();
const email = `loyalty-user-${runId}@example.com`;
const adminEmail = `loyalty-admin-${runId}@example.com`;
const adminPassword = 'LoyaltyAdmin123!';
const productId = `loyalty-product-${runId}`;
let token;
let adminToken;
let userId;
let adminId;
let deliveredOrderId;
let deliveredItemId;
let redeemOrderId;
let originalSettings;

const delivery = {
  firstName: 'Points', lastName: 'Tester', email, phone: '01700000000',
  street: '123 Rewards Road', city: 'Dhaka', state: 'Dhaka', postalCode: '1200', country: 'Bangladesh',
};

before(async () => {
  await prisma.$connect();
  originalSettings = await prisma.loyaltySetting.findUnique({ where: { id: 'default' } });
  const admin = await prisma.user.create({ data: { name: 'Loyalty Administrator', email: adminEmail, role: 'ADMIN', passwordHash: await bcrypt.hash(adminPassword, 4) } });
  adminId = admin.id;
  await prisma.product.create({ data: { id: productId, name: 'Rewards Test Meal', description: 'High value meal used to test Tomato Points and reviews', category: 'Test', priceCents: 10000, stock: 20, isAvailable: true } });
});

after(async () => {
  if (originalSettings) {
    await prisma.loyaltySetting.update({
      where: { id: 'default' },
      data: {
        enabled: originalSettings.enabled,
        pointsPerOrder: originalSettings.pointsPerOrder,
        minimumRedeemPoints: originalSettings.minimumRedeemPoints,
        pointValueCents: originalSettings.pointValueCents,
      },
    });
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    await prisma.auditLog.deleteMany({ where: { actorId: user.id } });
    await prisma.order.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.user.deleteMany({ where: { email: adminEmail } });
  await prisma.$disconnect();
});

test('admin configures Tomato Points and delivered orders award points once', async () => {
  let response = await request(app).post('/api/auth/register').send({ name: 'Loyalty User', email, password: 'StrongPass123!' });
  assert.equal(response.status, 201);
  token = response.body.accessToken;
  userId = response.body.user.id;

  response = await request(app).post('/api/auth/login').send({ email: adminEmail, password: adminPassword });
  assert.equal(response.status, 200);
  adminToken = response.body.accessToken;

  response = await request(app).patch('/api/admin/loyalty').set('Authorization', `Bearer ${adminToken}`).send({ enabled: true, pointsPerOrder: 50, minimumRedeemPoints: 50, pointValueCents: 100 });
  assert.equal(response.status, 200);
  assert.equal(response.body.settings.pointsPerOrder, 50);

  response = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({ items: [{ productId, quantity: 1 }], paymentMethod: 'COD', delivery });
  assert.equal(response.status, 201);
  deliveredOrderId = response.body.order.id;
  deliveredItemId = response.body.order.items[0].id;

  for (const status of ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
    response = await request(app).patch(`/api/admin/orders/${deliveredOrderId}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status });
    assert.equal(response.status, 200, `expected ${status} transition to succeed`);
  }
  assert.equal(response.body.pointsAwarded, 50);
  assert.equal(response.body.order.pointsEarned, 50);
  assert.equal(response.body.order.user.pointsBalance, 50);

  response = await request(app).get('/api/orders/loyalty').set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.loyalty.pointsBalance, 50);
});

test('points quote, redemption and cancellation restore are server controlled', async () => {
  let response = await request(app).post('/api/orders/quote').set('Authorization', `Bearer ${token}`).send({ items: [{ productId, quantity: 1 }], pointsToRedeem: 50 });
  assert.equal(response.status, 200);
  assert.equal(response.body.quote.pointsDiscountCents, 5000);
  assert.equal(response.body.quote.totalCents, 5200);
  assert.equal(response.body.quote.loyalty.maxRedeemPoints, 50);

  response = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({ items: [{ productId, quantity: 1 }], pointsToRedeem: 50, paymentMethod: 'COD', delivery });
  assert.equal(response.status, 201);
  redeemOrderId = response.body.order.id;
  assert.equal(response.body.order.pointsRedeemed, 50);
  assert.equal(response.body.order.pointsDiscountCents, 5000);
  assert.equal(response.body.loyalty.pointsBalance, 0);

  response = await request(app).post(`/api/orders/${redeemOrderId}/cancel`).set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.order.status, 'CANCELLED');
  assert.equal(response.body.loyalty.pointsBalance, 50);

  const transactions = await prisma.loyaltyTransaction.findMany({ where: { orderId: redeemOrderId }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(transactions.map(item => item.type).sort(), ['REDEEM', 'RESTORE']);
});

test('only delivered purchases can be reviewed and admin moderation controls storefront visibility', async () => {
  let response = await request(app).put(`/api/orders/${deliveredOrderId}/items/${deliveredItemId}/review`).set('Authorization', `Bearer ${token}`).send({ rating: 5, comment: 'Fresh, hot and exactly as ordered.' });
  assert.equal(response.status, 201);
  const reviewId = response.body.review.id;

  response = await request(app).get(`/api/products/${productId}/reviews`);
  assert.equal(response.status, 200);
  assert.equal(response.body.reviewCount, 1);
  assert.equal(response.body.averageRating, 5);
  assert.equal(response.body.reviews[0].comment, 'Fresh, hot and exactly as ordered.');

  response = await request(app).patch(`/api/admin/reviews/${reviewId}`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'HIDDEN' });
  assert.equal(response.status, 200);
  assert.equal(response.body.review.status, 'HIDDEN');

  response = await request(app).get(`/api/products/${productId}/reviews`);
  assert.equal(response.status, 200);
  assert.equal(response.body.reviewCount, 0);

  response = await request(app).patch(`/api/admin/reviews/${reviewId}`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'PUBLISHED' });
  assert.equal(response.status, 200);
  response = await request(app).put(`/api/orders/${deliveredOrderId}/items/${deliveredItemId}/review`).set('Authorization', `Bearer ${token}`).send({ rating: 4, comment: 'Still very good on the second thought.' });
  assert.equal(response.status, 200);
  assert.equal(response.body.review.rating, 4);

  response = await request(app).get('/api/products');
  assert.equal(response.status, 200);
  const product = response.body.products.find(item => item.id === productId);
  assert.equal(product.reviewCount, 1);
  assert.equal(product.reviewRating, 4);
});

test('points program can be paused without deleting balances', async () => {
  let response = await request(app).patch('/api/admin/loyalty').set('Authorization', `Bearer ${adminToken}`).send({ enabled: false, pointsPerOrder: 50, minimumRedeemPoints: 50, pointValueCents: 100 });
  assert.equal(response.status, 200);

  response = await request(app).post('/api/orders/quote').set('Authorization', `Bearer ${token}`).send({ items: [{ productId, quantity: 1 }], pointsToRedeem: 50 });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'LOYALTY_DISABLED');

  const customer = await prisma.user.findUnique({ where: { id: userId } });
  assert.equal(customer.pointsBalance, 50);
});
