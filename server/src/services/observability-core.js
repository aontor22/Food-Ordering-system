import crypto from 'node:crypto';

const SENSITIVE_KEY = /(authorization|cookie|token|secret|password|passcode|otp|totp|email|phone|address|street|sender|account|card|credential|key)/i;

export function normalizeRequestId(value) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate === 'string' && /^[A-Za-z0-9._:-]{8,100}$/.test(candidate)) return candidate;
  return crypto.randomUUID();
}

function sanitizeValue(value, depth = 0) {
  if (depth > 3) return '[TRUNCATED]';
  if (value == null || ['boolean', 'number'].includes(typeof value)) return value;
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, 30)) {
      output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeValue(item, depth + 1);
    }
    return output;
  }
  return String(value);
}

export function sanitizeMonitoringMetadata(value) {
  return sanitizeValue(value || {});
}

export function serializeOperationalError(error) {
  if (!error) return { name: 'Error', message: 'Unknown error' };
  const stack = typeof error.stack === 'string' ? error.stack.split('\n').slice(0, 12).join('\n') : undefined;
  return sanitizeMonitoringMetadata({
    name: error.name || 'Error',
    message: error.message || String(error),
    code: error.code,
    stack,
  });
}

export function operationalStatus({ databaseOk = true, recentErrors = 0, failedNotifications = 0, staleNotifications = 0 } = {}) {
  if (!databaseOk) return 'critical';
  if (recentErrors > 0 || failedNotifications > 0 || staleNotifications > 0) return 'degraded';
  return 'healthy';
}

export function levelForStatusCode(statusCode) {
  if (statusCode >= 500) return 'ERROR';
  if (statusCode >= 400) return 'WARN';
  return 'INFO';
}
