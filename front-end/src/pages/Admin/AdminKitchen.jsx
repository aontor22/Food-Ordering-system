import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { KITCHEN_LANES, kitchenLaneForOrder, kitchenTimerForOrder, sortKitchenOrders } from '../../lib/kitchenDisplay';
import Icon from '../../components/ui/Icon';
import { AdminEmpty, AdminError, AdminLoading, AdminPageHeader } from '../../components/admin/AdminUI';
import OrderItemCustomization from '../../components/orders/OrderItemCustomization';

const laneCopy = {
  NEW: ['New', 'Confirmed orders waiting for the kitchen'],
  PREPARING: ['Preparing', 'Orders currently being cooked'],
  READY: ['Ready', 'Finished orders waiting for handoff'],
};
const prepOptions = [10, 15, 20, 25, 30, 45];
const deliveryOptions = [10, 20, 30, 45, 60];

function formatScheduled(value) {
  if (!value) return 'Scheduled';
  const [dateKey, timeKey] = value.split('T');
  const [hour, minute] = timeKey.split(':').map(Number);
  const time = `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
  const date = new Date(`${dateKey}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${date} · ${time}`;
}

export default function AdminKitchen() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [liveState, setLiveState] = useState('connecting');
  const [now, setNow] = useState(Date.now());
  const [prepMinutes, setPrepMinutes] = useState({});
  const [deliveryMinutes, setDeliveryMinutes] = useState({});

  const load = useCallback(async () => {
    setError('');
    try { setOrders((await api.getAdminKitchen()).orders || []); }
    catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => api.subscribeAdminKitchen({
    onState: setLiveState,
    onEvent: (event, data) => { if (event === 'snapshot' && Array.isArray(data?.orders)) setOrders(data.orders); },
  }), []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  const groups = useMemo(() => Object.fromEntries(KITCHEN_LANES.map(lane => [lane, sortKitchenOrders(orders.filter(order => kitchenLaneForOrder(order) === lane), lane)])), [orders]);
  const attentionCount = useMemo(() => orders.filter(order => ['warning', 'critical'].includes(kitchenTimerForOrder(order, now).tone)).length, [orders, now]);

  const update = async (order, status, options = {}) => {
    setBusy(`${order.id}:${status}`); setError('');
    try {
      const { order: updated } = await api.updateAdminOrderStatus(order.id, status, options);
      setOrders(previous => status === 'READY' || status === 'PREPARING'
        ? previous.map(item => item.id === updated.id ? { ...updated, kitchenLane: kitchenLaneForOrder(updated) } : item)
        : previous.filter(item => item.id !== updated.id));
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(''); }
  };

  const enterFullscreen = async () => {
    try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); else await document.exitFullscreen(); }
    catch { /* Browser may block fullscreen outside supported contexts. */ }
  };

  if (loading) return <AdminLoading label="Opening the kitchen display…" />;
  if (error && !orders.length) return <AdminError message={error} retry={load} />;

  return <div className="kds-page">
    <AdminPageHeader eyebrow="Kitchen display" title={`${orders.length} active kitchen order${orders.length === 1 ? '' : 's'}`} description="A live production board for confirmed, preparing and ready orders." action={<div className="admin-live-actions"><span className={`admin-live-state is-${liveState}`}><i />{liveState === 'connected' ? 'Live' : liveState === 'reconnecting' ? 'Reconnecting' : 'Connecting'}</span><button className="button button-secondary" onClick={enterFullscreen}><Icon name="eye" />Kitchen screen</button><button className="button button-secondary" onClick={load}><Icon name="refresh" />Refresh</button></div>} />
    <div className="kds-summary surface-card"><div><span>New</span><strong>{groups.NEW.length}</strong></div><div><span>Preparing</span><strong>{groups.PREPARING.length}</strong></div><div><span>Ready</span><strong>{groups.READY.length}</strong></div><div className={attentionCount ? 'has-attention' : ''}><span>Needs attention</span><strong>{attentionCount}</strong></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="kds-board">
      {KITCHEN_LANES.map(lane => <section className={`kds-lane lane-${lane.toLowerCase()}`} key={lane}>
        <header><div><span className="kds-lane-dot" /><h3>{laneCopy[lane][0]}</h3><strong>{groups[lane].length}</strong></div><p>{laneCopy[lane][1]}</p></header>
        <div className="kds-lane-orders">
          {groups[lane].length ? groups[lane].map(order => <KitchenTicket key={order.id} order={order} now={now} busy={busy} prepMinutes={prepMinutes[order.id] || 25} deliveryMinutes={deliveryMinutes[order.id] || 30} onPrepMinutes={value => setPrepMinutes(values => ({ ...values, [order.id]: value }))} onDeliveryMinutes={value => setDeliveryMinutes(values => ({ ...values, [order.id]: value }))} onUpdate={update} />) : <AdminEmpty icon="orders" title={`No ${laneCopy[lane][0].toLowerCase()} orders`} text={lane === 'READY' ? 'Finished tickets will wait here for pickup or dispatch.' : 'New kitchen work will appear here automatically.'} />}
        </div>
      </section>)}
    </div>
  </div>;
}

function KitchenTicket({ order, now, busy, prepMinutes, deliveryMinutes, onPrepMinutes, onDeliveryMinutes, onUpdate }) {
  const lane = kitchenLaneForOrder(order);
  const timer = kitchenTimerForOrder(order, now);
  const totalQuantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const scheduled = order.fulfillmentMode === 'SCHEDULED';
  const locked = Boolean(busy);

  return <article className={`kds-ticket timer-${timer.tone}`}>
    <div className="kds-ticket-top"><div><span className="kds-order-number">#{order.orderNumber}</span><strong>{order.fulfillmentType === 'PICKUP' ? 'Pickup' : 'Delivery'}</strong></div><div className={`kds-timer is-${timer.tone}`}><strong>{timer.primary}</strong><span>{timer.secondary}</span></div></div>
    <div className="kds-ticket-meta"><span><Icon name={order.fulfillmentType === 'PICKUP' ? 'store' : 'delivery'} size={15} />{order.fulfillmentType === 'PICKUP' ? 'Pickup' : 'Delivery'}</span><span><Icon name={scheduled ? 'calendar' : 'clock'} size={15} />{scheduled ? formatScheduled(order.scheduledForLocal) : 'ASAP'}</span><span>{totalQuantity} item{totalQuantity === 1 ? '' : 's'}</span></div>
    <div className="kds-items">{order.items.map(item => <div className="kds-item" key={item.id}><div><strong>{item.quantity}×</strong><span>{item.productName}</span><small>{formatCurrency(item.lineTotalCents / 100, order.payment?.currency)}</small></div><OrderItemCustomization item={item} currency={order.payment?.currency} compact /></div>)}</div>
    {order.notes && <div className="kds-order-note"><Icon name="alert" size={16} /><div><strong>Order note</strong><p>{order.notes}</p></div></div>}
    <footer className="kds-ticket-actions">
      {lane === 'NEW' && <><label>Prep target<select value={prepMinutes} disabled={locked} onChange={event => onPrepMinutes(Number(event.target.value))}>{prepOptions.map(value => <option value={value} key={value}>{value} min</option>)}</select></label><button className="button button-primary" disabled={locked} onClick={() => onUpdate(order, 'PREPARING', { estimateMinutes: prepMinutes, note: 'Kitchen started preparing the order.' })}>{busy === `${order.id}:PREPARING` ? 'Starting…' : 'Start preparing'}</button></>}
      {lane === 'PREPARING' && <button className="button button-primary kds-wide-action" disabled={locked} onClick={() => onUpdate(order, 'READY', { note: 'Kitchen marked the food ready.' })}>{busy === `${order.id}:READY` ? 'Updating…' : 'Mark ready'}</button>}
      {lane === 'READY' && order.fulfillmentType === 'PICKUP' && <button className="button button-primary kds-wide-action" disabled={locked} onClick={() => onUpdate(order, 'DELIVERED', { note: 'Pickup handed to customer.' })}>{busy === `${order.id}:DELIVERED` ? 'Completing…' : 'Complete pickup'}</button>}
      {lane === 'READY' && order.fulfillmentType === 'DELIVERY' && <><label>Delivery ETA<select value={deliveryMinutes} disabled={locked} onChange={event => onDeliveryMinutes(Number(event.target.value))}>{deliveryOptions.map(value => <option value={value} key={value}>{value} min</option>)}</select></label><button className="button button-primary" disabled={locked} onClick={() => onUpdate(order, 'OUT_FOR_DELIVERY', { estimateMinutes: deliveryMinutes, note: 'Order handed to delivery.' })}>{busy === `${order.id}:OUT_FOR_DELIVERY` ? 'Dispatching…' : 'Dispatch order'}</button></>}
    </footer>
  </article>;
}
