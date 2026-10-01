# Step 13 verification — Advanced search, dietary filters and sorting

## A. Pre-deploy checks

1. Run `npm ci`.
2. Run `npm run db:generate -w server`.
3. Against a development/test PostgreSQL URL, run `npm test`.
4. Run `npm run build`.
5. Confirm `node --test server/test/product-discovery.test.js` passes.
6. Apply `20260927040000_product_discovery` in production with the normal Render pre-deploy `npm run db:migrate -w server`.

## B. Admin dietary metadata

1. Open Admin → Products and edit an existing product.
2. Confirm Vegetarian, Vegan, Halal and Gluten-free controls are present.
3. Mark Vegan and confirm Vegetarian is also selected.
4. Save and reopen the product; confirm the classifications persist.
5. Search the admin product list for `vegan`, `halal` or `gluten free` and confirm matching classified products appear.
6. Verify editing classifications does not change product stock; live stock remains controlled through Admin → Inventory.
7. Verify archive/restore and option editing still work.

## C. Customer search and filters

1. Open the storefront and scroll to the menu.
2. Search by product name and verify matching dishes remain.
3. Search a word that exists only in a product description.
4. Search a category name.
5. Search an active size/add-on/group name and verify the relevant product is found.
6. Enter two search terms and confirm both terms must match the product's searchable metadata.
7. Select Vegetarian, Vegan, Halal and Gluten-free separately.
8. Select two dietary filters together and verify products must satisfy both.
9. Set minimum rating to 4★; unrated/lower-rated products must not pass the filter.
10. Set minimum and maximum price and verify base-price filtering.
11. Clear search/filters and confirm the category selection is still respected.
12. Verify the filter layout remains usable on desktop, tablet and mobile.

## D. Sorting integrity

1. Select Price: low to high and verify ascending base prices.
2. Select Price: high to low and verify descending base prices.
3. Select Top rated and verify higher published-review averages sort first, with review count/popularity used as tie-breakers.
4. Select Most ordered and verify products with higher delivered-order quantity sort first.
5. Create a pending/cancelled order and confirm it does not increase the popularity value used by the server.
6. Deliver an order and confirm a subsequent product refresh includes that quantity in popularity.

## E. API and security/regression

1. Verify `GET /api/products?dietary=vegan&sort=PRICE_ASC` returns only active products matching the classification.
2. Verify `GET /api/products?minPrice=5&maxPrice=20&minRating=4` validates the range and filters correctly.
3. Verify a maximum price lower than minimum price returns request validation error.
4. Verify product API responses use `Cache-Control: no-store` so Step 11 stock is not cached stale.
5. Confirm anonymous customers can use discovery without authentication.
6. Confirm discovery endpoints expose no guest-order token, customer address, payment or account-private data.
7. Regression-test cart customizations, product/option stock, Guest Checkout, Delivery/Pickup, ASAP/scheduled slots, delivery zones, COD, manual payments, SSLCOMMERZ, saved addresses, reorder, reviews, Tomato Points, wishlist, notifications and PWA.
