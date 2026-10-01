import { prisma } from '../lib/prisma.js';
export { cancellationPolicy, localKeyToDate, refundReconciliation } from './cancellation-policy-core.js';

export async function getCancellationSettings(db=prisma) {
  const row=await db.restaurantSetting.findUnique({ where:{ id:'default' }, select:{ customerCancelWindowMinutes:true, scheduledCancelLeadMinutes:true, timezone:true } });
  return { customerCancelWindowMinutes:10, scheduledCancelLeadMinutes:60, timezone:'Asia/Dhaka', ...(row || {}) };
}
