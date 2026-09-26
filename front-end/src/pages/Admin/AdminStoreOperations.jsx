import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import Icon from '../../components/ui/Icon';
import { AdminError, AdminLoading, AdminPageHeader } from '../../components/admin/AdminUI';

function toForm(data) {
  return {
    timezone: data.settings.timezone,
    acceptingOrders: data.settings.acceptingOrders,
    temporaryClosed: data.settings.temporaryClosed,
    temporaryClosedReason: data.settings.temporaryClosedReason || '',
    temporaryClosedUntilLocal: data.settings.temporaryClosedUntilLocal || '',
    hours: data.hours.map(hour => ({
      dayOfWeek: hour.dayOfWeek,
      dayName: hour.dayName,
      isClosed: hour.isClosed,
      open24Hours: hour.open24Hours,
      openTime: hour.openTime,
      closeTime: hour.closeTime,
    })),
  };
}

export default function AdminStoreOperations() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [closure, setClosure] = useState({ dateKey: '', reason: '' });
  const [closureBusy, setClosureBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await api.getAdminStoreOperations();
      setData(result);
      setForm(toForm(result));
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateSetting = event => setForm(previous => ({
    ...previous,
    [event.target.name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value,
  }));

  const updateHour = (dayOfWeek, patch) => setForm(previous => ({
    ...previous,
    hours: previous.hours.map(hour => hour.dayOfWeek === dayOfWeek ? { ...hour, ...patch } : hour),
  }));

  const save = async event => {
    event.preventDefault(); setSaving(true); setError(''); setMessage('');
    try {
      const result = await api.updateAdminStoreOperations({
        timezone: form.timezone.trim(),
        acceptingOrders: form.acceptingOrders,
        temporaryClosed: form.temporaryClosed,
        temporaryClosedReason: form.temporaryClosedReason.trim() || null,
        temporaryClosedUntilLocal: form.temporaryClosedUntilLocal || null,
        hours: form.hours.map(({ dayOfWeek, isClosed, open24Hours, openTime, closeTime }) => ({ dayOfWeek, isClosed, open24Hours, openTime, closeTime })),
      });
      setData(result); setForm(toForm(result)); setMessage('Store availability settings saved. Checkout rules are active immediately.');
    } catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  };

  const addClosure = async event => {
    event.preventDefault(); setClosureBusy(true); setError(''); setMessage('');
    try {
      const result = await api.saveAdminStoreClosure({ dateKey: closure.dateKey, reason: closure.reason.trim() || null });
      setData(result); setForm(toForm(result)); setClosure({ dateKey: '', reason: '' }); setMessage('Special closure saved.');
    } catch (requestError) { setError(requestError.message); }
    finally { setClosureBusy(false); }
  };

  const removeClosure = async id => {
    setClosureBusy(true); setError(''); setMessage('');
    try { await api.deleteAdminStoreClosure(id); await load(); setMessage('Special closure removed.'); }
    catch (requestError) { setError(requestError.message); }
    finally { setClosureBusy(false); }
  };

  const closures = useMemo(() => (data?.closures || []).filter(item => !data?.status?.localDate || item.dateKey >= data.status.localDate), [data]);

  if (loading) return <AdminLoading label="Loading store availability…" />;
  if (error && !data) return <AdminError message={error} retry={load} />;

  return <>
    <AdminPageHeader eyebrow="Store operations" title="Opening hours & closures" description="Control when customers can place new orders. Menu browsing remains available while checkout is closed." action={<button className="button button-secondary" onClick={load}><Icon name="refresh" />Refresh</button>} />
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="form-success" role="status">{message}</p>}

    <section className={`store-live-card ${data.status.isOpen ? 'is-open' : 'is-closed'}`}>
      <span className="store-live-icon"><Icon name={data.status.isOpen ? 'check' : 'clock'} /></span>
      <div><small>Customer checkout status</small><h3>{data.status.headline}</h3><p>{data.status.message}</p></div>
      <div className="store-live-time"><strong>{data.status.localTime}</strong><small>{data.status.timezone}</small></div>
    </section>

    <form onSubmit={save} className="store-operations-form">
      <section className="admin-card store-settings-card">
        <div className="admin-card-header"><div><h3>Order controls</h3><p>Emergency pause overrides the weekly schedule and special closures.</p></div></div>
        <div className="admin-form store-settings-form">
          <label className="toggle-field"><div><p>Accept new orders</p><small>Turn this off to immediately block all new checkouts without hiding the menu.</small></div><span className="switch"><input name="acceptingOrders" type="checkbox" checked={form.acceptingOrders} onChange={updateSetting} /><span /></span></label>
          <label className="toggle-field"><div><p>Temporary closure</p><small>Use for maintenance, weather, kitchen issues, or an unscheduled break.</small></div><span className="switch"><input name="temporaryClosed" type="checkbox" checked={form.temporaryClosed} onChange={updateSetting} /><span /></span></label>
          {form.temporaryClosed && <div className="field-grid">
            <div className="field"><label htmlFor="temporaryClosedReason">Closure message</label><input id="temporaryClosedReason" name="temporaryClosedReason" maxLength="160" value={form.temporaryClosedReason} onChange={updateSetting} placeholder="e.g. Kitchen maintenance" /></div>
            <div className="field"><label htmlFor="temporaryClosedUntilLocal">Reopen automatically <span className="muted">(optional)</span></label><input id="temporaryClosedUntilLocal" name="temporaryClosedUntilLocal" type="datetime-local" value={form.temporaryClosedUntilLocal} onChange={updateSetting} /><small>Interpreted in the restaurant timezone below.</small></div>
          </div>}
          <div className="field"><label htmlFor="storeTimezone">Restaurant timezone</label><input id="storeTimezone" name="timezone" required value={form.timezone} onChange={updateSetting} placeholder="Asia/Dhaka" /><small>Use an IANA timezone such as Asia/Dhaka, Asia/Kolkata, Europe/London, or America/New_York.</small></div>
        </div>
      </section>

      <section className="admin-card store-hours-card">
        <div className="admin-card-header"><div><h3>Weekly opening hours</h3><p>Overnight windows are supported, for example 18:00 → 02:00.</p></div></div>
        <div className="weekly-hours-list">
          {form.hours.map(hour => <article className="weekly-hour-row" key={hour.dayOfWeek}>
            <strong>{hour.dayName}</strong>
            <label className="compact-check"><input type="checkbox" checked={hour.isClosed} onChange={event => updateHour(hour.dayOfWeek, { isClosed: event.target.checked, ...(event.target.checked ? { open24Hours: false } : {}) })} />Closed</label>
            <label className="compact-check"><input type="checkbox" disabled={hour.isClosed} checked={!hour.isClosed && hour.open24Hours} onChange={event => updateHour(hour.dayOfWeek, { open24Hours: event.target.checked })} />24 hours</label>
            <div className="hour-inputs">
              <input aria-label={`${hour.dayName} opening time`} type="time" disabled={hour.isClosed || hour.open24Hours} value={hour.openTime} onChange={event => updateHour(hour.dayOfWeek, { openTime: event.target.value })} />
              <span>to</span>
              <input aria-label={`${hour.dayName} closing time`} type="time" disabled={hour.isClosed || hour.open24Hours} value={hour.closeTime} onChange={event => updateHour(hour.dayOfWeek, { closeTime: event.target.value })} />
            </div>
          </article>)}
        </div>
      </section>

      <div className="store-save-bar"><p>Changes affect new orders immediately. Existing orders continue normally.</p><button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Save store hours'}</button></div>
    </form>

    <section className="admin-card store-closures-card">
      <div className="admin-card-header"><div><h3>Holiday & special closures</h3><p>Close an entire calendar date without changing your weekly schedule.</p></div></div>
      <form className="closure-add-form" onSubmit={addClosure}>
        <div className="field"><label htmlFor="closureDate">Closed date</label><input id="closureDate" type="date" required min={data.status.localDate} value={closure.dateKey} onChange={event => setClosure(previous => ({ ...previous, dateKey: event.target.value }))} /></div>
        <div className="field"><label htmlFor="closureReason">Reason <span className="muted">(optional)</span></label><input id="closureReason" maxLength="160" value={closure.reason} onChange={event => setClosure(previous => ({ ...previous, reason: event.target.value }))} placeholder="e.g. Eid holiday" /></div>
        <button className="button button-secondary" disabled={closureBusy || !closure.dateKey}><Icon name="calendar" />Add closure</button>
      </form>
      <div className="closure-list">
        {closures.length ? closures.map(item => <article key={item.id}><div><strong>{item.dateKey}</strong><p>{item.reason || 'Special closure'}</p></div><button type="button" className="button button-ghost button-small" disabled={closureBusy} onClick={() => removeClosure(item.id)}><Icon name="trash" size={15} />Remove</button></article>) : <p className="closure-empty">No upcoming special closures.</p>}
      </div>
    </section>
  </>;
}
