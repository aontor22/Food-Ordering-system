import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

const empty = { provider: 'BKASH', label: '', account: '', instructions: '', active: true };
export default function ManualPaymentChannels() {
  const [channels, setChannels] = useState([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [currency, setCurrency] = useState('');
  const load = async () => { try { const data = await api.getPaymentChannels(); setChannels(data.channels); setCurrency(data.currency); } catch (e) { setError(e.message); } };
  useEffect(() => { load(); }, []);
  const save = async event => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { await api.savePaymentChannel(editing, form); await load(); setForm(empty); setEditing(''); setMessage('Payment account saved. Enabled accounts appear at checkout.'); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <details className="admin-card manual-channel-settings">
    <summary>Manual payment accounts & instructions</summary>
    <p>Add the merchant or bank accounts customers should pay. Changes apply to new orders; existing orders keep their original instructions.</p>
    <p>Store currency: <strong>{currency || 'Loading…'}</strong>. bKash, Nagad and Rocket require BDT. Changing currency does not convert product prices.</p>
    {channels.length ? <div className="manual-channel-list">{channels.map(channel => <article key={channel.id}><div><strong>{channel.label} · {channel.provider}</strong><p>{channel.account} · {channel.active ? 'Enabled' : 'Disabled'}</p></div><button className="button button-secondary button-small" type="button" onClick={() => { setEditing(channel.id); setForm({ provider: channel.provider, label: channel.label, account: channel.account, instructions: channel.instructions, active: channel.active }); setMessage(''); }}>Edit</button></article>)}</div> : <p>No accounts configured. Add one below to enable manual checkout.</p>}
    <form onSubmit={save} className="manual-channel-form">
      <h3>{editing ? 'Edit payment account' : 'Add payment account'}</h3>
      <div className="field-grid"><div className="field"><label htmlFor="channel-provider">Provider</label><select id="channel-provider" value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value })}>{['BKASH','NAGAD','ROCKET','BANK'].map(p => <option key={p}>{p}</option>)}</select></div><div className="field"><label htmlFor="channel-label">Customer-facing name</label><input id="channel-label" required minLength={2} maxLength={80} placeholder="e.g. bKash Merchant" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} /></div></div>
      <div className="field"><label htmlFor="channel-account">Merchant number / bank account</label><input id="channel-account" required minLength={5} maxLength={100} value={form.account} onChange={e => setForm({ ...form, account: e.target.value })} /></div>
      <div className="field"><label htmlFor="channel-instructions">Payment instructions</label><textarea id="channel-instructions" required minLength={5} maxLength={1000} placeholder="Include account holder/bank details and the payment steps customers should follow." value={form.instructions} onChange={e => setForm({ ...form, instructions: e.target.value })} /></div>
      <label className="manual-checkbox"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />Enable for new orders</label>
      {error && <p className="form-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      <div className="order-actions"><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save account'}</button>{editing && <button type="button" className="button button-secondary" onClick={() => { setForm(empty); setEditing(''); }}>Cancel edit</button>}</div>
    </form>
  </details>;
}
