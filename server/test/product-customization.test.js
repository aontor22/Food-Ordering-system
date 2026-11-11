import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const runId = Date.now();
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;
const email = `custom-${runId}@example.com`;
const password = 'StrongPass123!';
const productId = `custom-product-${runId}`;
let adminToken;
let token;
let product;
let orderId;

before(async () => {
  await prisma.$connect();
  let response = await request(app).post('/api/auth/login').send({ email: adminEmail, password: adminPassword });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  adminToken = response.body.accessToken;

  response = await request(app).post('/api/admin/products').set('Authorization', `Bearer ${adminToken}`).send({
    id: productId,
    name: 'Custom Pizza',
    description: 'Pizza used to verify product customization pricing and snapshots',
    category: 'Test',
    imageUrl: null,
    imagePublicId: null,
    priceCents: 1000,
    stock: 20,
    isAvailable: true,
    optionGroups: [
      {
        name: 'Size', kind: 'VARIANT', minSelections: 1, maxSelections: 1, isAvailable: true, sortOrder: 0,
        options: [
          { name: 'Small', priceDeltaCents: 0, isDefault: true, isAvailable: true, sortOrder: 0 },
          { name: 'Large', priceDeltaCents: 300, isDefault: false, isAvailable: true, sortOrder: 1 },
        ],
      },
      {
        name: 'Extras', kind: 'ADDON', minSelections: 0, maxSelections: 2, isAvailable: true, sortOrder: 1,
        options: [
          { name: 'Cheese', priceDeltaCents: 150, isDefault: false, isAvailable: true, sortOrder: 0 },
          { name: 'Sauce', priceDeltaCents: 50, isDefault: false, isAvailable: true, sortOrder: 1 },
        ],
      },
    ],
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  product = response.body.product;

  response = await request(app).post('/api/auth/register').send({ name: 'Customization Buyer', email, password });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  token = response.body.accessToken;
});

after(async () => {
  if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
});

function ids() {
  const size = product.optionGroups.find(group => group.name === 'Size');
  const extras = product.optionGroups.find(group => group.name === 'Extras');
  return {
    size, extras,
    small: size.options.find(option => option.name === 'Small'),
    large: size.options.find(option => option.name === 'Large'),
    cheese: extras.options.find(option => option.name === 'Cheese'),
    sauce: extras.options.find(option => option.name === 'Sauce'),
  };
}

test('public menu exposes active variant and add-on configuration', async () => {
  const response = await request(app).get('/api/products');
  assert.equal(response.status, 200);
  const found = response.body.products.find(item => item.id === productId);
  assert.ok(found);
  assert.equal(found.optionGroups.length, 2);
  assert.equal(found.optionGroups[0].name, 'Size');
  assert.equal(found.optionGroups[0].kind, 'VARIANT');
  assert.equal(found.optionGroups[1].kind, 'ADDON');
});

test('server quote prices separate customized lines and rejects invalid selections', async () => {
  const { size, extras, large, cheese, sauce } = ids();
  const items = [
    { productId, quantity: 2, selections: [{ groupId: size.id, optionIds: [large.id] }, { groupId: extras.id, optionIds: [cheese.id] }], specialInstructions: 'Bake well done' },
    { productId, quantity: 1, selections: [{ groupId: size.id, optionIds: [size.options[0].id] }, { groupId: extras.id, optionIds: [sauce.id] }] },
  ];
  let response = await request(app).post('/api/orders/quote').set('Authorization', `Bearer ${token}`).send({ items, fulfillmentType: 'PICKUP' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.quote.subtotalCents, 3950);
  assert.equal(response.body.quote.deliveryFeeCents, 0);

  response = await request(app).post('/api/orders/quote').set('Authorization', `Bearer ${token}`).send({ items: [{ productId, quantity: 1, selections: [] }], fulfillmentType: 'PICKUP' });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'CUSTOMIZATION_REQUIRED');

  response = await request(app).post('/api/orders/quote').set('Authorization', `Bearer ${token}`).send({ items: [{ productId, quantity: 1, selections: [{ groupId: size.id, optionIds: ['removed-option'] }] }], fulfillmentType: 'PICKUP' });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'CUSTOMIZATION_CHANGED');
});

test('order stores immutable customization snapshots and aggregate product stock', async () => {
  const { size, extras, small, large, cheese, sauce } = ids();
  const items = [
    { productId, quantity: 2, selections: [{ groupId: size.id, optionIds: [large.id] }, { groupId: extras.id, optionIds: [cheese.id] }], specialInstructions: 'Bake well done' },
    { productId, quantity: 1, selections: [{ groupId: size.id, optionIds: [small.id] }, { groupId: extras.id, optionIds: [sauce.id] }], specialInstructions: 'Sauce on the side' },
  ];
  let response = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({
    items, paymentMethod: 'COD', fulfillmentType: 'PICKUP', fulfillmentMode: 'ASAP',
    delivery: { firstName: 'Custom', lastName: 'Buyer', email, phone: '01700000222' },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  orderId = response.body.order.id;
  assert.equal(response.body.order.subtotalCents, 3950);
  assert.equal(response.body.order.items.length, 2);
  const largeLine = response.body.order.items.find(item => item.specialInstructions === 'Bake well done');
  assert.equal(largeLine.baseUnitPriceCents, 1000);
  assert.equal(largeLine.unitPriceCents, 1450);
  assert.equal(largeLine.lineTotalCents, 2900);
  assert.equal(largeLine.customizations.find(group => group.groupName === 'Size').options[0].name, 'Large');
  assert.equal(largeLine.customizations.find(group => group.groupName === 'Extras').options[0].name, 'Cheese');
  assert.equal('customizationsJson' in largeLine, false);

  const stored = await prisma.orderItem.findUnique({ where: { id: largeLine.id } });
  assert.ok(stored.customizationsJson.includes('Large'));
  assert.equal(stored.baseUnitPriceCents, 1000);
  assert.equal((await prisma.product.findUnique({ where: { id: productId } })).stock, 17);

  const updatedGroups = product.optionGroups.map(group => ({
    id: group.id,
    name: group.name,
    kind: group.kind,
    minSelections: group.minSelections,
    maxSelections: group.maxSelections,
    sortOrder: group.sortOrder,
    isAvailable: group.isAvailable,
    options: group.options.map(option => ({
      id: option.id,
      name: option.id === large.id ? 'XL' : option.name,
      priceDeltaCents: option.id === large.id ? 400 : option.priceDeltaCents,
      isDefault: option.isDefault,
      sortOrder: option.sortOrder,
      isAvailable: option.isAvailable,
    })),
  }));
  response = await request(app).patch(`/api/admin/products/${productId}`).set('Authorization', `Bearer ${adminToken}`).send({ optionGroups: updatedGroups });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  product = response.body.product;

  response = await request(app).get(`/api/orders/${orderId}`).set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 200);
  const historic = response.body.order.items.find(item => item.id === largeLine.id);
  assert.equal(historic.unitPriceCents, 1450);
  assert.equal(historic.customizations.find(group => group.groupName === 'Size').options[0].name, 'Large');
});
