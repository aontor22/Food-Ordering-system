import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrderTransitions, kitchenLaneForStatus, trackingEventData, trackingTimestampData } from '../src/services/order-tracking.js';

test('kitchen lanes map from the shared order lifecycle', () => {
  assert.equal(kitchenLaneForStatus('CONFIRMED'), 'NEW');
  assert.equal(kitchenLaneForStatus('PREPARING'), 'PREPARING');
  assert.equal(kitchenLaneForStatus('READY'), 'READY');
  assert.equal(kitchenLaneForStatus('DELIVERED'), null);
});

test('kitchen lifecycle inserts READY before pickup completion or delivery dispatch', () => {
  assert.deepEqual(allowedOrderTransitions({ status: 'CONFIRMED', fulfillmentType: 'DELIVERY' }), ['PREPARING', 'CANCELLED']);
  assert.deepEqual(allowedOrderTransitions({ status: 'PREPARING', fulfillmentType: 'DELIVERY' }), ['READY', 'CANCELLED']);
  assert.deepEqual(allowedOrderTransitions({ status: 'READY', fulfillmentType: 'DELIVERY' }), ['OUT_FOR_DELIVERY', 'CANCELLED']);
  assert.deepEqual(allowedOrderTransitions({ status: 'READY', fulfillmentType: 'PICKUP' }), ['DELIVERED', 'CANCELLED']);
});

test('READY records the kitchen finish time and customer timeline title', () => {
  const now = new Date('2026-09-28T10:00:00.000Z');
  const data = trackingTimestampData('READY', { readyAt: null }, { now });
  assert.equal(data.readyAt.toISOString(), now.toISOString());
  assert.equal(data.estimatedReadyAt.toISOString(), now.toISOString());
  assert.equal(trackingEventData('READY').title, 'Food is ready');
});
