# Step 13 — Advanced search and product discovery

## Scope

Step 13 improves catalogue discovery without changing checkout, payment, inventory or historical order data. It adds explicit administrator-managed dietary classification plus search/filter/sort metadata for customers.

Customer discovery now supports:

- multi-term search across product name, description, category, active customization group names and active option names
- Vegetarian, Vegan, Halal and Gluten-free filters
- optional minimum and maximum base-price filters
- optional minimum verified-review rating
- Recommended, Most ordered, Top rated, Price low-to-high and Price high-to-low sorting

The storefront performs instant filtering/sorting against the currently loaded catalogue. `GET /api/products` also accepts the same discovery-style query parameters so the server is ready for future pagination, SEO and larger catalogues.

## Dietary classification policy

`Product` now stores four booleans:

- `isVegetarian`
- `isVegan`
- `isHalal`
- `isGlutenFree`

The migration defaults all existing products to `false`. It intentionally does **not** infer production dietary claims from a product name or category. An administrator must review each recipe/restaurant handling policy and apply the appropriate labels from Admin → Products.

When Vegan is selected in the admin editor, Vegetarian is also selected. This convenience does not replace the restaurant's responsibility for correct ingredient/allergen classification.

These labels are discovery metadata, not medical/allergen guarantees. Cross-contact procedures and formal allergen handling should be managed under the restaurant's operating policy.

## Search behavior

Public product search is case-insensitive. It searches:

- name
- description
- category
- active, non-archived customization group names
- active, non-archived option names

The customer UI tokenizes multi-word searches and requires every term to appear somewhere in that product's searchable text. Dietary labels are also included in the client-side search text.

Server query examples:

```text
GET /api/products?search=chicken%20large
GET /api/products?dietary=vegan,gluten_free
GET /api/products?minPrice=5&maxPrice=20&minRating=4
GET /api/products?sort=POPULARITY
```

Supported sort values:

```text
RECOMMENDED
POPULARITY
RATING
PRICE_ASC
PRICE_DESC
```

Invalid/unsupported dietary names are ignored by the normalization service; invalid sort values are rejected by request validation.

## Rating and popularity integrity

Rating metadata is calculated only from reviews with `status = PUBLISHED`. Existing review security remains unchanged: reviews still require an account-linked delivered purchase.

Popularity is not based on page views, wishlist saves, pending orders, payment attempts or cancelled orders. It is the sum of `OrderItem.quantity` where the related order has `status = DELIVERED`.

No mutable popularity counter is stored on `Product`, so cancellations, test clicks and application retries cannot drift a counter away from order history.

## Stock freshness

The public product response contains Step 11 product and tracked-option availability. For that reason `/api/products` is explicitly returned with:

```http
Cache-Control: no-store
```

This release does not trade inventory freshness for catalogue caching. Checkout remains the final server authority and continues to reserve inventory atomically.

## Migration

Step 13 adds:

`server/prisma/migrations/20260927040000_product_discovery/migration.sql`

It adds the four dietary booleans and supporting indexes. Existing products, prices, stock, customizations, orders, payments, reviews, saved addresses and inventory ledger rows are not rewritten.

Production deployment:

```bash
npm run db:generate -w server
npm run db:migrate -w server
```

Use the existing Render `DATABASE_URL`. Do not reset or force-push the production database.

## Environment variables

Step 13 adds **no new environment variables**.
