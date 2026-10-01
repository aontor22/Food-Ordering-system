# Step 05 — Fulfilment scheduling setup

This release adds customer-selectable delivery or pickup, ASAP or scheduled fulfilment, future time-slot generation from the restaurant opening-hours calendar, lead times, capacity limits and per-slot overrides.

## Database changes

Migration `20260925000000_fulfillment_scheduling` adds:

- `FulfillmentSetting`
- `FulfillmentSlotOverride`
- fulfilment/scheduling snapshot columns on `Order`
- nullable delivery-address columns so pickup orders do not need a fake address
- an index for scheduled-order capacity queries

Existing orders receive `DELIVERY` + `ASAP` defaults and are not reset.

## Default production configuration

- Delivery: enabled
- Pickup: enabled
- ASAP: enabled
- Scheduled orders: enabled
- Delivery lead time: 30 minutes
- Pickup lead time: 15 minutes
- Slot interval: 30 minutes
- Booking horizon: 7 days
- Default capacity: 10 orders per slot and fulfilment type

Configure the real pickup address and instructions from **Admin → Scheduling**.

## Customer behavior

Checkout supports:

1. Delivery or pickup
2. ASAP or schedule for later
3. Available future slots generated from Store hours and holiday closures
4. Remaining capacity per slot
5. Pickup checkout without delivery zone/address or delivery fee

Scheduled orders may be booked while the restaurant is currently closed if a future slot is available. Global `Accept new orders = OFF`, an indefinite temporary closure, holiday closure, or a full/disabled slot prevents booking.

## Capacity safety

The server recalculates slot availability inside a PostgreSQL `SERIALIZABLE` order transaction. If availability changes concurrently, the request fails safely and asks the customer to choose again.

Cancelling a scheduled order automatically releases its slot because cancelled orders are excluded from booked-capacity counts.

## Admin controls

**Admin → Scheduling** controls:

- delivery enabled
- pickup enabled
- ASAP enabled
- scheduled ordering enabled
- delivery/pickup lead time
- slot interval
- future booking horizon
- default orders-per-slot capacity
- pickup address/instructions
- date/time/type slot overrides
- close one specific slot
- override one specific slot's capacity

## Deploy commands

From repository root:

```bash
npm install
npm run db:setup
npm test
npm run build
```

Then:

```bash
git add .
git commit -m "Add scheduled delivery and pickup time slots"
git push
```

Render start command remains:

```bash
npm run db:setup -w server && npm start -w server
```

No new environment variable is required.
