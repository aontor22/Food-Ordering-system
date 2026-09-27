import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { awardDeliveredOrderPoints } from './loyalty.js';

const GUEST_ACCESS_DAYS = 90;
const GUEST_AUDIENCE = 'food-ordering-guest-order';
const GUEST_ISSUER = 'food-ordering-api';

export function normalizeOrderEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function newGuestAccessState(now = new Date()) {
  return {
    guestAccessNonce: crypto.randomBytes(24).toString('base64url'),
    guestAccessExpiresAt: new Date(now.getTime() + GUEST_ACCESS_DAYS * 24 * 60 * 60 * 1000),
  };
}

export function issueGuestOrderAccessToken(order) {
  if (!order?.id || !order?.guestAccessNonce || !order?.guestAccessExpiresAt || order.customerType !== 'GUEST') {
    throw new AppError(409, 'GUEST_ACCESS_UNAVAILABLE', 'Guest order access is unavailable');
  }
  const expiresAt = new Date(order.guestAccessExpiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) {
    throw new AppError(410, 'GUEST_ACCESS_EXPIRED', 'This guest order access link has expired');
  }
  return jwt.sign({
    sub: order.id,
    nonce: order.guestAccessNonce,
    type: 'guest-order',
    exp: Math.floor(expiresAt.getTime() / 1000),
  }, config.JWT_ACCESS_SECRET, { issuer: GUEST_ISSUER, audience: GUEST_AUDIENCE });
}

export function guestTokenFromRequest(req) {
  const token = String(req.get('x-order-access-token') || '').trim();
  if (!token || token.length > 4096) throw new AppError(401, 'GUEST_ACCESS_REQUIRED', 'A valid guest order access token is required');
  return token;
}

function verifyGuestToken(token) {
  try {
    const payload = jwt.verify(token, config.JWT_ACCESS_SECRET, { issuer: GUEST_ISSUER, audience: GUEST_AUDIENCE });
    if (payload?.type !== 'guest-order' || typeof payload.sub !== 'string' || typeof payload.nonce !== 'string') throw new Error('invalid guest token');
    return payload;
  } catch (error) {
    if (error?.name === 'TokenExpiredError') throw new AppError(410, 'GUEST_ACCESS_EXPIRED', 'This guest order access link has expired');
    throw new AppError(401, 'INVALID_GUEST_ACCESS', 'Guest order access token is invalid');
  }
}

export async function getGuestOrderByToken(token, { db = prisma, include = undefined } = {}) {
  const payload = verifyGuestToken(token);
  const order = await db.order.findFirst({
    where: {
      id: payload.sub,
      customerType: 'GUEST',
      guestAccessNonce: payload.nonce,
      guestAccessExpiresAt: { gt: new Date() },
    },
    ...(include ? { include } : {}),
  });
  if (!order) throw new AppError(404, 'GUEST_ORDER_NOT_FOUND', 'Guest order not found');
  return order;
}

export function guestTrackingUrl(order) {
  const base = config.CLIENT_ORIGIN.split(',').map(value => value.trim()).find(Boolean)?.replace(/\/$/, '') || 'http://localhost:5173';
  const token = issueGuestOrderAccessToken(order);
  return `${base}/guest-order/${encodeURIComponent(order.orderNumber)}#access=${encodeURIComponent(token)}`;
}

async function awardIfDelivered(db, order) {
  if (order.status !== 'DELIVERED' || !order.userId || order.pointsAwardedAt) return 0;
  const result = await awardDeliveredOrderPoints(db, order);
  return result.awarded || 0;
}

export async function linkGuestOrderToUser(userId, token) {
  const payload = verifyGuestToken(token);
  return prisma.$transaction(async tx => {
    const [user, order] = await Promise.all([
      tx.user.findUnique({ where: { id: userId } }),
      tx.order.findFirst({
        where: { id: payload.sub, customerType: 'GUEST', guestAccessNonce: payload.nonce, guestAccessExpiresAt: { gt: new Date() } },
        include: { items: { include: { review: true } }, payment: true, trackingEvents: { orderBy: { createdAt: 'asc' } } },
      }),
    ]);
    if (!user?.isActive) throw new AppError(401, 'ACCOUNT_UNAVAILABLE', 'Account is unavailable');
    if (!order) throw new AppError(404, 'GUEST_ORDER_NOT_FOUND', 'Guest order not found');
    if (normalizeOrderEmail(order.email) !== normalizeOrderEmail(user.email)) {
      throw new AppError(403, 'GUEST_EMAIL_MISMATCH', 'This order belongs to a different email address');
    }
    if (order.userId && order.userId !== user.id) throw new AppError(409, 'GUEST_ORDER_ALREADY_LINKED', 'This guest order is already linked to another account');

    let linked = order;
    let linkedNow = false;
    if (!order.userId) {
      const changed = await tx.order.updateMany({
        where: { id: order.id, userId: null },
        data: { userId: user.id, guestLinkedAt: new Date() },
      });
      if (!changed.count) throw new AppError(409, 'GUEST_ORDER_CHANGED', 'This guest order changed while it was being linked');
      linkedNow = true;
      linked = await tx.order.findUnique({
        where: { id: order.id },
        include: { items: { include: { review: true } }, payment: true, trackingEvents: { orderBy: { createdAt: 'asc' } } },
      });
    }

    const pointsAwarded = linkedNow ? await awardIfDelivered(tx, linked) : 0;
    if (pointsAwarded) {
      linked = await tx.order.findUnique({
        where: { id: order.id },
        include: { items: { include: { review: true } }, payment: true, trackingEvents: { orderBy: { createdAt: 'asc' } } },
      });
    }
    return { order: linked, linkedNow, pointsAwarded };
  }, { isolationLevel: 'Serializable' });
}

export async function linkEligibleGuestOrdersForVerifiedUser(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.isActive || !user.emailVerifiedAt) return { linked: 0, pointsAwarded: 0 };
  const email = normalizeOrderEmail(user.email);

  return prisma.$transaction(async tx => {
    const candidates = await tx.order.findMany({
      where: {
        customerType: 'GUEST',
        userId: null,
        email,
        guestAccessExpiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'asc' },
    });
    let linked = 0;
    let pointsAwarded = 0;
    for (const candidate of candidates) {
      const changed = await tx.order.updateMany({
        where: { id: candidate.id, userId: null },
        data: { userId: user.id, guestLinkedAt: new Date() },
      });
      if (!changed.count) continue;
      linked += 1;
      pointsAwarded += await awardIfDelivered(tx, { ...candidate, userId: user.id, guestLinkedAt: new Date() });
    }
    return { linked, pointsAwarded };
  }, { isolationLevel: 'Serializable' });
}
