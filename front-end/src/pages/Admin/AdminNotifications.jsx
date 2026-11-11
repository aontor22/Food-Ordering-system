import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import Icon from '../../components/ui/Icon';
import { AdminPageHeader, StatusBadge } from '../../components/admin/AdminUI';

function formatDate(value) {
  if (!value) return '—';
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
  catch { return value; }
}

export default function AdminNotifications() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try { setData(await api.getAdminNotifications()); }
    catch (err) { setError(err.message); }
  };
  useEffect(() => { load(); }, []);

  const metrics = useMemo(() => {
    const byStatus = data?.byStatus || {};
    return {
      sent: byStatus.SENT || 0,
      pending: (byStatus.PENDING || 0) + (byStatus.RETRY || 0) + (byStatus.SENDING || 0),
      failed: byStatus.FAILED || 0,
      skipped: byStatus.SKIPPED || 0,
    };
  }, [data]);

  const processQueue = async () => {
    setBusy('process');
    try { await api.processAdminNotifications(); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const retry = async id => {
    setBusy(id);
    try { await api.retryAdminNotification(id); await api.processAdminNotifications(); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  return <>
    <AdminPageHeader eyebrow="Customer communication" title="Notifications" description="Monitor email and browser push delivery for order updates." action={<button className="button button-secondary" onClick={processQueue} disabled={busy === 'process'}><Icon name="refresh" size={17} />{busy === 'process' ? 'Processing…' : 'Process queue'}</button>} />
    {error && <div className="admin-alert error">{error}</div>}

    <div className="admin-metrics notification-admin-metrics">
      <article className="admin-card metric-card"><div className="metric-icon"><Icon name="mail" /></div><div><p>Email service</p><strong>{data?.capabilities.email ? 'Ready' : 'Off'}</strong><small>{data?.capabilities.email ? 'SMTP configured' : 'Add SMTP environment variables'}</small></div></article>
      <article className="admin-card metric-card"><div className="metric-icon is-blue"><Icon name="bell" /></div><div><p>Web Push</p><strong>{data?.capabilities.push ? 'Ready' : 'Off'}</strong><small>{data?.subscriptionCount || 0} registered device{data?.subscriptionCount === 1 ? '' : 's'}</small></div></article>
      <article className="admin-card metric-card"><div className="metric-icon"><Icon name="check" /></div><div><p>Sent</p><strong>{metrics.sent}</strong><small>Successful deliveries</small></div></article>
      <article className="admin-card metric-card"><div className="metric-icon is-gold"><Icon name="clock" /></div><div><p>Queued</p><strong>{metrics.pending}</strong><small>Pending / retry</small></div></article>
      <article className="admin-card metric-card"><div className="metric-icon is-red"><Icon name="alert" /></div><div><p>Needs attention</p><strong>{metrics.failed + metrics.skipped}</strong><small>{metrics.failed} failed · {metrics.skipped} skipped</small></div></article>
    </div>

    <section className="admin-card">
      <div className="admin-card-header"><div><h3>Recent deliveries</h3><p>Transactional order notifications and provider results.</p></div><div className="notification-admin-channel-counts"><span>Email {data?.byChannel?.EMAIL || 0}</span><span>Push {data?.byChannel?.PUSH || 0}</span></div></div>
      <div className="admin-table-wrap">
        <table className="admin-table notification-admin-table">
          <thead><tr><th>Customer</th><th>Order / event</th><th>Channel</th><th>Status</th><th>Attempts</th><th>Updated</th><th className="align-right">Action</th></tr></thead>
          <tbody>
            {(data?.recent || []).map(item => <tr key={item.id}>
              <td><strong>{item.user?.name || 'Customer'}</strong><small>{item.user?.email}</small></td>
              <td><strong>{item.order?.orderNumber || item.eventType}</strong><small>{item.eventType}</small></td>
              <td>{item.channel}</td>
              <td><StatusBadge value={item.status} /></td>
              <td>{item.attempts}</td>
              <td><small>{formatDate(item.sentAt || item.updatedAt)}</small>{item.lastError && <div className="notification-admin-error" title={item.lastError}>{item.lastError}</div>}</td>
              <td className="align-right">{item.status !== 'SENT' && <button className="button button-secondary admin-mini-button" disabled={busy === item.id} onClick={() => retry(item.id)}>{busy === item.id ? 'Retrying…' : 'Retry'}</button>}</td>
            </tr>)}
            {!data?.recent?.length && <tr><td colSpan="7"><div className="admin-empty">No notifications have been queued yet.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </>;
}
