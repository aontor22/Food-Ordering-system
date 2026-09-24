import { useContext, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { StoreContext } from '../../context/StoreContext';
import Icon from '../ui/Icon';
import './admin.css';

const navigation = [
  { to: '/admin', label: 'Overview', icon: 'dashboard', end: true },
  { to: '/admin/products', label: 'Products', icon: 'products' },
  { to: '/admin/orders', label: 'Orders', icon: 'orders' },
  { to: '/admin/store-operations', label: 'Store hours', icon: 'clock' },
  { to: '/admin/delivery-zones', label: 'Delivery zones', icon: 'delivery' },
  { to: '/admin/fulfillment', label: 'Scheduling', icon: 'calendar' },
  { to: '/admin/payments', label: 'Payments', icon: 'card' },
  { to: '/admin/customers', label: 'Customers', icon: 'users' },
  { to: '/admin/reviews', label: 'Reviews', icon: 'star' },
  { to: '/admin/loyalty', label: 'Tomato Points', icon: 'gift' },
  { to: '/admin/coupons', label: 'Coupons', icon: 'coupon' },
  { to: '/admin/activity', label: 'Activity log', icon: 'activity' },
];

const titles = {
  '/admin': ['Dashboard overview', 'Monitor the health of your restaurant in real time.'],
  '/admin/products': ['Product management', 'Control menu availability, prices and stock.'],
  '/admin/orders': ['Live order operations', 'Track, estimate and move orders through fulfilment in real time.'],
  '/admin/store-operations': ['Store availability', 'Set opening hours, temporary pauses and holiday closures.'],
  '/admin/delivery-zones': ['Delivery zones', 'Control service areas, delivery fees, minimum orders and free-delivery thresholds.'],
  '/admin/fulfillment': ['Fulfilment scheduling', 'Control delivery, pickup, ASAP orders, future slots and capacity.'],
  '/admin/payments': ['Payment operations', 'Verify cash collection and monitor gateway transactions.'],
  '/admin/customers': ['Customer accounts', 'Review activity, points balances and manage account access.'],
  '/admin/reviews': ['Food reviews', 'Moderate verified customer feedback from delivered orders.'],
  '/admin/loyalty': ['Tomato Points', 'Control rewards, redemption thresholds and point value.'],
  '/admin/coupons': ['Coupons & offers', 'Create and manage customer promotions.'],
  '/admin/activity': ['Activity log', 'Review sensitive administrative actions.'],
};

export default function AdminLayout() {
  const [open, setOpen] = useState(false);
  const { user, logout } = useContext(StoreContext);
  const location = useLocation();
  const [title, subtitle] = titles[location.pathname] || titles['/admin'];

  useEffect(() => setOpen(false), [location.pathname]);

  return <div className="admin-app">
    <aside className={`admin-sidebar ${open ? 'is-open' : ''}`}>
      <Link to="/admin" className="admin-brand"><span>T.</span><div>Tomato<small>Restaurant OS</small></div></Link>
      <nav aria-label="Admin navigation">
        <p>Workspace</p>
        {navigation.map(item => <NavLink key={item.to} to={item.to} end={item.end}>
          <Icon name={item.icon} size={19} />{item.label}
        </NavLink>)}
      </nav>
      <div className="admin-sidebar-footer">
        <Link to="/"><Icon name="store" size={18} />View storefront</Link>
        <button onClick={logout}><Icon name="logout" size={18} />Sign out</button>
      </div>
    </aside>
    {open && <button className="admin-backdrop" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <div className="admin-workspace">
      <header className="admin-topbar">
        <button className="icon-button admin-menu-toggle" onClick={() => setOpen(true)} aria-label="Open navigation"><Icon name="menu" /></button>
        <div><h1>{title}</h1><p>{subtitle}</p></div>
        <div className="admin-profile"><span>{user.name.charAt(0).toUpperCase()}</span><div><strong>{user.name}</strong><small>Administrator</small></div></div>
      </header>
      <main className="admin-content"><Outlet /></main>
    </div>
  </div>;
}
