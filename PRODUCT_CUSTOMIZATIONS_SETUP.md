# Step 10 — Product variants, sizes, add-ons and special instructions

## What changed

Step 10 adds configurable menu choices without weakening the existing checkout rules. A product can have up to 12 option groups and each group can contain up to 30 choices.

- **VARIANT** — single-select group for sizes or mutually exclusive variants. `maxSelections` is always 1. It may be required (`minSelections = 1`) or optional (`minSelections = 0`).
- **ADDON** — multi-select group for extras/toppings with an admin-defined minimum and maximum.
- Every choice can add a non-negative amount to the product base price, have a display order, be active/inactive, and optionally be a default choice.
- Customers can attach a trimmed per-line kitchen note up to 300 characters. Notes are requests, not a guarantee for allergy handling.

## Pricing and security policy

The browser price is display-only. `/api/orders/quote` and order creation reload each Product and its active option groups from PostgreSQL and validate the submitted group/option IDs. The server rejects missing required choices, too many choices, duplicate groups/options, unavailable/removed choices, unavailable products, insufficient product stock, and invalid quantities. Coupons, delivery minimums/fees, loyalty, opening hours, scheduled capacity, and payment totals continue to use the server-calculated subtotal.

An order line stores:

- `baseUnitPriceCents` — product base price at purchase time
- `unitPriceCents` — base price plus selected option adjustments at purchase time
- `lineTotalCents` — configured unit price multiplied by quantity
- `customizationsJson` — immutable group/choice names, IDs, and price adjustments
- `specialInstructions` — the customer's per-line kitchen note

API responses parse the snapshot into `customizations` and do not expose the raw JSON field. Renaming, repricing, disabling, or deleting a current option therefore does not rewrite historical order data.

## Stock policy

Step 10 intentionally keeps inventory at the Product level. All configured lines for the same product are aggregated for the existing stock validation/decrement/restoration logic, with a maximum of 20 units of one product in an order. Per-variant/per-addon inventory is reserved for Step 11.

## Existing carts and orders

Existing browser carts stored in the previous `{ productId: quantity }` format are migrated client-side into cart-line objects. If an administrator later makes a new choice required, a migrated unconfigured line must be edited before checkout; the server will not guess a required choice.

The migration adds `baseUnitPriceCents` to historical `OrderItem` rows, backfills it from `unitPriceCents`, then makes it required. No existing Product or Order is deleted or reset.

## Admin workflow

Open **Admin → Products**, create/edit a product, then use **Sizes, variants & add-ons**. Add groups and choices, set minimum/maximum selection rules, price adjustments, defaults, active state and order. Existing group/option IDs are retained during edits so current carts can keep referring to unchanged choices. Removed choices are rejected at checkout instead of silently substituting another choice.

## Environment variables

Step 10 adds **no new environment variables**. Keep the existing backend/frontend values unchanged.

## Migration

Production uses the normal safe Prisma deployment command:

```bash
npm run db:generate -w server
npm run db:migrate -w server
```

Migration: `server/prisma/migrations/20260927010000_product_customizations/migration.sql`. Never use `prisma migrate reset` or a forced `db push` against the production database.
