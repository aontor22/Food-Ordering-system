import { useContext, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { StoreContext } from '../../context/StoreContext';
import { formatCurrency } from '../../lib/format';
import OrderSummary from '../../components/ui/OrderSummary';
import EmptyState from '../../components/ui/EmptyState';
import Icon from '../../components/ui/Icon';
import ProductCustomizer from '../../components/ProductCustomizer/ProductCustomizer';
import { productPurchaseLimit, selectedConfigurationLimit } from '../../lib/productCustomizations';
import './Cart.css';

export default function Cart() {
  const { cartProducts, cartProductQuantity, cartOptionQuantity, setQuantity, updateCartLine, removeItem, getTotalCartAmount, couponCode, setCouponCode, storeStatus } = useContext(StoreContext);
  const [promo, setPromo] = useState(couponCode);
  const [promoMessage, setPromoMessage] = useState('');
  const [editing, setEditing] = useState(null);
  const navigate = useNavigate();

  if (!cartProducts.length) return <EmptyState icon="🛒" title="Your cart is waiting" text="Add a few delicious dishes and they’ll appear here, ready for checkout." />;

  const applyPromo = event => {
    event.preventDefault();
    const value = promo.trim().toUpperCase();
    setCouponCode(value);
    setPromoMessage(value ? 'Code saved. Eligibility and discount will be verified when you place the order.' : '');
  };

  return <div className="cart-page">
    <header className="page-title"><div className="section-kicker">Almost there</div><h1>Your cart</h1><p>Review each dish, size, add-ons and kitchen instructions before checkout.</p></header>
    <div className="cart-layout">
      <section className="cart-list surface-card" aria-label="Cart items">
        {cartProducts.map(item => {
          const productLineLimit = Math.max(0, productPurchaseLimit(item) - (cartProductQuantity(item._id) - item.quantity));
          const optionLineLimit = selectedConfigurationLimit(item, item.selections, optionId => cartOptionQuantity(optionId, item.lineId));
          const lineLimit = Math.min(productLineLimit, optionLineLimit);
          return <article className="cart-row" key={item.lineId}>
          <img src={item.image} alt={item.name} />
          <div className="cart-item-copy">
            <span>{item.category}</span><h2>{item.name}</h2><p>{formatCurrency(item.price)} each</p>
            {item.customizationDetails?.length > 0 && <div className="cart-customizations">{item.customizationDetails.map(group => <small key={group.groupId}><strong>{group.groupName}:</strong> {group.options.map(option => option.name).join(', ')}</small>)}</div>}
            {item.specialInstructions && <small className="cart-special-note"><Icon name="edit" size={13} />{item.specialInstructions}</small>}
            <button className="cart-edit-customization" type="button" onClick={() => setEditing(item)}>Edit options & instructions</button>
          </div>
          <div className="quantity-control cart-quantity">
            <button onClick={() => setQuantity(item.lineId, item.quantity - 1)} aria-label={`Decrease ${item.name} quantity`}><Icon name="minus" size={16} /></button>
            <strong>{item.quantity}</strong>
            <button disabled={item.quantity >= lineLimit} onClick={() => setQuantity(item.lineId, item.quantity + 1)} aria-label={`Increase ${item.name} quantity`}><Icon name="plus" size={16} /></button>
          </div>
          <strong className="cart-line-total">{formatCurrency(item.price * item.quantity)}</strong>
          <button className="remove-item" onClick={() => removeItem(item.lineId)} aria-label={`Remove ${item.name}`}><Icon name="trash" size={19} /></button>
        </article>;})}
        <div className="cart-list-footer"><Link className="text-link" to="/">← Continue shopping</Link><span>{cartProducts.length} customized {cartProducts.length === 1 ? 'line' : 'lines'}</span></div>
      </section>
      <div>
        <OrderSummary subtotal={getTotalCartAmount()} delivery={null} action={{ onClick: () => navigate('/order') }} actionLabel={storeStatus && !storeStatus.isOpen ? 'Ordering unavailable' : 'Continue to checkout'} disabled={Boolean(storeStatus && !storeStatus.isOpen)}>
          <p className="cart-delivery-note"><Icon name="delivery" size={17} />Delivery fee and minimum order are calculated after you choose your delivery area.</p>
          {storeStatus && !storeStatus.isOpen && <div className="cart-store-closed"><Icon name="clock" size={18} /><div><strong>{storeStatus.headline}</strong><p>{storeStatus.message}</p></div></div>}
          <form className="promo-form" onSubmit={applyPromo}>
            <label htmlFor="promo">Promo code</label>
            <div><input id="promo" value={promo} onChange={event => setPromo(event.target.value)} placeholder="e.g. WELCOME10" /><button>Apply</button></div>
            {promoMessage && <small>{promoMessage}</small>}
          </form>
        </OrderSummary>
      </div>
    </div>
    {editing && <ProductCustomizer product={editing} line={editing} maxQuantity={Math.max(0, productPurchaseLimit(editing) - (cartProductQuantity(editing._id) - editing.quantity))} reservedOptionQuantity={optionId => cartOptionQuantity(optionId, editing.lineId)} onClose={() => setEditing(null)} onSave={line => { updateCartLine(line); setEditing(null); }} />}
  </div>;
}
