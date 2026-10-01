import { serializePayment } from './payment.js';
import { parseOrderItemCustomizations } from './product-customizations.js';
import { orderDocumentAvailability } from './order-documents.js';

export function stripOrderSecrets(order) {
  if (!order) return order;
  const { guestAccessNonce, checkoutRequestId, ...safe } = order;
  return safe;
}

function serializeOrderItem(item) {
  if (!item) return item;
  const { customizationsJson, ...safe } = item;
  return { ...safe, customizations: parseOrderItemCustomizations(customizationsJson) };
}

export function serializeOrderForClient(order) {
  if (!order) return order;
  const safe = stripOrderSecrets(order);
  return {
    ...safe,
    items: Array.isArray(order.items) ? order.items.map(serializeOrderItem) : order.items,
    payment: serializePayment(order.payment),
    documents: orderDocumentAvailability(order),
  };
}
