# Step 08 verification checklist

1. Run `npm run build` and confirm the build logs include `PWA precache manifest injected with ... files.`
2. Serve the production frontend (`npm run preview -w front-end`) and open it in Chrome/Edge.
3. DevTools → Application → Manifest: verify Tomato name, 192/512 icons and maskable icons.
4. DevTools → Application → Service Workers: verify `/sw.js` is activated and controlling the page.
5. Install the app from the Tomato install CTA or the browser install control.
6. Launch the installed app and confirm it opens in standalone mode.
7. Reload once online, then DevTools → Network → Offline. Navigate/reload and confirm the cached app shell or Tomato offline fallback is shown.
8. While offline, confirm the app clearly states that orders/payments/account changes require connectivity.
9. Re-enable the network and verify the offline banner disappears.
10. Deploy a newer build. With the old app open, refocus/reload and verify the update-ready prompt appears; choose Update now.
11. If browser push is configured, send a test push and confirm push notifications still work after the PWA service-worker changes.
12. On iOS Safari, use Share → Add to Home Screen and verify the installed icon launches Tomato standalone.
