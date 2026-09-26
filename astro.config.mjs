// @ts-check
import { defineConfig } from 'astro/config';

/**
 * The public address of the site, used for link previews and the admin page.
 * Set SITE_URL to override it (e.g. for a custom domain). On Cloudflare Pages it's worked out
 * automatically: CF_PAGES_URL is the address of this particular deployment
 * (https://1a2b3c4d.central-supply.pages.dev), and the main address drops the first part.
 */
function siteUrl() {
  if (process.env.SITE_URL) return process.env.SITE_URL;
  const deployment = process.env.CF_PAGES_URL;
  if (deployment) {
    const url = new URL(deployment);
    url.hostname = url.hostname.split('.').slice(-3).join('.');
    return url.origin;
  }
  return undefined;
}

// BASE_PATH is only needed when the site lives in a sub-folder (e.g. GitHub Pages).
// Locally and on Cloudflare Pages the site runs at "/".
export default defineConfig({
  site: siteUrl(),
  base: process.env.BASE_PATH || '/',
});
