import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const runId = Date.now();
const email = `wishlist-${runId}@example.com`;
const adminEmail = `wishlist-admin-${runId}@example.com`;
const adminPassword = 'WishlistAdmin123!';
const productA = `wishlist-a-${runId}`;
const productB = `wishlist-b-${runId}`;
let token;
let adminToken;
let adminId;
let userId;

before(async () => {
  await prisma.$connect();
  const admin = await prisma.user.create({ data: { name: 'Wishlist Admin', email: adminEmail, role: 'ADMIN', passwordHash: await bcrypt.hash(adminPassword, 4) } });
  adminId = admin.id;
  await prisma.$transaction([
    prisma.product.create({ data: { id: productA, name: 'Wishlist Pasta', description: 'A dish used to verify saved favourites', category: 'Test', priceCents: 1200, stock: 10, isAvailable: true } }),
    prisma.product.create({ data: { id: productB, name: 'Wishlist Salad', description: 'Another dish used to verify sync behaviour', category: 'Test', priceCents: 900, stock: 10, isAvailable: true } }),
  ]);
});

after(async () => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    await prisma.wishlistItem.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
  await prisma.wishlistItem.deleteMany({ where: { productId: { in: [productA, productB] } } });
  await prisma.product.deleteMany({ where: { id: { in: [productA, productB] } } });
  await prisma.user.deleteMany({ where: { id: adminId } });
  await prisma.$disconnect();
});

test('wishlist requires authentication and prevents duplicate saves', async () => {
  let response = await request(app).get('/api/wishlist');
  assert.equal(response.status, 401);

  response = await request(app).post('/api/auth/register').send({ name: 'Wishlist User', email, password: 'StrongPass123!' });
  assert.equal(response.status, 201);
  token = response.body.accessToken;
  userId = response.body.user.id;

  response = await request(app).put(`/api/wishlist/${productA}`).set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 200);
  response = await request(app).put(`/api/wishlist/${productA}`).set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 200);

  response = await request(app).get('/api/wishlist').set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.count, 1);
  assert.equal(response.body.items[0].product.id, productA);
});

test('guest-style sync merges only valid available products', async () => {
  const response = await request(app).post('/api/wishlist/sync').set('Authorization', `Bearer ${token}`).send({ productIds: [productA, productB, productA, 'missing-product'] });
  assert.equal(response.status, 200);
  assert.equal(response.body.count, 2);
  assert.deepEqual(new Set(response.body.items.map(item => item.productId)), new Set([productA, productB]));
});

test('archived products remain visible in an existing wishlist but cannot be newly saved', async () => {
  await prisma.product.update({ where: { id: productA }, data: { isAvailable: false } });
  let response = await request(app).get('/api/wishlist').set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 200);
  const saved = response.body.items.find(item => item.productId === productA);
  assert.equal(saved.product.isAvailable, false);

  await request(app).delete(`/api/wishlist/${productA}`).set('Authorization', `Bearer ${token}`);
  response = await request(app).put(`/api/wishlist/${productA}`).set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'PRODUCT_NOT_AVAILABLE');
});

test('admin product and customer views expose wishlist analytics', async () => {
  let response = await request(app).post('/api/auth/login').send({ email: adminEmail, password: adminPassword });
  assert.equal(response.status, 200);
  adminToken = response.body.accessToken;

  response = await request(app).get('/api/admin/products').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.products.find(product => product.id === productB).wishlistCount, 1);

  response = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.users.find(user => user.email === email).wishlistCount, 1);

  response = await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(response.status, 200);
  assert.ok(response.body.metrics.wishlistSaves >= 1);
});

test('customer can remove a saved product', async () => {
  const response = await request(app).delete(`/api/wishlist/${productB}`).set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 204);
  const record = await prisma.wishlistItem.findFirst({ where: { productId: productB, userId } });
  assert.equal(record, null);
});
