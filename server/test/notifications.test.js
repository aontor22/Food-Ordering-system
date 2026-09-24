import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const runId = Date.now();
const email = `notify-${runId}@example.com`;
const password = 'StrongPass123!';
let token;

test('customer can read and update notification preferences', async () => {
  let response = await request(app).post('/api/auth/register').send({ name: 'Notify Tester', email, password });
  assert.equal(response.status, 201);
  token = response.body.accessToken;

  response = await request(app).get('/api/notifications').set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.preference.emailEnabled, true);
  assert.equal(response.body.preference.pushEnabled, false);
  assert.equal(response.body.capabilities.push, false);

  response = await request(app).patch('/api/notifications/preferences').set('Authorization', `Bearer ${token}`).send({ emailEnabled: false, etaUpdates: false });
  assert.equal(response.status, 200);
  assert.equal(response.body.preference.emailEnabled, false);
  assert.equal(response.body.preference.etaUpdates, false);
});

test('push registration is server-controlled and unavailable without VAPID configuration', async () => {
  const response = await request(app).post('/api/notifications/push-subscriptions').set('Authorization', `Bearer ${token}`).send({
    endpoint: 'https://push.example.test/subscription/test-notification-endpoint',
    keys: { p256dh: 'A'.repeat(65), auth: 'B'.repeat(16) },
  });
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, 'PUSH_NOT_CONFIGURED');
});

test('notification preference is stored per account', async () => {
  const user = await prisma.user.findUnique({ where: { email }, include: { notificationPreference: true } });
  assert.ok(user?.notificationPreference);
  assert.equal(user.notificationPreference.emailEnabled, false);
});
