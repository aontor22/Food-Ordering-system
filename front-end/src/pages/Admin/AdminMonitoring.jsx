import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import Icon from '../../components/ui/Icon';
import { AdminEmpty, AdminError, AdminLoading, AdminPageHeader } from '../../components/admin/AdminUI';

function formatDate(value) {
  if (!value) return '—';
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value)); }
  catch { return value; }
}

function formatDuration(seconds = 0) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

function stateLabel(value) {
  if (value === true) return 'Configured';
  if (value === false) return 'Not configured';
  return String(value ?? '—');
}

const integrationLabels = {
  smtp: 'Email / SMTP',
  webPush: 'Browser push',
  cloudinary: 'Cloudinary',
  sslcommerz: 'SSLCOMMERZ',
  sslcommerzLive: 'Gateway live mode',
  authEncryption: 'Auth encryption',
};

export default function AdminMonitoring() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');
    try { setData(await api.getAdminMonitoring()); }
    catch (err) { setError(err.message); }
    finally { if (!quiet) setLoading(false); }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = setInterval(() => load({ quiet: true }), 30_000);
    return () => clearInterval(timer);
  }, [autoRefresh]);

  const notificationQueue = data?.operations?.notificationQueue || {};
  const queueTotal = (notificationQueue.PENDING || 0) + (notificationQueue.RETRY || 0) + (notificationQueue.SENDING || 0);
  const eventsByLevel = data?.operations?.events24h?.byLevel || {};
  const eventTotal = useMemo(() => Object.values(eventsByLevel).reduce((sum, value) => sum + Number(value || 0), 0), [eventsByLevel]);

  if (loading && !data) return <AdminLoading label="Loading operational health…" />;
  if (error && !data) return <AdminError message={error} retry={() => load()} />;

  return <>
    <AdminPageHeader
      eyebrow="Production operations"
      title="Monitoring"
      description="Live database readiness, process health, delivery queues and structured operational incidents."
      action={<div className="monitoring-actions"><label className="monitoring-auto"><input type="checkbox" checked={autoRefresh} onChange={event => setAutoRefresh(event.target.checked)} />Auto refresh</label><button className="button button-secondary" onClick={() => load()}><Icon name="refresh" size={17} />Refresh</button></div>}
    />
    {error && <div className="admin-alert error">{error}</div>}

    <section className={`monitoring-banner is-${data?.status || 'healthy'}`}>
      <div className="monitoring-pulse" />
      <div><strong>{data?.status === 'healthy' ? 'All core systems healthy' : data?.status === 'critical' ? 'Critical dependency unavailable' : 'Operational attention required'}</strong><p>Snapshot {formatDate(data?.generatedAt)} · automatically refreshes every 30 seconds when enabled.</p></div>
    </section>

    <div className="admin-metrics monitoring-metrics">
      <article className="admin-card metric-card"><div className="metric-icon"><Icon name="activity" /></div><div><p>Database</p><strong>{data?.database?.status === 'ok' ? `${data.database.latencyMs} ms` : 'Unavailable'}</strong><small>PostgreSQL readiness latency</small></div></article>
      <article className="admin-card metric-card"><div className="metric-icon is-blue"><Icon name="clock" /></div><div><p>API uptime</p><strong>{formatDuration(data?.process?.uptimeSeconds || 0)}</strong><small>{data?.process?.nodeVersion} · {data?.process?.environment}</small></div></article>
      <article className="admin-card metric-card"><div className="metric-icon is-gold"><Icon name="bell" /></div><div><p>Notification queue</p><strong>{queueTotal}</strong><small>{notificationQueue.stale || 0} stale · {notificationQueue.FAILED || 0} failed</small></div></article>
      <article className="admin-card metric-card"><div className="metric-icon is-red"><Icon name="alert" /></div><div><p>Errors, last hour</p><strong>{data?.operations?.events24h?.recentErrors1h || 0}</strong><small>{eventTotal} tracked events in 24h</small></div></article>
      <article className="admin-card metric-card"><div className="metric-icon"><Icon name="orders" /></div><div><p>Active orders</p><strong>{data?.operations?.activeOrders || 0}</strong><small>Open fulfilment workload</small></div></article>
      <article className="admin-card metric-card"><div className="metric-icon is-blue"><Icon name="card" /></div><div><p>Payment attention</p><strong>{data?.operations?.paymentIssues24h || 0}</strong><small>Failed/refund-pending updates in 24h</small></div></article>
    </div>

    <div className="monitoring-grid">
      <section className="admin-card">
        <div className="admin-card-header"><div><h3>Runtime & integrations</h3><p>Configuration presence only; secrets are never returned.</p></div></div>
        <div className="monitoring-card-body">
          <div className="monitoring-runtime"><div><span>Memory RSS</span><strong>{data?.process?.memoryMb?.rss || 0} MB</strong></div><div><span>Heap used</span><strong>{data?.process?.memoryMb?.heapUsed || 0} MB</strong></div><div><span>Heap allocated</span><strong>{data?.process?.memoryMb?.heapTotal || 0} MB</strong></div></div>
          <div className="monitoring-integrations">{Object.entries(data?.integrations || {}).map(([key, value]) => <div key={key}><span className={`monitoring-dot ${value ? 'is-ok' : 'is-off'}`} /><div><strong>{integrationLabels[key] || key}</strong><small>{stateLabel(value)}</small></div></div>)}</div>
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-card-header"><div><h3>24-hour event mix</h3><p>Structured incidents and slow-request warnings.</p></div></div>
        <div className="monitoring-card-body">
          <div className="monitoring-event-counts">
            {['FATAL', 'ERROR', 'WARN', 'INFO'].map(level => <div key={level}><span className={`monitoring-level is-${level.toLowerCase()}`}>{level}</span><strong>{eventsByLevel[level] || 0}</strong></div>)}
          </div>
          <div className="monitoring-source-list">{Object.entries(data?.operations?.events24h?.bySource || {}).sort((a,b) => b[1]-a[1]).slice(0, 8).map(([source, count]) => <div key={source}><span>{source}</span><strong>{count}</strong></div>)}</div>
        </div>
      </section>
    </div>

    <section className="admin-card">
      <div className="admin-card-header"><div><h3>Recent operational events</h3><p>Use the Request ID to correlate a customer-visible server error with Render logs.</p></div></div>
      {(data?.recentEvents || []).length ? <div className="admin-table-wrap"><table className="admin-table monitoring-table">
        <thead><tr><th>Time</th><th>Level</th><th>Source / code</th><th>Request</th><th>Message</th><th>Duration</th></tr></thead>
        <tbody>{data.recentEvents.map(event => <tr key={event.id}>
          <td><small>{formatDate(event.createdAt)}</small></td>
          <td><span className={`monitoring-level is-${String(event.level).toLowerCase()}`}>{event.level}</span></td>
          <td><strong>{event.source}</strong><small>{event.code}</small></td>
          <td>{event.requestId ? <code title={event.requestId}>{event.requestId.slice(0, 12)}…</code> : '—'}<small>{event.method ? `${event.method} ${event.route || ''}` : ''}</small></td>
          <td className="monitoring-message">{event.message}<small>{event.statusCode ? `HTTP ${event.statusCode}` : ''}</small></td>
          <td>{Number.isInteger(event.durationMs) ? `${event.durationMs} ms` : '—'}</td>
        </tr>)}</tbody>
      </table></div> : <AdminEmpty icon="activity" title="No operational incidents" text="Errors, process failures and slow requests will appear here when they occur." />}
    </section>
  </>;
}
