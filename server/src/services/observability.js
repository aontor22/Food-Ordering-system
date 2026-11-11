import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import { operationalStatus, sanitizeMonitoringMetadata, serializeOperationalError } from './observability-core.js';

function safeJson(value) {
  try { return JSON.stringify(sanitizeMonitoringMetadata(value)); }
  catch { return JSON.stringify({ serialization: 'failed' }); }
}

export function structuredLog(level, message, fields = {}) {
  const payload = {
    level: String(level || 'INFO').toUpperCase(),
    message,
    timestamp: new Date().toISOString(),
    ...sanitizeMonitoringMetadata(fields),
  };
  const line = JSON.stringify(payload);
  if (payload.level === 'ERROR' || payload.level === 'FATAL') console.error(line);
  else if (payload.level === 'WARN') console.warn(line);
  else console.log(line);
}

export async function recordOperationalEvent(event) {
  const data = {
    level: String(event.level || 'ERROR').toUpperCase(),
    source: String(event.source || 'APPLICATION').slice(0, 80),
    code: String(event.code || 'UNEXPECTED_ERROR').slice(0, 120),
    message: String(event.message || 'Operational event').slice(0, 1000),
    requestId: event.requestId ? String(event.requestId).slice(0, 100) : null,
    route: event.route ? String(event.route).slice(0, 300) : null,
    method: event.method ? String(event.method).slice(0, 12) : null,
    statusCode: Number.isInteger(event.statusCode) ? event.statusCode : null,
    durationMs: Number.isInteger(event.durationMs) ? event.durationMs : null,
    metadataJson: event.metadata ? safeJson(event.metadata) : null,
  };
  structuredLog(data.level, data.message, { source: data.source, code: data.code, requestId: data.requestId, route: data.route, method: data.method, statusCode: data.statusCode, durationMs: data.durationMs, ...(event.metadata ? { metadata: event.metadata } : {}) });
  try { return await prisma.operationalEvent.create({ data }); }
  catch (error) {
    structuredLog('ERROR', 'Failed to persist operational event', { source: 'OBSERVABILITY', code: 'OPERATIONAL_EVENT_PERSIST_FAILED', originalCode: data.code, error: serializeOperationalError(error) });
    return null;
  }
}

export function captureOperationalError(error, context = {}) {
  const serialized = serializeOperationalError(error);
  return recordOperationalEvent({
    level: context.level || 'ERROR',
    source: context.source || 'APPLICATION',
    code: context.code || serialized.code || 'UNEXPECTED_ERROR',
    message: context.message || serialized.message || 'Unexpected application error',
    requestId: context.requestId,
    route: context.route,
    method: context.method,
    statusCode: context.statusCode,
    durationMs: context.durationMs,
    metadata: { ...(context.metadata || {}), error: serialized },
  });
}

export function requestObservationMiddleware(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path.startsWith('/api/health')) return;
    const durationMs = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
    if (durationMs < config.MONITORING_SLOW_REQUEST_MS) return;
    void recordOperationalEvent({
      level: 'WARN', source: 'HTTP', code: 'SLOW_REQUEST', message: `Slow request ${req.method} ${req.path}`,
      requestId: req.id, route: req.path, method: req.method, statusCode: res.statusCode, durationMs,
      metadata: { thresholdMs: config.MONITORING_SLOW_REQUEST_MS },
    });
  });
  next();
}

export function livenessSnapshot() {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  };
}

export async function readinessSnapshot() {
  const started = process.hrtime.bigint();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
    return { ready: true, status: 'ready', timestamp: new Date().toISOString(), checks: { database: { status: 'ok', latencyMs } } };
  } catch (error) {
    const latencyMs = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
    void captureOperationalError(error, { source: 'HEALTH', code: 'DATABASE_READINESS_FAILED', message: 'Database readiness check failed', durationMs: latencyMs });
    return { ready: false, status: 'not_ready', timestamp: new Date().toISOString(), checks: { database: { status: 'error', latencyMs } } };
  }
}

function rowsToCountMap(rows = []) {
  return Object.fromEntries(rows.map(row => [row.status || row.level || row.source, row._count?._all || 0]));
}

export async function monitoringSnapshot() {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const staleBefore = new Date(now.getTime() - 10 * 60 * 1000);
  const dbStarted = process.hrtime.bigint();
  let database = { status: 'ok', latencyMs: 0 };
  try {
    await prisma.$queryRaw`SELECT 1`;
    database.latencyMs = Math.round(Number(process.hrtime.bigint() - dbStarted) / 1e6);
  } catch (error) {
    database = { status: 'error', latencyMs: Math.round(Number(process.hrtime.bigint() - dbStarted) / 1e6) };
  }

  const [eventsByLevel, eventsBySource, recentEvents, recentErrorCount, notificationByStatus, staleNotifications, oldestPending, activeOrders, recentPayments] = await Promise.all([
    prisma.operationalEvent.groupBy({ by: ['level'], where: { createdAt: { gte: dayAgo } }, _count: { _all: true } }),
    prisma.operationalEvent.groupBy({ by: ['source'], where: { createdAt: { gte: dayAgo } }, _count: { _all: true } }),
    prisma.operationalEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 60 }),
    prisma.operationalEvent.count({ where: { level: { in: ['ERROR', 'FATAL'] }, createdAt: { gte: hourAgo } } }),
    prisma.notificationDelivery.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.notificationDelivery.count({ where: { status: { in: ['PENDING', 'RETRY', 'SENDING'] }, updatedAt: { lt: staleBefore } } }),
    prisma.notificationDelivery.findFirst({ where: { status: { in: ['PENDING', 'RETRY', 'SENDING'] } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    prisma.order.count({ where: { status: { in: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'] } } }),
    prisma.payment.count({ where: { updatedAt: { gte: dayAgo }, status: { in: ['FAILED', 'REFUND_PENDING'] } } }),
  ]);

  const notifications = rowsToCountMap(notificationByStatus);
  const failedNotifications = notifications.FAILED || 0;
  const status = operationalStatus({ databaseOk: database.status === 'ok', recentErrors: recentErrorCount, failedNotifications, staleNotifications });
  const memory = process.memoryUsage();

  return {
    status,
    generatedAt: now.toISOString(),
    process: {
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      environment: config.NODE_ENV,
      memoryMb: {
        rss: Math.round(memory.rss / 1024 / 1024),
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
      },
    },
    database,
    integrations: {
      smtp: Boolean(config.SMTP_HOST && config.EMAIL_FROM),
      webPush: Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY),
      cloudinary: Boolean(config.CLOUDINARY_CLOUD_NAME && config.CLOUDINARY_API_KEY && config.CLOUDINARY_API_SECRET),
      sslcommerz: Boolean(config.SSLCOMMERZ_STORE_ID && config.SSLCOMMERZ_STORE_PASSWORD),
      sslcommerzLive: config.SSLCOMMERZ_LIVE,
      authEncryption: Boolean(config.AUTH_ENCRYPTION_KEY),
    },
    operations: {
      activeOrders,
      paymentIssues24h: recentPayments,
      notificationQueue: {
        ...notifications,
        stale: staleNotifications,
        oldestPendingAt: oldestPending?.createdAt || null,
      },
      events24h: {
        byLevel: rowsToCountMap(eventsByLevel),
        bySource: rowsToCountMap(eventsBySource),
        recentErrors1h: recentErrorCount,
      },
    },
    recentEvents: recentEvents.map(event => ({ ...event, metadata: event.metadataJson ? safeParseJson(event.metadataJson) : null, metadataJson: undefined })),
  };
}

function safeParseJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

let maintenanceTimer = null;
export function startObservabilityMaintenance({ intervalMs = 6 * 60 * 60 * 1000 } = {}) {
  if (maintenanceTimer) return () => {};
  const clean = async () => {
    const before = new Date(Date.now() - config.MONITORING_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    try {
      const result = await prisma.operationalEvent.deleteMany({ where: { createdAt: { lt: before } } });
      if (result.count) structuredLog('INFO', 'Operational event retention cleanup completed', { source: 'OBSERVABILITY', code: 'RETENTION_CLEANUP', deleted: result.count, retentionDays: config.MONITORING_RETENTION_DAYS });
    } catch (error) {
      structuredLog('ERROR', 'Operational event retention cleanup failed', { source: 'OBSERVABILITY', code: 'RETENTION_CLEANUP_FAILED', error: serializeOperationalError(error) });
    }
  };
  setTimeout(clean, 5000).unref?.();
  maintenanceTimer = setInterval(clean, intervalMs);
  maintenanceTimer.unref?.();
  return () => { clearInterval(maintenanceTimer); maintenanceTimer = null; };
}
