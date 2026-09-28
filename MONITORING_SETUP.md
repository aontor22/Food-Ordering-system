# Step 19 — Production monitoring and operational health

Step 19 adds self-hosted operational observability without requiring a paid monitoring vendor.

## What is monitored

- Every API response receives an `X-Request-ID` correlation ID.
- HTTP 5xx errors persist a redacted `OperationalEvent` and return the same request ID to the client as a support reference.
- Requests slower than `MONITORING_SLOW_REQUEST_MS` are stored as `WARN / SLOW_REQUEST` events.
- Notification-worker failures, Cloudinary auto-migration failures, database-readiness failures, unhandled promise rejections and uncaught process exceptions emit structured JSON logs; recoverable failures are also persisted when PostgreSQL is available.
- Operational-event rows are automatically deleted after `MONITORING_RETENTION_DAYS`.

Sensitive keys such as authorization, cookies, passwords, tokens, secrets, OTP/TOTP, customer email/phone/address and card/account-style fields are redacted before operational metadata is persisted.

## Health endpoints

### `GET /api/health`

A lightweight liveness check. It does not query PostgreSQL and is suitable for a platform health-check path.

Example:

```json
{
  "status": "ok",
  "timestamp": "...",
  "uptimeSeconds": 123
}
```

### `GET /api/health/ready`

A readiness check that executes `SELECT 1` against PostgreSQL. It returns HTTP 200 with `status=ready` only when the database responds; otherwise it returns HTTP 503 with `status=not_ready`.

No database URL, password, stack trace or infrastructure hostname is exposed.

## Admin monitoring

`Admin -> Monitoring` shows:

- PostgreSQL readiness latency
- API uptime and Node runtime
- process memory usage
- SMTP, Web Push, Cloudinary, SSLCOMMERZ and auth-encryption configuration presence
- active-order workload
- notification queue/failed/stale counts
- failed/refund-pending payment attention count
- structured operational event totals by level/source
- recent events with request IDs for Render-log correlation

The response is authenticated as ADMIN and uses `private, no-store`.

## Environment variables

No new variable is mandatory. Optional tuning:

```env
MONITORING_SLOW_REQUEST_MS=2000
MONITORING_RETENTION_DAYS=30
```

Allowed ranges are 250–60000 ms and 7–365 days. If omitted, the defaults above are used.

## Render recommendation

Set Render's health-check path to:

```text
/api/health/ready
```

Use `/api/health` when only process liveness is wanted. Keep the existing build, pre-deploy migration and start commands.

## Operational workflow

When a customer reports a generic server error, ask for the displayed Support ID. Search Render logs for that request ID and inspect `Admin -> Monitoring` for the matching event. Operational events intentionally store only redacted diagnostic context; business/audit history remains in the existing Audit Log, Orders, Payments and Inventory records.
