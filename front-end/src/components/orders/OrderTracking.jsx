import { useEffect, useMemo, useState } from 'react';
import { humanizeStatus } from '../../lib/format';
import Icon from '../ui/Icon';
import './OrderTracking.css';

const deliverySteps = ['PENDING', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const pickupSteps = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'DELIVERED'];

function useClock(active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function minutesUntil(value, now) {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - now) / 60_000);
}

function formatEventTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function etaCopy(order, now) {
  if (order.status === 'PREPARING' && order.estimatedReadyAt) {
    const minutes = minutesUntil(order.estimatedReadyAt, now);
    return minutes > 1 ? `Estimated ready in ${minutes} min` : 'Expected to be ready very soon';
  }
  if (order.status === 'OUT_FOR_DELIVERY' && order.estimatedDeliveryAt) {
    const minutes = minutesUntil(order.estimatedDeliveryAt, now);
    return minutes > 1 ? `Estimated arrival in ${minutes} min` : 'Your rider should arrive very soon';
  }
  if (order.status === 'READY_FOR_PICKUP') return 'Ready now — you can collect your order';
  return null;
}

export default function OrderTracking({ order, compact = false }) {
  const steps = order.fulfillmentType === 'PICKUP' ? pickupSteps : deliverySteps;
  const now = useClock(['PREPARING', 'OUT_FOR_DELIVERY'].includes(order.status));
  const eta = etaCopy(order, now);
  const currentIndex = steps.indexOf(order.status);
  const events = useMemo(() => [...(order.trackingEvents || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)), [order.trackingEvents]);

  if (order.status === 'CANCELLED') {
    return <section className={`order-tracker ${compact ? 'is-compact' : ''}`}>
      <div className="tracking-cancelled"><Icon name="alert" size={18} /><div><strong>Order cancelled</strong><span>{events.at(-1)?.note || 'This order is no longer being prepared.'}</span></div></div>
      {!compact && <EventTimeline events={events} />}
    </section>;
  }

  return <section className={`order-tracker ${compact ? 'is-compact' : ''}`}>
    <div className="tracking-progress" aria-label={`Order progress: ${humanizeStatus(order.status)}`}>
      {steps.map((step, index) => {
        const complete = currentIndex >= index;
        const active = currentIndex === index;
        return <div className={`tracking-step ${complete ? 'is-complete' : ''} ${active ? 'is-active' : ''}`} key={step}>
          <div className="tracking-step-mark">{complete && !active ? <Icon name="check" size={13} /> : index + 1}</div>
          <span>{step === 'OUT_FOR_DELIVERY' ? 'On the way' : step === 'READY_FOR_PICKUP' ? 'Ready' : humanizeStatus(step)}</span>
        </div>;
      })}
    </div>
    {eta && <div className="tracking-eta"><Icon name="clock" size={18} /><div><strong>{eta}</strong><span>Live estimate from the restaurant</span></div></div>}
    {!compact && <EventTimeline events={events} />}
  </section>;
}

function EventTimeline({ events }) {
  if (!events.length) return null;
  return <div className="tracking-history">
    <div className="tracking-history-title"><strong>Order timeline</strong><span>{events.length} update{events.length === 1 ? '' : 's'}</span></div>
    <ol>{[...events].reverse().map(event => <li key={event.id} className={event.kind === 'ETA' ? 'is-eta' : ''}>
      <span className="tracking-history-dot" />
      <div><div className="tracking-history-row"><strong>{event.title}</strong><time>{formatEventTime(event.createdAt)}</time></div>{event.note && <p>{event.note}</p>}{event.actorType === 'ADMIN' && <small>Restaurant update</small>}</div>
    </li>)}</ol>
  </div>;
}
