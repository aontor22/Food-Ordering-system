# Step 20 verification

1. Apply migration `20260928040000_seo_product_slugs` and confirm every Product has a unique slug.
2. Run `node --test server/test/seo.test.js`.
3. Run full `npm test` and `npm run build`.
4. Confirm `front-end/dist/robots.txt` and `front-end/dist/sitemap.xml` exist after build.
5. Confirm `front-end/dist/menu/<slug>/index.html` exists for available products when the build can reach the production API.
6. Inspect a generated product HTML file and confirm title, description, canonical, Open Graph, Twitter and Product JSON-LD reference the product.
7. Deploy Render first because Step 20 includes a Product slug migration.
8. Deploy Vercel and load `/menu/<slug>` directly with a hard refresh.
9. Confirm unavailable/archived products return Product not found and are omitted from new SEO builds.
10. Confirm `/admin`, `/cart`, `/orders`, `/guest-order/...` and `/payment/...` responses include an `X-Robots-Tag: noindex, nofollow, noarchive` Vercel header.
11. Confirm `/robots.txt` points to the production sitemap and disallows private routes.
12. Confirm `/sitemap.xml` contains only the home page and available product URLs.
13. Confirm existing cart, checkout, wishlist, product customizer, reviews and search still work from both menu cards and product detail pages.
