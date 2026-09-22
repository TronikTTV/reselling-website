import { getCollection, type CollectionEntry } from 'astro:content';
import { categories, OTHER_CATEGORY, settings, type Category } from './site';

export type Product = CollectionEntry<'products'>;

export interface CategorySummary {
  category: Category;
  /** How many listed products are in this category. */
  count: number;
  /** Product whose first photo represents the category (newest unsold one). */
  cover?: Product;
}

const categoryBySlug = new Map(categories.map((category) => [category.slug, category]));

/** The category a product belongs to. Unknown or missing categories become "Other". */
export const categoryOf = (product: Product): Category =>
  categoryBySlug.get(product.data.category) ?? OTHER_CATEGORY;

const newestFirst = (a: Product, b: Product) =>
  (b.data.date?.getTime() ?? 0) - (a.data.date?.getTime() ?? 0) || a.data.title.localeCompare(b.data.title);

// Every page asks for the product list (the header shows category counts), so
// during a build the results are worked out once and reused. In `npm run dev`
// they're recalculated each time so edits show up straight away.
const cached = <T>(load: () => Promise<T>) => {
  let result: Promise<T> | undefined;
  return () => (import.meta.env.DEV ? load() : (result ??= load()));
};

/** Every product, newest first, including sold ones (their pages stay up so shared links keep working). */
export const getAllProducts = cached(async () => (await getCollection('products')).sort(newestFirst));

/** Products that appear in listings: everything, minus sold items when "Hide sold items" is switched on. */
export const getListedProducts = cached(async () => {
  const all = await getAllProducts();
  return settings.hideSoldItems ? all.filter((product) => product.data.status !== 'sold') : all;
});

/** Categories in the order set in the admin page, with product counts. "Other" is only added when needed. */
export const getCategorySummaries = cached(async (): Promise<CategorySummary[]> => {
  const bySlug = new Map<string, Product[]>();
  for (const product of await getListedProducts()) {
    const slug = categoryOf(product).slug;
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), product]);
  }

  const list = [...categories];
  if (bySlug.has(OTHER_CATEGORY.slug) && !categoryBySlug.has(OTHER_CATEGORY.slug)) list.push(OTHER_CATEGORY);

  return list.map((category) => {
    const products = bySlug.get(category.slug) ?? [];
    const withPhotos = products.filter((product) => product.data.images.length > 0);
    return {
      category,
      count: products.length,
      cover: withPhotos.find((product) => product.data.status !== 'sold') ?? withPhotos[0],
    };
  });
});
