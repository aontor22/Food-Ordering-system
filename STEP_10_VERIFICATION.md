# Step 10 verification checklist

Use this after local installation and again after Render/Vercel deployment.

1. **Migration/data safety** — run Prisma generate/migrate; confirm old Orders and OrderItems remain present and historical rows have `baseUnitPriceCents = unitPriceCents`.
2. **Admin variant** — edit one product and create a required `Size` VARIANT with Small and Large (+price). Save/reopen and confirm both IDs/settings persist.
3. **Admin add-ons** — add optional Extras with at least two choices and a maximum selection rule. Disable one choice; it must disappear from the customer customizer.
4. **Impossible config protection** — try to require more active choices than remain enabled or make an inactive choice the default. Admin/API must reject it.
5. **Customer customizer** — Add to cart should open the selector for a configurable product. Choose a size/add-ons, enter a kitchen note, and confirm the displayed configured price updates.
6. **Distinct cart lines** — add the same product with two different sizes/add-ons. They must remain separate cart rows. Adding the exact same configuration should merge its quantity.
7. **Cart migration** — with an old object-format `cart` value in localStorage, reload and confirm it becomes line-based without disappearing. If the product now has a required option, checkout should ask/reject until the line is edited rather than guessing.
8. **Quantity/stock** — configured lines for one product must not exceed the 20-unit client/server order limit, and the server must use their aggregate quantity for stock checks.
9. **Server price authority** — alter a price in DevTools/request payload or submit an old/removed option ID. The quote/order total must come from PostgreSQL, and invalid/changed options must be rejected.
10. **Checkout compatibility** — test Delivery and Pickup, ASAP and scheduled, coupon/delivery pricing, Registered and Guest checkout.
11. **Payments** — verify COD, manual payment and SSLCOMMERZ/demo use the final configured order total; payment retries must use the stored order total.
12. **Snapshots** — place an order using `Large + Cheese`, then rename/reprice those menu choices. Orders, Guest tracking and Admin Orders must still show the original names and original purchased prices.
13. **Special instructions** — per-item note should appear in Cart, confirmation, My Orders/Guest tracking and Admin Orders; values above 300 characters must be rejected/truncated by the UI and rejected by API validation.
14. **Notifications** — order email item summary should include selected option names; the raw `customizationsJson` field must not be returned by customer/admin order APIs.
15. **Reviews/loyalty** — existing Step 09 rule remains: anonymous guest orders cannot review/earn/redeem until safely linked; customization does not bypass review ownership.
16. **Responsive UI** — test customizer, cart and Admin Product editor around 360px, tablet width and desktop.
17. **Regression** — run `npm test` and `npm run build`; verify restaurant hours, delivery zones, scheduling, live tracking, notifications, PWA, wishlist and authentication still function.
