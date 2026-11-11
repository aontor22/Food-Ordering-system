export const DIETARY_OPTIONS = Object.freeze([
  { key: 'vegetarian', field: 'isVegetarian', label: 'Vegetarian' },
  { key: 'vegan', field: 'isVegan', label: 'Vegan' },
  { key: 'halal', field: 'isHalal', label: 'Halal' },
  { key: 'gluten_free', field: 'isGlutenFree', label: 'Gluten-free' },
]);

export const SORT_OPTIONS = Object.freeze([
  { value: 'RECOMMENDED', label: 'Recommended' },
  { value: 'POPULARITY', label: 'Most ordered' },
  { value: 'RATING', label: 'Top rated' },
  { value: 'PRICE_ASC', label: 'Price: low to high' },
  { value: 'PRICE_DESC', label: 'Price: high to low' },
]);

function normalizeText(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function productSearchText(product) {
  const optionText = (product.optionGroups || []).flatMap(group => [group.name, ...(group.options || []).map(option => option.name)]);
  const dietaryText = DIETARY_OPTIONS.filter(option => product?.[option.field]).map(option => option.label);
  return normalizeText([product.name, product.description, product.category, ...optionText, ...dietaryText].join(' '));
}

export function dietaryLabels(product) {
  return DIETARY_OPTIONS.filter(option => product?.[option.field]).map(option => option.label);
}

export function filterAndSortProducts(products, filters = {}) {
  const {
    category = 'All', search = '', dietary = [], minRating = 0,
    minPrice = '', maxPrice = '', sort = 'RECOMMENDED',
  } = filters;
  const searchTerms = normalizeText(search).split(' ').filter(Boolean);
  const selectedDietary = new Set(dietary);
  const low = minPrice === '' ? null : Number(minPrice);
  const high = maxPrice === '' ? null : Number(maxPrice);

  const matched = products.filter(product => {
    if (category !== 'All' && normalizeText(product.category) !== normalizeText(category)) return false;
    if (searchTerms.length) {
      const haystack = productSearchText(product);
      if (!searchTerms.every(term => haystack.includes(term))) return false;
    }
    for (const option of DIETARY_OPTIONS) if (selectedDietary.has(option.key) && product?.[option.field] !== true) return false;
    if (Number(minRating) > 0 && Number(product.reviewRating || 0) < Number(minRating)) return false;
    const price = Number(product.price ?? Number(product.priceCents || 0) / 100);
    if (Number.isFinite(low) && price < low) return false;
    if (Number.isFinite(high) && price > high) return false;
    return true;
  });

  if (sort === 'RECOMMENDED') return matched;
  const rows = [...matched];
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  const byPopularity = (a, b) => Number(b.popularityCount || 0) - Number(a.popularityCount || 0);
  const byRating = (a, b) => Number(b.reviewRating || 0) - Number(a.reviewRating || 0)
    || Number(b.reviewCount || 0) - Number(a.reviewCount || 0);
  rows.sort((a, b) => {
    if (sort === 'PRICE_ASC') return Number(a.priceCents || 0) - Number(b.priceCents || 0) || byName(a, b);
    if (sort === 'PRICE_DESC') return Number(b.priceCents || 0) - Number(a.priceCents || 0) || byName(a, b);
    if (sort === 'RATING') return byRating(a, b) || byPopularity(a, b) || byName(a, b);
    if (sort === 'POPULARITY') return byPopularity(a, b) || byRating(a, b) || byName(a, b);
    return 0;
  });
  return rows;
}
