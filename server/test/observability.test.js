import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRequestId, operationalStatus, sanitizeMonitoringMetadata, serializeOperationalError } from '../src/services/observability-core.js';

test('request IDs accept safe correlation IDs and replace unsafe values', () => {
  assert.equal(normalizeRequestId('deploy-abc_1234'), 'deploy-abc_1234');
  const generated = normalizeRequestId('bad id with spaces');
  assert.match(generated, /^[0-9a-f-]{36}$/i);
});

test('monitoring metadata redacts credentials and direct customer identifiers', () => {
  const clean = sanitizeMonitoringMetadata({ email: 'person@example.com', token: 'secret', nested: { password: 'x', orderId: 'o1' }, count: 2 });
  assert.equal(clean.email, '[REDACTED]');
  assert.equal(clean.token, '[REDACTED]');
  assert.equal(clean.nested.password, '[REDACTED]');
  assert.equal(clean.nested.orderId, 'o1');
  assert.equal(clean.count, 2);
  assert.equal(serializeOperationalError(new Error('boom')).message, 'boom');
});

test('operational status becomes degraded for errors/failed queues and critical for database failure', () => {
  assert.equal(operationalStatus({}), 'healthy');
  assert.equal(operationalStatus({ recentErrors: 1 }), 'degraded');
  assert.equal(operationalStatus({ failedNotifications: 1 }), 'degraded');
  assert.equal(operationalStatus({ databaseOk: false }), 'critical');
});
