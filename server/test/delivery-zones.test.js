import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const runId = Date.now();
const customerEmail = `delivery-zone-${runId}@example.com`;
const customerPassword = 'StrongPass123!';
let adminToken;
let customerToken;
let product;
let zone;

before(async () => {
  await prisma.$connect();
  let response = await request(app).post('/api/auth/login').send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  assert.equal(response.status, 200);
  adminToken = response.body.accessToken;

  response = await request(app).post('/api/auth/register').send({ name: 'Delivery Zone Test', email: customerEmail, password: customerPassword });
  assert.equal(response.status, 201);
  customerToken = response.body.accessToken;
  product = await prisma.product.findFirst({ where: { isAvailable: true, stock: { gte: 4 } } });
  assert.ok(product);
});

test('admin creates a delivery zone and public checkout can list it', async () => {
  const minimumOrderCents = product.priceCents + 100;
  const freeDeliveryThresholdCents = product.priceCents * 3;
  let response = await request(app).post('/api/admin/delivery-zones')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name: `Test Zone ${runId}`,
      description: 'Integration-test delivery area',
      postalCodes: ['9999'],
      feeCents: 450,
      minimumOrderCents,
      freeDeliveryThresholdCents,
      active: true,
      sortOrder: 50,
    });
  assert.equal(response.status, 201);
  zone = response.body.zone;
  assert.equal(zone.postalCodes[0], '9999');

  response = await request(app).get('/api/store/delivery-zones');
  assert.equal(response.status, 200);
  assert.ok(response.body.zones.some(item => item.id === zone.id));
});

test('quote exposes minimum-order shortfall and area delivery fee', async () => {
  let response = await request(app).post('/api/orders/quote')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ items: [{ productId: product.id, quantity: 1 }], deliveryZoneId: zone.id, postalCode: '9999' });
  assert.equal(response.status, 200);
  assert.equal(response.body.quote.deliveryZone.minimumOrderMet, false);
  assert.equal(response.body.quote.deliveryFeeCents, 450);
  assert.ok(response.body.quote.deliveryZone.minimumOrderRemainingCents > 0);

  response = await request(app).post('/api/orders')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({
      items: [{ productId: product.id, quantity: 1 }], deliveryZoneId: zone.id, paymentMethod: 'COD',
      delivery: { firstName: 'Zone', lastName: 'Tester', email: customerEmail, phone: '01700000000', street: '123 Test Road', city: 'Dhaka', state: 'Dhaka', postalCode: '9999', country: 'Bangladesh' },
    });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'MINIMUM_ORDER_NOT_MET');
});

test('postal coverage is enforced and free-delivery threshold is server calculated', async () => {
  let response = await request(app).post('/api/orders/quote')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ items: [{ productId: product.id, quantity: 2 }], deliveryZoneId: zone.id, postalCode: '1111' });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'POSTAL_CODE_OUTSIDE_ZONE');

  const defaultZone = await prisma.deliveryZone.findFirst({ where: { id: { not: zone.id }, active: true, postalCodes: null } });
  if (defaultZone) {
    response = await request(app).post('/api/orders/quote')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ items: [{ productId: product.id, quantity: 2 }], deliveryZoneId: defaultZone.id, postalCode: '9999' });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'DELIVERY_ZONE_MISMATCH');
  }

  response = await request(app).post('/api/orders/quote')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ items: [{ productId: product.id, quantity: 2 }], deliveryZoneId: zone.id, postalCode: '9999' });
  assert.equal(response.status, 200);
  assert.equal(response.body.quote.deliveryZone.minimumOrderMet, true);
  assert.equal(response.body.quote.deliveryZone.freeDelivery, false);
  assert.equal(response.body.quote.deliveryFeeCents, 450);

  response = await request(app).post('/api/orders/quote')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ items: [{ productId: product.id, quantity: 3 }], deliveryZoneId: zone.id, postalCode: '9999' });
  assert.equal(response.status, 200);
  assert.equal(response.body.quote.deliveryZone.freeDelivery, true);
  assert.equal(response.body.quote.deliveryFeeCents, 0);
});

test('admin cannot assign the same postal code to two active zones', async () => {
  const response = await request(app).post('/api/admin/delivery-zones')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name: `Overlap Zone ${runId}`,
      description: null,
      postalCodes: ['9999'],
      feeCents: 100,
      minimumOrderCents: 0,
      freeDeliveryThresholdCents: null,
      active: true,
      sortOrder: 60,
    });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'POSTAL_CODE_OVERLAP');
});

test('placed order stores a delivery-zone snapshot', async () => {
  const response = await request(app).post('/api/orders')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({
      items: [{ productId: product.id, quantity: 2 }], deliveryZoneId: zone.id, paymentMethod: 'COD',
      delivery: { firstName: 'Zone', lastName: 'Tester', email: customerEmail, phone: '01700000000', street: '123 Test Road', city: 'Dhaka', state: 'Dhaka', postalCode: '9999', country: 'Bangladesh' },
    });
  assert.equal(response.status, 201);
  assert.equal(response.body.order.deliveryZoneId, zone.id);
  assert.equal(response.body.order.deliveryZoneName, zone.name);
  assert.equal(response.body.order.deliveryFeeCents, 450);
});
