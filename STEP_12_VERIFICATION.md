# Step 12 verification — Saved addresses and reorder

## A. Migration and regression

1. Run `npm ci`.
2. Run `npm run db:generate -w server`.
3. Against a development/test PostgreSQL URL, run `npm test`.
4. Run `npm run build`.
5. Apply the production migration with `npm run db:migrate -w server` through Render pre-deploy.
6. Confirm all older Step 01–11 migrations remain applied and existing production data is intact.

## B. Saved addresses

1. Sign in as a customer and open **Saved addresses** from the account menu.
2. Add the first address and confirm it becomes **Default** automatically.
3. Add a second address, choose **Use as my default**, and confirm only that address is marked Default.
4. Edit a non-default address and confirm only the signed-in account sees the change.
5. Set the other address as default.
6. Delete the current default and confirm another remaining address becomes default.
7. Verify the account cannot create more than 10 saved addresses.
8. Sign in as a different account and verify it cannot read/update/delete the first account's address IDs.
9. Open checkout while signed in. Confirm the default address is selected and fills recipient/phone/street/city/state/postal/country fields.
10. Edit one of those filled fields and confirm checkout switches to a custom address rather than pretending the saved record was edited.
11. Pick another saved address and confirm the form changes immediately.
12. Use a saved postal code that does not match the selected delivery zone. Confirm the normal server delivery-zone validation still blocks checkout.
13. Log out while on checkout and confirm account-saved address values are cleared before continuing as a guest.

## C. One-click reorder

1. Place a registered order containing at least one configured product and a special instruction.
2. Open **My orders** and click **Reorder**.
3. Confirm the cart is rebuilt with the same product IDs, quantities, selected option IDs and kitchen instructions.
4. Confirm the cart displays **current** product/option prices, not a historical copied total.
5. Continue to checkout and confirm current coupon, loyalty, delivery fee, schedule, payment and stock validation runs normally.
6. Change a historical product's current price and reorder again. Confirm the new price is used.
7. Make one old product unavailable and reorder a multi-line order. Confirm available lines load and the unavailable line is reported as skipped.
8. Archive/remove a required historical customization option. Confirm the affected old line is skipped rather than silently substituted.
9. Reduce product or tracked option stock below the historical quantity. Confirm that line is skipped/rejected by current availability validation.
10. Reorder when a cart already contains items. Confirm the UI asks before replacing the current cart.
11. Cancel the confirmation and verify the current cart remains unchanged.
12. Attempt to reorder another customer's order ID and confirm the API returns not found.
13. Link a former guest order to its matching account, then confirm it can use Reorder through normal ownership rules.
14. Confirm a still-anonymous guest cannot use the authenticated reorder endpoint merely by knowing an order ID.

## D. Existing-feature regression

Verify Delivery/Pickup, ASAP/scheduled slots, restaurant opening hours, delivery zones, dynamic pricing, COD, manual payment, SSLCOMMERZ, guest secure tracking, post-order account linking, reviews, Tomato Points, wishlist, PWA, notifications, product customizations and Step 11 inventory concurrency still behave normally.
