import { formatCurrency } from '../../lib/format';

export default function OrderSummary({ subtotal, action, actionLabel = 'Continue to checkout', disabled = false, children }) {
  const delivery = subtotal > 0 ? 2 : 0;
  return (
    <aside className="order-summary surface-card">
      <div className="section-kicker">Your order</div>
      <h2>Order summary</h2>
      <div className="summary-lines">
        <div><span>Subtotal</span><strong>{formatCurrency(subtotal)}</strong></div>
        <div><span>Delivery fee</span><strong>{formatCurrency(delivery)}</strong></div>
        <div className="summary-total"><span>Total</span><strong>{formatCurrency(subtotal + delivery)}</strong></div>
      </div>
      {children}
      {action && <button className="button button-primary button-full" type={action.type || 'button'} onClick={action.onClick} disabled={disabled}>{actionLabel}</button>}
      <p className="summary-note">Taxes and eligible discounts are calculated securely on the server.</p>
    </aside>
  );
}
