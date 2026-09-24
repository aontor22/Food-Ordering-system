import { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { StoreContext } from '../../context/StoreContext';
import OrderSummary from '../../components/ui/OrderSummary';
import EmptyState from '../../components/ui/EmptyState';
import Icon from '../../components/ui/Icon';
import { api } from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import './PlaceOrder.css';

const emptyForm = { firstName: '', lastName: '', email: '', street: '', city: '', state: '', postalCode: '', country: 'Bangladesh', phone: '', notes: '' };

export default function PlaceOrder({ onLogin }) {
  const { getTotalCartAmount, cartProducts, setCartItems, createOrder, user, couponCode, storeStatus, refreshStoreStatus } = useContext(StoreContext);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('COD');
  const [paymentOptions, setPaymentOptions] = useState(null);
  const [manualChannelId, setManualChannelId] = useState('');
  const [pointsToRedeem, setPointsToRedeem] = useState(0);
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [deliveryZones, setDeliveryZones] = useState([]);
  const [deliveryZoneId, setDeliveryZoneId] = useState('');
  const [deliveryZonesError, setDeliveryZonesError] = useState('');
  const [fulfillment, setFulfillment] = useState(null);
  const [fulfillmentError, setFulfillmentError] = useState('');
  const [fulfillmentType, setFulfillmentType] = useState('DELIVERY');
  const [fulfillmentMode, setFulfillmentMode] = useState('ASAP');
  const [selectedDate, setSelectedDate] = useState('');
  const [scheduledForLocal, setScheduledForLocal] = useState('');
  const navigate = useNavigate();

  useEffect(() => { if (user?.email) setForm(previous => ({ ...previous, email: user.email })); }, [user]);
  useEffect(() => { api.getPaymentOptions().then(setPaymentOptions).catch(() => setPaymentOptions(null)); }, []);
  useEffect(() => {
    let active = true;
    api.getFulfillmentOptions().then(data => {
      if (!active) return;
      setFulfillment(data);
      setFulfillmentError('');
      const delivery = data.options?.DELIVERY;
      const pickup = data.options?.PICKUP;
      const preferred = delivery?.enabled ? 'DELIVERY' : pickup?.enabled ? 'PICKUP' : 'DELIVERY';
      setFulfillmentType(preferred);
      const option = data.options?.[preferred];
      if (!option?.asapAvailable && option?.scheduledEnabled && option?.slots?.length) setFulfillmentMode('SCHEDULED');
    }).catch(requestError => { if (active) setFulfillmentError(requestError.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    api.getDeliveryZones().then(data => {
      if (!active) return;
      setDeliveryZones(data.zones || []);
      setDeliveryZoneId(previous => previous || data.zones?.[0]?.id || '');
      setDeliveryZonesError(data.zones?.length ? '' : 'Delivery is not configured right now.');
    }).catch(requestError => { if (active) setDeliveryZonesError(requestError.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const postalCode = form.postalCode.trim().toUpperCase();
    if (fulfillmentType !== 'DELIVERY' || !postalCode || !deliveryZones.length) return;
    const matches = deliveryZones.filter(zone => (zone.postalCodes || []).includes(postalCode));
    if (matches.length === 1 && matches[0].id !== deliveryZoneId) setDeliveryZoneId(matches[0].id);
  }, [form.postalCode, deliveryZones, deliveryZoneId, fulfillmentType]);

  const selectedFulfillment = fulfillment?.options?.[fulfillmentType];
  const scheduleDates = useMemo(() => {
    const values = [];
    for (const slot of selectedFulfillment?.slots || []) if (!values.includes(slot.dateKey)) values.push(slot.dateKey);
    return values;
  }, [selectedFulfillment]);
  const dateSlots = useMemo(() => (selectedFulfillment?.slots || []).filter(slot => slot.dateKey === selectedDate), [selectedFulfillment, selectedDate]);

  useEffect(() => {
    setScheduledForLocal('');
    const dates = [];
    for (const slot of selectedFulfillment?.slots || []) if (!dates.includes(slot.dateKey)) dates.push(slot.dateKey);
    setSelectedDate(dates[0] || '');
    if (fulfillmentMode === 'ASAP' && selectedFulfillment && !selectedFulfillment.asapAvailable && selectedFulfillment.scheduledEnabled && selectedFulfillment.slots?.length) setFulfillmentMode('SCHEDULED');
  }, [fulfillmentType, fulfillment?.settings?.updatedAt]);

  useEffect(() => {
    if (fulfillmentMode !== 'SCHEDULED') { setScheduledForLocal(''); return; }
    const currentStillValid = dateSlots.some(slot => slot.localKey === scheduledForLocal);
    if (!currentStillValid) setScheduledForLocal(dateSlots[0]?.localKey || '');
  }, [fulfillmentMode, selectedDate, dateSlots]);

  const orderItems = useMemo(() => cartProducts.map(item => ({ productId: item._id, quantity: item.quantity })), [cartProducts]);
  const orderItemKey = useMemo(() => orderItems.map(item => `${item.productId}:${item.quantity}`).join('|'), [orderItems]);

  useEffect(() => {
    const needsZone = fulfillmentType === 'DELIVERY';
    if (!user || !orderItems.length || (needsZone && !deliveryZoneId)) { setQuote(null); setQuoteError(''); return undefined; }
    let active = true;
    const timer = setTimeout(async () => {
      setQuoteLoading(true); setQuoteError('');
      try {
        const data = await api.quoteOrder({
          items: orderItems,
          ...(couponCode && { couponCode }),
          pointsToRedeem: Number(pointsToRedeem) || 0,
          fulfillmentType,
          ...(needsZone && { deliveryZoneId, postalCode: form.postalCode.trim() || undefined }),
        });
        if (active) setQuote(data.quote);
      } catch (requestError) { if (active) setQuoteError(requestError.message); }
      finally { if (active) setQuoteLoading(false); }
    }, 220);
    return () => { active = false; clearTimeout(timer); };
  }, [user, orderItemKey, couponCode, pointsToRedeem, fulfillmentType, deliveryZoneId, form.postalCode]);

  if (!cartProducts.length) return <EmptyState icon="🥡" title="Nothing to check out yet" text="Choose your favourites before starting checkout." />;

  const update = event => setForm(previous => ({ ...previous, [event.target.name]: event.target.value }));
  const submit = async event => {
    event.preventDefault();
    if (!user) { setError('Please sign in to place your order.'); return; }
    if (!selectedFulfillment?.enabled) { setError(`${fulfillmentType === 'PICKUP' ? 'Pickup' : 'Delivery'} is unavailable right now.`); return; }
    if (fulfillmentMode === 'ASAP' && !selectedFulfillment.asapAvailable) { setError('ASAP ordering is unavailable right now. Choose an available scheduled time.'); return; }
    if (fulfillmentMode === 'SCHEDULED' && !scheduledForLocal) { setError('Please choose an available date and time.'); return; }
    if (fulfillmentType === 'DELIVERY' && !deliveryZoneId) { setError('Please select your delivery area.'); return; }
    if (quoteError) { setError(quoteError); return; }
    if (quote?.deliveryZone && !quote.deliveryZone.minimumOrderMet) { setError(`Minimum order for ${quote.deliveryZone.name} has not been met.`); return; }
    setBusy(true); setError('');
    try {
      const delivery = fulfillmentType === 'DELIVERY'
        ? form
        : { firstName: form.firstName, lastName: form.lastName, email: form.email, phone: form.phone, notes: form.notes, country: form.country };
      const result = await createOrder({
        items: orderItems,
        paymentMethod,
        pointsToRedeem: Number(pointsToRedeem) || 0,
        fulfillmentType,
        fulfillmentMode,
        ...(fulfillmentMode === 'SCHEDULED' && { scheduledForLocal }),
        ...(fulfillmentType === 'DELIVERY' && { deliveryZoneId }),
        ...(paymentMethod === 'MANUAL' && { manualChannelId }),
        ...(couponCode && { couponCode }),
        delivery,
      });
      const { order } = result;
      setCartItems({});
      if (paymentMethod === 'MANUAL') navigate(`/payment/manual/${order.id}`);
      else if (paymentMethod === 'ONLINE' && result.paymentUrl) window.location.assign(result.paymentUrl);
      else navigate(`/order-success/${order.orderNumber}`, { state: { order, paymentError: result.paymentError, loyalty: result.loyalty } });
    } catch (requestError) {
      setError(requestError.message);
      refreshStoreStatus?.().catch(() => {});
      api.getFulfillmentOptions().then(setFulfillment).catch(() => {});
    } finally { setBusy(false); }
  };

  const loyalty = quote?.loyalty;
  const subtotal = quote ? quote.subtotalCents / 100 : getTotalCartAmount();
  const promoDiscount = quote ? quote.discountCents / 100 : 0;
  const pointsDiscount = quote ? quote.pointsDiscountCents / 100 : 0;
  const selectedDeliveryZone = deliveryZones.find(zone => zone.id === deliveryZoneId);
  const delivery = fulfillmentType === 'PICKUP' ? 0 : quote ? quote.deliveryFeeCents / 100 : (subtotal > 0 ? (selectedDeliveryZone?.feeCents || 0) / 100 : 0);
  const total = quote ? quote.totalCents / 100 : undefined;
  const minimumOrderBlocked = Boolean(quote?.deliveryZone && !quote.deliveryZone.minimumOrderMet);
  const fulfillmentBlocked = Boolean(fulfillmentError || !selectedFulfillment?.enabled || (fulfillmentMode === 'ASAP' ? !selectedFulfillment?.asapAvailable : !scheduledForLocal));
  const zoneBlocked = fulfillmentType === 'DELIVERY' && (Boolean(deliveryZonesError) || !deliveryZoneId);

  return <div className="checkout-page">
    <header className="page-title"><div className="section-kicker">Secure checkout</div><h1>Complete your order</h1><p>Choose delivery or pickup, select when you want it, and confirm your details.</p></header>
    {storeStatus && !storeStatus.isOpen && <div className="store-closed-checkout" role="status"><Icon name="clock" /><div><strong>{storeStatus.headline}</strong><p>{selectedFulfillment?.scheduledEnabled && selectedFulfillment?.slots?.length ? `${storeStatus.message} You can still reserve a future slot.` : storeStatus.message}</p></div></div>}
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
        <div className="checkout-section-title"><span>2</span><div><h2>How & when?</h2><p>Choose fulfilment and an available time.</p></div></div>
        {fulfillmentError && <p className="form-error">{fulfillmentError}</p>}
        <div className="fulfillment-type-options">
          <FulfillmentCard type="DELIVERY" icon="delivery" title="Delivery" text="Bring it to my address" option={fulfillment?.options?.DELIVERY} selected={fulfillmentType === 'DELIVERY'} onClick={() => setFulfillmentType('DELIVERY')} />
          <FulfillmentCard type="PICKUP" icon="store" title="Pickup" text="I’ll collect from the restaurant" option={fulfillment?.options?.PICKUP} selected={fulfillmentType === 'PICKUP'} onClick={() => setFulfillmentType('PICKUP')} />
        </div>
        <div className="fulfillment-mode-options">
          <label className={`fulfillment-mode ${fulfillmentMode === 'ASAP' ? 'is-selected' : ''} ${!selectedFulfillment?.asapAvailable ? 'is-disabled' : ''}`}><input type="radio" checked={fulfillmentMode === 'ASAP'} disabled={!selectedFulfillment?.asapAvailable} onChange={() => setFulfillmentMode('ASAP')} /><Icon name="clock" /><div><strong>ASAP</strong><small>{selectedFulfillment?.asapAvailable ? `Ready in about ${selectedFulfillment.asapEtaMinutes} minutes` : 'Unavailable right now'}</small></div></label>
          <label className={`fulfillment-mode ${fulfillmentMode === 'SCHEDULED' ? 'is-selected' : ''} ${!selectedFulfillment?.scheduledEnabled || !selectedFulfillment?.slots?.length ? 'is-disabled' : ''}`}><input type="radio" checked={fulfillmentMode === 'SCHEDULED'} disabled={!selectedFulfillment?.scheduledEnabled || !selectedFulfillment?.slots?.length} onChange={() => setFulfillmentMode('SCHEDULED')} /><Icon name="calendar" /><div><strong>Schedule for later</strong><small>{selectedFulfillment?.slots?.length ? `${selectedFulfillment.slots.length} slots available` : 'No future slots available'}</small></div></label>
        </div>
        {fulfillmentMode === 'SCHEDULED' && <div className="schedule-picker">
          <div className="field"><label htmlFor="scheduleDate">Date</label><select id="scheduleDate" value={selectedDate} onChange={event => setSelectedDate(event.target.value)}>{scheduleDates.map(date => <option key={date} value={date}>{formatScheduleDate(date, fulfillment?.store?.localDate)}</option>)}</select></div>
          <div className="field"><label htmlFor="scheduleTime">Time</label><select id="scheduleTime" value={scheduledForLocal} onChange={event => setScheduledForLocal(event.target.value)}>{dateSlots.map(slot => <option key={slot.localKey} value={slot.localKey}>{slot.displayTime} · {slot.remaining} spot{slot.remaining === 1 ? '' : 's'} left</option>)}</select></div>
        </div>}

        <div className="checkout-divider" />
        {fulfillmentType === 'DELIVERY' ? <>
          <div className="checkout-section-title"><span>3</span><div><h2>Delivery address</h2><p>Select your service area so the server can calculate the correct delivery fee.</p></div></div>
          <div className="field delivery-zone-field"><label htmlFor="deliveryZone">Delivery area *</label><select id="deliveryZone" value={deliveryZoneId} onChange={event => setDeliveryZoneId(event.target.value)} required disabled={!deliveryZones.length}><option value="" disabled>{deliveryZones.length ? 'Select delivery area' : 'No delivery zones available'}</option>{deliveryZones.map(zone => <option key={zone.id} value={zone.id}>{zone.name} · {zone.feeCents === 0 ? 'Free delivery' : formatCurrency(zone.feeCents / 100, zone.currency)}</option>)}</select>{deliveryZonesError && <p className="form-error">{deliveryZonesError}</p>}{deliveryZoneId && <DeliveryZoneHint zone={deliveryZones.find(zone => zone.id === deliveryZoneId)} />}</div>
          <div className="field"><label htmlFor="street">Street address *</label><input id="street" name="street" value={form.street} onChange={update} required autoComplete="street-address" /></div>
          <div className="field-grid">
            <div className="field"><label htmlFor="city">City *</label><input id="city" name="city" value={form.city} onChange={update} required autoComplete="address-level2" /></div>
            <div className="field"><label htmlFor="state">State/Division *</label><input id="state" name="state" value={form.state} onChange={update} required autoComplete="address-level1" /></div>
            <div className="field"><label htmlFor="postalCode">Postal code *</label><input id="postalCode" name="postalCode" value={form.postalCode} onChange={update} required autoComplete="postal-code" /></div>
            <div className="field"><label htmlFor="country">Country *</label><input id="country" name="country" value={form.country} onChange={update} required autoComplete="country-name" /></div>
          </div>
        </> : <div className="pickup-details-card"><Icon name="store" size={24} /><div><h3>Restaurant pickup</h3><p>{fulfillment?.settings?.pickupAddress || 'Pickup address will be confirmed by the restaurant.'}</p>{fulfillment?.settings?.pickupInstructions && <small>{fulfillment.settings.pickupInstructions}</small>}</div></div>}
        <div className="field"><label htmlFor="notes">{fulfillmentType === 'PICKUP' ? 'Pickup note' : 'Delivery note'} <span className="muted">(optional)</span></label><textarea id="notes" name="notes" value={form.notes} onChange={update} maxLength="500" placeholder={fulfillmentType === 'PICKUP' ? 'Anything the kitchen or pickup counter should know?' : 'Landmark, gate code, or delivery instruction'} /></div>

        <div className="checkout-divider" />
        <div className="checkout-section-title"><span>4</span><div><h2>Payment method</h2><p>Choose how you would like to pay.</p></div></div>
        <div className="payment-options" role="radiogroup" aria-label="Payment method">
          <label className={`payment-option ${paymentMethod === 'COD' ? 'is-selected' : ''}`}><input type="radio" name="paymentMethod" value="COD" checked={paymentMethod === 'COD'} onChange={() => setPaymentMethod('COD')} /><Icon name="cash" size={24} /><div><strong>{fulfillmentType === 'PICKUP' ? 'Pay on pickup' : 'Cash on delivery'}</strong><small>{fulfillmentType === 'PICKUP' ? 'Pay when you collect your food' : 'Pay in cash when your food arrives'}</small></div><span className="payment-radio" /></label>
          <label className={`payment-option ${paymentMethod === 'ONLINE' ? 'is-selected' : ''} ${!paymentOptions?.methods.find(method => method.id === 'ONLINE')?.enabled ? 'is-disabled' : ''}`}><input type="radio" name="paymentMethod" value="ONLINE" checked={paymentMethod === 'ONLINE'} disabled={!paymentOptions?.methods.find(method => method.id === 'ONLINE')?.enabled} onChange={() => setPaymentMethod('ONLINE')} /><Icon name="card" size={24} /><div><strong>{paymentOptions?.methods.find(method => method.id === 'ONLINE')?.label || 'Online payment'}</strong><small>{!paymentOptions ? 'Loading online payment…' : paymentOptions.methods.find(method => method.id === 'ONLINE')?.mode === 'demo' ? 'Development-only secure flow simulation' : 'Card, mobile banking and supported methods'}</small></div><span className="payment-radio" /></label>
        </div>
        {paymentOptions?.methods.find(method => method.id === 'ONLINE')?.mode === 'demo' && paymentMethod === 'ONLINE' && <p className="payment-demo-note"><Icon name="alert" size={17} />Demo gateway is enabled for development. Configure SSLCOMMERZ credentials before production.</p>}
        <label className={`payment-option ${paymentMethod === 'MANUAL' ? 'is-selected' : ''} ${!paymentOptions?.manualChannels?.length ? 'is-disabled' : ''}`}><input type="radio" name="paymentMethod" value="MANUAL" disabled={!paymentOptions?.manualChannels?.length} checked={paymentMethod === 'MANUAL'} onChange={() => { setPaymentMethod('MANUAL'); setManualChannelId(paymentOptions.manualChannels[0].id); }} /><Icon name="cash" size={24} /><div><strong>Manual payment</strong><small>{paymentOptions?.manualChannels?.length ? 'Pay directly, then submit your transaction ID' : 'The restaurant has not configured this method yet'}</small></div><span className="payment-radio" /></label>
        {paymentMethod === 'MANUAL' && <div className="field" style={{ marginTop: '16px' }}><label htmlFor="manual-channel">Payment account</label><select id="manual-channel" required value={manualChannelId} onChange={event => setManualChannelId(event.target.value)}>{paymentOptions.manualChannels.map(channel => <option key={channel.id} value={channel.id}>{channel.label} · {channel.provider}</option>)}</select><p className="muted">Place your order to see the exact amount and payment instructions.</p></div>}
      </section>

      <div className="checkout-sidebar">
        <OrderSummary subtotal={subtotal} discount={promoDiscount} pointsDiscount={pointsDiscount} delivery={delivery} total={total} action={{ type: 'submit' }} actionLabel={busy ? 'Processing…' : fulfillmentMode === 'SCHEDULED' ? 'Reserve slot & place order' : paymentMethod === 'MANUAL' ? 'Place order & view payment details' : paymentMethod === 'ONLINE' ? 'Continue to secure payment' : 'Place order'} disabled={busy || quoteLoading || Boolean(quoteError) || zoneBlocked || fulfillmentBlocked || minimumOrderBlocked}>
          <div className="fulfillment-summary"><Icon name={fulfillmentType === 'PICKUP' ? 'store' : 'delivery'} size={18} /><div><strong>{fulfillmentType === 'PICKUP' ? 'Pickup' : 'Delivery'} · {fulfillmentMode === 'ASAP' ? 'ASAP' : 'Scheduled'}</strong><small>{fulfillmentMode === 'ASAP' ? `About ${selectedFulfillment?.asapEtaMinutes || 0} minutes` : scheduledForLocal ? formatScheduledLocal(scheduledForLocal) : 'Choose a time'}</small></div></div>
          {user && loyalty && <section className={`loyalty-checkout ${loyalty.enabled ? '' : 'is-disabled'}`}>
            <div className="loyalty-checkout-head"><div><span><Icon name="gift" size={18} />Tomato Points</span><strong>{loyalty.pointsBalance} points</strong></div>{loyalty.enabled && loyalty.pointsPerOrder > 0 && <small>Earn {loyalty.pointsPerOrder} more after delivery</small>}</div>
            {!loyalty.enabled ? <p>Points are currently paused by the restaurant. Your balance is kept safely.</p> : loyalty.pointsBalance < loyalty.minimumRedeemPoints ? <p>You need at least <strong>{loyalty.minimumRedeemPoints}</strong> points to unlock a discount.</p> : <>
              <label htmlFor="points-to-redeem">Use points on this order</label>
              <div className="points-redeem-row"><input id="points-to-redeem" type="number" min="0" max={loyalty.maxRedeemPoints || loyalty.pointsBalance} step="1" value={pointsToRedeem} onChange={event => setPointsToRedeem(Math.max(0, Number(event.target.value) || 0))} /><button type="button" onClick={() => setPointsToRedeem(loyalty.maxRedeemPoints || 0)} disabled={!loyalty.maxRedeemPoints}>Use max</button></div>
              <small>Minimum {loyalty.minimumRedeemPoints} points · 1 point = {formatCurrency(loyalty.pointValueCents / 100, loyalty.currency)}</small>
            </>}
          </section>}
          <div className="payment-card"><Icon name={paymentMethod === 'COD' ? 'check' : 'lock'} /><div><strong>{paymentMethod === 'MANUAL' ? 'Manual payment verification' : paymentMethod === 'ONLINE' ? 'Server-verified payment' : fulfillmentType === 'PICKUP' ? 'Pay on pickup' : 'Cash on delivery'}</strong><small>{paymentMethod === 'MANUAL' ? 'The restaurant verifies your submitted transaction' : paymentMethod === 'ONLINE' ? 'Payment status is updated only after verification' : fulfillmentType === 'PICKUP' ? 'Pay when you collect your food' : 'Pay when your food arrives'}</small></div></div>
          {quote?.deliveryZone && <div className={`delivery-pricing-note ${minimumOrderBlocked ? 'is-warning' : quote.deliveryZone.freeDelivery ? 'is-free' : ''}`}><Icon name="delivery" size={18} /><div><strong>{quote.deliveryZone.name}</strong>{minimumOrderBlocked ? <p>Add {formatCurrency(quote.deliveryZone.minimumOrderRemainingCents / 100, quote.deliveryZone.currency)} more in food to reach the {formatCurrency(quote.deliveryZone.minimumOrderCents / 100, quote.deliveryZone.currency)} minimum.</p> : quote.deliveryZone.freeDelivery ? <p>Free delivery unlocked for this order.</p> : quote.deliveryZone.freeDeliveryRemainingCents > 0 ? <p>Add {formatCurrency(quote.deliveryZone.freeDeliveryRemainingCents / 100, quote.deliveryZone.currency)} more in food to unlock free delivery.</p> : <p>Delivery fee calculated for this area.</p>}</div></div>}
          {fulfillmentType === 'PICKUP' && <div className="delivery-pricing-note is-free"><Icon name="store" size={18} /><div><strong>No delivery fee</strong><p>Pickup orders are collected directly from the restaurant.</p></div></div>}
          {couponCode && <p className="coupon-notice">Promo code <strong>{couponCode}</strong> {quote?.couponCode ? 'applied.' : 'will be verified now.'}</p>}
          {quoteLoading && <p className="quote-note">Updating secure total…</p>}
          {quoteError && <p className="form-error" role="alert">{quoteError}</p>}
          {!user && <div className="signin-notice"><p>Already have an account?</p><button type="button" className="button button-secondary button-full" onClick={onLogin}><Icon name="user" />Sign in to continue</button></div>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </OrderSummary>
        <Link className="back-to-cart" to="/cart">← Return to cart</Link>
      </div>
    </form>
  </div>;
}

function FulfillmentCard({ icon, title, text, option, selected, onClick }) {
  return <button type="button" className={`fulfillment-type-card ${selected ? 'is-selected' : ''} ${!option?.enabled ? 'is-disabled' : ''}`} disabled={!option?.enabled} onClick={onClick}><Icon name={icon} size={25} /><span><strong>{title}</strong><small>{option?.enabled ? text : 'Currently unavailable'}</small></span><i /></button>;
}

function DeliveryZoneHint({ zone }) {
  if (!zone) return null;
  return <div className="delivery-zone-hint"><Icon name="delivery" size={16} /><div>{zone.description && <p>{zone.description}</p>}<small>{zone.minimumOrderCents > 0 ? `Minimum order ${formatCurrency(zone.minimumOrderCents / 100, zone.currency)}` : 'No minimum order'}{zone.freeDeliveryThresholdCents ? ` · Free delivery from ${formatCurrency(zone.freeDeliveryThresholdCents / 100, zone.currency)}` : ''}{zone.postalCodes?.length ? ` · Postal codes: ${zone.postalCodes.join(', ')}` : ''}</small></div></div>;
}

function formatScheduleDate(dateKey, currentDateKey) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  if (dateKey === currentDateKey) return `Today · ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  const tomorrow = currentDateKey && new Date(`${currentDateKey}T12:00:00Z`);
  if (tomorrow) { tomorrow.setUTCDate(tomorrow.getUTCDate() + 1); if (dateKey === tomorrow.toISOString().slice(0, 10)) return `Tomorrow · ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`; }
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatScheduledLocal(localKey) {
  const [dateKey, timeKey] = localKey.split('T');
  const [hour, minute] = timeKey.split(':').map(Number);
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayTime = `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${period}`;
  const date = new Date(`${dateKey}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${date} at ${displayTime}`;
}
