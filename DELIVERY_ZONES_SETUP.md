# Step 04 — Delivery zones and area pricing

Step 04 moves delivery pricing from one global fee to administrator-managed delivery zones.

## What is enforced on the server

Each active zone has:

- customer-facing zone name and area description
- optional comma-separated postal-code coverage
- delivery fee
- minimum food subtotal
- optional free-delivery subtotal threshold
- active/disabled state and display order

The selected zone is revalidated when the order is created. If postal codes are configured for the zone, the delivery address postal code must match. The minimum-order and free-delivery rules use the food subtotal before promo-code or Tomato Points discounts.

Historical orders store the zone name/id and the delivery fee used at checkout, so later admin edits do not rewrite old order totals.

## Local commands

From the repository root:

```bash
npm install
npm run db:setup
npm test
npm run build
npm run dev
```

For local PostgreSQL with Docker:

```bash
docker compose up -d db
npm run db:setup
npm run dev
```

## Deployment commands

Commit and push:

```bash
git add .
git commit -m "Add delivery zones and area pricing"
git push
```

Render keeps the existing start command:

```bash
npm run db:setup -w server && npm start -w server
```

No new environment variable is required. `DELIVERY_FEE_CENTS` is now only a fallback for creating the very first/default zone; normal production pricing is controlled from Admin → Delivery zones.

## Admin setup

Open **Admin → Delivery zones**.

A default `Standard delivery` zone is created automatically so an existing deployment keeps working after migration. Configure your real areas, then disable the default zone only after another zone is active.

Example:

- **Mirpur** — fee BDT 60, minimum BDT 300, free from BDT 1000, postal code 1216
- **Uttara** — fee BDT 100, minimum BDT 500, free from BDT 1500, relevant postal codes

Postal-code mappings are optional. If they are present, duplicate postal codes across active zones are rejected by the admin API and an order cannot use a cheaper zone whose postal codes do not cover the submitted address.
