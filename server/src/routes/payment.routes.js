import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { getManualOrder, submitManualPayment } from '../services/manual-payment.js';
import { safeEnqueueOrderNotification } from '../services/notifications.js';
import {
  completeDemoPayment,
  reconcileSslCommerzPayment,
  getDemoPayment,
  getPaymentOptions,
  initiateOrderPayment,
  serializePayment,
  validateSslCommerzPayment,
} from '../services/payment.js';

const router = Router();
const clientOrigin = config.CLIENT_ORIGIN.split(',')[0].trim().replace(/\/$/, '');
const paymentResult = (status, orderNumber = '') => `${clientOrigin}/payment/result?status=${encodeURIComponent(status)}&order=${encodeURIComponent(orderNumber)}`;

router.get('/options', async (_req, res) => res.json(await getPaymentOptions()));

router.post('/sslcommerz/ipn', async (req, res, next) => {
  try {
    if (req.body.val_id) {
      const result = await validateSslCommerzPayment(req.body);
      if (result.paid && result.order?.status === 'CONFIRMED') await safeEnqueueOrderNotification(result.order.id, 'CONFIRMED', {}, req.log);
      res.json({ received: true, status: result.review ? 'REVIEW' : 'PAID' });
    } else {
      const order = await reconcileSslCommerzPayment(String(req.body.tran_id || ''));
      if (order?.status === 'CONFIRMED') await safeEnqueueOrderNotification(order.id, 'CONFIRMED', {}, req.log);
      res.json({ received: Boolean(order), status: order?.paymentStatus });
    }
  } catch (error) { next(error); }
});

router.post('/sslcommerz/success', async (req, res) => {
  try {
    const result = await validateSslCommerzPayment(req.body);
    if (result.paid && result.order?.status === 'CONFIRMED') await safeEnqueueOrderNotification(result.order.id, 'CONFIRMED', {}, req.log);
    res.redirect(303, paymentResult(result.review ? 'review' : 'success', result.order.orderNumber));
  } catch (error) {
    const uncertain = ['PAYMENT_VALIDATION_UNAVAILABLE', 'PAYMENT_STATUS_UNAVAILABLE'].includes(error?.code) || Number(error?.status) >= 500;
    res.redirect(303, paymentResult(uncertain ? 'pending' : 'failed'));
  }
});

router.post('/sslcommerz/fail', async (req, res) => {
  try {
    const order = await reconcileSslCommerzPayment(String(req.body.tran_id || ''));
    res.redirect(303, paymentResult('failed', order?.orderNumber));
  } catch { res.redirect(303, paymentResult('pending')); }
});

router.post('/sslcommerz/cancel', async (req, res) => {
  try {
    const order = await reconcileSslCommerzPayment(String(req.body.tran_id || ''));
    res.redirect(303, paymentResult('cancelled', order?.orderNumber));
  } catch { res.redirect(303, paymentResult('pending')); }
});

router.use(requireAuth);

router.get('/manual/:orderId', async (req, res, next) => {
  try { res.json(await getManualOrder(req.params.orderId, req.auth.sub)); }
  catch (error) { next(error); }
});
router.post('/manual/:orderId/submit', async (req, res, next) => {
  try { res.status(201).json({ submission: await submitManualPayment(req.params.orderId, req.auth.sub, req.body, req) }); }
  catch (error) { next(error); }
});

router.post('/orders/:orderId/initiate', async (req, res, next) => {
  try {
    const result = await initiateOrderPayment(req.params.orderId, req.auth.sub);
    await audit(req, 'PAYMENT_INITIATED', 'Payment', result.payment.id, { provider: result.provider, mode: result.mode });
    res.json({ payment: serializePayment(result.payment), paymentUrl: result.paymentUrl, provider: result.provider, mode: result.mode });
  } catch (error) { next(error); }
});

router.get('/demo/:transactionId', async (req, res, next) => {
  try { res.json(await getDemoPayment(req.params.transactionId, req.auth.sub, String(req.query.signature || ''))); }
  catch (error) { next(error); }
});

router.post('/demo/:transactionId/complete', validate(z.object({
  body: z.object({ signature: z.string().min(10), outcome: z.enum(['success', 'fail', 'cancel']) }),
  params: z.object({ transactionId: z.string().min(1) }),
  query: z.any(),
})), async (req, res, next) => {
  try {
    const order = await completeDemoPayment(req.validated.params.transactionId, req.auth.sub, req.validated.body.signature, req.validated.body.outcome);
    await audit(req, req.validated.body.outcome === 'success' ? 'PAYMENT_PAID' : 'PAYMENT_ATTEMPT_ENDED', 'Payment', order.payment.id, { outcome: req.validated.body.outcome, provider: 'DEMO' });
    if (req.validated.body.outcome === 'success' && order.status === 'CONFIRMED') await safeEnqueueOrderNotification(order.id, 'CONFIRMED', {}, req.log);
    res.json({ order: { ...order, payment: serializePayment(order.payment) } });
  } catch (error) { next(error); }
});

export default router;
