# Final QA, Accessibility, Security & Deployment Audit

This audit closes the numbered roadmap after Step 20. It is a release-candidate audit: source-level checks and hardening are implemented here, while the production cross-device matrix at the end must be run against the deployed Render/Vercel build before declaring the live service fully verified.

## Release blockers found and fixed

### 1. High-severity dependency

The Step 20 lockfile resolved `nodemailer` to `7.0.13`. The final release upgrades Nodemailer to `10.0.10`, the supported major line for Node 20+, and pins the project runtime requirement to Node `>=20.19.0`. Transactional email also sets `disableFileAccess` and `disableUrlAccess` as defense-in-depth because Tomato does not need filesystem/URL-backed message content.

Do not run `npm audit fix --force` blindly. Run the production audit after `npm ci` and review any remaining advisory by package/path.

### 2. Consolidated test coverage

`server/scripts/test.js` previously listed tests manually and did not include the focused Step 16, 17, 19, or 20 suites. It now discovers every `server/test/*.test.js` file automatically and runs them serially inside the isolated PostgreSQL test schema. New focused test files therefore become part of `npm test` without another runner edit.

### 3. SEO production correctness

A local Step 20 build can legitimately generate zero product SEO shells when the API is not running. A Vercel production build must not silently do that. The SEO generator now retries API fetches and fails a Vercel production build if the product feed cannot be reached, instead of deploying an incomplete sitemap/product-shell set.

### 4. Production configuration fail-fast

When `NODE_ENV=production`, the API now refuses to start with:

- the bundled local development database URL;
- bundled development JWT secrets;
- identical access/refresh JWT secrets;
- non-HTTPS or invalid `CLIENT_ORIGIN` values;
- a non-HTTPS `PUBLIC_API_URL`;
- the already-required missing `AUTH_ENCRYPTION_KEY`.

Render's native Node runtime sets `NODE_ENV=production` at runtime, so these checks act as deployment safeguards rather than local-development restrictions.

### 5. Accessibility hardening

The final patch adds:

- keyboard-visible **Skip to main content** navigation on storefront and admin routes;
- a common `#main-content` target;
- focus containment and focus restoration for the login/register/MFA modal;
- associated `label`/`input` IDs on Security password/recovery forms;
- explicit non-submit button types for navigation/modal actions;
- existing `:focus-visible` and `prefers-reduced-motion` behavior is retained.

This improves keyboard and screen-reader operation but is not a claim of formal WCAG certification. The manual matrix below still needs real-browser and assistive-technology verification.

### 6. Browser response hardening

Both Vercel config locations now emit these baseline response headers:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `X-Frame-Options: DENY`

Step 20's private-route `X-Robots-Tag` rules remain in place. A restrictive CSP was intentionally not added in this release because it needs deployment-specific testing with Google Sign-In, Cloudinary images, and other external integrations rather than a guess that could break production.

## Automated release commands

Start a local PostgreSQL test database:

```bash
docker compose up -d db
export TEST_DATABASE_URL="postgresql://tomato:tomato@localhost:5432/tomato?schema=public"
```

Then run the complete release gate:

```bash
npm ci
npm run qa:release
```

`qa:release` executes Prisma generation, the full isolated PostgreSQL test suite, the Vite/PWA/SEO build, and the production dependency audit.

For a local build, the SEO generator is allowed to warn if the production API is unreachable. For Vercel production (`VERCEL_ENV=production`), an unavailable product feed is now a build failure.

## Manual production matrix

Run these after Render and Vercel are deployed.

### Customer devices

Verify at minimum:

- Chrome desktop at 1366×768 and 1920×1080;
- Edge desktop;
- Firefox desktop;
- Safari on iPhone if available;
- Chrome on Android if available;
- narrow viewport around 320–375 px;
- tablet viewport around 768–1024 px.

On each representative device, check menu/search/filter, product detail, variants/add-ons, cart, guest checkout, signed-in checkout, Delivery/Pickup, ASAP/scheduled slots, manual/COD/online payment paths, order tracking, invoice/receipt, cancellation status, saved addresses/reorder, and PWA install/offline fallback where supported.

### Accessibility

Using keyboard only:

1. Reload the homepage and press `Tab`; the skip link must appear.
2. Activate it; focus must move to the main content region.
3. Open Sign in; focus must enter the modal.
4. Repeated `Tab`/`Shift+Tab` must stay inside the open modal.
5. `Escape` must close the modal and restore focus to the control that opened it.
6. Complete login/MFA/password/security forms without a mouse.
7. Check visible focus on admin navigation and high-use checkout/payment controls.
8. Enable OS/browser reduced motion and confirm unnecessary animation is suppressed.
9. Test browser zoom at 200% and narrow viewport without losing core controls.

### Security/session

Verify:

- password registration requires verification;
- password reset tokens are one-time;
- admin requires TOTP/recovery code;
- recovery codes cannot be reused;
- session revocation invalidates the revoked device;
- guest order number alone cannot expose tracking/documents/cancellation;
- private admin/account/order routes remain authenticated/noindex;
- Render startup fails if a production JWT secret is removed or replaced by the bundled development default (test only in a safe preview/staging environment).

### Payments/accounting

Verify:

- unpaid orders cannot produce receipts;
- paid cancellation requires refund reconciliation before final cancellation;
- gateway refund pending blocks final cancellation;
- product/option inventory restores exactly once on eligible cancellation;
- loyalty redemption/award behavior remains consistent;
- analytics recognize delivered revenue only.

### Operations/SEO

Verify:

- `/api/health` and `/api/health/ready` return healthy status;
- Admin → Monitoring loads and incident correlation IDs work;
- `/robots.txt` and `/sitemap.xml` are public;
- sitemap contains available `/menu/<slug>` pages;
- View Source on a product route contains canonical, OG/Twitter tags and JSON-LD;
- private routes return `X-Robots-Tag: noindex, nofollow, noarchive`;
- common responses include the final baseline security headers.

## Production release decision

Treat the build as ready for public production only when all of these are true:

- `npm run qa:release` exits 0 with the local test PostgreSQL URL;
- `npm audit --omit=dev --audit-level=high` exits 0 or any exception is explicitly reviewed/documented;
- Render migration/pre-deploy succeeds;
- `/api/health/ready` returns HTTP 200;
- Vercel production build logs show a nonzero product SEO-shell count when active products exist;
- representative customer/admin manual checks above pass;
- no new 5xx incident is visible in Admin → Monitoring during smoke testing.
