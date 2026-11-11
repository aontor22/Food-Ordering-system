export function slugifyProductName(value) {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'product';
}

export function normalizeProductSlug(value) {
  return slugifyProductName(value).slice(0, 90);
}

export async function uniqueProductSlug(db, desired, { excludeId = null } = {}) {
  const base = normalizeProductSlug(desired);
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const existing = await db.product.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing || existing.id === excludeId) return candidate;
  }
  throw new Error('Could not allocate a unique product slug');
}

export function productStructuredData(product, { siteUrl, currency = 'USD' } = {}) {
  const url = `${String(siteUrl || '').replace(/\/$/, '')}/menu/${product.slug}`;
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    sku: product.id,
    url,
    category: product.category,
    ...(product.imageUrl ? { image: [product.imageUrl] } : {}),
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: currency,
      price: (Number(product.priceCents || 0) / 100).toFixed(2),
      availability: product.orderable === false ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
    },
  };
  if (Number(product.reviewCount) > 0) {
    data.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Number(product.reviewRating || 0).toFixed(1),
      reviewCount: Number(product.reviewCount),
      bestRating: '5',
      worstRating: '1',
    };
  }
  return data;
}
