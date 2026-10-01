# Kitchen Display System (Step 15)

Step 15 adds a dedicated live kitchen production board at **Admin → Kitchen display**. It reuses the existing order lifecycle, tracking events, payment checks, audit log, notifications and SSE infrastructure instead of storing a second independent kitchen status.

## Lifecycle

The shared order lifecycle is now:

- `PENDING` — order placed / payment pending where applicable
- `CONFIRMED` — KDS **NEW** lane
- `PREPARING` — KDS **PREPARING** lane
- `READY` — KDS **READY** lane
- delivery: `OUT_FOR_DELIVERY` → `DELIVERED`
- pickup: `READY` → `DELIVERED`
- `READY_FOR_PICKUP` remains supported for historical pre-Step-15 pickup orders
- `CANCELLED` remains terminal

`READY` is a normal customer-visible tracking event. Pickup customers see that the order is ready to collect; delivery customers see that the food is ready and waiting for dispatch.

## Timers

No new timer table is required. The KDS derives timers from existing persisted timestamps:

- NEW: `confirmedAt`
- PREPARING: `preparingAt` and `estimatedReadyAt`
- READY: `readyAt`

ASAP NEW tickets become visually attention-worthy after waiting; scheduled NEW tickets show their scheduled time instead of being marked late before cooking begins. PREPARING tickets compare the current time with `estimatedReadyAt`, while READY tickets show handoff wait time.

## Live updates

Admin-only endpoints:

- `GET /api/admin/kitchen`
- `GET /api/admin/kitchen/live` (SSE)

Only `CONFIRMED`, `PREPARING`, and `READY` orders are returned. The KDS uses the same `PATCH /api/admin/orders/:id/status` transition endpoint as the normal Orders workspace, so payment restrictions, COD settlement, loyalty awards, inventory restoration on cancellation, tracking events, notifications and audit logging continue to run in one place.

## KDS actions

- NEW → **Start preparing** with a selected ready-time target
- PREPARING → **Mark ready**
- READY pickup → **Complete pickup** (`DELIVERED`)
- READY delivery → **Dispatch order** (`OUT_FOR_DELIVERY`) with a delivery ETA

Kitchen notes, product variants, add-ons and per-item special instructions from Step 10 remain visible on each ticket.

## Backwards compatibility

No Prisma schema change is needed. Existing `readyAt`, `confirmedAt`, `preparingAt`, `estimatedReadyAt`, `outForDeliveryAt`, and tracking-event fields already support the workflow. Historical `READY_FOR_PICKUP` orders can still be viewed and completed.

Step 15 adds no environment variables and does not modify product/inventory/payment records during deployment.
