import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsSnapshot, normalizeAnalyticsRange, toCsv } from '../src/services/admin-analytics-core.js';

test('normalizes preset and custom analytics ranges with a hard maximum', () => {
  const now = new Date('2026-09-28T04:00:00.000Z');
  assert.deepEqual(normalizeAnalyticsRange({ days: 7 }, 'Asia/Dhaka', now), {
    from: '2026-09-22', to: '2026-09-28', days: 7, timezone: 'Asia/Dhaka',
  });
  assert.equal(normalizeAnalyticsRange({ from: '2026-09-01', to: '2026-09-28' }, 'Asia/Dhaka', now).days, 28);
  assert.throws(() => normalizeAnalyticsRange({ from: '2025-01-01', to: '2026-09-28' }, 'Asia/Dhaka', now), /cannot exceed 366 days/i);
});

test('builds delivered revenue, customer mix and product performance from persisted records', () => {
  const range = { from: '2026-09-22', to: '2026-09-28', days: 7, timezone: 'Asia/Dhaka' };
  const products = [
    { id: 'p1', name: 'Burger', category: 'Burgers', priceCents: 900, stock: 10, isAvailable: true, _count: { wishlistItems: 4 } },
    { id: 'p2', name: 'Salad', category: 'Healthy', priceCents: 700, stock: 7, isAvailable: true, _count: { wishlistItems: 2 } },
  ];
  const users = [{ id: 'u1', createdAt: new Date('2026-09-23T08:00:00.000Z') }];
  const common = {
    subtotalCents: 1800, discountCents: 100, pointsDiscountCents: 0, deliveryFeeCents: 100,
    fulfillmentType: 'DELIVERY', fulfillmentMode: 'ASAP', paymentMethod: 'COD', paymentStatus: 'PAID', couponCode: null,
    statusUpdatedAt: new Date('2026-09-25T08:30:00.000Z'), cancelledAt: null, phone: '01700000000',
  };
  const orders = [
    {
      ...common, id: 'o1', orderNumber: 'T-1', status: 'DELIVERED', totalCents: 1800, customerType: 'REGISTERED',
      firstName: 'A', lastName: 'User', email: 'a@example.com', userId: 'u1', user: { name: 'A User', email: 'a@example.com' },
      createdAt: new Date('2026-09-24T08:00:00.000Z'), deliveredAt: new Date('2026-09-25T08:30:00.000Z'),
      items: [{ productId: 'p1', productName: 'Burger', unitPriceCents: 900, quantity: 2, lineTotalCents: 1800 }], payment: { provider: 'COD', status: 'PAID' },
    },
    {
      ...common, id: 'o2', orderNumber: 'T-2', status: 'CANCELLED', totalCents: 700, subtotalCents: 700, discountCents: 0, deliveryFeeCents: 0,
      customerType: 'GUEST', firstName: 'Guest', lastName: 'Buyer', email: 'guest@example.com', userId: null, user: null,
      createdAt: new Date('2026-09-26T08:00:00.000Z'), deliveredAt: null,
      items: [{ productId: 'p2', productName: 'Salad', unitPriceCents: 700, quantity: 1, lineTotalCents: 700 }], payment: { provider: 'COD', status: 'PENDING' },
    },
  ];
  const snapshot = buildAnalyticsSnapshot({ range, orders, users, products, reviewGroups: [{ productId: 'p1', _avg: { rating: 4.5 }, _count: { rating: 2 } }] });
  assert.equal(snapshot.metrics.revenueCents, 1800);
  assert.equal(snapshot.metrics.deliveredOrders, 1);
  assert.equal(snapshot.metrics.ordersPlaced, 2);
  assert.equal(snapshot.metrics.cancelledOrders, 1);
  assert.equal(snapshot.metrics.guestOrderSharePercent, 50);
  assert.equal(snapshot.metrics.newCustomers, 1);
  assert.equal(snapshot.topProducts[0].name, 'Burger');
  assert.equal(snapshot.topProducts[0].units, 2);
  assert.equal(snapshot.topProducts[0].ratingAverage, 4.5);
  assert.equal(snapshot.slowProducts[0].name, 'Salad');
});

test('CSV encoding protects spreadsheet formulas and escapes delimiters', () => {
  const csv = toCsv([{ name: '=2+2', note: 'hello, "world"' }, { name: '@SUM(A1:A2)', note: 'safe' }]);
  assert.match(csv, /'=2\+2/);
  assert.match(csv, /'@SUM\(A1:A2\)/);
  assert.match(csv, /"hello, ""world"""/);
});
