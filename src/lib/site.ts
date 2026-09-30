// Store settings and categories, both editable in the admin Studio (/admin/).
// The raw JSON may have missing or blank keys (the admin page drops empty
// optional fields), so everything is normalised here before use.
import rawSettings from '../data/settings.json';
import rawCategories from '../data/categories.json';
import { categorySlug, orderCategories, slugifyPart } from './category-tree';
import { SITE_TEXT_DEFAULTS } from './copy-fields';

export interface ContactDetails {
  instagram: string;
  tiktok: string;
  snapchat: string;
  whatsapp: string;
  email: string;
}

export interface SiteSettings {
  siteName: string;
  tagline: string;
  heroHeading: string;
  heroAccent: string;
  /** Short phrases for the scrolling ticker on the home page. */
  ticker: string[];
  announcement: string;
  currency: string;
  hideSoldItems: boolean;
  contact: ContactDetails;
}

export interface Category {
  /** Web address after /category/. Sub-categories start with their parent's: "shoes/nike". */
  slug: string;
  name: string;
  description: string;
  /** The parent category's slug, or '' for a top-level category. */
  parent: string;
  /** 0 for top-level categories, 1 for their sub-categories, and so on. */
  depth: number;
}

type Loose = Record<string, unknown> | null | undefined;

const text = (value: unknown, fallback = '') =>
  (value === null || value === undefined ? '' : String(value).trim()) || fallback;

export const slugify = slugifyPart;

const s = rawSettings as Loose;
const c = (s?.contact ?? {}) as Loose;

export const settings: SiteSettings = {
  siteName: text(s?.siteName, SITE_TEXT_DEFAULTS.siteName),
  tagline: text(s?.tagline),
  heroHeading: text(s?.heroHeading, SITE_TEXT_DEFAULTS.heroHeading),
  heroAccent: text(s?.heroAccent, SITE_TEXT_DEFAULTS.heroAccent),
  ticker: (Array.isArray(s?.ticker) ? (s.ticker as unknown[]) : []).map((item) => text(item)).filter(Boolean),
  announcement: text(s?.announcement),
  currency: text(s?.currency, 'GBP').toUpperCase(),
  hideSoldItems: s?.hideSoldItems === true,
  contact: {
    instagram: text(c?.instagram),
    tiktok: text(c?.tiktok),
    snapchat: text(c?.snapchat),
    whatsapp: text(c?.whatsapp),
    email: text(c?.email),
  },
};

/** Products whose category isn't in the list end up here. */
export const OTHER_CATEGORY: Category = { slug: 'other', name: 'Other', description: '', parent: '', depth: 0 };

const categoryList = ((rawCategories as Loose)?.categories ?? []) as Loose[];

/**
 * Categories in the order they were arranged in the admin page, each followed by its sub-categories
 * (see src/lib/category-tree.ts).
 */
export const categories: Category[] = orderCategories(
  categoryList.map((item) => {
    const name = text(item?.name) || text(item?.slug);
    return { slug: categorySlug(text(item?.slug) || name), name, description: text(item?.description) };
  }),
).map(({ slug, name, description, parent, depth }) => ({ slug, name, description: description ?? '', parent, depth }));
