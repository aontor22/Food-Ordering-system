import { useContext, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { StoreContext } from '../../context/StoreContext';
import OrderSummary from '../../components/ui/OrderSummary';
import EmptyState from '../../components/ui/EmptyState';
import Icon from '../../components/ui/Icon';
import './PlaceOrder.css';

const emptyForm = { firstName: '', lastName: '', email: '', street: '', city: '', state: '', postalCode: '', country: 'Bangladesh', phone: '', notes: '' };

export default function PlaceOrder({ onLogin }) {
  const { getTotalCartAmount, cartProducts, setCartItems, createOrder, user, couponCode } = useContext(StoreContext);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  useEffect(() => { if (user?.email) setForm(previous => ({ ...previous, email: user.email })); }, [user]);

  if (!cartProducts.length) return <EmptyState icon="🥡" title="Nothing to check out yet" text="Choose your favourites before starting checkout." />;

  const update = event => setForm(previous => ({ ...previous, [event.target.name]: event.target.value }));
  const submit = async event => {
    event.preventDefault();
    if (!user) { setError('Please sign in to place your order.'); return; }
    setBusy(true); setError('');
    try {
      const items = cartProducts.map(item => ({ productId: item._id, quantity: item.quantity }));
      const { order } = await createOrder({ items, paymentMethod: 'COD', ...(couponCode && { couponCode }), delivery: form });
      setCartItems({});
      navigate(`/order-success/${order.orderNumber}`, { state: { order } });
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  return <div className="checkout-page">
    <header className="page-title"><div className="section-kicker">Secure checkout</div><h1>Delivery details</h1><p>Tell us where to bring your order. Fields marked with * are required.</p></header>
    <form className="checkout-layout" onSubmit={submit}>
      <section className="checkout-form surface-card">
        <div className="checkout-section-title"><span>1</span><div><h2>Contact information</h2><p>We’ll use this for order updates only.</p></div></div>
        <div className="field-grid">
          <div className="field"><label htmlFor="firstName">First name *</label><input id="firstName" name="firstName" value={form.firstName} onChange={update} required autoComplete="given-name" /></div>
          <div className="field"><label htmlFor="lastName">Last name *</label><input id="lastName" name="lastName" value={form.lastName} onChange={update} required autoComplete="family-name" /></div>
          <div className="field"><label htmlFor="email">Email address *</label><input id="email" name="email" value={form.email} onChange={update} required type="email" autoComplete="email" /></div>
          <div className="field"><label htmlFor="phone">Phone number *</label><input id="phone" name="phone" value={form.phone} onChange={update} required type="tel" autoComplete="tel" placeholder="e.g. 01700 000000" /></div>
        </div>
        <div className="checkout-divider" />
        <div className="checkout-section-title"><span>2</span><div><h2>Delivery address</h2><p>Double-check your address before ordering.</p></div></div>
        <div className="field"><label htmlFor="street">Street address *</label><input id="street" name="street" value={form.street} onChange={update} required autoComplete="street-address" /></div>
        <div className="field-grid">
          <div className="field"><label htmlFor="city">City *</label><input id="city" name="city" value={form.city} onChange={update} required autoComplete="address-level2" /></div>
          <div className="field"><label htmlFor="state">State/Division *</label><input id="state" name="state" value={form.state} onChange={update} required autoComplete="address-level1" /></div>
          <div className="field"><label htmlFor="postalCode">Postal code *</label><input id="postalCode" name="postalCode" value={form.postalCode} onChange={update} required autoComplete="postal-code" /></div>
          <div className="field"><label htmlFor="country">Country *</label><input id="country" name="country" value={form.country} onChange={update} required autoComplete="country-name" /></div>
        </div>
        <div className="field"><label htmlFor="notes">Delivery note <span className="muted">(optional)</span></label><textarea id="notes" name="notes" value={form.notes} onChange={update} maxLength="500" placeholder="Landmark, gate code, or delivery instruction" /></div>
      </section>
      <div className="checkout-sidebar">
        <OrderSummary subtotal={getTotalCartAmount()} action={{ type: 'submit' }} actionLabel={busy ? 'Placing order…' : 'Place order'} disabled={busy}>
          <div className="payment-card"><Icon name="check" /><div><strong>Cash on delivery</strong><small>Pay when your food arrives</small></div></div>
          {couponCode && <p className="coupon-notice">Promo code <strong>{couponCode}</strong> will be verified now.</p>}
          {!user && <div className="signin-notice"><p>Already have an account?</p><button type="button" className="button button-secondary button-full" onClick={onLogin}><Icon name="user" />Sign in to continue</button></div>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </OrderSummary>
        <Link className="back-to-cart" to="/cart">← Return to cart</Link>
      </div>
    </form>
  </div>;
}
