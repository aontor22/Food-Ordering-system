import { useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StoreContext } from '../../context/StoreContext';
import { formatCurrency, formatDate, humanizeStatus } from '../../lib/format';
import EmptyState from '../../components/ui/EmptyState';
import Icon from '../../components/ui/Icon';
import { api } from '../../lib/api';
import './Orders.css';

export default function Orders({ onLogin }) {
  const { user, setUser, getOrders, refreshProducts } = useContext(StoreContext);
  const [orders, setOrders] = useState([]);
  const [loyalty, setLoyalty] = useState(null);
  const [loading, setLoading] = useState(Boolean(user));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = async () => {
    if (!user) return;
    const [ordersResult, loyaltyResult] = await Promise.all([getOrders(), api.getLoyalty()]);
    setOrders(ordersResult.orders);
    setLoyalty(loyaltyResult.loyalty);
    setUser(previous => previous ? { ...previous, pointsBalance: loyaltyResult.loyalty.pointsBalance } : previous);
  };

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    setLoading(true); setError('');
    load().catch(requestError => setError(requestError.message)).finally(() => setLoading(false));
  }, [user?.id]);

  const pay = async order => {
    setBusy(`pay:${order.id}`); setError('');
    try { const result = await api.initiatePayment(order.id); window.location.assign(result.paymentUrl); }
    catch (requestError) { setError(requestError.message); setBusy(''); load().catch(() => {}); }
  };

  const cancel = async order => {
    if (!window.confirm(`Cancel order ${order.orderNumber}?`)) return;
    setBusy(`cancel:${order.id}`); setError('');
    try {
      const result = await api.cancelOrder(order.id);
      setOrders(previous => previous.map(item => item.id === order.id ? result.order : item));
      if (result.loyalty) {
        setLoyalty(result.loyalty);
        setUser(previous => previous ? { ...previous, pointsBalance: result.loyalty.pointsBalance } : previous);
      }
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(''); }
  };

  const updateReview = (orderId, itemId, review) => {
    setOrders(previous => previous.map(order => order.id !== orderId ? order : {
      ...order,
      items: order.items.map(item => item.id === itemId ? { ...item, review } : item),
    }));
    refreshProducts().catch(() => {});
  };

  if (!user) return <div className="empty-state surface-card"><span className="empty-state-icon">👋</span><h1>Sign in to see your orders</h1><p>Your order history and live status will appear here.</p><button className="button button-primary" onClick={onLogin}>Sign in</button></div>;
  if (!loading && !error && !orders.length) return <EmptyState icon="🧾" title="No orders yet" text="Once you place an order, you can follow its status here." />;

  return <div className="orders-page">
    <header className="page-title"><div className="section-kicker">Your account</div><h1>My orders</h1><p>Track orders, manage payments, collect points and review delivered food.</p></header>
    {loyalty && <section className={`points-wallet surface-card ${!loyalty.enabled ? 'is-paused' : ''}`}>
      <div className="points-wallet-icon"><Icon name="gift" size={24} /></div>
      <div><span>Tomato Points</span><strong>{loyalty.pointsBalance} points</strong><p>{loyalty.enabled ? `Earn ${loyalty.pointsPerOrder} points for every delivered order. Discounts start at ${loyalty.minimumRedeemPoints} points.` : 'The rewards program is paused. Your saved points remain in your account.'}</p></div>
      {loyalty.enabled && <small>1 point = {formatCurrency(loyalty.pointValueCents / 100, loyalty.currency)}</small>}
    </section>}
    {error && <p className="form-error">{error}</p>}
    {loading ? <div className="orders-loading"><span />Loading your orders…</div> : <div className="orders-list">
      {orders.map(order => <article className="order-card surface-card" key={order.id}>
        <div className="order-card-head">
          <div><small>Order number</small><h2>{order.orderNumber}</h2><p>{formatDate(order.createdAt)}</p></div>
          <div className="order-statuses"><span className={`status status-${order.status.toLowerCase()}`}>{humanizeStatus(order.status)}</span><span className={`status payment-status payment-${order.paymentStatus.toLowerCase()}`}>{order.paymentMethod === 'MANUAL' && order.paymentStatus === 'REVIEW' ? 'Awaiting verification' : humanizeStatus(order.paymentStatus)}</span></div>
        </div>
        <div className="order-items-preview">{order.items.map(item => <div className="order-item-review-wrap" key={item.id}>
          <div className="order-item-line"><span>{item.quantity}×</span><p>{item.productName}</p><strong>{formatCurrency(item.lineTotalCents / 100, order.payment?.currency)}</strong></div>
          {order.status === 'DELIVERED' && <ReviewEditor orderId={order.id} item={item} onChange={review => updateReview(order.id, item.id, review)} />}
        </div>)}</div>
        {order.deliveryZoneName && <div className="order-delivery-zone"><Icon name="delivery" size={16} /><span>{order.deliveryZoneName} · {order.deliveryFeeCents === 0 ? 'Free delivery' : `${formatCurrency(order.deliveryFeeCents / 100, order.payment?.currency)} delivery`}</span></div>}
        <div className="order-payment-meta"><span><Icon name={order.paymentMethod === 'ONLINE' ? 'card' : 'cash'} />{order.paymentMethod === 'MANUAL' ? `Manual · ${order.payment?.manualDestination?.provider || ''}` : order.paymentMethod === 'ONLINE' ? `Online · ${order.payment?.provider === 'DEMO' ? 'Demo gateway' : order.payment?.provider || 'Gateway'}` : 'Cash on delivery'}</span>{order.payment?.transactionId && <small>Transaction: {order.payment.transactionId}</small>}</div>
        {(order.pointsRedeemed > 0 || order.pointsEarned > 0) && <div className="order-points-meta">
          {order.pointsRedeemed > 0 && <span><Icon name="gift" size={16} />Used {order.pointsRedeemed} points · saved {formatCurrency(order.pointsDiscountCents / 100, order.payment?.currency)}</span>}
          {order.pointsEarned > 0 && <span className="earned">+{order.pointsEarned} points earned</span>}
        </div>}
        <div className="order-card-foot"><span><Icon name="delivery" />{order.status === 'DELIVERED' ? 'Delivered' : order.status === 'CANCELLED' ? 'Order cancelled' : order.status === 'PENDING' ? 'Awaiting confirmation' : 'Delivery in progress'}</span><p>Total <strong>{formatCurrency(order.totalCents / 100, order.payment?.currency)}</strong></p></div>
        {(order.paymentMethod === 'MANUAL' || (order.paymentMethod === 'ONLINE' && !['PAID', 'REFUNDED', 'REFUND_PENDING', 'REVIEW'].includes(order.paymentStatus) && !['CANCELLED', 'DELIVERED'].includes(order.status)) || (['PENDING', 'CONFIRMED'].includes(order.status) && !(order.paymentMethod !== 'COD' && (order.paymentStatus === 'PAID' || order.paymentStatus === 'REFUND_PENDING' || order.paymentStatus === 'REVIEW' || (order.payment?.provider === 'SSLCOMMERZ' && order.paymentStatus === 'PROCESSING'))))) && <div className="order-customer-actions">
          {order.paymentMethod === 'MANUAL' && <Link className="button button-primary" to={`/payment/manual/${order.id}`}><Icon name="cash" />{['PENDING','REJECTED'].includes(order.paymentStatus) && order.status !== 'CANCELLED' ? 'Submit payment details' : 'Payment details'}</Link>}
          {order.paymentMethod === 'ONLINE' && !['PAID', 'REFUNDED', 'REFUND_PENDING', 'REVIEW'].includes(order.paymentStatus) && !['CANCELLED', 'DELIVERED'].includes(order.status) && <button className="button button-primary" disabled={Boolean(busy)} onClick={() => pay(order)}><Icon name="card" />{busy === `pay:${order.id}` ? 'Opening payment…' : order.paymentStatus === 'PROCESSING' ? 'Check / continue payment' : order.paymentStatus === 'PENDING' ? 'Pay now' : 'Retry payment'}</button>}
          {['PENDING', 'CONFIRMED'].includes(order.status) && !(order.paymentMethod !== 'COD' && (order.paymentStatus === 'PAID' || order.paymentStatus === 'REFUND_PENDING' || order.paymentStatus === 'REVIEW' || (order.payment?.provider === 'SSLCOMMERZ' && order.paymentStatus === 'PROCESSING'))) && <button className="button button-secondary" disabled={Boolean(busy)} onClick={() => cancel(order)}>{busy === `cancel:${order.id}` ? 'Cancelling…' : 'Cancel order'}</button>}
        </div>}
      </article>)}
    </div>}
  </div>;
}

function ReviewEditor({ orderId, item, onChange }) {
  const [open, setOpen] = useState(Boolean(item.review));
  const [rating, setRating] = useState(item.review?.rating || 5);
  const [comment, setComment] = useState(item.review?.comment || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setRating(item.review?.rating || 5);
    setComment(item.review?.comment || '');
    if (item.review) setOpen(true);
  }, [item.review?.id, item.review?.rating, item.review?.comment]);

  const save = async () => {
    setBusy(true); setError('');
    try {
      const { review } = await api.saveReview(orderId, item.id, { rating, comment });
      onChange(review); setOpen(true);
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Remove your review for ${item.productName}?`)) return;
    setBusy(true); setError('');
    try { await api.deleteReview(orderId, item.id); onChange(null); setOpen(false); setRating(5); setComment(''); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  if (!open) return <button className="review-start" type="button" onClick={() => setOpen(true)}><Icon name="star" size={16} />Rate this dish</button>;
  return <div className="review-editor">
    <div className="review-editor-head"><strong>{item.review ? 'Your review' : 'Rate this dish'}</strong>{item.review?.status === 'HIDDEN' && <span>Hidden by restaurant</span>}</div>
    <div className="review-stars" aria-label={`Rating ${rating} out of 5`}>{[1,2,3,4,5].map(value => <button key={value} type="button" className={value <= rating ? 'is-active' : ''} onClick={() => setRating(value)} aria-label={`${value} star${value > 1 ? 's' : ''}`}>★</button>)}</div>
    <textarea value={comment} onChange={event => setComment(event.target.value)} maxLength="800" placeholder="How was the taste, quality and portion?" />
    {error && <p className="form-error">{error}</p>}
    <div className="review-editor-actions"><button type="button" className="button button-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : item.review ? 'Update review' : 'Submit review'}</button>{item.review && <button type="button" className="button button-secondary" disabled={busy} onClick={remove}>Remove</button>}{!item.review && <button type="button" className="review-cancel" onClick={() => setOpen(false)}>Cancel</button>}</div>
  </div>;
}
