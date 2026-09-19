import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { formatCurrency, formatDate, humanizeStatus } from '../../lib/format';
import Icon from '../../components/ui/Icon';
import ManualPaymentChannels from '../../components/admin/ManualPaymentChannels';
import { AdminEmpty, AdminError, AdminLoading, AdminPageHeader, StatusBadge } from '../../components/admin/AdminUI';

export default function AdminPayments() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [provider, setProvider] = useState('ALL');
  const [busy, setBusy] = useState('');
  const [review, setReview] = useState(null);
  const [reviewNote, setReviewNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try { setPayments((await api.getAdminPayments()).payments); }
    catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => payments.filter(payment => {
    const text = `${payment.transactionId} ${payment.order.orderNumber} ${payment.order.user?.name || ''} ${payment.order.user?.email || ''} ${payment.manualSubmissions?.map(item => item.reference).join(' ') || ''}`.toLowerCase();
    return text.includes(search.toLowerCase()) && (status === 'ALL' || payment.status === status) && (provider === 'ALL' || payment.provider === provider);
  }), [payments, search, status, provider]);
  const metrics = useMemo(() => ({
    paidByCurrency: payments.filter(payment => payment.status === 'PAID').reduce((totals, payment) => ({ ...totals, [payment.currency]: (totals[payment.currency] || 0) + payment.amountCents }), {}),
    paid: payments.filter(payment => payment.status === 'PAID').length,
    pending: payments.filter(payment => ['PENDING', 'PROCESSING', 'REVIEW'].includes(payment.status)).length,
    failed: payments.filter(payment => ['FAILED', 'CANCELLED', 'REJECTED'].includes(payment.status)).length,
  }), [payments]);

  const cashAction = async (payment, action) => {
    if (action !== 'check' && !window.confirm(action === 'paid' ? 'Confirm that you have received the cash for this order?' : 'Confirm that the cash has already been returned to the customer?')) return;
    setBusy(`${action}:${payment.id}`); setError('');
    try {
      const result = action === 'check' ? await api.checkAdminPayment(payment.id) : action === 'paid' ? await api.confirmAdminCashPayment(payment.id) : await api.refundAdminCashPayment(payment.id);
      setPayments(previous => previous.map(item => item.id === payment.id ? { ...item, ...result.payment } : item));
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(''); }
  };

  const beginReview = (payment, decision) => { setReview({ payment, decision, submission: payment.manualSubmissions?.find(item => item.status === 'SUBMITTED') }); setReviewNote(''); setConfirmed(false); setError(''); };
  const saveReview = async event => {
    event.preventDefault(); setBusy(`manual:${review.payment.id}`); setError('');
    try {
      if (review.decision === 'REFUND') await api.refundManualPayment(review.payment.id, { note: reviewNote, confirmedReceived: confirmed });
      else await api.reviewManualPayment(review.payment.id, { submissionId: review.submission.id, decision: review.decision, note: reviewNote, confirmedReceived: confirmed });
      setReview(null); await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  if (loading) return <AdminLoading label="Loading payment ledger…" />;
  if (error && !payments.length) return <AdminError message={error} retry={load} />;

  return <>
    <AdminPageHeader eyebrow="Payment operations" title="Payment ledger" description="Latest 250 transactions. Online statuses come from gateway verification; cash payments can be reconciled here." action={<button className="button button-secondary" onClick={load}><Icon name="refresh" />Refresh</button>} />
    <ManualPaymentChannels />
    <section className="admin-metrics payment-metrics">
      <article className="admin-card metric-card"><span className="metric-icon"><Icon name="trend" /></span><div><p>Recorded paid</p><strong>{Object.entries(metrics.paidByCurrency).map(([currency, cents]) => `${formatCurrency(cents / 100, currency)} ${currency}`).join(' / ') || '—'}</strong><small>{metrics.paid} paid transactions (includes demo)</small></div></article>
      <article className="admin-card metric-card"><span className="metric-icon is-gold"><Icon name="clock" /></span><div><p>Awaiting payment</p><strong>{metrics.pending}</strong><small>Pending or processing</small></div></article>
      <article className="admin-card metric-card"><span className="metric-icon is-orange"><Icon name="alert" /></span><div><p>Failed/cancelled</p><strong>{metrics.failed}</strong><small>Can be retried by customers</small></div></article>
    </section>
    {error && <p className="form-error" role="alert">{error}</p>}
    {review && <section className="admin-card manual-review-panel"><h2>{review.decision === 'REFUND' ? 'Record completed manual refund' : review.decision === 'APPROVE' ? 'Verify money received' : 'Reject payment submission'}</h2><p>{review.payment.order.orderNumber} · {formatCurrency(review.payment.amountCents / 100, review.payment.currency)} ({review.payment.currency})</p><p><strong>{review.payment.manualDestination?.label}</strong> · Receiver: {review.payment.manualDestination?.account}</p>{review.submission && <p>Transaction: <strong>{review.submission.reference}</strong><br />Sender: {review.submission.sender}<br />Customer note: {review.submission.note || 'None'}</p>}<form onSubmit={saveReview}><div className="field"><label htmlFor="review-note">{review.decision === 'REJECT' ? 'Reason shown to customer' : 'Verification / refund reference note'}</label><textarea id="review-note" required minLength={5} maxLength={500} value={reviewNote} onChange={e => setReviewNote(e.target.value)} /></div>{review.decision !== 'REJECT' && <label className="manual-checkbox"><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{review.decision === 'REFUND' ? 'I have already returned the money. This action only records the refund.' : 'I checked the receiving account, transaction reference, sender, currency and exact amount. The money was received.'}</label>}<div className="order-actions"><button className="button button-primary" disabled={Boolean(busy)}>{busy ? 'Saving…' : review.decision === 'APPROVE' ? 'Approve payment' : review.decision === 'REJECT' ? 'Reject submission' : 'Record refund'}</button><button type="button" className="button button-secondary" disabled={Boolean(busy)} onClick={() => setReview(null)}>Close</button></div></form></section>}
    <div className="admin-toolbar"><label className="admin-search"><Icon name="search" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search transaction, order or customer…" aria-label="Search payments" /></label><select value={status} onChange={event => setStatus(event.target.value)} aria-label="Filter payment status"><option value="ALL">All statuses</option>{['PENDING','PROCESSING','PAID','FAILED','CANCELLED','REVIEW','REJECTED','REFUNDED'].map(value => <option key={value} value={value}>{humanizeStatus(value)}</option>)}</select><select value={provider} onChange={event => setProvider(event.target.value)} aria-label="Filter provider"><option value="ALL">All providers</option>{[...new Set(payments.map(payment => payment.provider))].map(value => <option key={value} value={value}>{value}</option>)}</select></div>
    <section className="admin-card">{visible.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Transaction</th><th>Order/customer</th><th>Provider</th><th>Status</th><th>Amount</th><th>Updated</th><th className="align-right">Actions</th></tr></thead><tbody>{visible.map(payment => <tr key={payment.id}>
      <td><strong>{payment.transactionId}</strong><small>{payment.gatewayTransactionId ? `Reference: ${payment.gatewayTransactionId}` : `${payment.attempts} attempt${payment.attempts === 1 ? '' : 's'}`}</small></td>
      <td><strong>{payment.order.orderNumber}</strong><small>{payment.order.user?.name || payment.order.email} · {payment.order.user?.email || payment.order.email}</small></td>
      <td><strong>{payment.provider}</strong><small>{payment.manualDestination?.provider} {payment.currency}</small>{payment.manualSubmissions?.length > 0 && <details><summary>Submissions ({payment.manualSubmissions.length})</summary>{payment.manualSubmissions.map(item => <p key={item.id}>{item.reference} · {item.sender}<br />{humanizeStatus(item.status)}{item.reviewNote && <small>{item.reviewNote}</small>}</p>)}</details>}</td><td><StatusBadge value={payment.status} />{payment.failureReason && <small className="payment-failure" title={payment.failureReason}>{payment.failureReason}</small>}</td><td><strong>{formatCurrency(payment.amountCents / 100, payment.currency)}</strong></td><td>{formatDate(payment.updatedAt)}</td>
      <td><div className="admin-table-actions">{payment.provider === 'COD' && payment.status !== 'PAID' && payment.status !== 'REFUNDED' && payment.order.status !== 'CANCELLED' && <button className="button button-small button-primary" disabled={Boolean(busy)} onClick={() => cashAction(payment, 'paid')}>{busy === `paid:${payment.id}` ? 'Saving…' : 'Cash received'}</button>}{payment.provider === 'COD' && payment.status === 'PAID' && <button className="button button-small button-secondary" disabled={Boolean(busy)} onClick={() => cashAction(payment, 'refund')}>{busy === `refund:${payment.id}` ? 'Saving…' : 'Mark refunded'}</button>}{payment.provider === 'SSLCOMMERZ' && !['PAID','REFUNDED'].includes(payment.status) && <button className="button button-small button-secondary" disabled={Boolean(busy)} onClick={() => cashAction(payment, 'check')}>Check gateway</button>}{payment.provider === 'MANUAL' && payment.status === 'REVIEW' && <><button className="button button-small button-primary" disabled={Boolean(busy)} onClick={() => beginReview(payment, 'APPROVE')}>Review & approve</button><button className="button button-small button-secondary" disabled={Boolean(busy)} onClick={() => beginReview(payment, 'REJECT')}>Reject</button></>}{payment.provider === 'MANUAL' && payment.status === 'PAID' && <button className="button button-small button-secondary" disabled={Boolean(busy)} onClick={() => beginReview(payment, 'REFUND')}>Record refund</button>}{payment.provider !== 'COD' && payment.provider !== 'MANUAL' && <span className="muted">{payment.provider === 'DEMO' ? 'Test payment' : 'Provider controlled'}</span>}</div></td>
    </tr>)}</tbody></table></div> : <AdminEmpty icon="card" title="No matching payments" text="Payment records will appear when customers place new orders." />}</section>
  </>;
}
