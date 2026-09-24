# Step 07 verification

## Automated

```bash
npm install
npm run db:setup
npm run db:status -w server
npm test
npm run build
```

## Email

1. Configure SMTP variables on Render.
2. Redeploy Render.
3. Customer → Notifications.
4. Confirm **Email → Available**.
5. Click **Send test email**.
6. Place an order and move it through Confirmed → Preparing → Delivered from Admin.
7. Confirm emails arrive and Admin → Notifications records `SENT`.

## Browser push

1. Generate VAPID keys: `npm run push:keys -w server`.
2. Add the three VAPID variables to Render and redeploy.
3. Open the production storefront over HTTPS.
4. Customer → Notifications → **Enable browser notifications**.
5. Accept the browser prompt.
6. Click **Send test push**.
7. Put the tab in the background and change the order status from Admin.
8. Confirm a system notification appears.
9. Click it and confirm it opens/focuses `/orders`.

## Queue/retry

1. Admin → Notifications.
2. Verify new order events appear in the table.
3. Temporarily break SMTP credentials and create a status update.
4. Observe retry/failed status after attempts.
5. Restore SMTP configuration, redeploy, click **Retry**, then **Process queue**.
6. Confirm the delivery becomes `SENT`.

## Logout privacy

1. Enable browser push for Account A.
2. Sign out.
3. Verify the browser subscription is removed from Account A.
4. Sign in as Account B; browser push must not silently remain linked to Account A.
