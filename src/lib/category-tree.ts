// Categories can have sub-categories, as deep as needed: Trainers & Shoes › Nike › P-6000.
//
// A sub-category's web address starts with its parent's: "shoes" → "shoes/nike" → "shoes/nike/p-6000"
// (so the page is /category/shoes/nike/p-6000/). That address is also what a product's `category`
// holds, and it's how a sub-category knows its parent: there's no separate "parent" field to get out
// of step. src/data/categories.json lists them all in one list; the order there is the order on the
// site, with each sub-category shown under its parent.
//
// Used by the site (src/lib/site.ts, src/lib/catalog.ts) and the admin Studio, so keep it free of
// imports.

export interface CategoryEntry {
  name: string;
  slug: string;
  description?: string;
}

export interface TreeCategory extends CategoryEntry {
  /** The parent's slug, or '' for a top-level category. */
  parent: string;
  /** 0 for top-level categories, 1 for their sub-categories, and so on. */
  depth: number;
}

/** "Hats & Caps" → "hats-and-caps". */
export const slugifyPart = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Tidies a category address, keeping the "/" between levels: " Shoes/Nike " → "shoes/nike". */
export const categorySlug = (value: string) =>
  String(value ?? '')
    .split('/')
    .map(slugifyPart)
    .filter(Boolean)
    .join('/');

/** Letters, numbers and dashes, with "/" between levels. */
export const CATEGORY_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*$/;

export const parentOf = (slug: string) => slug.split('/').slice(0, -1).join('/');

export const depthOf = (slug: string) => (slug ? slug.split('/').length - 1 : 0);

/** The last part of the address: "shoes/nike" → "nike". */
export const ownPart = (slug: string) => slug.split('/').pop() ?? slug;

/** Whether `slug` is `ancestor` or somewhere inside it ("shoes/nike" is within "shoes"). */
export const isWithin = (slug: string, ancestor: string) => Boolean(ancestor) && (slug === ancestor || slug.startsWith(`${ancestor}/`));

/** The categories above one, top first: "shoes/nike/p-6000" → ["shoes", "shoes/nike"]. */
export function ancestorsOf(slug: string): string[] {
  const parts = slug.split('/');
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
}

/**
 * The deepest category in `known` that a product's category is in: "shoes/nike/p-6000" when that
 * exists, else "shoes/nike", else "shoes". '' when none of them exist.
 */
export function resolveCategory(slug: string, known: { has(slug: string): boolean }): string {
  for (let current = categorySlug(slug); current; current = parentOf(current)) if (known.has(current)) return current;
  return '';
}

/** A readable name for a missing level: "new-balance" → "New Balance". */
export const nameFromPart = (part: string) => part.replace(/-/g, ' ').replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

/**
 * Puts categories in the order the site shows them: each one followed by its sub-categories, in the
 * order they're listed. Repeats are dropped, and a missing level (a "shoes/nike" with no "shoes") is
 * filled in so nothing ends up orphaned.
 */
export function orderCategories<T extends CategoryEntry>(list: T[], fill: (slug: string) => T = (slug) => ({ name: nameFromPart(ownPart(slug)), slug }) as T): (T & TreeCategory)[] {
  const bySlug = new Map<string, T>();
  for (const item of list) {
    if (!item.slug || bySlug.has(item.slug)) continue;
    for (const ancestor of ancestorsOf(item.slug)) if (!bySlug.has(ancestor)) bySlug.set(ancestor, fill(ancestor));
    bySlug.set(item.slug, item);
  }
  const children = new Map<string, T[]>();
  for (const item of bySlug.values()) {
    const parent = parentOf(item.slug);
    children.set(parent, [...(children.get(parent) ?? []), item]);
  }
  const ordered: (T & TreeCategory)[] = [];
  const walk = (parent: string) => {
    for (const item of children.get(parent) ?? []) {
      ordered.push({ ...item, parent, depth: depthOf(item.slug) });
      walk(item.slug);
    }
  };
  walk('');
  return ordered;
}

/** The category and the ones above it, top first. Unknown levels are skipped. */
export function trailOf<T extends CategoryEntry>(slug: string, bySlug: Map<string, T>): T[] {
  return [...ancestorsOf(slug), slug].map((item) => bySlug.get(item)).filter((item): item is T => Boolean(item));
}

/** "Trainers & Shoes › Nike › P-6000". */
export function labelOf(slug: string, bySlug: Map<string, CategoryEntry>, separator = ' › '): string {
  return trailOf(slug, bySlug)
    .map((item) => item.name)
    .join(separator);
}

/**
 * Adds a category to a list (in categories.json order) just after its parent's last sub-category,
 * so it shows in the right place. Its missing parents must be added first.
 */
export function insertCategory<T extends CategoryEntry>(list: T[], item: T): T[] {
  if (list.some((existing) => existing.slug === item.slug)) return list;
  const parent = parentOf(item.slug);
  // After the parent's last sub-category (or the parent itself); top-level ones go at the end.
  let at = list.length;
  if (parent) {
    let last = -1;
    list.forEach((existing, index) => {
      if (isWithin(existing.slug, parent)) last = index;
    });
    if (last >= 0) at = last + 1;
  }
  return [...list.slice(0, at), item, ...list.slice(at)];
}

/**
 * Moves a category (and everything in it) to a new address: "shoes/nike" → "shoes/nike-sb" also
 * moves "shoes/nike/p-6000" to "shoes/nike-sb/p-6000". Returns the new address for any old one.
 */
export function moveAddress(slug: string, from: string, to: string): string {
  return isWithin(slug, from) ? `${to}${slug.slice(from.length)}` : slug;
}
