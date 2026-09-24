const API_URL = import.meta.env.VITE_API_URL || '/api';
let accessToken = null;
export const setAccessToken = value => { accessToken = value; };

async function request(path, options = {}, retry = true) {
  const response = await fetch(`${API_URL}${path}`, { credentials: 'include', ...options, headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...options.headers } });
  if (response.status === 401 && retry && path !== '/auth/refresh') {
    const refreshed = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (refreshed.ok) { const data = await refreshed.json(); setAccessToken(data.accessToken); return request(path, options, false); }
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Request failed');
  return data;
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
  getProducts: () => request('/products'),
  getStoreStatus: () => request('/store/status'),
  getDeliveryZones: () => request('/store/delivery-zones'),
  register: body => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: body => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  googleLogin: credential => request('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) }),
  refresh: () => request('/auth/refresh', { method: 'POST' }, false),
  logout: () => request('/auth/logout', { method: 'POST' }),
  createOrder: body => request('/orders', { method: 'POST', body: JSON.stringify(body) }),
  quoteOrder: body => request('/orders/quote', { method: 'POST', body: JSON.stringify(body) }),
  getLoyalty: () => request('/orders/loyalty'),
  getOrders: () => request('/orders'),
  saveReview: (orderId, itemId, body) => request(`/orders/${orderId}/items/${itemId}/review`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteReview: (orderId, itemId) => request(`/orders/${orderId}/items/${itemId}/review`, { method: 'DELETE' }),
  getProductReviews: productId => request(`/products/${productId}/reviews`),
  getWishlist: () => request('/wishlist'),
  saveWishlistItem: productId => request(`/wishlist/${productId}`, { method: 'PUT' }),
  removeWishlistItem: productId => request(`/wishlist/${productId}`, { method: 'DELETE' }),
  syncWishlist: productIds => request('/wishlist/sync', { method: 'POST', body: JSON.stringify({ productIds }) }),
  cancelOrder: id => request(`/orders/${id}/cancel`, { method: 'POST' }),
  getPaymentOptions: () => request('/payments/options'),
  initiatePayment: orderId => request(`/payments/orders/${orderId}/initiate`, { method: 'POST' }),
  getDemoPayment: (transactionId, signature) => request(`/payments/demo/${transactionId}?signature=${encodeURIComponent(signature)}`),
  completeDemoPayment: (transactionId, body) => request(`/payments/demo/${transactionId}/complete`, { method: 'POST', body: JSON.stringify(body) }),
  getAdminDashboard: () => request('/admin/dashboard'),
  getAdminStoreOperations: () => request('/admin/store-operations'),
  updateAdminStoreOperations: body => request('/admin/store-operations', { method: 'PATCH', body: JSON.stringify(body) }),
  saveAdminStoreClosure: body => request('/admin/store-closures', { method: 'POST', body: JSON.stringify(body) }),
  deleteAdminStoreClosure: id => request(`/admin/store-closures/${id}`, { method: 'DELETE' }),
  getAdminDeliveryZones: () => request('/admin/delivery-zones'),
  createAdminDeliveryZone: body => request('/admin/delivery-zones', { method: 'POST', body: JSON.stringify(body) }),
  updateAdminDeliveryZone: (id, body) => request(`/admin/delivery-zones/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  archiveAdminDeliveryZone: id => request(`/admin/delivery-zones/${id}`, { method: 'DELETE' }),
  getAdminProducts: () => request('/admin/products'),
  getAdminMedia: () => request('/admin/media'),
  uploadProductImage,
  cleanupProductImage: publicId => request('/admin/media/cleanup', { method: 'POST', body: JSON.stringify({ publicId }) }),
  migrateLegacyProductImages: () => request('/admin/media/migrate-legacy', { method: 'POST' }),
  createAdminProduct: body => request('/admin/products', { method: 'POST', body: JSON.stringify(body) }),
  updateAdminProduct: (id, body) => request(`/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  archiveAdminProduct: id => request(`/admin/products/${id}`, { method: 'DELETE' }),
  getAdminOrders: () => request('/admin/orders'),
  updateAdminOrderStatus: (id, status) => request(`/admin/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
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
