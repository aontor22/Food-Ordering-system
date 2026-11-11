import { useContext, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { StoreContext } from '../../context/StoreContext';
import { api } from '../../lib/api';
import { getGuestOrderAccess, saveGuestOrderAccess } from '../../lib/guestOrders';
import { formatCurrency } from '../../lib/format';
import Icon from '../../components/ui/Icon';
import './Payment.css';

export default function PaymentDemo({ onLogin }) {
  const { transactionId } = useParams();
  const [params] = useSearchParams();
  const signature = params.get('signature') || '';
  const { user, loading: authLoading } = useContext(StoreContext);
  const guestAccess = getGuestOrderAccess({ transactionId });
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading || (!guestAccess && !user)) return;
    const call = guestAccess ? api.getGuestDemoPayment(transactionId, signature, guestAccess.token) : api.getDemoPayment(transactionId, signature);
    call.then(data => { setSession(data); if (guestAccess) saveGuestOrderAccess({ ...guestAccess, transactionId, orderId: data.order.id, orderNumber: data.order.orderNumber }); }).catch(requestError => setError(requestError.message));
  }, [authLoading, user?.id, transactionId, signature, guestAccess?.token]);

  const complete = async outcome => {
    setBusy(outcome); setError('');
    try {
      const result = guestAccess ? await api.completeGuestDemoPayment(transactionId, { signature, outcome }, guestAccess.token) : await api.completeDemoPayment(transactionId, { signature, outcome });
      navigate(`/payment/result?status=${outcome === 'success' ? 'success' : outcome === 'cancel' ? 'cancelled' : 'failed'}&order=${encodeURIComponent(result.order.orderNumber)}`, { replace: true });
    } catch (requestError) { setError(requestError.message); setBusy(''); }
  };

  if (authLoading) return <div className="payment-page surface-card"><div className="admin-loader" /><p>Restoring secure access…</p></div>;
  if (!guestAccess && !user) return <div className="payment-page surface-card"><span className="payment-page-icon"><Icon name="lock" size={34} /></span><div className="section-kicker">Secure payment</div><h1>Secure order access required</h1><p>Sign in for an account order, or use the browser/private guest link associated with this payment.</p><button className="button button-primary" onClick={onLogin}>Sign in</button></div>;
  if (error) return <div className="payment-page surface-card"><span className="payment-page-icon is-error"><Icon name="alert" size={34} /></span><div className="section-kicker">Payment unavailable</div><h1>We could not open this session</h1><p>{error}</p><Link className="button button-primary" to={guestAccess?.orderNumber ? `/guest-order/${guestAccess.orderNumber}` : '/orders'}>Return to order</Link></div>;
  if (!session) return <div className="payment-page surface-card"><div className="admin-loader" /><p>Opening demo gateway…</p></div>;

  return <section className="payment-page surface-card"><span className="payment-page-icon"><Icon name="card" size={34} /></span><div className="section-kicker">Development payment gateway{guestAccess ? ' · Guest order' : ''}</div><h1>Complete demo payment</h1><p>This is a test payment. No money will be charged. This demo screen is always disabled in production.</p><div className="payment-receipt"><div><span>Order</span><strong>{session.order.orderNumber}</strong></div><div><span>Customer</span><strong>{session.order.firstName} {session.order.lastName}</strong></div><div><span>Amount</span><strong>{formatCurrency(session.payment.amountCents / 100)}</strong></div><div><span>Transaction</span><strong>{session.payment.transactionId}</strong></div></div><div className="payment-actions"><button className="button button-primary" disabled={Boolean(busy)} onClick={() => complete('success')}><Icon name="check" />{busy === 'success' ? 'Verifying…' : 'Simulate successful payment'}</button><button className="button button-secondary" disabled={Boolean(busy)} onClick={() => complete('fail')}>Simulate failure</button><button className="button button-ghost" disabled={Boolean(busy)} onClick={() => complete('cancel')}>Cancel payment</button></div><p className="payment-security-note"><Icon name="shield" size={17} />The customer-facing app never directly sets a real transaction to paid; production status comes from verified gateway callbacks.</p></section>;
}
