import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(0);

const TITLES = {
  PENDING: 'Order placed',
  CONFIRMED: 'Order confirmed',
  PREPARING: 'Food is being prepared',
  READY_FOR_PICKUP: 'Ready for pickup',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Order completed',
  CANCELLED: 'Order cancelled',
};

export const trackingInclude = {
  trackingEvents: { orderBy: { createdAt: 'asc' } },
};

export function trackingEventData(status, {
  kind = 'STATUS',
  note = null,
  actorType = 'SYSTEM',
  actorLabel = null,
  title = null,
} = {}) {
  return {
    kind,
    status,
    title: title || TITLES[status] || 'Order status updated',
    note: note || null,
    actorType,
    actorLabel: actorLabel || null,
  };
}

export function trackingTimestampData(status, order, { estimateMinutes = null, now = new Date() } = {}) {
  const data = { statusUpdatedAt: now };
  if (status === 'CONFIRMED') data.confirmedAt = order.confirmedAt || now;
  if (status === 'PREPARING') {
    data.confirmedAt = order.confirmedAt || now;
    data.preparingAt = order.preparingAt || now;
    const minutes = Number.isInteger(estimateMinutes) ? estimateMinutes : 25;
    data.estimatedReadyAt = new Date(now.getTime() + minutes * 60_000);
  }
  if (status === 'READY_FOR_PICKUP') {
    data.readyAt = order.readyAt || now;
    data.estimatedReadyAt = now;
  }
  if (status === 'OUT_FOR_DELIVERY') {
    data.readyAt = order.readyAt || now;
    data.outForDeliveryAt = order.outForDeliveryAt || now;
    const minutes = Number.isInteger(estimateMinutes) ? estimateMinutes : 30;
    data.estimatedDeliveryAt = new Date(now.getTime() + minutes * 60_000);
  }
  if (status === 'DELIVERED') {
    data.deliveredAt = order.deliveredAt || now;
    if (order.fulfillmentType === 'PICKUP') data.readyAt = order.readyAt || now;
    else data.outForDeliveryAt = order.outForDeliveryAt || now;
  }
  if (status === 'CANCELLED') data.cancelledAt = order.cancelledAt || now;
  return data;
}

export function etaUpdateData(order, minutes, now = new Date()) {
  const target = new Date(now.getTime() + minutes * 60_000);
  if (order.status === 'PREPARING') {
    return {
      data: { estimatedReadyAt: target },
      event: trackingEventData(order.status, {
        kind: 'ETA',
        title: order.fulfillmentType === 'PICKUP' ? 'Pickup estimate updated' : 'Kitchen estimate updated',
        note: `Estimated ready in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        actorType: 'ADMIN',
      }),
    };
  }
  if (order.status === 'OUT_FOR_DELIVERY') {
    return {
      data: { estimatedDeliveryAt: target },
      event: trackingEventData(order.status, {
        kind: 'ETA',
        title: 'Delivery estimate updated',
        note: `Estimated arrival in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        actorType: 'ADMIN',
      }),
    };
  }
  throw Object.assign(new Error('ETA can only be adjusted while preparing or out for delivery'), { code: 'ETA_NOT_AVAILABLE' });
}

export function publishOrderChange(order) {
  bus.emit('change', { orderId: order.id, userId: order.userId, at: Date.now() });
}

export function onOrderChange(listener) {
  bus.on('change', listener);
  return () => bus.off('change', listener);
}

function writeEvent(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function openOrderSseStream(req, res, {
  loadSnapshot,
  matches = () => true,
  pollMs = 15_000,
}) {
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  let closed = false;
  let lastSignature = '';
  let inFlight = false;

  const pushSnapshot = async (force = false) => {
    if (closed || inFlight) return;
    inFlight = true;
    try {
      const snapshot = await loadSnapshot();
      const signature = JSON.stringify(snapshot.signature ?? snapshot.data);
      if (force || signature !== lastSignature) {
        lastSignature = signature;
        writeEvent(res, 'snapshot', snapshot.data);
      }
    } catch (error) {
      req.log?.warn({ err: error }, 'order tracking stream refresh failed');
      writeEvent(res, 'warning', { message: 'Live tracking is reconnecting.' });
    } finally {
      inFlight = false;
    }
  };

  writeEvent(res, 'ready', { connected: true, at: new Date().toISOString() });
  pushSnapshot(true);

  const unsubscribe = onOrderChange(change => {
    if (matches(change)) pushSnapshot(true);
  });
  const poll = setInterval(() => pushSnapshot(false), pollMs);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 20_000);

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(poll);
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on('close', close);
  req.on('aborted', close);
}
