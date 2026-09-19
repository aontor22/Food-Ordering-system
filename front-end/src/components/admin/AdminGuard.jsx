import { useContext } from 'react';
import { Link } from 'react-router-dom';
import { StoreContext } from '../../context/StoreContext';
import Icon from '../ui/Icon';
import './admin.css';

export default function AdminGuard({ children, onLogin }) {
  const { loading, user, logout } = useContext(StoreContext);

  if (loading) return <div className="admin-auth-screen"><div className="admin-loader" /><p>Verifying your session…</p></div>;

  if (!user) return <div className="admin-auth-screen">
    <div className="admin-auth-card">
      <span className="admin-auth-icon"><Icon name="shield" size={30} /></span>
      <div className="section-kicker">Protected workspace</div>
      <h1>Admin sign in required</h1>
      <p>Use an administrator account to manage the restaurant, inventory, orders, customers and promotions.</p>
      <button className="button button-primary button-full" onClick={onLogin}>Sign in as administrator</button>
      <Link className="button button-secondary button-full" to="/">Return to storefront</Link>
    </div>
  </div>;

  if (user.role !== 'ADMIN') return <div className="admin-auth-screen">
    <div className="admin-auth-card">
      <span className="admin-auth-icon is-warning"><Icon name="alert" size={30} /></span>
      <div className="section-kicker">Access restricted</div>
      <h1>Administrator permission needed</h1>
      <p><strong>{user.email}</strong> is signed in as a customer and cannot access this workspace.</p>
      <button className="button button-primary button-full" onClick={async () => { await logout(); onLogin(); }}>Use another account</button>
      <Link className="button button-secondary button-full" to="/">Return to storefront</Link>
    </div>
  </div>;

  return children;
}
