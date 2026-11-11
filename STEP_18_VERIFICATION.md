# Step 18 verification checklist

## Local/static

```bash
npm ci
npm run db:generate -w server
node --test server/test/auth-hardening.test.js
npm test
npm run build
```

The focused test verifies the RFC 6238 TOTP implementation, recovery-code hashing/uniqueness, and privacy masking.

## Production prerequisites

- Add a stable `AUTH_ENCRYPTION_KEY` to the Render backend before deploying the Step 18 code.
- Confirm SMTP works if password registration/reset is offered.
- Do not add `AUTH_ENCRYPTION_KEY`, SMTP credentials, JWT secrets, or refresh tokens to Vercel.
- Deploy Render/migration before Vercel.

## Email verification

1. Register a new password account.
2. Confirm no authenticated customer session is created yet.
3. Login before verification must return `EMAIL_NOT_VERIFIED` after the correct password is supplied.
4. Use the emailed one-time link; it must verify once and fail when reused.
5. Sign in after verification and confirm orders/wishlist/points work normally.
6. Use Resend verification and confirm the older outstanding verification link is invalidated.

## Password recovery

1. Request reset for a valid email and for a random email. Both public responses must use the same generic wording.
2. Open the valid reset email and set a 12+ character password.
3. Reusing the reset token must fail.
4. Every previously signed-in browser must lose access because sessions were revoked.
5. The new password must work and the old one must fail.

## Administrator MFA

1. Sign in as the existing administrator after deploying Step 18.
2. Password success must lead to TOTP setup rather than the admin dashboard.
3. Add the displayed manual key to an authenticator app and enter a valid six-digit code.
4. Save the eight displayed recovery codes.
5. Sign out and sign in again: password alone must not create an admin session.
6. A valid TOTP code must complete sign-in.
7. Sign out again and verify one recovery code works exactly once.
8. Try that same recovery code again; it must fail.
9. Try reusing a TOTP code/time-step; it must be rejected.
10. Admin API calls from a non-MFA session must return `ADMIN_2FA_REQUIRED`.

## Sessions

1. Sign in from two browsers/devices.
2. Open Account/Admin → Security & sessions and confirm both appear with masked IP details.
3. Revoke the other session and verify its next authenticated request fails immediately even if its access JWT has not yet expired.
4. Use Sign out other devices and verify the current session remains active.
5. Change password and confirm all sessions, including the current one, are revoked.

## Regression

Recheck registered and guest checkout, Google sign-in, Step 09 guest linking, manual/COD/SSLCOMMERZ payment, Step 10 customizations, Step 11 inventory, Step 12 reorder, Step 15 KDS, Step 16 invoice/receipt, Step 17 cancellation/refund, reviews, loyalty, notifications, PWA, and all Admin routes.
