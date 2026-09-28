import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderDocument, orderDocumentAvailability, renderOrderDocumentHtml } from '../src/services/order-documents.js';

const db = {
  fulfillmentSetting: { findUnique: async () => ({ pickupAddress: '123 Kitchen Road, Dhaka' }) },
  restaurantSetting: { findUnique: async () => ({ timezone: 'Asia/Dhaka' }) },
};

function fixture(overrides = {}) {
  return {
    id: 'ord_1', orderNumber: 'TMT-2026-001', status: 'CONFIRMED', paymentMethod: 'ONLINE', paymentStatus: 'PENDING',
    subtotalCents: 1800, discountCents: 200, pointsRedeemed: 10, pointsDiscountCents: 100, deliveryFeeCents: 100, totalCents: 1600,
    couponCode: 'SAVE10', fulfillmentType: 'DELIVERY', fulfillmentMode: 'ASAP', scheduledForLocal: null, deliveryZoneName: 'Central',
    firstName: 'A', lastName: '<Customer>', email: 'buyer@example.com', phone: '01700000000', street: 'Road 1', city: 'Dhaka', state: 'Dhaka', postalCode: '1200', country: 'Bangladesh', notes: '<script>alert(1)</script>',
    customerType: 'REGISTERED', createdAt: new Date('2026-09-28T06:00:00Z'), updatedAt: new Date('2026-09-28T06:10:00Z'), deliveredAt: null,
    items: [{ id: 'item_1', productName: 'Pizza <Large>', quantity: 2, baseUnitPriceCents: 700, unitPriceCents: 900, lineTotalCents: 1800, specialInstructions: 'No <onion>', customizationsJson: JSON.stringify([{ groupName: 'Size', options: [{ name: 'Large', priceDeltaCents: 200 }] }]) }],
    payment: { id: 'pay_1', transactionId: 'PAY-123', provider: 'SSLCOMMERZ', status: 'PENDING', currency: 'BDT', paidAt: null, gatewayTransactionId: null, refundAmountCents: null, refundedAt: null, refundReferenceId: null, manualSubmissions: [] },
    ...overrides,
  };
}

test('invoice is available before payment and uses immutable order totals', async () => {
  const order = fixture();
  const document = await buildOrderDocument(db, order, 'invoice');
  assert.equal(document.documentNumber, 'INV-TMT-2026-001');
  assert.equal(document.currency, 'BDT');
  assert.equal(document.totals.totalCents, 1600);
  assert.equal(document.items[0].customizations[0].values[0].name, 'Large');
  assert.equal(orderDocumentAvailability(order).invoice.available, true);
  assert.equal(orderDocumentAvailability(order).receipt.available, false);
});

test('receipt is rejected until payment is recorded and available after payment', async () => {
  await assert.rejects(() => buildOrderDocument(db, fixture(), 'receipt'), error => error?.code === 'RECEIPT_NOT_AVAILABLE');
  const paid = fixture({ paymentStatus: 'PAID', payment: { ...fixture().payment, status: 'PAID', paidAt: new Date('2026-09-28T06:05:00Z') } });
  const receipt = await buildOrderDocument(db, paid, 'receipt');
  assert.equal(receipt.documentNumber, 'RCT-TMT-2026-001');
  assert.equal(receipt.notice, 'PAID');
  assert.equal(orderDocumentAvailability(paid).receipt.available, true);
});

test('standalone printable HTML escapes customer and kitchen content', async () => {
  const document = await buildOrderDocument(db, fixture(), 'invoice');
  const html = renderOrderDocumentHtml(document, { autoPrint: true });
  assert.ok(html.includes('Print / Save PDF'));
  assert.ok(html.includes('A &lt;Customer&gt;'));
  assert.ok(html.includes('Pizza &lt;Large&gt;'));
  assert.ok(html.includes('No &lt;onion&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('window.print()'));
});
