const API_URL = import.meta.env.VITE_API_URL || '/api';
let accessToken = null;
let refreshPromise = null;
export const setAccessToken = value => { accessToken = value; };

export class ApiError extends Error {
  constructor(message, { code = 'REQUEST_FAILED', status = 0, details = null, requestId = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

async function parseError(response, fallback = 'Request failed') {
  const data = await response.json().catch(() => ({}));
  const requestId = data.error?.requestId || response.headers.get('x-request-id') || null;
  const baseMessage = data.error?.message || fallback;
  const message = response.status >= 500 && requestId ? `${baseMessage} (Support ID: ${requestId})` : baseMessage;
  return new ApiError(message, { code: data.error?.code, status: response.status, details: data.error?.details, requestId });
}

async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
        if (response.ok) {
          const data = await response.json();
          setAccessToken(data.accessToken);
          return data;
        }
        const error = await parseError(response, 'Session expired');
        if (error.code === 'STALE_REFRESH_TOKEN' && attempt === 0) {
          await new Promise(resolve => setTimeout(resolve, 120));
          continue;
        }
        setAccessToken(null);
        throw error;
      }
      throw new ApiError('Session expired', { code: 'INVALID_SESSION', status: 401 });
    })().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  const query = search.toString();
  return query ? `?${query}` : '';
}

async function fetchDownloadResponse(path, options = {}, retry = true) {
  const { authRetry = true, ...fetchOptions } = options;
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    ...fetchOptions,
    headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(fetchOptions.headers || {}) },
  });
  if (response.status === 401 && retry && authRetry) {
    try { await refreshAccessToken(); return fetchDownloadResponse(path, options, false); }
    catch { /* Preserve the original document failure below. */ }
  }
  if (!response.ok) throw await parseError(response, 'Document request failed');
  return response;
}

async function downloadRequest(path, options = {}) {
  const response = await fetchDownloadResponse(path, options);
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const filename = match?.[1] || 'tomato-document.html';
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return filename;
}

async function openHtmlDocument(path, options = {}) {
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('Allow pop-ups to print this document');
  try { popup.opener = null; } catch { /* Browser may prevent opener reassignment. */ }
  popup.document.write('<!doctype html><title>Preparing document…</title><p style="font-family:system-ui;padding:24px">Preparing secure order document…</p>');
  try {
    const response = await fetchDownloadResponse(path, options);
    const html = await response.text();
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    return true;
  } catch (error) {
    popup.close();
    throw error;
  }
}

async function request(path, options = {}, retry = true) {
  const { authRetry = true, ...fetchOptions } = options;
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    ...fetchOptions,
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(fetchOptions.headers || {}) },
  });
  if (response.status === 401 && retry && authRetry) {
    try { await refreshAccessToken(); return request(path, options, false); }
    catch { /* Fall through to the original response. */ }
  }
  if (response.status === 204) return null;
  if (!response.ok) throw await parseError(response);
  return response.json().catch(() => ({}));
}

function parseSseBlock(block) {
  let event = 'message';
  const dataLines = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;
  const raw = dataLines.join('\n');
  try { return { event, data: JSON.parse(raw) }; }
  catch { return { event, data: raw }; }
}

function subscribe(path, { onEvent, onState, headers = {}, authRetry = true } = {}) {
  const controller = new AbortController();
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  (async () => {
    let retryMs = 1200;
    while (!controller.signal.aborted) {
      try {
        onState?.('connecting');
        let response = await fetch(`${API_URL}${path}`, {
          method: 'GET',
          credentials: 'include',
          signal: controller.signal,
          headers: { Accept: 'text/event-stream', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...headers },
        });
        if (response.status === 401 && authRetry) {
          try {
            const data = await refreshAccessToken();
            response = await fetch(`${API_URL}${path}`, {
              method: 'GET', credentials: 'include', signal: controller.signal,
              headers: { Accept: 'text/event-stream', Authorization: `Bearer ${data.accessToken}`, ...headers },
            });
          } catch { /* Connection loop will retry or surface the unauthenticated state. */ }
        }
        if (!response.ok || !response.body) throw new Error(`Live connection failed (${response.status})`);
        onState?.('connected');
        retryMs = 1200;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!controller.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const parsed = parseSseBlock(block);
            if (parsed) onEvent?.(parsed.event, parsed.data);
          }
        }
        if (!controller.signal.aborted) onState?.('reconnecting');
      } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') break;
        onState?.('reconnecting', error);
      }
      if (!controller.signal.aborted) {
        await wait(retryMs);
        retryMs = Math.min(10_000, Math.round(retryMs * 1.7));
      }
    }
  })();

  return () => controller.abort();
}

async function uploadProductImage(file) {
  if (!(file instanceof File)) throw new Error('Choose an image file first');
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) throw new Error('Use a JPG, PNG, WebP or AVIF image');
  const signature = await request('/admin/media/signature', { method: 'POST' });
  if (file.size > signature.maxBytes) throw new Error(`Image must be smaller than ${Math.round(signature.maxBytes / 1024 / 1024)} MB`);
  const form = new FormData();
  form.append('file', file);
  form.append('api_key', signature.apiKey);
  form.append('timestamp', String(signature.timestamp));
  form.append('folder', signature.folder);
  form.append('signature', signature.signature);
  const response = await fetch(signature.uploadUrl, { method: 'POST', body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Image upload failed');
  return { imageUrl: data.secure_url, imagePublicId: data.public_id, width: data.width, height: data.height, bytes: data.bytes, format: data.format };
}

export const api = {
  getProducts: (filters = null) => {
    if (!filters || !Object.keys(filters).length) return request('/products');
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return;
      params.set(key, Array.isArray(value) ? value.join(',') : String(value));
    });
    return request(`/products?${params.toString()}`);
  },
  getStoreStatus: () => request('/store/status'),
  getDeliveryZones: () => request('/store/delivery-zones'),
  getFulfillmentOptions: () => request('/store/fulfillment'),
  register: body => request('/auth/register', { method: 'POST', body: JSON.stringify(body), authRetry: false }),
  login: body => request('/auth/login', { method: 'POST', body: JSON.stringify(body), authRetry: false }),
  googleLogin: credential => request('/auth/google', { method: 'POST', body: JSON.stringify({ credential }), authRetry: false }),
  resendVerification: email => request('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }), authRetry: false }),
  verifyEmail: token => request('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }), authRetry: false }),
  forgotPassword: email => request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }), authRetry: false }),
  resetPassword: (token, password) => request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }), authRetry: false }),
  getAdmin2faSetup: challengeToken => request('/auth/admin-2fa/setup', { method: 'POST', body: JSON.stringify({ challengeToken }), authRetry: false }),
  enableAdmin2fa: (challengeToken, code) => request('/auth/admin-2fa/enable', { method: 'POST', body: JSON.stringify({ challengeToken, code }), authRetry: false }),
  verifyAdmin2fa: (challengeToken, code) => request('/auth/admin-2fa/verify', { method: 'POST', body: JSON.stringify({ challengeToken, code }), authRetry: false }),
  regenerateAdminRecoveryCodes: body => request('/auth/admin-2fa/recovery-codes', { method: 'POST', body: JSON.stringify(body) }),
  refresh: () => refreshAccessToken(),
  logout: () => request('/auth/logout', { method: 'POST', authRetry: false }),
  changePassword: body => request('/auth/change-password', { method: 'POST', body: JSON.stringify(body) }),
  getSessions: () => request('/auth/sessions'),
  revokeSession: id => request(`/auth/sessions/${id}`, { method: 'DELETE' }),
  revokeOtherSessions: () => request('/auth/sessions/revoke-others', { method: 'POST' }),
  createOrder: body => request('/orders', { method: 'POST', body: JSON.stringify(body) }),
  quoteOrder: body => request('/orders/quote', { method: 'POST', body: JSON.stringify(body) }),
  createGuestOrder: body => request('/orders/guest', { method: 'POST', body: JSON.stringify(body) }, false),
  quoteGuestOrder: body => request('/orders/guest/quote', { method: 'POST', body: JSON.stringify(body) }, false),
  getGuestOrder: token => request('/orders/guest', { headers: { 'X-Order-Access-Token': token } }, false),
  subscribeGuestOrder: (token, handlers = {}) => subscribe('/orders/guest/live', { ...handlers, headers: { ...(handlers.headers || {}), 'X-Order-Access-Token': token }, authRetry: false }),
  cancelGuestOrder: (token, body = {}) => request('/orders/guest/cancel', { method: 'POST', headers: { 'X-Order-Access-Token': token }, body: JSON.stringify(body) }, false),
  linkGuestOrder: token => request('/orders/guest/link', { method: 'POST', body: JSON.stringify({ token }) }),
  getLoyalty: () => request('/orders/loyalty'),
  getOrders: () => request('/orders'),
  getAddresses: () => request('/addresses'),
  createAddress: body => request('/addresses', { method: 'POST', body: JSON.stringify(body) }),
  updateAddress: (id, body) => request(`/addresses/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  setDefaultAddress: id => request(`/addresses/${id}/default`, { method: 'PUT' }),
  deleteAddress: id => request(`/addresses/${id}`, { method: 'DELETE' }),
  prepareReorder: id => request(`/orders/${id}/reorder`, { method: 'POST' }),
  printOrderDocument: (id, type) => openHtmlDocument(`/orders/${id}/documents/${type}?print=1`),
  downloadOrderDocument: (id, type) => downloadRequest(`/orders/${id}/documents/${type}?download=1`),
  printGuestOrderDocument: (type, token) => openHtmlDocument(`/orders/guest/documents/${type}?print=1`, { authRetry: false, headers: { 'X-Order-Access-Token': token } }),
  downloadGuestOrderDocument: (type, token) => downloadRequest(`/orders/guest/documents/${type}?download=1`, { authRetry: false, headers: { 'X-Order-Access-Token': token } }),
  getNotifications: () => request('/notifications'),
  updateNotificationPreferences: body => request('/notifications/preferences', { method: 'PATCH', body: JSON.stringify(body) }),
  savePushSubscription: body => request('/notifications/push-subscriptions', { method: 'POST', body: JSON.stringify(body) }),
  removePushSubscription: endpoint => request('/notifications/push-subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  sendTestNotification: channel => request(`/notifications/test/${channel}`, { method: 'POST' }),
  subscribeOrders: handlers => subscribe('/orders/live', handlers),
  saveReview: (orderId, itemId, body) => request(`/orders/${orderId}/items/${itemId}/review`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteReview: (orderId, itemId) => request(`/orders/${orderId}/items/${itemId}/review`, { method: 'DELETE' }),
  getProductReviews: productId => request(`/products/${productId}/reviews`),
  getWishlist: () => request('/wishlist'),
  saveWishlistItem: productId => request(`/wishlist/${productId}`, { method: 'PUT' }),
  removeWishlistItem: productId => request(`/wishlist/${productId}`, { method: 'DELETE' }),
  syncWishlist: productIds => request('/wishlist/sync', { method: 'POST', body: JSON.stringify({ productIds }) }),
  cancelOrder: (id, body = {}) => request(`/orders/${id}/cancel`, { method: 'POST', body: JSON.stringify(body) }),
  getPaymentOptions: () => request('/payments/options'),
  initiatePayment: orderId => request(`/payments/orders/${orderId}/initiate`, { method: 'POST' }),
  getDemoPayment: (transactionId, signature) => request(`/payments/demo/${transactionId}?signature=${encodeURIComponent(signature)}`),
  completeDemoPayment: (transactionId, body) => request(`/payments/demo/${transactionId}/complete`, { method: 'POST', body: JSON.stringify(body) }),
  initiateGuestPayment: (orderId, token) => request(`/payments/guest/orders/${orderId}/initiate`, { method: 'POST', headers: { 'X-Order-Access-Token': token } }, false),
  getGuestDemoPayment: (transactionId, signature, token) => request(`/payments/guest/demo/${transactionId}?signature=${encodeURIComponent(signature)}`, { headers: { 'X-Order-Access-Token': token } }, false),
  completeGuestDemoPayment: (transactionId, body, token) => request(`/payments/guest/demo/${transactionId}/complete`, { method: 'POST', body: JSON.stringify(body), headers: { 'X-Order-Access-Token': token } }, false),
  getGuestManualPayment: (orderId, token) => request(`/payments/guest/manual/${orderId}`, { headers: { 'X-Order-Access-Token': token } }, false),
  submitGuestManualPayment: (orderId, body, token) => request(`/payments/guest/manual/${orderId}/submit`, { method: 'POST', body: JSON.stringify(body), headers: { 'X-Order-Access-Token': token } }, false),
  getAdminDashboard: () => request('/admin/dashboard'),
  getAdminMonitoring: () => request('/admin/monitoring'),
  getAdminAnalytics: params => request(`/admin/analytics${buildQuery(params)}`),
  downloadAdminAnalyticsCsv: (type, params) => downloadRequest(`/admin/analytics/export${buildQuery({ ...params, type })}`),
  getAdminNotifications: () => request('/admin/notifications'),
  processAdminNotifications: () => request('/admin/notifications/process', { method: 'POST' }),
  retryAdminNotification: id => request(`/admin/notifications/${id}/retry`, { method: 'POST' }),
  getAdminStoreOperations: () => request('/admin/store-operations'),
  updateAdminStoreOperations: body => request('/admin/store-operations', { method: 'PATCH', body: JSON.stringify(body) }),
  saveAdminStoreClosure: body => request('/admin/store-closures', { method: 'POST', body: JSON.stringify(body) }),
  deleteAdminStoreClosure: id => request(`/admin/store-closures/${id}`, { method: 'DELETE' }),
  getAdminDeliveryZones: () => request('/admin/delivery-zones'),
  getAdminFulfillment: () => request('/admin/fulfillment'),
  updateAdminFulfillment: body => request('/admin/fulfillment', { method: 'PATCH', body: JSON.stringify(body) }),
  saveAdminFulfillmentSlotOverride: body => request('/admin/fulfillment/slot-overrides', { method: 'POST', body: JSON.stringify(body) }),
  deleteAdminFulfillmentSlotOverride: id => request(`/admin/fulfillment/slot-overrides/${id}`, { method: 'DELETE' }),
  createAdminDeliveryZone: body => request('/admin/delivery-zones', { method: 'POST', body: JSON.stringify(body) }),
  updateAdminDeliveryZone: (id, body) => request(`/admin/delivery-zones/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  archiveAdminDeliveryZone: id => request(`/admin/delivery-zones/${id}`, { method: 'DELETE' }),
  getAdminProducts: () => request('/admin/products'),
  getAdminInventory: () => request('/admin/inventory'),
  adjustAdminInventory: body => request('/admin/inventory/adjust', { method: 'POST', body: JSON.stringify(body) }),
  getAdminMedia: () => request('/admin/media'),
  uploadProductImage,
  cleanupProductImage: publicId => request('/admin/media/cleanup', { method: 'POST', body: JSON.stringify({ publicId }) }),
  migrateLegacyProductImages: () => request('/admin/media/migrate-legacy', { method: 'POST' }),
  createAdminProduct: body => request('/admin/products', { method: 'POST', body: JSON.stringify(body) }),
  updateAdminProduct: (id, body) => request(`/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  archiveAdminProduct: id => request(`/admin/products/${id}`, { method: 'DELETE' }),
  getAdminOrders: () => request('/admin/orders'),
  printAdminOrderDocument: (id, type) => openHtmlDocument(`/admin/orders/${id}/documents/${type}?print=1`),
  downloadAdminOrderDocument: (id, type) => downloadRequest(`/admin/orders/${id}/documents/${type}?download=1`),
  subscribeAdminOrders: handlers => subscribe('/admin/orders/live', handlers),
  getAdminKitchen: () => request('/admin/kitchen'),
  subscribeAdminKitchen: handlers => subscribe('/admin/kitchen/live', handlers),
  updateAdminOrderStatus: (id, status, options = {}) => request(`/admin/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, ...options }) }),
  updateAdminOrderEta: (id, minutes, note) => request(`/admin/orders/${id}/eta`, { method: 'PATCH', body: JSON.stringify({ minutes, ...(note ? { note } : {}) }) }),
  getAdminUsers: () => request('/admin/users'),
  updateAdminUser: (id, body) => request(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  getAdminCoupons: () => request('/admin/coupons'),
  createAdminCoupon: body => request('/admin/coupons', { method: 'POST', body: JSON.stringify(body) }),
  updateAdminCoupon: (id, body) => request(`/admin/coupons/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  archiveAdminCoupon: id => request(`/admin/coupons/${id}`, { method: 'DELETE' }),
  getAdminAuditLogs: () => request('/admin/audit-logs'),
  getAdminLoyalty: () => request('/admin/loyalty'),
  updateAdminLoyalty: body => request('/admin/loyalty', { method: 'PATCH', body: JSON.stringify(body) }),
  getAdminReviews: () => request('/admin/reviews'),
  updateAdminReview: (id, status) => request(`/admin/reviews/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  deleteAdminReview: id => request(`/admin/reviews/${id}`, { method: 'DELETE' }),
  getAdminPayments: () => request('/admin/payments'),
  getAdminRefundReconciliation: () => request('/admin/refund-reconciliation'),
  getManualPayment: orderId => request(`/payments/manual/${orderId}`),
  submitManualPayment: (orderId, body) => request(`/payments/manual/${orderId}/submit`, { method: 'POST', body: JSON.stringify(body) }),
  getPaymentChannels: () => request('/admin/payment-channels'),
  savePaymentChannel: (id, body) => request(`/admin/payment-channels${id ? `/${id}` : ''}`, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) }),
  reviewManualPayment: (id, body) => request(`/admin/payments/${id}/manual-review`, { method: 'POST', body: JSON.stringify(body) }),
  refundManualPayment: (id, body) => request(`/admin/payments/${id}/manual-refunded`, { method: 'POST', body: JSON.stringify(body) }),
  checkAdminPayment: id => request(`/admin/payments/${id}/check`, { method: 'POST' }),
  approveAdminGatewayRiskPayment: id => request(`/admin/payments/${id}/gateway-risk-approve`, { method: 'POST' }),
  refundAdminGatewayPayment: (id, body) => request(`/admin/payments/${id}/gateway-refund`, { method: 'POST', body: JSON.stringify(body) }),
  confirmAdminCashPayment: id => request(`/admin/payments/${id}/cash-received`, { method: 'POST' }),
  refundAdminCashPayment: id => request(`/admin/payments/${id}/cash-refunded`, { method: 'POST' }),
};
