import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { getNotificationPreference, notificationCapabilities, sendTestNotification } from '../services/notifications.js';

const router = Router();
router.use(requireAuth);
const empty = z.any();
const testNotificationLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false });

function publicPreference(preference) {
  const { id, userId, createdAt, updatedAt, ...settings } = preference;
  return { ...settings, updatedAt };
}

router.get('/', async (req, res) => {
  const [preference, pushSubscriptions] = await Promise.all([
    getNotificationPreference(req.auth.sub),
    prisma.pushSubscription.count({ where: { userId: req.auth.sub } }),
  ]);
  res.json({ preference: publicPreference(preference), capabilities: notificationCapabilities(), pushSubscriptions });
});

const preferenceSchema = z.object({
  body: z.object({
    emailEnabled: z.boolean().optional(),
    orderPlaced: z.boolean().optional(),
    orderConfirmed: z.boolean().optional(),
    orderPreparing: z.boolean().optional(),
    orderReady: z.boolean().optional(),
    orderDelivered: z.boolean().optional(),
    orderCancelled: z.boolean().optional(),
    etaUpdates: z.boolean().optional(),
  }).refine(value => Object.keys(value).length > 0, 'At least one preference is required'),
  params: empty, query: empty,
});

router.patch('/preferences', validate(preferenceSchema), async (req, res) => {
  const preference = await prisma.notificationPreference.upsert({
    where: { userId: req.auth.sub },
    update: req.validated.body,
    create: { userId: req.auth.sub, ...req.validated.body },
  });
  res.json({ preference: publicPreference(preference), capabilities: notificationCapabilities() });
});

const subscriptionSchema = z.object({
  body: z.object({
    endpoint: z.url().max(2048),
    keys: z.object({ p256dh: z.string().min(20).max(500), auth: z.string().min(8).max(200) }),
  }), params: empty, query: empty,
});

router.post('/push-subscriptions', validate(subscriptionSchema), async (req, res, next) => {
  try {
    if (!notificationCapabilities().push) throw new AppError(503, 'PUSH_NOT_CONFIGURED', 'Browser push notifications are not configured');
    const { endpoint, keys } = req.validated.body;
    const subscription = await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { userId: req.auth.sub, p256dh: keys.p256dh, auth: keys.auth, userAgent: req.get('user-agent')?.slice(0, 500) || null },
      create: { userId: req.auth.sub, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: req.get('user-agent')?.slice(0, 500) || null },
    });
    await prisma.notificationPreference.upsert({
      where: { userId: req.auth.sub }, update: { pushEnabled: true }, create: { userId: req.auth.sub, pushEnabled: true },
    });
    res.status(201).json({ subscription: { id: subscription.id, endpoint: subscription.endpoint, updatedAt: subscription.updatedAt } });
  } catch (error) { next(error); }
});

router.delete('/push-subscriptions', validate(z.object({
  body: z.object({ endpoint: z.url().max(2048) }), params: empty, query: empty,
})), async (req, res) => {
  await prisma.pushSubscription.deleteMany({ where: { userId: req.auth.sub, endpoint: req.validated.body.endpoint } });
  const remaining = await prisma.pushSubscription.count({ where: { userId: req.auth.sub } });
  if (!remaining) await prisma.notificationPreference.upsert({ where: { userId: req.auth.sub }, update: { pushEnabled: false }, create: { userId: req.auth.sub, pushEnabled: false } });
  res.status(204).end();
});

router.post('/test/:channel', testNotificationLimiter, async (req, res, next) => {
  try {
    const channel = String(req.params.channel || '').toUpperCase();
    if (!['EMAIL', 'PUSH'].includes(channel)) throw new AppError(400, 'INVALID_NOTIFICATION_CHANNEL', 'Use EMAIL or PUSH');
    const capabilities = notificationCapabilities();
    if (channel === 'EMAIL' && !capabilities.email) throw new AppError(503, 'EMAIL_NOT_CONFIGURED', 'Email notifications are not configured');
    if (channel === 'PUSH' && !capabilities.push) throw new AppError(503, 'PUSH_NOT_CONFIGURED', 'Browser push notifications are not configured');
    const result = await sendTestNotification(req.auth.sub, channel);
    if (result?.skipped) throw new AppError(409, 'NOTIFICATION_NOT_READY', result.reason);
    res.json({ ok: true, channel });
  } catch (error) { next(error); }
});

export default router;
