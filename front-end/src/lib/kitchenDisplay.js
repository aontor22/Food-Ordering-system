export const KITCHEN_LANES = ['NEW', 'PREPARING', 'READY'];

export function kitchenLaneForOrder(order) {
  if (order?.kitchenLane) return order.kitchenLane;
  if (order?.status === 'CONFIRMED') return 'NEW';
  if (order?.status === 'PREPARING') return 'PREPARING';
  if (order?.status === 'READY') return 'READY';
  return null;
}

function minutesSince(value, now) {
  if (!value) return 0;
  return Math.max(0, Math.floor((now - new Date(value).getTime()) / 60_000));
}

function durationCopy(minutes) {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function elapsedTone(minutes, warningAt = 5, criticalAt = 10) {
  if (minutes >= criticalAt) return 'critical';
  if (minutes >= warningAt) return 'warning';
  return 'normal';
}

export function kitchenTimerForOrder(order, now = Date.now()) {
  const lane = kitchenLaneForOrder(order);
  if (lane === 'NEW') {
    if (order.fulfillmentMode === 'SCHEDULED') {
      return { lane, tone: 'scheduled', primary: 'Scheduled', secondary: 'Start at the planned preparation time', minutes: null };
    }
    const minutes = minutesSince(order.confirmedAt || order.statusUpdatedAt || order.createdAt, now);
    return { lane, tone: elapsedTone(minutes), primary: `Waiting ${durationCopy(minutes)}`, secondary: 'Since confirmation', minutes };
  }
  if (lane === 'PREPARING') {
    const elapsed = minutesSince(order.preparingAt || order.statusUpdatedAt, now);
    if (order.estimatedReadyAt) {
      const remaining = Math.ceil((new Date(order.estimatedReadyAt).getTime() - now) / 60_000);
      if (remaining < 0) return { lane, tone: 'critical', primary: `Late ${durationCopy(Math.abs(remaining))}`, secondary: `Cooking ${durationCopy(elapsed)}`, minutes: elapsed };
      if (remaining <= 5) return { lane, tone: 'warning', primary: remaining <= 1 ? 'Due now' : `Due in ${remaining}m`, secondary: `Cooking ${durationCopy(elapsed)}`, minutes: elapsed };
      return { lane, tone: 'normal', primary: `Due in ${remaining}m`, secondary: `Cooking ${durationCopy(elapsed)}`, minutes: elapsed };
    }
    return { lane, tone: elapsedTone(elapsed, 20, 30), primary: `Cooking ${durationCopy(elapsed)}`, secondary: 'No ready estimate', minutes: elapsed };
  }
  if (lane === 'READY') {
    const minutes = minutesSince(order.readyAt || order.statusUpdatedAt, now);
    return {
      lane,
      tone: elapsedTone(minutes),
      primary: `Ready ${durationCopy(minutes)}`,
      secondary: order.fulfillmentType === 'PICKUP' ? 'Waiting for pickup' : 'Waiting for dispatch',
      minutes,
    };
  }
  return { lane: null, tone: 'normal', primary: '', secondary: '', minutes: null };
}

export function sortKitchenOrders(orders = [], lane) {
  return [...orders].sort((a, b) => {
    if (lane === 'PREPARING') {
      const aDue = new Date(a.estimatedReadyAt || a.preparingAt || a.createdAt).getTime();
      const bDue = new Date(b.estimatedReadyAt || b.preparingAt || b.createdAt).getTime();
      return aDue - bDue;
    }
    if (lane === 'READY') {
      return new Date(a.readyAt || a.statusUpdatedAt || a.createdAt) - new Date(b.readyAt || b.statusUpdatedAt || b.createdAt);
    }
    const aScheduled = a.fulfillmentMode === 'SCHEDULED';
    const bScheduled = b.fulfillmentMode === 'SCHEDULED';
    if (aScheduled !== bScheduled) return aScheduled ? 1 : -1;
    if (aScheduled && bScheduled) return String(a.scheduledForLocal || '').localeCompare(String(b.scheduledForLocal || ''));
    return new Date(a.confirmedAt || a.createdAt) - new Date(b.confirmedAt || b.createdAt);
  });
}
