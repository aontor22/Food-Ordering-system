import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { config } from '../config.js';

const splitPostalCodes = value => String(value || '')
  .split(',')
  .map(item => item.trim().toUpperCase())
  .filter(Boolean);

export function normalizePostalCodes(value) {
  return [...new Set(splitPostalCodes(value))].join(',');
}

export function serializeDeliveryZone(zone) {
  return {
    id: zone.id,
    name: zone.name,
    description: zone.description || null,
    postalCodes: splitPostalCodes(zone.postalCodes),
    feeCents: zone.feeCents,
    minimumOrderCents: zone.minimumOrderCents,
    freeDeliveryThresholdCents: zone.freeDeliveryThresholdCents,
    active: zone.active,
    sortOrder: zone.sortOrder,
    currency: config.PAYMENT_CURRENCY,
  };
}

export async function ensureDefaultDeliveryZone(db = prisma) {
  const count = await db.deliveryZone.count();
  if (count) return;
  await db.deliveryZone.create({
    data: {
      id: 'default-delivery-zone',
      name: 'Standard delivery',
      description: 'Default delivery area. Configure your real delivery zones from the admin panel.',
      feeCents: config.DELIVERY_FEE_CENTS,
      minimumOrderCents: 0,
      freeDeliveryThresholdCents: null,
      active: true,
      sortOrder: 0,
    },
  });
}

export async function listActiveDeliveryZones(db = prisma) {
  await ensureDefaultDeliveryZone(db);
  const zones = await db.deliveryZone.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  return zones.map(serializeDeliveryZone);
}

export async function listAllDeliveryZones(db = prisma) {
  await ensureDefaultDeliveryZone(db);
  const zones = await db.deliveryZone.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  return zones.map(serializeDeliveryZone);
}

function postalMatches(zone, postalCode) {
  const allowed = splitPostalCodes(zone.postalCodes);
  if (!allowed.length) return true;
  const normalized = String(postalCode || '').trim().toUpperCase();
  if (!normalized) return null;
  return allowed.includes(normalized);
}

export async function resolveDeliveryZone(db, { deliveryZoneId, postalCode, requireZone = true } = {}) {
  await ensureDefaultDeliveryZone(db);
  const zones = await db.deliveryZone.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  if (!zones.length) throw new AppError(409, 'DELIVERY_UNAVAILABLE', 'Delivery is not configured right now');

  const mappedMatches = postalCode
    ? zones.filter(item => splitPostalCodes(item.postalCodes).length && postalMatches(item, postalCode) === true)
    : [];
  if (mappedMatches.length > 1) throw new AppError(503, 'DELIVERY_ZONE_CONFIGURATION_CONFLICT', 'Delivery zones have overlapping postal-code coverage');

  let zone = deliveryZoneId ? zones.find(item => item.id === deliveryZoneId) : null;
  if (deliveryZoneId && !zone) throw new AppError(409, 'DELIVERY_ZONE_UNAVAILABLE', 'The selected delivery area is no longer available');
  if (!zone && mappedMatches.length === 1) zone = mappedMatches[0];
  if (zone && mappedMatches.length === 1 && mappedMatches[0].id !== zone.id && !splitPostalCodes(zone.postalCodes).length) {
    throw new AppError(409, 'DELIVERY_ZONE_MISMATCH', `This postal code belongs to ${mappedMatches[0].name}. Please use that delivery area.`);
  }
  if (!zone && zones.length === 1) zone = zones[0];
  if (!zone && requireZone) throw new AppError(400, 'DELIVERY_ZONE_REQUIRED', 'Select your delivery area before placing the order');
  if (!zone) return null;
  const postalMatch = postalMatches(zone, postalCode);
  if (postalMatch === false) {
    throw new AppError(400, 'POSTAL_CODE_OUTSIDE_ZONE', `Postal code ${postalCode || ''} is not covered by ${zone.name}`);
  }
  return zone;
}

export async function findDeliveryPostalOverlap(db, postalCodes, excludeId = null) {
  const wanted = new Set(splitPostalCodes(Array.isArray(postalCodes) ? postalCodes.join(',') : postalCodes));
  if (!wanted.size) return null;
  const zones = await db.deliveryZone.findMany({
    where: { active: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  for (const zone of zones) {
    const overlap = splitPostalCodes(zone.postalCodes).find(code => wanted.has(code));
    if (overlap) return { zone, postalCode: overlap };
  }
  return null;
}

export function calculateZoneDelivery(zone, subtotalCents) {
  const subtotal = Math.max(0, Number(subtotalCents) || 0);
  const minimumOrderCents = Math.max(0, Number(zone.minimumOrderCents) || 0);
  const freeThreshold = zone.freeDeliveryThresholdCents == null ? null : Math.max(0, Number(zone.freeDeliveryThresholdCents) || 0);
  const minimumOrderMet = subtotal >= minimumOrderCents;
  const minimumOrderRemainingCents = Math.max(0, minimumOrderCents - subtotal);
  const freeDelivery = freeThreshold != null && freeThreshold > 0 && subtotal >= freeThreshold;
  const feeCents = subtotal > 0 && !freeDelivery ? Math.max(0, Number(zone.feeCents) || 0) : 0;
  const freeDeliveryRemainingCents = freeThreshold && !freeDelivery ? Math.max(0, freeThreshold - subtotal) : 0;
  return {
    feeCents,
    minimumOrderCents,
    minimumOrderMet,
    minimumOrderRemainingCents,
    freeDeliveryThresholdCents: freeThreshold,
    freeDelivery,
    freeDeliveryRemainingCents,
  };
}
