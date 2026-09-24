import { useContext, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { StoreContext } from '../../context/StoreContext';
import { formatCurrency } from '../../lib/format';
import OrderSummary from '../../components/ui/OrderSummary';
import EmptyState from '../../components/ui/EmptyState';
import Icon from '../../components/ui/Icon';
import './Cart.css';

export default function Cart() {
  const { cartProducts, setQuantity, removeItem, getTotalCartAmount, couponCode, setCouponCode, storeStatus } = useContext(StoreContext);
  const [promo, setPromo] = useState(couponCode);
  const [promoMessage, setPromoMessage] = useState('');
  const navigate = useNavigate();

  if (!cartProducts.length) return <EmptyState icon="🛒" title="Your cart is waiting" text="Add a few delicious dishes and they’ll appear here, ready for checkout." />;

  const applyPromo = event => {
    event.preventDefault();
    const value = promo.trim().toUpperCase();
    setCouponCode(value);
    setPromoMessage(value ? 'Code saved. Eligibility and discount will be verified when you place the order.' : '');
  };

  return <div className="cart-page">
    <header className="page-title"><div className="section-kicker">Almost there</div><h1>Your cart</h1><p>Review your dishes and quantities before checkout.</p></header>
    <div className="cart-layout">
      <section className="cart-list surface-card" aria-label="Cart items">
        {cartProducts.map(item => <article className="cart-row" key={item._id}>
          <img src={item.image} alt={item.name} />
          <div className="cart-item-copy"><span>{item.category}</span><h2>{item.name}</h2><p>{formatCurrency(item.price)} each</p></div>
          <div className="quantity-control cart-quantity">
            <button onClick={() => setQuantity(item._id, item.quantity - 1)} aria-label={`Decrease ${item.name} quantity`}><Icon name="minus" size={16} /></button>
            <strong>{item.quantity}</strong>
            <button onClick={() => setQuantity(item._id, item.quantity + 1)} aria-label={`Increase ${item.name} quantity`}><Icon name="plus" size={16} /></button>
          </div>
          <strong className="cart-line-total">{formatCurrency(item.price * item.quantity)}</strong>
          <button className="remove-item" onClick={() => removeItem(item._id)} aria-label={`Remove ${item.name}`}><Icon name="trash" size={19} /></button>
        </article>)}
        <div className="cart-list-footer"><Link className="text-link" to="/">← Continue shopping</Link><span>{cartProducts.length} selected {cartProducts.length === 1 ? 'dish' : 'dishes'}</span></div>
      </section>
      <div>
        <OrderSummary subtotal={getTotalCartAmount()} action={{ onClick: () => navigate('/order') }} actionLabel={storeStatus && !storeStatus.isOpen ? 'Ordering unavailable' : 'Continue to checkout'} disabled={Boolean(storeStatus && !storeStatus.isOpen)}>
          {storeStatus && !storeStatus.isOpen && <div className="cart-store-closed"><Icon name="clock" size={18} /><div><strong>{storeStatus.headline}</strong><p>{storeStatus.message}</p></div></div>}
          <form className="promo-form" onSubmit={applyPromo}>
            <label htmlFor="promo">Promo code</label>
            <div><input id="promo" value={promo} onChange={event => setPromo(event.target.value)} placeholder="e.g. WELCOME10" /><button>Apply</button></div>
            {promoMessage && <small>{promoMessage}</small>}
          </form>
        </OrderSummary>
      </div>
    </div>
  </div>;
}
