import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { approveSslCommerzRiskPayment, getGatewayConfiguration, requestSslCommerzRefund, reconcileSslCommerzPayment, reconcileSslCommerzRefund, serializePayment } from '../services/payment.js';
import { validateChannel, reviewManualPayment, refundManualPayment } from '../services/manual-payment.js';
import { config } from '../config.js';
import { awardDeliveredOrderPoints, getLoyaltySettings, restoreCancelledOrderPoints } from '../services/loyalty.js';
import { cloudinaryConfigured, cloudinaryFolder, createCloudinaryUploadSignature, destroyCloudinaryImage, optimizeCloudinaryUrl, ownsCloudinaryPublicId } from '../lib/cloudinary.js';
import { migrateLegacyProductImages } from '../services/product-media.js';

const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

const empty = z.any();
const imageUrl = z.string().trim().max(500).nullable().optional().refine(
  value => !value || value.startsWith('/') || /^https?:\/\//i.test(value),
  'Image URL must be an HTTP(S) URL or a root-relative path',
);
const imagePublicId = z.string().trim().min(1).max(255).nullable().optional();
const productFields = {
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().min(5).max(500),
  category: z.string().trim().min(2).max(50),
  imageUrl,
  imagePublicId,
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
  const products = await prisma.product.findMany({
    include: { _count: { select: { wishlistItems: true } } },
    orderBy: [{ isAvailable: 'desc' }, { updatedAt: 'desc' }],
  });
  res.json({ products: products.map(({ _count, ...product }) => ({ ...product, wishlistCount: _count.wishlistItems })) });
});

function normalizeProductMedia(values) {
  const next = { ...values };
  if ('imagePublicId' in next && next.imagePublicId) {
    if (!cloudinaryConfigured()) throw new AppError(503, 'CLOUDINARY_NOT_CONFIGURED', 'Cloudinary is not configured on the server');
    if (!ownsCloudinaryPublicId(next.imagePublicId)) throw new AppError(400, 'INVALID_CLOUDINARY_ASSET', 'Product image is outside the configured Cloudinary folder');
    if (!next.imageUrl || !/^https:\/\/res\.cloudinary\.com\//i.test(next.imageUrl)) throw new AppError(400, 'INVALID_CLOUDINARY_URL', 'Cloudinary product images require a Cloudinary HTTPS URL');
    next.imageUrl = optimizeCloudinaryUrl(next.imageUrl);
  }
  if ('imageUrl' in next && !next.imageUrl) next.imageUrl = null;
  if ('imagePublicId' in next && !next.imagePublicId) next.imagePublicId = null;
  return next;
}

router.post('/products', validate(productCreate), async (req, res, next) => {
  try {
    const { id, ...rawValues } = req.validated.body;
    const values = normalizeProductMedia(rawValues);
    const product = await prisma.product.create({
      data: { id: id || `prd_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`, ...values },
    });
    await audit(req, 'PRODUCT_CREATED', 'Product', product.id, { imageStorage: product.imagePublicId ? 'cloudinary' : 'external_or_local' });
    res.status(201).json({ product });
  } catch (error) { next(error); }
});

router.patch('/products/:id', validate(productUpdate), async (req, res, next) => {
  try {
    const existing = await prisma.product.findUnique({ where: { id: req.validated.params.id } });
    if (!existing) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    const values = normalizeProductMedia(req.validated.body);
    const product = await prisma.product.update({ where: { id: existing.id }, data: values });
    if (existing.imagePublicId && existing.imagePublicId !== product.imagePublicId) {
      try { await destroyCloudinaryImage(existing.imagePublicId); }
      catch (cleanupError) { req.log?.warn({ err: cleanupError, publicId: existing.imagePublicId }, 'old product image cleanup failed'); }
    }
    await audit(req, 'PRODUCT_UPDATED', 'Product', product.id, { ...req.validated.body, imageStorage: product.imagePublicId ? 'cloudinary' : 'external_or_local' });
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

router.get('/media', async (_req, res) => {
  const legacyImageCount = await prisma.product.count({ where: { imagePublicId: null, imageUrl: { startsWith: '/' } } });
  res.json({ configured: cloudinaryConfigured(), folder: cloudinaryFolder(), legacyImageCount, maxUploadBytes: 8 * 1024 * 1024 });
});

router.post('/media/signature', async (_req, res, next) => {
  try { res.json(createCloudinaryUploadSignature()); }
  catch (error) { next(error); }
});

router.post('/media/cleanup', validate(z.object({
  body: z.object({ publicId: z.string().trim().min(1).max(255) }), params: empty, query: empty,
})), async (req, res, next) => {
  try {
    const linked = await prisma.product.count({ where: { imagePublicId: req.validated.body.publicId } });
    if (linked) throw new AppError(409, 'IMAGE_IN_USE', 'This Cloudinary image is already linked to a product');
    const result = await destroyCloudinaryImage(req.validated.body.publicId);
    res.json({ result: result.result || 'ok' });
  } catch (error) { next(error); }
});

router.post('/media/migrate-legacy', async (req, res, next) => {
  try {
    if (!cloudinaryConfigured()) throw new AppError(503, 'CLOUDINARY_NOT_CONFIGURED', 'Cloudinary is not configured on the server');
    const result = await migrateLegacyProductImages(prisma, { logger: req.log || console });
    await audit(req, 'PRODUCT_IMAGES_MIGRATED', 'Product', 'cloudinary', result);
    res.json(result);
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
    let pointsAwarded = 0;
    let pointsRestored = 0;
    const order = await prisma.$transaction(async transaction => {
      const existing = await transaction.order.findUnique({ where: { id: req.validated.params.id }, include: { items: true, payment: true } });
      if (!existing) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
      const nextStatus = req.validated.body.status;
      previousStatus = existing.status;
      if (!orderTransitions[existing.status]?.includes(nextStatus)) {
        throw new AppError(409, 'INVALID_STATUS_TRANSITION', `Order cannot move from ${existing.status} to ${nextStatus}`);
      }
      if (nextStatus === 'CANCELLED' && existing.paymentMethod !== 'COD' && existing.paymentStatus === 'PAID') {
        throw new AppError(409, 'REFUND_REQUIRED', 'Record the refund before cancelling this prepaid order');
      }
      if (existing.paymentMethod !== 'COD' && existing.paymentStatus !== 'PAID' && nextStatus !== 'CANCELLED') {
        throw new AppError(409, 'PAYMENT_REQUIRED', 'Payment must be verified before fulfilment can begin');
      }
      if (nextStatus === 'CANCELLED' && existing.paymentMethod === 'MANUAL' && existing.paymentStatus === 'REVIEW') throw new AppError(409, 'PAYMENT_UNDER_REVIEW', 'Review the submitted payment before cancelling');
      if (nextStatus === 'CANCELLED' && existing.payment?.provider === 'SSLCOMMERZ' && ['PROCESSING', 'REVIEW', 'REFUND_PENDING'].includes(existing.payment.status)) throw new AppError(409, 'PAYMENT_PROCESSING', 'Wait for gateway payment/refund verification before cancelling');
      const settleCod = nextStatus === 'DELIVERED' && existing.paymentMethod === 'COD' && existing.paymentStatus !== 'REFUNDED';

      if (nextStatus === 'CANCELLED') {
        for (const item of existing.items) await transaction.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
        if (existing.payment) await transaction.payment.updateMany({ where: { id: existing.payment.id, status: { notIn: ['PAID', 'REFUNDED'] } }, data: { status: 'CANCELLED', failureReason: 'Order cancelled by administrator' } });
      }
      if (settleCod && existing.payment) {
        await transaction.payment.updateMany({ where: { id: existing.payment.id, status: { notIn: ['PAID', 'REFUNDED'] } }, data: { status: 'PAID', paidAt: new Date(), failureReason: null } });
      }

      let updated = await transaction.order.update({
        where: { id: existing.id },
        data: {
          status: nextStatus,
          ...(settleCod ? { paymentStatus: 'PAID' } : {}),
          ...(nextStatus === 'CANCELLED' && !['PAID', 'REFUNDED'].includes(existing.paymentStatus) ? { paymentStatus: 'CANCELLED' } : {}),
        },
      });
      if (nextStatus === 'DELIVERED') {
        const result = await awardDeliveredOrderPoints(transaction, { ...existing, ...updated });
        pointsAwarded = result.awarded;
      }
      if (nextStatus === 'CANCELLED') {
        const result = await restoreCancelledOrderPoints(transaction, { ...existing, ...updated });
        pointsRestored = result.restored;
      }
      return transaction.order.findUnique({
        where: { id: existing.id },
        include: { items: true, payment: true, user: { select: { id: true, name: true, email: true, pointsBalance: true } } },
      });
    });
    await audit(req, 'ORDER_STATUS_UPDATED', 'Order', order.id, { from: previousStatus, to: order.status, pointsAwarded, pointsRestored });
    res.json({ order: { ...order, payment: serializePayment(order.payment) }, pointsAwarded, pointsRestored });
  } catch (error) { next(error); }
});

router.get('/payments', async (_req, res) => {
  const payments = await prisma.payment.findMany({
    include: { manualSubmissions: { orderBy: { createdAt: 'desc' } }, order: { include: { user: { select: { id: true, name: true, email: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 250,
  });
  res.json({ payments: payments.map(payment => ({ ...serializePayment(payment), order: payment.order })), gateway: getGatewayConfiguration() });
});

router.get('/payment-channels', async (_req, res) => {
  res.json({ currency: config.PAYMENT_CURRENCY, channels: await prisma.manualPaymentChannel.findMany({ orderBy: { createdAt: 'asc' } }) });
});
router.post('/payment-channels', async (req, res, next) => {
  try {
    const data = validateChannel(req.body);
    const channel = await prisma.manualPaymentChannel.create({ data });
    await audit(req, 'PAYMENT_CHANNEL_CREATED', 'ManualPaymentChannel', channel.id);
    res.status(201).json({ channel });
  } catch (error) { next(error); }
});
router.patch('/payment-channels/:id', async (req, res, next) => {
  try {
    const data = validateChannel(req.body);
    const channel = await prisma.manualPaymentChannel.update({ where: { id: req.params.id }, data });
    await audit(req, 'PAYMENT_CHANNEL_UPDATED', 'ManualPaymentChannel', channel.id);
    res.json({ channel });
  } catch (error) { next(error); }
});
router.post('/payments/:id/manual-review', async (req, res, next) => {
  try { res.json({ payment: await reviewManualPayment(req.params.id, req.body, req) }); }
  catch (error) { next(error); }
});
router.post('/payments/:id/manual-refunded', async (req, res, next) => {
  try { res.json({ payment: await refundManualPayment(req.params.id, req.body, req) }); }
  catch (error) { next(error); }
});

router.post('/payments/:id/check', async (req, res, next) => {
  try {
    const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
    if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    if (payment.provider !== 'SSLCOMMERZ') throw new AppError(409, 'NOT_GATEWAY_PAYMENT', 'This payment does not use SSLCOMMERZ');
    if (payment.status === 'REFUND_PENDING') await reconcileSslCommerzRefund(payment.id);
    else await reconcileSslCommerzPayment(payment.transactionId);
    await audit(req, 'PAYMENT_STATUS_CHECKED', 'Payment', payment.id, { phase: payment.status === 'REFUND_PENDING' ? 'refund' : 'payment' });
    res.json({ payment: serializePayment(await prisma.payment.findUnique({ where: { id: payment.id } })) });
  } catch (error) { next(error); }
});

router.post('/payments/:id/gateway-risk-approve', async (req, res, next) => {
  try {
    const payment = await approveSslCommerzRiskPayment(req.params.id);
    await audit(req, 'GATEWAY_RISK_PAYMENT_ACCEPTED_BY_ADMIN', 'Payment', payment.id);
    res.json({ payment: serializePayment(payment) });
  } catch (error) { next(error); }
});

router.post('/payments/:id/gateway-refund', validate(z.object({
  body: z.object({ reason: z.string().trim().min(5).max(255) }),
  params: z.object({ id: z.string().min(1) }),
  query: empty,
})), async (req, res, next) => {
  try {
    const payment = await requestSslCommerzRefund(req.validated.params.id, req.validated.body.reason);
    await audit(req, 'GATEWAY_REFUND_REQUESTED_BY_ADMIN', 'Payment', payment.id, { reason: req.validated.body.reason, amountCents: payment.refundAmountCents || payment.amountCents });
    res.json({ payment: serializePayment(payment) });
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
      id: true, name: true, email: true, role: true, isActive: true, pointsBalance: true, createdAt: true,
      _count: { select: { orders: true, wishlistItems: true } },
      orders: { where: { status: 'DELIVERED' }, select: { totalCents: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    users: users.map(({ orders, _count, ...user }) => ({
      ...user,
      orderCount: _count.orders,
      wishlistCount: _count.wishlistItems,
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


const loyaltyUpdate = z.object({
  body: z.object({
    enabled: z.boolean(),
    pointsPerOrder: z.number().int().min(0).max(100_000),
    minimumRedeemPoints: z.number().int().min(1).max(1_000_000),
    pointValueCents: z.number().int().min(1).max(10_000_000),
  }),
  params: empty,
  query: empty,
});

router.get('/loyalty', async (_req, res) => {
  const [settings, balanceAggregate, customerCount, transactionGroups] = await Promise.all([
    getLoyaltySettings(),
    prisma.user.aggregate({ where: { role: 'CUSTOMER' }, _sum: { pointsBalance: true } }),
    prisma.user.count({ where: { role: 'CUSTOMER', pointsBalance: { gt: 0 } } }),
    prisma.loyaltyTransaction.groupBy({ by: ['type'], _sum: { points: true }, _count: { type: true } }),
  ]);
  const byType = Object.fromEntries(transactionGroups.map(group => [group.type, group]));
  res.json({
    settings: { ...settings, currency: config.PAYMENT_CURRENCY },
    stats: {
      outstandingPoints: balanceAggregate._sum.pointsBalance || 0,
      customersWithPoints: customerCount,
      pointsEarned: byType.EARN?._sum.points || 0,
      pointsRedeemed: Math.abs(byType.REDEEM?._sum.points || 0),
      pointsRestored: byType.RESTORE?._sum.points || 0,
    },
  });
});

router.patch('/loyalty', validate(loyaltyUpdate), async (req, res, next) => {
  try {
    const settings = await prisma.loyaltySetting.upsert({
      where: { id: 'default' },
      update: req.validated.body,
      create: { id: 'default', ...req.validated.body },
    });
    await audit(req, 'LOYALTY_SETTINGS_UPDATED', 'LoyaltySetting', settings.id, req.validated.body);
    res.json({ settings: { ...settings, currency: config.PAYMENT_CURRENCY } });
  } catch (error) { next(error); }
});

router.get('/reviews', async (_req, res) => {
  const reviews = await prisma.review.findMany({
    include: {
      user: { select: { id: true, name: true, email: true } },
      product: { select: { id: true, name: true, imageUrl: true } },
      order: { select: { id: true, orderNumber: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  res.json({ reviews });
});

router.patch('/reviews/:id', validate(z.object({
  body: z.object({ status: z.enum(['PUBLISHED', 'HIDDEN']) }),
  params: z.object({ id: z.string().min(1) }),
  query: empty,
})), async (req, res, next) => {
  try {
    const review = await prisma.review.update({ where: { id: req.validated.params.id }, data: { status: req.validated.body.status } });
    await audit(req, 'REVIEW_MODERATED', 'Review', review.id, { status: review.status });
    res.json({ review });
  } catch (error) { next(error); }
});

router.delete('/reviews/:id', async (req, res, next) => {
  try {
    const review = await prisma.review.findUnique({ where: { id: req.params.id } });
    if (!review) throw new AppError(404, 'REVIEW_NOT_FOUND', 'Review not found');
    await prisma.review.delete({ where: { id: review.id } });
    await audit(req, 'REVIEW_REMOVED_BY_ADMIN', 'Review', review.id, { productId: review.productId, userId: review.userId });
    res.status(204).end();
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

  const [customers, orders, products, wishlistSaves, revenue, todayOrders, pendingOrders, lowStock, recentOrders, statusGroups, deliveredThisWeek, topItems] = await Promise.all([
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.order.count(),
    prisma.product.count({ where: { isAvailable: true } }),
    prisma.wishlistItem.count(),
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
    metrics: { customers, orders, products, wishlistSaves, revenueCents: revenue._sum.totalCents || 0, todayOrders, pendingOrders, lowStock },
    recentOrders,
    ordersByStatus: statusGroups.map(group => ({ status: group.status, count: group._count.status })),
    revenueByDay,
    topProducts: topItems.map(item => ({ name: item.productName, quantity: item._sum.quantity || 0, revenueCents: item._sum.lineTotalCents || 0 })),
  });
});

export default router;
