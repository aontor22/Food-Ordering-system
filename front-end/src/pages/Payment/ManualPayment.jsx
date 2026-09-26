import { useContext, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { StoreContext } from '../../context/StoreContext';
import { api } from '../../lib/api';
import { formatCurrency, formatDate, humanizeStatus } from '../../lib/format';
import Icon from '../../components/ui/Icon';
import './Payment.css';

export default function ManualPayment({ onLogin }) {
  const { orderId } = useParams();
  const { user, loading: authLoading } = useContext(StoreContext);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ reference: '', sender: '', note: '' });
  const load = async () => {
    try { setData(await api.getManualPayment(orderId)); setError(''); }
    catch (e) { setError(e.message); }
  };
  useEffect(() => { if (user) { setData(null); load(); } }, [user?.id, orderId]);
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { await api.submitManualPayment(orderId, form); await load(); setForm({ reference: '', sender: '', note: '' }); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  if (authLoading) return <section className="payment-page surface-card"><p>Restoring your session…</p></section>;
  if (!user) return <section className="payment-page surface-card"><h1>Sign in to view payment details</h1><button className="button button-primary" onClick={onLogin}>Sign in</button></section>;
  if (!data) return <section className="payment-page surface-card"><p>{error || 'Loading payment details…'}</p>{error && <button className="button button-secondary" onClick={load}>Try again</button>}</section>;
  const { order, payment, submissions } = data;
  const destination = payment.manualDestination;
  const canSubmit = order.status === 'PENDING' && ['PENDING', 'REJECTED'].includes(payment.status);
  const title = payment.status === 'PAID' ? 'Payment approved' : payment.status === 'REVIEW' ? 'Awaiting verification' : payment.status === 'REFUNDED' ? 'Refund recorded' : payment.status === 'REJECTED' ? 'Payment needs attention' : order.status === 'CANCELLED' ? 'Order cancelled' : 'Pay and submit your details';
  return <section className="payment-page manual-payment-page surface-card">
    <span className="payment-page-icon"><Icon name={payment.status === 'PAID' ? 'check' : 'cash'} size={34} /></span>
    <div className="section-kicker">Manual payment · {destination.provider}</div><h1>{title}</h1>
    <p>{payment.status === 'REVIEW' ? 'Your details have been submitted. The restaurant will check its payment account before approving. Do not pay again.' : payment.status === 'PAID' ? 'The restaurant has verified your payment. Follow your order from My orders.' : 'Payment is confirmed only after the restaurant verifies the money received.'}</p>
    <div className="payment-receipt">
      <div><span>Order</span><strong>{order.orderNumber}</strong></div>
      <div><span>Exact order amount</span><strong>{formatCurrency(payment.amountCents / 100, payment.currency)} ({payment.currency})</strong></div>
      <div><span>Status</span><strong>{payment.status === 'REVIEW' ? 'Awaiting verification' : humanizeStatus(payment.status)}</strong></div>
    </div>
    {canSubmit && <>
      <div className="manual-instructions"><h2>{destination.label}</h2><p className="manual-account">{destination.account}</p><p>{destination.instructions}</p><p>Use your order number as a reference where supported. Submit details after paying. Never share a PIN, OTP or password here.</p></div>
      {payment.status === 'REJECTED' && <p className="form-error">{payment.failureReason} Contact the restaurant if you believe the payment is correct; do not pay twice.</p>}
      <form className="manual-payment-form" onSubmit={submit}>
        <div className="field"><label htmlFor="manual-reference">Transaction ID / bank reference *</label><input id="manual-reference" required minLength={4} maxLength={80} value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder="Reference from your payment receipt" /></div>
        <div className="field"><label htmlFor="manual-sender">Sender mobile / account identifier *</label><input id="manual-sender" required minLength={4} maxLength={100} value={form.sender} onChange={e => setForm({ ...form, sender: e.target.value })} /></div>
        <div className="field"><label htmlFor="manual-note">Note (optional)</label><textarea id="manual-note" maxLength={500} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></div>
        <button className="button button-primary button-full" disabled={busy}>{busy ? 'Submitting…' : 'Submit for verification'}</button>
      </form>
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {submissions.length > 0 && <div className="manual-history"><h2>Payment submissions</h2>{submissions.map(item => <article key={item.id}><strong>{item.reference} · {humanizeStatus(item.status)}</strong><small>{formatDate(item.createdAt)}</small>{item.reviewNote && <p>{item.reviewNote}</p>}</article>)}</div>}
    <div className="payment-actions"><button className="button button-secondary" disabled={busy} onClick={load}><Icon name="refresh" />Refresh status</button><Link className="button button-primary" to="/orders">My orders</Link></div>
  </section>;
}
