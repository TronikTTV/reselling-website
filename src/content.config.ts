import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Each product is a folder: src/content/products/<product-slug>/index.md,
// with its photos saved next to it. The admin page (/admin/) and the bulk
// importer (npm run import) both create products in this format.
//
// The schema is deliberately forgiving (blank values, "£120" as a price, a
// number where text was expected…) so one sloppy product never stops the
// whole site from building.

const isBlank = (value: unknown) =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

const optionalText = z.preprocess(
  (value) => (isBlank(value) ? undefined : String(value).trim()),
  z.string().optional(),
);

const optionalPrice = z.preprocess((value) => {
  if (isBlank(value)) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined;
  const digits = String(value).replace(/[^0-9.]/g, '');
  const amount = digits ? Number(digits) : Number.NaN;
  return Number.isFinite(amount) ? amount : undefined;
}, z.number().optional());

const flag = z.preprocess(
  (value) => value === true || ['true', 'yes', '1'].includes(String(value).trim().toLowerCase()),
  z.boolean(),
);

// A list of short texts. Also accepts "a, b, c" or a single value.
const textList = z.preprocess((value) => {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return list.map((item) => (isBlank(item) ? '' : String(item).trim())).filter(Boolean);
}, z.array(z.string()));

const products = defineCollection({
  loader: glob({ pattern: '**/index.md', base: './src/content/products' }),
  schema: ({ image }) =>
    z.object({
      title: z.preprocess((value) => (isBlank(value) ? undefined : String(value).trim()), z.string()),
      // Slug of a category from src/data/categories.json; sub-categories look like "shoes/nike/p-6000"
      // (see src/lib/category-tree.ts). Unknown ones show under the nearest category above, or "Other".
      category: z.preprocess(
        (value) => (isBlank(value) ? 'other' : String(value).trim().toLowerCase()),
        z.string(),
      ),
      brand: optionalText,
      price: optionalPrice,
      retailPrice: optionalPrice,
      status: z.preprocess(
        (value) => (isBlank(value) ? 'available' : String(value).trim().toLowerCase()),
        z.enum(['available', 'reserved', 'sold']).catch('available'),
      ),
      size: optionalText,
      condition: optionalText,
      featured: flag,
      // Drafts are kept off the site entirely (no page, not in listings) until switched off.
      draft: flag,
      // Sneaker / StockX details, all optional.
      styleCode: optionalText,
      colourway: optionalText,
      includes: textList,
      // Where it was bought: a key from AUTHENTICITY_LABELS in src/lib/format.ts, or free text.
      authenticity: optionalText,
      tags: textList,
      date: z.preprocess((value) => {
        if (isBlank(value)) return undefined;
        const date = value instanceof Date ? value : new Date(String(value));
        return Number.isNaN(date.getTime()) ? undefined : date;
      }, z.date().optional()),
      // Optional short video (file name in the product's folder). Featured products with one
      // play as an ad at the top of the home page; see src/lib/videos.ts.
      video: optionalText,
      // Photo file names relative to the product's folder. The first one is the cover.
      images: z.preprocess((value) => {
        const list = Array.isArray(value) ? value : [value];
        return list.filter((item) => typeof item === 'string' && item.trim() !== '');
      }, z.array(image())),
    }),
});

export const collections = { products };
