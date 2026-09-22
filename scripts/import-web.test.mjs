import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { extractProducts, normaliseProduct, productKey, saveProduct, sourceUrl } from './import-web.mjs';

const context = { categories: ['clothing'], category: 'clothing', currency: 'GBP' };
const raw = { title: 'Jacket: "blue"', source: 'https://supplier.example/item/1', images: ['https://supplier.example/photo.jpg'], price: 25, currency: 'GBP' };

test('extracts Product JSON-LD from graphs, skips broken blocks and resolves relative photos', () => {
  const html = `<script type="application/ld+json">invalid</script><script type='application/ld+json'>${JSON.stringify({ '@graph': [{ '@type': 'Product', name: 'Jacket', image: [{ contentUrl: '/photo.jpg' }], brand: { name: 'Brand' }, offers: { price: '25', priceCurrency: 'GBP', availability: 'https://schema.org/OutOfStock' } }] })}</script>`;
  const [product] = extractProducts(html, raw.source);
  assert.equal(product.title, 'Jacket');
  assert.deepEqual(product.images, raw.images);
  assert.equal(product.status, 'sold');
  assert.equal(product.brand, 'Brand');
  assert.deepEqual(extractProducts('<html>Album with no structured data</html>', raw.source), []);
});

test('prices default to blank, preserving requires the store currency and a valid amount', () => {
  assert.equal(normaliseProduct(raw, context).price, undefined);
  assert.equal(normaliseProduct(raw, { ...context, keepPrices: true }).price, 25);
  assert.equal(normaliseProduct({ ...raw, price: 0 }, { ...context, keepPrices: true }).price, 0);
  assert.throws(() => normaliseProduct({ ...raw, currency: 'USD' }, { ...context, keepPrices: true }), /currency/);
  assert.throws(() => normaliseProduct({ ...raw, price: -1 }, { ...context, keepPrices: true }), /Invalid price/);
});

test('rejects missing fields, unknown categories, too many photos and unsafe URL schemes', () => {
  assert.throws(() => normaliseProduct({ ...raw, title: '' }, context), /title/);
  assert.throws(() => normaliseProduct({ ...raw, images: [] }, context), /images/);
  assert.throws(() => normaliseProduct({ ...raw, category: 'missing' }, context), /category/);
  assert.throws(() => normaliseProduct({ ...raw, images: Array(11).fill(raw.images[0]) }, context), /10 photos/);
  for (const url of ['http://supplier.example/a', 'https://localhost/a', 'https://127.0.0.1/a', 'file:///C:/secret', 'https://user:secret@supplier.example/a']) assert.throws(() => sourceUrl(url));
});

test('source identity is stable across titles and fragments and unique for thousands of products', () => {
  const first = normaliseProduct(raw, context);
  const renamed = normaliseProduct({ ...raw, title: 'Renamed', source: `${raw.source}#photos` }, context);
  assert.equal(productKey(first), productKey(renamed));
  assert.equal(new Set(Array.from({ length: 2000 }, (_, i) => productKey({ source: `https://supplier.example/${i}` }))).size, 2000);
});

test('writes optimised CMS listings, skips duplicates without fetching, and cleans up failed downloads', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'catalogue-import-test-'));
  try {
    const bytes = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: '#aaa' } }).png().toBuffer();
    const product = normaliseProduct(raw, { ...context, keepPrices: true });
    assert.equal(await saveProduct(product, { root, fetchImage: async () => bytes }), 'imported');
    const folder = path.join(root, 'src/content/products', productKey(product));
    const markdown = await readFile(path.join(folder, 'index.md'), 'utf8');
    assert.match(markdown, /price: 25/);
    assert.match(markdown, /images: \["photo-1.webp"\]/);
    const metadata = await sharp(await readFile(path.join(folder, 'photo-1.webp'))).metadata();
    assert.equal(metadata.width, 1600);
    assert.equal(metadata.format, 'webp');
    assert.equal(await saveProduct(product, { root, fetchImage: () => { throw new Error('Should never fetch'); } }), 'skipped');
    assert.equal(await readFile(path.join(folder, 'index.md'), 'utf8'), markdown);
    const broken = { ...product, source: `${raw.source}/broken`, images: [raw.images[0], 'https://supplier.example/broken.jpg'] };
    let calls = 0;
    await assert.rejects(saveProduct(broken, { root, fetchImage: async () => { if (++calls === 2) throw new Error('Network failure'); return bytes; } }), /Network failure/);
    assert.deepEqual(await readdir(path.join(root, 'import/_web-staging')), []);
    assert.deepEqual(await readdir(path.join(root, 'src/content/products')), [productKey(product)]);
  } finally {
    const target = path.resolve(root);
    assert.equal(path.dirname(target), path.resolve(tmpdir()));
    assert.ok(path.basename(target).startsWith('catalogue-import-test-'));
    await rm(target, { recursive: true, force: true });
  }
});
