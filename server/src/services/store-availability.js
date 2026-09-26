import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DEFAULT_TIMEZONE = 'Asia/Dhaka';

export const DEFAULT_HOURS = DAY_NAMES.map((_, dayOfWeek) => ({
  dayOfWeek,
  isClosed: false,
  open24Hours: true,
  openMinute: 0,
  closeMinute: 0,
}));

const pad = value => String(value).padStart(2, '0');

export function isValidTimezone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function timeToMinute(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || '')) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function minuteToTime(value) {
  const safe = Math.max(0, Math.min(1439, Number(value) || 0));
  return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
}

export function minuteToDisplay(value) {
  const safe = Math.max(0, Math.min(1439, Number(value) || 0));
  const hour24 = Math.floor(safe / 60);
  const minute = safe % 60;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${pad(minute)} ${period}`;
}

export function isRealDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isLocalDateTimeKey(value) {
  if (!value) return true;
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return Boolean(match && isRealDateKey(match[1]));
}

function zonedParts(now, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const dateKey = `${values.year}-${values.month}-${values.day}`;
  const minute = Number(values.hour) * 60 + Number(values.minute);
  return { dateKey, minute, localKey: `${dateKey}T${pad(Math.floor(minute / 60))}:${pad(minute % 60)}` };
}

function addDateKey(dateKey, offset) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset, 12));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function weekdayForDateKey(dateKey) {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

function serializeHour(hour) {
  return {
    dayOfWeek: hour.dayOfWeek,
    dayName: DAY_NAMES[hour.dayOfWeek],
    isClosed: hour.isClosed,
    open24Hours: hour.open24Hours,
    openMinute: hour.openMinute,
    closeMinute: hour.closeMinute,
    openTime: minuteToTime(hour.openMinute),
    closeTime: minuteToTime(hour.closeMinute),
  };
}

function timeWindowForNow(hoursByDay, dayOfWeek, minute, previousDayClosed = false) {
  const today = hoursByDay.get(dayOfWeek);
  const previous = hoursByDay.get((dayOfWeek + 6) % 7);

  if (today && !today.isClosed) {
    if (today.open24Hours) return { open: true, closes: null, closesTomorrow: false };
    if (today.openMinute < today.closeMinute && minute >= today.openMinute && minute < today.closeMinute) {
      return { open: true, closes: today.closeMinute, closesTomorrow: false };
    }
    if (today.openMinute > today.closeMinute && minute >= today.openMinute) {
      return { open: true, closes: today.closeMinute, closesTomorrow: true };
    }
  }

  if (!previousDayClosed && previous && !previous.isClosed && !previous.open24Hours && previous.openMinute > previous.closeMinute && minute < previous.closeMinute) {
    return { open: true, closes: previous.closeMinute, closesTomorrow: false };
  }
  return { open: false };
}

function relativeDateLabel(currentDateKey, targetDateKey) {
  if (targetDateKey === currentDateKey) return 'today';
  if (targetDateKey === addDateKey(currentDateKey, 1)) return 'tomorrow';
  return DAY_NAMES[weekdayForDateKey(targetDateKey)];
}

function findNextOpening({ currentDateKey, currentMinute, hoursByDay, closuresByDate }) {
  for (let offset = 0; offset <= 14; offset += 1) {
    const dateKey = addDateKey(currentDateKey, offset);
    if (closuresByDate.has(dateKey)) continue;
    const hour = hoursByDay.get(weekdayForDateKey(dateKey));
    if (!hour || hour.isClosed) continue;

    if (hour.open24Hours) {
      if (offset === 0) continue;
      return { dateKey, time: '00:00', displayTime: '12:00 AM', label: `${relativeDateLabel(currentDateKey, dateKey)} at 12:00 AM` };
    }

    if (offset === 0 && currentMinute >= hour.openMinute) continue;
    const displayTime = minuteToDisplay(hour.openMinute);
    return { dateKey, time: minuteToTime(hour.openMinute), displayTime, label: `${relativeDateLabel(currentDateKey, dateKey)} at ${displayTime}` };
  }
  return null;
}

function defaultSettings() {
  return {
    id: 'default',
    timezone: DEFAULT_TIMEZONE,
    acceptingOrders: true,
    temporaryClosed: false,
    temporaryClosedReason: null,
    temporaryClosedUntilLocal: null,
  };
}

export async function ensureStoreOperationsDefaults(db = prisma) {
  const settings = await db.restaurantSetting.upsert({
    where: { id: 'default' },
    update: {},
    create: defaultSettings(),
  });
  for (const hour of DEFAULT_HOURS) {
    await db.openingHour.upsert({
      where: { dayOfWeek: hour.dayOfWeek },
      update: {},
      create: hour,
    });
  }
  return settings;
}

export async function getStoreAvailability(db = prisma, now = new Date()) {
  const [settingsRecord, hoursRecords] = await Promise.all([
    db.restaurantSetting.findUnique({ where: { id: 'default' } }),
    db.openingHour.findMany({ orderBy: { dayOfWeek: 'asc' } }),
  ]);

  const settings = settingsRecord || defaultSettings();
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : DEFAULT_TIMEZONE;
  const { dateKey, minute, localKey } = zonedParts(now, timezone);
  const closures = await db.restaurantClosure.findMany({
    where: { dateKey: { gte: addDateKey(dateKey, -1) } },
    orderBy: { dateKey: 'asc' },
    take: 180,
  });
  const hours = DEFAULT_HOURS.map(defaultHour => hoursRecords.find(hour => hour.dayOfWeek === defaultHour.dayOfWeek) || defaultHour);
  const hoursByDay = new Map(hours.map(hour => [hour.dayOfWeek, hour]));
  const closuresByDate = new Map(closures.map(closure => [closure.dateKey, closure]));
  const closure = closuresByDate.get(dateKey);
  const previousDayClosed = closuresByDate.has(addDateKey(dateKey, -1));
  const temporaryClosedEffective = Boolean(settings.temporaryClosed && (!settings.temporaryClosedUntilLocal || localKey < settings.temporaryClosedUntilLocal));
  const window = timeWindowForNow(hoursByDay, weekdayForDateKey(dateKey), minute, previousDayClosed);

  let isOpen = false;
  let code = 'CLOSED';
  let headline = 'Closed now';
  let message = 'Ordering is currently unavailable.';
  let nextOpening = null;

  if (!settings.acceptingOrders) {
    code = 'PAUSED';
    headline = 'Ordering paused';
    message = 'The restaurant has paused new orders for now.';
  } else if (temporaryClosedEffective) {
    code = 'TEMPORARY_CLOSED';
    headline = 'Temporarily closed';
    const reason = settings.temporaryClosedReason?.trim();
    if (settings.temporaryClosedUntilLocal) {
      const [untilDate, untilTime] = settings.temporaryClosedUntilLocal.split('T');
      const untilLabel = `${relativeDateLabel(dateKey, untilDate)} at ${minuteToDisplay(timeToMinute(untilTime))}`;
      message = `${reason ? `${reason} · ` : ''}Reopens ${untilLabel}.`;
    } else message = reason || 'The restaurant will reopen soon.';
  } else if (closure) {
    code = 'HOLIDAY_CLOSED';
    headline = 'Closed today';
    nextOpening = findNextOpening({ currentDateKey: dateKey, currentMinute: minute, hoursByDay, closuresByDate });
    message = `${closure.reason?.trim() || 'Special closure'}${nextOpening ? ` · Opens ${nextOpening.label}.` : ''}`;
  } else if (window.open) {
    isOpen = true;
    code = 'OPEN';
    headline = 'Open now';
    message = window.closes === null ? 'Accepting orders all day.' : `Accepting orders · Closes ${window.closesTomorrow ? 'tomorrow ' : ''}at ${minuteToDisplay(window.closes)}.`;
  } else {
    nextOpening = findNextOpening({ currentDateKey: dateKey, currentMinute: minute, hoursByDay, closuresByDate });
    message = nextOpening ? `Opens ${nextOpening.label}.` : 'No upcoming opening time is configured.';
  }

  return {
    isOpen,
    code,
    headline,
    message,
    timezone,
    localDate: dateKey,
    localTime: minuteToTime(minute),
    acceptingOrders: settings.acceptingOrders,
    temporaryClosed: temporaryClosedEffective,
    temporaryClosedReason: settings.temporaryClosedReason || null,
    temporaryClosedUntilLocal: settings.temporaryClosedUntilLocal || null,
    nextOpening,
    schedule: hours.map(serializeHour),
  };
}

export async function assertStoreAcceptingOrders(db = prisma, now = new Date()) {
  const status = await getStoreAvailability(db, now);
  if (!status.isOpen) throw new AppError(409, 'RESTAURANT_CLOSED', status.message, { storeStatus: status });
  return status;
}

export async function getStoreOperationsConfig(db = prisma, now = new Date()) {
  await ensureStoreOperationsDefaults(db);
  let [settings, hours, status] = await Promise.all([
    db.restaurantSetting.findUnique({ where: { id: 'default' } }),
    db.openingHour.findMany({ orderBy: { dayOfWeek: 'asc' } }),
    getStoreAvailability(db, now),
  ]);

  const currentLocalKey = `${status.localDate}T${status.localTime}`;
  if (settings.temporaryClosed && settings.temporaryClosedUntilLocal && currentLocalKey >= settings.temporaryClosedUntilLocal) {
    settings = await db.restaurantSetting.update({
      where: { id: 'default' },
      data: { temporaryClosed: false, temporaryClosedReason: null, temporaryClosedUntilLocal: null },
    });
    status = await getStoreAvailability(db, now);
  }

  const closures = await db.restaurantClosure.findMany({
    where: { dateKey: { gte: status.localDate } },
    orderBy: { dateKey: 'asc' },
    take: 180,
  });
  return {
    settings,
    hours: hours.map(serializeHour),
    closures,
    status,
  };
}

export async function saveStoreOperations(db, values) {
  const settings = await db.restaurantSetting.upsert({
    where: { id: 'default' },
    update: {
      timezone: values.timezone,
      acceptingOrders: values.acceptingOrders,
      temporaryClosed: values.temporaryClosed,
      temporaryClosedReason: values.temporaryClosed ? (values.temporaryClosedReason || null) : null,
      temporaryClosedUntilLocal: values.temporaryClosed ? (values.temporaryClosedUntilLocal || null) : null,
    },
    create: {
      id: 'default',
      timezone: values.timezone,
      acceptingOrders: values.acceptingOrders,
      temporaryClosed: values.temporaryClosed,
      temporaryClosedReason: values.temporaryClosed ? (values.temporaryClosedReason || null) : null,
      temporaryClosedUntilLocal: values.temporaryClosed ? (values.temporaryClosedUntilLocal || null) : null,
    },
  });

  for (const hour of values.hours) {
    await db.openingHour.upsert({
      where: { dayOfWeek: hour.dayOfWeek },
      update: {
        isClosed: hour.isClosed,
        open24Hours: hour.isClosed ? false : hour.open24Hours,
        openMinute: hour.openMinute,
        closeMinute: hour.closeMinute,
      },
      create: hour,
    });
  }
  return settings;
}
