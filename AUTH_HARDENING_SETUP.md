# Step 18 — Authentication and account-security hardening

Step 18 upgrades the existing JWT/refresh-session authentication model without replacing customer accounts or changing order ownership.

## Production behavior

- Existing accounts are grandfathered as email-verified by the migration because they were created before verification existed.
- Password registrations require a one-time 24-hour email verification link when `EMAIL_VERIFICATION_REQUIRED=true`. When it is `false`, customer registration/login is allowed without marking the email as verified; administrator email verification remains enforced.
- Google sign-in continues to require Google's `email_verified` claim and therefore creates/links a verified account.
- Password-reset links are random, stored only as SHA-256 hashes, expire after 30 minutes, work once, and revoke all active sessions after use.
- New passwords must be 12–72 characters. Existing shorter passwords are not silently invalidated; customers can still sign in and later upgrade them.
- Access JWTs now contain a server-side session ID. Every authenticated request verifies that session is active, so revoking a device invalidates its access immediately instead of waiting for the access JWT to expire.
- Refresh tokens remain HttpOnly cookies and continue rotating. A successful sign-in creates one persistent device session for at least 7 days (`REFRESH_TOKEN_DAYS`, minimum 7). Refreshing an access token does not extend that absolute session expiry, so the user signs in again when the session reaches its expiry. Browser tabs coordinate refresh-token rotation with a same-origin cross-tab lock where the browser supports it, reducing stale-refresh races when several Tomato tabs are open. Refresh/logout requests reject browser requests from origins outside `CLIENT_ORIGIN`.
- Account → Security & sessions lists active devices with masked IP addresses and supports individual revocation, sign-out of all other devices, and password change.

## Mandatory administrator TOTP

Administrator password/Google authentication is now only the first factor.

On the first administrator sign-in after Step 18:

1. Tomato creates a short-lived setup challenge.
2. The UI displays a random TOTP secret for manual entry into Google Authenticator, Microsoft Authenticator, 1Password, Authy, or another RFC 6238-compatible authenticator.
3. The administrator proves setup with the current six-digit code.
4. Tomato stores the TOTP secret encrypted with AES-256-GCM and displays eight one-time recovery codes.
5. Only SHA-256 hashes of recovery codes are stored.
6. An MFA-verified server session is then created.

Later administrator logins require a current TOTP code or one unused recovery code. A TOTP time-step cannot be reused. Once the administrator completes MFA, that MFA-verified device session remains valid until its session expiry (7 days by default), so normal page reloads and access-token refreshes do not ask for another authenticator code. Admin APIs additionally reject sessions that were not MFA verified. Customer accounts do not currently use TOTP; they use verified email/password or Google sign-in.

Save the initial recovery codes offline. They are shown only once. Fresh recovery codes can be generated from Admin → Security with the current password and a fresh authenticator code; generating new codes invalidates all previous recovery codes.

## New backend environment variable

Generate a separate long random key:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Set the result on Render as:

```env
AUTH_ENCRYPTION_KEY=<generated value>
```

`AUTH_ENCRYPTION_KEY` is mandatory when `NODE_ENV=production`. Keep it server-side only and keep it stable between normal deployments. It encrypts administrator TOTP secrets at rest. Do not put it in Vercel or any `VITE_*` variable.

Customer email verification feature flag:

```env
EMAIL_VERIFICATION_REQUIRED=true
```

Use `false` to pause verification for customer password registrations/logins without changing `emailVerifiedAt` values in the database. Switching it back to `true` will require any still-unverified password account to verify on its next sign-in. Administrator accounts are not exempted by this flag.

Existing variables remain required as before. Set `EMAIL_VERIFICATION_REQUIRED=false` temporarily if customer email verification must be paused until a production sending domain is ready. Password reset still depends on working Step 07 SMTP settings (`SMTP_HOST`, `EMAIL_FROM`, etc.). Google-only sign-in does not require SMTP.

## Migration

Apply only with Prisma Migrate:

```bash
npm run db:generate -w server
npm run db:migrate -w server
```

Migration: `20260928020000_auth_hardening`.

It adds one-time auth tokens, MFA/recovery metadata, password-change metadata, and session last-seen/MFA state. It also sets `emailVerifiedAt` for existing users who predate Step 18. It does not reset orders, payments, inventory, loyalty, reviews, saved addresses, guest tokens, or historical sessions.

Do not use `prisma migrate reset` or destructive `db push` on production.
