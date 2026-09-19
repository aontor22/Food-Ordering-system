import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const email = `test-${Date.now()}@example.com`; let token;
before(async () => { await prisma.$connect(); });
after(async () => { const user = await prisma.user.findUnique({ where: { email } }); if (user) { await prisma.order.deleteMany({ where: { userId: user.id } }); await prisma.user.delete({ where: { id: user.id } }); } await prisma.$disconnect(); });
test('health endpoint', async () => { const r = await request(app).get('/api/health'); assert.equal(r.status, 200); assert.equal(r.body.status, 'ok'); });
test('register, authenticate, list products, and place order', async () => {
  let r = await request(app).post('/api/auth/register').send({ name: 'Test User', email, password: 'StrongPass123!' }); assert.equal(r.status, 201); token = r.body.accessToken;
  r = await request(app).get('/api/products'); assert.equal(r.status, 200); assert.ok(r.body.products.length >= 1);
  r = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({ items: [{ productId: r.body.products[0].id, quantity: 1 }], paymentMethod: 'COD', delivery: { firstName: 'Test', lastName: 'User', email, phone: '01700000000', street: '123 Test Street', city: 'Dhaka', state: 'Dhaka', postalCode: '1200', country: 'Bangladesh' } }); assert.equal(r.status, 201); assert.equal(r.body.order.items.length, 1);
});
test('rejects unauthenticated order access', async () => { const r = await request(app).get('/api/orders'); assert.equal(r.status, 401); });
