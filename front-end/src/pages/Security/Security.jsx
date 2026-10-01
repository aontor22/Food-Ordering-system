import { useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StoreContext } from '../../context/StoreContext';
import { api } from '../../lib/api';
import Icon from '../../components/ui/Icon';
import './Security.css';

function when(value) {
  if (!value) return 'Unknown';
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
  catch { return String(value); }
}

export default function Security() {
  const { user, clearLocalAuth } = useContext(StoreContext);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [recovery, setRecovery] = useState({ currentPassword: '', code: '' });
  const [newRecoveryCodes, setNewRecoveryCodes] = useState([]);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try { setSessions((await api.getSessions()).sessions || []); }
    catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (user) load(); }, [user?.id]);

  if (!user) return <section className="security-empty surface-card"><Icon name="shield" size={34} /><h1>Sign in to manage account security</h1><p>Session controls and password management are available after authentication.</p><Link className="button button-primary" to="/">Return home</Link></section>;

  const revoke = async session => {
    setBusy(`session:${session.id}`); setError('');
    try {
      const result = await api.revokeSession(session.id);
      if (result.current) { clearLocalAuth(); return; }
      await load();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(''); }
  };

  const revokeOthers = async () => {
    setBusy('others'); setError('');
    try { const result = await api.revokeOtherSessions(); setNotice(`${result.revoked} other session${result.revoked === 1 ? '' : 's'} revoked.`); await load(); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(''); }
  };

  const changePassword = async event => {
    event.preventDefault(); setError(''); setNotice('');
    if (passwords.newPassword !== passwords.confirm) { setError('New passwords do not match.'); return; }
    setBusy('password');
    try {
      const result = await api.changePassword({ currentPassword: passwords.currentPassword, newPassword: passwords.newPassword });
      setNotice(result.message);
      clearLocalAuth();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(''); }
  };

  const regenerate = async event => {
    event.preventDefault(); setError(''); setNotice(''); setBusy('recovery');
    try {
      const result = await api.regenerateAdminRecoveryCodes(recovery);
      setNewRecoveryCodes(result.recoveryCodes || []);
      setRecovery({ currentPassword: '', code: '' });
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(''); }
  };

  return <section className="security-page">
    <div className="security-heading"><div><div className="section-kicker">Account protection</div><h1>Security & sessions</h1><p>Review signed-in devices, change your password, and manage administrator recovery credentials.</p></div><span className="security-badge"><Icon name="shield" size={20} />{user.emailVerified ? 'Verified account' : user.emailVerificationRequired ? 'Email unverified' : 'Verification not required'}</span></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="security-notice" role="status">{notice}</p>}

    <div className="security-grid">
      <article className="surface-card security-card security-card-wide">
        <div className="security-card-title"><div><h2>Active sessions</h2><p>Revoking a session invalidates its session-bound access token on the next request.</p></div><button className="button button-secondary" onClick={revokeOthers} disabled={busy === 'others'}>Sign out other devices</button></div>
        {loading ? <p>Loading sessions…</p> : <div className="security-session-list">{sessions.map(session => <div className="security-session" key={session.id}><span className="security-device-icon"><Icon name="user" /></span><div><strong>{session.device}{session.current ? ' · This device' : ''}</strong><small>{session.ipAddress || 'IP unavailable'} · Last active {when(session.lastSeenAt)}</small><small>Signed in {when(session.createdAt)} · Expires {when(session.expiresAt)}{session.mfaVerified ? ' · 2FA verified' : ''}</small></div><button className="button button-secondary" onClick={() => revoke(session)} disabled={busy === `session:${session.id}`}>{session.current ? 'Sign out' : 'Revoke'}</button></div>)}</div>}
      </article>

      <article className="surface-card security-card">
        <h2>Password</h2><p>Changing your password revokes every active device session.</p>
        <form onSubmit={changePassword}>
          <div className="field"><label htmlFor="security-current-password">Current password</label><input id="security-current-password" type="password" autoComplete="current-password" required value={passwords.currentPassword} onChange={event => setPasswords(value => ({ ...value, currentPassword: event.target.value }))} /></div>
          <div className="field"><label htmlFor="security-new-password">New password</label><input id="security-new-password" type="password" minLength="12" maxLength="72" autoComplete="new-password" required value={passwords.newPassword} onChange={event => setPasswords(value => ({ ...value, newPassword: event.target.value }))} /></div>
          <div className="field"><label htmlFor="security-confirm-password">Confirm new password</label><input id="security-confirm-password" type="password" minLength="12" maxLength="72" autoComplete="new-password" required value={passwords.confirm} onChange={event => setPasswords(value => ({ ...value, confirm: event.target.value }))} /></div>
          <button className="button button-primary" disabled={busy === 'password'}>{busy === 'password' ? 'Changing…' : 'Change password'}</button>
        </form>
      </article>

      <article className="surface-card security-card">
        <h2>Email & two-factor</h2>
        <div className="security-status-row"><span>Email</span><strong>{user.email}</strong></div>
        <div className="security-status-row"><span>Verification</span><strong>{user.emailVerified ? 'Verified' : user.emailVerificationRequired ? 'Pending' : 'Not required currently'}</strong></div>
        {user.role === 'ADMIN'
          ? <><div className="security-status-row"><span>Admin 2FA</span><strong>{user.twoFactorEnabled ? 'Required · enabled' : 'Setup required'}</strong></div><p className="security-help">Admin 2FA cannot be disabled from the application. If you replace your authenticator, generate fresh recovery codes while you still have access.</p></>
          : <><div className="security-status-row"><span>Authenticator 2FA</span><strong>Administrator accounts only</strong></div><p className="security-help">Customer accounts use password or Google sign-in. Email verification can be required by the server when production mail is ready; authenticator codes remain administrator-only.</p></>}
      </article>

      {user.role === 'ADMIN' && user.twoFactorEnabled && <article className="surface-card security-card security-card-wide">
        <h2>Regenerate admin recovery codes</h2><p>This invalidates every previous recovery code. Confirm your password and a fresh authenticator code.</p>
        <form className="security-inline-form" onSubmit={regenerate}><div className="field"><label htmlFor="security-recovery-password">Current password</label><input id="security-recovery-password" type="password" autoComplete="current-password" required value={recovery.currentPassword} onChange={event => setRecovery(value => ({ ...value, currentPassword: event.target.value }))} /></div><div className="field"><label htmlFor="security-recovery-code">6-digit authenticator code</label><input id="security-recovery-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required value={recovery.code} onChange={event => setRecovery(value => ({ ...value, code: event.target.value }))} /></div><button className="button button-primary" disabled={busy === 'recovery'}>{busy === 'recovery' ? 'Verifying…' : 'Generate new codes'}</button></form>
        {newRecoveryCodes.length > 0 && <div className="security-recovery-codes"><p><strong>Save these now. They are shown once.</strong></p><div>{newRecoveryCodes.map(code => <code key={code}>{code}</code>)}</div></div>}
      </article>}
    </div>
  </section>;
}
