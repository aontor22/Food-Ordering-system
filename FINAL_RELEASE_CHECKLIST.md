# Final Production Release Checklist

## Before Git push

```bash
cd /workspaces/Food-Ordering-system
npm ci
docker compose up -d db
export TEST_DATABASE_URL="postgresql://tomato:tomato@localhost:5432/tomato?schema=public"
npm run qa:release
git diff --check
```

Expected security dependency after install:

```bash
npm ls nodemailer
# food-ordering-api -> nodemailer@10.0.10 (or a compatible patched 10.x resolved by the lockfile)
```

Do not use `npm audit fix --force` as a release shortcut.

## Git

```bash
git add -A
git diff --cached --check
git commit -m "Complete final QA security and accessibility hardening"
git push origin main
```

## Render

No new environment variable is introduced by the final audit. Keep all existing production values, including `AUTH_ENCRYPTION_KEY`.

Confirm these important values are production-safe:

```text
DATABASE_URL               = Render PostgreSQL URL
JWT_ACCESS_SECRET          = unique random secret, 32+ chars
JWT_REFRESH_SECRET         = different unique random secret, 32+ chars
CLIENT_ORIGIN              = https://food-ordering-system-ten-sable.vercel.app
PUBLIC_API_URL             = https://food-ordering-system-1-t2nu.onrender.com
AUTH_ENCRYPTION_KEY        = existing Step 18 stable key
```

Keep:

```text
Build Command:      npm ci && npm run db:generate -w server
Pre-Deploy Command: npm run db:migrate -w server
Start Command:      npm start -w server
Health Check Path:  /api/health/ready
```

This final audit adds no Prisma migration. The Step 20 migration remains the latest pending schema migration if it has not yet been deployed.

## Vercel

No new environment variable is introduced by the final audit. Keep:

```text
VITE_API_URL=https://food-ordering-system-1-t2nu.onrender.com/api
VITE_SITE_URL=https://food-ordering-system-ten-sable.vercel.app
VITE_CURRENCY=...
VITE_GOOGLE_CLIENT_ID=...
```

Deploy only after Render is healthy. A production SEO build now fails instead of silently publishing zero product shells if the Render product feed is unavailable.

## Post-deploy smoke check

```bash
curl -I https://food-ordering-system-ten-sable.vercel.app/
curl -I https://food-ordering-system-ten-sable.vercel.app/admin
curl https://food-ordering-system-ten-sable.vercel.app/robots.txt
curl https://food-ordering-system-ten-sable.vercel.app/sitemap.xml
curl https://food-ordering-system-1-t2nu.onrender.com/api/health
curl https://food-ordering-system-1-t2nu.onrender.com/api/health/ready
```

Confirm the storefront response includes `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and `X-Frame-Options`. Confirm the admin response also includes `X-Robots-Tag: noindex, nofollow, noarchive`.

Then perform the cross-device/manual matrix in `FINAL_QA_AUDIT.md`.
