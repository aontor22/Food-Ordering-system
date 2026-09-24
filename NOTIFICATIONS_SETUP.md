# Step 07 — Email and browser push notifications

This release adds account notification preferences, transactional order email, Web Push, an outbox/retry queue, a browser service worker, and an Admin → Notifications delivery monitor.

## Events

Customers can independently opt in/out of:

- order received
- order confirmed
- kitchen/preparing
- ready for pickup / out for delivery
- ETA changes
- delivered/completed
- cancelled

Email is enabled by default at the account preference level. Browser push is opt-in and requires an explicit browser permission grant on each device.

## 1. Apply the database migration

```bash
npm install
npm run db:setup
npm run db:status -w server
npm test
npm run build
```

New PostgreSQL tables:

- `NotificationPreference`
- `PushSubscription`
- `NotificationDelivery`

`NotificationDelivery` is an outbox. Order/API operations write the notification job first; a background worker sends pending jobs and retries transient failures with backoff. Notification provider failures do not roll back a valid order status change.

## 2. Email via SMTP

Use any SMTP provider that permits transactional email. Configure **Render backend** variables only:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
EMAIL_FROM=orders@yourdomain.com
EMAIL_FROM_NAME=Tomato Restaurant
```

For providers using implicit TLS on port 465, set:

```env
SMTP_PORT=465
SMTP_SECURE=true
```

Do not add SMTP credentials to Vercel or any `VITE_*` variable.

## 3. Browser Web Push

After `npm install`, generate VAPID keys locally/Codespaces:

```bash
npm run push:keys -w server
```

Copy the generated values to the **Render backend** environment:

```env
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@yourdomain.com
```

The public VAPID key is returned to authenticated clients through the notification settings endpoint. The private key remains server-side.

The storefront service worker is `front-end/public/sw.js`. Customers enable push from **Account → Notifications → Enable browser notifications**. Push permission is requested only after that explicit action.

> iPhone/iPad Web Push requires the site to be installed to the Home Screen and permission granted from the installed web app.

## 4. Customer flow

1. Sign in.
2. Open **Account → Notifications**.
3. Toggle email on/off.
4. Enable browser notifications for the current device.
5. Choose order events.
6. Use **Send test email** / **Send test push** to verify configuration.

Signing out removes the current browser push subscription from the account and unsubscribes that browser endpoint.

## 5. Admin operations

Open **Admin → Notifications** to view:

- SMTP readiness
- Web Push readiness
- registered push-device count
- sent / queued / failed / skipped counts
- recent notification deliveries
- provider errors
- manual retry button
- **Process queue** action

The background worker also checks the queue automatically every 10 seconds while the Render service is running.

## 6. Production notes

- Use a dedicated transactional email provider or SMTP account; avoid committing credentials.
- Add SPF/DKIM/DMARC for the sending domain through your email provider/DNS host.
- Keep `VAPID_PRIVATE_KEY` server-side.
- Browser Push requires HTTPS in production. `localhost` is allowed for development.
- A skipped notification means the requested provider/device was not configured at send time. Admin can retry it after configuration is fixed.
- Failed deliveries retry automatically up to four attempts before requiring admin attention.
