import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { formatDate, humanizeStatus } from '../../lib/format';
import Icon from '../../components/ui/Icon';
import { AdminEmpty, AdminError, AdminLoading, AdminPageHeader } from '../../components/admin/AdminUI';

export default function AdminActivity() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const load = useCallback(async () => { setError(''); try { setLogs((await api.getAdminAuditLogs()).logs); } catch (requestError) { setError(requestError.message); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);
  const visible = useMemo(() => logs.filter(log => `${log.action} ${log.entity} ${log.actor?.name || ''} ${log.actor?.email || ''}`.toLowerCase().includes(search.toLowerCase())), [logs, search]);

  if (loading) return <AdminLoading label="Loading activity history…" />;
  if (error && !logs.length) return <AdminError message={error} retry={load} />;
  return <>
    <AdminPageHeader eyebrow="Security audit" title="Administrative activity" description="The 100 most recent tracked actions, newest first." action={<button className="button button-secondary" onClick={load}><Icon name="refresh" />Refresh</button>} />
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="admin-toolbar"><label className="admin-search"><Icon name="search" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search action, entity or administrator…" aria-label="Search activity log" /></label></div>
    <section className="admin-card">{visible.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Action</th><th>Entity</th><th>Administrator</th><th>Date</th><th>Metadata</th></tr></thead><tbody>{visible.map(log => <tr key={log.id}><td><span className="audit-action">{humanizeStatus(log.action)}</span></td><td><strong>{log.entity}</strong><small>{log.entityId || '—'}</small></td><td><strong>{log.actor?.name || 'System'}</strong><small>{log.actor?.email || log.ipAddress || '—'}</small></td><td>{formatDate(log.createdAt)}</td><td className="audit-metadata" title={log.metadata || ''}>{log.metadata || '—'}</td></tr>)}</tbody></table></div> : <AdminEmpty icon="activity" title="No matching activity" text="Administrative actions will appear here as they happen." />}</section>
  </>;
}
