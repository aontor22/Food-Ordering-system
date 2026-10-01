# Step 11 — Inventory & concurrency safeguards

Step 11 makes stock reservation safe under concurrent checkout while adding optional stock tracking for variants/add-ons.

## Inventory model

- `Product.stock` remains the hard product-level ceiling.
- `Product.maxPerOrder` keeps the existing per-product checkout limit configurable up to 20.
- `Product.lowStockThreshold` drives admin/customer low-stock messaging.
- `Product.inventoryVersion` is incremented whenever stock changes.
- A `ProductOption` can opt into stock tracking with `trackStock=true`. Tracked variants/add-ons have their own `stock`, `lowStockThreshold`, and `inventoryVersion`.
- Existing Step 10 options migrate with `trackStock=false`, so deployment does not unexpectedly make existing menu choices unavailable.

## Checkout concurrency

Order creation runs inside a PostgreSQL `SERIALIZABLE` transaction with bounded retry for Prisma `P2034` write conflicts. Product and tracked-option inventory is reserved with conditional `updateMany` statements requiring both sufficient stock and the expected inventory version. If any reservation fails, the whole transaction rolls back, including any earlier product decrement.

A checkout can also include `clientRequestId` (UUID). `Order.checkoutRequestId` stores only a SHA-256 digest of that UUID and is unique, so retrying the same browser submission returns the already-created order rather than creating a duplicate or consuming inventory twice. The raw UUID is not returned in order APIs or audit metadata. It is not an order-access credential; Step 09 guest access still requires the signed guest token.

## Cancellation restoration

Step 10 immutable customization snapshots now include whether a selected option tracked inventory at purchase time. Cancellation restores product stock and exactly those tracked option quantities reserved for the order. Pre-Step-11 historical orders have no `trackStock` snapshot flag, so they restore only product stock—the same inventory that was originally reserved.

## Admin inventory workflow

Use **Admin → Inventory** for live stock changes. Product editing intentionally cannot overwrite current stock for an existing product. The inventory adjustment endpoint requires the current `inventoryVersion`; if another checkout/admin change updates stock first, the stale request is rejected with `INVENTORY_CHANGED` instead of overwriting the newer quantity.

Every reservation, cancellation restoration, initial stock entry, and manual stock adjustment is recorded in `InventoryAdjustment`. Admin adjustments require a reason and may include an internal note.

Product customization edits are now non-destructive. Removed groups/options are soft-archived rather than deleted, which preserves the option identifiers needed by historical order snapshots and cancellation restoration.

## Production migration

Apply the migration with the existing production `DATABASE_URL`:

```bash
npm run db:generate -w server
npm run db:migrate -w server
```

On Render, keep `npm run db:migrate -w server` as the pre-deploy command. Do not use `prisma migrate reset` or a destructive `db push` against production.

## Environment variables

Step 11 adds no environment variables. Continue using the existing PostgreSQL, authentication, payment, notification, Cloudinary and frontend variables.
