const DEFAULTS = { customerCancelWindowMinutes: 10, scheduledCancelLeadMinutes: 60, timezone: 'Asia/Dhaka' };

function parts(date, timeZone) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { year:+values.year, month:+values.month, day:+values.day, hour:+values.hour, minute:+values.minute };
}

export function localKeyToDate(localKey, timeZone='Asia/Dhaka') {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localKey || '')) return null;
  const [datePart,timePart]=localKey.split('T'); const [y,m,d]=datePart.split('-').map(Number); const [h,min]=timePart.split(':').map(Number);
  let guess=new Date(Date.UTC(y,m-1,d,h,min));
  for (let i=0;i<3;i++) { const got=parts(guess,timeZone); const desired=Date.UTC(y,m-1,d,h,min); const actual=Date.UTC(got.year,got.month-1,got.day,got.hour,got.minute); guess=new Date(guess.getTime() + (desired-actual)); }
  return guess;
}

export function cancellationPolicy(order, settings=DEFAULTS, now=new Date()) {
  const payment=order?.payment || {};
  const base={ allowed:false, code:'CANNOT_CANCEL', reason:'This order can no longer be cancelled.', deadline:null, minutesRemaining:0, refundRequired:false, reconciliationPending:false };
  if (!order || ['CANCELLED','DELIVERED','OUT_FOR_DELIVERY','READY','READY_FOR_PICKUP','PREPARING'].includes(order.status)) return base;
  if (!['PENDING','CONFIRMED'].includes(order.status)) return base;
  if (order.paymentMethod === 'MANUAL' && order.paymentStatus === 'REVIEW') return { ...base, code:'PAYMENT_UNDER_REVIEW', reason:'Payment review must finish before cancellation can be reconciled.', reconciliationPending:true };
  if (payment.provider === 'SSLCOMMERZ' && ['PROCESSING','REVIEW','REFUND_PENDING'].includes(payment.status || order.paymentStatus)) return { ...base, code:'PAYMENT_PROCESSING', reason:'Payment or refund verification is still in progress.', reconciliationPending:true };
  const refundRequired = order.paymentStatus === 'PAID';
  let deadline;
  if (order.fulfillmentMode === 'SCHEDULED' && order.scheduledForLocal) { const scheduled=localKeyToDate(order.scheduledForLocal, order.schedulingTimezone || settings.timezone || DEFAULTS.timezone); deadline=scheduled ? new Date(scheduled.getTime() - Number(settings.scheduledCancelLeadMinutes || 0)*60000) : null; }
  else deadline=new Date(new Date(order.createdAt).getTime()+Number(settings.customerCancelWindowMinutes || 0)*60000);
  if (!deadline || now > deadline) return { ...base, code:'CANCELLATION_WINDOW_CLOSED', reason:'The customer cancellation window has closed.', deadline };
  const minutesRemaining=Math.max(0,Math.ceil((deadline-now)/60000));
  if (refundRequired) return { ...base, code:'REFUND_REQUIRED', reason:'This paid order requires an administrator refund before final cancellation.', deadline, minutesRemaining, refundRequired:true };
  return { allowed:true, code:'OK', reason:null, deadline, minutesRemaining, refundRequired:false, reconciliationPending:false };
}

export function refundReconciliation(payment, order) {
  if (!payment) return { state:'NO_PAYMENT', action:'NONE', settled:true };
  if (payment.status === 'REFUND_PENDING') return { state:'REFUND_PENDING', action:'CHECK_REFUND', settled:false };
  if (payment.status === 'REFUNDED') return { state:'REFUNDED', action: order?.status === 'CANCELLED' ? 'NONE' : 'CANCEL_ORDER', settled:true };
  if (payment.status === 'PAID') { if (payment.provider === 'SSLCOMMERZ') return { state:'PAID', action:'GATEWAY_REFUND', settled:false }; if (payment.provider === 'MANUAL') return { state:'PAID', action:'RECORD_MANUAL_REFUND', settled:false }; if (payment.provider === 'COD') return { state:'PAID', action:'RECORD_CASH_REFUND', settled:false }; }
  if (['PROCESSING','REVIEW'].includes(payment.status)) return { state:payment.status, action:'CHECK_PAYMENT', settled:false };
  return { state:payment.status, action:'CANCEL_ORDER', settled:true };
}
