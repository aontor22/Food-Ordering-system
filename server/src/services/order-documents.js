import { AppError } from '../lib/errors.js';
import { parseOrderItemCustomizations } from './product-customizations.js';

export const ORDER_DOCUMENT_TYPES = ['invoice', 'receipt'];

export const orderDocumentInclude = {
  items: { orderBy: { id: 'asc' } },
  payment: { include: { manualSubmissions: { orderBy: { createdAt: 'desc' }, take: 5 } } },
  user: { select: { id: true, name: true, email: true } },
};

function humanize(value = '') {
  return String(value || '').toLowerCase().split('_').filter(Boolean).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function receiptAvailable(order) {
  return ['PAID', 'REFUNDED'].includes(String(order?.paymentStatus || '').toUpperCase()) || ['PAID', 'REFUNDED'].includes(String(order?.payment?.status || '').toUpperCase());
}

export function orderDocumentAvailability(order) {
  return {
    invoice: { available: Boolean(order?.id) },
    receipt: { available: receiptAvailable(order), reason: receiptAvailable(order) ? null : 'Receipt becomes available after payment is recorded.' },
  };
}

function paymentLabel(order) {
  if (order.paymentMethod === 'COD') return 'Cash on delivery';
  if (order.paymentMethod === 'MANUAL') {
    const provider = order.payment?.manualDestination ? (() => {
      try { return JSON.parse(order.payment.manualDestination)?.provider || ''; } catch { return ''; }
    })() : '';
    return provider ? `Manual payment - ${provider}` : 'Manual payment';
  }
  if (order.payment?.provider === 'SSLCOMMERZ') return 'Online - SSLCOMMERZ';
  if (order.payment?.provider === 'DEMO') return 'Online - Demo gateway';
  return order.payment?.provider ? `Online - ${order.payment.provider}` : 'Online payment';
}

function lineCustomizations(item) {
  return parseOrderItemCustomizations(item.customizationsJson).map(group => ({
    group: group.groupName || 'Option',
    values: (group.options || []).map(option => ({ name: option.name, priceDeltaCents: Number(option.priceDeltaCents || 0) })),
  }));
}

export async function buildOrderDocument(db, order, type) {
  const normalizedType = String(type || '').toLowerCase();
  if (!ORDER_DOCUMENT_TYPES.includes(normalizedType)) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Order document not found');
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  if (normalizedType === 'receipt' && !receiptAvailable(order)) throw new AppError(409, 'RECEIPT_NOT_AVAILABLE', 'A receipt is available after payment has been recorded');

  const [fulfillment, restaurant] = await Promise.all([
    db.fulfillmentSetting.findUnique({ where: { id: 'default' } }).catch(() => null),
    db.restaurantSetting?.findUnique ? db.restaurantSetting.findUnique({ where: { id: 'default' } }).catch(() => null) : Promise.resolve(null),
  ]);
  const currency = String(order.payment?.currency || process.env.PAYMENT_CURRENCY || 'USD').toUpperCase();
  const paymentStatus = String(order.paymentStatus || order.payment?.status || 'PENDING').toUpperCase();
  const refundAmountCents = Number(order.payment?.refundAmountCents || 0);
  const documentNumber = `${normalizedType === 'invoice' ? 'INV' : 'RCT'}-${order.orderNumber}`;
  const issuedAt = normalizedType === 'receipt'
    ? safeDate(order.payment?.paidAt || order.deliveredAt || order.updatedAt)
    : safeDate(order.createdAt);

  return {
    type: normalizedType,
    title: normalizedType === 'invoice' ? 'Invoice' : 'Payment Receipt',
    documentNumber,
    issuedAt,
    currency,
    timezone: restaurant?.timezone || 'Asia/Dhaka',
    seller: {
      name: process.env.EMAIL_FROM_NAME || 'Tomato Restaurant',
      email: process.env.EMAIL_FROM || null,
      address: fulfillment?.pickupAddress || null,
    },
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      statusLabel: humanize(order.status),
      createdAt: safeDate(order.createdAt),
      fulfilledAt: safeDate(order.deliveredAt),
      customerType: order.customerType,
      fulfillmentType: order.fulfillmentType,
      fulfillmentMode: order.fulfillmentMode,
      scheduledForLocal: order.scheduledForLocal,
      deliveryZoneName: order.deliveryZoneName,
      notes: order.notes || null,
    },
    customer: {
      name: `${order.firstName || ''} ${order.lastName || ''}`.trim(),
      email: order.email,
      phone: order.phone,
      address: order.fulfillmentType === 'PICKUP' ? (order.pickupAddressSnapshot || 'Restaurant pickup') : [order.street, order.city, order.state, order.postalCode, order.country].filter(Boolean).join(', '),
    },
    items: (order.items || []).map(item => ({
      id: item.id,
      name: item.productName,
      quantity: Number(item.quantity || 0),
      baseUnitPriceCents: Number(item.baseUnitPriceCents || 0),
      unitPriceCents: Number(item.unitPriceCents || 0),
      lineTotalCents: Number(item.lineTotalCents || 0),
      customizations: lineCustomizations(item),
      specialInstructions: item.specialInstructions || null,
    })),
    totals: {
      subtotalCents: Number(order.subtotalCents || 0),
      promoDiscountCents: Number(order.discountCents || 0),
      couponCode: order.couponCode || null,
      pointsDiscountCents: Number(order.pointsDiscountCents || 0),
      pointsRedeemed: Number(order.pointsRedeemed || 0),
      deliveryFeeCents: Number(order.deliveryFeeCents || 0),
      totalCents: Number(order.totalCents || 0),
    },
    payment: {
      method: order.paymentMethod,
      methodLabel: paymentLabel(order),
      status: paymentStatus,
      statusLabel: humanize(paymentStatus),
      transactionId: order.payment?.transactionId || null,
      gatewayTransactionId: order.payment?.gatewayTransactionId || null,
      paidAt: safeDate(order.payment?.paidAt),
      refundStatus: order.payment?.refundStatus || null,
      refundAmountCents,
      refundedAt: safeDate(order.payment?.refundedAt),
      refundReferenceId: order.payment?.refundReferenceId || null,
    },
    notice: normalizedType === 'invoice'
      ? (paymentStatus === 'PAID' ? 'PAID' : paymentStatus === 'REFUNDED' ? 'REFUNDED' : order.status === 'CANCELLED' ? 'CANCELLED' : 'PAYMENT DUE')
      : (paymentStatus === 'REFUNDED' ? 'PAID - LATER REFUNDED' : 'PAID'),
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function formatMoney(cents, currency) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(Number(cents || 0) / 100);
  } catch {
    return `${currency} ${(Number(cents || 0) / 100).toFixed(2)}`;
  }
}

function formatDateTime(value, timezone = 'Asia/Dhaka') {
  if (!value) return '-';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(date);
}

function customizationHtml(item, currency) {
  const rows = [];
  for (const group of item.customizations || []) {
    const values = (group.values || []).map(value => `${escapeHtml(value.name)}${value.priceDeltaCents ? ` (${escapeHtml(value.priceDeltaCents > 0 ? '+' : '')}${escapeHtml(formatMoney(value.priceDeltaCents, currency))})` : ''}`).join(', ');
    if (values) rows.push(`<div><strong>${escapeHtml(group.group)}:</strong> ${values}</div>`);
  }
  if (item.specialInstructions) rows.push(`<div><strong>Kitchen note:</strong> ${escapeHtml(item.specialInstructions)}</div>`);
  return rows.length ? `<div class="item-meta">${rows.join('')}</div>` : '';
}

export function renderOrderDocumentHtml(document, { autoPrint = false } = {}) {
  const currency = document.currency;
  const rows = document.items.map(item => `<tr><td><strong>${escapeHtml(item.name)}</strong>${customizationHtml(item, currency)}</td><td class="number">${item.quantity}</td><td class="number">${escapeHtml(formatMoney(item.unitPriceCents, currency))}</td><td class="number"><strong>${escapeHtml(formatMoney(item.lineTotalCents, currency))}</strong></td></tr>`).join('');
  const discounts = [];
  if (document.totals.promoDiscountCents > 0) discounts.push(`<div><span>Promo discount${document.totals.couponCode ? ` (${escapeHtml(document.totals.couponCode)})` : ''}</span><strong>- ${escapeHtml(formatMoney(document.totals.promoDiscountCents, currency))}</strong></div>`);
  if (document.totals.pointsDiscountCents > 0) discounts.push(`<div><span>Tomato Points${document.totals.pointsRedeemed ? ` (${document.totals.pointsRedeemed})` : ''}</span><strong>- ${escapeHtml(formatMoney(document.totals.pointsDiscountCents, currency))}</strong></div>`);
  const refund = document.payment.status === 'REFUNDED' || document.payment.refundAmountCents > 0
    ? `<section class="notice refund"><strong>Refund recorded</strong><span>${escapeHtml(formatMoney(document.payment.refundAmountCents || document.totals.totalCents, currency))}${document.payment.refundedAt ? ` on ${escapeHtml(formatDateTime(document.payment.refundedAt, document.timezone))}` : ''}${document.payment.refundReferenceId ? ` · Ref ${escapeHtml(document.payment.refundReferenceId)}` : ''}</span></section>` : '';
  const delivery = document.order.fulfillmentType === 'PICKUP' ? 'Pickup' : 'Delivery';
  const schedule = document.order.fulfillmentMode === 'SCHEDULED' && document.order.scheduledForLocal ? ` · Scheduled ${escapeHtml(document.order.scheduledForLocal.replace('T', ' '))}` : ' · ASAP';
  const paymentRef = document.payment.gatewayTransactionId || document.payment.transactionId;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(document.title)} ${escapeHtml(document.documentNumber)}</title><style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1e1e1e;background:#f5f5f4}*{box-sizing:border-box}body{margin:0}.toolbar{position:sticky;top:0;z-index:10;display:flex;justify-content:center;gap:10px;padding:12px;background:#1f1f1f}.toolbar button{border:0;border-radius:9px;padding:10px 16px;font-weight:800;cursor:pointer}.toolbar .primary{background:#ff5a1f;color:#fff}.sheet{width:min(210mm,calc(100% - 24px));min-height:280mm;margin:18px auto;padding:16mm;background:white;box-shadow:0 10px 35px #0002}.brand{display:flex;justify-content:space-between;gap:28px;border-bottom:2px solid #181818;padding-bottom:18px}.brand h1{margin:0;font-size:29px;letter-spacing:-1px}.brand h1 span{color:#ff5a1f}.doc-title{text-align:right}.doc-title h2{margin:0;font-size:25px}.doc-title p,.muted{color:#666}.notice{display:flex;justify-content:space-between;gap:12px;margin:20px 0;padding:12px 14px;border-radius:10px;background:#fff3eb;color:#8a3a17}.notice.refund{background:#fff1f1;color:#8a2020}.parties{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:24px 0}.parties h3{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#777;margin:0 0 8px}.parties p{margin:3px 0;line-height:1.45}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}.meta div{padding:12px;border:1px solid #e5e5e5;border-radius:9px}.meta span{display:block;color:#777;font-size:11px;text-transform:uppercase;letter-spacing:.05em}.meta strong{display:block;margin-top:4px;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:22px}th{padding:10px 8px;border-bottom:2px solid #222;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em}td{vertical-align:top;padding:13px 8px;border-bottom:1px solid #e8e8e8;font-size:13px}.number{text-align:right;white-space:nowrap}.item-meta{margin-top:5px;color:#6a6a6a;font-size:11px;line-height:1.5}.totals{width:min(390px,100%);margin:22px 0 0 auto}.totals div{display:flex;justify-content:space-between;gap:20px;padding:6px 0}.totals .grand{margin-top:8px;padding-top:12px;border-top:2px solid #222;font-size:18px}.payment-box{margin-top:28px;padding:15px;border:1px solid #ddd;border-radius:10px}.payment-box h3{margin:0 0 8px}.payment-box p{margin:4px 0;color:#555;font-size:12px}.notes{margin-top:18px;padding:12px 0;color:#555;font-size:12px;line-height:1.55}.footer{margin-top:34px;padding-top:14px;border-top:1px solid #ddd;text-align:center;color:#777;font-size:10px}@media(max-width:700px){.sheet{padding:22px 16px;margin:0;width:100%;min-height:100vh;box-shadow:none}.brand,.parties{grid-template-columns:1fr;display:grid}.doc-title{text-align:left}.meta{grid-template-columns:1fr}.toolbar{position:relative}}@media print{body{background:white}.toolbar{display:none}.sheet{width:100%;min-height:auto;margin:0;padding:12mm;box-shadow:none}@page{size:A4;margin:0}}
</style></head><body><div class="toolbar"><button class="primary" onclick="window.print()">Print / Save PDF</button><button onclick="window.close()">Close</button></div><main class="sheet"><header class="brand"><div><h1><span>TOMATO</span> Restaurant</h1><p class="muted">${escapeHtml(document.seller.name)}</p>${document.seller.address ? `<p class="muted">${escapeHtml(document.seller.address)}</p>` : ''}${document.seller.email ? `<p class="muted">${escapeHtml(document.seller.email)}</p>` : ''}</div><div class="doc-title"><h2>${escapeHtml(document.title)}</h2><p><strong>${escapeHtml(document.documentNumber)}</strong><br>Issued ${escapeHtml(formatDateTime(document.issuedAt, document.timezone))}</p></div></header><section class="notice"><strong>${escapeHtml(document.notice)}</strong><span>Order ${escapeHtml(document.order.orderNumber)}</span></section>${refund}<section class="parties"><div><h3>Bill to</h3><p><strong>${escapeHtml(document.customer.name)}</strong></p><p>${escapeHtml(document.customer.email)}</p><p>${escapeHtml(document.customer.phone)}</p><p>${escapeHtml(document.customer.address)}</p></div><div><h3>Fulfilment</h3><p><strong>${delivery}${schedule}</strong></p>${document.order.deliveryZoneName ? `<p>${escapeHtml(document.order.deliveryZoneName)}</p>` : ''}<p>Order status: ${escapeHtml(document.order.statusLabel)}</p>${document.order.notes ? `<p>Order note: ${escapeHtml(document.order.notes)}</p>` : ''}</div></section><section class="meta"><div><span>Order date</span><strong>${escapeHtml(formatDateTime(document.order.createdAt, document.timezone))}</strong></div><div><span>Payment</span><strong>${escapeHtml(document.payment.methodLabel)}</strong></div><div><span>Payment status</span><strong>${escapeHtml(document.payment.statusLabel)}</strong></div></section><table><thead><tr><th>Item</th><th class="number">Qty</th><th class="number">Unit</th><th class="number">Amount</th></tr></thead><tbody>${rows}</tbody></table><section class="totals"><div><span>Subtotal</span><strong>${escapeHtml(formatMoney(document.totals.subtotalCents, currency))}</strong></div>${discounts.join('')}<div><span>Delivery fee</span><strong>${escapeHtml(formatMoney(document.totals.deliveryFeeCents, currency))}</strong></div><div class="grand"><span>Total</span><strong>${escapeHtml(formatMoney(document.totals.totalCents, currency))}</strong></div></section><section class="payment-box"><h3>Payment details</h3><p>${escapeHtml(document.payment.methodLabel)} · ${escapeHtml(document.payment.statusLabel)}</p>${paymentRef ? `<p>Transaction: ${escapeHtml(paymentRef)}</p>` : ''}${document.payment.paidAt ? `<p>Paid: ${escapeHtml(formatDateTime(document.payment.paidAt, document.timezone))}</p>` : ''}</section>${document.type === 'receipt' ? '<section class="notes">This receipt confirms payment recorded against the order shown above. If a refund is displayed, the original payment was subsequently refunded.</section>' : '<section class="notes">This invoice reflects the order as stored by Tomato Restaurant. Payment status is shown above; it is not a payment receipt unless marked paid.</section>'}<footer class="footer">Generated securely from order records · ${escapeHtml(document.documentNumber)}</footer></main>${autoPrint ? '<script>addEventListener("load",()=>setTimeout(()=>window.print(),200));</script>' : ''}</body></html>`;
}

export function orderDocumentFilename(document) {
  const type = document.type === 'receipt' ? 'receipt' : 'invoice';
  return `tomato-${type}-${String(document.order.orderNumber).replace(/[^A-Za-z0-9_-]/g, '-')}.html`;
}
