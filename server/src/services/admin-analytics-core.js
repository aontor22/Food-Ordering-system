import { AppError } from '../lib/errors.js';

const DAY_MS = 86_400_000;
export const DEFAULT_ANALYTICS_TIMEZONE = 'Asia/Dhaka';
const MAX_RANGE_DAYS = 366;
const CSV_FORMULA_PREFIX = /^[\t\r\n ]*[=+\-@]/;

function datePartsInTimezone(value, timezone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(value).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dayCountInclusive(from, to) {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  return Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

function shiftDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function normalizeAnalyticsRange(input = {}, timezone = DEFAULT_ANALYTICS_TIMEZONE, now = new Date()) {
  const today = datePartsInTimezone(now, timezone);
  let from;
  let to;

  if (input.from || input.to) {
    if (!input.from || !input.to || !isDateKey(input.from) || !isDateKey(input.to)) {
      throw new AppError(400, 'INVALID_ANALYTICS_RANGE', 'Provide both from and to as YYYY-MM-DD dates');
    }
    from = input.from;
    to = input.to;
  } else {
    const days = Number(input.days || 30);
    if (![7, 30, 90].includes(days)) throw new AppError(400, 'INVALID_ANALYTICS_RANGE', 'Analytics range must be 7, 30, or 90 days');
    to = today;
    from = shiftDateKey(today, -(days - 1));
  }

  if (from > to) throw new AppError(400, 'INVALID_ANALYTICS_RANGE', 'Analytics start date cannot be after the end date');
  const days = dayCountInclusive(from, to);
  if (days < 1 || days > MAX_RANGE_DAYS) throw new AppError(400, 'ANALYTICS_RANGE_TOO_LARGE', `Analytics range cannot exceed ${MAX_RANGE_DAYS} days`);
  return { from, to, days, timezone };
}

export function approximateUtcBounds(range) {
  const from = new Date(`${range.from}T00:00:00.000Z`);
  const to = new Date(`${range.to}T23:59:59.999Z`);
  from.setUTCDate(from.getUTCDate() - 2);
  to.setUTCDate(to.getUTCDate() + 2);
  return { from, to };
}

function inRange(value, range) {
  if (!value) return false;
  const key = datePartsInTimezone(value, range.timezone);
  return key >= range.from && key <= range.to;
}

function orderRecognizedAt(order) {
  return order.deliveredAt || order.statusUpdatedAt || order.createdAt;
}

function customerIdentity(order) {
  if (order.userId) return `user:${order.userId}`;
  return `guest:${String(order.email || '').trim().toLowerCase()}`;
}

function safePercent(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
}

function average(values) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function groupCounter(items, keyFn, valueFn = () => 1) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + valueFn(item));
  }
  return map;
}

function sortedBreakdown(map, total) {
  return [...map.entries()]
    .map(([label, count]) => ({ label, count, sharePercent: safePercent(count, total) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function buildDailySeries(deliveredOrders, range) {
  const byDay = new Map();
  for (const order of deliveredOrders) {
    const key = datePartsInTimezone(orderRecognizedAt(order), range.timezone);
    const current = byDay.get(key) || { date: key, orders: 0, revenueCents: 0 };
    current.orders += 1;
    current.revenueCents += order.totalCents;
    byDay.set(key, current);
  }

  const result = [];
  for (let key = range.from; key <= range.to; key = shiftDateKey(key, 1)) {
    result.push(byDay.get(key) || { date: key, orders: 0, revenueCents: 0 });
  }
  return result;
}

function buildProductMetrics(products, reviewGroups, deliveredOrders) {
  const metrics = new Map(products.map(product => [product.id, {
    id: product.id,
    name: product.name,
    category: product.category,
    priceCents: product.priceCents,
    stock: product.stock,
    isAvailable: product.isAvailable,
    wishlistCount: product._count?.wishlistItems || 0,
    units: 0,
    revenueCents: 0,
    orderCount: 0,
    ratingAverage: 0,
    reviewCount: 0,
  }]));
  for (const group of reviewGroups) {
    const metric = metrics.get(group.productId);
    if (!metric) continue;
    metric.ratingAverage = Number(group._avg?.rating || 0);
    metric.reviewCount = group._count?.rating || 0;
  }

  const orderSets = new Map();
  for (const order of deliveredOrders) {
    for (const item of order.items) {
      let metric = metrics.get(item.productId);
      if (!metric) {
        metric = {
          id: item.productId,
          name: item.productName,
          category: 'Archived',
          priceCents: item.unitPriceCents,
          stock: 0,
          isAvailable: false,
          wishlistCount: 0,
          units: 0,
          revenueCents: 0,
          orderCount: 0,
          ratingAverage: 0,
          reviewCount: 0,
        };
        metrics.set(item.productId, metric);
      }
      metric.units += item.quantity;
      metric.revenueCents += item.lineTotalCents;
      if (!orderSets.has(metric.id)) orderSets.set(metric.id, new Set());
      orderSets.get(metric.id).add(order.id);
    }
  }
  for (const [id, set] of orderSets) metrics.get(id).orderCount = set.size;
  return [...metrics.values()];
}

function buildCategoryMetrics(productMetrics) {
  const map = new Map();
  for (const product of productMetrics) {
    const key = product.category || 'Uncategorized';
    const current = map.get(key) || { category: key, units: 0, revenueCents: 0, products: 0 };
    current.units += product.units;
    current.revenueCents += product.revenueCents;
    current.products += 1;
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => b.revenueCents - a.revenueCents || b.units - a.units || a.category.localeCompare(b.category));
}

function buildCustomerMetrics(placedOrders, deliveredOrders) {
  const orderCounts = new Map();
  for (const order of placedOrders) {
    const id = customerIdentity(order);
    orderCounts.set(id, (orderCounts.get(id) || 0) + 1);
  }

  const customers = new Map();
  for (const order of deliveredOrders) {
    const id = customerIdentity(order);
    const current = customers.get(id) || {
      id,
      userId: order.userId || null,
      name: order.user?.name || `${order.firstName} ${order.lastName}`.trim(),
      email: order.user?.email || order.email,
      customerType: order.customerType,
      deliveredOrders: 0,
      revenueCents: 0,
    };
    if (current.customerType !== order.customerType) current.customerType = 'MIXED';
    current.deliveredOrders += 1;
    current.revenueCents += order.totalCents;
    customers.set(id, current);
  }

  return {
    repeatCustomers: [...orderCounts.values()].filter(count => count >= 2).length,
    uniqueOrderingCustomers: orderCounts.size,
    topCustomers: [...customers.values()].sort((a, b) => b.revenueCents - a.revenueCents || b.deliveredOrders - a.deliveredOrders).slice(0, 10),
  };
}

export function buildAnalyticsSnapshot({ range, orders, users, products, reviewGroups }) {
  const placedOrders = orders.filter(order => inRange(order.createdAt, range));
  const deliveredOrders = orders.filter(order => order.status === 'DELIVERED' && inRange(orderRecognizedAt(order), range));
  const newCustomers = users.filter(user => inRange(user.createdAt, range)).length;
  const customerMetrics = buildCustomerMetrics(placedOrders, deliveredOrders);
  const productMetrics = buildProductMetrics(products, reviewGroups, deliveredOrders);
  const categoryMetrics = buildCategoryMetrics(productMetrics);

  const revenueCents = deliveredOrders.reduce((sum, order) => sum + order.totalCents, 0);
  const subtotalCents = deliveredOrders.reduce((sum, order) => sum + order.subtotalCents, 0);
  const deliveryFeesCents = deliveredOrders.reduce((sum, order) => sum + order.deliveryFeeCents, 0);
  const discountsCents = deliveredOrders.reduce((sum, order) => sum + order.discountCents + order.pointsDiscountCents, 0);
  const unitsSold = deliveredOrders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0);
  const cancelledOrders = placedOrders.filter(order => order.status === 'CANCELLED').length;
  const guestOrders = placedOrders.filter(order => order.customerType === 'GUEST').length;
  const registeredOrders = placedOrders.length - guestOrders;
  const fulfillmentMinutes = deliveredOrders.filter(order => order.deliveredAt).map(order => Math.max(0, Math.round((new Date(order.deliveredAt).getTime() - new Date(order.createdAt).getTime()) / 60_000)));

  const paymentMap = new Map();
  for (const order of deliveredOrders) {
    const key = order.paymentMethod || order.payment?.provider || 'UNKNOWN';
    const current = paymentMap.get(key) || { label: key, count: 0, revenueCents: 0 };
    current.count += 1;
    current.revenueCents += order.totalCents;
    paymentMap.set(key, current);
  }

  const fulfillmentMap = groupCounter(placedOrders, order => order.fulfillmentType || 'DELIVERY');
  const schedulingMap = groupCounter(placedOrders, order => order.fulfillmentMode || 'ASAP');
  const statusMap = groupCounter(placedOrders, order => order.status || 'UNKNOWN');

  return {
    range,
    metrics: {
      revenueCents,
      deliveredOrders: deliveredOrders.length,
      averageOrderValueCents: deliveredOrders.length ? Math.round(revenueCents / deliveredOrders.length) : 0,
      ordersPlaced: placedOrders.length,
      cancelledOrders,
      cancellationRatePercent: safePercent(cancelledOrders, placedOrders.length),
      unitsSold,
      subtotalCents,
      deliveryFeesCents,
      discountsCents,
      newCustomers,
      uniqueOrderingCustomers: customerMetrics.uniqueOrderingCustomers,
      repeatCustomers: customerMetrics.repeatCustomers,
      repeatCustomerRatePercent: safePercent(customerMetrics.repeatCustomers, customerMetrics.uniqueOrderingCustomers),
      guestOrders,
      registeredOrders,
      guestOrderSharePercent: safePercent(guestOrders, placedOrders.length),
      averageFulfillmentMinutes: average(fulfillmentMinutes),
    },
    salesSeries: buildDailySeries(deliveredOrders, range),
    ordersByStatus: sortedBreakdown(statusMap, placedOrders.length),
    fulfillmentMix: sortedBreakdown(fulfillmentMap, placedOrders.length),
    schedulingMix: sortedBreakdown(schedulingMap, placedOrders.length),
    paymentMix: [...paymentMap.values()].sort((a, b) => b.revenueCents - a.revenueCents || b.count - a.count),
    topProducts: productMetrics.filter(product => product.units > 0).sort((a, b) => b.revenueCents - a.revenueCents || b.units - a.units).slice(0, 10),
    slowProducts: productMetrics.filter(product => product.isAvailable).sort((a, b) => a.units - b.units || a.revenueCents - b.revenueCents || a.name.localeCompare(b.name)).slice(0, 8),
    categoryPerformance: categoryMetrics.filter(category => category.units > 0).slice(0, 10),
    topCustomers: customerMetrics.topCustomers,
    productMetrics,
    _placedOrders: placedOrders,
    _deliveredOrders: deliveredOrders,
  };
}


function protectCsvFormula(value) {
  const string = value == null ? '' : String(value);
  return CSV_FORMULA_PREFIX.test(string) ? `'${string}` : string;
}

export function toCsv(rows) {
  if (!rows.length) return '\uFEFF';
  const headers = Object.keys(rows[0]);
  const encode = value => {
    const safe = protectCsvFormula(value);
    return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  return `\uFEFF${headers.map(encode).join(',')}\r\n${rows.map(row => headers.map(header => encode(row[header])).join(',')).join('\r\n')}\r\n`;
}

