import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import Icon from '../../components/ui/Icon';
import { AdminError, AdminLoading, AdminPageHeader } from '../../components/admin/AdminUI';

export default function AdminLoyalty() {
  const [settings, setSettings] = useState(null);
  const [stats, setStats] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await api.getAdminLoyalty();
      setSettings(data.settings); setStats(data.stats);
      setForm({
        enabled: data.settings.enabled,
        pointsPerOrder: String(data.settings.pointsPerOrder),
        minimumRedeemPoints: String(data.settings.minimumRedeemPoints),
        pointValue: (data.settings.pointValueCents / 100).toFixed(2),
      });
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const update = event => setForm(previous => ({ ...previous, [event.target.name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  const save = async event => {
    event.preventDefault(); setSaving(true); setError(''); setMessage('');
    try {
      const body = {
        enabled: form.enabled,
        pointsPerOrder: Number(form.pointsPerOrder),
        minimumRedeemPoints: Number(form.minimumRedeemPoints),
        pointValueCents: Math.round(Number(form.pointValue) * 100),
      };
      const { settings: updated } = await api.updateAdminLoyalty(body);
      setSettings(updated); setMessage('Tomato Points settings saved. New orders will use these rules.');
      await load();
    } catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  };

  if (loading) return <AdminLoading label="Loading Tomato Points…" />;
  if (error && !settings) return <AdminError message={error} retry={load} />;

  return <>
    <AdminPageHeader eyebrow="Customer rewards" title="Tomato Points" description="Reward delivered orders and let customers redeem saved points for future discounts." action={<button className="button button-secondary" onClick={load}><Icon name="refresh" />Refresh</button>} />
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="form-success" role="status">{message}</p>}

    <div className="admin-metrics loyalty-metrics">
      <article><span className="metric-icon"><Icon name="gift" /></span><div><small>Outstanding points</small><strong>{stats?.outstandingPoints || 0}</strong><p>Current customer balances</p></div></article>
      <article><span className="metric-icon"><Icon name="users" /></span><div><small>Customers with points</small><strong>{stats?.customersWithPoints || 0}</strong><p>Balances above zero</p></div></article>
      <article><span className="metric-icon"><Icon name="trend" /></span><div><small>Points awarded</small><strong>{stats?.pointsEarned || 0}</strong><p>From delivered orders</p></div></article>
      <article><span className="metric-icon"><Icon name="coupon" /></span><div><small>Points redeemed</small><strong>{stats?.pointsRedeemed || 0}</strong><p>{stats?.pointsRestored ? `${stats.pointsRestored} later restored` : 'Used for discounts'}</p></div></article>
    </div>

    <section className="admin-card loyalty-settings-card">
      <div className="admin-card-header"><div><h3>Reward rules</h3><p>Changes apply to future redemptions and to orders when they become delivered.</p></div><span className={`status-badge status-${settings?.enabled ? 'active' : 'disabled'}`}><i />{settings?.enabled ? 'Active' : 'Paused'}</span></div>
      <form className="admin-form loyalty-form" onSubmit={save}>
        <label className="toggle-field"><div><p>Enable Tomato Points</p><small>When off, customers keep their balance but cannot earn or redeem points.</small></div><span className="switch"><input name="enabled" type="checkbox" checked={form.enabled} onChange={update} /><span /></span></label>
        <div className="field-grid">
          <div className="field"><label htmlFor="points-per-order">Points per delivered order</label><input id="points-per-order" name="pointsPerOrder" type="number" min="0" max="100000" step="1" required value={form.pointsPerOrder} onChange={update} /><small>Example: 5 means every completed delivery earns 5 points.</small></div>
          <div className="field"><label htmlFor="minimum-points">Minimum points for discount</label><input id="minimum-points" name="minimumRedeemPoints" type="number" min="1" max="1000000" step="1" required value={form.minimumRedeemPoints} onChange={update} /><small>Customers must reach this balance before redeeming.</small></div>
        </div>
        <div className="field"><label htmlFor="point-value">Value of 1 point ({settings?.currency || 'BDT'})</label><input id="point-value" name="pointValue" type="number" min="0.01" max="100000" step="0.01" required value={form.pointValue} onChange={update} /><small>Current value: {formatCurrency(Number(form.pointValue || 0), settings?.currency)} per point. Delivery fees are not discounted by points.</small></div>
        <div className="loyalty-example"><Icon name="spark" /><div><strong>Example</strong><p>If a customer has {form.minimumRedeemPoints || 0} points, those points are worth {formatCurrency((Number(form.minimumRedeemPoints || 0) * Number(form.pointValue || 0)), settings?.currency)} when redeemed, as long as the food subtotal after promo discounts is high enough.</p></div></div>
        <div className="admin-form-footer"><button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Save reward settings'}</button></div>
      </form>
    </section>
  </>;
}
