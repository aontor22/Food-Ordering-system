# Step 05 verification checklist

## Commands

```bash
npm install
npm run db:setup
npm run db:status -w server
npm test
npm run build
npm run dev
```

## Customer checks

- Checkout shows Delivery and Pickup when enabled.
- Pickup does not request a delivery zone/address and has no delivery fee.
- ASAP is unavailable when the restaurant is closed.
- Future scheduled slots are still visible when the restaurant is currently closed but a future opening exists.
- Scheduled slots follow weekly hours and special closure dates.
- Selecting a scheduled time stores it on the final order.
- Full slots disappear from checkout.
- Customer Orders shows pickup/delivery and ASAP/scheduled timing.
- Pickup order status can progress to Ready for pickup.

## Admin checks

- Admin → Scheduling saves all global controls.
- Pickup address/instructions appear at checkout.
- A disabled slot override removes that slot from checkout.
- A custom capacity override changes the remaining capacity.
- Admin Orders shows the fulfilment type and scheduled time.
- Pickup flow is PENDING → CONFIRMED → PREPARING → READY_FOR_PICKUP → DELIVERED.
- Delivery flow remains PENDING → CONFIRMED → PREPARING → OUT_FOR_DELIVERY → DELIVERED.

## API checks

```bash
curl https://YOUR-BACKEND.onrender.com/api/store/fulfillment
```

The response should include `options.DELIVERY`, `options.PICKUP`, `settings`, `timezone`, and generated slots.
