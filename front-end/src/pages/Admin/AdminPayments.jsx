import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { formatCurrency, formatDate, humanizeStatus } from '../../lib/format';
import Icon from '../../components/ui/Icon';
import ManualPaymentChannels from '../../components/admin/ManualPaymentChannels';
import { AdminEmpty, AdminError, AdminLoading, AdminPageHeader, StatusBadge } from '../../components/admin/AdminUI';

export default function AdminPayments() {
  const [payments, setPayments] = useState([]);
  const [gateway, setGateway] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [provider, setProvider] = useState('ALL');
  const [busy, setBusy] = useState('');
  const [review, setReview] = useState(null);
  const [reviewNote, setReviewNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [gatewayRefund, setGatewayRefund] = useState(null);
  const [gatewayRefundReason, setGatewayRefundReason] = useState('');
  const [gatewayRefundConfirmed, setGatewayRefundConfirmed] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await api.getAdminPayments();
      setPayments(result.payments);
      setGateway(result.gateway || null);
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => payments.filter(payment => {
    const text = `${payment.transactionId} ${payment.gatewayTransactionId || ''} ${payment.refundReferenceId || ''} ${payment.order.orderNumber} ${payment.order.user?.name || ''} ${payment.order.user?.email || ''} ${payment.manualSubmissions?.map(item => item.reference).join(' ') || ''}`.toLowerCase();
    return text.includes(search.toLowerCase()) && (status === 'ALL' || payment.status === status) && (provider === 'ALL' || payment.provider === provider);
  }), [payments, search, status, provider]);

  const metrics = useMemo(() => ({
    paidByCurrency: payments.filter(payment => payment.status === 'PAID').reduce((totals, payment) => ({ ...totals, [payment.currency]: (totals[payment.currency] || 0) + payment.amountCents }), {}),
    paid: payments.filter(payment => payment.status === 'PAID').length,
    pending: payments.filter(payment => ['PENDING', 'PROCESSING', 'REVIEW', 'REFUND_PENDING'].includes(payment.status)).length,
    failed: payments.filter(payment => ['FAILED', 'CANCELLED', 'REJECTED'].includes(payment.status)).length,
  }), [payments]);

  const updatePayment = result => setPayments(previous => previous.map(item => item.id === result.payment.id ? { ...item, ...result.payment } : item));

  const cashAction = async (payment, action) => {
    if (action !== 'check' && !window.confirm(action === 'paid' ? 'Confirm that you have received the cash for this order?' : 'Confirm that the cash has already been returned to the customer?')) return;
    setBusy(`${action}:${payment.id}`); setError('');
    try {
      const result = action === 'check' ? await api.checkAdminPayment(payment.id) : action === 'paid' ? await api.confirmAdminCashPayment(payment.id) : await api.refundAdminCashPayment(payment.id);
      updatePayment(result);
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(''); }
  };

  const beginReview = (payment, decision) => {
    setReview({ payment, decision, submission: payment.manualSubmissions?.find(item => item.status === 'SUBMITTED') });
    setReviewNote(''); setConfirmed(false); setGatewayRefund(null); setError('');
  };
  const saveReview = async event => {
    event.preventDefault(); setBusy(`manual:${review.payment.id}`); setError('');
    try {
      if (review.decision === 'REFUND') await api.refundManualPayment(review.payment.id, { note: reviewNote, confirmedReceived: confirmed });
      else await api.reviewManualPayment(review.payment.id, { submissionId: review.submission.id, decision: review.decision, note: reviewNote, confirmedReceived: confirmed });
      setReview(null); await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  const approveGatewayRisk = async payment => {
    if (!window.confirm('Accept this gateway-validated risk payment and allow fulfilment? Review the transaction details before continuing.')) return;
    setBusy(`risk-approve:${payment.id}`); setError('');
    try { updatePayment(await api.approveAdminGatewayRiskPayment(payment.id)); }
    catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  const beginGatewayRefund = payment => {
    setGatewayRefund(payment);
    setGatewayRefundReason('');
    setGatewayRefundConfirmed(false);
    setReview(null);
    setError('');
  };
  const submitGatewayRefund = async event => {
    event.preventDefault();
    if (!gatewayRefundConfirmed) return;
    setBusy(`gateway-refund:${gatewayRefund.id}`); setError('');
    try {
      const result = await api.refundAdminGatewayPayment(gatewayRefund.id, { reason: gatewayRefundReason });
      updatePayment(result);
      setGatewayRefund(null);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  if (loading) return <AdminLoading label="Loading payment ledger…" />;
  if (error && !payments.length) return <AdminError message={error} retry={load} />;

  return <>
    <AdminPageHeader eyebrow="Payment operations" title="Payment ledger" description="Gateway payments are server-verified; refunds stay pending until SSLCOMMERZ confirms completion." action={<button className="button button-secondary" onClick={load}><Icon name="refresh" />Refresh</button>} />
    {gateway && <section className="admin-card gateway-health-card"><div><strong>SSLCOMMERZ</strong><p>{gateway.configured ? `${gateway.environment === 'live' ? 'Live' : 'Sandbox'} gateway configured` : 'Gateway credentials are not configured'} · {gateway.currency}</p>{gateway.callbackBase && <small>Callback: {gateway.callbackBase}</small>}</div><StatusBadge value={gateway.configured ? (gateway.environment === 'live' ? 'ACTIVE' : 'PROCESSING') : 'DISABLED'} /></section>}
    <ManualPaymentChannels />
    <section className="admin-metrics payment-metrics">
      <article className="admin-card metric-card"><span className="metric-icon"><Icon name="trend" /></span><div><p>Recorded paid</p><strong>{Object.entries(metrics.paidByCurrency).map(([currency, cents]) => `${formatCurrency(cents / 100, currency)} ${currency}`).join(' / ') || '—'}</strong><small>{metrics.paid} currently paid transactions</small></div></article>
      <article className="admin-card metric-card"><span className="metric-icon is-gold"><Icon name="clock" /></span><div><p>Needs attention</p><strong>{metrics.pending}</strong><small>Payment, review or refund pending</small></div></article>
      <article className="admin-card metric-card"><span className="metric-icon is-orange"><Icon name="alert" /></span><div><p>Failed/cancelled</p><strong>{metrics.failed}</strong><small>May require retry or follow-up</small></div></article>
    </section>
    {error && <p className="form-error" role="alert">{error}</p>}

    {gatewayRefund && <section className="admin-card manual-review-panel"><h2>Refund SSLCOMMERZ payment</h2><p><strong>{gatewayRefund.order.orderNumber}</strong> · Full refund {formatCurrency(gatewayRefund.amountCents / 100, gatewayRefund.currency)} ({gatewayRefund.currency})</p><p>Bank transaction: <strong>{gatewayRefund.gatewayTransactionId || 'Not available'}</strong></p><form onSubmit={submitGatewayRefund}><div className="field"><label htmlFor="gateway-refund-reason">Refund reason</label><textarea id="gateway-refund-reason" required minLength={5} maxLength={255} value={gatewayRefundReason} onChange={event => setGatewayRefundReason(event.target.value)} placeholder="Example: Customer cancelled before preparation" /></div><label className="manual-checkbox"><input type="checkbox" required checked={gatewayRefundConfirmed} onChange={event => setGatewayRefundConfirmed(event.target.checked)} />I understand this sends a real full-refund request to the configured SSLCOMMERZ environment. The order will remain refund-pending until the gateway confirms completion.</label><div className="order-actions"><button className="button button-primary" disabled={Boolean(busy)}>{busy ? 'Requesting refund…' : 'Request full refund'}</button><button type="button" className="button button-secondary" disabled={Boolean(busy)} onClick={() => setGatewayRefund(null)}>Close</button></div></form></section>}

    {review && <section className="admin-card manual-review-panel"><h2>{review.decision === 'REFUND' ? 'Record completed manual refund' : review.decision === 'APPROVE' ? 'Verify money received' : 'Reject payment submission'}</h2><p>{review.payment.order.orderNumber} · {formatCurrency(review.payment.amountCents / 100, review.payment.currency)} ({review.payment.currency})</p><p><strong>{review.payment.manualDestination?.label}</strong> · Receiver: {review.payment.manualDestination?.account}</p>{review.submission && <p>Transaction: <strong>{review.submission.reference}</strong><br />Sender: {review.submission.sender}<br />Customer note: {review.submission.note || 'None'}</p>}<form onSubmit={saveReview}><div className="field"><label htmlFor="review-note">{review.decision === 'REJECT' ? 'Reason shown to customer' : 'Verification / refund reference note'}</label><textarea id="review-note" required minLength={5} maxLength={500} value={reviewNote} onChange={e => setReviewNote(e.target.value)} /></div>{review.decision !== 'REJECT' && <label className="manual-checkbox"><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{review.decision === 'REFUND' ? 'I have already returned the money. This action only records the refund.' : 'I checked the receiving account, transaction reference, sender, currency and exact amount. The money was received.'}</label>}<div className="order-actions"><button className="button button-primary" disabled={Boolean(busy)}>{busy ? 'Saving…' : review.decision === 'APPROVE' ? 'Approve payment' : review.decision === 'REJECT' ? 'Reject submission' : 'Record refund'}</button><button type="button" className="button button-secondary" disabled={Boolean(busy)} onClick={() => setReview(null)}>Close</button></div></form></section>}

    <div className="admin-toolbar"><label className="admin-search"><Icon name="search" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search transaction, refund, order or customer…" aria-label="Search payments" /></label><select value={status} onChange={event => setStatus(event.target.value)} aria-label="Filter payment status"><option value="ALL">All statuses</option>{['PENDING','PROCESSING','PAID','FAILED','CANCELLED','REVIEW','REJECTED','REFUND_PENDING','REFUNDED'].map(value => <option key={value} value={value}>{humanizeStatus(value)}</option>)}</select><select value={provider} onChange={event => setProvider(event.target.value)} aria-label="Filter provider"><option value="ALL">All providers</option>{[...new Set(payments.map(payment => payment.provider))].map(value => <option key={value} value={value}>{value}</option>)}</select></div>
    <section className="admin-card">{visible.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Transaction</th><th>Order/customer</th><th>Provider</th><th>Status</th><th>Amount</th><th>Updated</th><th className="align-right">Actions</th></tr></thead><tbody>{visible.map(payment => <tr key={payment.id}>
      <td><strong>{payment.transactionId}</strong><small>{payment.gatewayTransactionId ? `Bank ref: ${payment.gatewayTransactionId}` : `${payment.attempts} attempt${payment.attempts === 1 ? '' : 's'}`}</small>{payment.refundReferenceId && <small>Refund ref: {payment.refundReferenceId}</small>}</td>
      <td><strong>{payment.order.orderNumber}</strong><small>{payment.order.user?.name || payment.order.email} · {payment.order.user?.email || payment.order.email}</small></td>
      <td><strong>{payment.provider}</strong><small>{payment.manualDestination?.provider} {payment.currency}</small>{payment.gatewayCardType && <small>{payment.gatewayCardType}{payment.gatewayCardIssuer ? ` · ${payment.gatewayCardIssuer}` : ''}</small>}{payment.gatewayRiskLevel === 1 && <small className="payment-failure">Gateway risk review</small>}{payment.manualSubmissions?.length > 0 && <details><summary>Submissions ({payment.manualSubmissions.length})</summary>{payment.manualSubmissions.map(item => <p key={item.id}>{item.reference} · {item.sender}<br />{humanizeStatus(item.status)}{item.reviewNote && <small>{item.reviewNote}</small>}</p>)}</details>}</td>
      <td><StatusBadge value={payment.status} />{payment.refundStatus && <small>Refund: {humanizeStatus(payment.refundStatus)}</small>}{payment.failureReason && <small className="payment-failure" title={payment.failureReason}>{payment.failureReason}</small>}</td>
      <td><strong>{formatCurrency(payment.amountCents / 100, payment.currency)}</strong>{payment.refundAmountCents && <small>Refund: {formatCurrency(payment.refundAmountCents / 100, payment.currency)}</small>}</td>
      <td>{formatDate(payment.updatedAt)}{payment.lastGatewayCheckAt && <small>Checked {formatDate(payment.lastGatewayCheckAt)}</small>}</td>
      <td><div className="admin-table-actions">
        {payment.provider === 'COD' && payment.status !== 'PAID' && payment.status !== 'REFUNDED' && payment.order.status !== 'CANCELLED' && <button className="button button-small button-primary" disabled={Boolean(busy)} onClick={() => cashAction(payment, 'paid')}>{busy === `paid:${payment.id}` ? 'Saving…' : 'Cash received'}</button>}
        {payment.provider === 'COD' && payment.status === 'PAID' && <button className="button button-small button-secondary" disabled={Boolean(busy)} onClick={() => cashAction(payment, 'refund')}>{busy === `refund:${payment.id}` ? 'Saving…' : 'Mark refunded'}</button>}
        {payment.provider === 'SSLCOMMERZ' && !['PAID','REFUNDED','REFUND_PENDING','REVIEW'].includes(payment.status) && <button className="button button-small button-secondary" disabled={Boolean(busy)} onClick={() => cashAction(payment, 'check')}>{busy === `check:${payment.id}` ? 'Checking…' : 'Check gateway'}</button>}
        {payment.provider === 'SSLCOMMERZ' && payment.status === 'REVIEW' && <><button className="button button-small button-primary" disabled={Boolean(busy)} onClick={() => approveGatewayRisk(payment)}>{busy === `risk-approve:${payment.id}` ? 'Saving…' : 'Accept risk payment'}</button><button className="button button-small button-secondary" disabled={Boolean(busy)} onClick={() => beginGatewayRefund(payment)}>Refund payment</button></>}
        {payment.provider === 'SSLCOMMERZ' && payment.status === 'PAID' && <button className="button button-small button-secondary" disabled={Boolean(busy)} onClick={() => beginGatewayRefund(payment)}>Refund via gateway</button>}
        {payment.provider === 'SSLCOMMERZ' && payment.status === 'REFUND_PENDING' && <button className="button button-small button-secondary" disabled={Boolean(busy)} onClick={() => cashAction(payment, 'check')}>{busy === `check:${payment.id}` ? 'Checking…' : 'Check refund'}</button>}
        {payment.provider === 'MANUAL' && payment.status === 'REVIEW' && <><button className="button button-small button-primary" disabled={Boolean(busy)} onClick={() => beginReview(payment, 'APPROVE')}>Review & approve</button><button className="button button-small button-secondary" disabled={Boolean(busy)} onClick={() => beginReview(payment, 'REJECT')}>Reject</button></>}
        {payment.provider === 'MANUAL' && payment.status === 'PAID' && <button className="button button-small button-secondary" disabled={Boolean(busy)} onClick={() => beginReview(payment, 'REFUND')}>Record refund</button>}
        {payment.provider === 'DEMO' && <span className="muted">Test payment</span>}
      </div></td>
    </tr>)}</tbody></table></div> : <AdminEmpty icon="card" title="No matching payments" text="Payment records will appear when customers place new orders." />}</section>
  </>;
}
