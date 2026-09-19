import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { formatCurrency, formatDate, humanizeStatus } from '../../lib/format';
import Icon from '../../components/ui/Icon';
import { AdminEmpty, AdminError, AdminLoading, AdminPageHeader, StatusBadge } from '../../components/admin/AdminUI';

export default function AdminPayments() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [provider, setProvider] = useState('ALL');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setPayments((await api.getAdminPayments()).payments); }
    catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => payments.filter(payment => {
    const text = `${payment.transactionId} ${payment.order.orderNumber} ${payment.order.user?.name || ''} ${payment.order.user?.email || ''}`.toLowerCase();
    return text.includes(search.toLowerCase()) && (status === 'ALL' || payment.status === status) && (provider === 'ALL' || payment.provider === provider);
  }), [payments, search, status, provider]);
  const metrics = useMemo(() => ({
    paidCents: payments.filter(payment => payment.status === 'PAID').reduce((sum, payment) => sum + payment.amountCents, 0),
    paid: payments.filter(payment => payment.status === 'PAID').length,
    pending: payments.filter(payment => ['PENDING', 'PROCESSING', 'REVIEW'].includes(payment.status)).length,
    failed: payments.filter(payment => ['FAILED', 'CANCELLED'].includes(payment.status)).length,
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

  if (loading) return <AdminLoading label="Loading payment ledger…" />;
  if (error && !payments.length) return <AdminError message={error} retry={load} />;

  return <>
    <AdminPageHeader eyebrow="Payment operations" title="Payment ledger" description="Latest 250 transactions. Online statuses come from gateway verification; cash payments can be reconciled here." action={<button className="button button-secondary" onClick={load}><Icon name="refresh" />Refresh</button>} />
    <section className="admin-metrics payment-metrics">
      <article className="admin-card metric-card"><span className="metric-icon"><Icon name="trend" /></span><div><p>Recorded paid</p><strong>{formatCurrency(metrics.paidCents / 100)}</strong><small>{metrics.paid} paid transactions (includes demo)</small></div></article>
      <article className="admin-card metric-card"><span className="metric-icon is-gold"><Icon name="clock" /></span><div><p>Awaiting payment</p><strong>{metrics.pending}</strong><small>Pending or processing</small></div></article>
      <article className="admin-card metric-card"><span className="metric-icon is-orange"><Icon name="alert" /></span><div><p>Failed/cancelled</p><strong>{metrics.failed}</strong><small>Can be retried by customers</small></div></article>
    </section>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="admin-toolbar"><label className="admin-search"><Icon name="search" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search transaction, order or customer…" aria-label="Search payments" /></label><select value={status} onChange={event => setStatus(event.target.value)} aria-label="Filter payment status"><option value="ALL">All statuses</option>{['PENDING','PROCESSING','PAID','FAILED','CANCELLED','REVIEW','REFUNDED'].map(value => <option key={value} value={value}>{humanizeStatus(value)}</option>)}</select><select value={provider} onChange={event => setProvider(event.target.value)} aria-label="Filter provider"><option value="ALL">All providers</option>{[...new Set(payments.map(payment => payment.provider))].map(value => <option key={value} value={value}>{value}</option>)}</select></div>
    <section className="admin-card">{visible.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Transaction</th><th>Order/customer</th><th>Provider</th><th>Status</th><th>Amount</th><th>Updated</th><th className="align-right">Actions</th></tr></thead><tbody>{visible.map(payment => <tr key={payment.id}>
      <td><strong>{payment.transactionId}</strong><small>{payment.gatewayTransactionId ? `Gateway: ${payment.gatewayTransactionId}` : `${payment.attempts} attempt${payment.attempts === 1 ? '' : 's'}`}</small></td>
      <td><strong>{payment.order.orderNumber}</strong><small>{payment.order.user?.name || payment.order.email} · {payment.order.user?.email || payment.order.email}</small></td>
      <td><strong>{payment.provider}</strong><small>{payment.currency}</small></td><td><StatusBadge value={payment.status} />{payment.failureReason && <small className="payment-failure" title={payment.failureReason}>{payment.failureReason}</small>}</td><td><strong>{formatCurrency(payment.amountCents / 100)}</strong></td><td>{formatDate(payment.updatedAt)}</td>
      <td><div className="admin-table-actions">{payment.provider === 'COD' && payment.status !== 'PAID' && payment.status !== 'REFUNDED' && payment.order.status !== 'CANCELLED' && <button className="button button-small button-primary" disabled={Boolean(busy)} onClick={() => cashAction(payment, 'paid')}>{busy === `paid:${payment.id}` ? 'Saving…' : 'Cash received'}</button>}{payment.provider === 'COD' && payment.status === 'PAID' && <button className="button button-small button-secondary" disabled={Boolean(busy)} onClick={() => cashAction(payment, 'refund')}>{busy === `refund:${payment.id}` ? 'Saving…' : 'Mark refunded'}</button>}{payment.provider === 'SSLCOMMERZ' && !['PAID','REFUNDED'].includes(payment.status) && <button className="button button-small button-secondary" disabled={Boolean(busy)} onClick={() => cashAction(payment, 'check')}>Check gateway</button>}{payment.provider !== 'COD' && <span className="muted">{payment.provider === 'DEMO' ? 'Test payment' : 'Provider controlled'}</span>}</div></td>
    </tr>)}</tbody></table></div> : <AdminEmpty icon="card" title="No matching payments" text="Payment records will appear when customers place new orders." />}</section>
  </>;
}
