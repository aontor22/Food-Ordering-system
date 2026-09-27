import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { getLoyaltySettings, getLoyaltySnapshot, restoreCancelledOrderPoints } from '../services/loyalty.js';
import { getPaymentOptions, initiateOrderPayment, newPaymentTransactionId } from '../services/payment.js';
import { getStoreAvailability } from '../services/store-availability.js';
import { resolveFulfillmentSelection } from '../services/fulfillment-scheduling.js';
import { calculateZoneDelivery, resolveDeliveryZone, serializeDeliveryZone } from '../services/delivery-zones.js';
import { openOrderSseStream, publishOrderChange, trackingEventData, trackingTimestampData } from '../services/order-tracking.js';
import { safeEnqueueOrderNotification } from '../services/notifications.js';
import {
  getGuestOrderByToken,
  guestTokenFromRequest,
  issueGuestOrderAccessToken,
  linkGuestOrderToUser,
  newGuestAccessState,
  normalizeOrderEmail,
} from '../services/guest-orders.js';
import { serializeOrderForClient } from '../services/order-view.js';

const router = Router();
const orderInclude = {
  items: { include: { review: true } },
  payment: true,
  trackingEvents: { orderBy: { createdAt: 'asc' } },
};

const itemSchema = z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(20) });
const pricingFields = {
  items: z.array(itemSchema).min(1).max(50),
  couponCode: z.string().trim().max(30).optional(),
  pointsToRedeem: z.number().int().nonnegative().max(1_000_000).default(0),
  fulfillmentType: z.enum(['DELIVERY', 'PICKUP']).default('DELIVERY'),
  deliveryZoneId: z.string().trim().min(1).max(100).optional(),
};
const deliverySchema = z.object({
  firstName: z.string().trim().min(1).max(50),
  lastName: z.string().trim().min(1).max(50),
  email: z.email().max(254).transform(normalizeOrderEmail),
  phone: z.string().trim().min(7).max(24),
  street: z.string().trim().max(150).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(500).optional(),
});
const createBodySchema = z.object({
  ...pricingFields,
  fulfillmentMode: z.enum(['ASAP', 'SCHEDULED']).default('ASAP'),
  scheduledForLocal: z.string().trim().max(16).optional(),
  paymentMethod: z.enum(['COD', 'ONLINE', 'MANUAL']).default('COD'),
  manualChannelId: z.string().min(1).optional(),
  delivery: deliverySchema,
}).superRefine((value, ctx) => {
  if (value.fulfillmentType === 'DELIVERY') {
    for (const field of ['street', 'city', 'state', 'postalCode', 'country']) {
      if (!value.delivery[field] || value.delivery[field].trim().length < 2) {
        ctx.addIssue({ code: 'custom', path: ['delivery', field], message: `${field} is required for delivery` });
      }
    }
  }
  if (value.fulfillmentMode === 'SCHEDULED' && !value.scheduledForLocal) {
    ctx.addIssue({ code: 'custom', path: ['scheduledForLocal'], message: 'Choose a scheduled time' });
  }
});
const createSchema = z.object({ body: createBodySchema, params: z.any(), query: z.any() });
const quoteSchema = z.object({
  body: z.object({ ...pricingFields, postalCode: z.string().trim().max(20).optional() }),
  params: z.any(),
  query: z.any(),
});
const reviewSchema = z.object({
  body: z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(800).optional().transform(value => value || null) }),
  params: z.object({ orderId: z.string().min(1), itemId: z.string().min(1) }),
  query: z.any(),
});
const linkGuestSchema = z.object({
  body: z.object({ token: z.string().min(20).max(4096) }),
  params: z.any(),
  query: z.any(),
});

function quantitiesFrom(items) {
  const quantities = new Map();
  for (const item of items) quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity);
  return quantities;
}

async function calculatePricing(data, userId = null, db = prisma, { enforceMinimum = true } = {}) {
  const quantities = quantitiesFrom(data.items);
  const ids = [...quantities.keys()];
  const products = await db.product.findMany({ where: { id: { in: ids }, isAvailable: true } });
  if (products.length !== ids.length) throw new AppError(400, 'PRODUCT_UNAVAILABLE', 'One or more products are unavailable');
  for (const product of products) {
    if (product.stock < quantities.get(product.id)) throw new AppError(409, 'INSUFFICIENT_STOCK', `${product.name} has insufficient stock`);
  }

  const subtotalCents = products.reduce((sum, product) => sum + product.priceCents * quantities.get(product.id), 0);
  let coupon;
  let discountCents = 0;
  if (data.couponCode) {
    coupon = await db.coupon.findUnique({ where: { code: data.couponCode.toUpperCase() } });
    if (!coupon?.active || (coupon.expiresAt && coupon.expiresAt < new Date()) || subtotalCents < coupon.minimumCents) {
      throw new AppError(400, 'INVALID_COUPON', 'Coupon is invalid, expired, or minimum spend was not met');
    }
    discountCents = Math.floor(subtotalCents * coupon.percentOff / 100);
  }

  const settings = await getLoyaltySettings(db);
  const user = userId ? await db.user.findUnique({ where: { id: userId }, select: { pointsBalance: true, isActive: true } }) : null;
  if (userId && (!user || !user.isActive)) throw new AppError(401, 'ACCOUNT_UNAVAILABLE', 'Account is unavailable');

  const requestedPoints = Number(data.pointsToRedeem || 0);
  if (!userId && requestedPoints > 0) throw new AppError(400, 'GUEST_POINTS_NOT_AVAILABLE', 'Sign in before checkout to redeem Tomato Points');
  const pointsBalance = user?.pointsBalance || 0;
  const redeemableSubtotalCents = Math.max(0, subtotalCents - discountCents);
  const affordabilityLimit = settings.pointValueCents > 0 ? Math.floor(redeemableSubtotalCents / settings.pointValueCents) : 0;
  const rawMaxRedeemPoints = Math.min(pointsBalance, affordabilityLimit);
  const maxRedeemPoints = userId && settings.enabled && rawMaxRedeemPoints >= settings.minimumRedeemPoints ? rawMaxRedeemPoints : 0;

  if (requestedPoints > 0) {
    if (!settings.enabled) throw new AppError(409, 'LOYALTY_DISABLED', 'Points redemption is currently unavailable');
    if (requestedPoints < settings.minimumRedeemPoints) throw new AppError(400, 'MINIMUM_POINTS_REQUIRED', `Use at least ${settings.minimumRedeemPoints} points for a discount`);
    if (requestedPoints > pointsBalance) throw new AppError(409, 'INSUFFICIENT_POINTS', 'You do not have enough points');
    if (requestedPoints > affordabilityLimit) throw new AppError(400, 'TOO_MANY_POINTS', 'This order is too small to use that many points');
  }

  const pointsDiscountCents = requestedPoints * settings.pointValueCents;
  let deliveryZone = null;
  let deliveryRules = {
    feeCents: 0,
    minimumOrderCents: 0,
    minimumOrderMet: true,
    minimumOrderRemainingCents: 0,
    freeDeliveryThresholdCents: null,
    freeDelivery: true,
    freeDeliveryRemainingCents: 0,
  };
  if ((data.fulfillmentType || 'DELIVERY') === 'DELIVERY') {
    deliveryZone = await resolveDeliveryZone(db, {
      deliveryZoneId: data.deliveryZoneId,
      postalCode: data.postalCode || data.delivery?.postalCode,
    });
    deliveryRules = calculateZoneDelivery(deliveryZone, subtotalCents);
    if (enforceMinimum && !deliveryRules.minimumOrderMet) {
      throw new AppError(400, 'MINIMUM_ORDER_NOT_MET', `Minimum order for ${deliveryZone.name} has not been met`, {
        deliveryZone: serializeDeliveryZone(deliveryZone),
        minimumOrderCents: deliveryRules.minimumOrderCents,
        minimumOrderRemainingCents: deliveryRules.minimumOrderRemainingCents,
      });
    }
  }
  const deliveryFeeCents = deliveryRules.feeCents;
  const totalCents = Math.max(0, subtotalCents - discountCents - pointsDiscountCents + deliveryFeeCents);
  return {
    quantities,
    products,
    coupon,
    subtotalCents,
    discountCents,
    pointsRedeemed: requestedPoints,
    pointsDiscountCents,
    deliveryFeeCents,
    totalCents,
    settings,
    pointsBalance,
    maxRedeemPoints,
    deliveryZone,
    deliveryRules,
  };
}

function quotePayload(pricing, body, { guest = false } = {}) {
  return {
    subtotalCents: pricing.subtotalCents,
    discountCents: pricing.discountCents,
    pointsRedeemed: pricing.pointsRedeemed,
    pointsDiscountCents: pricing.pointsDiscountCents,
    deliveryFeeCents: pricing.deliveryFeeCents,
    totalCents: pricing.totalCents,
    couponCode: pricing.coupon?.code || null,
    deliveryZone: pricing.deliveryZone ? { ...serializeDeliveryZone(pricing.deliveryZone), ...pricing.deliveryRules } : null,
    fulfillmentType: body.fulfillmentType || 'DELIVERY',
    loyalty: guest ? {
      enabled: false,
      guestCheckout: true,
      pointsBalance: 0,
      pointsPerOrder: pricing.settings.pointsPerOrder,
      minimumRedeemPoints: pricing.settings.minimumRedeemPoints,
      pointValueCents: pricing.settings.pointValueCents,
      maxRedeemPoints: 0,
      currency: config.PAYMENT_CURRENCY,
    } : {
      enabled: pricing.settings.enabled,
      pointsBalance: pricing.pointsBalance,
      pointsPerOrder: pricing.settings.pointsPerOrder,
      minimumRedeemPoints: pricing.settings.minimumRedeemPoints,
      pointValueCents: pricing.settings.pointValueCents,
      maxRedeemPoints: pricing.maxRedeemPoints,
      currency: config.PAYMENT_CURRENCY,
    },
  };
}

async function createOrder(req, data, { userId = null, guest = false } = {}) {
  const paymentOptions = await getPaymentOptions();
  const onlineOption = paymentOptions.methods.find(method => method.id === 'ONLINE');
  if (data.paymentMethod === 'ONLINE' && !onlineOption?.enabled) {
    throw new AppError(503, 'ONLINE_PAYMENT_UNAVAILABLE', 'Online payment is not configured');
  }
  if (guest && Number(data.pointsToRedeem || 0) > 0) {
    throw new AppError(400, 'GUEST_POINTS_NOT_AVAILABLE', 'Guest checkout cannot redeem Tomato Points');
  }

  const preview = await calculatePricing(data, userId);
  const orderNumber = `FO-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const guestState = guest ? newGuestAccessState() : {};
  const order = await prisma.$transaction(async tx => {
    const fulfillment = await resolveFulfillmentSelection(tx, data);
    const pricing = await calculatePricing(data, userId, tx);
    let manualDestination;
    if (data.paymentMethod === 'MANUAL') {
      const channel = data.manualChannelId && await tx.manualPaymentChannel.findFirst({ where: { id: data.manualChannelId, active: true } });
      if (!channel) throw new AppError(409, 'MANUAL_PAYMENT_UNAVAILABLE', 'Please select an available manual payment method');
      if (channel.provider !== 'BANK' && config.PAYMENT_CURRENCY !== 'BDT') throw new AppError(409, 'CURRENCY_MISMATCH', 'This payment method requires BDT prices');
      manualDestination = JSON.stringify({ channelId: channel.id, provider: channel.provider, label: channel.label, account: channel.account, instructions: channel.instructions });
    }

    for (const product of pricing.products) {
      const result = await tx.product.updateMany({
        where: { id: product.id, stock: { gte: pricing.quantities.get(product.id) }, isAvailable: true },
        data: { stock: { decrement: pricing.quantities.get(product.id) } },
      });
      if (result.count !== 1) throw new AppError(409, 'STOCK_CHANGED', 'Stock changed while placing the order; please try again');
    }

    if (pricing.pointsRedeemed > 0) {
      const reserved = await tx.user.updateMany({
        where: { id: userId, pointsBalance: { gte: pricing.pointsRedeemed } },
        data: { pointsBalance: { decrement: pricing.pointsRedeemed } },
      });
      if (reserved.count !== 1) throw new AppError(409, 'POINTS_CHANGED', 'Your points balance changed. Please review the order total and try again');
    }

    const created = await tx.order.create({
      data: {
        orderNumber,
        userId,
        customerType: guest ? 'GUEST' : 'REGISTERED',
        ...guestState,
        paymentMethod: data.paymentMethod,
        subtotalCents: pricing.subtotalCents,
        discountCents: pricing.discountCents,
        pointsRedeemed: pricing.pointsRedeemed,
        pointsDiscountCents: pricing.pointsDiscountCents,
        deliveryFeeCents: pricing.deliveryFeeCents,
        deliveryZoneId: pricing.deliveryZone?.id || null,
        deliveryZoneName: pricing.deliveryZone?.name || null,
        fulfillmentType: fulfillment.fulfillmentType,
        fulfillmentMode: fulfillment.fulfillmentMode,
        scheduledForLocal: fulfillment.scheduledForLocal,
        scheduledDateKey: fulfillment.scheduledDateKey,
        scheduledTimeKey: fulfillment.scheduledTimeKey,
        schedulingTimezone: fulfillment.schedulingTimezone,
        pickupAddressSnapshot: fulfillment.pickupAddressSnapshot,
        pickupInstructionsSnapshot: fulfillment.pickupInstructionsSnapshot,
        totalCents: pricing.totalCents,
        couponCode: pricing.coupon?.code,
        firstName: data.delivery.firstName,
        lastName: data.delivery.lastName,
        email: normalizeOrderEmail(data.delivery.email),
        phone: data.delivery.phone,
        street: fulfillment.fulfillmentType === 'DELIVERY' ? data.delivery.street : null,
        city: fulfillment.fulfillmentType === 'DELIVERY' ? data.delivery.city : null,
        state: fulfillment.fulfillmentType === 'DELIVERY' ? data.delivery.state : null,
        postalCode: fulfillment.fulfillmentType === 'DELIVERY' ? data.delivery.postalCode : null,
        country: fulfillment.fulfillmentType === 'DELIVERY' ? data.delivery.country : null,
        notes: data.delivery.notes,
        items: {
          create: pricing.products.map(product => ({
            productId: product.id,
            productName: product.name,
            unitPriceCents: product.priceCents,
            quantity: pricing.quantities.get(product.id),
            lineTotalCents: product.priceCents * pricing.quantities.get(product.id),
          })),
        },
        trackingEvents: {
          create: trackingEventData('PENDING', {
            actorType: 'CUSTOMER',
            actorLabel: `${data.delivery.firstName} ${data.delivery.lastName}`,
            note: 'We received your order and will confirm it shortly.',
          }),
        },
        payment: {
          create: {
            transactionId: newPaymentTransactionId(),
            provider: data.paymentMethod === 'ONLINE' ? onlineOption.provider : data.paymentMethod,
            manualDestination,
            status: 'PENDING',
            amountCents: pricing.totalCents,
            currency: paymentOptions.currency,
          },
        },
      },
      include: orderInclude,
    });

    if (pricing.pointsRedeemed > 0) {
      const customer = await tx.user.findUnique({ where: { id: userId }, select: { pointsBalance: true } });
      await tx.loyaltyTransaction.create({
        data: {
          userId,
          orderId: created.id,
          type: 'REDEEM',
          points: -pricing.pointsRedeemed,
          balanceAfter: customer.pointsBalance,
          note: `Points redeemed on order ${created.orderNumber}`,
        },
      });
    }
    return created;
  }, { isolationLevel: 'Serializable' });

  const guestToken = guest ? issueGuestOrderAccessToken(order) : null;
  await audit(req, 'ORDER_CREATED', 'Order', order.id, {
    orderNumber,
    customerType: guest ? 'GUEST' : 'REGISTERED',
    pointsRedeemed: order.pointsRedeemed,
    fulfillmentType: order.fulfillmentType,
    fulfillmentMode: order.fulfillmentMode,
    scheduledForLocal: order.scheduledForLocal,
  });
  publishOrderChange(order);
  await safeEnqueueOrderNotification(order.id, 'PENDING', {}, req.log);

  let paymentSession;
  let paymentError;
  if (data.paymentMethod === 'ONLINE') {
    try {
      paymentSession = await initiateOrderPayment(order.id, guest ? { guestToken } : { userId });
    } catch (error) {
      paymentError = error.message || 'Payment could not be started';
    }
  }
  const currentOrder = data.paymentMethod === 'ONLINE'
    ? await prisma.order.findUnique({ where: { id: order.id }, include: orderInclude })
    : order;

  return {
    order: serializeOrderForClient(currentOrder),
    ...(guest ? {
      guestAccess: {
        token: guestToken,
        expiresAt: order.guestAccessExpiresAt,
        orderNumber: order.orderNumber,
      },
    } : {
      loyalty: { ...(await getLoyaltySnapshot(userId)), currency: paymentOptions.currency },
    }),
    ...(paymentSession && { paymentUrl: paymentSession.paymentUrl, paymentMode: paymentSession.mode }),
    ...(paymentError && { paymentError }),
    ...(preview.totalCents !== currentOrder.totalCents && { repriced: true }),
  };
}

async function cancelOrderInTransaction(tx, order) {
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  if (!['PENDING', 'CONFIRMED'].includes(order.status)) throw new AppError(409, 'CANNOT_CANCEL', 'This order can no longer be cancelled');
  if (order.paymentMethod !== 'COD' && order.paymentStatus === 'PAID') throw new AppError(409, 'REFUND_REQUIRED', 'Prepaid orders must be refunded before cancellation');
  if (order.paymentMethod === 'MANUAL' && order.paymentStatus === 'REVIEW') throw new AppError(409, 'PAYMENT_UNDER_REVIEW', 'Wait for payment review before cancelling');
  if (order.payment?.provider === 'SSLCOMMERZ' && ['PROCESSING', 'REVIEW', 'REFUND_PENDING'].includes(order.payment.status)) {
    throw new AppError(409, 'PAYMENT_PROCESSING', 'Wait for gateway payment/refund verification before cancelling');
  }

  for (const item of order.items) {
    await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
  }
  if (order.payment) {
    await tx.payment.updateMany({
      where: { id: order.payment.id, status: { notIn: ['PAID', 'REFUNDED'] } },
      data: { status: 'CANCELLED', failureReason: 'Order cancelled by customer' },
    });
  }
  await tx.order.update({
    where: { id: order.id },
    data: {
      status: 'CANCELLED',
      paymentStatus: ['PAID', 'REFUNDED'].includes(order.paymentStatus) ? order.paymentStatus : 'CANCELLED',
      ...trackingTimestampData('CANCELLED', order),
      trackingEvents: {
        create: trackingEventData('CANCELLED', {
          actorType: 'CUSTOMER',
          actorLabel: `${order.firstName} ${order.lastName}`,
          note: 'Cancelled by customer.',
        }),
      },
    },
  });
  await restoreCancelledOrderPoints(tx, order);
  return tx.order.findUnique({ where: { id: order.id }, include: orderInclude });
}

router.use('/guest', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Guest checkout and secure guest-order access are intentionally public routes. Access to an existing guest order
// always requires its signed, expiring bearer token; the human-readable order number is never sufficient.
router.post('/guest/quote', validate(quoteSchema), async (req, res, next) => {
  try {
    const body = req.validated.body;
    const [pricing, store] = await Promise.all([
      calculatePricing(body, null, prisma, { enforceMinimum: false }),
      getStoreAvailability(),
    ]);
    res.json({ store, quote: quotePayload(pricing, body, { guest: true }) });
  } catch (error) { next(error); }
});

router.post('/guest', validate(createSchema), async (req, res, next) => {
  try {
    const result = await createOrder(req, req.validated.body, { guest: true });
    res.status(201).json(result);
  } catch (error) { next(error); }
});

router.get('/guest', async (req, res, next) => {
  try {
    const token = guestTokenFromRequest(req);
    const order = await getGuestOrderByToken(token, { include: orderInclude });
    res.json({ order: serializeOrderForClient(order) });
  } catch (error) { next(error); }
});

router.get('/guest/live', async (req, res, next) => {
  try {
    const token = guestTokenFromRequest(req);
    const initial = await getGuestOrderByToken(token);
    openOrderSseStream(req, res, {
      matches: change => change.orderId === initial.id,
      loadSnapshot: async () => {
        const order = await getGuestOrderByToken(token, { include: orderInclude });
        const serialized = serializeOrderForClient(order);
        return {
          data: { order: serialized },
          signature: [serialized.id, serialized.status, serialized.paymentStatus, serialized.updatedAt, serialized.payment?.updatedAt, serialized.trackingEvents?.at(-1)?.createdAt, serialized.estimatedReadyAt, serialized.estimatedDeliveryAt],
        };
      },
    });
  } catch (error) { next(error); }
});

router.post('/guest/cancel', async (req, res, next) => {
  try {
    const token = guestTokenFromRequest(req);
    const updated = await prisma.$transaction(async tx => {
      const order = await getGuestOrderByToken(token, { db: tx, include: { items: true, payment: true } });
      return cancelOrderInTransaction(tx, order);
    }, { isolationLevel: 'Serializable' });
    await audit(req, 'ORDER_CANCELLED', 'Order', updated.id, { customerType: 'GUEST', pointsRestored: 0 });
    publishOrderChange(updated);
    await safeEnqueueOrderNotification(updated.id, 'CANCELLED', {}, req.log);
    res.json({ order: serializeOrderForClient(updated) });
  } catch (error) { next(error); }
});

router.use(requireAuth);

router.post('/guest/link', validate(linkGuestSchema), async (req, res, next) => {
  try {
    const linked = await linkGuestOrderToUser(req.auth.sub, req.validated.body.token);
    await audit(req, 'GUEST_ORDER_LINKED', 'Order', linked.order.id, { linkedNow: linked.linkedNow, pointsAwarded: linked.pointsAwarded });
    if (linked.linkedNow) publishOrderChange(linked.order);
    res.json({
      order: serializeOrderForClient(linked.order),
      linkedNow: linked.linkedNow,
      pointsAwarded: linked.pointsAwarded,
      loyalty: { ...(await getLoyaltySnapshot(req.auth.sub)), currency: config.PAYMENT_CURRENCY },
    });
  } catch (error) { next(error); }
});

router.get('/loyalty', async (req, res) => {
  res.json({ loyalty: { ...(await getLoyaltySnapshot(req.auth.sub)), currency: config.PAYMENT_CURRENCY } });
});

router.post('/quote', validate(quoteSchema), async (req, res, next) => {
  try {
    const [pricing, store] = await Promise.all([
      calculatePricing(req.validated.body, req.auth.sub, prisma, { enforceMinimum: false }),
      getStoreAvailability(),
    ]);
    res.json({ store, quote: quotePayload(pricing, req.validated.body) });
  } catch (error) { next(error); }
});

router.post('/', validate(createSchema), async (req, res, next) => {
  try {
    const result = await createOrder(req, req.validated.body, { userId: req.auth.sub });
    res.status(201).json(result);
  } catch (error) { next(error); }
});

router.get('/', async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { userId: req.auth.sub },
    include: orderInclude,
    orderBy: { createdAt: 'desc' },
  });
  res.json({ orders: orders.map(serializeOrderForClient) });
});

router.get('/live', (req, res) => {
  openOrderSseStream(req, res, {
    matches: change => change.userId === req.auth.sub,
    loadSnapshot: async () => {
      const [orders, loyalty] = await Promise.all([
        prisma.order.findMany({ where: { userId: req.auth.sub }, include: orderInclude, orderBy: { createdAt: 'desc' } }),
        getLoyaltySnapshot(req.auth.sub),
      ]);
      const serialized = orders.map(serializeOrderForClient);
      return {
        data: { orders: serialized, loyalty: { ...loyalty, currency: config.PAYMENT_CURRENCY } },
        signature: serialized.map(order => [order.id, order.status, order.paymentStatus, order.updatedAt, order.payment?.updatedAt, order.trackingEvents?.at(-1)?.createdAt, order.estimatedReadyAt, order.estimatedDeliveryAt, order.pointsEarned]),
      };
    },
  });
});

router.put('/:orderId/items/:itemId/review', validate(reviewSchema), async (req, res, next) => {
  try {
    const item = await prisma.orderItem.findFirst({
      where: { id: req.validated.params.itemId, orderId: req.validated.params.orderId, order: { userId: req.auth.sub } },
      include: { order: true, review: true },
    });
    if (!item) throw new AppError(404, 'ORDER_ITEM_NOT_FOUND', 'Order item not found');
    if (item.order.status !== 'DELIVERED') throw new AppError(409, 'REVIEW_NOT_AVAILABLE', 'You can review food after the order is delivered');

    const data = req.validated.body;
    const review = item.review
      ? await prisma.review.update({ where: { id: item.review.id }, data: { rating: data.rating, comment: data.comment } })
      : await prisma.review.create({ data: { rating: data.rating, comment: data.comment, userId: req.auth.sub, productId: item.productId, orderId: item.orderId, orderItemId: item.id } });
    await audit(req, item.review ? 'REVIEW_UPDATED' : 'REVIEW_CREATED', 'Review', review.id, { productId: item.productId, rating: review.rating });
    res.status(item.review ? 200 : 201).json({ review });
  } catch (error) { next(error); }
});

router.delete('/:orderId/items/:itemId/review', async (req, res, next) => {
  try {
    const review = await prisma.review.findFirst({ where: { orderId: req.params.orderId, orderItemId: req.params.itemId, userId: req.auth.sub } });
    if (!review) throw new AppError(404, 'REVIEW_NOT_FOUND', 'Review not found');
    await prisma.review.delete({ where: { id: review.id } });
    await audit(req, 'REVIEW_DELETED', 'Review', review.id, { productId: review.productId });
    res.status(204).end();
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
  const order = await prisma.order.findFirst({ where: { id: req.params.id, userId: req.auth.sub }, include: orderInclude });
  if (!order) return next(new AppError(404, 'ORDER_NOT_FOUND', 'Order not found'));
  res.json({ order: serializeOrderForClient(order) });
});

router.post('/:id/cancel', async (req, res, next) => {
  try {
    const updated = await prisma.$transaction(async tx => {
      const order = await tx.order.findFirst({ where: { id: req.params.id, userId: req.auth.sub }, include: { items: true, payment: true } });
      return cancelOrderInTransaction(tx, order);
    }, { isolationLevel: 'Serializable' });
    await audit(req, 'ORDER_CANCELLED', 'Order', updated.id, { pointsRestored: updated.pointsRedeemed || 0 });
    publishOrderChange(updated);
    await safeEnqueueOrderNotification(updated.id, 'CANCELLED', {}, req.log);
    res.json({ order: serializeOrderForClient(updated), loyalty: { ...(await getLoyaltySnapshot(req.auth.sub)), currency: config.PAYMENT_CURRENCY } });
  } catch (error) { next(error); }
});

export default router;
