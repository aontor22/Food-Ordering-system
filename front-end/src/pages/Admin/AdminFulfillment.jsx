import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import Icon from '../../components/ui/Icon';
import { AdminError, AdminLoading, AdminPageHeader } from '../../components/admin/AdminUI';

const defaultOverride = { dateKey: '', timeKey: '18:00', fulfillmentType: 'DELIVERY', capacity: '', disabled: false, note: '' };

export default function AdminFulfillment() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [override, setOverride] = useState(defaultOverride);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [overrideBusy, setOverrideBusy] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await api.getAdminFulfillment();
      setData(result);
      setForm(result.settings);
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const update = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  const save = async event => {
    event.preventDefault();
    setSaving(true); setError(''); setSuccess('');
    try {
      const result = await api.updateAdminFulfillment({
        ...form,
        deliveryLeadMinutes: Number(form.deliveryLeadMinutes),
        pickupLeadMinutes: Number(form.pickupLeadMinutes),
        slotIntervalMinutes: Number(form.slotIntervalMinutes),
        daysAhead: Number(form.daysAhead),
        defaultSlotCapacity: Number(form.defaultSlotCapacity),
        pickupAddress: form.pickupAddress || null,
        pickupInstructions: form.pickupInstructions || null,
      });
      setData(result); setForm(result.settings); setSuccess('Fulfilment settings saved. New orders use these rules immediately.');
    } catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  };

  const saveOverride = async event => {
    event.preventDefault();
    setOverrideBusy('save'); setError(''); setSuccess('');
    try {
      await api.saveAdminFulfillmentSlotOverride({
        dateKey: override.dateKey,
        timeKey: override.timeKey,
        fulfillmentType: override.fulfillmentType,
        capacity: override.capacity === '' ? null : Number(override.capacity),
        disabled: override.disabled,
        note: override.note || null,
      });
      setOverride(defaultOverride);
      await load();
      setSuccess('Slot override saved.');
    } catch (requestError) { setError(requestError.message); }
    finally { setOverrideBusy(''); }
  };

  const removeOverride = async id => {
    setOverrideBusy(id); setError('');
    try { await api.deleteAdminFulfillmentSlotOverride(id); await load(); }
    catch (requestError) { setError(requestError.message); }
    finally { setOverrideBusy(''); }
  };

  const preview = useMemo(() => {
    if (!data?.preview?.options) return [];
    return ['DELIVERY', 'PICKUP'].map(type => ({ type, ...data.preview.options[type] }));
  }, [data]);

  if (loading) return <AdminLoading label="Loading fulfilment scheduling…" />;
  if (!form) return <AdminError message={error || 'Fulfilment settings could not be loaded'} retry={load} />;

  return <>
    <AdminPageHeader eyebrow="Fulfilment scheduling" title="Delivery & pickup timing" description="Control ASAP ordering, scheduled slots, preparation lead time and per-slot capacity." action={<button className="button button-secondary" onClick={load}><Icon name="refresh" />Refresh</button>} />
    {error && <p className="form-error" role="alert">{error}</p>}
    {success && <p className="form-success">{success}</p>}

    <section className="fulfillment-preview-grid">
      {preview.map(item => <article className="admin-card fulfillment-preview" key={item.type}>
        <div className="fulfillment-preview-icon"><Icon name={item.type === 'DELIVERY' ? 'delivery' : 'store'} /></div>
        <div><small>{item.type === 'DELIVERY' ? 'Delivery' : 'Pickup'}</small><strong>{item.enabled ? 'Enabled' : 'Disabled'}</strong><p>{item.asapAvailable ? `ASAP available · about ${item.asapEtaMinutes} min` : 'ASAP unavailable'} · {item.slots?.length || 0} scheduled slots visible</p></div>
      </article>)}
    </section>

    <form className="admin-card fulfillment-settings-card" onSubmit={save}>
      <div className="admin-card-header"><div><h3>Ordering methods</h3><p>Choose which fulfilment modes customers can use and how far ahead they can book.</p></div></div>
      <div className="fulfillment-settings-body">
        <div className="fulfillment-toggle-grid">
          <Toggle title="Delivery" text="Customers can order to an enabled delivery zone." checked={form.deliveryEnabled} onChange={value => update('deliveryEnabled', value)} />
          <Toggle title="Pickup" text="Customers can collect orders from your restaurant." checked={form.pickupEnabled} onChange={value => update('pickupEnabled', value)} />
          <Toggle title="ASAP orders" text="Allow immediate orders while the restaurant is open." checked={form.asapEnabled} onChange={value => update('asapEnabled', value)} />
          <Toggle title="Scheduled orders" text="Let customers reserve a future available slot." checked={form.scheduledEnabled} onChange={value => update('scheduledEnabled', value)} />
        </div>

        <div className="fulfillment-number-grid">
          <NumberField label="Delivery lead time" value={form.deliveryLeadMinutes} suffix="minutes" min="0" max="720" onChange={value => update('deliveryLeadMinutes', value)} />
          <NumberField label="Pickup lead time" value={form.pickupLeadMinutes} suffix="minutes" min="0" max="720" onChange={value => update('pickupLeadMinutes', value)} />
          <NumberField label="Slot interval" value={form.slotIntervalMinutes} suffix="minutes" min="15" max="180" onChange={value => update('slotIntervalMinutes', value)} />
          <NumberField label="Booking horizon" value={form.daysAhead} suffix="days" min="1" max="30" onChange={value => update('daysAhead', value)} />
          <NumberField label="Default slot capacity" value={form.defaultSlotCapacity} suffix="orders" min="1" max="500" onChange={value => update('defaultSlotCapacity', value)} />
        </div>

        <div className="field"><label htmlFor="pickupAddress">Pickup address</label><input id="pickupAddress" maxLength="300" value={form.pickupAddress || ''} onChange={event => update('pickupAddress', event.target.value)} placeholder="Restaurant address customers should visit" /></div>
        <div className="field"><label htmlFor="pickupInstructions">Pickup instructions</label><textarea id="pickupInstructions" maxLength="500" value={form.pickupInstructions || ''} onChange={event => update('pickupInstructions', event.target.value)} placeholder="Where to collect, what to show, parking notes…" /></div>
      </div>
      <div className="store-save-bar"><p>Scheduled capacity is checked again when the order is created, so a full slot cannot be overbooked by normal checkout requests.</p><button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Save fulfilment settings'}</button></div>
    </form>

    <section className="admin-card fulfillment-overrides-card">
      <div className="admin-card-header"><div><h3>Slot overrides</h3><p>Close a specific time or change its capacity without changing the global schedule.</p></div></div>
      <form className="fulfillment-override-form" onSubmit={saveOverride}>
        <div className="field"><label>Date</label><input type="date" required value={override.dateKey} onChange={event => setOverride(previous => ({ ...previous, dateKey: event.target.value }))} /></div>
        <div className="field"><label>Time</label><input type="time" required value={override.timeKey} onChange={event => setOverride(previous => ({ ...previous, timeKey: event.target.value }))} /></div>
        <div className="field"><label>Method</label><select value={override.fulfillmentType} onChange={event => setOverride(previous => ({ ...previous, fulfillmentType: event.target.value }))}><option value="DELIVERY">Delivery</option><option value="PICKUP">Pickup</option></select></div>
        <div className="field"><label>Capacity <span className="muted">(blank = default)</span></label><input type="number" min="1" max="500" value={override.capacity} onChange={event => setOverride(previous => ({ ...previous, capacity: event.target.value }))} /></div>
        <div className="field fulfillment-override-note"><label>Note</label><input maxLength="160" value={override.note} onChange={event => setOverride(previous => ({ ...previous, note: event.target.value }))} placeholder="Dinner rush, private event…" /></div>
        <label className="fulfillment-disable-slot"><input type="checkbox" checked={override.disabled} onChange={event => setOverride(previous => ({ ...previous, disabled: event.target.checked }))} />Close this slot</label>
        <button className="button button-secondary" disabled={overrideBusy === 'save'}>{overrideBusy === 'save' ? 'Saving…' : 'Save override'}</button>
      </form>

      <div className="fulfillment-override-list">
        {data.overrides?.length ? data.overrides.map(item => <article key={item.id}><div><strong>{item.dateKey} · {displayTime(item.timeKey)}</strong><p>{item.fulfillmentType === 'PICKUP' ? 'Pickup' : 'Delivery'} · {item.disabled ? 'Closed' : item.capacity ? `Capacity ${item.capacity}` : 'Default capacity'}{item.note ? ` · ${item.note}` : ''}</p></div><button className="button button-ghost button-small" disabled={Boolean(overrideBusy)} onClick={() => removeOverride(item.id)}><Icon name="trash" size={15} />Remove</button></article>) : <p className="closure-empty">No slot overrides configured.</p>}
      </div>
    </section>
  </>;
}

function Toggle({ title, text, checked, onChange }) {
  return <div className="toggle-field"><div><p>{title}</p><small>{text}</small></div><label className="switch"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /><span /></label></div>;
}

function NumberField({ label, value, suffix, onChange, ...props }) {
  return <div className="field"><label>{label}</label><div className="fulfillment-number"><input type="number" required value={value} onChange={event => onChange(event.target.value)} {...props} /><span>{suffix}</span></div></div>;
}

function displayTime(value) {
  const [hour, minute] = String(value || '00:00').split(':').map(Number);
  const period = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${period}`;
}
