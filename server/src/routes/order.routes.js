import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { getPaymentOptions, initiateOrderPayment, newPaymentTransactionId, serializePayment } from '../services/payment.js';

const router = Router();
router.use(requireAuth);
const createSchema = z.object({ body: z.object({
  items: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(20) })).min(1).max(50),
  couponCode: z.string().trim().max(30).optional(), paymentMethod: z.enum(['COD', 'ONLINE', 'MANUAL']).default('COD'), manualChannelId: z.string().min(1).optional(),
  delivery: z.object({ firstName: z.string().trim().min(1).max(50), lastName: z.string().trim().min(1).max(50), email: z.email().max(254), phone: z.string().trim().min(7).max(24), street: z.string().trim().min(3).max(150), city: z.string().trim().min(2).max(80), state: z.string().trim().min(2).max(80), postalCode: z.string().trim().min(2).max(20), country: z.string().trim().min(2).max(80), notes: z.string().trim().max(500).optional() })
}), params: z.any(), query: z.any() });

router.post('/', validate(createSchema), async (req, res, next) => {
  try {
    const data = req.validated.body;
    const paymentOptions = await getPaymentOptions();
    const onlineOption = paymentOptions.methods.find(method => method.id === 'ONLINE');
    if (data.paymentMethod === 'ONLINE' && !onlineOption?.enabled) throw new AppError(503, 'ONLINE_PAYMENT_UNAVAILABLE', 'Online payment is not configured');
    const quantities = new Map();
    for (const item of data.items) quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity);
    const ids = [...quantities.keys()];
    const products = await prisma.product.findMany({ where: { id: { in: ids }, isAvailable: true } });
    if (products.length !== ids.length) throw new AppError(400, 'PRODUCT_UNAVAILABLE', 'One or more products are unavailable');
    for (const product of products) if (product.stock < quantities.get(product.id)) throw new AppError(409, 'INSUFFICIENT_STOCK', `${product.name} has insufficient stock`);
    const subtotalCents = products.reduce((sum, p) => sum + p.priceCents * quantities.get(p.id), 0);
    let coupon; let discountCents = 0;
    if (data.couponCode) {
      coupon = await prisma.coupon.findUnique({ where: { code: data.couponCode.toUpperCase() } });
      if (!coupon?.active || (coupon.expiresAt && coupon.expiresAt < new Date()) || subtotalCents < coupon.minimumCents) throw new AppError(400, 'INVALID_COUPON', 'Coupon is invalid, expired, or minimum spend was not met');
      discountCents = Math.floor(subtotalCents * coupon.percentOff / 100);
    }
    const deliveryFeeCents = subtotalCents ? config.DELIVERY_FEE_CENTS : 0;
    const totalCents = subtotalCents - discountCents + deliveryFeeCents;
    const orderNumber = `FO-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const order = await prisma.$transaction(async tx => {
      let manualDestination;
      if (data.paymentMethod === 'MANUAL') {
        const channel = data.manualChannelId && await tx.manualPaymentChannel.findFirst({ where: { id: data.manualChannelId, active: true } });
        if (!channel) throw new AppError(409, 'MANUAL_PAYMENT_UNAVAILABLE', 'Please select an available manual payment method');
        if (channel.provider !== 'BANK' && config.PAYMENT_CURRENCY !== 'BDT') throw new AppError(409, 'CURRENCY_MISMATCH', 'This payment method requires BDT prices');
        manualDestination = JSON.stringify({ channelId: channel.id, provider: channel.provider, label: channel.label, account: channel.account, instructions: channel.instructions });
      }
      for (const p of products) {
        const result = await tx.product.updateMany({ where: { id: p.id, stock: { gte: quantities.get(p.id) }, isAvailable: true }, data: { stock: { decrement: quantities.get(p.id) } } });
        if (result.count !== 1) throw new AppError(409, 'STOCK_CHANGED', 'Stock changed while placing the order; please try again');
      }
      return tx.order.create({ data: { orderNumber, userId: req.auth.sub, paymentMethod: data.paymentMethod, subtotalCents, discountCents, deliveryFeeCents, totalCents, couponCode: coupon?.code, ...data.delivery, items: { create: products.map(p => ({ productId: p.id, productName: p.name, unitPriceCents: p.priceCents, quantity: quantities.get(p.id), lineTotalCents: p.priceCents * quantities.get(p.id) })) }, payment: { create: { transactionId: newPaymentTransactionId(), provider: data.paymentMethod === 'ONLINE' ? onlineOption.provider : data.paymentMethod, manualDestination, status: 'PENDING', amountCents: totalCents, currency: paymentOptions.currency } } }, include: { items: true, payment: true } });
    });
    await audit(req, 'ORDER_CREATED', 'Order', order.id, { orderNumber });
    let paymentSession;
    let paymentError;
    if (data.paymentMethod === 'ONLINE') {
      try { paymentSession = await initiateOrderPayment(order.id, req.auth.sub); }
      catch (error) { paymentError = error.message || 'Payment could not be started'; }
    }
    const currentOrder = data.paymentMethod === 'ONLINE'
      ? await prisma.order.findUnique({ where: { id: order.id }, include: { items: true, payment: true } })
      : order;
    res.status(201).json({ order: { ...currentOrder, payment: serializePayment(currentOrder.payment) }, ...(paymentSession && { paymentUrl: paymentSession.paymentUrl, paymentMode: paymentSession.mode }), ...(paymentError && { paymentError }) });
  } catch (e) { next(e); }
});
router.get('/', async (req, res) => {
  const orders = await prisma.order.findMany({ where: { userId: req.auth.sub }, include: { items: true, payment: true }, orderBy: { createdAt: 'desc' } });
  res.json({ orders: orders.map(order => ({ ...order, payment: serializePayment(order.payment) })) });
});
router.get('/:id', async (req, res, next) => {
  const order = await prisma.order.findFirst({ where: { id: req.params.id, userId: req.auth.sub }, include: { items: true, payment: true } });
  if (!order) return next(new AppError(404, 'ORDER_NOT_FOUND', 'Order not found'));
  res.json({ order: { ...order, payment: serializePayment(order.payment) } });
});
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const updated = await prisma.$transaction(async tx => {
    const order = await tx.order.findFirst({ where: { id: req.params.id, userId: req.auth.sub }, include: { items: true, payment: true } });
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    if (!['PENDING', 'CONFIRMED'].includes(order.status)) throw new AppError(409, 'CANNOT_CANCEL', 'This order can no longer be cancelled');
    if (order.paymentMethod !== 'COD' && order.paymentStatus === 'PAID') throw new AppError(409, 'REFUND_REQUIRED', 'Prepaid orders must be refunded before cancellation');
    if (order.paymentMethod === 'MANUAL' && order.paymentStatus === 'REVIEW') throw new AppError(409, 'PAYMENT_UNDER_REVIEW', 'Wait for payment review before cancelling');
    if (order.payment?.provider === 'SSLCOMMERZ' && ['PROCESSING', 'REVIEW'].includes(order.payment.status)) throw new AppError(409, 'PAYMENT_PROCESSING', 'Wait for gateway verification before cancelling');
      for (const item of order.items) await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
      if (order.payment) await tx.payment.updateMany({ where: { id: order.payment.id, status: { notIn: ['PAID', 'REFUNDED'] } }, data: { status: 'CANCELLED', failureReason: 'Order cancelled by customer' } });
      return tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', paymentStatus: ['PAID', 'REFUNDED'].includes(order.paymentStatus) ? order.paymentStatus : 'CANCELLED' }, include: { items: true, payment: true } });
    });
    await audit(req, 'ORDER_CANCELLED', 'Order', updated.id); res.json({ order: { ...updated, payment: serializePayment(updated.payment) } });
  } catch (e) { next(e); }
});
export default router;
