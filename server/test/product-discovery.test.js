import test from 'node:test';
import assert from 'node:assert/strict';
import { dietaryWhere, enrichDiscoveryMetrics, normalizeDietaryFilters, productDietaryTags, sortDiscoveredProducts } from '../src/services/product-discovery.js';

test('normalizes supported dietary filters without duplicates', () => {
  assert.deepEqual(normalizeDietaryFilters('vegan,halal,vegan,unknown'), ['vegan', 'halal']);
  assert.deepEqual(dietaryWhere(['vegetarian', 'gluten_free']), { isVegetarian: true, isGlutenFree: true });
});

test('enriches rating, popularity and dietary metadata', () => {
  const products = [{ id: 'a', name: 'A', category: 'Test', priceCents: 1000, isVegan: true, isVegetarian: true, isHalal: false, isGlutenFree: false }];
  const rows = enrichDiscoveryMetrics(products, [{ productId: 'a', _avg: { rating: 4.5 }, _count: { rating: 2 } }], [{ productId: 'a', _sum: { quantity: 7 } }]);
  assert.equal(rows[0].reviewRating, 4.5);
  assert.equal(rows[0].reviewCount, 2);
  assert.equal(rows[0].popularityCount, 7);
  assert.deepEqual(productDietaryTags(rows[0]), ['vegetarian', 'vegan']);
});

test('sorts independently by price, rating and delivered-order popularity', () => {
  const rows = [
    { id: 'a', name: 'Alpha', category: 'X', priceCents: 2000, reviewRating: 5, reviewCount: 1, popularityCount: 2 },
    { id: 'b', name: 'Beta', category: 'X', priceCents: 1000, reviewRating: 4.8, reviewCount: 10, popularityCount: 20 },
    { id: 'c', name: 'Gamma', category: 'X', priceCents: 1500, reviewRating: 4.9, reviewCount: 4, popularityCount: 5 },
  ];
  assert.deepEqual(sortDiscoveredProducts(rows, 'PRICE_ASC').map(row => row.id), ['b', 'c', 'a']);
  assert.deepEqual(sortDiscoveredProducts(rows, 'RATING').map(row => row.id), ['a', 'c', 'b']);
  assert.deepEqual(sortDiscoveredProducts(rows, 'POPULARITY').map(row => row.id), ['b', 'c', 'a']);
});
