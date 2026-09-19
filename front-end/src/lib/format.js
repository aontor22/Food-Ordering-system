export const formatCurrency = (value) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: import.meta.env.VITE_CURRENCY || 'USD',
  minimumFractionDigits: 2,
}).format(Number(value || 0));

export const formatDate = (value) => new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));

export const humanizeStatus = (value = '') => value
  .toLowerCase()
  .split('_')
  .map(word => word.charAt(0).toUpperCase() + word.slice(1))
  .join(' ');
