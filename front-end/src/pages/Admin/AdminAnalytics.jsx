import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import Icon from '../../components/ui/Icon';
import { AdminEmpty, AdminError, AdminLoading, AdminPageHeader } from '../../components/admin/AdminUI';

const exportOptions = [
  ['daily-sales', 'Daily sales'],
  ['orders', 'Orders'],
  ['products', 'Products'],
  ['customers', 'Customers'],
];

function money(cents) { return formatCurrency((cents || 0) / 100); }
function percent(value) { return `${Number(value || 0).toFixed(1)}%`; }
function duration(minutes) {
  if (!minutes) return '—';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h${mins ? ` ${mins}m` : ''}`;
}

function MixList({ rows = [], moneyMode = false, empty = 'No activity in this period.' }) {
  if (!rows.length) return <p className="muted analytics-empty-copy">{empty}</p>;
  const max = Math.max(1, ...rows.map(row => moneyMode ? row.revenueCents : row.count));
  return <div className="analytics-mix-list">{rows.map(row => {
    const value = moneyMode ? row.revenueCents : row.count;
    return <div className="analytics-mix-row" key={row.label}>
      <div><strong>{row.label}</strong><span>{moneyMode ? `${row.count} orders · ${money(row.revenueCents)}` : `${row.count} · ${percent(row.sharePercent)}`}</span></div>
      <span className="progress-track"><i style={{ width: `${(value / max) * 100}%` }} /></span>
    </div>;
  })}</div>;
}

export default function AdminAnalytics() {
  const [query, setQuery] = useState({ days: 30 });
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const next = await api.getAdminAnalytics(query);
      setData(next);
      setCustomFrom(next.range.from);
      setCustomTo(next.range.to);
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, [query]);

  useEffect(() => { load(); }, [load]);

  const maxRevenue = useMemo(() => Math.max(1, ...(data?.salesSeries || []).map(day => day.revenueCents)), [data]);
  const chartStep = useMemo(() => Math.max(1, Math.ceil((data?.salesSeries?.length || 1) / 12)), [data]);

  const usePreset = days => setQuery({ days });
  const applyCustom = event => {
    event.preventDefault();
    if (!customFrom || !customTo) return;
    setQuery({ from: customFrom, to: customTo });
  };
  const download = async type => {
    setExporting(type); setError('');
    try { await api.downloadAdminAnalyticsCsv(type, { from: data.range.from, to: data.range.to }); }
    catch (requestError) { setError(requestError.message); }
    finally { setExporting(''); }
  };

  if (loading && !data) return <AdminLoading label="Building analytics…" />;
  if (error && !data) return <AdminError message={error} retry={load} />;
  if (!data) return null;

  const { metrics } = data;
  const metricCards = [
    ['Recognized revenue', money(metrics.revenueCents), `${metrics.deliveredOrders} delivered orders`, 'trend'],
    ['Average order value', money(metrics.averageOrderValueCents), `${metrics.unitsSold} units sold`, 'cash'],
    ['Orders placed', metrics.ordersPlaced, `${percent(metrics.cancellationRatePercent)} cancelled`, 'orders'],
    ['Ordering customers', metrics.uniqueOrderingCustomers, `${percent(metrics.repeatCustomerRatePercent)} repeat`, 'users'],
    ['Guest order share', percent(metrics.guestOrderSharePercent), `${metrics.guestOrders} guest · ${metrics.registeredOrders} registered`, 'user'],
    ['Avg. fulfillment', duration(metrics.averageFulfillmentMinutes), `${metrics.newCustomers} new accounts`, 'clock'],
  ];

  return <>
    <AdminPageHeader
      eyebrow="Business intelligence"
      title="Sales & customer analytics"
      description={`Reporting in ${data.range.timezone} · ${data.range.from} to ${data.range.to}`}
      action={<button className="button button-secondary" onClick={load} disabled={loading}><Icon name="refresh" />{loading ? 'Refreshing…' : 'Refresh'}</button>}
    />

    {error && <p className="form-error" role="alert">{error}</p>}

    <section className="admin-card analytics-controls">
      <div className="analytics-presets" aria-label="Analytics period">
        {[7, 30, 90].map(days => <button key={days} className={`button button-small ${query.days === days ? 'button-primary' : 'button-secondary'}`} onClick={() => usePreset(days)}>{days} days</button>)}
      </div>
      <form className="analytics-custom-range" onSubmit={applyCustom}>
        <label><span>From</span><input type="date" value={customFrom} onChange={event => setCustomFrom(event.target.value)} /></label>
        <label><span>To</span><input type="date" value={customTo} onChange={event => setCustomTo(event.target.value)} /></label>
        <button className="button button-secondary" type="submit">Apply custom</button>
      </form>
      <div className="analytics-export-actions">
        {exportOptions.map(([type, label]) => <button key={type} className="button button-secondary button-small" disabled={Boolean(exporting) || loading} onClick={() => download(type)}><Icon name="download" size={16} />{exporting === type ? 'Exporting…' : `${label} CSV`}</button>)}
      </div>
    </section>

    <section className="admin-metrics analytics-metrics" aria-label="Analytics summary">
      {metricCards.map(([label, value, detail, icon]) => <article className="admin-card metric-card" key={label}>
        <span className="metric-icon"><Icon name={icon} size={22} /></span>
        <div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div>
      </article>)}
    </section>

    <section className="admin-grid analytics-primary-grid">
      <article className="admin-card analytics-revenue-card">
        <div className="admin-card-header"><div><h3>Delivered revenue trend</h3><p>Revenue is recognized when orders reach Delivered.</p></div><strong>{money(metrics.revenueCents)}</strong></div>
        <div className="analytics-chart-scroll">
          <div className="analytics-revenue-chart" style={{ minWidth: `${Math.max(620, data.salesSeries.length * 22)}px` }}>
            {data.salesSeries.map((day, index) => <div className="analytics-revenue-bar" key={day.date} title={`${day.date}: ${money(day.revenueCents)} · ${day.orders} orders`}>
              <div style={{ height: `${Math.max(3, (day.revenueCents / maxRevenue) * 150)}px` }} />
              <span>{index % chartStep === 0 || index === data.salesSeries.length - 1 ? day.date.slice(5) : ''}</span>
            </div>)}
          </div>
        </div>
        <div className="analytics-sales-foot"><span>Subtotal <strong>{money(metrics.subtotalCents)}</strong></span><span>Delivery fees <strong>{money(metrics.deliveryFeesCents)}</strong></span><span>Discounts <strong>{money(metrics.discountsCents)}</strong></span></div>
      </article>

      <article className="admin-card">
        <div className="admin-card-header"><div><h3>Payment mix</h3><p>Delivered-order revenue by payment method.</p></div></div>
        <MixList rows={data.paymentMix} moneyMode />
      </article>
    </section>

    <section className="admin-grid equal">
      <article className="admin-card">
        <div className="admin-card-header"><div><h3>Fulfillment mix</h3><p>How customers chose to receive orders.</p></div></div>
        <MixList rows={data.fulfillmentMix} />
      </article>
      <article className="admin-card">
        <div className="admin-card-header"><div><h3>Scheduling mix</h3><p>ASAP versus scheduled demand.</p></div></div>
        <MixList rows={data.schedulingMix} />
      </article>
    </section>

    <section className="admin-card analytics-table-card">
      <div className="admin-card-header"><div><h3>Top product performance</h3><p>Delivered units and revenue in the selected period.</p></div></div>
      {data.topProducts.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Product</th><th>Category</th><th>Units</th><th>Orders</th><th>Rating</th><th>Wishlists</th><th className="align-right">Revenue</th></tr></thead><tbody>
        {data.topProducts.map(product => <tr key={product.id}><td><strong>{product.name}</strong></td><td>{product.category}</td><td><strong>{product.units}</strong></td><td>{product.orderCount}</td><td>{product.reviewCount ? `${product.ratingAverage.toFixed(1)} ★` : '—'}</td><td>{product.wishlistCount}</td><td className="align-right"><strong>{money(product.revenueCents)}</strong></td></tr>)}
      </tbody></table></div> : <AdminEmpty icon="products" title="No delivered product sales" text="Product performance appears after orders are delivered in this period." />}
    </section>

    <section className="admin-grid equal analytics-lower-grid">
      <article className="admin-card">
        <div className="admin-card-header"><div><h3>Top customers</h3><p>Delivered value in the selected period.</p></div></div>
        {data.topCustomers.length ? <div className="analytics-ranked-list">{data.topCustomers.map((customer, index) => <div key={customer.id}><span className="analytics-rank">#{index + 1}</span><div><strong>{customer.name || 'Customer'}</strong><small>{customer.email} · {customer.customerType === 'GUEST' ? 'Guest-origin' : customer.customerType === 'MIXED' ? 'Mixed origin' : 'Registered'}</small></div><span><strong>{money(customer.revenueCents)}</strong><small>{customer.deliveredOrders} delivered</small></span></div>)}</div> : <p className="muted analytics-empty-copy">No delivered customer sales in this period.</p>}
      </article>
      <article className="admin-card">
        <div className="admin-card-header"><div><h3>Category performance</h3><p>Revenue contribution by menu category.</p></div></div>
        {data.categoryPerformance.length ? <div className="analytics-ranked-list">{data.categoryPerformance.map((category, index) => <div key={category.category}><span className="analytics-rank">#{index + 1}</span><div><strong>{category.category}</strong><small>{category.units} units · {category.products} products</small></div><span><strong>{money(category.revenueCents)}</strong></span></div>)}</div> : <p className="muted analytics-empty-copy">No category sales in this period.</p>}
      </article>
    </section>

    <section className="admin-card analytics-table-card">
      <div className="admin-card-header"><div><h3>Low-velocity active products</h3><p>Active products with the fewest delivered units in this period. Zero sales remain visible.</p></div></div>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Product</th><th>Category</th><th>Units sold</th><th>Orders</th><th>Current stock</th><th className="align-right">Revenue</th></tr></thead><tbody>
        {data.slowProducts.map(product => <tr key={product.id}><td><strong>{product.name}</strong></td><td>{product.category}</td><td>{product.units}</td><td>{product.orderCount}</td><td>{product.stock}</td><td className="align-right"><strong>{money(product.revenueCents)}</strong></td></tr>)}
      </tbody></table></div>
    </section>
  </>;
}
