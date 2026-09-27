import { serializePayment } from './payment.js';

export function stripOrderSecrets(order) {
  if (!order) return order;
  const { guestAccessNonce, ...safe } = order;
  return safe;
}

export function serializeOrderForClient(order) {
  if (!order) return order;
  const safe = stripOrderSecrets(order);
  return { ...safe, payment: serializePayment(order.payment) };
}
