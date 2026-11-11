import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import Icon from '../../components/ui/Icon';
import { AdminEmpty, AdminError, AdminLoading, AdminModal, AdminPageHeader } from '../../components/admin/AdminUI';

const reasons = [
  ['RESTOCK', 'Restock / delivery'],
  ['STOCK_COUNT', 'Physical stock count'],
  ['WASTE', 'Waste / spoilage'],
  ['DAMAGE', 'Damaged stock'],
  ['CORRECTION', 'Correction'],
  ['OTHER', 'Other'],
];

function stockState(stock, threshold, available = true) {
  if (!available) return { label: 'Unavailable', tone: 'inactive' };
  if (Number(stock) <= 0) return { label: 'Sold out', tone: 'sold-out' };
  if (Number(stock) <= Number(threshold || 0)) return { label: 'Low stock', tone: 'low-stock' };
  return { label: 'In stock', tone: 'in-stock' };
}

function StockBadge({ stock, threshold, available = true }) {
  const state = stockState(stock, threshold, available);
  return <span className={`inventory-status is-${state.tone}`}><i />{state.label}</span>;
}

function metric(label, value, detail, icon, tone = '') {
  return { label, value, detail, icon, tone };
}

export default function AdminInventory() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [target, setTarget] = useState(null);
  const [newStock, setNewStock] = useState('');
  const [reason, setReason] = useState('RESTOCK');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setData(await api.getAdminInventory()); }
    catch (requestError) { setError(requestError.message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    return data.products.filter(product => {
      const options = product.optionGroups?.flatMap(group => group.options.map(option => `${group.name} ${option.name}`)) || [];
      if (term && ![product.name, product.category, ...options].join(' ').toLowerCase().includes(term)) return false;
      const productState = stockState(product.stock, product.lowStockThreshold, product.isAvailable);
      const tracked = product.optionGroups?.flatMap(group => group.options.filter(option => option.trackStock)) || [];
      if (filter === 'low') return productState.tone === 'low-stock' || tracked.some(option => stockState(option.stock, option.lowStockThreshold, option.isAvailable).tone === 'low-stock');
      if (filter === 'sold') return productState.tone === 'sold-out' || tracked.some(option => stockState(option.stock, option.lowStockThreshold, option.isAvailable).tone === 'sold-out');
      if (filter === 'tracked') return tracked.length > 0;
      return true;
    });
  }, [data, search, filter]);

  const openProduct = product => {
    setTarget({ targetType: 'PRODUCT', productId: product.id, name: product.name, currentStock: product.stock, expectedVersion: product.inventoryVersion });
    setNewStock(String(product.stock)); setReason('RESTOCK'); setNote(''); setFormError('');
  };

  const openOption = (product, group, option) => {
    setTarget({ targetType: 'OPTION', productId: product.id, optionId: option.id, name: `${product.name} · ${group.name}: ${option.name}`, currentStock: option.stock, expectedVersion: option.inventoryVersion });
    setNewStock(String(option.stock)); setReason('RESTOCK'); setNote(''); setFormError('');
  };

  const closeModal = () => { if (!saving) { setTarget(null); setFormError(''); } };

  const submit = async event => {
    event.preventDefault();
    const stock = Number(newStock);
    if (!Number.isInteger(stock) || stock < 0 || stock > 1_000_000) { setFormError('Enter a whole-number stock level between 0 and 1,000,000.'); return; }
    setSaving(true); setFormError('');
    try {
      await api.adjustAdminInventory({
        targetType: target.targetType,
        productId: target.productId,
        ...(target.optionId ? { optionId: target.optionId } : {}),
        expectedVersion: target.expectedVersion,
        newStock: stock,
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setTarget(null);
      await load();
    } catch (requestError) {
      setFormError(requestError.message);
      await load().catch(() => {});
    } finally { setSaving(false); }
  };

  if (!data && !error) return <AdminLoading label="Loading live inventory…" />;
  if (error) return <AdminError message={error} retry={load} />;

  const { summary } = data;
  const metrics = [
    metric('Products', summary.productCount, `${summary.lowStockProducts} low stock`, 'products'),
    metric('Tracked options', summary.trackedOptionCount, `${summary.lowStockOptions} low stock`, 'activity', 'is-blue'),
    metric('Sold-out products', summary.soldOutProducts, 'Available menu products at zero', 'alert', 'is-orange'),
    metric('Sold-out options', summary.soldOutOptions, 'Tracked choices at zero', 'alert', 'is-gold'),
  ];

  return <>
    <AdminPageHeader eyebrow="Stock control" title="Inventory you can trust" description="Product and option stock is reserved atomically at checkout. Every manual change is version-checked and written to the inventory ledger." action={<button className="button button-secondary" onClick={load}><Icon name="refresh" />Refresh</button>} />

    <section className="admin-metrics inventory-metrics" aria-label="Inventory metrics">
      {metrics.map(card => <article className="admin-card metric-card" key={card.label}><span className={`metric-icon ${card.tone}`}><Icon name={card.icon} /></span><div><p>{card.label}</p><strong>{card.value}</strong><small>{card.detail}</small></div></article>)}
    </section>

    <div className="inventory-policy-note"><Icon name="shield" /><div><strong>Protected inventory workflow</strong><p>Use this page for live stock changes. Product editing controls pricing, availability and alert thresholds but does not overwrite current stock.</p></div></div>

    <div className="admin-toolbar">
      <label className="admin-search"><Icon name="search" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search products, variants or add-ons…" aria-label="Search inventory" /></label>
      <select value={filter} onChange={event => setFilter(event.target.value)} aria-label="Filter inventory"><option value="all">All inventory</option><option value="low">Low stock</option><option value="sold">Sold out</option><option value="tracked">Tracked options</option></select>
    </div>

    <section className="inventory-product-list">
      {rows.length ? rows.map(product => {
        const trackedGroups = (product.optionGroups || []).map(group => ({ ...group, options: group.options.filter(option => option.trackStock) })).filter(group => group.options.length);
        return <article className="admin-card inventory-product" key={product.id}>
          <div className="inventory-product-main">
            <div className="inventory-product-copy"><span className="inventory-product-category">{product.category}</span><h3>{product.name}</h3><p>Alert at {product.lowStockThreshold} · Max {product.maxPerOrder} per order</p></div>
            <div className="inventory-stock-block"><StockBadge stock={product.stock} threshold={product.lowStockThreshold} available={product.isAvailable} /><strong>{product.stock}</strong><small>product units</small></div>
            <button className="button button-secondary button-small" onClick={() => openProduct(product)}><Icon name="edit" size={16} />Adjust stock</button>
          </div>
          {trackedGroups.length ? <div className="inventory-options">
            {trackedGroups.flatMap(group => group.options.map(option => <div className="inventory-option-row" key={option.id}>
              <div><span>{group.name}</span><strong>{option.name}</strong></div>
              <StockBadge stock={option.stock} threshold={option.lowStockThreshold} available={option.isAvailable} />
              <div className="inventory-option-count"><strong>{option.stock}</strong><small>alert {option.lowStockThreshold}</small></div>
              <button className="admin-icon-action" onClick={() => openOption(product, group, option)} aria-label={`Adjust ${option.name} stock`}><Icon name="edit" size={16} /></button>
            </div>))}
          </div> : <div className="inventory-no-options"><Icon name="products" size={17} />No option-level stock tracking for this product.</div>}
        </article>;
      }) : <div className="admin-card"><AdminEmpty icon="products" title="No inventory matches" text="Change the search or filter to see other inventory." /></div>}
    </section>

    <section className="admin-card inventory-ledger-card">
      <div className="admin-card-header"><div><h3>Inventory adjustment ledger</h3><p>Latest 150 automatic reservations, cancellations and administrator adjustments.</p></div></div>
      {data.adjustments?.length ? <div className="admin-table-wrap"><table className="admin-table inventory-ledger"><thead><tr><th>When</th><th>Item</th><th>Source</th><th>Reason</th><th>Change</th><th>Balance</th><th>Actor</th></tr></thead><tbody>
        {data.adjustments.map(entry => <tr key={entry.id}><td>{formatDate(entry.createdAt)}</td><td><strong>{entry.product?.name || 'Product'}</strong>{entry.option && <small>{entry.option.group?.name}: {entry.option.name}</small>}</td><td>{entry.sourceType}</td><td>{entry.reason}</td><td><span className={entry.quantityDelta < 0 ? 'inventory-delta is-negative' : entry.quantityDelta > 0 ? 'inventory-delta is-positive' : 'inventory-delta'}>{entry.quantityDelta > 0 ? '+' : ''}{entry.quantityDelta}</span></td><td><strong>{entry.balanceAfter}</strong></td><td>{entry.actorLabel || 'System'}</td></tr>)}
      </tbody></table></div> : <AdminEmpty icon="activity" title="No inventory history yet" text="Reservations and stock adjustments will appear here." />}
    </section>

    {target && <AdminModal title="Adjust inventory" subtitle={target.name} onClose={closeModal}>
      <form className="admin-form" onSubmit={submit}>
        <div className="inventory-adjust-context"><div><span>Current stock</span><strong>{target.currentStock}</strong></div><Icon name="arrow" /><div><span>New stock</span><strong>{newStock === '' ? '—' : newStock}</strong></div></div>
        <div className="field"><label htmlFor="inventory-new-stock">New stock level</label><input id="inventory-new-stock" type="number" min="0" max="1000000" step="1" required value={newStock} onChange={event => setNewStock(event.target.value)} autoFocus /><small>Set the physical count. The server records the resulting +/− difference automatically.</small></div>
        <div className="field"><label htmlFor="inventory-reason">Reason</label><select id="inventory-reason" value={reason} onChange={event => setReason(event.target.value)}>{reasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div className="field"><label htmlFor="inventory-note">Internal note</label><textarea id="inventory-note" maxLength="240" value={note} onChange={event => setNote(event.target.value)} placeholder="Optional note for the audit trail" /></div>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="admin-form-footer"><button type="button" className="button button-secondary" disabled={saving} onClick={closeModal}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? 'Applying…' : 'Apply adjustment'}</button></div>
      </form>
    </AdminModal>}
  </>;
}
