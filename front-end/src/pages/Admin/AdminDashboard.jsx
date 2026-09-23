import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import Icon from '../../components/ui/Icon';
import { AdminError, AdminLoading, AdminPageHeader, StatusBadge } from '../../components/admin/AdminUI';

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setData(await api.getAdminDashboard()); }
    catch (requestError) { setError(requestError.message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const maxRevenue = useMemo(() => Math.max(1, ...(data?.revenueByDay || []).map(day => day.revenueCents)), [data]);
  const totalStatuses = useMemo(() => Math.max(1, ...(data?.ordersByStatus || []).map(item => item.count)), [data]);

  if (!data && !error) return <AdminLoading label="Building your dashboard…" />;
  if (error) return <AdminError message={error} retry={load} />;

  const { metrics } = data;
  const cards = [
    { label: 'Total revenue', value: formatCurrency(metrics.revenueCents / 100), detail: 'Delivered orders', icon: 'trend', tone: '' },
    { label: 'Orders', value: metrics.orders, detail: `${metrics.todayOrders} placed today`, icon: 'orders', tone: 'is-orange' },
    { label: 'Customers', value: metrics.customers, detail: 'Registered accounts', icon: 'users', tone: 'is-blue' },
    { label: 'Active products', value: metrics.products, detail: `${metrics.lowStock} low-stock items`, icon: 'products', tone: 'is-gold' },
    { label: 'Wishlist saves', value: metrics.wishlistSaves || 0, detail: 'Saved customer favourites', icon: 'heart', tone: 'is-red' },
  ];

  return <>
    <AdminPageHeader eyebrow="Live operations" title="Everything at a glance" description={`${metrics.pendingOrders} orders currently require attention.`} action={<button className="button button-secondary" onClick={load}><Icon name="refresh" />Refresh</button>} />
    <section className="admin-metrics" aria-label="Business metrics">
      {cards.map(card => <article className="admin-card metric-card" key={card.label}>
        <span className={`metric-icon ${card.tone}`}><Icon name={card.icon} size={23} /></span>
        <div><p>{card.label}</p><strong>{card.value}</strong><small>{card.detail}</small></div>
      </article>)}
    </section>

    <section className="admin-grid">
      <article className="admin-card">
        <div className="admin-card-header"><div><h3>7-day delivered revenue</h3><p>Revenue is recognized when an order is delivered.</p></div></div>
        <div className="revenue-chart" aria-label="Seven-day revenue chart">
          {data.revenueByDay.map(day => <div className="revenue-bar" key={day.date} title={`${day.date}: ${formatCurrency(day.revenueCents / 100)}`}>
            <small>{day.revenueCents ? formatCurrency(day.revenueCents / 100) : '—'}</small>
            <div style={{ height: `${Math.max(4, (day.revenueCents / maxRevenue) * 135)}px` }} />
            <span>{new Date(`${day.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' })}</span>
          </div>)}
        </div>
      </article>
      <article className="admin-card">
        <div className="admin-card-header"><div><h3>Order distribution</h3><p>Current status across all orders.</p></div></div>
        <div className="status-list">
          {data.ordersByStatus.length ? data.ordersByStatus.map(item => <div className="status-row" key={item.status}>
            <div><StatusBadge value={item.status} /><strong>{item.count}</strong></div>
            <span className="progress-track"><i style={{ width: `${(item.count / totalStatuses) * 100}%` }} /></span>
          </div>) : <p className="muted">No orders yet.</p>}
        </div>
      </article>
    </section>

    <section className="admin-grid equal">
      <article className="admin-card">
        <div className="admin-card-header"><div><h3>Recent orders</h3><p>The latest customer activity.</p></div><Link className="text-link" to="/admin/orders">View all</Link></div>
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th className="align-right">Total</th></tr></thead>
          <tbody>{data.recentOrders.length ? data.recentOrders.map(order => <tr key={order.id}>
            <td><strong>{order.orderNumber}</strong><small>{formatDate(order.createdAt)}</small></td>
            <td><strong>{order.user?.name || `${order.firstName} ${order.lastName}`}</strong><small>{order.email}</small></td>
            <td><StatusBadge value={order.status} /></td><td className="align-right"><strong>{formatCurrency(order.totalCents / 100)}</strong></td>
          </tr>) : <tr><td colSpan="4" className="muted">No orders yet.</td></tr>}</tbody>
        </table></div>
      </article>
      <article className="admin-card">
        <div className="admin-card-header"><div><h3>Top-selling products</h3><p>Ranked by units ordered.</p></div><Link className="text-link" to="/admin/products">Inventory</Link></div>
        <div className="top-product-list">
          {data.topProducts.length ? data.topProducts.map((product, index) => <div className="top-product-row" key={product.name}>
            <div><span><strong>#{index + 1} {product.name}</strong><small> · {product.quantity} units</small></span><strong>{formatCurrency(product.revenueCents / 100)}</strong></div>
            <span className="progress-track"><i style={{ width: `${(product.quantity / data.topProducts[0].quantity) * 100}%` }} /></span>
          </div>) : <p className="muted">Sales will appear after customers place orders.</p>}
        </div>
      </article>
    </section>
  </>;
}
