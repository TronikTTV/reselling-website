// Selectors verified against public Husky and Luxury Brand pages in September 2026.
import { parse } from 'parse5';

const attr = (node, name) => node?.attrs?.find((entry) => entry.name === name)?.value ?? '';
const hasClass = (node, name) => attr(node, 'class').split(/\s+/).includes(name);
const text = (node) => node?.nodeName === '#text' ? node.value : (node?.childNodes ?? []).map(text).join('');
const cleanText = (node) => text(node).replace(/\s+/g, ' ').trim();
const insideProductCard = (node) => {
  for (let parent = node.parentNode; parent; parent = parent.parentNode) if (hasClass(parent, 'product-grid-item')) return true;
  return false;
};
function find(root, predicate) {
  const matches = [];
  const visit = (node) => {
    if (predicate(node)) matches.push(node);
    // Script, style and noscript contents are not catalogue links or product photos.
    if (['script', 'style', 'noscript'].includes(node.tagName)) return;
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(root);
  return matches;
}

export const CATEGORY_MAP = {
  'perfume-cologne': 'fragrances', accessories: 'accessories', apple: 'electronics',
  clothes: 'clothing', bag: 'bags', shoes: 'shoes', watch: 'watches',
};

export function supplierOf(address) {
  const host = new URL(address).hostname;
  if (host === 'huskyreps.x.yupoo.com') return 'husky';
  if (host === 'luxurybrand.top') return 'luxury';
  throw new Error('Supported suppliers: huskyreps.x.yupoo.com and luxurybrand.top.');
}

export function canonicalProduct(address) {
  const url = new URL(address);
  const supplier = supplierOf(url.href);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Use the public HTTPS supplier address.');
  url.search = '';
  url.hash = '';
  // Husky's public album links require uid=1; dropping it returns 404 on this supplier.
  url.pathname = url.pathname.replace(/\/+$/, '') + (supplier === 'husky' ? '' : '/');
  if (supplier === 'husky') url.searchParams.set('uid', '1');
  return url.href;
}

export function isProduct(address) {
  const url = new URL(address);
  return supplierOf(address) === 'husky' ? /^\/albums\/\d+\/?$/.test(url.pathname) : /^\/product\/[^/]+\/?$/.test(url.pathname);
}

function safeLink(value, base, sameHost = true) {
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || (sameHost && url.hostname !== new URL(base).hostname)) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function imageLink(value, base) {
  const url = safeLink(value, base, false);
  if (!url) return null;
  const host = new URL(url).hostname;
  return host === 'photo.yupoo.com' || host === 'luxurybrand.top' ? url : null;
}

export function guessHuskyCategory(title) {
  const rules = [
    ['socks', /\bSOCKS?\b/i], ['hats', /\b(CAP|HAT|BEANIE|HEADGEAR)\b/i],
    ['shoes', /\b(SHOES?|SNEAKERS?|SLIPPERS?|TRAINERS?|BOOTS?)\b/i],
    ['bags', /\b(BAG|BACKPACK|FREITAG|HANDBAG)\b/i], ['glasses', /\b(SUNGLASSES|GLASSES)\b/i],
    ['watches', /\bWATCH\b/i], ['accessories', /\b(GLOVE|WALLET|BELT|CUTLERY)\b/i],
  ];
  return rules.find(([, pattern]) => pattern.test(title))?.[0] ?? 'clothing';
}

export function catalogueLinks(html, address) {
  const supplier = supplierOf(address);
  const root = parse(html);
  const links = find(root, (node) => node.tagName === 'a');
  const products = new Map();
  const skipped = [];
  const categories = new Map();
  let next;
  for (const link of links) {
    const href = attr(link, 'href');
    if (!href) continue;
    const resolved = safeLink(href, address);
    if (!resolved) continue;
    const url = new URL(resolved);
    if (supplier === 'husky' && hasClass(link, 'album__main') && isProduct(resolved)) {
      const titleNode = find(link, (node) => hasClass(node, 'album__title'))[0];
      const title = cleanText(titleNode) || attr(link, 'title');
      const count = Number(cleanText(find(link, (node) => hasClass(node, 'album__photonumber'))[0]));
      if (/\b(discord|whatsapp|how to|new yupoo|brand|hot selling item)\b/i.test(title) || (count <= 2 && !/[￥¥£$€]\s*[\d~]/.test(title))) {
        skipped.push({ source: canonicalProduct(resolved), reason: 'Likely information/category album; review manually.', title });
        continue;
      }
      products.set(canonicalProduct(resolved), { url: canonicalProduct(resolved), category: guessHuskyCategory(title) });
    }
    if (supplier === 'luxury' && isProduct(resolved) && insideProductCard(link)) products.set(canonicalProduct(resolved), { url: canonicalProduct(resolved) });
    if (supplier === 'luxury') {
      const category = url.pathname.match(/^\/product-category\/([^/]+)\/?$/)?.[1];
      if (category && CATEGORY_MAP[category]) categories.set(resolved, { url: resolved, category: CATEGORY_MAP[category] });
    }
    const isNext = supplier === 'husky' ? attr(link, 'title').toLowerCase() === 'next page' : attr(link, 'rel').split(/\s+/).includes('next') || (hasClass(link, 'next') && hasClass(link, 'page-numbers'));
    if (isNext && !hasClass(link, 'pagination__disabled')) {
      const currentPath = new URL(address).pathname;
      const scope = supplier === 'husky' ? currentPath.startsWith('/categories/') ? currentPath : '/albums/' : currentPath.replace(/page\/\d+\/?$/, '');
      if (url.pathname.startsWith(scope) && resolved !== address) next = resolved;
    }
  }
  return { products: [...products.values()], categories: [...categories.values()], next, skipped };
}

export function supplierProduct(html, address, { photos = 4, category } = {}) {
  if (!Number.isInteger(photos) || photos < 1 || photos > 10) throw new Error('Choose 1–10 photos per listing.');
  if (!isProduct(address)) throw new Error('This is a catalogue page, not a product page.');
  const supplier = supplierOf(address);
  const root = parse(html);
  const notes = ['Review title, category, variants, stock status and selected photos before importing.'];
  let title, images, total, variants = [];
  if (supplier === 'husky') {
    const heading = find(root, (node) => hasClass(node, 'showalbumheader__gallerytitle'))[0];
    title = attr(heading, 'data-name') || cleanText(heading);
    images = find(root, (node) => node.tagName === 'img' && hasClass(node, 'image__img') && attr(node, 'data-type') === 'photo')
      .map((node) => imageLink(attr(node, 'data-src') || attr(node, 'data-origin-src'), address)).filter(Boolean);
    category ||= guessHuskyCategory(title);
    notes.push('Husky titles may combine multiple items and supplier prices; edit the title and choose the exact item to offer.');
  } else {
    title = cleanText(find(root, (node) => node.tagName === 'h1' && hasClass(node, 'product_title'))[0]);
    const gallery = find(root, (node) => hasClass(node, 'woocommerce-product-gallery'))[0];
    images = find(gallery ?? {}, (node) => node.tagName === 'img').map((node) => imageLink(attr(node, 'data-large_image') || attr(node, 'data-src') || attr(node, 'src'), address)).filter(Boolean);
    const posted = find(root, (node) => hasClass(node, 'posted_in'))[0] ?? find(root, (node) => hasClass(node, 'woocommerce-breadcrumb'))[0];
    for (const link of find(posted ?? {}, (node) => node.tagName === 'a')) {
      const path = safeLink(attr(link, 'href'), address);
      const slug = path && new URL(path).pathname.match(/^\/product-category\/([^/]+)/)?.[1];
      category ||= CATEGORY_MAP[slug];
    }
    const form = find(root, (node) => node.tagName === 'form' && hasClass(node, 'variations_form'))[0];
    variants = find(form ?? {}, (node) => node.tagName === 'select').map((select) => ({
      name: attr(select, 'name'),
      values: find(select, (node) => node.tagName === 'option' && attr(node, 'value')).map(cleanText),
    }));
    if (variants.length) notes.push('This page has variants. The batch contains one parent listing; choose variants and corresponding photos yourself.');
    notes.push('Supplier prices/currency are intentionally omitted; no conversion or selling-price assumption is made.');
  }
  images = [...new Set(images)];
  total = images.length;
  if (!title || !total) throw new Error('Product title/photos not found. The page may be protected or its layout may have changed.');
  if (!category) throw new Error('Could not map the category. Supply --category with a store category.');
  if (total > photos) notes.push(`Selected the first ${photos} of ${total} photos; these may include size charts or different variants.`);
  return { source: canonicalProduct(address), title, category, images: images.slice(0, photos), status: 'available', review: { supplier, availablePhotos: total, variants, notes } };
}
