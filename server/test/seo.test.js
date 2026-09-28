import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProductSlug, productStructuredData, slugifyProductName } from '../src/services/seo.js';

test('product slug normalization produces stable URL-safe values', () => {
  assert.equal(slugifyProductName('  Chicken & Cheese Pizza!  '), 'chicken-cheese-pizza');
  assert.equal(normalizeProductSlug('Vegan Bowl / Large'), 'vegan-bowl-large');
  assert.equal(slugifyProductName('***'), 'product');
});

test('product structured data uses immutable product identity and current offer', () => {
  const data = productStructuredData({
    id: 'prd_1', slug: 'chicken-pizza', name: 'Chicken Pizza', description: 'Fresh pizza', category: 'Pizza',
    imageUrl: 'https://res.cloudinary.com/demo/image/upload/pizza.webp', priceCents: 1299, orderable: true,
    reviewRating: 4.75, reviewCount: 8,
  }, { siteUrl: 'https://tomato.example', currency: 'BDT' });
  assert.equal(data['@type'], 'Product');
  assert.equal(data.url, 'https://tomato.example/menu/chicken-pizza');
  assert.equal(data.offers.price, '12.99');
  assert.equal(data.offers.priceCurrency, 'BDT');
  assert.equal(data.aggregateRating.reviewCount, 8);
});

test('out-of-stock structured data advertises the correct schema availability', () => {
  const data = productStructuredData({ id: 'p', slug: 'sold-out', name: 'Sold out', description: 'Unavailable', category: 'Test', priceCents: 100, orderable: false }, { siteUrl: 'https://tomato.example' });
  assert.equal(data.offers.availability, 'https://schema.org/OutOfStock');
});
