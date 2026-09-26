import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import Icon from '../../components/ui/Icon';
import { AdminEmpty, AdminError, AdminLoading, AdminPageHeader } from '../../components/admin/AdminUI';

const emptyZone = {
  name: '', description: '', postalCodes: '', fee: '0.00', minimumOrder: '0.00', freeDeliveryThreshold: '', active: true, sortOrder: '0',
};

function toForm(zone) {
  return {
    name: zone.name,
    description: zone.description || '',
    postalCodes: (zone.postalCodes || []).join(', '),
    fee: (zone.feeCents / 100).toFixed(2),
    minimumOrder: (zone.minimumOrderCents / 100).toFixed(2),
    freeDeliveryThreshold: zone.freeDeliveryThresholdCents == null ? '' : (zone.freeDeliveryThresholdCents / 100).toFixed(2),
    active: zone.active,
    sortOrder: String(zone.sortOrder || 0),
  };
}

function toPayload(form) {
  const amount = value => Math.max(0, Math.round((Number(value) || 0) * 100));
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    postalCodes: form.postalCodes.split(',').map(value => value.trim()).filter(Boolean),
    feeCents: amount(form.fee),
    minimumOrderCents: amount(form.minimumOrder),
    freeDeliveryThresholdCents: form.freeDeliveryThreshold === '' ? null : amount(form.freeDeliveryThreshold),
    active: Boolean(form.active),
    sortOrder: Math.max(0, Number.parseInt(form.sortOrder, 10) || 0),
  };
}

export default function AdminDeliveryZones() {
  const [data, setData] = useState(null);
  const [forms, setForms] = useState({});
  const [createForm, setCreateForm] = useState(emptyZone);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await api.getAdminDeliveryZones();
      setData(result);
      setForms(Object.fromEntries(result.zones.map(zone => [zone.id, toForm(zone)])));
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateCreate = event => setCreateForm(previous => ({
    ...previous,
    [event.target.name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value,
  }));

  const updateZone = (id, event) => setForms(previous => ({
    ...previous,
    [id]: { ...previous[id], [event.target.name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value },
  }));

  const createZone = async event => {
    event.preventDefault(); setBusy('create'); setError(''); setMessage('');
    try {
      await api.createAdminDeliveryZone(toPayload(createForm));
      setCreateForm(emptyZone);
      await load();
      setMessage('Delivery zone created. Checkout pricing updates immediately.');
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(''); }
  };

  const saveZone = async (id) => {
    setBusy(`save:${id}`); setError(''); setMessage('');
    try {
      await api.updateAdminDeliveryZone(id, toPayload(forms[id]));
      await load();
      setMessage('Delivery zone saved. New quotes and orders now use these rules.');
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(''); }
  };

  const archiveZone = async zone => {
    if (!window.confirm(`Disable delivery zone “${zone.name}”? Historical orders are not changed.`)) return;
    setBusy(`archive:${zone.id}`); setError(''); setMessage('');
    try {
      await api.archiveAdminDeliveryZone(zone.id);
      await load();
      setMessage('Delivery zone disabled.');
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(''); }
  };

  const currency = data?.currency || 'BDT';
  const activeZones = useMemo(() => data?.zones?.filter(zone => zone.active).length || 0, [data]);

  if (loading) return <AdminLoading label="Loading delivery zones…" />;
  if (error && !data) return <AdminError message={error} retry={load} />;

  return <>
    <AdminPageHeader
      eyebrow="Delivery operations"
      title="Delivery zones & fees"
      description="Set area-based delivery fees, minimum order values, free-delivery thresholds and optional postal-code coverage."
      action={<button className="button button-secondary" onClick={load}><Icon name="refresh" />Refresh</button>}
    />
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="form-success" role="status">{message}</p>}

    <div className="admin-metrics delivery-zone-metrics">
      <article><span className="metric-icon"><Icon name="delivery" /></span><div><small>Active zones</small><strong>{activeZones}</strong><p>Available at checkout</p></div></article>
      <article><span className="metric-icon"><Icon name="products" /></span><div><small>Total zones</small><strong>{data?.stats?.total || 0}</strong><p>Including disabled areas</p></div></article>
      <article><span className="metric-icon"><Icon name="store" /></span><div><small>Postal mapped</small><strong>{data?.stats?.postalMapped || 0}</strong><p>Zones with postcode validation</p></div></article>
      <article><span className="metric-icon"><Icon name="cash" /></span><div><small>Currency</small><strong>{currency}</strong><p>Fees use store currency</p></div></article>
    </div>

    <section className="admin-card delivery-zone-create-card">
      <div className="admin-card-header"><div><h3>Add delivery zone</h3><p>Create a service area. Leave postal codes empty if customers should select the area manually.</p></div></div>
      <ZoneForm form={createForm} onChange={updateCreate} currency={currency} submitLabel={busy === 'create' ? 'Creating…' : 'Create delivery zone'} onSubmit={createZone} disabled={Boolean(busy)} />
    </section>

    <div className="delivery-zone-list">
      {data?.zones?.length ? data.zones.map(zone => <section className={`admin-card delivery-zone-card ${zone.active ? '' : 'is-disabled'}`} key={zone.id}>
        <div className="admin-card-header delivery-zone-card-head"><div><div className="delivery-zone-title-row"><h3>{zone.name}</h3><span className={`status-badge status-${zone.active ? 'active' : 'disabled'}`}><i />{zone.active ? 'Active' : 'Disabled'}</span></div><p>{zone.description || 'No area description set.'}</p></div><strong>{zone.feeCents === 0 ? 'Free delivery' : formatCurrency(zone.feeCents / 100, currency)}</strong></div>
        <ZoneForm
          form={forms[zone.id] || toForm(zone)}
          onChange={event => updateZone(zone.id, event)}
          currency={currency}
          submitLabel={busy === `save:${zone.id}` ? 'Saving…' : 'Save zone'}
          onSubmit={event => { event.preventDefault(); saveZone(zone.id); }}
          disabled={Boolean(busy)}
          footerExtra={zone.active && <button type="button" className="button button-secondary" disabled={Boolean(busy)} onClick={() => archiveZone(zone)}>{busy === `archive:${zone.id}` ? 'Disabling…' : 'Disable zone'}</button>}
        />
      </section>) : <section className="admin-card"><AdminEmpty icon="delivery" title="No delivery zones" text="Create at least one zone so customers can check out." /></section>}
    </div>
  </>;
}

function ZoneForm({ form, onChange, currency, submitLabel, onSubmit, disabled, footerExtra }) {
  return <form className="admin-form delivery-zone-form" onSubmit={onSubmit}>
    <div className="field-grid">
      <div className="field"><label>Zone name</label><input name="name" minLength="2" maxLength="80" required value={form.name} onChange={onChange} placeholder="e.g. Mirpur" /></div>
      <div className="field"><label>Display order</label><input name="sortOrder" type="number" min="0" max="10000" step="1" required value={form.sortOrder} onChange={onChange} /></div>
    </div>
    <div className="field"><label>Area description</label><input name="description" maxLength="240" value={form.description} onChange={onChange} placeholder="e.g. Mirpur 1–14, Pallabi and nearby areas" /><small>Shown to customers below the delivery-area selector.</small></div>
    <div className="field"><label>Covered postal codes <span className="muted">(optional)</span></label><input name="postalCodes" value={form.postalCodes} onChange={onChange} placeholder="1216, 1212, 1207" /><small>Comma-separated. If configured, the server rejects an address whose postal code does not belong to the selected zone.</small></div>
    <div className="field-grid delivery-money-grid">
      <div className="field"><label>Delivery fee ({currency})</label><input name="fee" type="number" min="0" step="0.01" required value={form.fee} onChange={onChange} /></div>
      <div className="field"><label>Minimum food order ({currency})</label><input name="minimumOrder" type="number" min="0" step="0.01" required value={form.minimumOrder} onChange={onChange} /></div>
      <div className="field"><label>Free delivery from ({currency})</label><input name="freeDeliveryThreshold" type="number" min="0" step="0.01" value={form.freeDeliveryThreshold} onChange={onChange} placeholder="No free-delivery threshold" /></div>
    </div>
    <label className="toggle-field"><div><p>Zone available at checkout</p><small>Disable a zone without changing historical orders.</small></div><span className="switch"><input name="active" type="checkbox" checked={form.active} onChange={onChange} /><span /></span></label>
    <div className="delivery-zone-example"><Icon name="delivery" /><div><strong>Pricing rule</strong><p>Minimum order and free-delivery eligibility use the food subtotal before promo or points discounts. The final fee is always recalculated on the server.</p></div></div>
    <div className="admin-form-footer delivery-zone-footer">{footerExtra}<button className="button button-primary" disabled={disabled}>{submitLabel}</button></div>
  </form>;
}
