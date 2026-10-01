const DEFAULT_SITE_URL = 'https://food-ordering-system-ten-sable.vercel.app';

export function siteUrl() {
  const configured = String(import.meta.env.VITE_SITE_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  if (typeof window !== 'undefined' && /^https?:$/i.test(window.location.protocol)) return window.location.origin;
  return DEFAULT_SITE_URL;
}

export function absoluteUrl(value) {
  if (!value) return `${siteUrl()}/favicon-512.png`;
  if (/^https?:\/\//i.test(value)) return value;
  return `${siteUrl()}${value.startsWith('/') ? '' : '/'}${value}`;
}

function ensureMeta(selector, attributes) {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement('meta');
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    document.head.appendChild(element);
  }
  return element;
}

function setMetaName(name, content) {
  const element = ensureMeta(`meta[name="${name}"]`, { name });
  element.setAttribute('content', content);
}

function setMetaProperty(property, content) {
  const element = ensureMeta(`meta[property="${property}"]`, { property });
  element.setAttribute('content', content);
}

function setCanonical(url) {
  let link = document.head.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  link.setAttribute('href', url);
}

export function applySeo({
  title = 'Tomato — Fresh food, delivered',
  description = 'Order fresh, chef-crafted food from Tomato for delivery or pickup.',
  canonicalPath = '/',
  image = '/og-cover.webp',
  type = 'website',
  robots = 'index,follow,max-image-preview:large',
  jsonLd = null,
} = {}) {
  const canonical = /^https?:\/\//i.test(canonicalPath) ? canonicalPath : `${siteUrl()}${canonicalPath.startsWith('/') ? canonicalPath : `/${canonicalPath}`}`;
  document.title = title;
  setMetaName('description', description);
  setMetaName('robots', robots);
  setCanonical(canonical);
  setMetaProperty('og:title', title);
  setMetaProperty('og:description', description);
  setMetaProperty('og:type', type);
  setMetaProperty('og:url', canonical);
  setMetaProperty('og:site_name', 'Tomato');
  setMetaProperty('og:image', absoluteUrl(image));
  setMetaName('twitter:card', 'summary_large_image');
  setMetaName('twitter:title', title);
  setMetaName('twitter:description', description);
  setMetaName('twitter:image', absoluteUrl(image));

  document.head.querySelectorAll('script[data-tomato-jsonld="true"], script#tomato-structured-data').forEach(node => node.remove());
  const values = Array.isArray(jsonLd) ? jsonLd : jsonLd ? [jsonLd] : [];
  for (const value of values) {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.tomatoJsonld = 'true';
    script.textContent = JSON.stringify(value).replace(/</g, '\\u003c');
    document.head.appendChild(script);
  }
}

export function productJsonLd(product) {
  const canonical = `${siteUrl()}/menu/${product.slug}`;
  const result = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    sku: product.id,
    category: product.category,
    url: canonical,
    ...(product.imageUrl || product.image ? { image: [absoluteUrl(product.imageUrl || product.image)] } : {}),
    offers: {
      '@type': 'Offer',
      url: canonical,
      priceCurrency: String(import.meta.env.VITE_CURRENCY || 'USD').toUpperCase(),
      price: (Number(product.priceCents || 0) / 100).toFixed(2),
      availability: product.orderable === false ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
    },
  };
  if (Number(product.reviewCount) > 0) result.aggregateRating = {
    '@type': 'AggregateRating',
    ratingValue: Number(product.reviewRating || 0).toFixed(1),
    reviewCount: Number(product.reviewCount),
    bestRating: '5',
    worstRating: '1',
  };
  return result;
}
