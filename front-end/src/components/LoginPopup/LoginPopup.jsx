import { useContext, useEffect, useState } from 'react';
import { StoreContext } from '../../context/StoreContext';
import { api } from '../../lib/api';
import Icon from '../ui/Icon';
import GoogleSignInButton from './GoogleSignInButton';
import './LoginPopup.css';

export default function LoginPopup({ onClose }) {
  const [mode, setMode] = useState('login');
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState(null);
  const [mfaCode, setMfaCode] = useState('');
  const [setup, setSetup] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const { authenticate, authenticateWithGoogle, acceptAuthSession } = useContext(StoreContext);
  const googleEnabled = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim());

  useEffect(() => {
    document.body.classList.add('modal-open');
    const close = event => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', close);
    return () => { document.body.classList.remove('modal-open'); document.removeEventListener('keydown', close); };
  }, [onClose]);

  const update = event => setValues(previous => ({ ...previous, [event.target.name]: event.target.value }));
  const resetMessages = () => { setError(''); setNotice(''); setPreviewUrl(''); };
  const switchMode = next => { setMode(next); resetMessages(); setChallenge(null); setSetup(null); setMfaCode(''); };

  const handleAuthResult = async data => {
    if (data?.accessToken) { onClose(); return; }
    if (data?.mfaRequired) {
      setChallenge({ type: 'verify', token: data.challengeToken, email: data.email });
      setMfaCode('');
      return;
    }
    if (data?.mfaSetupRequired) {
      const details = await api.getAdmin2faSetup(data.challengeToken);
      setChallenge({ type: 'setup', token: data.challengeToken, email: data.email });
      setSetup(details);
      setMfaCode('');
      return;
    }
    if (data?.verificationRequired) {
      setMode('verification-sent');
      setNotice(data.message || 'Check your email to verify your account.');
      setPreviewUrl(data.previewUrl || '');
    }
  };

  const submit = async event => {
    event.preventDefault(); resetMessages(); setBusy(true);
    try {
      if (mode === 'forgot') {
        const data = await api.forgotPassword(values.email);
        setNotice(data.message);
        setPreviewUrl(data.previewUrl || '');
        return;
      }
      const data = await authenticate(mode, mode === 'login' ? { email: values.email, password: values.password } : values);
      await handleAuthResult(data);
    } catch (requestError) {
      setError(requestError.message);
      if (requestError.code === 'EMAIL_NOT_VERIFIED') setNotice('Need another verification email? Use the button below.');
    } finally { setBusy(false); }
  };

  const googleSignIn = async credential => {
    resetMessages(); setBusy(true);
    try { await handleAuthResult(await authenticateWithGoogle(credential)); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  const resendVerification = async () => {
    if (!values.email) { setError('Enter your email address first.'); return; }
    resetMessages(); setBusy(true);
    try {
      const data = await api.resendVerification(values.email);
      setNotice(data.message);
      setPreviewUrl(data.previewUrl || '');
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  const submitMfa = async event => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const data = challenge.type === 'setup'
        ? await api.enableAdmin2fa(challenge.token, mfaCode)
        : await api.verifyAdmin2fa(challenge.token, mfaCode);
      await acceptAuthSession(data);
      if (data.recoveryCodes?.length) {
        setRecoveryCodes(data.recoveryCodes);
        setChallenge(null);
        setSetup(null);
      } else onClose();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  if (recoveryCodes.length) return <div className="auth-overlay" role="presentation">
    <section className="auth-modal auth-modal-wide" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <div className="auth-mark">T.</div>
      <div className="section-kicker">Admin security</div>
      <h2 id="auth-title">Save your recovery codes</h2>
      <p>Two-factor authentication is enabled. Each recovery code works once if your authenticator is unavailable. Store them somewhere private; Tomato cannot show these same codes again.</p>
      <div className="recovery-code-grid">{recoveryCodes.map(code => <code key={code}>{code}</code>)}</div>
      <button className="button button-primary button-full" onClick={onClose}>I saved the codes — continue</button>
    </section>
  </div>;

  if (challenge) return <div className="auth-overlay" role="presentation">
    <section className="auth-modal auth-modal-wide" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button className="auth-close icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      <div className="auth-mark">T.</div>
      <div className="section-kicker">Administrator verification</div>
      <h2 id="auth-title">{challenge.type === 'setup' ? 'Set up two-factor authentication' : 'Enter your security code'}</h2>
      {challenge.type === 'setup' ? <>
        <p>Add this account to Google Authenticator, Microsoft Authenticator, 1Password, Authy, or another TOTP app using the manual setup key below.</p>
        <div className="auth-secret-box"><small>Account</small><strong>{setup?.account}</strong><small>Setup key</small><code>{setup?.secret}</code></div>
      </> : <p>Enter the current 6-digit authenticator code for {challenge.email}. You can also enter one unused recovery code.</p>}
      <form onSubmit={submitMfa}>
        <div className="field"><label htmlFor="auth-mfa-code">{challenge.type === 'setup' ? '6-digit authenticator code' : 'Authenticator or recovery code'}</label><input id="auth-mfa-code" value={mfaCode} onChange={event => setMfaCode(event.target.value)} required autoFocus autoComplete="one-time-code" inputMode={challenge.type === 'setup' ? 'numeric' : 'text'} placeholder={challenge.type === 'setup' ? '123456' : '123456 or ABCD-EFGH-…'} /></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary button-full" disabled={busy}>{busy ? 'Verifying…' : challenge.type === 'setup' ? 'Enable 2FA & sign in' : 'Verify & sign in'}</button>
      </form>
      <p className="auth-switch"><button onClick={() => switchMode('login')}>Start sign-in again</button></p>
    </section>
  </div>;

  return <div className="auth-overlay" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button className="auth-close icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      <div className="auth-mark">T.</div>
      <div className="section-kicker">Welcome to Tomato</div>
      <h2 id="auth-title">{mode === 'login' ? 'Good to see you again' : mode === 'register' ? 'Create your account' : mode === 'forgot' ? 'Reset your password' : 'Check your email'}</h2>
      <p>{mode === 'login' ? 'Sign in to keep orders, points, reviews, and tracking in one account.' : mode === 'register' ? 'New password accounts verify their email before the first sign-in.' : mode === 'forgot' ? 'Enter your account email. If it matches an active account, we will send a private reset link.' : 'Open the one-time verification link we sent, then return here to sign in.'}</p>
      {mode !== 'verification-sent' && <form onSubmit={submit}>
        {mode === 'register' && <div className="field"><label htmlFor="auth-name">Full name</label><input id="auth-name" name="name" value={values.name} onChange={update} required autoComplete="name" placeholder="Your name" /></div>}
        <div className="field"><label htmlFor="auth-email">Email address</label><input id="auth-email" name="email" value={values.email} onChange={update} required type="email" autoComplete="email" placeholder="you@example.com" /></div>
        {mode !== 'forgot' && <div className="field"><label htmlFor="auth-password">Password</label><input id="auth-password" name="password" value={values.password} onChange={update} required minLength={mode === 'register' ? 12 : 1} maxLength="72" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'register' ? 'At least 12 characters' : 'Your password'} /></div>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="auth-notice" role="status">{notice}</p>}
        {previewUrl && <a className="auth-dev-link" href={previewUrl}>Development preview link</a>}
        {mode === 'register' && <label className="terms-check"><input type="checkbox" required /><span>I agree to the terms of use and privacy policy.</span></label>}
        <button className="button button-primary button-full" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Send reset link'}</button>
      </form>}
      {mode === 'verification-sent' && <>{notice && <p className="auth-notice" role="status">{notice}</p>}{previewUrl && <a className="auth-dev-link" href={previewUrl}>Development preview link</a>}<button className="button button-secondary button-full" onClick={resendVerification} disabled={busy}>{busy ? 'Sending…' : 'Resend verification email'}</button></>}
      {mode === 'login' && notice && <button className="button button-secondary button-full auth-secondary-action" onClick={resendVerification} disabled={busy}>Resend verification email</button>}
      {mode === 'login' && <button className="auth-text-action" onClick={() => switchMode('forgot')}>Forgot password?</button>}
      {googleEnabled && ['login', 'register'].includes(mode) && <><div className="auth-divider" aria-hidden="true"><span>or continue with</span></div><GoogleSignInButton disabled={busy} onCredential={googleSignIn} onError={requestError => setError(requestError.message)} /></>}
      {mode === 'login' && <p className="auth-switch">New to Tomato? <button onClick={() => switchMode('register')}>Create an account</button></p>}
      {mode === 'register' && <p className="auth-switch">Already have an account? <button onClick={() => switchMode('login')}>Sign in</button></p>}
      {['forgot', 'verification-sent'].includes(mode) && <p className="auth-switch"><button onClick={() => switchMode('login')}>Back to sign in</button></p>}
    </section>
  </div>;
}
