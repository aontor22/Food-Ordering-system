const DIETARY_FIELDS = Object.freeze({
  vegetarian: 'isVegetarian',
  vegan: 'isVegan',
  halal: 'isHalal',
  gluten_free: 'isGlutenFree',
});

export const PRODUCT_SORTS = Object.freeze(['RECOMMENDED', 'PRICE_ASC', 'PRICE_DESC', 'RATING', 'POPULARITY']);
export const DIETARY_FILTERS = Object.freeze(Object.keys(DIETARY_FIELDS));

export function normalizeDietaryFilters(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(values.map(item => String(item).trim().toLowerCase()).filter(item => item in DIETARY_FIELDS))];
}

export function dietaryWhere(filters) {
  return normalizeDietaryFilters(filters).reduce((where, filter) => {
    where[DIETARY_FIELDS[filter]] = true;
    return where;
  }, {});
}

export function productDietaryTags(product) {
  return Object.entries(DIETARY_FIELDS).filter(([, field]) => product?.[field] === true).map(([key]) => key);
}

export function enrichDiscoveryMetrics(products, ratingRows = [], popularityRows = []) {
  const ratingMap = new Map(ratingRows.map(row => [row.productId, {
    reviewRating: Number(row._avg?.rating || 0),
    reviewCount: Number(row._count?.rating || 0),
  }]));
  const popularityMap = new Map(popularityRows.map(row => [row.productId, Number(row._sum?.quantity || 0)]));
  return products.map(product => ({
    ...product,
    ...(ratingMap.get(product.id) || { reviewRating: 0, reviewCount: 0 }),
    popularityCount: popularityMap.get(product.id) || 0,
    dietaryTags: productDietaryTags(product),
  }));
}

export function sortDiscoveredProducts(products, sort = 'RECOMMENDED') {
  const selected = PRODUCT_SORTS.includes(sort) ? sort : 'RECOMMENDED';
  const rows = [...products];
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  const byPopularity = (a, b) => Number(b.popularityCount || 0) - Number(a.popularityCount || 0);
  const byRating = (a, b) => Number(b.reviewRating || 0) - Number(a.reviewRating || 0)
    || Number(b.reviewCount || 0) - Number(a.reviewCount || 0);

  rows.sort((a, b) => {
    if (selected === 'PRICE_ASC') return Number(a.priceCents || 0) - Number(b.priceCents || 0) || byName(a, b);
    if (selected === 'PRICE_DESC') return Number(b.priceCents || 0) - Number(a.priceCents || 0) || byName(a, b);
    if (selected === 'RATING') return byRating(a, b) || byPopularity(a, b) || byName(a, b);
    if (selected === 'POPULARITY') return byPopularity(a, b) || byRating(a, b) || byName(a, b);
    return String(a.category).localeCompare(String(b.category)) || byName(a, b);
  });
  return rows;
}
