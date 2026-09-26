import { formatCurrency } from '../../lib/format';

export default function OrderSummary({
  subtotal,
  delivery = null,
  discount = 0,
  pointsDiscount = 0,
  total,
  action,
  actionLabel = 'Continue to checkout',
  disabled = false,
  children,
}) {
  const deliveryKnown = delivery !== null && delivery !== undefined;
  const calculatedTotal = Math.max(0, subtotal - discount - pointsDiscount + (deliveryKnown ? delivery : 0));
  return (
    <aside className="order-summary surface-card">
      <div className="section-kicker">Your order</div>
      <h2>Order summary</h2>
      <div className="summary-lines">
        <div><span>Subtotal</span><strong>{formatCurrency(subtotal)}</strong></div>
        {discount > 0 && <div className="summary-discount"><span>Promo discount</span><strong>−{formatCurrency(discount)}</strong></div>}
        {pointsDiscount > 0 && <div className="summary-discount"><span>Points discount</span><strong>−{formatCurrency(pointsDiscount)}</strong></div>}
        <div><span>Delivery fee</span><strong>{deliveryKnown ? formatCurrency(delivery) : 'At checkout'}</strong></div>
        <div className="summary-total"><span>{deliveryKnown ? 'Total' : 'Food total'}</span><strong>{formatCurrency(total ?? calculatedTotal)}</strong></div>
      </div>
      {children}
      {action && <button className="button button-primary button-full" type={action.type || 'button'} onClick={action.onClick} disabled={disabled}>{actionLabel}</button>}
      <p className="summary-note">Taxes and eligible discounts are calculated securely on the server.</p>
    </aside>
  );
}
