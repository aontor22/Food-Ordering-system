import { useContext, useEffect, useState } from 'react';
import { StoreContext } from '../../context/StoreContext';
import Icon from '../ui/Icon';
import GoogleSignInButton from './GoogleSignInButton';
import './LoginPopup.css';

export default function LoginPopup({ onClose }) {
  const [mode, setMode] = useState('login');
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { authenticate, authenticateWithGoogle } = useContext(StoreContext);
  const googleEnabled = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim());

  useEffect(() => {
    document.body.classList.add('modal-open');
    const close = event => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', close);
    return () => { document.body.classList.remove('modal-open'); document.removeEventListener('keydown', close); };
  }, [onClose]);

  const update = event => setValues(previous => ({ ...previous, [event.target.name]: event.target.value }));
  const switchMode = () => { setMode(value => value === 'login' ? 'register' : 'login'); setError(''); };
  const submit = async event => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      await authenticate(mode, mode === 'login' ? { email: values.email, password: values.password } : values);
      onClose();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  const googleSignIn = async credential => {
    setError(''); setBusy(true);
    try {
      await authenticateWithGoogle(credential);
      onClose();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  return <div className="auth-overlay" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button className="auth-close icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      <div className="auth-mark">T.</div>
      <div className="section-kicker">Welcome to Tomato</div>
      <h2 id="auth-title">{mode === 'login' ? 'Good to see you again' : 'Create your account'}</h2>
      <p>{mode === 'login' ? 'Sign in to place orders and track deliveries.' : 'Save your details and order your favourites faster.'}</p>
      <form onSubmit={submit}>
        {mode === 'register' && <div className="field"><label htmlFor="auth-name">Full name</label><input id="auth-name" name="name" value={values.name} onChange={update} required autoComplete="name" placeholder="Your name" /></div>}
        <div className="field"><label htmlFor="auth-email">Email address</label><input id="auth-email" name="email" value={values.email} onChange={update} required type="email" autoComplete="email" placeholder="you@example.com" /></div>
        <div className="field"><label htmlFor="auth-password">Password</label><input id="auth-password" name="password" value={values.password} onChange={update} required minLength="8" maxLength="72" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="At least 8 characters" /></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {mode === 'register' && <label className="terms-check"><input type="checkbox" required /><span>I agree to the terms of use and privacy policy.</span></label>}
        <button className="button button-primary button-full" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      {googleEnabled && <>
        <div className="auth-divider" aria-hidden="true"><span>or</span></div>
        <GoogleSignInButton disabled={busy} onCredential={googleSignIn} onError={requestError => setError(requestError.message)} />
      </>}
      <p className="auth-switch">{mode === 'login' ? 'New to Tomato?' : 'Already have an account?'} <button onClick={switchMode}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></p>
    </section>
  </div>;
}
