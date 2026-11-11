import { useContext, useEffect, useState } from 'react';
import { StoreContext } from '../../context/StoreContext';
import { api } from '../../lib/api';
import EmptyState from '../../components/ui/EmptyState';
import Icon from '../../components/ui/Icon';
import './Addresses.css';

const blankAddress = {
  label: 'Home', firstName: '', lastName: '', phone: '', street: '', city: '', state: '', postalCode: '', country: 'Bangladesh', isDefault: false,
};

const ADDRESS_TEXT_FIELDS = ['label', 'firstName', 'lastName', 'phone', 'street', 'city', 'state', 'postalCode', 'country'];

function normalizeAddressForm(form) {
  const normalized = { ...form };
  for (const key of ADDRESS_TEXT_FIELDS) normalized[key] = String(normalized[key] ?? '').trim();
  return normalized;
}

export default function Addresses({ onLogin }) {
  const { user } = useContext(StoreContext);
  const [addresses, setAddresses] = useState([]);
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(Boolean(user));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankAddress);

  const load = async () => {
    const data = await api.getAddresses();
    setAddresses(data.addresses || []);
    setLimit(data.limit || 10);
  };

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    setLoading(true); setError('');
    load().catch(requestError => setError(requestError.message)).finally(() => setLoading(false));
  }, [user?.id]);

  const startCreate = () => {
    const [firstName = '', ...rest] = String(user?.name || '').trim().split(/\s+/);
    setEditing('new');
    setForm({ ...blankAddress, firstName, lastName: rest.join(' '), isDefault: addresses.length === 0 });
  };

  const startEdit = address => {
    setEditing(address.id);
    setForm({
      label: address.label, firstName: address.firstName, lastName: address.lastName, phone: address.phone,
      street: address.street, city: address.city, state: address.state, postalCode: address.postalCode,
      country: address.country, isDefault: address.isDefault,
    });
  };

  const save = async event => {
    event.preventDefault();
    setBusy('save'); setError('');
    try {
      const payload = normalizeAddressForm(form);
      if (editing === 'new') await api.createAddress(payload);
      else {
        const { isDefault: _ignored, ...updates } = payload;
        await api.updateAddress(editing, updates);
      }
      await load();
      setEditing(null);
      setForm(blankAddress);
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(''); }
  };

  const makeDefault = async address => {
    if (address.isDefault) return;
    setBusy(`default:${address.id}`); setError('');
    try { await api.setDefaultAddress(address.id); await load(); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(''); }
  };

  const remove = async address => {
    if (!window.confirm(`Delete “${address.label}” from your saved addresses?`)) return;
    setBusy(`delete:${address.id}`); setError('');
    try {
      await api.deleteAddress(address.id);
      if (editing === address.id) setEditing(null);
      await load();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(''); }
  };

  if (!user) return <div className="empty-state surface-card"><span className="empty-state-icon">📍</span><h1>Sign in to save addresses</h1><p>Keep delivery locations in your account for faster checkout.</p><button className="button button-primary" onClick={onLogin}>Sign in</button></div>;

  return <div className="addresses-page">
    <header className="page-title addresses-title-row">
      <div><div className="section-kicker">Your account</div><h1>Saved addresses</h1><p>Keep trusted delivery details ready for a faster checkout.</p></div>
      <button className="button button-primary" type="button" onClick={startCreate} disabled={addresses.length >= limit}><Icon name="plus" />Add address</button>
    </header>

    {error && <p className="form-error" role="alert">{error}</p>}
    {addresses.length >= limit && <div className="address-limit-note"><Icon name="alert" size={17} />You have reached the {limit}-address limit. Edit or remove an address before adding another.</div>}

    {editing && <form className="address-editor surface-card" onSubmit={save}>
      <div className="address-editor-head"><div><h2>{editing === 'new' ? 'Add delivery address' : 'Edit delivery address'}</h2><p>Only you can view and use addresses saved to your account.</p></div><button type="button" className="icon-button" onClick={() => setEditing(null)} aria-label="Close address editor"><Icon name="close" /></button></div>
      <div className="field-grid">
        <div className="field"><label htmlFor="addressLabel">Label *</label><input id="addressLabel" value={form.label} onChange={event => setForm(previous => ({ ...previous, label: event.target.value }))} maxLength="30" required placeholder="Home, Work, Parents…" /></div>
        <div className="field"><label htmlFor="addressPhone">Phone *</label><input id="addressPhone" value={form.phone} onChange={event => setForm(previous => ({ ...previous, phone: event.target.value }))} type="tel" minLength="7" maxLength="24" required autoComplete="tel" /></div>
        <div className="field"><label htmlFor="addressFirstName">First name *</label><input id="addressFirstName" value={form.firstName} onChange={event => setForm(previous => ({ ...previous, firstName: event.target.value }))} maxLength="50" required autoComplete="given-name" /></div>
        <div className="field"><label htmlFor="addressLastName">Last name *</label><input id="addressLastName" value={form.lastName} onChange={event => setForm(previous => ({ ...previous, lastName: event.target.value }))} maxLength="50" required autoComplete="family-name" /></div>
      </div>
      <div className="field"><label htmlFor="addressStreet">Street address *</label><input id="addressStreet" value={form.street} onChange={event => setForm(previous => ({ ...previous, street: event.target.value }))} minLength="2" maxLength="150" required autoComplete="street-address" /></div>
      <div className="field-grid">
        <div className="field"><label htmlFor="addressCity">City *</label><input id="addressCity" value={form.city} onChange={event => setForm(previous => ({ ...previous, city: event.target.value }))} minLength="2" maxLength="80" required autoComplete="address-level2" /></div>
        <div className="field"><label htmlFor="addressState">State/Division *</label><input id="addressState" value={form.state} onChange={event => setForm(previous => ({ ...previous, state: event.target.value }))} minLength="2" maxLength="80" required autoComplete="address-level1" /></div>
        <div className="field"><label htmlFor="addressPostal">Postal code *</label><input id="addressPostal" value={form.postalCode} onChange={event => setForm(previous => ({ ...previous, postalCode: event.target.value }))} minLength="2" maxLength="20" required autoComplete="postal-code" /></div>
        <div className="field"><label htmlFor="addressCountry">Country *</label><input id="addressCountry" value={form.country} onChange={event => setForm(previous => ({ ...previous, country: event.target.value }))} minLength="2" maxLength="80" required autoComplete="country-name" /></div>
      </div>
      {editing === 'new' && <label className="address-default-checkbox"><input type="checkbox" checked={form.isDefault} onChange={event => setForm(previous => ({ ...previous, isDefault: event.target.checked }))} />Use as my default delivery address</label>}
      <div className="address-editor-actions"><button className="button button-primary" disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : editing === 'new' ? 'Save address' : 'Save changes'}</button><button className="button button-secondary" type="button" onClick={() => setEditing(null)}>Cancel</button></div>
    </form>}

    {loading ? <div className="addresses-loading"><span />Loading saved addresses…</div> : addresses.length ? <div className="address-grid">
      {addresses.map(address => <article className={`address-card surface-card ${address.isDefault ? 'is-default' : ''}`} key={address.id}>
        <div className="address-card-head"><span className="address-icon"><Icon name="location" /></span><div><h2>{address.label}</h2>{address.isDefault && <span className="address-default-badge">Default</span>}</div></div>
        <p className="address-recipient">{address.firstName} {address.lastName} · {address.phone}</p>
        <address>{address.street}<br />{address.city}, {address.state} {address.postalCode}<br />{address.country}</address>
        <div className="address-card-actions"><button type="button" onClick={() => startEdit(address)}><Icon name="edit" size={15} />Edit</button>{!address.isDefault && <button type="button" disabled={busy === `default:${address.id}`} onClick={() => makeDefault(address)}><Icon name="check" size={15} />{busy === `default:${address.id}` ? 'Saving…' : 'Make default'}</button>}<button className="danger" type="button" disabled={busy === `delete:${address.id}`} onClick={() => remove(address)}><Icon name="trash" size={15} />{busy === `delete:${address.id}` ? 'Deleting…' : 'Delete'}</button></div>
      </article>)}
    </div> : !editing && <EmptyState icon="📍" title="No saved addresses yet" text="Add a delivery address once and reuse it during checkout." />}
  </div>;
}
