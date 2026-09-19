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
  getOrders: () => request('/orders')
};
