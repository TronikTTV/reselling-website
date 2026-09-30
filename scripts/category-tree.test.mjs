// Tests for categories with sub-categories (src/lib/category-tree.ts). Run with `npm run test:studio`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ancestorsOf,
  categorySlug,
  CATEGORY_SLUG,
  insertCategory,
  isWithin,
  labelOf,
  moveAddress,
  orderCategories,
  resolveCategory,
  trailOf,
} from '../src/lib/category-tree.ts';

const LIST = [
  { name: 'Watches', slug: 'watches' },
  { name: 'P-6000', slug: 'shoes/nike/p-6000' },
  { name: 'Trainers & Shoes', slug: 'shoes' },
  { name: 'Nike', slug: 'shoes/nike' },
  { name: 'Adidas', slug: 'shoes/adidas' },
  { name: 'Clothing', slug: 'clothing' },
];

test('addresses: tidied level by level, with / between levels', () => {
  assert.equal(categorySlug(' Shoes / Nike SB '), 'shoes/nike-sb');
  assert.equal(categorySlug('Hats & Caps'), 'hats-and-caps');
  assert.equal(categorySlug('/shoes//nike/'), 'shoes/nike');
  assert.ok(CATEGORY_SLUG.test('shoes/nike/p-6000'));
  assert.ok(!CATEGORY_SLUG.test('shoes//nike'));
  assert.ok(!CATEGORY_SLUG.test('Shoes'));
  assert.deepEqual(ancestorsOf('shoes/nike/p-6000'), ['shoes', 'shoes/nike']);
  assert.ok(isWithin('shoes/nike', 'shoes'));
  assert.ok(isWithin('shoes', 'shoes'));
  assert.ok(!isWithin('shoes-2', 'shoes'), 'a similar name is not inside');
  assert.ok(!isWithin('shoes', ''));
});

test('order: each category followed by its sub-categories, in the order listed', () => {
  const ordered = orderCategories(LIST);
  assert.deepEqual(
    ordered.map((item) => `${'  '.repeat(item.depth)}${item.slug}`),
    ['watches', 'shoes', '  shoes/nike', '    shoes/nike/p-6000', '  shoes/adidas', 'clothing'],
  );
  assert.equal(ordered.find((item) => item.slug === 'shoes/nike').parent, 'shoes');
  // A missing level is filled in, named from its address.
  const filled = orderCategories([{ name: 'P-6000', slug: 'shoes/new-balance/p-6000' }]);
  assert.deepEqual(
    filled.map((item) => [item.slug, item.name]),
    [
      ['shoes', 'Shoes'],
      ['shoes/new-balance', 'New Balance'],
      ['shoes/new-balance/p-6000', 'P-6000'],
    ],
  );
});

test('products in unknown sub-categories show under the nearest category above', () => {
  const known = new Set(LIST.map((item) => item.slug));
  assert.equal(resolveCategory('shoes/nike/p-6000', known), 'shoes/nike/p-6000');
  assert.equal(resolveCategory('shoes/nike/dunk-low', known), 'shoes/nike');
  assert.equal(resolveCategory('Shoes', known), 'shoes');
  assert.equal(resolveCategory('bags/gucci', known), '');
  const bySlug = new Map(LIST.map((item) => [item.slug, item]));
  assert.deepEqual(trailOf('shoes/nike/p-6000', bySlug).map((item) => item.name), ['Trainers & Shoes', 'Nike', 'P-6000']);
  assert.equal(labelOf('shoes/nike', bySlug), 'Trainers & Shoes › Nike');
});

test('adding and moving sub-categories', () => {
  const ordered = orderCategories(LIST).map(({ name, slug }) => ({ name, slug }));
  // A new sub-category goes after its parent's last one.
  const added = insertCategory(ordered, { name: 'Dunk Low', slug: 'shoes/nike/dunk-low' });
  assert.deepEqual(
    added.map((item) => item.slug),
    ['watches', 'shoes', 'shoes/nike', 'shoes/nike/p-6000', 'shoes/nike/dunk-low', 'shoes/adidas', 'clothing'],
  );
  assert.equal(insertCategory(added, { name: 'Again', slug: 'shoes/nike' }), added, 'no repeats');
  assert.deepEqual(insertCategory(ordered, { name: 'Bags', slug: 'bags' }).at(-1).slug, 'bags');
  // Renaming a category's address takes its sub-categories along.
  assert.equal(moveAddress('shoes/nike/p-6000', 'shoes/nike', 'shoes/nike-sb'), 'shoes/nike-sb/p-6000');
  assert.equal(moveAddress('shoes/adidas', 'shoes/nike', 'shoes/nike-sb'), 'shoes/adidas');
});
