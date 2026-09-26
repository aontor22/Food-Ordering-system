import 'dotenv/config';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PrismaClient } from '@prisma/client';

const source = process.env.SQLITE_DATABASE_PATH || process.argv[2];
if (!source) {
  console.error('Usage: SQLITE_DATABASE_PATH=/absolute/path/to/dev.db npm run db:import:sqlite');
  console.error('You can also pass the path as the first argument after `--`.');
  process.exit(1);
}

const sqlitePath = path.resolve(source);
if (!existsSync(sqlitePath)) {
  throw new Error(`SQLite source database not found: ${sqlitePath}`);
}
if (!/^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL || '')) {
  throw new Error('DATABASE_URL must point to the destination PostgreSQL database.');
}

const db = new DatabaseSync(sqlitePath, { readOnly: true });
const prisma = new PrismaClient();

const specs = [
  ['user', 'User', ['id','name','email','passwordHash','googleSub','avatarUrl','role','isActive','pointsBalance','createdAt','updatedAt'], ['isActive'], ['createdAt','updatedAt']],
  ['product', 'Product', ['id','name','description','category','imageUrl','imagePublicId','priceCents','stock','isAvailable','createdAt','updatedAt'], ['isAvailable'], ['createdAt','updatedAt']],
  ['coupon', 'Coupon', ['id','code','percentOff','minimumCents','active','expiresAt','createdAt'], ['active'], ['expiresAt','createdAt']],
  ['loyaltySetting', 'LoyaltySetting', ['id','enabled','pointsPerOrder','minimumRedeemPoints','pointValueCents','updatedAt'], ['enabled'], ['updatedAt']],
  ['session', 'Session', ['id','tokenHash','userAgent','ipAddress','expiresAt','revokedAt','replacedById','createdAt','userId'], [], ['expiresAt','revokedAt','createdAt']],
  ['order', 'Order', ['id','orderNumber','status','paymentMethod','paymentStatus','subtotalCents','discountCents','pointsRedeemed','pointsDiscountCents','pointsEarned','pointsAwardedAt','pointsRestoredAt','deliveryFeeCents','deliveryZoneId','deliveryZoneName','fulfillmentType','fulfillmentMode','scheduledForLocal','scheduledDateKey','scheduledTimeKey','schedulingTimezone','pickupAddressSnapshot','pickupInstructionsSnapshot','totalCents','couponCode','firstName','lastName','email','phone','street','city','state','postalCode','country','notes','createdAt','updatedAt','userId'], [], ['pointsAwardedAt','pointsRestoredAt','createdAt','updatedAt']],
  ['payment', 'Payment', ['id','transactionId','provider','status','amountCents','currency','gatewaySessionId','gatewayTransactionId','validationId','gatewayRiskLevel','gatewayRiskTitle','gatewayCardType','gatewayCardIssuer','lastGatewayCheckAt','failureReason','refundStatus','refundReferenceId','refundTransactionId','refundAmountCents','refundReason','refundRequestedAt','refundedAt','manualDestination','attempts','lastAttemptAt','paidAt','createdAt','updatedAt','orderId'], [], ['lastGatewayCheckAt','refundRequestedAt','refundedAt','lastAttemptAt','paidAt','createdAt','updatedAt']],
  ['manualPaymentChannel', 'ManualPaymentChannel', ['id','provider','label','account','instructions','active','createdAt','updatedAt'], ['active'], ['createdAt','updatedAt']],
  ['orderItem', 'OrderItem', ['id','productName','unitPriceCents','quantity','lineTotalCents','orderId','productId'], [], []],
  ['manualPaymentSubmission', 'ManualPaymentSubmission', ['id','reference','referenceKey','sender','note','amountCents','currency','status','reviewNote','reviewedBy','reviewedAt','createdAt','paymentId'], [], ['reviewedAt','createdAt']],
  ['review', 'Review', ['id','rating','comment','status','createdAt','updatedAt','userId','productId','orderId','orderItemId'], [], ['createdAt','updatedAt']],
  ['loyaltyTransaction', 'LoyaltyTransaction', ['id','type','points','balanceAfter','note','createdAt','userId','orderId'], [], ['createdAt']],
  ['wishlistItem', 'WishlistItem', ['id','createdAt','userId','productId'], [], ['createdAt']],
  ['restaurantSetting', 'RestaurantSetting', ['id','timezone','acceptingOrders','temporaryClosed','temporaryClosedReason','temporaryClosedUntilLocal','updatedAt'], ['acceptingOrders','temporaryClosed'], ['updatedAt']],
  ['openingHour', 'OpeningHour', ['id','dayOfWeek','isClosed','open24Hours','openMinute','closeMinute','updatedAt'], ['isClosed','open24Hours'], ['updatedAt']],
  ['restaurantClosure', 'RestaurantClosure', ['id','dateKey','reason','createdAt','updatedAt'], [], ['createdAt','updatedAt']],
  ['deliveryZone', 'DeliveryZone', ['id','name','description','postalCodes','feeCents','minimumOrderCents','freeDeliveryThresholdCents','active','sortOrder','createdAt','updatedAt'], ['active'], ['createdAt','updatedAt']],
  ['fulfillmentSetting', 'FulfillmentSetting', ['id','deliveryEnabled','pickupEnabled','asapEnabled','scheduledEnabled','deliveryLeadMinutes','pickupLeadMinutes','slotIntervalMinutes','daysAhead','defaultSlotCapacity','pickupAddress','pickupInstructions','updatedAt'], ['deliveryEnabled','pickupEnabled','asapEnabled','scheduledEnabled'], ['updatedAt']],
  ['fulfillmentSlotOverride', 'FulfillmentSlotOverride', ['id','dateKey','timeKey','fulfillmentType','capacity','disabled','note','createdAt','updatedAt'], ['disabled'], ['createdAt','updatedAt']],
  ['auditLog', 'AuditLog', ['id','action','entity','entityId','metadata','ipAddress','createdAt','actorId'], [], ['createdAt']]
];

function tableExists(table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function normalize(row, fields, booleans, dates) {
  const result = {};
  for (const field of fields) {
    if (!(field in row)) continue;
    let value = row[field];
    if (booleans.includes(field) && value !== null) value = Boolean(value);
    if (dates.includes(field) && value !== null) {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date in ${field}: ${value}`);
      value = parsed;
    }
    result[field] = value;
  }
  return result;
}

async function insertChunks(modelName, data) {
  if (!data.length) return 0;
  if (modelName === 'loyaltySetting') {
    let count = 0;
    for (const row of data) {
      const { id, ...update } = row;
      await prisma.loyaltySetting.upsert({ where: { id }, create: row, update });
      count += 1;
    }
    return count;
  }
  const chunkSize = 250;
  let inserted = 0;
  for (let i = 0; i < data.length; i += chunkSize) {
    const batch = data.slice(i, i + chunkSize);
    const result = await prisma[modelName].createMany({ data: batch, skipDuplicates: true });
    inserted += result.count;
  }
  return inserted;
}

try {
  await prisma.$connect();
  const populated = {
    users: await prisma.user.count(),
    products: await prisma.product.count(),
    orders: await prisma.order.count(),
    payments: await prisma.payment.count()
  };
  if (Object.values(populated).some(Boolean) && process.env.ALLOW_NONEMPTY_SQLITE_IMPORT !== 'true') {
    throw new Error(`Destination PostgreSQL database is not empty (${JSON.stringify(populated)}). Import into a freshly migrated database, or set ALLOW_NONEMPTY_SQLITE_IMPORT=true only if you intentionally want a merge.`);
  }
  console.log(`Importing legacy SQLite data from ${sqlitePath}`);
  for (const [modelName, table, fields, booleans, dates] of specs) {
    if (!tableExists(table)) {
      console.log(`- ${table}: not present in legacy database, skipped`);
      continue;
    }
    const rows = db.prepare(`SELECT * FROM "${table}"`).all();
    const data = rows.map(row => normalize(row, fields, booleans, dates));
    const inserted = await insertChunks(modelName, data);
    console.log(`- ${table}: ${inserted}/${data.length} row(s) imported`);
  }
  console.log('SQLite → PostgreSQL import complete. Run `npm run db:seed` next to add any missing defaults/admin account.');
} finally {
  db.close();
  await prisma.$disconnect();
}
