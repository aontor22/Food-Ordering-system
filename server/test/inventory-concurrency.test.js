import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const runId = Date.now();
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;
const email = `inventory-${runId}@example.com`;
const password = 'StrongPass123!';
const productId = `inventory-product-${runId}`;
let adminToken;
let token;
let product;
const orderIds = [];

function sizeGroup() { return product.optionGroups.find(group => group.name === 'Size'); }
function option(name) { return sizeGroup().options.find(item => item.name === name); }
function orderItems(optionId, quantity = 1) {
  return [{ productId, quantity, selections: [{ groupId: sizeGroup().id, optionIds: [optionId] }] }];
}

before(async () => {
  await prisma.$connect();
  let response = await request(app).post('/api/auth/login').send({ email: adminEmail, password: adminPassword });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  adminToken = response.body.accessToken;

  response = await request(app).post('/api/admin/products').set('Authorization', `Bearer ${adminToken}`).send({
    id: productId,
    name: 'Inventory Pizza',
    description: 'Product used to verify atomic product and option inventory safeguards',
    category: 'Test',
    imageUrl: null,
    imagePublicId: null,
    priceCents: 1200,
    stock: 6,
    lowStockThreshold: 2,
    maxPerOrder: 3,
    isAvailable: true,
    optionGroups: [{
      name: 'Size', kind: 'VARIANT', minSelections: 1, maxSelections: 1, isAvailable: true, sortOrder: 0,
      options: [
        { name: 'Limited', priceDeltaCents: 100, isDefault: true, isAvailable: true, sortOrder: 0, trackStock: true, stock: 1, lowStockThreshold: 1 },
        { name: 'Regular', priceDeltaCents: 0, isDefault: false, isAvailable: true, sortOrder: 1, trackStock: true, stock: 5, lowStockThreshold: 2 },
      ],
    }],
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  product = response.body.product;

  response = await request(app).post('/api/auth/register').send({ name: 'Inventory Buyer', email, password });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  token = response.body.accessToken;
});

after(async () => {
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
});

test('tracked option stock is reserved atomically and cancellation restores exact inventory', async () => {
  const limited = option('Limited');
  let response = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({
    clientRequestId: randomUUID(),
    items: orderItems(limited.id), paymentMethod: 'COD', fulfillmentType: 'PICKUP', fulfillmentMode: 'ASAP',
    delivery: { firstName: 'Inventory', lastName: 'Buyer', email, phone: '01700000333' },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const orderId = response.body.order.id;
  orderIds.push(orderId);

  let storedProduct = await prisma.product.findUnique({ where: { id: productId } });
  let storedOption = await prisma.productOption.findUnique({ where: { id: limited.id } });
  assert.equal(storedProduct.stock, 5);
  assert.equal(storedOption.stock, 0);

  response = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({
    clientRequestId: randomUUID(),
    items: orderItems(limited.id), paymentMethod: 'COD', fulfillmentType: 'PICKUP', fulfillmentMode: 'ASAP',
    delivery: { firstName: 'Inventory', lastName: 'Buyer', email, phone: '01700000333' },
  });
  assert.equal(response.status, 409, JSON.stringify(response.body));
  assert.ok(['OPTION_SOLD_OUT', 'OPTION_INSUFFICIENT_STOCK', 'CUSTOMIZATION_CHANGED', 'OPTION_STOCK_CHANGED'].includes(response.body.error.code));

  storedProduct = await prisma.product.findUnique({ where: { id: productId } });
  assert.equal(storedProduct.stock, 5, 'failed option reservation must not consume product stock');

  response = await request(app).post(`/api/orders/${orderId}/cancel`).set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  storedProduct = await prisma.product.findUnique({ where: { id: productId } });
  storedOption = await prisma.productOption.findUnique({ where: { id: limited.id } });
  assert.equal(storedProduct.stock, 6);
  assert.equal(storedOption.stock, 1);

  const ledger = await prisma.inventoryAdjustment.findMany({ where: { productId, sourceId: response.body.order.orderNumber } });
  assert.ok(ledger.some(entry => entry.targetType === 'PRODUCT' && entry.quantityDelta === 1 && entry.sourceType === 'CANCELLATION'));
  assert.ok(ledger.some(entry => entry.targetType === 'OPTION' && entry.optionId === limited.id && entry.quantityDelta === 1 && entry.sourceType === 'CANCELLATION'));
});

test('checkout request id is idempotent and only reserves stock once', async () => {
  const regular = option('Regular');
  const clientRequestId = randomUUID();
  const payload = {
    clientRequestId,
    items: orderItems(regular.id, 2), paymentMethod: 'COD', fulfillmentType: 'PICKUP', fulfillmentMode: 'ASAP',
    delivery: { firstName: 'Inventory', lastName: 'Buyer', email, phone: '01700000333' },
  };

  let response = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send(payload);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const orderId = response.body.order.id;
  orderIds.push(orderId);
  const orderNumber = response.body.order.orderNumber;

  response = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send(payload);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.order.id, orderId);
  assert.equal(response.body.idempotentReplay, true);

  const storedProduct = await prisma.product.findUnique({ where: { id: productId } });
  const storedOption = await prisma.productOption.findUnique({ where: { id: regular.id } });
  assert.equal(storedProduct.stock, 4);
  assert.equal(storedOption.stock, 3);
  const storedOrder = await prisma.order.findUnique({ where: { id: orderId }, select: { checkoutRequestId: true } });
  assert.ok(storedOrder.checkoutRequestId);
  assert.notEqual(storedOrder.checkoutRequestId, clientRequestId);
  assert.equal(storedOrder.checkoutRequestId.length, 64);
  assert.equal(await prisma.inventoryAdjustment.count({ where: { productId, sourceType: 'ORDER', sourceId: orderNumber, targetType: 'PRODUCT' } }), 1);
});

test('admin inventory adjustment rejects a stale version and records successful changes', async () => {
  let response = await request(app).get('/api/admin/inventory').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const inventoryProduct = response.body.products.find(item => item.id === productId);
  assert.ok(inventoryProduct);
  const version = inventoryProduct.inventoryVersion;

  response = await request(app).post('/api/admin/inventory/adjust').set('Authorization', `Bearer ${adminToken}`).send({
    targetType: 'PRODUCT', productId, expectedVersion: version, newStock: 9, reason: 'STOCK_COUNT', note: 'Integration test count',
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.target.stock, 9);
  assert.equal(response.body.adjustment.balanceAfter, 9);

  response = await request(app).post('/api/admin/inventory/adjust').set('Authorization', `Bearer ${adminToken}`).send({
    targetType: 'PRODUCT', productId, expectedVersion: version, newStock: 10, reason: 'CORRECTION',
  });
  assert.equal(response.status, 409, JSON.stringify(response.body));
  assert.equal(response.body.error.code, 'INVENTORY_CHANGED');
  assert.equal((await prisma.product.findUnique({ where: { id: productId } })).stock, 9);
});
