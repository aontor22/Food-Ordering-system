# Step 20 — SEO, social previews, sitemap and structured data

Step 20 makes the public menu crawlable without exposing private customer/admin routes.

## Public indexable surfaces

- `/` — restaurant/home landing page
- `/menu/:slug` — stable product detail URL
- `/sitemap.xml` — generated during the Vercel production build
- `/robots.txt` — generated during the Vercel production build

Cart, checkout, orders, guest tracking, payment, account, authentication and admin routes are marked noindex through both client metadata and Vercel `X-Robots-Tag` headers.

## Product slugs

`Product.slug` is unique and stable. Existing products are backfilled during migration. New products receive an automatic slug from their name; Admin can explicitly edit the SEO slug. Renaming a product does not silently change its existing slug.

## Build-time SEO generation

`front-end/scripts/generate-seo-assets.mjs` runs after Vite/PWA build. It uses `VITE_API_URL` to retrieve the current public catalog and emits:

- product-specific HTML head shells under `dist/menu/<slug>/index.html`
- `dist/sitemap.xml`
- `dist/robots.txt`
- Restaurant JSON-LD on the home page
- Product + Breadcrumb JSON-LD on product pages

The live React product page also updates metadata client-side, so current product state is reflected after hydration. Product availability remains controlled by the backend.

Because crawler/social head shells are generated at deployment time, redeploy Vercel after meaningful catalog/slug/image changes when you want social preview and sitemap snapshots refreshed immediately.

## Environment

Recommended Vercel variable:

`VITE_SITE_URL=https://food-ordering-system-ten-sable.vercel.app`

The build script currently falls back to that production URL, but explicitly setting the variable is safer if a custom domain is introduced later.

No new Render environment variable is required.
