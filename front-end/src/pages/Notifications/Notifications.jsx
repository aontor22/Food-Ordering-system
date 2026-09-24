import { useContext, useEffect, useState } from 'react';
import { StoreContext } from '../../context/StoreContext';
import { api } from '../../lib/api';
import { browserPushSupported, disableBrowserPush, enableBrowserPush, getPushState } from '../../lib/push';
import Icon from '../../components/ui/Icon';
import EmptyState from '../../components/ui/EmptyState';
import './Notifications.css';

const eventOptions = [
  ['orderPlaced', 'Order received', 'Confirmation that Tomato received your order.'],
  ['orderConfirmed', 'Order confirmed', 'When the restaurant accepts your order.'],
  ['orderPreparing', 'Kitchen updates', 'When the kitchen starts preparing your food.'],
  ['orderReady', 'Ready / on the way', 'Pickup-ready and out-for-delivery updates.'],
  ['etaUpdates', 'ETA changes', 'Changes to kitchen or delivery estimates.'],
  ['orderDelivered', 'Completed orders', 'Confirmation when your order is delivered or collected.'],
  ['orderCancelled', 'Cancellations', 'Important cancellation confirmations.'],
];

function Toggle({ checked, disabled, onChange, label }) {
  return <button type="button" className={`notification-switch ${checked ? 'is-on' : ''}`} disabled={disabled} onClick={() => onChange(!checked)} aria-pressed={checked} aria-label={label}>
    <span />
  </button>;
}

export default function Notifications() {
  const { user } = useContext(StoreContext);
  const [data, setData] = useState(null);
  const [pushState, setPushState] = useState({ supported: browserPushSupported(), permission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported', subscribed: false });
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    const [notificationData, browserState] = await Promise.all([api.getNotifications(), getPushState().catch(() => pushState)]);
    setData(notificationData);
    setPushState(browserState);
  };

  useEffect(() => { if (user) load().catch(err => setError(err.message)); }, [user?.id]);

  if (!user) return <EmptyState icon="🔔" title="Sign in to manage notifications" text="Notification preferences are linked to your Tomato account." />;
  if (!data) return <div className="notification-page"><div className="notification-loading surface-card">Loading notification settings…</div></div>;

  const update = async patch => {
    setError(''); setMessage('');
    setData(previous => ({ ...previous, preference: { ...previous.preference, ...patch } }));
    try {
      const result = await api.updateNotificationPreferences(patch);
      setData(previous => ({ ...previous, preference: result.preference }));
    } catch (err) {
      setError(err.message);
      await load().catch(() => {});
    }
  };

  const enablePush = async () => {
    setBusy('push'); setError(''); setMessage('');
    try {
      await enableBrowserPush(data.capabilities.vapidPublicKey);
      await load();
      setMessage('Browser notifications are enabled on this device.');
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const disablePush = async () => {
    setBusy('push'); setError(''); setMessage('');
    try {
      await disableBrowserPush();
      await load();
      setMessage('Browser notifications are disabled on this device.');
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const sendTest = async channel => {
    setBusy(`test-${channel}`); setError(''); setMessage('');
    try { await api.sendTestNotification(channel); setMessage(`${channel === 'EMAIL' ? 'Email' : 'Browser'} test notification sent.`); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const { preference, capabilities } = data;
  const pushReady = capabilities.push && pushState.supported;
  const permissionDenied = pushState.permission === 'denied';

  return <section className="notification-page">
    <div className="page-title notification-page-title">
      <p className="section-kicker">Account preferences</p>
      <h1>Notifications</h1>
      <p>Choose how Tomato keeps you updated about active orders. Transactional order updates can be changed at any time.</p>
    </div>

    {(message || error) && <div className={`notification-message ${error ? 'is-error' : 'is-success'}`}>{error || message}</div>}

    <div className="notification-channel-grid">
      <article className="surface-card notification-channel-card">
        <div className="notification-channel-icon"><Icon name="mail" size={22} /></div>
        <div className="notification-channel-copy">
          <div className="notification-title-row"><h2>Email</h2><span className={`notification-state ${capabilities.email ? 'is-ready' : 'is-off'}`}>{capabilities.email ? 'Available' : 'Not configured'}</span></div>
          <p>Receive order status updates at <strong>{user.email}</strong>.</p>
        </div>
        <Toggle checked={preference.emailEnabled} disabled={!capabilities.email} label="Toggle email notifications" onChange={value => update({ emailEnabled: value })} />
        <button className="button button-secondary notification-test" disabled={!capabilities.email || !preference.emailEnabled || busy === 'test-EMAIL'} onClick={() => sendTest('EMAIL')}>{busy === 'test-EMAIL' ? 'Sending…' : 'Send test email'}</button>
      </article>

      <article className="surface-card notification-channel-card">
        <div className="notification-channel-icon"><Icon name="bell" size={22} /></div>
        <div className="notification-channel-copy">
          <div className="notification-title-row"><h2>Browser push</h2><span className={`notification-state ${pushState.subscribed ? 'is-ready' : 'is-off'}`}>{pushState.subscribed ? 'Enabled on this device' : permissionDenied ? 'Permission blocked' : pushReady ? 'Available' : 'Unavailable'}</span></div>
          <p>Get order updates even when this tab is not open. Permission is always requested by your browser.</p>
        </div>
        {pushState.subscribed ? <button className="button button-secondary" disabled={busy === 'push'} onClick={disablePush}>{busy === 'push' ? 'Updating…' : 'Disable on this device'}</button>
          : <button className="button button-primary" disabled={!pushReady || permissionDenied || busy === 'push'} onClick={enablePush}>{busy === 'push' ? 'Enabling…' : 'Enable browser notifications'}</button>}
        <button className="button button-ghost notification-test" disabled={!pushState.subscribed || !preference.pushEnabled || busy === 'test-PUSH'} onClick={() => sendTest('PUSH')}>{busy === 'test-PUSH' ? 'Sending…' : 'Send test push'}</button>
        {!pushState.supported && <small className="notification-hint">This browser/device does not expose the Web Push APIs. On iPhone/iPad, install the site to the Home Screen before enabling web push.</small>}
        {permissionDenied && <small className="notification-hint">Notification permission is blocked in your browser settings. Allow notifications for this site, then reload this page.</small>}
      </article>
    </div>

    <article className="surface-card notification-events-card">
      <div className="notification-events-header">
        <div><p className="section-kicker">Order events</p><h2>What should we notify you about?</h2></div>
        <p>These choices apply to every enabled channel.</p>
      </div>
      <div className="notification-events-list">
        {eventOptions.map(([key, title, description]) => <div className="notification-event-row" key={key}>
          <div><strong>{title}</strong><p>{description}</p></div>
          <Toggle checked={preference[key]} label={`Toggle ${title}`} onChange={value => update({ [key]: value })} />
        </div>)}
      </div>
    </article>

    <div className="notification-privacy-note"><Icon name="shield" size={18} /><p>Push subscriptions are tied to this signed-in account and device. Signing out removes this browser's push subscription from your account.</p></div>
  </section>;
}
