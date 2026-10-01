# Step 03 — Store opening hours & closures

This release adds server-enforced store availability. Customers can still browse products when the restaurant is closed, but new order creation is rejected by the API and the checkout button is disabled in the storefront.

## What is included

- Weekly opening hours for Sunday–Saturday
- Closed-day and 24-hour modes
- Overnight windows such as 18:00 → 02:00
- Master **Accept new orders** switch
- Temporary closure with an optional local reopening time and public reason
- Holiday/special full-day closure dates
- Restaurant timezone stored in the database
- Public `/api/store/status` endpoint
- Customer-facing open/closed strip
- Checkout blocking in both UI and API
- Admin audit log entries for schedule and closure changes

## Deploy

From the repository root:

```bash
npm install
npm run db:setup
npm test
npm run build
```

Then commit/push:

```bash
git add .
git commit -m "Add restaurant opening hours and closure controls"
git push
```

Render should run the existing start command:

```bash
npm run db:setup -w server && npm start -w server
```

No new environment variables are required. The default migration keeps all seven days open 24 hours so an existing restaurant is not unexpectedly taken offline. Configure the real schedule after deployment at **Admin → Store hours**.

Recommended first configuration for a Bangladesh-based restaurant:

- Timezone: `Asia/Dhaka`
- Set the real opening/closing time for each weekday
- Add known holidays as closure dates
- Keep **Accept new orders** on unless you need an emergency pause

## API behaviour

`GET /api/store/status` is public and returns the current store state and weekly schedule.

`POST /api/orders` checks store availability twice: before order processing and again inside the database transaction. Existing orders are not cancelled when the store closes.
