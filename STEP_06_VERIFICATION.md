# Step 06 verification

## Local commands

```bash
npm install
npm run db:setup
npm run db:status -w server
npm test
npm run build
npm run dev
```

## Customer test

1. Sign in and place a COD pickup or delivery order.
2. Open **My orders** in one browser window.
3. Confirm the page shows **Live updates** and an `Order placed` timeline entry.
4. Leave the page open.

## Admin test

1. Open **Admin → Orders** in another window.
2. Expand the order.
3. Move `PENDING → CONFIRMED → PREPARING`.
4. The customer page should update without manual refresh.
5. While preparing, choose a 10/20/30/45-minute ready estimate.
6. Confirm the customer countdown changes live and a timeline ETA event is added.
7. For pickup, continue to `READY_FOR_PICKUP → DELIVERED`.
8. For delivery, continue to `OUT_FOR_DELIVERY`, revise the delivery ETA if desired, then `DELIVERED`.

## Reconnect test

1. Keep **My orders** open.
2. Restart the local backend or redeploy Render.
3. The badge should change to **Reconnecting…** and then return to **Live updates** automatically.
4. The timeline must remain intact because it is stored in PostgreSQL.

## Database checks

The migration adds:

- `OrderTrackingEvent`
- status timestamp columns on `Order`
- estimate timestamp columns on `Order`

Existing orders/users/payments/reviews/points/wishlist records are not reset.
