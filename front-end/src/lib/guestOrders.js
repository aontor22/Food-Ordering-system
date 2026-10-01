const KEY = 'tomato_guest_order_access_v1';
const MAX_RECORDS = 20;

function safeParse() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function validRecord(record) {
  if (!record || typeof record.token !== 'string' || record.token.length < 20) return false;
  if (!record.expiresAt) return true;
  const expires = new Date(record.expiresAt).getTime();
  return Number.isFinite(expires) && expires > Date.now();
}

function write(records) {
  const cleaned = records.filter(validRecord).slice(0, MAX_RECORDS);
  localStorage.setItem(KEY, JSON.stringify(cleaned));
  return cleaned;
}

export function getGuestOrderAccessRecords() {
  return write(safeParse());
}

export function saveGuestOrderAccess({ order, guestAccess, token, orderNumber, orderId, transactionId, expiresAt } = {}) {
  const value = guestAccess?.token || token;
  if (!value || typeof value !== 'string') return null;
  const record = {
    token: value,
    orderId: order?.id || orderId || null,
    orderNumber: order?.orderNumber || guestAccess?.orderNumber || orderNumber || null,
    transactionId: order?.payment?.transactionId || transactionId || null,
    expiresAt: guestAccess?.expiresAt || expiresAt || null,
    savedAt: new Date().toISOString(),
  };
  const previous = getGuestOrderAccessRecords().filter(item => item.token !== record.token && (!record.orderId || item.orderId !== record.orderId) && (!record.orderNumber || item.orderNumber !== record.orderNumber));
  write([record, ...previous]);
  return record;
}

export function getGuestOrderAccess({ orderId, orderNumber, transactionId } = {}) {
  return getGuestOrderAccessRecords().find(record =>
    (orderId && record.orderId === orderId) ||
    (orderNumber && record.orderNumber === orderNumber) ||
    (transactionId && record.transactionId === transactionId)
  ) || null;
}

export function removeGuestOrderAccess(token) {
  if (!token) return;
  write(getGuestOrderAccessRecords().filter(record => record.token !== token));
}

export function readGuestTokenFromHash() {
  if (typeof window === 'undefined' || !window.location.hash) return '';
  const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  const params = new URLSearchParams(raw);
  const token = String(params.get('access') || '').trim();
  if (token.length < 20 || token.length > 4096) return '';
  params.delete('access');
  const nextHash = params.toString();
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ''}`);
  return token;
}
