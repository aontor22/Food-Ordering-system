import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import Icon from '../../components/ui/Icon';
import { AdminEmpty, AdminError, AdminLoading, AdminModal, AdminPageHeader, StatusBadge } from '../../components/admin/AdminUI';

const emptyForm = { code: '', percentOff: '10', minimum: '0', expiresAt: '', active: true };

export default function AdminCoupons() {
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setCoupons((await api.getAdminCoupons()).coupons); }
    catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const visible = useMemo(() => coupons.filter(coupon => coupon.code.toLowerCase().includes(search.toLowerCase())), [coupons, search]);

  const openCreate = () => { setEditing(null); setForm(emptyForm); setFormError(''); };
  const openEdit = coupon => { setEditing(coupon); setForm({ code: coupon.code, percentOff: String(coupon.percentOff), minimum: (coupon.minimumCents / 100).toFixed(2), expiresAt: coupon.expiresAt ? new Date(coupon.expiresAt).toISOString().slice(0, 16) : '', active: coupon.active }); setFormError(''); };
  const close = () => { setEditing(null); setForm(null); setFormError(''); };
  const update = event => setForm(previous => ({ ...previous, [event.target.name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  const save = async event => {
    event.preventDefault(); setSaving(true); setFormError('');
    const body = { code: form.code, percentOff: Number(form.percentOff), minimumCents: Math.round(Number(form.minimum) * 100), expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null, active: form.active };
    try { if (editing) await api.updateAdminCoupon(editing.id, body); else await api.createAdminCoupon(body); await load(); close(); }
    catch (requestError) { setFormError(requestError.message); }
    finally { setSaving(false); }
  };
  const disable = async coupon => {
    setError('');
    try { await api.archiveAdminCoupon(coupon.id); await load(); }
    catch (requestError) { setError(requestError.message); }
  };

  if (loading) return <AdminLoading label="Loading coupons…" />;
  if (error && !coupons.length) return <AdminError message={error} retry={load} />;

  return <>
    <AdminPageHeader eyebrow="Promotions" title={`${coupons.filter(coupon => coupon.active).length} active coupons`} description="Create controlled percentage discounts with minimum order values." action={<button className="button button-primary" onClick={openCreate}><Icon name="plus" />Create coupon</button>} />
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="admin-toolbar"><label className="admin-search"><Icon name="search" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search coupon code…" aria-label="Search coupons" /></label></div>
    <section className="admin-card">
      {visible.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Code</th><th>Discount</th><th>Minimum order</th><th>Expiry</th><th>Status</th><th className="align-right">Actions</th></tr></thead>
        <tbody>{visible.map(coupon => {
          const expired = coupon.expiresAt && new Date(coupon.expiresAt) < new Date();
          const status = !coupon.active ? 'INACTIVE' : expired ? 'EXPIRED' : 'ACTIVE';
          return <tr key={coupon.id}><td><strong>{coupon.code}</strong><small>Created {formatDate(coupon.createdAt)}</small></td><td><strong>{coupon.percentOff}% off</strong></td><td>{formatCurrency(coupon.minimumCents / 100)}</td><td>{coupon.expiresAt ? formatDate(coupon.expiresAt) : 'No expiry'}</td><td><StatusBadge value={status} /></td><td><div className="admin-table-actions"><button className="admin-icon-action" onClick={() => openEdit(coupon)} aria-label={`Edit ${coupon.code}`} title="Edit coupon"><Icon name="edit" size={17} /></button>{coupon.active && <button className="admin-icon-action is-danger" onClick={() => disable(coupon)} aria-label={`Disable ${coupon.code}`} title="Disable coupon"><Icon name="archive" size={17} /></button>}</div></td></tr>;
        })}</tbody>
      </table></div> : <AdminEmpty icon="coupon" title="No matching coupons" text="Create an offer or try another search term." />}
    </section>

    {form && <AdminModal title={editing ? `Edit ${editing.code}` : 'Create a coupon'} subtitle="Coupon codes are automatically saved in uppercase." onClose={close}>
      <form className="admin-form" onSubmit={save}>
        <div className="field"><label htmlFor="coupon-code">Coupon code</label><input id="coupon-code" name="code" required minLength="3" maxLength="30" pattern="[A-Za-z0-9_-]+" value={form.code} onChange={update} placeholder="SUMMER20" /></div>
        <div className="field-grid"><div className="field"><label htmlFor="coupon-percent">Discount percentage</label><input id="coupon-percent" name="percentOff" type="number" required min="1" max="100" step="1" value={form.percentOff} onChange={update} /></div><div className="field"><label htmlFor="coupon-minimum">Minimum order (USD)</label><input id="coupon-minimum" name="minimum" type="number" required min="0" step="0.01" value={form.minimum} onChange={update} /></div></div>
        <div className="field"><label htmlFor="coupon-expiry">Expiry date (optional)</label><input id="coupon-expiry" name="expiresAt" type="datetime-local" value={form.expiresAt} onChange={update} /></div>
        <label className="toggle-field"><div><p>Coupon is active</p><small>Inactive coupons cannot be used at checkout.</small></div><span className="switch"><input name="active" type="checkbox" checked={form.active} onChange={update} /><span /></span></label>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="admin-form-footer"><button type="button" className="button button-secondary" onClick={close}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create coupon'}</button></div>
      </form>
    </AdminModal>}
  </>;
}
