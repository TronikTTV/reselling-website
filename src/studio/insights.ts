// Numbers and checks about the stock, shared by the Overview and Products pages.
import type { Product, Store } from './store.ts';

/** What an unsold listing is missing, most important first. */
export function missing(product: Product): string[] {
  const { data } = product;
  if (data.status === 'sold') return [];
  return [
    data.images.length === 0 && 'No photos',
    data.price === null && 'No price',
    !data.size && 'No size',
    !data.brand && 'No brand',
  ].filter((item): item is string => Boolean(item));
}

/** Listed (not draft) products. */
export const listed = (store: Store) => store.productList().filter((product) => !product.data.draft);

/**
 * The products in the ad reel at the top of the home page, in order: featured ones with a video, then
 * featured ones without, topped up with the newest so there are at least 3. (Same rules as
 * src/pages/index.astro.)
 */
export function reel(store: Store): Product[] {
  const inStock = listed(store).filter((product) => product.data.status !== 'sold' && product.data.images.length > 0);
  const featured = inStock.filter((product) => product.data.featured);
  const ordered = [...featured.filter((product) => product.data.video), ...featured.filter((product) => !product.data.video)];
  return [...ordered, ...inStock.filter((product) => !product.data.featured)].slice(0, Math.max(3, Math.min(featured.length, 6)));
}

export function stats(store: Store) {
  const all = store.productList();
  const live = all.filter((product) => !product.data.draft);
  const by = (status: string) => live.filter((product) => product.data.status === status);
  const sum = (list: Product[]) => list.reduce((total, product) => total + (product.data.price ?? 0), 0);
  const unsold = live.filter((product) => product.data.status !== 'sold');
  return {
    total: all.length,
    live: live.length,
    available: by('available').length,
    reserved: by('reserved').length,
    sold: by('sold').length,
    drafts: all.length - live.length,
    stockValue: sum(unsold),
    pricedUnsold: unsold.filter((product) => product.data.price !== null).length,
    soldValue: sum(by('sold')),
    featured: live.filter((product) => product.data.featured).length,
    attention: unsold.filter((product) => missing(product).length > 0).length,
    addedThisWeek: all.filter((product) => Date.now() - new Date(product.data.date || 0).getTime() < 7 * 86_400_000).length,
  };
}

/** Products per category, in the category order. */
export function byCategory(store: Store) {
  const live = listed(store);
  const rows = store.categories().map((category) => {
    const products = live.filter((product) => product.data.category === category.slug);
    return { slug: category.slug, name: category.name, count: products.length, sold: products.filter((product) => product.data.status === 'sold').length };
  });
  const known = new Set(rows.map((row) => row.slug));
  const other = live.filter((product) => !known.has(product.data.category));
  if (other.length > 0) rows.push({ slug: '', name: 'Other', count: other.length, sold: other.filter((product) => product.data.status === 'sold').length });
  return rows;
}
