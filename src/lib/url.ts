// On GitHub Pages the site lives under a sub-folder (https://you.github.io/<repo>/),
// so every internal link must go through url(). Locally the base is just "/".
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '');

/** Turns a site path like "/shop/" into a link that works wherever the site is hosted. */
export function url(path = '/'): string {
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#|\?)/i.test(path)) return path;
  return `${BASE}/${path.replace(/^\/+/, '')}`;
}

export const productUrl = (id: string) => url(`/product/${id}/`);
export const categoryUrl = (slug: string) => url(`/category/${slug}/`);
export const shopUrl = (query?: Record<string, string>) =>
  url(`/shop/${query ? `?${new URLSearchParams(query)}` : ''}`);
