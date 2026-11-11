# Step 06 — Live order tracking

Tomato now keeps a durable order-status timeline in PostgreSQL and streams changes to signed-in customers and administrators with Server-Sent Events (SSE).

## What is included

- Customer-facing progress tracker for delivery and pickup orders.
- Persisted `OrderTrackingEvent` history, so refresh/redeploy does not erase the timeline.
- Status timestamps (`confirmedAt`, `preparingAt`, `readyAt`, `outForDeliveryAt`, `deliveredAt`, `cancelledAt`).
- Preparation and delivery estimates with live countdown copy.
- Admin quick ETA controls while an order is `PREPARING` or `OUT_FOR_DELIVERY`.
- Authenticated SSE endpoints with automatic reconnect in the browser.
- Immediate in-process broadcasts plus a 15-second database reconciliation fallback. The fallback also picks up payment updates and makes the stream recover cleanly after a backend restart.
- Existing orders receive one truthful legacy tracking event during migration. The migration does not fabricate a historical sequence that was never recorded.

## API endpoints

Customer:

- `GET /api/orders` — order history including tracking events.
- `GET /api/orders/live` — authenticated SSE stream.

Admin:

- `GET /api/admin/orders` — queue including tracking events.
- `GET /api/admin/orders/live` — authenticated SSE stream.
- `PATCH /api/admin/orders/:id/status` — status transition; accepts optional `estimateMinutes` and `note`.
- `PATCH /api/admin/orders/:id/eta` — revise ETA while preparing or out for delivery.

## Default estimates

If the admin does not provide an estimate:

- Entering `PREPARING`: 25 minutes to ready.
- Entering `OUT_FOR_DELIVERY`: 30 minutes to arrival.

The admin can immediately replace these estimates from the Orders screen.

## Deployment

No new environment variables are required.

Render Start Command remains:

```bash
npm run db:setup -w server && npm start -w server
```

`db:setup` applies the PostgreSQL migration before the API starts.

## Scaling note

Immediate updates use an in-process event bus, which is ideal for the current single Render backend instance. The 15-second DB reconciliation keeps clients accurate after reconnects and across restarts. If the backend is later scaled to multiple always-on instances, Step 19 can replace the in-process broadcast layer with Redis/Postgres pub-sub while keeping the same browser SSE contract.
