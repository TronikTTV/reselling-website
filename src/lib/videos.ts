// Product videos are stored next to each product's index.md (uploaded in the admin page's
// "Product video" field). Vite copies each one into the built site and gives back its web address,
// which already includes the base path.
import type { Product } from './catalog';

const videoFiles = import.meta.glob('/src/content/products/**/*.{mp4,webm,m4v,mov,MP4,WEBM,M4V,MOV}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Web address of a product's video, or undefined when it has none (or the file is missing). */
export function productVideo(product: Product): string | undefined {
  const file = product.data.video?.replace(/^\.\//, '');
  if (!file) return undefined;
  const folder = (product.filePath ?? '')
    .replace(/\\/g, '/')
    .replace(/^.*?src\/content\/products\//, '/src/content/products/')
    .replace(/\/[^/]*$/, '');
  return videoFiles[`${folder}/${file}`];
}
