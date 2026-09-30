import { getCollection, type CollectionEntry } from 'astro:content';
import { isWithin, resolveCategory, trailOf } from './category-tree';
import { categories, OTHER_CATEGORY, settings, type Category } from './site';

export type Product = CollectionEntry<'products'>;

export interface CategorySummary {
  category: Category;
  /** How many listed products are in this category, counting its sub-categories. */
  count: number;
  /** Product whose first photo represents the category (newest unsold one). */
  cover?: Product;
}

const categoryBySlug = new Map(categories.map((category) => [category.slug, category]));

/**
 * The category a product belongs to: its sub-category when it has one ("shoes/nike/p-6000"). A
 * sub-category that isn't in the list falls back to the nearest one above it that is; anything else
 * becomes "Other".
 */
export const categoryOf = (product: Product): Category =>
  categoryBySlug.get(resolveCategory(product.data.category, categoryBySlug)) ?? OTHER_CATEGORY;

/** A category and the ones above it, top first: Trainers & Shoes › Nike › P-6000. */
export const categoryTrail = (category: Category): Category[] => (category === OTHER_CATEGORY ? [category] : trailOf(category.slug, categoryBySlug));

/** A category's own sub-categories, in order. */
export const subcategoriesOf = (category: Category): Category[] => categories.filter((item) => item.parent === category.slug);

/** Whether a product is in a category or any of its sub-categories. */
export const isInCategory = (product: Product, category: Category) => isWithin(categoryOf(product).slug, category.slug);

const newestFirst = (a: Product, b: Product) =>
  (b.data.date?.getTime() ?? 0) - (a.data.date?.getTime() ?? 0) || a.data.title.localeCompare(b.data.title);

// Every page asks for the product list (the header shows category counts), so
// during a build the results are worked out once and reused. In `npm run dev`
// they're recalculated each time so edits show up straight away.
const cached = <T>(load: () => Promise<T>) => {
  let result: Promise<T> | undefined;
  return () => (import.meta.env.DEV ? load() : (result ??= load()));
};

/** Every product in the folder, drafts included, newest first. Only the owner dashboard should need this. */
export const getEveryProduct = cached(async () => (await getCollection('products')).sort(newestFirst));

/**
 * Every published product, newest first, including sold ones (their pages stay up so shared links
 * keep working). Drafts are left out, so they get no page and appear nowhere on the site.
 */
export const getAllProducts = cached(async () => (await getEveryProduct()).filter((product) => !product.data.draft));

/** Products saved as drafts in the admin page. */
export const getDraftProducts = cached(async () => (await getEveryProduct()).filter((product) => product.data.draft));

/** Products that appear in listings: everything, minus sold items when "Hide sold items" is switched on. */
export const getListedProducts = cached(async () => {
  const all = await getAllProducts();
  return settings.hideSoldItems ? all.filter((product) => product.data.status !== 'sold') : all;
});

/**
 * Every category (sub-categories straight after their parent) in the order set in the admin page, with
 * product counts that include sub-categories. "Other" is only added when needed. For just the top level,
 * filter on `category.depth === 0`.
 */
export const getCategorySummaries = cached(async (): Promise<CategorySummary[]> => {
  const listed = await getListedProducts();
  const list = [...categories];
  if (listed.some((product) => categoryOf(product) === OTHER_CATEGORY) && !categoryBySlug.has(OTHER_CATEGORY.slug)) list.push(OTHER_CATEGORY);

  return list.map((category) => {
    const products = listed.filter((product) => isWithin(categoryOf(product).slug, category.slug));
    const withPhotos = products.filter((product) => product.data.images.length > 0);
    return {
      category,
      count: products.length,
      cover: withPhotos.find((product) => product.data.status !== 'sold') ?? withPhotos[0],
    };
  });
});
