# Step 04 verification

Run from repository root after replacing the updated files:

```bash
npm install
npm run db:setup
npm test
npm run build
```

Then run locally if needed:

```bash
npm run dev
```

Production deployment:

```bash
git add .
git commit -m "Add delivery zones and area pricing"
git push
```

Render start command remains:

```bash
npm run db:setup -w server && npm start -w server
```

No new environment variables are required.

Post-deploy checks:

1. Admin → Delivery zones opens successfully.
2. Create at least one real zone with fee/minimum/free-delivery rules.
3. If postal codes are configured, enter a wrong postal code at checkout and confirm the server rejects it.
4. Confirm the minimum-order shortfall appears before order placement.
5. Confirm delivery becomes free at the configured subtotal threshold.
6. Place an order and verify Admin → Orders stores the selected zone and exact delivery fee.
7. Keep at least one delivery zone active; use Admin → Store hours to pause all new ordering.
