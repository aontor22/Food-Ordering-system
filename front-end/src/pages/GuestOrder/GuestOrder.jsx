import { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { StoreContext } from '../../context/StoreContext';
import OrderTracking from '../../components/orders/OrderTracking';
import OrderItemCustomization from '../../components/orders/OrderItemCustomization';
import OrderDocuments from '../../components/orders/OrderDocuments';
import Icon from '../../components/ui/Icon';
import { api } from '../../lib/api';
import { formatCurrency, formatDate, humanizeStatus } from '../../lib/format';
import { getGuestOrderAccess, readGuestTokenFromHash, removeGuestOrderAccess, saveGuestOrderAccess } from '../../lib/guestOrders';
import './GuestOrder.css';

export default function GuestOrder({ onLogin }) {
  const { orderNumber } = useParams();
  const location = useLocation();
  const { user, setUser } = useContext(StoreContext);
  const [token] = useState(() => {
    const fromState = location.state?.guestAccess?.token;
    const fromHash = readGuestTokenFromHash();
    const stored = getGuestOrderAccess({ orderNumber })?.token;
    const value = fromState || fromHash || stored || '';
    if (value) saveGuestOrderAccess({ token: value, orderNumber, order: location.state?.order, guestAccess: location.state?.guestAccess });
    return value;
  });
  const [order, setOrder] = useState(location.state?.order || null);
  const [error, setError] = useState('');
  const [liveState, setLiveState] = useState('connecting');
  const [busy, setBusy] = useState('');
  const [linkMessage, setLinkMessage] = useState('');

  const load = async () => {
    if (!token) return;
    try {
      const data = await api.getGuestOrder(token);
      setOrder(data.order);
      saveGuestOrderAccess({ token, order: data.order, expiresAt: location.state?.guestAccess?.expiresAt });
      setError('');
    } catch (requestError) { setError(requestError.message); }
  };

  useEffect(() => { load(); }, [token, orderNumber]);
  useEffect(() => {
    if (!token) return undefined;
    return api.subscribeGuestOrder(token, {
      onState: state => setLiveState(state),
      onEvent: (event, data) => {
        if (event === 'snapshot' && data?.order) {
          setOrder(data.order);
          saveGuestOrderAccess({ token, order: data.order });
        }
      },
    });
  }, [token]);

  const canCancel = Boolean(order?.cancellation?.allowed || order?.cancellation?.refundRequired);
  const canRetryOnline = order?.paymentMethod === 'ONLINE' && !['PAID', 'REFUNDED', 'REFUND_PENDING', 'REVIEW'].includes(order.paymentStatus) && !['CANCELLED', 'DELIVERED'].includes(order.status);
  const scheduleText = useMemo(() => order?.fulfillmentMode === 'SCHEDULED' && order.scheduledForLocal ? formatScheduled(order.scheduledForLocal) : 'ASAP', [order]);

  const cancel = async () => {
    if (!token) return;
    const reason = prompt('Why are you cancelling this order?', 'Changed my mind');
    if (reason === null) return;
    if (reason.trim().length < 3) { setError('Please enter a short cancellation reason.'); return; }
    setBusy('cancel'); setError('');
    try { const data = await api.cancelGuestOrder(token, { reason: reason.trim() }); setOrder(data.order); if (data.cancellationRequested) setLinkMessage('Cancellation requested. Refund/reconciliation is required before final cancellation.'); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(''); }
  };

  const retryPayment = async () => {
    setBusy('payment'); setError('');
    try {
      const result = await api.initiateGuestPayment(order.id, token);
      window.location.assign(result.paymentUrl);
    } catch (requestError) { setError(requestError.message); setBusy(''); }
  };

  const linkAccount = async () => {
    if (!user) { onLogin?.(); return; }
    setBusy('link'); setLinkMessage(''); setError('');
    try {
      const data = await api.linkGuestOrder(token);
      removeGuestOrderAccess(token);
      setOrder(data.order);
      if (data.loyalty) setUser(previous => previous ? { ...previous, pointsBalance: data.loyalty.pointsBalance } : previous);
      setLinkMessage(data.linkedNow ? `Order linked to ${user.email}.` : `This order is already linked to ${user.email}.`);
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(''); }
  };

  if (!token) return <section className="guest-order-page surface-card guest-access-missing"><span className="guest-order-icon"><Icon name="lock" size={32} /></span><div className="section-kicker">Private guest order</div><h1>Secure access link required</h1><p>For privacy, an order number alone cannot open a guest order. Use the private tracking link from your confirmation email or the browser where you placed the order.</p><Link className="button button-secondary" to="/">Back to menu</Link></section>;
  if (!order && !error) return <section className="guest-order-page surface-card guest-access-missing"><div className="admin-loader" /><p>Opening your secure guest order…</p></section>;
  if (!order) return <section className="guest-order-page surface-card guest-access-missing"><span className="guest-order-icon is-error"><Icon name="alert" size={32} /></span><h1>We could not open this order</h1><p>{error}</p><button className="button button-secondary" onClick={load}>Try again</button></section>;

  return <div className="guest-order-page">
    <section className="surface-card guest-order-hero">
      <div><div className="guest-order-eyebrow"><span className="guest-type-badge">Guest order</span><span className={`live-connection live-${liveState}`}><i />{liveState === 'connected' ? 'Live' : 'Connecting'}</span></div><h1>{order.orderNumber}</h1><p>Placed {formatDate(order.createdAt)} · {order.fulfillmentType === 'PICKUP' ? 'Pickup' : 'Delivery'} · {scheduleText}</p></div>
      <div className="guest-order-statuses"><span className={`status status-${order.status.toLowerCase()}`}>{humanizeStatus(order.status)}</span><span className={`status payment-status payment-${String(order.paymentStatus).toLowerCase()}`}>{humanizeStatus(order.paymentStatus)}</span></div>
    </section>

    {location.state?.paymentError && <p className="form-error" role="alert">Order placed, but payment could not start: {location.state.paymentError}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {linkMessage && <p className="guest-link-success"><Icon name="check" size={17} />{linkMessage}</p>}

    <section className="surface-card guest-order-tracking"><h2>Order tracking</h2><OrderTracking order={order} /></section>

    <div className="guest-order-grid">
      <section className="surface-card guest-order-panel"><h2>Order summary</h2><div className="guest-order-items">{order.items?.map(item => <div className="guest-order-item" key={item.id}><div><span>{item.quantity} × {item.productName}</span><strong>{formatCurrency(item.lineTotalCents / 100, order.payment?.currency)}</strong></div><OrderItemCustomization compact item={item} currency={order.payment?.currency} /></div>)}</div><div className="guest-order-total"><span>Total</span><strong>{formatCurrency(order.totalCents / 100, order.payment?.currency)}</strong></div></section>
      <section className="surface-card guest-order-panel"><h2>{order.fulfillmentType === 'PICKUP' ? 'Pickup details' : 'Delivery details'}</h2><p><strong>{order.firstName} {order.lastName}</strong><br />{order.phone}<br />{order.email}</p>{order.fulfillmentType === 'DELIVERY' ? <p>{order.street}<br />{order.city}, {order.state} {order.postalCode}<br />{order.country}</p> : <p>{order.pickupAddressSnapshot || 'Restaurant pickup'}{order.pickupInstructionsSnapshot ? <><br />{order.pickupInstructionsSnapshot}</> : null}</p>}{order.notes && <p><strong>Note:</strong> {order.notes}</p>}</section>
    </div>

    <OrderDocuments order={order} guestToken={token} />

    <section className="surface-card guest-account-link"><div><span className="guest-order-icon"><Icon name="user" size={22} /></span><div><h2>Keep this order with your account</h2><p>Anonymous checkout never receives or spends Tomato Points. Sign in or create an account with this same email to link the purchase safely. Once linked, an eligible delivered guest order receives the normal one-time points award and can qualify for account-only reviews.</p></div></div><button className="button button-secondary" disabled={busy === 'link'} onClick={linkAccount}>{busy === 'link' ? 'Linking…' : user ? 'Link to my account' : 'Sign in / create account'}</button></section>

    {order.cancellationRequestedAt && order.status !== 'CANCELLED' && <p className="form-success">Cancellation requested. The restaurant must finish payment refund/reconciliation before the order can be cancelled.</p>}
    {order.cancellation?.allowed && !order.cancellationRequestedAt && <p className="guest-private-note">Self-cancellation is available for about {order.cancellation.minutesRemaining} more minute{order.cancellation.minutesRemaining === 1 ? '' : 's'}.</p>}
    {order.cancellation?.refundRequired && !order.cancellationRequestedAt && <p className="guest-private-note">This paid order is still inside the cancellation policy. Submitting cancellation will create a refund/reconciliation request.</p>}
    <div className="guest-order-actions">
      {order.paymentMethod === 'MANUAL' && !['PAID', 'REFUNDED'].includes(order.paymentStatus) && <Link className="button button-primary" to={`/payment/manual/${order.id}`}>Payment details</Link>}
      {canRetryOnline && <button className="button button-primary" disabled={Boolean(busy)} onClick={retryPayment}>{busy === 'payment' ? 'Opening payment…' : 'Continue / retry payment'}</button>}
      {canCancel && <button className="button button-secondary" disabled={Boolean(busy)} onClick={cancel}>{busy === 'cancel' ? 'Cancelling…' : 'Cancel order'}</button>}
      {user && <Link className="button button-secondary" to="/orders">My account orders</Link>}
      <Link className="button button-ghost" to="/">Back to menu</Link>
    </div>
    <p className="guest-private-note"><Icon name="shield" size={16} />This page is protected by a private, expiring guest-order token. Do not forward the tracking link.</p>
  </div>;
}

function formatScheduled(value) {
  const [dateKey, timeKey] = value.split('T');
  const [hour, minute] = timeKey.split(':').map(Number);
  const date = new Date(`${dateKey}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${date} at ${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}
