// @ts-check
import { defineConfig } from 'astro/config';

// SITE_URL and BASE_PATH are filled in automatically by the GitHub Pages
// workflow (.github/workflows/deploy.yml). Locally they're empty, so the site
// runs at http://localhost:4321/.
export default defineConfig({
  site: process.env.SITE_URL || undefined,
  base: process.env.BASE_PATH || '/',
});
