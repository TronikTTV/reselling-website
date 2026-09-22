// Local-only batch importer. No credentials, server or scraping service required.
// JSON manifests or one public Product JSON-LD page URL per line. See README.md.
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const MAX_BYTES = 12 * 1024 * 1024;
const scalar = (value) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

export function sourceUrl(value, base) {
  const url = new URL(value, base);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Use a public HTTPS URL without credentials or a custom port.');
  if (url.hostname === 'localhost' || !url.hostname.includes('.') || isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('Local addresses and IP URLs are not supported.');
  url.hash = '';
  return url.href;
}

// Supplier pages and redirects must not lead to services on the local network.
function publicAddress(address) {
  if (isIP(address) === 6) return /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(db8|0):/i.test(address);
  const [a, b] = address.split('.').map(Number);
  return a > 0 && a < 224 && a !== 10 && a !== 127 && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0)) && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && (b === 18 || b === 19));
}

export async function download(address, image = false) {
  let current = sourceUrl(address);
  for (let hop = 0; hop < 5; hop++) {
    const addresses = await lookup(new URL(current).hostname, { all: true });
    if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error('Source resolves to a non-public address.');
    const response = await fetch(current, {
      redirect: 'manual', signal: AbortSignal.timeout(25000),
      headers: { 'User-Agent': 'CatalogueImporter/1.0', Accept: image ? 'image/*' : 'text/html,application/xhtml+xml' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      current = sourceUrl(response.headers.get('location'), current);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Source returned HTTP ${response.status}.`); }
    const type = response.headers.get('content-type') ?? '';
    if (image ? !type.startsWith('image/') : !/html/i.test(type)) { await response.body?.cancel(); throw new Error(`Unexpected content type: ${type}.`); }
    if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body?.cancel(); throw new Error('Download exceeds 12 MB.'); }
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_BYTES) throw new Error('Download exceeds 12 MB.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new Error('Too many redirects.');
}

export function extractProducts(html, pageUrl) {
  const found = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const types = [node['@type']].flat().map((value) => scalar(value).replace(/^https?:\/\/schema.org\//, ''));
    if (types.includes('Product')) {
      const offer = [node.offers].flat().find((value) => value && typeof value === 'object') ?? {};
      const images = [node.image].flat().map((value) => scalar(typeof value === 'object' ? value?.contentUrl ?? value?.url : value)).filter(Boolean);
      found.push({
        source: sourceUrl(node.url || pageUrl, pageUrl), title: scalar(node.name),
        images: images.map((image) => sourceUrl(image, pageUrl)),
        brand: scalar(typeof node.brand === 'object' ? node.brand?.name : node.brand),
        price: offer.price, currency: offer.priceCurrency,
        status: /\/(SoldOut|OutOfStock|Discontinued)$/.test(offer.availability ?? '') ? 'sold' : 'available',
      });
      return;
    }
    Object.values(node).forEach(visit);
  };
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\btype\s*=\s*['"]application\/ld\+json['"]/i.test(match[1])) continue;
    try { visit(JSON.parse(match[2])); } catch { /* Other JSON-LD blocks may still contain valid products. */ }
  }
  return found;
}

export function normaliseProduct(raw, options) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Each product must be an object.');
  const title = scalar(raw.title);
  if (!title) throw new Error('Missing product title.');
  const source = sourceUrl(raw.source);
  const category = scalar(raw.category) || options.category;
  if (!options.categories.includes(category)) throw new Error(`Unknown category "${category}". Add it in the editor first.`);
  if (!Array.isArray(raw.images) || !raw.images.length) throw new Error('No product images found.');
  if (raw.images.length > 10) throw new Error('More than 10 photos. Select up to 10 in a JSON manifest.');
  const images = [...new Set(raw.images.map((value) => sourceUrl(value, source)))];
  const product = { title, source, category, images, status: ['available', 'reserved', 'sold'].includes(raw.status) ? raw.status : 'available' };
  for (const key of ['brand', 'size', 'condition']) if (scalar(raw[key])) product[key] = scalar(raw[key]);
  // Descriptions are deliberately not scraped; suppliers may include embedded HTML.
  if (options.keepPrices && raw.price !== undefined && raw.price !== null && raw.price !== '') {
    if (scalar(raw.currency).toUpperCase() !== options.currency) throw new Error(`Price currency must be ${options.currency}; no currency conversion is performed.`);
    const price = Number(raw.price);
    if (!Number.isFinite(price) || price < 0) throw new Error('Invalid price.');
    product.price = price;
  }
  return product;
}

export function productKey(product) {
  // Identity is source-based, so supplier title changes do not create duplicate listings.
  return `web-${createHash('sha256').update(product.source).digest('hex').slice(0, 20)}`;
}

export async function saveProduct(product, { root = ROOT, fetchImage = download } = {}) {
  const key = productKey(product);
  const destination = path.join(root, 'src', 'content', 'products', key);
  if (existsSync(destination)) return 'skipped';
  const staging = path.join(root, 'import', '_web-staging', key);
  // A previous interrupted batch may leave a staging folder. Remove only this exact generated path.
  const stagingRoot = path.resolve(root, 'import', '_web-staging');
  if (path.dirname(path.resolve(staging)) !== stagingRoot || !/^web-[a-f0-9]{20}$/.test(key)) throw new Error('Invalid staging path.');
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    const images = [];
    for (const address of product.images) {
      const file = `photo-${images.length + 1}.webp`;
      await sharp(await fetchImage(address, true), { limitInputPixels: 40000000 })
        .rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78 }).toFile(path.join(staging, file));
      images.push(file);
    }
    const data = { title: product.title, images, category: product.category, status: product.status, date: new Date().toISOString() };
    for (const key of ['price', 'brand', 'size', 'condition']) if (product[key] !== undefined) data[key] = product[key];
    const markdown = `---\n${Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n`;
    await writeFile(path.join(staging, 'index.md'), markdown, 'utf8');
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(staging, destination);
    return 'imported';
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function main(args = process.argv.slice(2)) {
  const allowed = new Set(['--file', '--category', '--keep-prices', '--dry-run', '--help']);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!allowed.has(arg)) throw new Error(`Unknown option: ${arg}`);
    if (arg === '--file' || arg === '--category') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = args[++i];
    } else options[arg.slice(2)] = true;
  }
  if (options.help || !options.file) {
    console.log('npm run import:web -- --file import/urls.txt --category clothing [--dry-run] [--keep-prices]\nAlso accepts a JSON array: [{ source, title, images: [httpsURL], category, price?, currency?, brand?, size?, condition?, status? }].\nPrices are blank by default. Existing source URLs are skipped; existing listings are never overwritten.');
    return;
  }
  const categoryData = JSON.parse(await readFile(path.join(ROOT, 'src/data/categories.json'), 'utf8'));
  const settings = JSON.parse(await readFile(path.join(ROOT, 'src/data/settings.json'), 'utf8'));
  const context = { categories: categoryData.categories.map(({ slug }) => slug), category: options.category, currency: (settings.currency || 'GBP').toUpperCase(), keepPrices: options['keep-prices'] };
  const input = (await readFile(path.resolve(options.file), 'utf8')).replace(/^\uFEFF/, '').trim();
  const json = options.file.toLowerCase().endsWith('.json');
  const entries = json ? JSON.parse(input) : [...new Set(input.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')))];
  if (!Array.isArray(entries)) throw new Error('The JSON file must contain an array of products.');
  const report = { imported: 0, skipped: 0, previewed: 0, failed: [] };
  const seen = new Set();
  // Sequential requests keep memory bounded even for thousands of products.
  for (const [index, entry] of entries.entries()) {
    try {
      let products;
      if (json) products = [entry];
      else {
        const address = sourceUrl(entry);
        products = extractProducts((await download(address)).toString('utf8'), address);
        if (!products.length) throw new Error('No supported Product JSON-LD found. This source needs an adapter or JSON export.');
      }
      for (const raw of products) {
        try {
          const product = normaliseProduct(raw, context);
          const key = productKey(product);
          if (seen.has(key) || existsSync(path.join(ROOT, 'src/content/products', key))) { report.skipped++; continue; }
          seen.add(key);
          if (options['dry-run']) {
            report.previewed++;
            console.log(`[preview] ${product.title} | ${product.category} | ${product.images.length} photos | ${product.price ?? 'Ask for price'}`);
          } else {
            const result = await saveProduct(product);
            report[result]++;
            console.log(`[${result}] ${product.title}`);
          }
        } catch (error) { report.failed.push({ row: index + 1, error: error.message }); }
      }
    } catch (error) { report.failed.push({ row: index + 1, error: error.message }); }
  }
  console.log(JSON.stringify(report, null, 2));
  if (!options['dry-run']) {
    await mkdir(path.join(ROOT, 'import'), { recursive: true });
    await writeFile(path.join(ROOT, 'import', 'web-import-report.json'), JSON.stringify(report, null, 2));
  }
  console.log(options['dry-run'] ? 'Preview only. No files were changed; image downloads have not been tested.' : 'Review the listings in the editor, then commit and push to publish.');
  if (report.failed.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
