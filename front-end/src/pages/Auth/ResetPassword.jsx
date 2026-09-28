import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import Icon from '../../components/ui/Icon';
import './authPages.css';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async event => {
    event.preventDefault(); setError('');
    if (!token) { setError('Password reset link is missing its private token.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try { await api.resetPassword(token, password); setDone(true); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  if (done) return <section className="auth-page-card surface-card"><span className="auth-page-icon"><Icon name="check" size={34} /></span><div className="section-kicker">Account security</div><h1>Password updated</h1><p>All previous sessions were revoked. Sign in again using your new password.</p><div className="auth-page-actions"><Link className="button button-primary" to="/">Return to Tomato</Link></div></section>;

  return <section className="auth-page-card surface-card">
    <span className="auth-page-icon"><Icon name="lock" size={34} /></span>
    <div className="section-kicker">Account recovery</div>
    <h1>Choose a new password</h1>
    <p>Use at least 12 characters. Resetting your password signs out every existing device session.</p>
    <form onSubmit={submit} className="auth-page-form">
      <div className="field"><label htmlFor="reset-password">New password</label><input id="reset-password" type="password" minLength="12" maxLength="72" autoComplete="new-password" required value={password} onChange={event => setPassword(event.target.value)} /></div>
      <div className="field"><label htmlFor="reset-confirm">Confirm new password</label><input id="reset-confirm" type="password" minLength="12" maxLength="72" autoComplete="new-password" required value={confirm} onChange={event => setConfirm(event.target.value)} /></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary button-full" disabled={busy}>{busy ? 'Updating…' : 'Reset password'}</button>
    </form>
  </section>;
}
