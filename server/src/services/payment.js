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

const gatewayRequest = async (url, errorCode, message) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const result = await response.json();
    if (!response.ok) throw new Error(`Gateway HTTP ${response.status}`);
    return result;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, errorCode, message);
  }
};

export async function getPaymentOptions() {
  const manualChannels = await prisma.manualPaymentChannel.findMany({
    where: { active: true, ...(config.PAYMENT_CURRENCY !== 'BDT' ? { provider: 'BANK' } : {}) },
    orderBy: { createdAt: 'asc' },
  });
  return {
    currency: config.PAYMENT_CURRENCY,
    manualChannels,
    methods: [
      { id: 'COD', label: 'Cash on delivery', enabled: true, mode: 'live' },
      { id: 'MANUAL', label: 'Manual payment', enabled: manualChannels.length > 0, mode: 'manual' },
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

export function getGatewayConfiguration() {
  return {
    provider: 'SSLCOMMERZ',
    configured: hasSslCommerz,
    environment: hasSslCommerz ? (config.SSLCOMMERZ_LIVE ? 'live' : 'sandbox') : 'disabled',
    callbackBase: hasSslCommerz ? `${publicApiUrl}/api/payments/sslcommerz` : null,
    currency: config.PAYMENT_CURRENCY,
    refundSupported: hasSslCommerz,
  };
}

export function newPaymentTransactionId() {
  return `PAY${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function newRefundTransactionId() {
  return `RF${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`.slice(0, 30);
}

function parseManualDestination(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
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
    gatewayRiskLevel: payment.gatewayRiskLevel,
    gatewayRiskTitle: payment.gatewayRiskTitle,
    gatewayCardType: payment.gatewayCardType,
    gatewayCardIssuer: payment.gatewayCardIssuer,
    lastGatewayCheckAt: payment.lastGatewayCheckAt,
    failureReason: payment.failureReason,
    refundStatus: payment.refundStatus,
    refundReferenceId: payment.refundReferenceId,
    refundTransactionId: payment.refundTransactionId,
    refundAmountCents: payment.refundAmountCents,
    refundReason: payment.refundReason,
    refundRequestedAt: payment.refundRequestedAt,
    refundedAt: payment.refundedAt,
    manualDestination: parseManualDestination(payment.manualDestination),
    ...(payment.manualSubmissions ? { manualSubmissions: payment.manualSubmissions.map(({ referenceKey, reviewedBy, ...item }) => item) } : {}),
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
      where: {
        id: payment.id,
        attempts: payment.attempts,
        status: payment.status,
        order: { status: { notIn: ['CANCELLED', 'DELIVERED'] } },
      },
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

async function initiateDemo(_order, payment) {
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
    const updated = await prisma.payment.update({
      where: { id: prepared.id },
      data: { gatewaySessionId: result.sessionkey || null, lastGatewayCheckAt: new Date() },
    });
    return { payment: updated, paymentUrl: result.GatewayPageURL, provider: 'SSLCOMMERZ', mode: config.SSLCOMMERZ_LIVE ? 'live' : 'sandbox' };
  } catch {
    await prisma.payment.updateMany({
      where: { id: prepared.id, status: 'PROCESSING' },
      data: { failureReason: 'Gateway response unavailable; check payment status before retrying', lastGatewayCheckAt: new Date() },
    });
    throw new AppError(502, 'PAYMENT_GATEWAY_UNAVAILABLE', 'The payment gateway is temporarily unavailable. Your order was saved; retry payment from My orders.');
  }
}

export async function initiateOrderPayment(orderId, userId) {
  let order = await prisma.order.findFirst({
    where: { id: orderId, ...(userId ? { userId } : {}) },
    include: { items: true, payment: true },
  });
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  if (order.paymentMethod !== 'ONLINE') throw new AppError(409, 'NOT_ONLINE_PAYMENT', 'This order does not use online payment');
  if (['CANCELLED', 'DELIVERED'].includes(order.status)) throw new AppError(409, 'ORDER_NOT_PAYABLE', 'This order can no longer be paid online');
  if (order.paymentStatus === 'PAID' || order.payment?.status === 'PAID') throw new AppError(409, 'ALREADY_PAID', 'This order has already been paid');
  if (!order.payment) throw new AppError(409, 'PAYMENT_RECORD_MISSING', 'Payment record is unavailable');
  if (order.payment.provider === 'SSLCOMMERZ' && ['PROCESSING', 'REVIEW'].includes(order.payment.status)) {
    await reconcileSslCommerzPayment(order.payment.transactionId);
    order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true, payment: true } });
  }
  if (['PAID', 'REFUNDED', 'REFUND_PENDING', 'REVIEW'].includes(order.payment.status)) throw new AppError(409, 'PAYMENT_NOT_RETRYABLE', 'Payment is already received, being refunded, or under review. Check My orders.');
  if (order.payment.provider === 'SSLCOMMERZ' && order.payment.status === 'PROCESSING') throw new AppError(409, 'PAYMENT_PROCESSING', 'The gateway has not confirmed a final result yet. Please check again shortly.');
  if (demoEnabled && order.payment.provider === 'DEMO' && order.payment.status === 'PROCESSING') {
    return { payment: order.payment, paymentUrl: `/payment/demo/${order.payment.transactionId}?signature=${demoSignature(order.payment.transactionId)}`, provider: 'DEMO', mode: 'demo' };
  }
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
    if (session.payment.status === 'PAID') return transaction.order.findUnique({ where: { id: session.order.id }, include: { items: true, payment: true } });
    if (['CANCELLED', 'DELIVERED'].includes(session.order.status)) throw new AppError(409, 'ORDER_NOT_PAYABLE', 'This order can no longer be paid online');
    if (session.payment.status !== 'PROCESSING') throw new AppError(409, 'PAYMENT_SESSION_ENDED', 'This payment attempt has ended. Start a new attempt from My orders.');
    const paymentStatus = outcome === 'success' ? 'PAID' : outcome === 'cancel' ? 'CANCELLED' : 'FAILED';
    const payment = await transaction.payment.update({
      where: { transactionId },
      data: {
        status: paymentStatus,
        failureReason: outcome === 'success' ? null : `Demo payment ${outcome}`,
        ...(outcome === 'success' ? { paidAt: new Date(), gatewayTransactionId: `DEMO-${crypto.randomBytes(6).toString('hex').toUpperCase()}` } : {}),
      },
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
  const query = new URLSearchParams({
    val_id: validationId,
    store_id: config.SSLCOMMERZ_STORE_ID,
    store_passwd: config.SSLCOMMERZ_STORE_PASSWORD,
    v: '1',
    format: 'json',
  });
  const result = await gatewayRequest(
    `${sslBaseUrl()}/validator/api/validationserverAPI.php?${query}`,
    'PAYMENT_VALIDATION_UNAVAILABLE',
    'The payment gateway could not validate the transaction yet',
  );
  if (!['VALID', 'VALIDATED'].includes(result.status)) throw new AppError(400, 'PAYMENT_VALIDATION_FAILED', 'The payment could not be validated');
  if (input.tran_id && result.tran_id !== input.tran_id) throw new AppError(400, 'PAYMENT_VALIDATION_FAILED', 'Transaction identity mismatch');

  return prisma.$transaction(async transaction => {
    const payment = await transaction.payment.findUnique({ where: { transactionId: result.tran_id }, include: { order: true } });
    if (!payment || payment.provider !== 'SSLCOMMERZ') throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment transaction was not found');
    if (payment.status === 'PAID') return { paid: true, order: payment.order };
    if (['REFUND_PENDING', 'REFUNDED'].includes(payment.status)) return { paid: false, review: true, order: payment.order };

    const receivedCents = Math.round(Number(result.currency_amount || result.amount) * 100);
    const receivedCurrency = String(result.currency_type || result.currency || '').toUpperCase();
    if (!Number.isFinite(receivedCents) || receivedCents !== payment.amountCents || receivedCurrency !== payment.currency) {
      throw new AppError(409, 'PAYMENT_AMOUNT_MISMATCH', 'Payment amount or currency did not match the order');
    }

    const riskLevel = Number.isFinite(Number(result.risk_level)) ? Number(result.risk_level) : null;
    const review = riskLevel === 1 || payment.order.status === 'CANCELLED';
    const status = review ? 'REVIEW' : 'PAID';
    await transaction.payment.update({
      where: { id: payment.id },
      data: {
        status,
        validationId,
        gatewayTransactionId: result.bank_tran_id || null,
        gatewayRiskLevel: riskLevel,
        gatewayRiskTitle: result.risk_title || null,
        gatewayCardType: result.card_type || null,
        gatewayCardIssuer: result.card_issuer || null,
        lastGatewayCheckAt: new Date(),
        failureReason: review ? (riskLevel === 1 ? 'Gateway flagged this transaction for risk review' : 'Order was cancelled before payment verification') : null,
        ...(!review ? { paidAt: new Date() } : {}),
      },
    });
    const order = await transaction.order.update({
      where: { id: payment.orderId },
      data: { paymentStatus: status, ...(!review && payment.order.status === 'PENDING' ? { status: 'CONFIRMED' } : {}) },
    });
    await transaction.auditLog.create({
      data: {
        action: review ? 'GATEWAY_PAYMENT_REVIEW' : 'GATEWAY_PAYMENT_VERIFIED',
        entity: 'Payment',
        entityId: payment.id,
        metadata: JSON.stringify({
          transactionId: payment.transactionId,
          gatewayTransactionId: result.bank_tran_id || null,
          amountCents: payment.amountCents,
          currency: payment.currency,
          riskLevel,
        }),
      },
    });
    return { paid: !review, review, order };
  });
}

export async function reconcileSslCommerzRefund(paymentOrId) {
  if (!hasSslCommerz) throw new AppError(503, 'PAYMENT_GATEWAY_UNAVAILABLE', 'Payment gateway is not configured');
  const payment = typeof paymentOrId === 'string'
    ? await prisma.payment.findUnique({ where: { id: paymentOrId }, include: { order: true } })
    : paymentOrId;
  if (!payment || payment.provider !== 'SSLCOMMERZ') throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Gateway payment was not found');
  if (payment.status === 'REFUNDED') return payment.order;
  if (!payment.refundReferenceId) throw new AppError(409, 'REFUND_NOT_STARTED', 'No gateway refund has been started for this payment');

  const query = new URLSearchParams({
    refund_ref_id: payment.refundReferenceId,
    store_id: config.SSLCOMMERZ_STORE_ID,
    store_passwd: config.SSLCOMMERZ_STORE_PASSWORD,
    format: 'json',
  });
  const result = await gatewayRequest(
    `${sslBaseUrl()}/validator/api/merchantTransIDvalidationAPI.php?${query}`,
    'REFUND_STATUS_UNAVAILABLE',
    'Cannot verify refund status yet',
  );
  if (result.APIConnect !== 'DONE') throw new AppError(502, 'REFUND_STATUS_UNAVAILABLE', result.errorReason || 'Cannot verify refund status yet');
  const gatewayStatus = String(result.status || '').toLowerCase();

  return prisma.$transaction(async tx => {
    if (gatewayStatus === 'refunded') {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'REFUNDED',
          refundStatus: 'REFUNDED',
          refundedAt: new Date(),
          lastGatewayCheckAt: new Date(),
          failureReason: null,
        },
      });
      return tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: 'REFUNDED' } });
    }
    if (gatewayStatus === 'cancelled') {
      const restoredStatus = payment.gatewayRiskLevel === 1 ? 'REVIEW' : 'PAID';
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: restoredStatus,
          refundStatus: 'CANCELLED',
          lastGatewayCheckAt: new Date(),
          failureReason: result.errorReason || 'Gateway refund was cancelled',
        },
      });
      return tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: restoredStatus } });
    }
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'REFUND_PENDING', refundStatus: gatewayStatus ? gatewayStatus.toUpperCase() : 'PROCESSING', lastGatewayCheckAt: new Date() },
    });
    await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: 'REFUND_PENDING' } });
    return tx.order.findUnique({ where: { id: payment.orderId } });
  });
}

export async function approveSslCommerzRiskPayment(paymentId) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
  if (payment.provider !== 'SSLCOMMERZ') throw new AppError(409, 'NOT_GATEWAY_PAYMENT', 'This payment does not use SSLCOMMERZ');
  if (payment.status === 'PAID') return payment;
  if (payment.status !== 'REVIEW' || !payment.validationId || !payment.gatewayTransactionId) {
    throw new AppError(409, 'RISK_REVIEW_NOT_AVAILABLE', 'Only a gateway-validated risk payment can be accepted');
  }
  return prisma.$transaction(async tx => {
    const changed = await tx.payment.updateMany({
      where: { id: payment.id, status: 'REVIEW' },
      data: { status: 'PAID', paidAt: payment.paidAt || new Date(), failureReason: null },
    });
    if (!changed.count) throw new AppError(409, 'PAYMENT_CHANGED', 'Payment changed before the review decision was recorded');
    await tx.order.update({
      where: { id: payment.orderId },
      data: { paymentStatus: 'PAID', ...(payment.order.status === 'PENDING' ? { status: 'CONFIRMED' } : {}) },
    });
    await tx.auditLog.create({
      data: {
        action: 'GATEWAY_RISK_PAYMENT_ACCEPTED',
        entity: 'Payment',
        entityId: payment.id,
        metadata: JSON.stringify({ transactionId: payment.transactionId, gatewayTransactionId: payment.gatewayTransactionId, riskLevel: payment.gatewayRiskLevel }),
      },
    });
    return tx.payment.findUnique({ where: { id: payment.id } });
  });
}

export async function requestSslCommerzRefund(paymentId, reason) {
  if (!hasSslCommerz) throw new AppError(503, 'PAYMENT_GATEWAY_UNAVAILABLE', 'Payment gateway is not configured');
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
  if (payment.provider !== 'SSLCOMMERZ') throw new AppError(409, 'NOT_GATEWAY_PAYMENT', 'This payment does not use SSLCOMMERZ');
  if (payment.status === 'REFUNDED') return payment;
  if (payment.status === 'REFUND_PENDING' && payment.refundReferenceId) {
    await reconcileSslCommerzRefund(payment);
    return prisma.payment.findUnique({ where: { id: payment.id } });
  }
  if (!['PAID', 'REVIEW'].includes(payment.status)) throw new AppError(409, 'PAYMENT_NOT_REFUNDABLE', 'Only a verified paid or risk-reviewed gateway transaction can be refunded');
  if (!payment.gatewayTransactionId) throw new AppError(409, 'GATEWAY_REFERENCE_MISSING', 'The bank transaction reference is missing; reconcile the payment before refunding');

  const refundTransactionId = newRefundTransactionId();
  const cleanReason = String(reason || '').trim().slice(0, 255);
  if (cleanReason.length < 5) throw new AppError(400, 'REFUND_REASON_REQUIRED', 'Provide a refund reason of at least 5 characters');
  const query = new URLSearchParams({
    bank_tran_id: payment.gatewayTransactionId,
    refund_trans_id: refundTransactionId,
    refund_amount: (payment.amountCents / 100).toFixed(2),
    refund_remarks: cleanReason,
    refe_id: payment.transactionId.slice(0, 50),
    store_id: config.SSLCOMMERZ_STORE_ID,
    store_passwd: config.SSLCOMMERZ_STORE_PASSWORD,
    v: '1',
    format: 'json',
  });
  const result = await gatewayRequest(
    `${sslBaseUrl()}/validator/api/merchantTransIDvalidationAPI.php?${query}`,
    'REFUND_GATEWAY_UNAVAILABLE',
    'The gateway could not start the refund',
  );
  const gatewayStatus = String(result.status || '').toLowerCase();
  if (result.APIConnect !== 'DONE' || !['success', 'processing'].includes(gatewayStatus) || !result.refund_ref_id) {
    throw new AppError(409, 'REFUND_NOT_ACCEPTED', result.errorReason || 'The gateway did not accept the refund request');
  }

  return prisma.$transaction(async tx => {
    const changed = await tx.payment.updateMany({
      where: { id: payment.id, status: payment.status },
      data: {
        status: 'REFUND_PENDING',
        refundStatus: gatewayStatus.toUpperCase(),
        refundReferenceId: String(result.refund_ref_id).slice(0, 100),
        refundTransactionId,
        refundAmountCents: payment.amountCents,
        refundReason: cleanReason,
        refundRequestedAt: new Date(),
        lastGatewayCheckAt: new Date(),
        failureReason: null,
      },
    });
    if (!changed.count) throw new AppError(409, 'PAYMENT_CHANGED', 'Payment changed before the refund could be recorded');
    await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: 'REFUND_PENDING' } });
    await tx.auditLog.create({
      data: {
        action: 'GATEWAY_REFUND_REQUESTED',
        entity: 'Payment',
        entityId: payment.id,
        metadata: JSON.stringify({ refundTransactionId, refundReferenceId: result.refund_ref_id, amountCents: payment.amountCents, reason: cleanReason }),
      },
    });
    return tx.payment.findUnique({ where: { id: payment.id } });
  });
}

export async function reconcileSslCommerzPayment(transactionId) {
  if (!hasSslCommerz) throw new AppError(503, 'PAYMENT_GATEWAY_UNAVAILABLE', 'Payment gateway is not configured');
  if (!transactionId) throw new AppError(400, 'PAYMENT_TRANSACTION_REQUIRED', 'Payment transaction ID is required');
  const payment = await prisma.payment.findUnique({ where: { transactionId }, include: { order: true } });
  if (!payment || payment.provider !== 'SSLCOMMERZ') return null;
  if (payment.status === 'REFUND_PENDING') return reconcileSslCommerzRefund(payment);
  if (['PAID', 'REFUNDED'].includes(payment.status)) return payment.order;

  const query = new URLSearchParams({
    tran_id: transactionId,
    store_id: config.SSLCOMMERZ_STORE_ID,
    store_passwd: config.SSLCOMMERZ_STORE_PASSWORD,
    format: 'json',
  });
  const result = await gatewayRequest(
    `${sslBaseUrl()}/validator/api/merchantTransIDvalidationAPI.php?${query}`,
    'PAYMENT_STATUS_UNAVAILABLE',
    'Cannot verify gateway status yet',
  );
  if (result.APIConnect !== 'DONE' || !Array.isArray(result.element)) throw new AppError(502, 'PAYMENT_STATUS_UNAVAILABLE', 'Cannot verify gateway status yet');
  const records = result.element.filter(item => item.tran_id === transactionId);
  const paid = records.find(item => ['VALID', 'VALIDATED'].includes(item.status));
  if (paid) return (await validateSslCommerzPayment({ val_id: paid.val_id, tran_id: transactionId })).order;
  if (!records.length || !records.every(item => ['FAILED', 'CANCELLED', 'EXPIRED'].includes(item.status))) {
    await prisma.payment.update({ where: { id: payment.id }, data: { lastGatewayCheckAt: new Date() } });
    return payment.order;
  }
  const status = records.some(item => item.status === 'FAILED') ? 'FAILED' : 'CANCELLED';
  return prisma.$transaction(async tx => {
    const changed = await tx.payment.updateMany({
      where: { id: payment.id, transactionId, status: { in: ['PROCESSING', 'PENDING'] } },
      data: { status, failureReason: 'Gateway confirmed this attempt did not complete', lastGatewayCheckAt: new Date() },
    });
    if (changed.count) await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: status } });
    return tx.order.findUnique({ where: { id: payment.orderId } });
  });
}
