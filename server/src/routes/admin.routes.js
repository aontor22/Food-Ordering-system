import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { serializePayment, reconcileSslCommerzPayment } from '../services/payment.js';

const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

const empty = z.any();
const imageUrl = z.string().trim().max(500).nullable().optional().refine(
  value => !value || value.startsWith('/') || /^https?:\/\//i.test(value),
  'Image URL must be an HTTP(S) URL or a root-relative path',
);
const productFields = {
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().min(5).max(500),
  category: z.string().trim().min(2).max(50),
  imageUrl,
  priceCents: z.number().int().positive().max(10_000_000),
  stock: z.number().int().nonnegative().max(1_000_000),
  isAvailable: z.boolean(),
};
const productCreate = z.object({
  body: z.object({ id: z.string().trim().min(1).max(50).optional(), ...productFields }),
  params: empty,
  query: empty,
});
const productUpdate = z.object({
  body: z.object(productFields).partial().refine(value => Object.keys(value).length > 0, 'At least one field is required'),
  params: z.object({ id: z.string().min(1) }),
  query: empty,
});

router.get('/products', async (_req, res) => {
  const products = await prisma.product.findMany({ orderBy: [{ isAvailable: 'desc' }, { updatedAt: 'desc' }] });
  res.json({ products });
});

router.post('/products', validate(productCreate), async (req, res, next) => {
  try {
    const { id, ...values } = req.validated.body;
    const product = await prisma.product.create({
      data: { id: id || `prd_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`, ...values },
    });
    await audit(req, 'PRODUCT_CREATED', 'Product', product.id);
    res.status(201).json({ product });
  } catch (error) { next(error); }
});

router.patch('/products/:id', validate(productUpdate), async (req, res, next) => {
  try {
    const product = await prisma.product.update({ where: { id: req.validated.params.id }, data: req.validated.body });
    await audit(req, 'PRODUCT_UPDATED', 'Product', product.id, req.validated.body);
    res.json({ product });
  } catch (error) { next(error); }
});

router.delete('/products/:id', async (req, res, next) => {
  try {
    const product = await prisma.product.update({ where: { id: req.params.id }, data: { isAvailable: false } });
    await audit(req, 'PRODUCT_ARCHIVED', 'Product', product.id);
    res.status(204).end();
  } catch (error) { next(error); }
});

router.get('/orders', async (_req, res) => {
  const orders = await prisma.order.findMany({
    include: { items: true, payment: true, user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 250,
  });
  res.json({ orders: orders.map(order => ({ ...order, payment: serializePayment(order.payment) })) });
});

const orderTransitions = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};
const statusUpdate = z.object({
  body: z.object({ status: z.enum(['PENDING', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']) }),
  params: z.object({ id: z.string().min(1) }),
  query: empty,
});

router.patch('/orders/:id/status', validate(statusUpdate), async (req, res, next) => {
  try {
    let previousStatus;
    const order = await prisma.$transaction(async transaction => {
    const existing = await transaction.order.findUnique({ where: { id: req.validated.params.id }, include: { items: true, payment: true } });
    if (!existing) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    const nextStatus = req.validated.body.status;
    previousStatus = existing.status;
    if (!orderTransitions[existing.status]?.includes(nextStatus)) {
      throw new AppError(409, 'INVALID_STATUS_TRANSITION', `Order cannot move from ${existing.status} to ${nextStatus}`);
    }
    if (nextStatus === 'CANCELLED' && existing.paymentMethod === 'ONLINE' && existing.paymentStatus === 'PAID') {
      throw new AppError(409, 'REFUND_REQUIRED', 'Refund the online payment before cancelling this order');
    }
    if (existing.paymentMethod === 'ONLINE' && existing.paymentStatus !== 'PAID' && nextStatus !== 'CANCELLED') {
      throw new AppError(409, 'PAYMENT_REQUIRED', 'Online payment must be verified before fulfilment can begin');
    }
    const settleCod = nextStatus === 'DELIVERED' && existing.paymentMethod === 'COD' && existing.paymentStatus !== 'REFUNDED';
    if (nextStatus === 'CANCELLED' && existing.payment?.provider === 'SSLCOMMERZ' && ['PROCESSING', 'REVIEW'].includes(existing.payment.status)) throw new AppError(409, 'PAYMENT_PROCESSING', 'Wait for gateway verification before cancelling');
      if (nextStatus === 'CANCELLED') {
        for (const item of existing.items) {
          await transaction.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
        }
        if (existing.payment) await transaction.payment.updateMany({ where: { id: existing.payment.id, status: { notIn: ['PAID', 'REFUNDED'] } }, data: { status: 'CANCELLED', failureReason: 'Order cancelled by administrator' } });
      }
      if (settleCod && existing.payment) {
        await transaction.payment.updateMany({ where: { id: existing.payment.id, status: { notIn: ['PAID', 'REFUNDED'] } }, data: { status: 'PAID', paidAt: new Date(), failureReason: null } });
      }
      return transaction.order.update({
        where: { id: existing.id },
        data: {
          status: nextStatus,
          ...(settleCod ? { paymentStatus: 'PAID' } : {}),
          ...(nextStatus === 'CANCELLED' && !['PAID', 'REFUNDED'].includes(existing.paymentStatus) ? { paymentStatus: 'CANCELLED' } : {}),
        },
        include: { items: true, payment: true, user: { select: { id: true, name: true, email: true } } },
      });
    });
    await audit(req, 'ORDER_STATUS_UPDATED', 'Order', order.id, { from: previousStatus, to: order.status });
    res.json({ order: { ...order, payment: serializePayment(order.payment) } });
  } catch (error) { next(error); }
});

router.get('/payments', async (_req, res) => {
  const payments = await prisma.payment.findMany({
    include: { order: { include: { user: { select: { id: true, name: true, email: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 250,
  });
  res.json({ payments: payments.map(payment => ({ ...serializePayment(payment), order: payment.order })) });
});

router.post('/payments/:id/check', async (req, res, next) => {
  try {
    const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
    if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    if (payment.provider !== 'SSLCOMMERZ') throw new AppError(409, 'NOT_GATEWAY_PAYMENT', 'This payment does not use SSLCOMMERZ');
    await reconcileSslCommerzPayment(payment.transactionId);
    await audit(req, 'PAYMENT_STATUS_CHECKED', 'Payment', payment.id);
    res.json({ payment: serializePayment(await prisma.payment.findUnique({ where: { id: payment.id } })) });
  } catch (error) { next(error); }
});

router.post('/payments/:id/cash-received', async (req, res, next) => {
  try {
    const payment = await prisma.$transaction(async transaction => {
    const existing = await transaction.payment.findUnique({ where: { id: req.params.id }, include: { order: true } });
    if (!existing) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    if (existing.provider !== 'COD') throw new AppError(409, 'GATEWAY_VERIFICATION_REQUIRED', 'Online payments can only be confirmed by the payment gateway');
    if (existing.order.status === 'CANCELLED') throw new AppError(409, 'ORDER_CANCELLED', 'A cancelled order cannot be marked as paid');
    if (existing.status === 'PAID') return existing;
    if (existing.status === 'REFUNDED') throw new AppError(409, 'PAYMENT_REFUNDED', 'A refunded payment cannot be collected again');
      const updated = await transaction.payment.update({ where: { id: existing.id }, data: { status: 'PAID', paidAt: new Date(), failureReason: null } });
      await transaction.order.update({ where: { id: existing.orderId }, data: { paymentStatus: 'PAID' } });
      return updated;
    });
    await audit(req, 'CASH_PAYMENT_CONFIRMED', 'Payment', payment.id, { orderId: payment.orderId });
    res.json({ payment: serializePayment(payment) });
  } catch (error) { next(error); }
});

router.post('/payments/:id/cash-refunded', async (req, res, next) => {
  try {
    const payment = await prisma.$transaction(async transaction => {
    const existing = await transaction.payment.findUnique({ where: { id: req.params.id }, include: { order: true } });
    if (!existing) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    if (existing.provider !== 'COD' || existing.status !== 'PAID') throw new AppError(409, 'MANUAL_REFUND_NOT_ALLOWED', 'Only a paid cash-on-delivery transaction can be manually refunded');
      const updated = await transaction.payment.update({ where: { id: existing.id }, data: { status: 'REFUNDED', failureReason: null } });
      await transaction.order.update({ where: { id: existing.orderId }, data: { paymentStatus: 'REFUNDED' } });
      return updated;
    });
    await audit(req, 'CASH_PAYMENT_REFUNDED', 'Payment', payment.id, { orderId: payment.orderId });
    res.json({ payment: serializePayment(payment) });
  } catch (error) { next(error); }
});

router.get('/users', async (_req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true, name: true, email: true, role: true, isActive: true, createdAt: true,
      _count: { select: { orders: true } },
      orders: { where: { status: 'DELIVERED' }, select: { totalCents: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    users: users.map(({ orders, _count, ...user }) => ({
      ...user,
      orderCount: _count.orders,
      lifetimeValueCents: orders.reduce((total, order) => total + order.totalCents, 0),
    })),
  });
});

const userUpdate = z.object({
  body: z.object({ isActive: z.boolean() }),
  params: z.object({ id: z.string().min(1) }),
  query: empty,
});

router.patch('/users/:id', validate(userUpdate), async (req, res, next) => {
  try {
    if (req.validated.params.id === req.auth.sub && !req.validated.body.isActive) {
      throw new AppError(409, 'CANNOT_DISABLE_SELF', 'You cannot disable your own administrator account');
    }
    const existing = await prisma.user.findUnique({ where: { id: req.validated.params.id } });
    if (!existing) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    if (existing.role === 'ADMIN' && !req.validated.body.isActive) {
      throw new AppError(409, 'ADMIN_PROTECTED', 'Administrator accounts cannot be disabled from this screen');
    }
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: { isActive: req.validated.body.isActive },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    });
    if (!user.isActive) await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(req, user.isActive ? 'USER_ENABLED' : 'USER_DISABLED', 'User', user.id);
    res.json({ user });
  } catch (error) { next(error); }
});

const couponFields = {
  code: z.string().trim().min(3).max(30).regex(/^[A-Za-z0-9_-]+$/).transform(value => value.toUpperCase()),
  percentOff: z.number().int().min(1).max(100),
  minimumCents: z.number().int().nonnegative().max(100_000_000),
  active: z.boolean(),
  expiresAt: z.union([z.iso.datetime(), z.literal(''), z.null()]).optional().transform(value => value ? new Date(value) : null),
};

router.get('/coupons', async (_req, res) => {
  res.json({ coupons: await prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } }) });
});

router.post('/coupons', validate(z.object({ body: z.object(couponFields), params: empty, query: empty })), async (req, res, next) => {
  try {
    const coupon = await prisma.coupon.create({ data: req.validated.body });
    await audit(req, 'COUPON_CREATED', 'Coupon', coupon.id, { code: coupon.code });
    res.status(201).json({ coupon });
  } catch (error) { next(error); }
});

router.patch('/coupons/:id', validate(z.object({
  body: z.object(couponFields).partial().refine(value => Object.keys(value).length > 0, 'At least one field is required'),
  params: z.object({ id: z.string().min(1) }),
  query: empty,
})), async (req, res, next) => {
  try {
    const coupon = await prisma.coupon.update({ where: { id: req.validated.params.id }, data: req.validated.body });
    await audit(req, 'COUPON_UPDATED', 'Coupon', coupon.id, req.validated.body);
    res.json({ coupon });
  } catch (error) { next(error); }
});

router.delete('/coupons/:id', async (req, res, next) => {
  try {
    const coupon = await prisma.coupon.update({ where: { id: req.params.id }, data: { active: false } });
    await audit(req, 'COUPON_DISABLED', 'Coupon', coupon.id, { code: coupon.code });
    res.status(204).end();
  } catch (error) { next(error); }
});

router.get('/audit-logs', async (_req, res) => {
  const logs = await prisma.auditLog.findMany({
    include: { actor: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ logs });
});

router.get('/dashboard', async (_req, res) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(startOfToday);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  const [customers, orders, products, revenue, todayOrders, pendingOrders, lowStock, recentOrders, statusGroups, deliveredThisWeek, topItems] = await Promise.all([
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.order.count(),
    prisma.product.count({ where: { isAvailable: true } }),
    prisma.order.aggregate({ where: { status: 'DELIVERED' }, _sum: { totalCents: true } }),
    prisma.order.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.order.count({ where: { status: { in: ['PENDING', 'CONFIRMED', 'PREPARING'] } } }),
    prisma.product.count({ where: { isAvailable: true, stock: { lte: 10 } } }),
    prisma.order.findMany({ include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: 6 }),
    prisma.order.groupBy({ by: ['status'], _count: { status: true } }),
    prisma.order.findMany({ where: { status: 'DELIVERED', createdAt: { gte: sevenDaysAgo } }, select: { totalCents: true, createdAt: true } }),
    prisma.orderItem.groupBy({ by: ['productName'], _sum: { quantity: true, lineTotalCents: true }, orderBy: { _sum: { quantity: 'desc' } }, take: 5 }),
  ]);

  const revenueByDay = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(sevenDaysAgo);
    date.setDate(date.getDate() + index);
    const key = date.toISOString().slice(0, 10);
    return {
      date: key,
      revenueCents: deliveredThisWeek.filter(order => order.createdAt.toISOString().slice(0, 10) === key).reduce((sum, order) => sum + order.totalCents, 0),
    };
  });

  res.json({
    metrics: { customers, orders, products, revenueCents: revenue._sum.totalCents || 0, todayOrders, pendingOrders, lowStock },
    recentOrders,
    ordersByStatus: statusGroups.map(group => ({ status: group.status, count: group._count.status })),
    revenueByDay,
    topProducts: topItems.map(item => ({ name: item.productName, quantity: item._sum.quantity || 0, revenueCents: item._sum.lineTotalCents || 0 })),
  });
});

export default router;
