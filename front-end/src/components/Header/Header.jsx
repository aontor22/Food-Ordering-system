import Icon from '../ui/Icon';
import './Header.css';

export default function Header() {
  const viewMenu = () => document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' });
  return <section className="hero" aria-labelledby="hero-title">
    <div className="hero-overlay" />
    <div className="hero-content">
      <div className="hero-badge"><Icon name="spark" size={16} />Freshly made, delivered fast</div>
      <h1 id="hero-title">Good food.<br />Better moments.</h1>
      <p>Explore chef-crafted favourites made with fresh ingredients and delivered straight to your door.</p>
      <div className="hero-actions">
        <button className="button hero-primary" onClick={viewMenu}>Explore the menu <Icon name="arrow" size={18} /></button>
        <span><strong>30 min</strong><small>average delivery</small></span>
      </div>
    </div>
    <div className="hero-rating"><span>★</span><div><strong>4.9</strong><small>Loved by foodies</small></div></div>
  </section>;
}
