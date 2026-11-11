import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import Icon from '../../components/ui/Icon';
import './authPages.css';

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState({ loading: true, error: '', message: '' });

  useEffect(() => {
    let active = true;
    if (!token) { setState({ loading: false, error: 'Verification link is missing its private token.', message: '' }); return undefined; }
    api.verifyEmail(token)
      .then(data => active && setState({ loading: false, error: '', message: data.message || 'Email verified.' }))
      .catch(error => active && setState({ loading: false, error: error.message, message: '' }));
    return () => { active = false; };
  }, [token]);

  return <section className="auth-page-card surface-card">
    <span className={`auth-page-icon ${state.error ? 'is-error' : ''}`}><Icon name={state.error ? 'alert' : 'mail'} size={34} /></span>
    <div className="section-kicker">Account security</div>
    <h1>{state.loading ? 'Verifying your email…' : state.error ? 'Verification link unavailable' : 'Email verified'}</h1>
    <p>{state.loading ? 'Checking the one-time verification link.' : state.error || state.message}</p>
    {!state.loading && <div className="auth-page-actions"><Link className="button button-primary" to="/">Return to Tomato and sign in</Link></div>}
  </section>;
}
