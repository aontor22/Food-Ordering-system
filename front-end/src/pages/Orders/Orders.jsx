import { useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StoreContext } from '../../context/StoreContext';
import { formatCurrency, formatDate, humanizeStatus } from '../../lib/format';
import EmptyState from '../../components/ui/EmptyState';
import Icon from '../../components/ui/Icon';
import { api } from '../../lib/api';
import './Orders.css';

export default function Orders({ onLogin }) {
  const { user, getOrders } = useContext(StoreContext);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(Boolean(user));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    getOrders().then(data => setOrders(data.orders)).catch(requestError => setError(requestError.message)).finally(() => setLoading(false));
  }, [user]);

  const pay = async order => {
    setBusy(`pay:${order.id}`); setError('');
    try { const result = await api.initiatePayment(order.id); window.location.assign(result.paymentUrl); }
    catch (requestError) { setError(requestError.message); setBusy(''); getOrders().then(data => setOrders(data.orders)).catch(() => {}); }
  };

  const cancel = async order => {
    if (!window.confirm(`Cancel order ${order.orderNumber}?`)) return;
    setBusy(`cancel:${order.id}`); setError('');
    try {
      const result = await api.cancelOrder(order.id);
      setOrders(previous => previous.map(item => item.id === order.id ? result.order : item));
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(''); }
  };

  if (!user) return <div className="empty-state surface-card"><span className="empty-state-icon">👋</span><h1>Sign in to see your orders</h1><p>Your order history and live status will appear here.</p><button className="button button-primary" onClick={onLogin}>Sign in</button></div>;
  if (!loading && !error && !orders.length) return <EmptyState icon="🧾" title="No orders yet" text="Once you place an order, you can follow its status here." />;

  return <div className="orders-page">
    <header className="page-title"><div className="section-kicker">Your account</div><h1>My orders</h1><p>Track current orders and revisit your favourites.</p></header>
    {error && <p className="form-error">{error}</p>}
    {loading ? <div className="orders-loading"><span />Loading your orders…</div> : <div className="orders-list">
      {orders.map(order => <article className="order-card surface-card" key={order.id}>
        <div className="order-card-head">
          <div><small>Order number</small><h2>{order.orderNumber}</h2><p>{formatDate(order.createdAt)}</p></div>
          <div className="order-statuses"><span className={`status status-${order.status.toLowerCase()}`}>{humanizeStatus(order.status)}</span><span className={`status payment-status payment-${order.paymentStatus.toLowerCase()}`}>{humanizeStatus(order.paymentStatus)}</span></div>
        </div>
        <div className="order-items-preview">{order.items.map(item => <div key={item.id}><span>{item.quantity}×</span><p>{item.productName}</p><strong>{formatCurrency(item.lineTotalCents / 100)}</strong></div>)}</div>
        <div className="order-payment-meta"><span><Icon name={order.paymentMethod === 'ONLINE' ? 'card' : 'cash'} />{order.paymentMethod === 'ONLINE' ? `Online · ${order.payment?.provider === 'DEMO' ? 'Demo gateway' : order.payment?.provider || 'Gateway'}` : 'Cash on delivery'}</span>{order.payment?.transactionId && <small>Transaction: {order.payment.transactionId}</small>}</div>
        <div className="order-card-foot"><span><Icon name="delivery" />{order.status === 'DELIVERED' ? 'Delivered' : order.status === 'CANCELLED' ? 'Order cancelled' : order.status === 'PENDING' ? 'Awaiting confirmation' : 'Delivery in progress'}</span><p>Total <strong>{formatCurrency(order.totalCents / 100)}</strong></p></div>
        {((order.paymentMethod === 'ONLINE' && !['PAID', 'REFUNDED', 'REVIEW'].includes(order.paymentStatus) && !['CANCELLED', 'DELIVERED'].includes(order.status)) || (['PENDING', 'CONFIRMED'].includes(order.status) && !(order.paymentMethod === 'ONLINE' && (order.paymentStatus === 'PAID' || order.paymentStatus === 'REVIEW' || (order.payment?.provider === 'SSLCOMMERZ' && order.paymentStatus === 'PROCESSING'))))) && <div className="order-customer-actions">
          {order.paymentMethod === 'ONLINE' && !['PAID', 'REFUNDED', 'REVIEW'].includes(order.paymentStatus) && !['CANCELLED', 'DELIVERED'].includes(order.status) && <button className="button button-primary" disabled={Boolean(busy)} onClick={() => pay(order)}><Icon name="card" />{busy === `pay:${order.id}` ? 'Opening payment…' : order.paymentStatus === 'PROCESSING' ? 'Check / continue payment' : order.paymentStatus === 'PENDING' ? 'Pay now' : 'Retry payment'}</button>}
          {['PENDING', 'CONFIRMED'].includes(order.status) && !(order.paymentMethod === 'ONLINE' && (order.paymentStatus === 'PAID' || order.paymentStatus === 'REVIEW' || (order.payment?.provider === 'SSLCOMMERZ' && order.paymentStatus === 'PROCESSING'))) && <button className="button button-secondary" disabled={Boolean(busy)} onClick={() => cancel(order)}>{busy === `cancel:${order.id}` ? 'Cancelling…' : 'Cancel order'}</button>}
        </div>}
      </article>)}
    </div>}
  </div>;
}
