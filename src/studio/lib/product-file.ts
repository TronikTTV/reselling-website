// Reading and writing product files (src/content/products/<folder>/index.md) in the browser.
//
// Values are tidied the same way the site's schema does (src/content.config.ts), so the Studio shows
// what the site shows. When saving, only the fields that changed are touched and everything else in
// the file (unknown fields, comments, quoting) is kept as it was.
import { Document, isScalar, parseDocument } from 'yaml';

export type Status = 'available' | 'reserved' | 'sold';

export interface ProductData {
  title: string;
  /** Photo file names in the product's folder. The first one is the cover. */
  images: string[];
  /** Video file name in the product's folder, or ''. */
  video: string;
  category: string;
  brand: string;
  price: number | null;
  retailPrice: number | null;
  status: Status;
  draft: boolean;
  featured: boolean;
  size: string;
  condition: string;
  authenticity: string;
  styleCode: string;
  colourway: string;
  includes: string[];
  tags: string[];
  /** ISO date, or '' when unknown. */
  date: string;
  /** The description (Markdown). */
  body: string;
}

export type ProductField = keyof ProductData;

/** Front-matter order for new files, matching the classic editor. */
const FIELD_ORDER: Exclude<ProductField, 'body'>[] = [
  'title',
  'images',
  'video',
  'category',
  'brand',
  'price',
  'retailPrice',
  'status',
  'draft',
  'size',
  'condition',
  'authenticity',
  'styleCode',
  'colourway',
  'includes',
  'featured',
  'tags',
  'date',
];

const FRONT_MATTER = /^﻿?---[ \t]*\r?\n([\s\S]*?)(?:\r?\n)?---[ \t]*(?:\r?\n|$)([\s\S]*)$/;

export function splitFile(text: string): { frontMatter: string; body: string } {
  const match = FRONT_MATTER.exec(text);
  if (!match) return { frontMatter: '', body: text };
  return { frontMatter: match[1], body: match[2] };
}

const isBlank = (value: unknown) =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

const text = (value: unknown) => (isBlank(value) ? '' : value instanceof Date ? value.toISOString() : String(value).trim());

function price(value: unknown): number | null {
  if (isBlank(value)) return null;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const digits = String(value).replace(/[^0-9.]/g, '');
  const amount = digits ? Number(digits) : Number.NaN;
  return Number.isFinite(amount) ? amount : null;
}

const flag = (value: unknown) => value === true || ['true', 'yes', '1'].includes(String(value).trim().toLowerCase());

function textList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return list.map((item) => text(item)).filter(Boolean);
}

const fileName = (value: unknown) => text(value).replace(/^\.\//, '');

function isoDate(value: unknown): string {
  if (isBlank(value)) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

/** Tidies raw front-matter values into the shape the Studio edits. */
export function normalise(raw: Record<string, unknown>, body = ''): ProductData {
  const status = text(raw.status).toLowerCase();
  return {
    title: text(raw.title),
    images: (Array.isArray(raw.images) ? raw.images : [raw.images]).map(fileName).filter(Boolean),
    video: fileName(raw.video),
    category: text(raw.category).toLowerCase(),
    brand: text(raw.brand),
    price: price(raw.price),
    retailPrice: price(raw.retailPrice),
    status: status === 'reserved' || status === 'sold' ? status : 'available',
    draft: flag(raw.draft),
    featured: flag(raw.featured),
    size: text(raw.size),
    condition: text(raw.condition),
    authenticity: text(raw.authenticity),
    styleCode: text(raw.styleCode),
    colourway: text(raw.colourway),
    includes: textList(raw.includes),
    tags: textList(raw.tags),
    date: isoDate(raw.date),
    body: body.replace(/^\s*\n/, '').replace(/\s+$/, ''),
  };
}

export function parseProduct(fileText: string): ProductData {
  const { frontMatter, body } = splitFile(fileText);
  let raw: unknown = {};
  try {
    raw = parseDocument(frontMatter).toJS() ?? {};
  } catch {
    raw = {};
  }
  return normalise(raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}, body);
}

/** The value to store for a field, or undefined to leave the field out of the file. */
function stored(field: Exclude<ProductField, 'body'>, value: ProductData[typeof field]): unknown {
  if (field === 'title' || field === 'status') return value;
  if (field === 'draft' || field === 'featured') return value === true ? true : undefined;
  if (field === 'price' || field === 'retailPrice') return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) return value.length > 0 ? [...value] : undefined;
  if (typeof value === 'string') return value.trim() === '' ? undefined : value.trim();
  return value ?? undefined;
}

function assemble(yamlText: string, body: string) {
  const description = body.trim();
  const head = yamlText.endsWith('\n') ? yamlText : `${yamlText}\n`;
  return `---\n${head}---\n${description ? `\n${description}\n` : ''}`;
}

/**
 * Writes a product file. With `original`, only `fields` are changed in it (everything else is kept);
 * without it, a new file is made from all of `data`.
 */
export function writeProduct(original: string | null, data: ProductData, fields?: Iterable<ProductField>): string {
  if (original === null) {
    const doc = new Document({});
    for (const field of FIELD_ORDER) {
      const value = stored(field, data[field]);
      if (value !== undefined) doc.set(field, value);
    }
    return assemble(doc.toString({ lineWidth: 0 }), data.body);
  }

  const { frontMatter, body } = splitFile(original);
  // No front matter to keep: write it all out, keeping the description unless that changed too.
  if (!frontMatter.trim()) {
    const changed = new Set(fields ?? []);
    return writeProduct(null, { ...data, body: changed.has('body') ? data.body : body });
  }
  const doc = parseDocument(frontMatter);
  let newBody = body;
  for (const field of new Set(fields ?? FIELD_ORDER)) {
    if (field === 'body') {
      newBody = data.body;
      continue;
    }
    const value = stored(field, data[field]);
    if (value === undefined) {
      doc.delete(field);
      continue;
    }
    const node = doc.get(field, true);
    // Change the existing value in place, so its quoting style is kept.
    if (isScalar(node) && !Array.isArray(value) && typeof value !== 'object') node.value = value;
    else doc.set(field, value);
  }
  return assemble(doc.toString({ lineWidth: 0 }), newBody);
}

/** A blank product for the "Add product" screen. */
export function emptyProduct(category = ''): ProductData {
  return {
    title: '',
    images: [],
    video: '',
    category,
    brand: '',
    price: null,
    retailPrice: null,
    status: 'available',
    draft: false,
    featured: false,
    size: '',
    condition: '',
    authenticity: '',
    styleCode: '',
    colourway: '',
    includes: [],
    tags: [],
    date: new Date().toISOString(),
    body: '',
  };
}

/** "Nike Dunk Low (Panda) £120" → "nike-dunk-low-panda-120". Same rules as the site. */
export const slugify = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const sameValue = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((item, index) => item === b[index]) : a === b;
