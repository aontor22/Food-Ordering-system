import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import Icon from '../../components/ui/Icon';
import { AdminEmpty, AdminError, AdminLoading, AdminPageHeader, StatusBadge } from '../../components/admin/AdminUI';

export default function AdminCustomers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setUsers((await api.getAdminUsers()).users); }
    catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => users.filter(user => {
    const matchesSearch = `${user.name} ${user.email}`.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === 'ALL' || (filter === 'ACTIVE' ? user.isActive : !user.isActive);
    return matchesSearch && matchesFilter;
  }), [users, search, filter]);

  const toggle = async user => {
    setBusy(user.id); setError('');
    try {
      const { user: updated } = await api.updateAdminUser(user.id, { isActive: !user.isActive });
      setUsers(previous => previous.map(item => item.id === user.id ? { ...item, ...updated } : item));
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(''); }
  };

  if (loading) return <AdminLoading label="Loading customer accounts…" />;
  if (error && !users.length) return <AdminError message={error} retry={load} />;

  return <>
    <AdminPageHeader eyebrow="Account directory" title={`${users.filter(user => user.role === 'CUSTOMER').length} customers`} description="Review ordering activity and disable compromised customer access." />
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="admin-toolbar"><label className="admin-search"><Icon name="search" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by name or email…" aria-label="Search customers" /></label><select value={filter} onChange={event => setFilter(event.target.value)} aria-label="Filter customers"><option value="ALL">All accounts</option><option value="ACTIVE">Active</option><option value="INACTIVE">Disabled</option></select></div>
    <section className="admin-card">
      {visible.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Account</th><th>Role</th><th>Joined</th><th>Orders</th><th>Points</th><th>Lifetime value</th><th>Status</th><th className="align-right">Actions</th></tr></thead>
        <tbody>{visible.map(user => <tr key={user.id}>
          <td><strong>{user.name}</strong><small>{user.email}</small></td><td>{user.role === 'ADMIN' ? 'Administrator' : 'Customer'}</td><td>{formatDate(user.createdAt)}</td><td><strong>{user.orderCount}</strong></td><td><strong>{user.pointsBalance || 0}</strong><small>Tomato Points</small></td><td><strong>{formatCurrency(user.lifetimeValueCents / 100)}</strong></td><td><StatusBadge value={user.isActive ? 'ACTIVE' : 'DISABLED'} /></td>
          <td><div className="admin-table-actions">{user.role === 'CUSTOMER' ? <button className={`button button-small ${user.isActive ? 'button-secondary' : 'button-primary'}`} disabled={busy === user.id} onClick={() => toggle(user)}>{busy === user.id ? 'Updating…' : user.isActive ? 'Disable' : 'Enable'}</button> : <span className="muted">Protected</span>}</div></td>
        </tr>)}</tbody>
      </table></div> : <AdminEmpty icon="users" title="No matching accounts" text="Try changing your search or account filter." />}
    </section>
  </>;
}
