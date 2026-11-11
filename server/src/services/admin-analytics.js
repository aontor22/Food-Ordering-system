import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import {
  DEFAULT_ANALYTICS_TIMEZONE,
  approximateUtcBounds,
  buildAnalyticsSnapshot,
  normalizeAnalyticsRange,
  toCsv,
} from './admin-analytics-core.js';

async function loadAnalyticsContext(rawRange = {}) {
  const settings = await prisma.restaurantSetting.findUnique({ where: { id: 'default' }, select: { timezone: true } });
  const timezone = settings?.timezone || DEFAULT_ANALYTICS_TIMEZONE;
  const range = normalizeAnalyticsRange(rawRange, timezone);
  const bounds = approximateUtcBounds(range);

  const [orders, users, products, reviewGroups] = await Promise.all([
    prisma.order.findMany({
      where: {
        OR: [
          { createdAt: { gte: bounds.from, lte: bounds.to } },
          { deliveredAt: { gte: bounds.from, lte: bounds.to } },
          { statusUpdatedAt: { gte: bounds.from, lte: bounds.to } },
        ],
      },
      select: {
        id: true, orderNumber: true, status: true, paymentMethod: true, paymentStatus: true,
        subtotalCents: true, discountCents: true, pointsDiscountCents: true, deliveryFeeCents: true, totalCents: true,
        couponCode: true, fulfillmentType: true, fulfillmentMode: true, customerType: true,
        firstName: true, lastName: true, email: true, phone: true,
        createdAt: true, statusUpdatedAt: true, deliveredAt: true, cancelledAt: true,
        userId: true,
        user: { select: { name: true, email: true } },
        payment: { select: { provider: true, status: true } },
        items: { select: { productId: true, productName: true, unitPriceCents: true, quantity: true, lineTotalCents: true } },
      },
    }),
    prisma.user.findMany({
      where: { role: 'CUSTOMER' },
      select: { id: true, name: true, email: true, isActive: true, pointsBalance: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.product.findMany({
      select: {
        id: true, name: true, category: true, priceCents: true, stock: true, isAvailable: true,
        isVegetarian: true, isVegan: true, isHalal: true, isGlutenFree: true,
        _count: { select: { wishlistItems: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.review.groupBy({
      by: ['productId'],
      where: { status: 'PUBLISHED' },
      _avg: { rating: true },
      _count: { rating: true },
    }),
  ]);

  return { range, orders, users, products, reviewGroups };
}

function stripInternalAnalytics(snapshot) {
  const { _placedOrders, _deliveredOrders, productMetrics: _productMetrics, ...publicData } = snapshot;
  return publicData;
}

export async function getAdminAnalytics(rawRange = {}) {
  const context = await loadAnalyticsContext(rawRange);
  return stripInternalAnalytics(buildAnalyticsSnapshot(context));
}

function customerExportRows(snapshot, users) {
  const placedByUser = new Map();
  const deliveredByUser = new Map();
  for (const order of snapshot._placedOrders) {
    if (!order.userId) continue;
    placedByUser.set(order.userId, (placedByUser.get(order.userId) || 0) + 1);
  }
  for (const order of snapshot._deliveredOrders) {
    if (!order.userId) continue;
    const current = deliveredByUser.get(order.userId) || { orders: 0, revenueCents: 0 };
    current.orders += 1;
    current.revenueCents += order.totalCents;
    deliveredByUser.set(order.userId, current);
  }
  return users.map(user => ({
    customer_id: user.id,
    name: user.name,
    email: user.email,
    active: user.isActive ? 'yes' : 'no',
    joined_at: new Date(user.createdAt).toISOString(),
    points_balance: user.pointsBalance,
    orders_placed_in_range: placedByUser.get(user.id) || 0,
    delivered_orders_in_range: deliveredByUser.get(user.id)?.orders || 0,
    delivered_revenue_in_range_cents: deliveredByUser.get(user.id)?.revenueCents || 0,
  }));
}

export async function getAdminAnalyticsCsv(type, rawRange = {}) {
  const context = await loadAnalyticsContext(rawRange);
  const snapshot = buildAnalyticsSnapshot(context);
  let rows;

  if (type === 'daily-sales') {
    rows = snapshot.salesSeries.map(day => ({ date: day.date, delivered_orders: day.orders, revenue_cents: day.revenueCents }));
  } else if (type === 'orders') {
    rows = [...snapshot._placedOrders].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).map(order => ({
      order_number: order.orderNumber,
      created_at: new Date(order.createdAt).toISOString(),
      status: order.status,
      customer_type: order.customerType,
      customer_name: order.user?.name || `${order.firstName} ${order.lastName}`.trim(),
      customer_email: order.user?.email || order.email,
      phone: order.phone,
      fulfillment_type: order.fulfillmentType,
      fulfillment_mode: order.fulfillmentMode,
      payment_method: order.paymentMethod,
      payment_status: order.paymentStatus,
      subtotal_cents: order.subtotalCents,
      discount_cents: order.discountCents,
      points_discount_cents: order.pointsDiscountCents,
      delivery_fee_cents: order.deliveryFeeCents,
      total_cents: order.totalCents,
      coupon_code: order.couponCode || '',
      item_units: order.items.reduce((sum, item) => sum + item.quantity, 0),
    }));
  } else if (type === 'products') {
    rows = snapshot.productMetrics.map(product => ({
      product_id: product.id,
      name: product.name,
      category: product.category,
      available: product.isAvailable ? 'yes' : 'no',
      current_price_cents: product.priceCents,
      current_stock: product.stock,
      units_sold_in_range: product.units,
      delivered_orders_in_range: product.orderCount,
      delivered_revenue_in_range_cents: product.revenueCents,
      published_review_count: product.reviewCount,
      average_rating: product.ratingAverage ? product.ratingAverage.toFixed(2) : '',
      wishlist_saves: product.wishlistCount,
    }));
  } else if (type === 'customers') {
    rows = customerExportRows(snapshot, context.users);
  } else {
    throw new AppError(400, 'INVALID_ANALYTICS_EXPORT', 'Unsupported analytics export type');
  }

  const filename = `tomato-${type}-${snapshot.range.from}-to-${snapshot.range.to}.csv`;
  return { filename, csv: toCsv(rows), range: snapshot.range, rowCount: rows.length };
}
