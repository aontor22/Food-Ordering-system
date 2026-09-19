import { useContext, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { StoreContext } from '../../context/StoreContext';
import OrderSummary from '../../components/ui/OrderSummary';
import EmptyState from '../../components/ui/EmptyState';
import Icon from '../../components/ui/Icon';
import { api } from '../../lib/api';
import './PlaceOrder.css';

const emptyForm = { firstName: '', lastName: '', email: '', street: '', city: '', state: '', postalCode: '', country: 'Bangladesh', phone: '', notes: '' };

export default function PlaceOrder({ onLogin }) {
  const { getTotalCartAmount, cartProducts, setCartItems, createOrder, user, couponCode } = useContext(StoreContext);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('COD');
  const [paymentOptions, setPaymentOptions] = useState(null);
  const [manualChannelId, setManualChannelId] = useState('');
  const navigate = useNavigate();
  useEffect(() => { if (user?.email) setForm(previous => ({ ...previous, email: user.email })); }, [user]);
  useEffect(() => { api.getPaymentOptions().then(setPaymentOptions).catch(() => setPaymentOptions(null)); }, []);

  if (!cartProducts.length) return <EmptyState icon="🥡" title="Nothing to check out yet" text="Choose your favourites before starting checkout." />;

  const update = event => setForm(previous => ({ ...previous, [event.target.name]: event.target.value }));
  const submit = async event => {
    event.preventDefault();
    if (!user) { setError('Please sign in to place your order.'); return; }
    setBusy(true); setError('');
    try {
      const items = cartProducts.map(item => ({ productId: item._id, quantity: item.quantity }));
      const result = await createOrder({ items, paymentMethod, ...(paymentMethod === 'MANUAL' && { manualChannelId }), ...(couponCode && { couponCode }), delivery: form });
      const { order } = result;
      setCartItems({});
      if (paymentMethod === 'MANUAL') navigate(`/payment/manual/${order.id}`);
      else if (paymentMethod === 'ONLINE' && result.paymentUrl) window.location.assign(result.paymentUrl);
      else navigate(`/order-success/${order.orderNumber}`, { state: { order, paymentError: result.paymentError } });
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
        <div className="checkout-divider" />
        <div className="checkout-section-title"><span>3</span><div><h2>Payment method</h2><p>Choose how you would like to pay.</p></div></div>
        <div className="payment-options" role="radiogroup" aria-label="Payment method">
          <label className={`payment-option ${paymentMethod === 'COD' ? 'is-selected' : ''}`}><input type="radio" name="paymentMethod" value="COD" checked={paymentMethod === 'COD'} onChange={() => setPaymentMethod('COD')} /><Icon name="cash" size={24} /><div><strong>Cash on delivery</strong><small>Pay in cash when your food arrives</small></div><span className="payment-radio" /></label>
          <label className={`payment-option ${paymentMethod === 'ONLINE' ? 'is-selected' : ''} ${!paymentOptions?.methods.find(method => method.id === 'ONLINE')?.enabled ? 'is-disabled' : ''}`}><input type="radio" name="paymentMethod" value="ONLINE" checked={paymentMethod === 'ONLINE'} disabled={!paymentOptions?.methods.find(method => method.id === 'ONLINE')?.enabled} onChange={() => setPaymentMethod('ONLINE')} /><Icon name="card" size={24} /><div><strong>{paymentOptions?.methods.find(method => method.id === 'ONLINE')?.label || 'Online payment'}</strong><small>{!paymentOptions ? 'Loading online payment…' : paymentOptions.methods.find(method => method.id === 'ONLINE')?.mode === 'demo' ? 'Development-only secure flow simulation' : 'Card, mobile banking and supported methods'}</small></div><span className="payment-radio" /></label>
        </div>
        {paymentOptions?.methods.find(method => method.id === 'ONLINE')?.mode === 'demo' && paymentMethod === 'ONLINE' && <p className="payment-demo-note"><Icon name="alert" size={17} />Demo gateway is enabled for development. Configure SSLCOMMERZ credentials before production.</p>}
        <label className={`payment-option ${paymentMethod === 'MANUAL' ? 'is-selected' : ''} ${!paymentOptions?.manualChannels?.length ? 'is-disabled' : ''}`}><input type="radio" name="paymentMethod" value="MANUAL" disabled={!paymentOptions?.manualChannels?.length} checked={paymentMethod === 'MANUAL'} onChange={() => { setPaymentMethod('MANUAL'); setManualChannelId(paymentOptions.manualChannels[0].id); }} /><Icon name="cash" size={24} /><div><strong>Manual payment</strong><small>{paymentOptions?.manualChannels?.length ? 'Pay directly, then submit your transaction ID' : 'The restaurant has not configured this method yet'}</small></div><span className="payment-radio" /></label>
        {paymentMethod === 'MANUAL' && <div className="field" style={{ marginTop: '16px' }}><label htmlFor="manual-channel">Payment account</label><select id="manual-channel" required value={manualChannelId} onChange={event => setManualChannelId(event.target.value)}>{paymentOptions.manualChannels.map(channel => <option key={channel.id} value={channel.id}>{channel.label} · {channel.provider}</option>)}</select><p className="muted">Place your order to see the exact amount and payment instructions.</p></div>}
      </section>
      <div className="checkout-sidebar">
        <OrderSummary subtotal={getTotalCartAmount()} action={{ type: 'submit' }} actionLabel={busy ? 'Processing…' : paymentMethod === 'MANUAL' ? 'Place order & view payment details' : paymentMethod === 'ONLINE' ? 'Continue to secure payment' : 'Place order'} disabled={busy}>
          <div className="payment-card"><Icon name={paymentMethod === 'COD' ? 'check' : 'lock'} /><div><strong>{paymentMethod === 'MANUAL' ? 'Manual payment verification' : paymentMethod === 'ONLINE' ? 'Server-verified payment' : 'Cash on delivery'}</strong><small>{paymentMethod === 'MANUAL' ? 'The restaurant verifies your submitted transaction' : paymentMethod === 'ONLINE' ? 'Payment status is updated only after verification' : 'Pay when your food arrives'}</small></div></div>
          {couponCode && <p className="coupon-notice">Promo code <strong>{couponCode}</strong> will be verified now.</p>}
          {!user && <div className="signin-notice"><p>Already have an account?</p><button type="button" className="button button-secondary button-full" onClick={onLogin}><Icon name="user" />Sign in to continue</button></div>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </OrderSummary>
        <Link className="back-to-cart" to="/cart">← Return to cart</Link>
      </div>
    </form>
  </div>;
}
