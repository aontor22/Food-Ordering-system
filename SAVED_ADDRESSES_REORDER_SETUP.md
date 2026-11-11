# Step 12 — Saved addresses and one-click reorder

## Scope

Step 12 adds two account conveniences without weakening the server-authoritative checkout built in earlier releases:

1. **Saved delivery addresses** for signed-in customers.
2. **One-click reorder** from an owned historical order into a new cart.

Guest checkout remains available exactly as before. A guest address is not silently persisted as an account address. If a guest order is later safely linked to an account through Step 09, it becomes eligible for the normal authenticated reorder endpoint because the order is then owned by that user.

## Saved-address data model

`SavedAddress` belongs to one `User` and stores:

- label (for example Home or Work)
- recipient first and last name
- phone
- street
- city
- state/division
- postal code
- country
- default flag
- created/updated timestamps

The API caps each account at **10 saved addresses**. The first saved address becomes the default automatically. Setting another default or deleting the current default is handled inside a PostgreSQL `SERIALIZABLE` transaction with bounded retry so the account remains in a consistent state under concurrent requests.

Saved addresses do **not** store a trusted delivery fee or delivery-zone decision. At checkout, selecting a saved address only fills customer fields. The current active delivery zones, postal-code coverage, minimum order, free-delivery threshold, opening hours, fulfilment availability and pricing are resolved again by the existing server logic.

## Address API

All routes require authentication and only operate on `req.auth.sub`:

- `GET /api/addresses`
- `POST /api/addresses`
- `PATCH /api/addresses/:id`
- `PUT /api/addresses/:id/default`
- `DELETE /api/addresses/:id`

A different account receives a not-found response for another user's address rather than an ownership hint.

Authenticated address responses are marked `Cache-Control: private, no-store` (with `Pragma: no-cache`) so recipient and street details are not retained by shared HTTP caches.

## Reorder safety model

`POST /api/orders/:id/reorder` requires authentication and first loads the order by both `id` and the authenticated `userId`.

The reorder endpoint does **not** create an order. It prepares validated cart lines. For every old `OrderItem`, it reconstructs:

- product ID
- quantity
- selected customization group/option IDs from the immutable Step 10 snapshot
- special kitchen instructions

Those reconstructed lines are checked against the **current** product catalog using the same customization/availability validator used by normal checkout. This means current rules win:

- archived/unavailable products are rejected
- removed/archived/renamed-required option structures are revalidated by stable IDs
- required selections are enforced
- current `maxPerOrder` is enforced
- current product stock is enforced
- current tracked variant/add-on stock is enforced

The old order's prices are never copied into checkout. Once the validated cart reaches the cart/checkout pages, the current product data is refreshed and the normal quote/order endpoints recalculate current prices, coupon eligibility, loyalty redemption, delivery fees and total.

## Full vs partial reorder

The response status is one of:

- `FULL` — every historical line is still valid
- `PARTIAL` — some lines are valid and some were skipped
- `UNAVAILABLE` — none of the lines can currently be ordered
- `EMPTY` — the source order has no items

For a partial reorder, skipped items include only the historical product name/quantity plus a current validation code/message. No historical delivery address or payment secret is returned by the reorder endpoint.

The storefront replaces the current cart only after the customer confirms when a cart already exists. An unavailable reorder does not erase the existing cart.

## Migration

Step 12 adds:

`server/prisma/migrations/20260927030000_saved_addresses_reorder/migration.sql`

The migration only creates `SavedAddress`, its account index and foreign key. It does not modify or rewrite existing orders, products, payments, inventory ledger rows, guest tokens, reviews or loyalty transactions.

Apply in production with:

```bash
npm run db:generate -w server
npm run db:migrate -w server
```

Use Render's existing `DATABASE_URL`. Do not reset or force-push the production database.

## Environment variables

Step 12 introduces **no new environment variables**.
