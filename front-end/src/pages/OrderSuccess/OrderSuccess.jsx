import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { formatCurrency, humanizeStatus } from '../../lib/format';
import Icon from '../../components/ui/Icon';
import { api } from '../../lib/api';
import './OrderSuccess.css';

export default function OrderSuccess() {
  const { orderNumber } = useParams();
  const { state } = useLocation();
  const order = state?.order;
  const paymentError = state?.paymentError;
  const loyalty = state?.loyalty;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isOnline = order?.paymentMethod === 'ONLINE';
  const retry = async () => {
    if (!order) return;
    setBusy(true);
    try { const result = await api.initiatePayment(order.id); window.location.assign(result.paymentUrl); }
    catch (requestError) { setError(requestError.message); setBusy(false); }
  };
  return <section className="success-page surface-card">
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className={`success-check ${isOnline && order?.paymentStatus !== 'PAID' ? 'is-pending' : ''}`}><Icon name={isOnline && order?.paymentStatus !== 'PAID' ? 'card' : 'check'} size={42} strokeWidth={2.4} /></div>
    <div className="section-kicker">{isOnline && order?.paymentStatus !== 'PAID' ? 'Order saved' : 'Order confirmed'}</div>
    <h1>{isOnline && order?.paymentStatus !== 'PAID' ? 'Complete payment to confirm' : order?.fulfillmentType === 'PICKUP' ? 'Thanks—your pickup is booked!' : 'Thanks—your food is on its way!'}</h1>
    <p>We’ve received order <strong>{orderNumber}</strong>. {isOnline && order?.paymentStatus !== 'PAID' ? 'Your items are reserved while you retry online payment.' : order?.fulfillmentType === 'PICKUP' ? 'We’ll prepare it for collection at your selected time.' : 'Keep your phone nearby for delivery updates.'}</p>
    {paymentError && <p className="success-alert"><Icon name="alert" size={18} />{paymentError}</p>}
    {order && <div className="success-details">
      <div><span>Payment</span><strong>{isOnline ? 'Online payment' : 'Cash on delivery'}</strong></div>
      <div><span>Order total</span><strong>{formatCurrency(order.totalCents / 100, order.payment?.currency)}</strong></div>
      <div><span>Payment status</span><strong>{humanizeStatus(order.paymentStatus)}</strong></div>
      <div><span>Fulfilment</span><strong>{order.fulfillmentType === 'PICKUP' ? 'Pickup' : 'Delivery'} · {order.fulfillmentMode === 'SCHEDULED' ? formatScheduled(order.scheduledForLocal) : 'ASAP'}</strong></div>
      {order.fulfillmentType === 'PICKUP' && order.pickupAddressSnapshot && <div><span>Pickup address</span><strong>{order.pickupAddressSnapshot}</strong></div>}
      {order.deliveryZoneName && <div><span>Delivery area</span><strong>{order.deliveryZoneName}</strong></div>}
      {order.fulfillmentType === 'DELIVERY' && <div><span>Delivery fee</span><strong>{order.deliveryFeeCents === 0 ? 'Free' : formatCurrency(order.deliveryFeeCents / 100, order.payment?.currency)}</strong></div>}
      {order.pointsRedeemed > 0 && <div><span>Points used</span><strong>{order.pointsRedeemed} · saved {formatCurrency(order.pointsDiscountCents / 100, order.payment?.currency)}</strong></div>}
      {loyalty && <div><span>Points balance</span><strong>{loyalty.pointsBalance}</strong></div>}
    </div>}
    <div className="success-actions">{isOnline && order?.paymentStatus !== 'PAID' && <button className="button button-primary" onClick={retry} disabled={busy}>{busy ? 'Opening payment…' : 'Retry payment'}</button>}<Link to="/orders" className="button button-primary">View my orders</Link><Link to="/" className="button button-secondary">Back to menu</Link></div>
  </section>;
}


function formatScheduled(value) {
  if (!value) return 'Scheduled';
  const [dateKey, timeKey] = value.split('T');
  const [hour, minute] = timeKey.split(':').map(Number);
  const time = `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
  const date = new Date(`${dateKey}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${date} at ${time}`;
}
