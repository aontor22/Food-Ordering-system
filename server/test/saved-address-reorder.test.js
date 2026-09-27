import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const runId = Date.now();
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;
const email = `step12-${runId}@example.com`;
const otherEmail = `step12-other-${runId}@example.com`;
const password = 'StrongPass123!';
const productId = `step12-product-${runId}`;
let token;
let otherToken;
let adminToken;
let firstAddressId;
let secondAddressId;
let orderId;

before(async () => {
  await prisma.$connect();
  let response = await request(app).post('/api/auth/login').send({ email: adminEmail, password: adminPassword });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  adminToken = response.body.accessToken;

  response = await request(app).post('/api/auth/register').send({ name: 'Step Twelve Buyer', email, password });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  token = response.body.accessToken;

  response = await request(app).post('/api/auth/register').send({ name: 'Other Buyer', email: otherEmail, password });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  otherToken = response.body.accessToken;

  response = await request(app).post('/api/admin/products').set('Authorization', `Bearer ${adminToken}`).send({
    id: productId,
    name: 'Reorder Bowl',
    description: 'Product used to verify current-menu reorder preparation',
    category: 'Test',
    imageUrl: null,
    imagePublicId: null,
    priceCents: 900,
    stock: 12,
    lowStockThreshold: 2,
    maxPerOrder: 5,
    isAvailable: true,
    optionGroups: [],
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
});

after(async () => {
  if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.savedAddress.deleteMany({ where: { user: { email: { in: [email, otherEmail] } } } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
  await prisma.$disconnect();
});

function address(overrides = {}) {
  return {
    label: 'Home', firstName: 'Step', lastName: 'Buyer', phone: '01700000444',
    street: '12 Test Road', city: 'Dhaka', state: 'Dhaka', postalCode: '1207', country: 'Bangladesh',
    ...overrides,
  };
}

test('saved addresses are account-owned and maintain one default address', async () => {
  let response = await request(app).post('/api/addresses').set('Authorization', `Bearer ${token}`).send(address());
  assert.equal(response.status, 201, JSON.stringify(response.body));
  firstAddressId = response.body.address.id;
  assert.equal(response.body.address.isDefault, true, 'the first address becomes default automatically');

  response = await request(app).post('/api/addresses').set('Authorization', `Bearer ${token}`).send(address({ label: 'Work', street: '88 Office Avenue', isDefault: true }));
  assert.equal(response.status, 201, JSON.stringify(response.body));
  secondAddressId = response.body.address.id;
  assert.equal(response.body.address.isDefault, true);

  response = await request(app).get('/api/addresses').set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.addresses.length, 2);
  assert.equal(response.body.addresses.filter(item => item.isDefault).length, 1);
  assert.equal(response.body.addresses.find(item => item.isDefault).id, secondAddressId);

  response = await request(app).patch(`/api/addresses/${firstAddressId}`).set('Authorization', `Bearer ${otherToken}`).send({ label: 'Stolen' });
  assert.equal(response.status, 404, JSON.stringify(response.body));

  response = await request(app).patch(`/api/addresses/${firstAddressId}`).set('Authorization', `Bearer ${token}`).send({ label: 'Parents' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.address.label, 'Parents');

  response = await request(app).delete(`/api/addresses/${secondAddressId}`).set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 204);

  response = await request(app).get('/api/addresses').set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.addresses.length, 1);
  assert.equal(response.body.addresses[0].id, firstAddressId);
  assert.equal(response.body.addresses[0].isDefault, true, 'deleting the default promotes a remaining address');
});

test('reorder rebuilds an owned historical cart from current availability instead of cloning old prices', async () => {
  let response = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({
    clientRequestId: randomUUID(),
    items: [{ productId, quantity: 2, selections: [], specialInstructions: 'No cutlery' }],
    paymentMethod: 'COD', fulfillmentType: 'PICKUP', fulfillmentMode: 'ASAP',
    delivery: { firstName: 'Step', lastName: 'Buyer', email, phone: '01700000444' },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  orderId = response.body.order.id;

  response = await request(app).post(`/api/orders/${orderId}/reorder`).set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.status, 'FULL');
  assert.equal(response.body.cartItems.length, 1);
  assert.deepEqual(response.body.cartItems[0], { productId, quantity: 2, selections: [], specialInstructions: 'No cutlery' });

  response = await request(app).post(`/api/orders/${orderId}/reorder`).set('Authorization', `Bearer ${otherToken}`);
  assert.equal(response.status, 404, JSON.stringify(response.body));

  response = await request(app).patch(`/api/admin/products/${productId}`).set('Authorization', `Bearer ${adminToken}`).send({ isAvailable: false });
  assert.equal(response.status, 200, JSON.stringify(response.body));

  response = await request(app).post(`/api/orders/${orderId}/reorder`).set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.status, 'UNAVAILABLE');
  assert.equal(response.body.cartItems.length, 0);
  assert.equal(response.body.skippedItems.length, 1);
  assert.equal(response.body.skippedItems[0].productId, productId);
});
