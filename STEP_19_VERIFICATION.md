# Step 19 verification checklist

## Before deploy

```bash
npm ci
npm run db:generate -w server
node --test server/test/observability.test.js
npm test
npm run build
```

## Migration

Apply the additive migration:

```text
server/prisma/migrations/20260928030000_monitoring_observability/migration.sql
```

It creates only `OperationalEvent` plus indexes. It does not rewrite existing business rows.

Production command:

```bash
npm run db:migrate -w server
```

## Health

1. `GET /api/health` returns HTTP 200, `status=ok`, timestamp and uptime.
2. `GET /api/health/ready` returns HTTP 200 and `checks.database.status=ok` while PostgreSQL is reachable.
3. A health response must not expose `DATABASE_URL`, credentials or stack traces.
4. Confirm responses carry `X-Request-ID`.

## Request/error tracking

1. Trigger a controlled server-side 5xx in a non-production/local environment.
2. Confirm the JSON error includes `requestId` / frontend shows a Support ID.
3. Confirm Render/terminal logs contain the same correlation ID.
4. Confirm `Admin -> Monitoring` records the event without password/token/email/phone/address values.
5. With `MONITORING_SLOW_REQUEST_MS` temporarily lowered locally, exercise a slow endpoint and confirm a `SLOW_REQUEST` warning appears.

## Monitoring workspace

1. Sign in as an ADMIN with Step 18 2FA.
2. Open `/admin/monitoring`.
3. Confirm PostgreSQL latency, uptime, memory and integration configuration cards render.
4. Confirm notification queue counts agree with `Admin -> Notifications`.
5. Confirm recent error/slow-request events show level, source, code and request ID.
6. Turn Auto refresh off/on and confirm manual Refresh still works.
7. Verify the page works on desktop and mobile widths.

## Retention

`MONITORING_RETENTION_DAYS` defaults to 30 and the server periodically removes older operational-event rows. Audit logs and business records are unaffected.

## Regression

Recheck Step 18 login/email verification/password reset/admin 2FA and session revocation, then guest checkout, payments, inventory, KDS, cancellations/refunds, invoices, notifications and analytics.
