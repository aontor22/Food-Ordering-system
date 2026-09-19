import { useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StoreContext } from '../../context/StoreContext';
import { formatCurrency, formatDate, humanizeStatus } from '../../lib/format';
import EmptyState from '../../components/ui/EmptyState';
import Icon from '../../components/ui/Icon';
import './Orders.css';

export default function Orders({ onLogin }) {
  const { user, getOrders } = useContext(StoreContext);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(Boolean(user));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    getOrders().then(data => setOrders(data.orders)).catch(requestError => setError(requestError.message)).finally(() => setLoading(false));
  }, [user]);

  if (!user) return <div className="empty-state surface-card"><span className="empty-state-icon">👋</span><h1>Sign in to see your orders</h1><p>Your order history and live status will appear here.</p><button className="button button-primary" onClick={onLogin}>Sign in</button></div>;
  if (!loading && !error && !orders.length) return <EmptyState icon="🧾" title="No orders yet" text="Once you place an order, you can follow its status here." />;

  return <div className="orders-page">
    <header className="page-title"><div className="section-kicker">Your account</div><h1>My orders</h1><p>Track current orders and revisit your favourites.</p></header>
    {error && <p className="form-error">{error}</p>}
    {loading ? <div className="orders-loading"><span />Loading your orders…</div> : <div className="orders-list">
      {orders.map(order => <article className="order-card surface-card" key={order.id}>
        <div className="order-card-head">
          <div><small>Order number</small><h2>{order.orderNumber}</h2><p>{formatDate(order.createdAt)}</p></div>
          <span className={`status status-${order.status.toLowerCase()}`}>{humanizeStatus(order.status)}</span>
        </div>
        <div className="order-items-preview">{order.items.map(item => <div key={item.id}><span>{item.quantity}×</span><p>{item.productName}</p><strong>{formatCurrency(item.lineTotalCents / 100)}</strong></div>)}</div>
        <div className="order-card-foot"><span><Icon name="delivery" />{order.status === 'DELIVERED' ? 'Delivered' : 'Cash on delivery'}</span><p>Total <strong>{formatCurrency(order.totalCents / 100)}</strong></p></div>
      </article>)}
    </div>}
  </div>;
}
