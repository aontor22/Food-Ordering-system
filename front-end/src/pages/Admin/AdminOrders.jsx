import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { formatCurrency, formatDate, humanizeStatus } from '../../lib/format';
import Icon from '../../components/ui/Icon';
import { AdminEmpty, AdminError, AdminLoading, AdminPageHeader, StatusBadge } from '../../components/admin/AdminUI';

const transitionsFor = order => ({
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: [order.fulfillmentType === 'PICKUP' ? 'READY_FOR_PICKUP' : 'OUT_FOR_DELIVERY', 'CANCELLED'],
  READY_FOR_PICKUP: ['DELIVERED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
})[order.status] || [];
const statusValues = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];

export default function AdminOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [expanded, setExpanded] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setOrders((await api.getAdminOrders()).orders); }
    catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => orders.filter(order => {
    const haystack = `${order.orderNumber} ${order.user?.name || ''} ${order.email} ${order.phone}`.toLowerCase();
    return haystack.includes(search.toLowerCase()) && (status === 'ALL' || order.status === status);
  }), [orders, search, status]);

  const updateStatus = async (order, nextStatus) => {
    setBusy(`${order.id}:${nextStatus}`); setError('');
    try {
      const { order: updated } = await api.updateAdminOrderStatus(order.id, nextStatus);
      setOrders(previous => previous.map(item => item.id === updated.id ? updated : item));
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(''); }
  };

  if (loading) return <AdminLoading label="Loading restaurant orders…" />;
  if (error && !orders.length) return <AdminError message={error} retry={load} />;

  return <>
    <AdminPageHeader eyebrow="Fulfilment queue" title={`${orders.length} total orders`} description="Expand an order to review its items and delivery details." action={<button className="button button-secondary" onClick={load}><Icon name="refresh" />Refresh</button>} />
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="admin-toolbar">
      <label className="admin-search"><Icon name="search" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search order, customer, email or phone…" aria-label="Search orders" /></label>
      <select value={status} onChange={event => setStatus(event.target.value)} aria-label="Filter order status"><option value="ALL">All statuses</option>{statusValues.map(value => <option key={value} value={value}>{humanizeStatus(value)}</option>)}</select>
    </div>
    <section className="admin-card">
      {visible.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Payment</th><th>Total</th><th className="align-right">Actions</th></tr></thead>
        <tbody>{visible.map(order => <OrderRows key={order.id} order={order} expanded={expanded === order.id} onExpand={() => setExpanded(value => value === order.id ? '' : order.id)} onStatus={next => updateStatus(order, next)} busy={busy} />)}</tbody>
      </table></div> : <AdminEmpty icon="orders" title="No matching orders" text="Try a different search term or status filter." />}
    </section>
  </>;
}

function OrderRows({ order, expanded, onExpand, onStatus, busy }) {
  const availableTransitions = transitionsFor(order).filter(nextStatus => {
    if (nextStatus === 'CANCELLED' && order.paymentMethod === 'MANUAL' && order.paymentStatus === 'REVIEW') return false;
    if (nextStatus === 'CANCELLED' && order.payment?.provider === 'SSLCOMMERZ' && ['PROCESSING', 'REVIEW', 'REFUND_PENDING'].includes(order.paymentStatus)) return false;
    if (nextStatus === 'CANCELLED' && order.paymentMethod !== 'COD' && order.paymentStatus === 'PAID') return false;
    if (nextStatus !== 'CANCELLED' && order.paymentMethod !== 'COD' && order.paymentStatus !== 'PAID') return false;
    return true;
  });
  return <>
    <tr>
      <td><strong>{order.orderNumber}</strong><small>{formatDate(order.createdAt)}</small></td>
      <td><strong>{order.user?.name || `${order.firstName} ${order.lastName}`}</strong><small>{order.email}</small></td>
      <td><StatusBadge value={order.status} /></td><td><StatusBadge value={order.paymentStatus} /></td><td><strong>{formatCurrency(order.totalCents / 100, order.payment?.currency)}</strong><small>{order.items.length} item types</small></td>
      <td><div className="admin-table-actions"><button className="admin-icon-action" onClick={onExpand} title="View order details" aria-label={`View ${order.orderNumber}`}><Icon name={expanded ? 'chevronDown' : 'eye'} size={17} /></button></div></td>
    </tr>
    {expanded && <tr className="order-expanded"><td colSpan="6"><div className="order-detail">
      <div><h4>Order items</h4><ul>{order.items.map(item => <li key={item.id}>{item.quantity} × {item.productName} — {formatCurrency(item.lineTotalCents / 100, order.payment?.currency)}</li>)}</ul>{order.discountCents > 0 && <p>Promo discount: −{formatCurrency(order.discountCents / 100)} ({order.couponCode})</p>}{order.pointsRedeemed > 0 && <p>Points discount: −{formatCurrency(order.pointsDiscountCents / 100, order.payment?.currency)} ({order.pointsRedeemed} points)</p>}{order.pointsEarned > 0 && <p><strong>Reward:</strong> +{order.pointsEarned} points earned</p>}</div>
      <div><h4>{order.fulfillmentType === 'PICKUP' ? 'Pickup' : 'Delivery'} details</h4><p><strong>{order.fulfillmentType === 'PICKUP' ? 'Pickup' : 'Delivery'}:</strong> {order.fulfillmentMode === 'SCHEDULED' ? formatScheduled(order.scheduledForLocal) : 'ASAP'}{order.schedulingTimezone ? ` (${order.schedulingTimezone})` : ''}</p>{order.deliveryZoneName && <p><strong>Zone:</strong> {order.deliveryZoneName}<br /><strong>Delivery fee:</strong> {formatCurrency(order.deliveryFeeCents / 100, order.payment?.currency)}</p>}{order.fulfillmentType === 'DELIVERY' ? <p>{order.firstName} {order.lastName}<br />{order.street}<br />{order.city}, {order.state} {order.postalCode}<br />{order.country}<br />{order.phone}</p> : <p>{order.firstName} {order.lastName}<br />{order.phone}<br />Customer will collect from the restaurant.{order.pickupAddressSnapshot ? <><br /><strong>Pickup address:</strong> {order.pickupAddressSnapshot}</> : null}{order.pickupInstructionsSnapshot ? <><br /><strong>Instructions:</strong> {order.pickupInstructionsSnapshot}</> : null}</p>}{order.notes && <p><strong>Note:</strong> {order.notes}</p>}</div>
      <div><h4>Update status</h4><div className="order-actions">{availableTransitions.map(nextStatus => <button key={nextStatus} className={`button button-small ${nextStatus === 'CANCELLED' ? 'button-secondary' : 'button-primary'}`} disabled={Boolean(busy)} onClick={() => onStatus(nextStatus)}>{busy === `${order.id}:${nextStatus}` ? 'Updating…' : humanizeStatus(nextStatus)}</button>)}{!availableTransitions.length && <StatusBadge value={order.status} />}</div>{order.paymentMethod !== 'COD' && order.paymentStatus === 'PAID' && ['PENDING','CONFIRMED','PREPARING'].includes(order.status) && <p>Paid orders require a refund before cancellation.</p>}</div>
      <div><h4>Payment & total</h4><p>{order.paymentMethod === 'MANUAL' ? `Manual · ${order.payment?.manualDestination?.provider || ''}` : order.paymentMethod === 'ONLINE' ? order.payment?.provider || 'Online' : 'Cash on delivery'} · {humanizeStatus(order.paymentStatus)}<br />Transaction: {order.payment?.transactionId || 'Legacy order'}<br />Attempts: {order.payment?.attempts || 0}<br /><strong>{formatCurrency(order.totalCents / 100, order.payment?.currency)}</strong></p>{order.payment?.failureReason && <p><strong>Payment note:</strong> {order.payment.failureReason}</p>}</div>
    </div></td></tr>}
  </>;
}


function formatScheduled(value) {
  if (!value) return 'Scheduled';
  const [dateKey, timeKey] = value.split('T');
  const [hour, minute] = timeKey.split(':').map(Number);
  const time = `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
  const date = new Date(`${dateKey}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${date} at ${time}`;
}
