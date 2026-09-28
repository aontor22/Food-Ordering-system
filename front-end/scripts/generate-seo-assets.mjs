import fs from 'node:fs/promises';
import path from 'node:path';

const DIST = path.resolve('dist');
const DEFAULT_SITE_URL = 'https://food-ordering-system-ten-sable.vercel.app';
const siteUrl = String(process.env.VITE_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '') || DEFAULT_SITE_URL).replace(/\/$/, '');
const apiUrl = String(process.env.VITE_API_URL || 'http://localhost:4000/api').replace(/\/$/, '');
const currency = String(process.env.VITE_CURRENCY || 'USD').toUpperCase();

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const absoluteUrl = value => !value ? `${siteUrl}/favicon-512.png` : /^https?:\/\//i.test(value) ? value : `${siteUrl}${value.startsWith('/') ? '' : '/'}${value}`;
const xmlEscape = value => String(value ?? '').replace(/[<>&'\"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char]));

async function fetchJson(endpoint) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${apiUrl}${endpoint}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`${endpoint} returned ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

function setTitle(html, value) {
  return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(value)}</title>`);
}

function setMeta(html, attribute, key, value) {
  const escaped = escapeHtml(value);
  const pattern = new RegExp(`<meta\\s+[^>]*${attribute}=["']${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'i');
  const replacement = `<meta ${attribute}="${escapeHtml(key)}" content="${escaped}" />`;
  return pattern.test(html) ? html.replace(pattern, replacement) : html.replace('</head>', `    ${replacement}\n  </head>`);
}

function setCanonical(html, value) {
  const replacement = `<link rel="canonical" href="${escapeHtml(value)}" />`;
  return /<link\s+[^>]*rel=["']canonical["'][^>]*>/i.test(html)
    ? html.replace(/<link\s+[^>]*rel=["']canonical["'][^>]*>/i, replacement)
    : html.replace('</head>', `    ${replacement}\n  </head>`);
}

function setJsonLd(html, objects) {
  const cleaned = html.replace(/\s*<script[^>]*id=["']tomato-structured-data["'][^>]*>[\s\S]*?<\/script>/gi, '');
  const safeJson = JSON.stringify(objects).replace(/</g, '\\u003c');
  return cleaned.replace('</head>', `    <script id="tomato-structured-data" type="application/ld+json">${safeJson}</script>\n  </head>`);
}

function productJsonLd(product) {
  const url = `${siteUrl}/menu/${product.slug}`;
  const result = {
    '@context': 'https://schema.org', '@type': 'Product', name: product.name, description: product.description,
    sku: product.id, category: product.category, url,
    ...(product.imageUrl ? { image: [absoluteUrl(product.imageUrl)] } : {}),
    offers: { '@type': 'Offer', url, priceCurrency: currency, price: (Number(product.priceCents || 0) / 100).toFixed(2), availability: product.orderable === false ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock' },
  };
  if (Number(product.reviewCount) > 0) result.aggregateRating = { '@type': 'AggregateRating', ratingValue: Number(product.reviewRating || 0).toFixed(1), reviewCount: Number(product.reviewCount), bestRating: '5', worstRating: '1' };
  return result;
}

function productHtml(baseHtml, product) {
  const canonical = `${siteUrl}/menu/${product.slug}`;
  const description = String(product.description || '').trim().slice(0, 160);
  const image = absoluteUrl(product.imageUrl || '/og-cover.webp');
  let html = setTitle(baseHtml, `${product.name} — Order from Tomato`);
  html = setMeta(html, 'name', 'description', description);
  html = setMeta(html, 'name', 'robots', 'index,follow,max-image-preview:large');
  html = setCanonical(html, canonical);
  for (const [property, value] of Object.entries({ 'og:title': `${product.name} — Order from Tomato`, 'og:description': description, 'og:type': 'product', 'og:url': canonical, 'og:site_name': 'Tomato', 'og:image': image })) html = setMeta(html, 'property', property, value);
  for (const [name, value] of Object.entries({ 'twitter:card': 'summary_large_image', 'twitter:title': `${product.name} — Order from Tomato`, 'twitter:description': description, 'twitter:image': image })) html = setMeta(html, 'name', name, value);
  const breadcrumb = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteUrl}/` },
    { '@type': 'ListItem', position: 2, name: product.category, item: `${siteUrl}/#dishes` },
    { '@type': 'ListItem', position: 3, name: product.name, item: canonical },
  ] };
  return setJsonLd(html, [productJsonLd(product), breadcrumb]);
}

function restaurantJsonLd(store, fulfillment) {
  const schedule = store?.schedule || [];
  const dayMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const openingHoursSpecification = schedule.filter(day => !day.isClosed).map(day => ({
    '@type': 'OpeningHoursSpecification', dayOfWeek: `https://schema.org/${dayMap[day.dayOfWeek]}`,
    opens: day.open24Hours ? '00:00' : day.openTime,
    closes: day.open24Hours ? '23:59' : day.closeTime,
  }));
  return {
    '@context': 'https://schema.org', '@type': 'Restaurant', name: 'Tomato', url: `${siteUrl}/`, image: `${siteUrl}/og-cover.webp`,
    servesCuisine: ['Fresh meals', 'International'], priceRange: '$$', acceptsReservations: false,
    ...(fulfillment?.settings?.pickupAddress ? { address: fulfillment.settings.pickupAddress } : {}),
    ...(openingHoursSpecification.length ? { openingHoursSpecification } : {}),
    hasMenu: `${siteUrl}/#dishes`,
  };
}

let products = [];
let store = null;
let fulfillment = null;
try {
  const [productsData, storeData, fulfillmentData] = await Promise.all([
    fetchJson('/products'), fetchJson('/store/status').catch(() => null), fetchJson('/store/fulfillment').catch(() => null),
  ]);
  products = Array.isArray(productsData?.products) ? productsData.products.filter(product => product.slug && product.isAvailable !== false) : [];
  store = storeData?.store || null;
  fulfillment = fulfillmentData || null;
} catch (error) {
  console.warn(`[seo] Product feed unavailable during build: ${error.message}. Home sitemap/robots will still be generated.`);
}

let indexHtml = await fs.readFile(path.join(DIST, 'index.html'), 'utf8');
indexHtml = setCanonical(indexHtml, `${siteUrl}/`);
indexHtml = setMeta(indexHtml, 'property', 'og:url', `${siteUrl}/`);
indexHtml = setMeta(indexHtml, 'property', 'og:image', `${siteUrl}/og-cover.webp`);
indexHtml = setMeta(indexHtml, 'name', 'twitter:image', `${siteUrl}/og-cover.webp`);
indexHtml = setJsonLd(indexHtml, restaurantJsonLd(store, fulfillment));
await fs.writeFile(path.join(DIST, 'index.html'), indexHtml);

await fs.mkdir(path.join(DIST, 'menu'), { recursive: true });
for (const product of products) {
  await fs.mkdir(path.join(DIST, 'menu', product.slug), { recursive: true });
  await fs.writeFile(path.join(DIST, 'menu', product.slug, 'index.html'), productHtml(indexHtml, product));
}

const urls = [{ loc: `${siteUrl}/`, lastmod: new Date().toISOString() }, ...products.map(product => ({ loc: `${siteUrl}/menu/${product.slug}`, lastmod: product.updatedAt || new Date().toISOString() }))];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(item => `  <url><loc>${xmlEscape(item.loc)}</loc><lastmod>${xmlEscape(new Date(item.lastmod).toISOString())}</lastmod></url>`).join('\n')}\n</urlset>\n`;
await fs.writeFile(path.join(DIST, 'sitemap.xml'), sitemap);

const robots = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /cart\nDisallow: /order\nDisallow: /orders\nDisallow: /wishlist\nDisallow: /notifications\nDisallow: /addresses\nDisallow: /security\nDisallow: /verify-email\nDisallow: /reset-password\nDisallow: /order-success\nDisallow: /guest-order\nDisallow: /payment\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
await fs.writeFile(path.join(DIST, 'robots.txt'), robots);
console.log(`[seo] Generated sitemap, robots, home structured data and ${products.length} product SEO shell${products.length === 1 ? '' : 's'} for ${siteUrl}`);
