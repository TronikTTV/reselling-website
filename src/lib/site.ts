// Store settings and categories, both editable from the admin page (/admin/ → Settings).
// The raw JSON may have missing or blank keys (the admin page drops empty
// optional fields), so everything is normalised here before use.
import rawSettings from '../data/settings.json';
import rawCategories from '../data/categories.json';

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
  slug: string;
  name: string;
  description: string;
}

type Loose = Record<string, unknown> | null | undefined;

const text = (value: unknown, fallback = '') =>
  (value === null || value === undefined ? '' : String(value).trim()) || fallback;

export const slugify = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const s = rawSettings as Loose;
const c = (s?.contact ?? {}) as Loose;

export const settings: SiteSettings = {
  siteName: text(s?.siteName, 'My Store'),
  tagline: text(s?.tagline),
  heroHeading: text(s?.heroHeading, 'Rare finds.'),
  heroAccent: text(s?.heroAccent, 'Real ones only.'),
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
export const OTHER_CATEGORY: Category = { slug: 'other', name: 'Other', description: '' };

const categoryList = ((rawCategories as Loose)?.categories ?? []) as Loose[];

/** Categories in the order they were arranged in the admin page. */
export const categories: Category[] = categoryList
  .map((item) => {
    const name = text(item?.name) || text(item?.slug);
    return { slug: slugify(text(item?.slug) || name), name, description: text(item?.description) };
  })
  .filter((cat, index, all) => cat.slug && all.findIndex((other) => other.slug === cat.slug) === index);
