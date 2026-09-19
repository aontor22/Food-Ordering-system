import crypto from 'node:crypto';
import { config, isProduction } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';

const publicApiUrl = config.PUBLIC_API_URL.replace(/\/$/, '');
const hasSslCommerz = Boolean(config.SSLCOMMERZ_STORE_ID && config.SSLCOMMERZ_STORE_PASSWORD);
const demoEnabled = !isProduction && config.ENABLE_DEMO_PAYMENTS;

const sslBaseUrl = () => config.SSLCOMMERZ_LIVE
  ? 'https://securepay.sslcommerz.com'
  : 'https://sandbox.sslcommerz.com';

export function getPaymentOptions() {
  return {
    currency: config.PAYMENT_CURRENCY,
    methods: [
      { id: 'COD', label: 'Cash on delivery', enabled: true, mode: 'live' },
      {
        id: 'ONLINE',
        label: hasSslCommerz ? 'Online payment' : demoEnabled ? 'Online payment (demo)' : 'Online payment unavailable',
        enabled: hasSslCommerz || demoEnabled,
        provider: hasSslCommerz ? 'SSLCOMMERZ' : demoEnabled ? 'DEMO' : null,
        mode: hasSslCommerz ? (config.SSLCOMMERZ_LIVE ? 'live' : 'sandbox') : demoEnabled ? 'demo' : 'unavailable',
      },
    ],
  };
}

export function newPaymentTransactionId() {
  return `PAY${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

export function serializePayment(payment) {
  if (!payment) return null;
  return {
    id: payment.id,
    transactionId: payment.transactionId,
    provider: payment.provider,
    status: payment.status,
    amountCents: payment.amountCents,
    currency: payment.currency,
    gatewayTransactionId: payment.gatewayTransactionId,
    failureReason: payment.failureReason,
    attempts: payment.attempts,
    paidAt: payment.paidAt,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

function demoSignature(transactionId) {
  return crypto.createHmac('sha256', config.JWT_REFRESH_SECRET).update(`demo-payment:${transactionId}`).digest('hex');
}

function validDemoSignature(transactionId, provided = '') {
  const expected = Buffer.from(demoSignature(transactionId));
  const received = Buffer.from(provided);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

async function prepareAttempt(payment, provider) {
  const transactionId = payment.attempts > 0 ? newPaymentTransactionId() : payment.transactionId;
  return prisma.$transaction(async tx => {
  const result = await tx.payment.updateMany({
    where: { id: payment.id, attempts: payment.attempts, status: payment.status, order: { status: { notIn: ['CANCELLED', 'DELIVERED'] } } },
    data: {
      transactionId,
      provider,
      status: 'PROCESSING',
      failureReason: null,
      attempts: { increment: 1 },
      lastAttemptAt: new Date(),
    },
  });
  if (!result.count) throw new AppError(409, 'PAYMENT_CHANGED', 'Payment changed. Refresh your order before trying again.');
  await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: 'PROCESSING' } });
  return tx.payment.findUnique({ where: { id: payment.id } });
  });
}

async function initiateDemo(order, payment) {
  const prepared = await prepareAttempt(payment, 'DEMO');
  const signature = demoSignature(prepared.transactionId);
  return {
    payment: prepared,
    paymentUrl: `/payment/demo/${prepared.transactionId}?signature=${signature}`,
    provider: 'DEMO',
    mode: 'demo',
  };
}

async function initiateSslCommerz(order, payment) {
  const prepared = await prepareAttempt(payment, 'SSLCOMMERZ');
  const callbackBase = `${publicApiUrl}/api/payments/sslcommerz`;
  const values = new URLSearchParams({
    store_id: config.SSLCOMMERZ_STORE_ID,
    store_passwd: config.SSLCOMMERZ_STORE_PASSWORD,
    total_amount: (prepared.amountCents / 100).toFixed(2),
    currency: prepared.currency,
    tran_id: prepared.transactionId,
    success_url: `${callbackBase}/success`,
    fail_url: `${callbackBase}/fail`,
    cancel_url: `${callbackBase}/cancel`,
    ipn_url: `${callbackBase}/ipn`,
    cus_name: `${order.firstName} ${order.lastName}`.slice(0, 50),
    cus_email: order.email.slice(0, 50),
    cus_add1: order.street.slice(0, 50),
    cus_city: order.city.slice(0, 50),
    cus_state: order.state.slice(0, 50),
    cus_postcode: order.postalCode.slice(0, 30),
    cus_country: order.country.slice(0, 50),
    cus_phone: order.phone.slice(0, 20),
    shipping_method: 'YES',
    num_of_item: String(order.items.reduce((total, item) => total + item.quantity, 0)),
    ship_name: `${order.firstName} ${order.lastName}`.slice(0, 50),
    ship_add1: order.street.slice(0, 50),
    ship_city: order.city.slice(0, 50),
    ship_state: order.state.slice(0, 50),
    ship_postcode: order.postalCode.slice(0, 30),
    ship_country: order.country.slice(0, 50),
    product_name: order.items.map(item => item.productName).join(', ').slice(0, 255),
    product_category: 'Food',
    product_profile: 'physical-goods',
    value_a: order.id,
    value_b: order.orderNumber,
  });

  try {
    const response = await fetch(`${sslBaseUrl()}/gwprocess/v4/api.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: values,
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json();
    if (!response.ok || result.status !== 'SUCCESS' || !result.GatewayPageURL) throw new Error('Payment gateway did not create a session');
    const gatewayUrl = new URL(result.GatewayPageURL);
    if (gatewayUrl.protocol !== 'https:' || !(gatewayUrl.hostname === 'sslcommerz.com' || gatewayUrl.hostname.endsWith('.sslcommerz.com'))) throw new Error('Unexpected gateway redirect');
    const updated = await prisma.payment.update({ where: { id: prepared.id }, data: { gatewaySessionId: result.sessionkey || null } });
    return { payment: updated, paymentUrl: result.GatewayPageURL, provider: 'SSLCOMMERZ', mode: config.SSLCOMMERZ_LIVE ? 'live' : 'sandbox' };
  } catch (error) {
    // A timeout does not prove that the provider failed to create/charge a session.
    await prisma.payment.updateMany({ where: { id: prepared.id, status: 'PROCESSING' }, data: { failureReason: 'Gateway response unavailable; check payment status before retrying' } });
    throw new AppError(502, 'PAYMENT_GATEWAY_UNAVAILABLE', 'The payment gateway is temporarily unavailable. Your order was saved; retry payment from My orders.');
  }
}

export async function initiateOrderPayment(orderId, userId) {
  let order = await prisma.order.findFirst({
    where: { id: orderId, ...(userId ? { userId } : {}) },
    include: { items: true, payment: true },
  });
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  if (order.paymentMethod !== 'ONLINE') throw new AppError(409, 'NOT_ONLINE_PAYMENT', 'This order uses cash on delivery');
  if (['CANCELLED', 'DELIVERED'].includes(order.status)) throw new AppError(409, 'ORDER_NOT_PAYABLE', 'This order can no longer be paid online');
  if (order.paymentStatus === 'PAID' || order.payment?.status === 'PAID') throw new AppError(409, 'ALREADY_PAID', 'This order has already been paid');
  if (!order.payment) throw new AppError(409, 'PAYMENT_RECORD_MISSING', 'Payment record is unavailable');
  if (order.payment.provider === 'SSLCOMMERZ' && ['PROCESSING', 'REVIEW'].includes(order.payment.status)) {
    await reconcileSslCommerzPayment(order.payment.transactionId);
    order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true, payment: true } });
  }
  if (['PAID', 'REFUNDED', 'REVIEW'].includes(order.payment.status)) throw new AppError(409, 'PAYMENT_NOT_RETRYABLE', 'Payment is already received or under review. Check My orders.');
  if (order.payment.provider === 'SSLCOMMERZ' && order.payment.status === 'PROCESSING') throw new AppError(409, 'PAYMENT_PROCESSING', 'The gateway has not confirmed a final result yet. Please check again shortly.');
  if (demoEnabled && order.payment.provider === 'DEMO' && order.payment.status === 'PROCESSING') return { payment: order.payment, paymentUrl: `/payment/demo/${order.payment.transactionId}?signature=${demoSignature(order.payment.transactionId)}`, provider: 'DEMO', mode: 'demo' };
  if (hasSslCommerz) return initiateSslCommerz(order, order.payment);
  if (demoEnabled) return initiateDemo(order, order.payment);
  throw new AppError(503, 'ONLINE_PAYMENT_UNAVAILABLE', 'Online payment is not configured');
}

export async function getDemoPayment(transactionId, userId, signature) {
  if (!demoEnabled || !validDemoSignature(transactionId, signature)) throw new AppError(404, 'PAYMENT_SESSION_NOT_FOUND', 'Payment session not found');
  const payment = await prisma.payment.findFirst({
    where: { transactionId, order: { userId } },
    include: { order: { select: { id: true, orderNumber: true, totalCents: true, status: true, firstName: true, lastName: true } } },
  });
  if (!payment || payment.provider !== 'DEMO') throw new AppError(404, 'PAYMENT_SESSION_NOT_FOUND', 'Payment session not found');
  return { payment: serializePayment(payment), order: payment.order, mode: 'demo' };
}

export async function completeDemoPayment(transactionId, userId, signature, outcome) {
  await getDemoPayment(transactionId, userId, signature);
  return prisma.$transaction(async transaction => {
  const paymentRecord = await transaction.payment.findUnique({ where: { transactionId }, include: { order: true } });
  if (!paymentRecord) throw new AppError(404, 'PAYMENT_SESSION_NOT_FOUND', 'Payment session not found');
  const session = { payment: paymentRecord, order: paymentRecord.order };
  if (session.payment.status === 'PAID') {
    const order = await transaction.order.findUnique({ where: { id: session.order.id }, include: { items: true, payment: true } });
    return order;
  }
  if (['CANCELLED', 'DELIVERED'].includes(session.order.status)) throw new AppError(409, 'ORDER_NOT_PAYABLE', 'This order can no longer be paid online');
  if (session.payment.status !== 'PROCESSING') throw new AppError(409, 'PAYMENT_SESSION_ENDED', 'This payment attempt has ended. Start a new attempt from My orders.');
  const paymentStatus = outcome === 'success' ? 'PAID' : outcome === 'cancel' ? 'CANCELLED' : 'FAILED';
    const payment = await transaction.payment.update({
      where: { transactionId },
      data: { status: paymentStatus, failureReason: outcome === 'success' ? null : `Demo payment ${outcome}`, ...(outcome === 'success' ? { paidAt: new Date(), gatewayTransactionId: `DEMO-${crypto.randomBytes(6).toString('hex').toUpperCase()}` } : {}) },
    });
    return transaction.order.update({
      where: { id: payment.orderId },
      data: { paymentStatus, ...(outcome === 'success' && session.order.status === 'PENDING' ? { status: 'CONFIRMED' } : {}) },
      include: { items: true, payment: true },
    });
  });
}

export async function validateSslCommerzPayment(input) {
  if (!hasSslCommerz) throw new AppError(503, 'PAYMENT_GATEWAY_UNAVAILABLE', 'Payment gateway is not configured');
  const validationId = String(input.val_id || '').slice(0, 100);
  if (!validationId) throw new AppError(400, 'PAYMENT_VALIDATION_FAILED', 'Payment validation identifier is missing');
  const query = new URLSearchParams({ val_id: validationId, store_id: config.SSLCOMMERZ_STORE_ID, store_passwd: config.SSLCOMMERZ_STORE_PASSWORD, v: '1', format: 'json' });
  const response = await fetch(`${sslBaseUrl()}/validator/api/validationserverAPI.php?${query}`, { signal: AbortSignal.timeout(15_000) });
  const result = await response.json();
  if (!response.ok || !['VALID', 'VALIDATED'].includes(result.status)) throw new AppError(400, 'PAYMENT_VALIDATION_FAILED', 'The payment could not be validated');
  if (input.tran_id && result.tran_id !== input.tran_id) throw new AppError(400, 'PAYMENT_VALIDATION_FAILED', 'Transaction identity mismatch');
  return prisma.$transaction(async transaction => {
  const payment = await transaction.payment.findUnique({ where: { transactionId: result.tran_id }, include: { order: true } });
  if (!payment || payment.provider !== 'SSLCOMMERZ') throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment transaction was not found');
  if (payment.status === 'PAID') return { paid: true, order: payment.order };
  if (payment.status === 'REFUNDED') return { paid: false, review: true, order: payment.order };
  const receivedCents = Math.round(Number(result.currency_amount || result.amount) * 100);
  if (receivedCents !== payment.amountCents || String(result.currency_type || result.currency).toUpperCase() !== payment.currency) {
    throw new AppError(409, 'PAYMENT_AMOUNT_MISMATCH', 'Payment amount or currency did not match the order');
  }
  const review = String(result.risk_level) !== '0' || payment.order.status === 'CANCELLED';
  const status = review ? 'REVIEW' : 'PAID';
    await transaction.payment.update({
      where: { id: payment.id },
      data: { status, validationId, gatewayTransactionId: result.bank_tran_id || null, failureReason: review ? 'Gateway flagged this transaction for risk review' : null, ...(!review ? { paidAt: new Date() } : {}) },
    });
    const order = await transaction.order.update({
      where: { id: payment.orderId },
      data: { paymentStatus: status, ...(!review && payment.order.status === 'PENDING' ? { status: 'CONFIRMED' } : {}) },
    });
    await transaction.auditLog.create({ data: { action: review ? 'GATEWAY_PAYMENT_REVIEW' : 'GATEWAY_PAYMENT_VERIFIED', entity: 'Payment', entityId: payment.id, metadata: JSON.stringify({ transactionId: payment.transactionId, amountCents: payment.amountCents, currency: payment.currency }) } });
    return { paid: !review, review, order };
  });
}

export async function reconcileSslCommerzPayment(transactionId) {
  if (!hasSslCommerz) throw new AppError(503, 'PAYMENT_GATEWAY_UNAVAILABLE', 'Payment gateway is not configured');
  const payment = await prisma.payment.findUnique({ where: { transactionId }, include: { order: true } });
  if (!payment || payment.provider !== 'SSLCOMMERZ') return null;
  if (['PAID', 'REFUNDED'].includes(payment.status)) return payment.order;
  const query = new URLSearchParams({ tran_id: transactionId, store_id: config.SSLCOMMERZ_STORE_ID, store_passwd: config.SSLCOMMERZ_STORE_PASSWORD, format: 'json' });
  const response = await fetch(`${sslBaseUrl()}/validator/api/merchantTransIDvalidationAPI.php?${query}`, { signal: AbortSignal.timeout(15_000) });
  const result = await response.json();
  if (!response.ok || result.APIConnect !== 'DONE' || !Array.isArray(result.element)) throw new AppError(502, 'PAYMENT_STATUS_UNAVAILABLE', 'Cannot verify gateway status yet');
  const records = result.element.filter(item => item.tran_id === transactionId);
  const paid = records.find(item => ['VALID', 'VALIDATED'].includes(item.status));
  if (paid) return (await validateSslCommerzPayment({ val_id: paid.val_id, tran_id: transactionId })).order;
  if (!records.length || !records.every(item => ['FAILED', 'CANCELLED', 'EXPIRED'].includes(item.status))) return payment.order;
  const status = records.some(item => item.status === 'FAILED') ? 'FAILED' : 'CANCELLED';
  return prisma.$transaction(async tx => {
    const changed = await tx.payment.updateMany({ where: { id: payment.id, transactionId, status: { in: ['PROCESSING', 'PENDING'] } }, data: { status, failureReason: 'Gateway confirmed this attempt did not complete' } });
    if (changed.count) await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: status } });
    return tx.order.findUnique({ where: { id: payment.orderId } });
  });
}
