import { useContext, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { assets } from '../../assets/assets';
import { StoreContext } from '../../context/StoreContext';
import Icon from '../ui/Icon';
import './navbar.css';

export default function Navbar({ onLogin }) {
  const { cartCount, wishlistCount, user, logout, searchQuery, setSearchQuery } = useContext(StoreContext);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const accountRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => { setMobileOpen(false); setAccountOpen(false); }, [location.pathname]);
  useEffect(() => {
    const close = event => { if (!accountRef.current?.contains(event.target)) setAccountOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const goToMenu = () => {
    navigate('/');
    setTimeout(() => document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  const submitSearch = event => {
    event.preventDefault();
    navigate('/');
    setSearchOpen(false);
    setTimeout(() => document.getElementById('dishes')?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  return <header className="site-header">
    <nav className="navbar page-container" aria-label="Main navigation">
      <Link to="/" className="brand" aria-label="Tomato home"><img src={assets.logo} alt="Tomato" /></Link>
      <div className={`navbar-links ${mobileOpen ? 'is-open' : ''}`}>
        <NavLink to="/" end>Home</NavLink>
        <button type="button" onClick={goToMenu}>Menu</button>
        {user && <NavLink to="/orders">My orders</NavLink>}
        <a href="#footer">Contact</a>
      </div>
      <div className="navbar-actions">
        <button className="icon-button nav-search-button" aria-label="Search menu" onClick={() => setSearchOpen(value => !value)}><Icon name="search" /></button>
        <Link className={`wishlist-nav-button ${wishlistCount ? 'is-saved' : ''}`} to="/wishlist" aria-label={`Wishlist with ${wishlistCount} saved items`} title="Wishlist">
          <Icon name={wishlistCount ? 'heartFilled' : 'heart'} size={21} />
          {wishlistCount > 0 && <span>{wishlistCount > 99 ? '99+' : wishlistCount}</span>}
        </Link>
        <Link className="cart-button" to="/cart" aria-label={`Cart with ${cartCount} items`}>
          <Icon name="cart" size={22} />
          {cartCount > 0 && <span>{cartCount > 99 ? '99+' : cartCount}</span>}
        </Link>
        {user ? <div className="account-menu" ref={accountRef}>
          <button className="account-trigger" onClick={() => setAccountOpen(value => !value)} aria-expanded={accountOpen}>
            <span className="avatar">{user.name.charAt(0).toUpperCase()}</span>
            <span className="account-copy"><small>Welcome back</small>{user.name.split(' ')[0]}</span>
            <Icon name="chevronDown" size={16} />
          </button>
          {accountOpen && <div className="account-dropdown surface-card">
            {user.role === 'ADMIN' && <Link to="/admin"><Icon name="dashboard" />Admin dashboard</Link>}
            <Link to="/orders"><Icon name="orders" />My orders</Link>
            <Link to="/wishlist"><Icon name="heart" />Wishlist {wishlistCount ? `(${wishlistCount})` : ''}</Link>
            {user.role !== 'ADMIN' && <Link to="/orders"><Icon name="gift" />{user.pointsBalance || 0} Tomato Points</Link>}
            <button onClick={logout}><Icon name="logout" />Sign out</button>
          </div>}
        </div> : <button className="button button-primary sign-in" onClick={onLogin}>Sign in</button>}
        <button className="icon-button mobile-toggle" aria-label="Toggle navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(value => !value)}><Icon name={mobileOpen ? 'close' : 'menu'} /></button>
      </div>
    </nav>
    {searchOpen && <form className="nav-search page-container" onSubmit={submitSearch}>
      <Icon name="search" />
      <input autoFocus value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search salads, pasta, desserts…" aria-label="Search dishes" />
      {searchQuery && <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear search"><Icon name="close" size={18} /></button>}
    </form>}
  </header>;
}
