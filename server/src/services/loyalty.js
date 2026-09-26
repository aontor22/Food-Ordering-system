import { prisma } from '../lib/prisma.js';

export const LOYALTY_SETTINGS_ID = 'default';
export const DEFAULT_LOYALTY_SETTINGS = {
  id: LOYALTY_SETTINGS_ID,
  enabled: true,
  pointsPerOrder: 5,
  minimumRedeemPoints: 50,
  pointValueCents: 100,
};

export async function getLoyaltySettings(db = prisma) {
  const existing = await db.loyaltySetting.findUnique({ where: { id: LOYALTY_SETTINGS_ID } });
  if (existing) return existing;
  return db.loyaltySetting.create({ data: DEFAULT_LOYALTY_SETTINGS });
}

export async function getLoyaltySnapshot(userId, db = prisma) {
  const [settings, user] = await Promise.all([
    getLoyaltySettings(db),
    db.user.findUnique({ where: { id: userId }, select: { pointsBalance: true } }),
  ]);
  return {
    ...settings,
    pointsBalance: user?.pointsBalance || 0,
  };
}

export async function awardDeliveredOrderPoints(db, order) {
  if (order.pointsAwardedAt) return { awarded: 0, balance: null };
  const settings = await getLoyaltySettings(db);
  if (!settings.enabled || settings.pointsPerOrder <= 0) return { awarded: 0, balance: null };

  const existing = await db.loyaltyTransaction.findUnique({
    where: { orderId_type: { orderId: order.id, type: 'EARN' } },
  });
  if (existing) return { awarded: 0, balance: existing.balanceAfter };

  const user = await db.user.update({
    where: { id: order.userId },
    data: { pointsBalance: { increment: settings.pointsPerOrder } },
    select: { pointsBalance: true },
  });
  const now = new Date();
  await db.order.update({
    where: { id: order.id },
    data: { pointsEarned: settings.pointsPerOrder, pointsAwardedAt: now },
  });
  await db.loyaltyTransaction.create({
    data: {
      userId: order.userId,
      orderId: order.id,
      type: 'EARN',
      points: settings.pointsPerOrder,
      balanceAfter: user.pointsBalance,
      note: `Points earned for delivered order ${order.orderNumber}`,
    },
  });
  return { awarded: settings.pointsPerOrder, balance: user.pointsBalance };
}

export async function restoreCancelledOrderPoints(db, order) {
  if (!order.pointsRedeemed || order.pointsRedeemed <= 0 || order.pointsRestoredAt) return { restored: 0, balance: null };
  const existing = await db.loyaltyTransaction.findUnique({
    where: { orderId_type: { orderId: order.id, type: 'RESTORE' } },
  });
  if (existing) return { restored: 0, balance: existing.balanceAfter };

  const user = await db.user.update({
    where: { id: order.userId },
    data: { pointsBalance: { increment: order.pointsRedeemed } },
    select: { pointsBalance: true },
  });
  await db.order.update({ where: { id: order.id }, data: { pointsRestoredAt: new Date() } });
  await db.loyaltyTransaction.create({
    data: {
      userId: order.userId,
      orderId: order.id,
      type: 'RESTORE',
      points: order.pointsRedeemed,
      balanceAfter: user.pointsBalance,
      note: `Points restored after order ${order.orderNumber} was cancelled`,
    },
  });
  return { restored: order.pointsRedeemed, balance: user.pointsBalance };
}
