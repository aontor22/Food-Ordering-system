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
    <h1>{isOnline && order?.paymentStatus !== 'PAID' ? 'Complete payment to confirm' : 'Thanks—your food is on its way!'}</h1>
    <p>We’ve received order <strong>{orderNumber}</strong>. {isOnline && order?.paymentStatus !== 'PAID' ? 'Your items are reserved while you retry online payment.' : 'Keep your phone nearby for delivery updates.'}</p>
    {paymentError && <p className="success-alert"><Icon name="alert" size={18} />{paymentError}</p>}
    {order && <div className="success-details">
      <div><span>Payment</span><strong>{isOnline ? 'Online payment' : 'Cash on delivery'}</strong></div>
      <div><span>Order total</span><strong>{formatCurrency(order.totalCents / 100, order.payment?.currency)}</strong></div>
      <div><span>Payment status</span><strong>{humanizeStatus(order.paymentStatus)}</strong></div>
    </div>}
    <div className="success-actions">{isOnline && order?.paymentStatus !== 'PAID' && <button className="button button-primary" onClick={retry} disabled={busy}>{busy ? 'Opening payment…' : 'Retry payment'}</button>}<Link to="/orders" className="button button-primary">View my orders</Link><Link to="/" className="button button-secondary">Back to menu</Link></div>
  </section>;
}
