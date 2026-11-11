import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { getStoreAvailability, minuteToDisplay, minuteToTime, timeToMinute } from './store-availability.js';

const TYPES = ['DELIVERY', 'PICKUP'];
const MODES = ['ASAP', 'SCHEDULED'];
const DEFAULTS = {
  id: 'default',
  deliveryEnabled: true,
  pickupEnabled: true,
  asapEnabled: true,
  scheduledEnabled: true,
  deliveryLeadMinutes: 30,
  pickupLeadMinutes: 15,
  slotIntervalMinutes: 30,
  daysAhead: 7,
  defaultSlotCapacity: 10,
  pickupAddress: null,
  pickupInstructions: 'Please show your order number at the restaurant counter.',
};

const pad = value => String(value).padStart(2, '0');

export function isFulfillmentType(value) { return TYPES.includes(value); }
export function isFulfillmentMode(value) { return MODES.includes(value); }
export function isScheduledLocalKey(value) {
  return /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(value || '');
}

function addDateKey(dateKey, offset) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset, 12));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function weekdayForDateKey(dateKey) {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

function abstractMinute(dateKey, minute) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 60000) + minute;
}

function getSegmentsForDate(dateKey, hoursByDay, closureDates) {
  if (closureDates.has(dateKey)) return [];
  const day = weekdayForDateKey(dateKey);
  const today = hoursByDay.get(day);
  const previousDate = addDateKey(dateKey, -1);
  const previous = hoursByDay.get((day + 6) % 7);
  const segments = [];

  if (previous && !closureDates.has(previousDate) && !previous.isClosed && !previous.open24Hours && previous.openMinute > previous.closeMinute && previous.closeMinute > 0) {
    segments.push([0, previous.closeMinute]);
  }
  if (today && !today.isClosed) {
    if (today.open24Hours) segments.push([0, 1440]);
    else if (today.openMinute < today.closeMinute) segments.push([today.openMinute, today.closeMinute]);
    else if (today.openMinute > today.closeMinute) segments.push([today.openMinute, 1440]);
  }
  return segments;
}

function slotsForSegments(segments, interval) {
  const values = new Set();
  for (const [start, end] of segments) {
    for (let minute = start; minute < end; minute += interval) values.add(minute);
  }
  return [...values].sort((a, b) => a - b);
}

function serializeSettings(settings) {
  return {
    id: settings.id,
    deliveryEnabled: settings.deliveryEnabled,
    pickupEnabled: settings.pickupEnabled,
    asapEnabled: settings.asapEnabled,
    scheduledEnabled: settings.scheduledEnabled,
    deliveryLeadMinutes: settings.deliveryLeadMinutes,
    pickupLeadMinutes: settings.pickupLeadMinutes,
    slotIntervalMinutes: settings.slotIntervalMinutes,
    daysAhead: settings.daysAhead,
    defaultSlotCapacity: settings.defaultSlotCapacity,
    pickupAddress: settings.pickupAddress || null,
    pickupInstructions: settings.pickupInstructions || null,
    updatedAt: settings.updatedAt,
  };
}

export async function ensureFulfillmentDefaults(db = prisma) {
  return db.fulfillmentSetting.upsert({
    where: { id: 'default' },
    update: {},
    create: DEFAULTS,
  });
}

export async function getFulfillmentAdminConfig(db = prisma, now = new Date()) {
  const settings = await ensureFulfillmentDefaults(db);
  const [overrides, preview] = await Promise.all([
    db.fulfillmentSlotOverride.findMany({ orderBy: [{ dateKey: 'asc' }, { timeKey: 'asc' }, { fulfillmentType: 'asc' }], take: 250 }),
    getFulfillmentOptions(db, now),
  ]);
  return { settings: serializeSettings(settings), overrides, preview };
}

export async function getFulfillmentOptions(db = prisma, now = new Date()) {
  const settings = await ensureFulfillmentDefaults(db);
  const store = await getStoreAvailability(db, now);
  const endDate = addDateKey(store.localDate, Math.max(1, settings.daysAhead) - 1);
  const [hours, closures, overrides, existingOrders, restaurantSettings] = await Promise.all([
    db.openingHour.findMany({ orderBy: { dayOfWeek: 'asc' } }),
    db.restaurantClosure.findMany({ where: { dateKey: { gte: addDateKey(store.localDate, -1), lte: endDate } } }),
    db.fulfillmentSlotOverride.findMany({ where: { dateKey: { gte: store.localDate, lte: endDate } } }),
    db.order.findMany({
      where: {
        fulfillmentMode: 'SCHEDULED',
        scheduledDateKey: { gte: store.localDate, lte: endDate },
        status: { not: 'CANCELLED' },
      },
      select: { fulfillmentType: true, scheduledDateKey: true, scheduledTimeKey: true },
    }),
    db.restaurantSetting.findUnique({ where: { id: 'default' } }),
  ]);

  const hoursByDay = new Map(hours.map(hour => [hour.dayOfWeek, hour]));
  const closureDates = new Set(closures.map(item => item.dateKey));
  const overrideMap = new Map(overrides.map(item => [`${item.fulfillmentType}|${item.dateKey}|${item.timeKey}`, item]));
  const bookedMap = new Map();
  for (const order of existingOrders) {
    const key = `${order.fulfillmentType}|${order.scheduledDateKey}|${order.scheduledTimeKey}`;
    bookedMap.set(key, (bookedMap.get(key) || 0) + 1);
  }

  const currentMinute = timeToMinute(store.localTime);
  const currentAbstract = abstractMinute(store.localDate, currentMinute);
  const temporaryUntil = restaurantSettings?.temporaryClosedUntilLocal || null;
  const indefiniteTemporaryClosure = Boolean(restaurantSettings?.temporaryClosed && !temporaryUntil);
  const acceptingOrders = restaurantSettings?.acceptingOrders !== false;

  const options = {};
  for (const type of TYPES) {
    const enabled = type === 'DELIVERY' ? settings.deliveryEnabled : settings.pickupEnabled;
    const leadMinutes = type === 'DELIVERY' ? settings.deliveryLeadMinutes : settings.pickupLeadMinutes;
    const slots = [];

    if (enabled && settings.scheduledEnabled && acceptingOrders && !indefiniteTemporaryClosure) {
      for (let offset = 0; offset < settings.daysAhead; offset += 1) {
        const dateKey = addDateKey(store.localDate, offset);
        const segments = getSegmentsForDate(dateKey, hoursByDay, closureDates);
        for (const minute of slotsForSegments(segments, settings.slotIntervalMinutes)) {
          const timeKey = minuteToTime(minute);
          const localKey = `${dateKey}T${timeKey}`;
          if (abstractMinute(dateKey, minute) - currentAbstract < leadMinutes) continue;
          if (restaurantSettings?.temporaryClosed && temporaryUntil && localKey < temporaryUntil) continue;

          const key = `${type}|${dateKey}|${timeKey}`;
          const override = overrideMap.get(key);
          const capacity = override?.capacity ?? settings.defaultSlotCapacity;
          const booked = bookedMap.get(key) || 0;
          const disabled = Boolean(override?.disabled);
          const remaining = Math.max(0, capacity - booked);
          if (disabled || remaining <= 0) continue;
          slots.push({
            dateKey,
            timeKey,
            localKey,
            displayTime: minuteToDisplay(minute),
            capacity,
            booked,
            remaining,
            note: override?.note || null,
          });
        }
      }
    }

    options[type] = {
      enabled,
      leadMinutes,
      asapAvailable: Boolean(enabled && settings.asapEnabled && store.isOpen),
      asapEtaMinutes: leadMinutes,
      scheduledEnabled: Boolean(enabled && settings.scheduledEnabled),
      slots,
    };
  }

  return {
    settings: serializeSettings(settings),
    store,
    options,
    timezone: store.timezone,
  };
}

export async function resolveFulfillmentSelection(db, values, now = new Date()) {
  const type = values.fulfillmentType || 'DELIVERY';
  const mode = values.fulfillmentMode || 'ASAP';
  if (!isFulfillmentType(type)) throw new AppError(400, 'INVALID_FULFILLMENT_TYPE', 'Choose delivery or pickup');
  if (!isFulfillmentMode(mode)) throw new AppError(400, 'INVALID_FULFILLMENT_MODE', 'Choose ASAP or a scheduled time');

  const result = await getFulfillmentOptions(db, now);
  const option = result.options[type];
  if (!option?.enabled) throw new AppError(409, 'FULFILLMENT_UNAVAILABLE', `${type === 'PICKUP' ? 'Pickup' : 'Delivery'} is currently unavailable`);

  if (mode === 'ASAP') {
    if (!result.settings.asapEnabled || !option.asapAvailable) {
      throw new AppError(409, 'ASAP_UNAVAILABLE', result.store.message || 'ASAP ordering is unavailable right now', { storeStatus: result.store });
    }
    return {
      fulfillmentType: type,
      fulfillmentMode: 'ASAP',
      scheduledForLocal: null,
      scheduledDateKey: null,
      scheduledTimeKey: null,
      schedulingTimezone: result.timezone,
      estimatedMinutes: option.asapEtaMinutes,
      pickupAddressSnapshot: type === 'PICKUP' ? result.settings.pickupAddress : null,
      pickupInstructionsSnapshot: type === 'PICKUP' ? result.settings.pickupInstructions : null,
    };
  }

  const scheduledForLocal = values.scheduledForLocal;
  if (!result.settings.scheduledEnabled) throw new AppError(409, 'SCHEDULING_DISABLED', 'Scheduled orders are currently unavailable');
  if (!isScheduledLocalKey(scheduledForLocal)) throw new AppError(400, 'INVALID_SCHEDULED_TIME', 'Choose an available date and time');
  const slot = option.slots.find(item => item.localKey === scheduledForLocal);
  if (!slot) throw new AppError(409, 'SLOT_UNAVAILABLE', 'That time slot is no longer available. Please choose another time');

  return {
    fulfillmentType: type,
    fulfillmentMode: 'SCHEDULED',
    scheduledForLocal,
    scheduledDateKey: slot.dateKey,
    scheduledTimeKey: slot.timeKey,
    schedulingTimezone: result.timezone,
    slot,
    pickupAddressSnapshot: type === 'PICKUP' ? result.settings.pickupAddress : null,
    pickupInstructionsSnapshot: type === 'PICKUP' ? result.settings.pickupInstructions : null,
  };
}
