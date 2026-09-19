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
export const api = {
  getProducts: () => request('/products'),
  register: body => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: body => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  refresh: () => request('/auth/refresh', { method: 'POST' }, false),
  logout: () => request('/auth/logout', { method: 'POST' }),
  createOrder: body => request('/orders', { method: 'POST', body: JSON.stringify(body) }),
  getOrders: () => request('/orders'),
  cancelOrder: id => request(`/orders/${id}/cancel`, { method: 'POST' }),
  getPaymentOptions: () => request('/payments/options'),
  initiatePayment: orderId => request(`/payments/orders/${orderId}/initiate`, { method: 'POST' }),
  getDemoPayment: (transactionId, signature) => request(`/payments/demo/${transactionId}?signature=${encodeURIComponent(signature)}`),
  completeDemoPayment: (transactionId, body) => request(`/payments/demo/${transactionId}/complete`, { method: 'POST', body: JSON.stringify(body) }),
  getAdminDashboard: () => request('/admin/dashboard'),
  getAdminProducts: () => request('/admin/products'),
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
  getAdminPayments: () => request('/admin/payments'),
  checkAdminPayment: id => request(`/admin/payments/${id}/check`, { method: 'POST' }),
  confirmAdminCashPayment: id => request(`/admin/payments/${id}/cash-received`, { method: 'POST' }),
  refundAdminCashPayment: id => request(`/admin/payments/${id}/cash-refunded`, { method: 'POST' }),
};
