import nodemailer from 'nodemailer';
import webpush from 'web-push';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';

const STATUS_PREF_FIELD = {
  PENDING: 'orderPlaced',
  CONFIRMED: 'orderConfirmed',
  PREPARING: 'orderPreparing',
  READY_FOR_PICKUP: 'orderReady',
  OUT_FOR_DELIVERY: 'orderReady',
  DELIVERED: 'orderDelivered',
  CANCELLED: 'orderCancelled',
};

const STATUS_COPY = {
  PENDING: ['Order received', 'We received your order and will confirm it shortly.'],
  CONFIRMED: ['Order confirmed', 'Your order has been confirmed by the restaurant.'],
  PREPARING: ['Your food is being prepared', 'The kitchen has started preparing your order.'],
  READY_FOR_PICKUP: ['Ready for pickup', 'Your order is ready to collect from the restaurant.'],
  OUT_FOR_DELIVERY: ['Out for delivery', 'Your order is on the way.'],
  DELIVERED: ['Order completed', 'Your order has been marked as delivered. Enjoy your meal!'],
  CANCELLED: ['Order cancelled', 'Your order has been cancelled.'],
};

let transporter;
let workerTimer;
let workerBusy = false;

export function emailConfigured() {
  return Boolean(config.SMTP_HOST && config.EMAIL_FROM);
}

export function pushConfigured() {
  return Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY);
}

export function notificationCapabilities() {
  return {
    email: emailConfigured(),
    push: pushConfigured(),
    vapidPublicKey: pushConfigured() ? config.VAPID_PUBLIC_KEY : null,
  };
}

function getTransporter() {
  if (!emailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASS || '' } } : {}),
    });
  }
  return transporter;
}

function configureWebPush() {
  if (!pushConfigured()) return false;
  webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);
  return true;
}

export async function getNotificationPreference(userId, db = prisma) {
  return db.notificationPreference.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

function eventAllowed(preference, eventType) {
  if (eventType.startsWith('ETA:')) return preference.etaUpdates;
  return preference[STATUS_PREF_FIELD[eventType]] !== false;
}

function formatMoney(cents, currency) {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents || 0) / 100); }
  catch { return `${currency} ${((cents || 0) / 100).toFixed(2)}`; }
}

function clientBaseUrl() {
  return config.CLIENT_ORIGIN.split(',').map(v => v.trim()).find(Boolean) || 'http://localhost:5173';
}

function payloadForOrder(order, eventType, { etaNote = null } = {}) {
  const isEta = eventType.startsWith('ETA:');
  const [title, defaultBody] = isEta
    ? ['Order estimate updated', etaNote || 'The restaurant updated the estimated time for your order.']
    : (STATUS_COPY[eventType] || ['Order update', 'There is a new update for your order.']);
  const body = `${defaultBody} Order ${order.orderNumber}.`;
  const url = `${clientBaseUrl().replace(/\/$/, '')}/orders`;
  const itemSummary = (order.items || []).slice(0, 5).map(item => `${item.quantity}× ${item.productName}`).join(', ');
  return {
    title,
    body,
    url,
    tag: `order-${order.id}`,
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    eventType,
    customerName: `${order.firstName || ''} ${order.lastName || ''}`.trim() || order.user?.name || 'Customer',
    email: order.email || order.user?.email,
    total: formatMoney(order.totalCents, config.PAYMENT_CURRENCY),
    itemSummary,
    fulfillmentType: order.fulfillmentType,
    scheduledForLocal: order.scheduledForLocal || null,
  };
}

async function upsertDelivery(db, { order, eventType, channel, payload }) {
  const key = {
    userId_orderId_eventType_channel: {
      userId: order.userId,
      orderId: order.id,
      eventType,
      channel,
    },
  };
  return db.notificationDelivery.upsert({
    where: key,
    update: {},
    create: {
      userId: order.userId,
      orderId: order.id,
      eventType,
      channel,
      payloadJson: JSON.stringify(payload),
      status: 'PENDING',
    },
  });
}

export async function enqueueOrderNotification(orderOrId, eventType, options = {}) {
  const orderId = typeof orderOrId === 'string' ? orderOrId : orderOrId.id;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, user: { select: { id: true, name: true, email: true } } },
  });
  if (!order) return { queued: 0 };
  const preference = await getNotificationPreference(order.userId);
  if (!eventAllowed(preference, eventType)) return { queued: 0, disabled: true };
  const payload = payloadForOrder(order, eventType, options);
  let queued = 0;
  if (preference.emailEnabled) {
    await upsertDelivery(prisma, { order, eventType, channel: 'EMAIL', payload });
    queued += 1;
  }
  if (preference.pushEnabled) {
    await upsertDelivery(prisma, { order, eventType, channel: 'PUSH', payload });
    queued += 1;
  }
  return { queued };
}

export async function safeEnqueueOrderNotification(orderOrId, eventType, options = {}, logger = console) {
  try { return await enqueueOrderNotification(orderOrId, eventType, options); }
  catch (error) {
    logger?.warn?.({ err: error, orderId: typeof orderOrId === 'string' ? orderOrId : orderOrId?.id, eventType }, 'notification enqueue failed');
    return { queued: 0, error: true };
  }
}

function emailHtml(payload) {
  const safe = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  return `<!doctype html><html><body style="margin:0;background:#f7f5f1;font-family:Arial,sans-serif;color:#202521"><div style="max-width:620px;margin:0 auto;padding:28px 16px"><div style="background:#fff;border:1px solid #ebe6dd;border-radius:18px;overflow:hidden"><div style="padding:22px 26px;background:#f4512c;color:#fff"><strong style="font-size:22px">Tomato.</strong></div><div style="padding:28px"><p style="margin:0 0 8px;color:#777;font-size:13px">ORDER ${safe(payload.orderNumber)}</p><h1 style="margin:0 0 12px;font-size:25px">${safe(payload.title)}</h1><p style="margin:0 0 20px;line-height:1.6">Hi ${safe(payload.customerName)}, ${safe(payload.body)}</p>${payload.itemSummary ? `<p style="margin:0 0 8px;color:#555"><strong>Items:</strong> ${safe(payload.itemSummary)}</p>` : ''}<p style="margin:0 0 24px;color:#555"><strong>Total:</strong> ${safe(payload.total)}</p><a href="${safe(payload.url)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#f4512c;color:#fff;text-decoration:none;font-weight:700">Track your order</a><p style="margin:28px 0 0;color:#888;font-size:12px;line-height:1.5">You can change email and browser notification preferences from your Tomato notification settings.</p></div></div></div></body></html>`;
}

async function sendEmail(delivery, payload) {
  const transport = getTransporter();
  if (!transport) return { skipped: true, reason: 'SMTP is not configured' };
  if (!payload.email) return { skipped: true, reason: 'Customer email is unavailable' };
  const info = await transport.sendMail({
    from: { name: config.EMAIL_FROM_NAME, address: config.EMAIL_FROM },
    to: payload.email,
    subject: `${payload.title} · ${payload.orderNumber}`,
    text: `${payload.title}\n\n${payload.body}\n\nOrder: ${payload.orderNumber}\nTotal: ${payload.total}\nTrack: ${payload.url}`,
    html: emailHtml(payload),
    headers: { 'X-Entity-Ref-ID': delivery.id },
  });
  return { messageId: info.messageId || null };
}

async function sendPush(delivery, payload) {
  if (!configureWebPush()) return { skipped: true, reason: 'Web Push is not configured' };
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId: delivery.userId } });
  if (!subscriptions.length) return { skipped: true, reason: 'No browser subscription is registered' };
  let success = 0;
  let lastError = null;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, JSON.stringify(payload), { TTL: 60 * 60 });
      success += 1;
    } catch (error) {
      lastError = error;
      if ([404, 410].includes(error.statusCode)) {
        await prisma.pushSubscription.deleteMany({ where: { id: subscription.id } });
      }
    }
  }
  if (!success) {
    const remaining = await prisma.pushSubscription.count({ where: { userId: delivery.userId } });
    if (!remaining) await prisma.notificationPreference.updateMany({ where: { userId: delivery.userId }, data: { pushEnabled: false } });
    throw lastError || new Error('Push notification failed for all registered devices');
  }
  return { messageId: `push:${success}` };
}

function retryDelayMs(attempts) {
  return Math.min(30 * 60_000, 15_000 * (2 ** Math.max(0, attempts - 1)));
}

export async function processNotificationDelivery(delivery) {
  const payload = JSON.parse(delivery.payloadJson);
  const attempts = delivery.attempts + 1;
  const preference = await getNotificationPreference(delivery.userId);
  const channelEnabled = delivery.channel === 'EMAIL' ? preference.emailEnabled : preference.pushEnabled;
  if (!channelEnabled || !eventAllowed(preference, delivery.eventType)) {
    return prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: 'SKIPPED', attempts, lastError: 'Notification disabled by customer preference', nextAttemptAt: new Date(), sentAt: null },
    });
  }
  try {
    const result = delivery.channel === 'EMAIL'
      ? await sendEmail(delivery, payload)
      : await sendPush(delivery, payload);
    if (result.skipped) {
      return prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: 'SKIPPED', attempts, lastError: result.reason, nextAttemptAt: new Date(), sentAt: null },
      });
    }
    return prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: 'SENT', attempts, lastError: null, providerMessageId: result.messageId, sentAt: new Date(), nextAttemptAt: new Date() },
    });
  } catch (error) {
    const terminal = attempts >= 4;
    return prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: terminal ? 'FAILED' : 'RETRY',
        attempts,
        lastError: String(error?.message || error).slice(0, 500),
        nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)),
      },
    });
  }
}

export async function processPendingNotifications({ limit = 25 } = {}) {
  if (workerBusy) return { processed: 0, busy: true };
  workerBusy = true;
  try {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - 5 * 60_000);
    await prisma.notificationDelivery.updateMany({
      where: { status: 'SENDING', updatedAt: { lt: staleBefore } },
      data: { status: 'RETRY', nextAttemptAt: now, lastError: 'Recovered a stale in-progress notification job' },
    });
    const candidates = await prisma.notificationDelivery.findMany({
      where: { status: { in: ['PENDING', 'RETRY'] }, nextAttemptAt: { lte: now } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    let processed = 0;
    for (const candidate of candidates) {
      const claimed = await prisma.notificationDelivery.updateMany({
        where: { id: candidate.id, status: { in: ['PENDING', 'RETRY'] }, nextAttemptAt: { lte: new Date() } },
        data: { status: 'SENDING' },
      });
      if (!claimed.count) continue;
      const delivery = await prisma.notificationDelivery.findUnique({ where: { id: candidate.id } });
      if (!delivery) continue;
      await processNotificationDelivery(delivery);
      processed += 1;
    }
    return { processed };
  } finally {
    workerBusy = false;
  }
}

export function startNotificationWorker({ intervalMs = 10_000, logger = console } = {}) {
  if (workerTimer) return () => {};
  const tick = () => processPendingNotifications().catch(error => logger.error?.('notification worker failed', error));
  setTimeout(tick, 1500).unref?.();
  workerTimer = setInterval(tick, intervalMs);
  workerTimer.unref?.();
  return () => { clearInterval(workerTimer); workerTimer = null; };
}

export async function retryNotificationDelivery(id) {
  return prisma.notificationDelivery.update({
    where: { id },
    data: { status: 'PENDING', attempts: 0, lastError: null, nextAttemptAt: new Date(), sentAt: null },
  });
}

export async function sendTestNotification(userId, channel) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found');
  const payload = {
    title: 'Tomato notifications are ready',
    body: 'This is a test notification from Tomato.',
    url: `${clientBaseUrl().replace(/\/$/, '')}/notifications`,
    tag: `test-${userId}`,
    customerName: user.name,
    email: user.email,
    orderNumber: 'TEST',
    total: '',
    itemSummary: '',
    eventType: 'TEST',
  };
  const fakeDelivery = { id: `test-${Date.now()}`, userId, channel };
  return channel === 'EMAIL' ? sendEmail(fakeDelivery, payload) : sendPush(fakeDelivery, payload);
}
