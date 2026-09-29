// Reading product folders for "Add from folders": each folder holds one product's photos and a text
// file with its details. Nothing here touches the page, so it can be tested on its own.
//
// The text file can use labels, in any order (only Name is really needed):
//
//   Name: Nike Dunk Low Retro Panda
//   Price: 120
//   Colourway: White/Black
//   Code: DD1391-100
//   Size: UK 9
//   Bio: Brand new in the box.
//
// or just lines in this order: name, price, colourway, code, then the bio.

export interface FolderEntry {
  /** Path inside the chosen folder, e.g. "Stock/Nike Dunk Low Panda/1.jpg". */
  path: string;
  file: File;
}

export interface ProductDetails {
  name: string;
  price: number | null;
  colourway: string;
  code: string;
  bio: string;
  size: string;
  brand: string;
  condition: string;
  /** As written in the text file (matched to a store category later). */
  category: string;
}

export interface ProductFolder {
  /** Folder path, e.g. "Stock/Trainers/Nike Dunk Low Panda". */
  path: string;
  /** The folder's own name. */
  name: string;
  /** The folder it sits in (a category hint), or "". */
  parent: string;
  photos: FolderEntry[];
  text?: FolderEntry;
}

const PHOTO = /\.(jpe?g|png|webp|gif|avif|hei[cf])$/i;
const TEXT = /\.txt$/i;
const JUNK = /(^|\/)(\.|__macosx\/|thumbs\.db$|desktop\.ini$)/i;

export const isPhoto = (name: string) => PHOTO.test(name);

/** "photo 2" before "photo 10". */
export const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** Groups files by the folder they're in: every folder with photos is one product. */
export function groupFolders(entries: FolderEntry[]): ProductFolder[] {
  const folders = new Map<string, ProductFolder>();
  for (const entry of entries) {
    const path = entry.path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (JUNK.test(path)) continue;
    const slash = path.lastIndexOf('/');
    const dir = slash < 0 ? '' : path.slice(0, slash);
    const file = path.slice(slash + 1);
    if (!PHOTO.test(file) && !TEXT.test(file)) continue;
    let folder = folders.get(dir);
    if (!folder) {
      const parts = dir.split('/').filter(Boolean);
      folder = { path: dir, name: parts[parts.length - 1] ?? '', parent: parts[parts.length - 2] ?? '', photos: [] };
      folders.set(dir, folder);
    }
    if (PHOTO.test(file)) folder.photos.push({ path, file: entry.file });
    else if (!folder.text || /^(details|info|product|listing)\b/i.test(file)) folder.text = { path, file: entry.file };
  }
  const list = [...folders.values()].filter((folder) => folder.photos.length > 0);
  for (const folder of list) {
    // A photo called "cover" (or the first by name) is the cover.
    folder.photos.sort((a, b) => {
      const cover = (entry: FolderEntry) => (/(^|\/)cover\./i.test(entry.path) ? 0 : 1);
      return cover(a) - cover(b) || naturalCompare(a.path, b.path);
    });
  }
  return list.sort((a, b) => naturalCompare(a.path, b.path));
}

// ---------------------------------------------------------------- the text file

const LABELS: [RegExp, keyof ProductDetails][] = [
  [/^(name|title|product|item)$/, 'name'],
  [/^(price|cost|selling price|sale price)$/, 'price'],
  [/^(colou?rway|colou?rs?|cw)$/, 'colourway'],
  [/^(code|style ?code|style|sku|product code|style no\.?|article)$/, 'code'],
  [/^(bio|description|desc|about|details|notes?)$/, 'bio'],
  [/^(size|sizes|uk size|eu size|us size)$/, 'size'],
  [/^(brand|make)$/, 'brand'],
  [/^(condition|state)$/, 'condition'],
  [/^(category|type|section)$/, 'category'],
];

const labelOf = (text: string) => {
  const key = text.toLowerCase().replace(/[^a-z .]/g, '').replace(/\s+/g, ' ').trim();
  return LABELS.find(([pattern]) => pattern.test(key))?.[1];
};

/** "£1,200", "120.00", "120 GBP" → 1200 / 120. */
export function parsePrice(value: string): number | null {
  const match = /(\d[\d,]*(?:\.\d{1,2})?)/.exec(value.replace(/\s/g, ''));
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

const PRICE_LINE = /^(price\s*)?[£$€]?\s*\d[\d,]*(\.\d{1,2})?\s*(gbp|£|pounds?)?$/i;
// Style codes like DD1391-100, 555088-134, IE0421, B75806 (letters and numbers, at least one digit).
const CODE_LINE = /^(?=[A-Z0-9-]*\d)[A-Z0-9]{2,}(?:[- ][A-Z0-9]{2,}){0,2}$/;
const COLOURS = /\b(black|white|red|blue|navy|green|olive|grey|gray|brown|tan|beige|cream|sail|pink|purple|orange|yellow|gold|silver|panda|bone|khaki|burgundy|multi)\b/i;

/** Reads a product's text file (labelled lines, or lines in order: name, price, colourway, code, bio). */
export function parseDetails(text: string): ProductDetails {
  const details: ProductDetails = { name: '', price: null, colourway: '', code: '', bio: '', size: '', brand: '', condition: '', category: '' };
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const bio: string[] = [];
  let labelled = false;
  let inBio = false;

  for (const raw of lines) {
    const line = raw.trim();
    const match = /^([A-Za-z][A-Za-z .]{0,24}?)\s*[:=]\s*(.*)$/.exec(line);
    const field = match ? labelOf(match[1]) : undefined;
    if (field) {
      labelled = true;
      inBio = field === 'bio';
      const value = match![2].trim();
      if (field === 'price') details.price = parsePrice(value);
      else if (field === 'bio') {
        if (value) bio.push(value);
      } else details[field] = value;
      continue;
    }
    if (labelled) {
      // Unlabelled lines after the labels belong to the bio (blank lines keep paragraphs apart).
      if (inBio || line) bio.push(line);
    }
  }

  if (!labelled) {
    const rest = lines.map((line) => line.trim());
    while (rest.length && !rest[0]) rest.shift();
    details.name = rest.shift() ?? '';
    let bioStarted = false;
    for (const line of rest) {
      if (!bioStarted) {
        if (!line) continue;
        if (details.price === null && PRICE_LINE.test(line)) {
          details.price = parsePrice(line);
          continue;
        }
        if (!details.code && line.length <= 20 && CODE_LINE.test(line)) {
          details.code = line;
          continue;
        }
        if (!details.colourway && line.length <= 40 && (line.includes('/') || COLOURS.test(line)) && !/[.!?]$/.test(line)) {
          details.colourway = line;
          continue;
        }
        bioStarted = true;
      }
      bio.push(line);
    }
  }

  details.bio = bio.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  details.name = details.name.replace(/\s+/g, ' ').trim();
  return details;
}

/** "Nike Dunk Low Panda £120" (a folder name) → name and price. */
export function fromFolderName(folder: string): { name: string; price: number | null } {
  const match = /^(.*?)[\s_-]*[£$€]\s*(\d[\d,]*(?:\.\d{1,2})?)\s*$/.exec(folder.trim());
  if (!match) return { name: folder.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim(), price: null };
  return { name: match[1].replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim(), price: parsePrice(match[2]) };
}

// ---------------------------------------------------------------- matching to the store

const SYNONYMS: Record<string, string[]> = {
  shoes: ['trainers', 'trainer', 'sneakers', 'sneaker', 'shoes', 'shoe', 'footwear', 'kicks', 'boots', 'slides'],
  clothing: ['clothing', 'clothes', 'apparel', 'streetwear', 'hoodies', 'hoodie', 'tees', 't-shirts', 'tshirts', 'jackets', 'coats', 'tracksuits', 'jumpers', 'sweatshirts', 'trousers', 'jeans', 'shorts', 'tops'],
  hats: ['hats', 'hat', 'caps', 'cap', 'beanies', 'headwear'],
  watches: ['watches', 'watch'],
  glasses: ['glasses', 'sunglasses', 'eyewear', 'shades'],
  bags: ['bags', 'bag', 'backpacks', 'backpack', 'totes'],
  accessories: ['accessories', 'belts', 'wallets', 'scarves', 'gloves'],
  jewellery: ['jewellery', 'jewelry', 'chains', 'rings', 'bracelets', 'necklaces'],
  electronics: ['electronics', 'tech', 'gadgets', 'consoles', 'headphones'],
  fragrances: ['fragrances', 'fragrance', 'perfume', 'perfumes', 'cologne', 'colognes', 'aftershave'],
  socks: ['socks', 'sock'],
};

const slug = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** A store category for words like "Trainers" or "hoodies", or "" when nothing fits. */
export function matchCategory(hint: string, categories: { slug: string; name: string }[]): string {
  const wanted = slug(hint);
  if (!wanted) return '';
  const direct = categories.find((category) => category.slug === wanted || slug(category.name) === wanted);
  if (direct) return direct.slug;
  for (const [target, words] of Object.entries(SYNONYMS)) {
    if (words.includes(wanted) && categories.some((category) => category.slug === target)) return target;
  }
  const loose = categories.find((category) => slug(category.name).split('-').includes(wanted) || wanted.split('-').includes(category.slug));
  return loose?.slug ?? '';
}

const BRANDS = [
  'Air Jordan', 'Jordan', 'Nike', 'adidas', 'Yeezy', 'New Balance', 'ASICS', 'Puma', 'Reebok', 'Converse', 'Vans', 'Salomon', 'Hoka',
  'Crocs', 'UGG', 'Timberland', 'Dr. Martens', 'Stone Island', 'C.P. Company', 'Moncler', 'Canada Goose', 'The North Face',
  "Arc'teryx", 'Ralph Lauren', 'Polo Ralph Lauren', 'Lacoste', 'Carhartt', 'Stüssy', 'Stussy', 'Supreme', 'Palace', 'Corteiz',
  'Trapstar', 'Essentials', 'Fear of God', 'Off-White', 'Balenciaga', 'Gucci', 'Louis Vuitton', 'Prada', 'Dior', 'Burberry',
  'Versace', 'Amiri', 'Represent', 'Hellstar', 'Sp5der', 'Broken Planet', 'Chrome Hearts', 'BAPE', 'A Bathing Ape', 'Kith',
  'Rhude', 'Gallery Dept', 'Casio', 'G-Shock', 'Seiko', 'Rolex', 'Omega', 'Tag Heuer', 'Apple', 'Sony', 'Nintendo', 'Samsung',
  'Beats', 'Bose', 'Dyson', 'Ray-Ban', 'Oakley', 'Nike SB', 'Syna World', 'Denim Tears', 'Aape', 'Nocta',
];

/** "Nike Dunk Low Panda" → "Nike" (only well-known brands at the start of the name). */
export function guessBrand(name: string): string {
  const lower = name.toLowerCase();
  const found = BRANDS.filter((brand) => lower === brand.toLowerCase() || lower.startsWith(`${brand.toLowerCase()} `)).sort((a, b) => b.length - a.length)[0];
  if (!found) return '';
  return CANONICAL[found] ?? found;
}

const CANONICAL: Record<string, string> = {
  'Air Jordan': 'Jordan',
  Stussy: 'Stüssy',
  'Nike SB': 'Nike',
  'Polo Ralph Lauren': 'Ralph Lauren',
  'A Bathing Ape': 'BAPE',
  'G-Shock': 'Casio',
};
