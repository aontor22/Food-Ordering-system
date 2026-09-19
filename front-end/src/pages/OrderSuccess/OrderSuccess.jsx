import { Link, useLocation, useParams } from 'react-router-dom';
import { formatCurrency } from '../../lib/format';
import Icon from '../../components/ui/Icon';
import './OrderSuccess.css';

export default function OrderSuccess() {
  const { orderNumber } = useParams();
  const { state } = useLocation();
  const order = state?.order;
  return <section className="success-page surface-card">
    <div className="success-check"><Icon name="check" size={42} strokeWidth={2.4} /></div>
    <div className="section-kicker">Order confirmed</div>
    <h1>Thanks—your food is on its way!</h1>
    <p>We’ve received order <strong>{orderNumber}</strong>. Keep your phone nearby for delivery updates.</p>
    {order && <div className="success-details">
      <div><span>Payment</span><strong>Cash on delivery</strong></div>
      <div><span>Order total</span><strong>{formatCurrency(order.totalCents / 100)}</strong></div>
      <div><span>Status</span><strong>Pending confirmation</strong></div>
    </div>}
    <div className="success-actions"><Link to="/orders" className="button button-primary">View my orders</Link><Link to="/" className="button button-secondary">Back to menu</Link></div>
  </section>;
}
