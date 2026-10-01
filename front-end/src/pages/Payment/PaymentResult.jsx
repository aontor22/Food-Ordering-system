import { useContext, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { StoreContext } from '../../context/StoreContext';
import { api } from '../../lib/api';
import { getGuestOrderAccess, saveGuestOrderAccess } from '../../lib/guestOrders';
import { formatCurrency, humanizeStatus } from '../../lib/format';
import Icon from '../../components/ui/Icon';
import './Payment.css';

const copy = {
  pending: { icon: 'clock', kicker: 'Payment status', title: 'Awaiting verification', text: 'Check your order for the latest verified payment status.' },
  refunded: { icon: 'check', kicker: 'Refund completed', title: 'Payment refunded', text: 'The payment gateway has confirmed the refund for this order.' },
  refund_pending: { icon: 'clock', kicker: 'Refund requested', title: 'Refund is processing', text: 'The gateway accepted the refund request. We are waiting for final confirmation.' },
  success: { icon: 'check', kicker: 'Payment verified', title: 'Payment successful', text: 'Your transaction was verified and your order is now confirmed.' },
  review: { icon: 'clock', kicker: 'Verification pending', title: 'Payment under review', text: 'The gateway received your payment but requested an additional risk review.' },
  failed: { icon: 'alert', kicker: 'Payment unsuccessful', title: 'Payment was not completed', text: 'Your order is saved. You can safely retry from the order page.' },
  cancelled: { icon: 'close', kicker: 'Payment cancelled', title: 'You cancelled payment', text: 'No online payment was recorded. Your order remains available for retry.' },
};

export default function PaymentResult() {
  const [params] = useSearchParams();
  const orderNumber = params.get('order') || '';
  const callbackStatus = params.get('status') || 'pending';
  const { user, loading: authLoading } = useContext(StoreContext);
  const guestAccess = getGuestOrderAccess({ orderNumber });
  const [order, setOrder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const status = order?.paymentStatus === 'PAID' ? 'success' : order?.paymentStatus === 'REFUND_PENDING' ? 'refund_pending' : order?.payment?.status === 'REVIEW' ? 'review' : order?.paymentStatus === 'REFUNDED' ? 'refunded' : order?.paymentStatus === 'FAILED' ? 'failed' : order?.paymentStatus === 'CANCELLED' ? 'cancelled' : copy[callbackStatus] ? callbackStatus : 'pending';
  const details = copy[status];

  useEffect(() => {
    if (authLoading || !orderNumber || (!guestAccess && !user)) return;
    let active = true;
    const load = async () => {
      try {
        const found = guestAccess ? (await api.getGuestOrder(guestAccess.token)).order : (await api.getOrders()).orders.find(item => item.orderNumber === orderNumber) || null;
        if (active) { setOrder(found); setError(''); if (guestAccess && found) saveGuestOrderAccess({ ...guestAccess, order: found }); }
      } catch (requestError) { if (active) setError(requestError.message); }
    };
    load();
    let checks = 0;
    const timer = setInterval(() => { if (++checks >= 12) clearInterval(timer); else load(); }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [authLoading, user?.id, orderNumber, guestAccess?.token]);

  const retry = async () => {
    if (!order) return;
    setBusy(true);
    try {
      const result = guestAccess ? await api.initiateGuestPayment(order.id, guestAccess.token) : await api.initiatePayment(order.id);
      window.location.assign(result.paymentUrl);
    } catch (requestError) { setError(requestError.message); setBusy(false); }
  };

  const orderHref = guestAccess ? `/guest-order/${orderNumber}` : '/orders';
  return <section className={`payment-page surface-card payment-result-${status}`}><span className={`payment-page-icon ${status === 'success' ? '' : 'is-error'}`}><Icon name={details.icon} size={36} /></span><div className="section-kicker">{details.kicker}{guestAccess ? ' · Guest order' : ''}</div><h1>{details.title}</h1><p>{details.text}</p>{!guestAccess && !user && !authLoading && <p>For a guest order, use the same browser or open the private tracking link sent to your email. An order number alone cannot reveal the order.</p>}{error && <p className="form-error" role="alert">{error}</p>}{(orderNumber || order) && <div className="payment-receipt compact"><div><span>Order</span><strong>{orderNumber || '—'}</strong></div>{order && <><div><span>Payment status</span><strong>{humanizeStatus(order.paymentStatus)}</strong></div><div><span>Amount</span><strong>{formatCurrency(order.totalCents / 100, order.payment?.currency)}</strong></div></>}</div>}<div className="payment-actions">{order && order.paymentMethod === 'ONLINE' && !['PAID', 'REFUNDED', 'REFUND_PENDING', 'REVIEW'].includes(order.paymentStatus) && !['CANCELLED', 'DELIVERED'].includes(order.status) && <button className="button button-primary" onClick={retry} disabled={busy}>{busy ? 'Checking payment…' : order.paymentStatus === 'PROCESSING' ? 'Check / continue payment' : 'Retry payment'}</button>}{(guestAccess || user) && <Link className="button button-primary" to={orderHref}>{guestAccess ? 'Track guest order' : 'View my orders'}</Link>}<Link className="button button-secondary" to="/">Back to menu</Link></div></section>;
}
