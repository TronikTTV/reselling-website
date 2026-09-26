// Bulk-add products from photos on your PC.
//
// 1. Put photos in the "import" folder, one folder per category:
//
//      import/watches/Rolex Submariner £8500/1.jpg, 2.jpg …   a folder = one product with several photos
//      import/hats/Black Fitted Cap £25.jpg                  a single photo = one product
//
//    The category folder can be a category's name or web address ("Hats & Caps" or "hats").
//    New category folders are added as new categories. Adding a price with a currency
//    symbol at the end of the name (£25) is optional.
//
// 2. Run:   npm run import             (or: npm run import -- --dry-run   to preview)
//    Add --draft to bring everything in as drafts, hidden from the shop until you switch Draft off.
//
// Photos are shrunk to 1600px WebP, the same as the admin page does, and the originals
// are moved to import/_done/. Then check the site with `npm run dev` and push the changes.

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const INBOX = path.join(ROOT, 'import');
const DONE = path.join(INBOX, '_done');
const PRODUCTS = path.join(ROOT, 'src', 'content', 'products');
const CATEGORIES_FILE = path.join(ROOT, 'src', 'data', 'categories.json');
const PHOTO_TYPES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.tif', '.tiff', '.heic', '.heif']);
const IGNORED = new Set(['_done', '_web-staging', 'web-import-report.json', 'urls.txt', 'products.json', 'readme.txt', 'thumbs.db', 'desktop.ini', '.ds_store']);
const MAX_SIZE = 1600;
const dryRun = process.argv.includes('--dry-run');
const asDrafts = process.argv.includes('--draft');

const slugify = (value) =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// Sharp's cache keeps photos open on Windows, which stops them being moved to import/_done afterwards.
sharp.cache(false);

/** Moves a file or folder, retrying briefly while Windows (antivirus, indexing) still has it open. */
async function moveWithRetry(from, to, attempts = 5) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to);
      return true;
    } catch (error) {
      if (attempt >= attempts || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) return false;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
}

const tidy = (value) => value.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
const naturalOrder = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const isPhoto = (name) => PHOTO_TYPES.has(path.extname(name).toLowerCase());
const isIgnored = (name) => name.startsWith('.') || IGNORED.has(name.toLowerCase());

/** "Rolex Submariner £8,500" → { title: "Rolex Submariner", price: 8500 } */
function parseName(name) {
  const match = name.match(/^(.*?)[\s\-–—]*[£$€]\s*(\d[\d,]*(?:\.\d{1,2})?)\s*$/);
  return match ? { title: tidy(match[1]), price: Number(match[2].replace(/,/g, '')) } : { title: tidy(name) };
}

// "Watch" matches "watches", "Hats & Caps" matches "hats-and-caps", and so on.
const matchKeys = (value) => {
  const key = slugify(value).replace(/-/g, '');
  return new Set([key, key.replace(/s$/, ''), key.replace(/es$/, '')]);
};
const sameCategory = (a, b) => [...matchKeys(a)].some((key) => key && matchKeys(b).has(key));

async function main() {
  if (!existsSync(INBOX)) {
    await mkdir(INBOX, { recursive: true });
    console.log('Created the "import" folder. Put photos in it (see scripts/import-products.mjs) and run this again.');
    return;
  }

  const categoryData = JSON.parse(await readFile(CATEGORIES_FILE, 'utf8'));
  const categories = Array.isArray(categoryData.categories) ? categoryData.categories : [];
  const newCategories = [];
  const products = [];

  for (const entry of (await readdir(INBOX, { withFileTypes: true })).sort((a, b) => naturalOrder(a.name, b.name))) {
    if (isIgnored(entry.name)) continue;
    // Review batches contain their own metadata; they are not product/category photo folders.
    if (entry.isDirectory() && existsSync(path.join(INBOX, entry.name, 'progress.json'))) continue;
    if (!entry.isDirectory()) {
      console.warn(`! Skipped "${entry.name}": put photos inside a category folder, e.g. import/watches/`);
      continue;
    }

    let category = categories.find((cat) => sameCategory(entry.name, cat.slug ?? '') || sameCategory(entry.name, cat.name ?? ''));
    if (!category) {
      category = { name: tidy(entry.name), slug: slugify(entry.name) };
      categories.push(category);
      newCategories.push(category.name);
    }

    const categoryDir = path.join(INBOX, entry.name);
    for (const item of (await readdir(categoryDir, { withFileTypes: true })).sort((a, b) => naturalOrder(a.name, b.name))) {
      if (isIgnored(item.name)) continue;
      const source = path.join(categoryDir, item.name);
      if (item.isDirectory()) {
        const files = (await readdir(source, { withFileTypes: true }))
          .filter((file) => file.isFile() && isPhoto(file.name))
          .map((file) => file.name)
          .sort(naturalOrder)
          .map((name) => path.join(source, name));
        if (files.length === 0) {
          console.warn(`! Skipped "${entry.name}/${item.name}": no photos inside`);
          continue;
        }
        products.push({ ...parseName(item.name), category: category.slug, files, source, label: `${entry.name}/${item.name}` });
      } else if (isPhoto(item.name)) {
        const name = path.basename(item.name, path.extname(item.name));
        products.push({ ...parseName(name), category: category.slug, files: [source], source, label: `${entry.name}/${item.name}` });
      }
    }
  }

  if (products.length === 0) {
    console.log('Nothing to import. Put photos in import/<category>/ and run this again.');
    return;
  }

  const batch = new Date().toISOString().replace(/[:.]/g, '-');
  const notMoved = [];
  const now = Date.now();
  let imported = 0;
  let photoCount = 0;

  for (const [index, product] of products.entries()) {
    const priceNote = product.price !== undefined ? ` at ${product.price}` : '';
    if (dryRun) {
      console.log(`• ${product.label} → "${product.title}"${priceNote} in ${product.category} (${product.files.length} photo${product.files.length === 1 ? '' : 's'})`);
      continue;
    }

    const slug = `${slugify(product.title) || 'product'}-${randomBytes(4).toString('hex')}`;
    const folder = path.join(PRODUCTS, slug);
    await mkdir(folder, { recursive: true });

    const images = [];
    for (const file of product.files) {
      const name = `photo-${images.length + 1}.webp`;
      try {
        await sharp(file, { failOn: 'none' })
          .rotate()
          .resize({ width: MAX_SIZE, height: MAX_SIZE, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(path.join(folder, name));
        images.push(name);
      } catch (error) {
        const hint = /\.hei[cf]$/i.test(file) ? ' (HEIC photos: upload through the admin page instead, or export them as JPEG)' : '';
        console.warn(`! Couldn't read "${path.relative(INBOX, file)}"${hint}: ${error.message}`);
      }
    }
    if (images.length === 0) {
      await rm(folder, { recursive: true, force: true });
      console.warn(`! Skipped "${product.label}": none of its photos could be read`);
      continue;
    }

    const lines = [
      '---',
      `title: ${JSON.stringify(product.title)}`,
      'images:',
      ...images.map((name) => `  - ${name}`),
      `category: ${product.category}`,
      ...(product.price !== undefined ? [`price: ${product.price}`] : []),
      'status: available',
      ...(asDrafts ? ['draft: true'] : []),
      `date: ${new Date(now - index * 1000).toISOString()}`,
      '---',
      '',
    ];
    await writeFile(path.join(folder, 'index.md'), lines.join('\n'));

    // Move the originals out of the way so they aren't imported twice.
    const doneFolder = path.join(DONE, batch, path.relative(INBOX, path.dirname(product.source)));
    await mkdir(doneFolder, { recursive: true });
    if (!(await moveWithRetry(product.source, path.join(doneFolder, path.basename(product.source))))) {
      notMoved.push(product.label);
    }

    imported += 1;
    photoCount += images.length;
    console.log(`✓ ${product.title}${priceNote} (${images.length} photo${images.length === 1 ? '' : 's'})`);
  }

  if (!dryRun && newCategories.length > 0) {
    await writeFile(CATEGORIES_FILE, `${JSON.stringify({ ...categoryData, categories }, null, 2)}\n`);
  }
  if (notMoved.length > 0) {
    console.warn(
      `\n! Imported, but couldn't move the originals of: ${notMoved.join(', ')}.\n  Move or delete them from the import folder yourself so they aren't imported twice.`,
    );
  }
  if (newCategories.length > 0) {
    console.log(`\n${dryRun ? 'Would add' : 'Added'} new categor${newCategories.length === 1 ? 'y' : 'ies'}: ${newCategories.join(', ')}`);
  }
  console.log(
    dryRun
      ? `\nDry run: ${products.length} product(s) found. Nothing was changed.`
      : `\nImported ${imported} product(s) with ${photoCount} photo(s). Originals moved to import/_done/.${asDrafts ? '\nThey are drafts: finish them in the editor, then switch Draft off.' : ''}\nNext: check them with "npm run dev", then commit and push.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
