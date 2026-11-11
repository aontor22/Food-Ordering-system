# Step 08 — PWA setup

Tomato is now an installable Progressive Web App (PWA) on supported Android, desktop and iOS browsers.

## What is included

- Web app manifest with app identity, shortcuts, theme/background colors and maskable icons.
- Production service worker registered from the application shell.
- Build-time precache manifest for the compiled Vite app shell and local UI assets.
- Network-first navigation so online users receive fresh pages.
- Offline fallback page when a navigation cannot be served from the network/cache.
- Stale-while-revalidate caching for same-origin scripts, styles, fonts and images.
- API requests are not cached by the service worker.
- Existing Web Push notification support remains in the same service worker.
- Update-ready prompt when a new service worker release is waiting.
- Online/offline status banner.
- Install CTA on the storefront; iOS gets Add to Home Screen instructions.

## Build

From repository root:

```bash
npm install
npm run db:setup
npm run db:status -w server
npm test
npm run build
```

The frontend build script runs Vite, then `front-end/scripts/inject-pwa-manifest.mjs`. The script scans the final `dist` directory and injects the hashed production files into `dist/sw.js`, so offline app-shell caching stays correct after every deployment.

## Deployment

No new environment variables are required.

Render start command remains:

```bash
npm run db:setup -w server && npm start -w server
```

Vercel serves the PWA over HTTPS, which satisfies the secure-context requirement for service workers and installability.

## iPhone / iPad

Safari does not expose Chromium's `beforeinstallprompt`. Tomato therefore shows manual instructions: Safari → Share → Add to Home Screen.

## Cache safety

The service worker deliberately does **not** cache `/api/*` requests. Orders, payments, authentication, points and other transactional data always require a live backend response.
