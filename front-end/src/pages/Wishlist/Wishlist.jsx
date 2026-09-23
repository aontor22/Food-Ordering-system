import { useContext } from 'react';
import { StoreContext } from '../../context/StoreContext';
import { formatCurrency } from '../../lib/format';
import EmptyState from '../../components/ui/EmptyState';
import Icon from '../../components/ui/Icon';
import './Wishlist.css';

export default function Wishlist() {
  const { wishlistProducts, wishlistCount, user, addToCart, cartItems, setQuantity, removeWishlistItem, wishlistBusy } = useContext(StoreContext);

  if (!wishlistCount) return <section className="wishlist-page"><EmptyState icon="♡" title="Your wishlist is empty" text="Tap the heart on any dish to save it here for later." action="Explore dishes" to="/" /></section>;

  return <section className="wishlist-page">
    <header className="wishlist-hero">
      <div><span>Saved for later</span><h1>My wishlist</h1><p>{user ? 'Your saved dishes are synced to your account.' : 'These dishes are saved on this device. Sign in later and they will merge with your account.'}</p></div>
      <strong>{wishlistCount} saved</strong>
    </header>

    <div className="wishlist-grid">
      {wishlistProducts.map(product => {
        const available = product.isAvailable !== false && product.stock !== 0;
        const quantity = cartItems[product._id] || 0;
        const busy = wishlistBusy.includes(product._id);
        return <article className={`wishlist-card ${available ? '' : 'is-unavailable'}`} key={product._id}>
          <div className="wishlist-image">{product.image ? <img src={product.image} alt={product.name} loading="lazy" /> : <Icon name="products" size={30} />}<span>{product.category}</span></div>
          <div className="wishlist-copy">
            <div><h2>{product.name}</h2><strong>{formatCurrency(product.price)}</strong></div>
            <p>{product.description}</p>
            <small>{product.reviewCount ? `★ ${Number(product.reviewRating).toFixed(1)} · ${product.reviewCount} review${product.reviewCount === 1 ? '' : 's'}` : 'No reviews yet'}</small>
            {!available && <div className="wishlist-unavailable"><Icon name="alert" size={16} />Currently unavailable</div>}
            <div className="wishlist-actions">
              {available && quantity === 0 && <button className="button button-primary" onClick={() => addToCart(product._id)}><Icon name="cart" size={18} />Add to cart</button>}
              {available && quantity > 0 && <div className="wishlist-quantity"><button onClick={() => setQuantity(product._id, quantity - 1)} aria-label={`Remove one ${product.name}`}><Icon name="minus" size={15} /></button><strong>{quantity} in cart</strong><button onClick={() => setQuantity(product._id, quantity + 1)} aria-label={`Add one ${product.name}`}><Icon name="plus" size={15} /></button></div>}
              <button className="button button-secondary" disabled={busy} onClick={() => removeWishlistItem(product._id)}><Icon name="heartFilled" size={17} />{busy ? 'Removing…' : 'Remove'}</button>
            </div>
          </div>
        </article>;
      })}
    </div>
  </section>;
}
