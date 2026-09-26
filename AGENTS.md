# Instructions for AI coding agents (Codex, Claude, etc.)

## What this project is

A product catalogue website for a small reseller: watches, hats, clothing, trainers, glasses, socks,
electronics, fragrances, bags, jewellery, accessories and so on. Friends and followers open a shared
link, browse by category, search, filter and sort, then message the owner about an item. There is no
checkout and no payments.

- **Astro 7**, fully static output. No server, no database.
- **Hosted free on GitHub Pages.** `.github/workflows/deploy.yml` rebuilds and deploys on every push to
  `main`. It must stay free and static.
- **The owner manages products in Sveltia CMS** at `/admin/`, which commits Markdown files and photos
  straight to this repo. The owner is not a developer.
- The owner mostly uses you for **visual design**: layout, typography, colour, spacing, components and
  motion. Everything described under "Rules" must keep working.

## Commands

| Task | Command |
| --- | --- |
| Install | `npm ci` |
| Dev server | `npm run dev` (http://localhost:4321) |
| Build (must pass) | `npm run build` |
| Type check (must report 0 errors) | `npm run check` |
| Build as GitHub Pages serves it (sub-folder) | `BASE_PATH=/test-repo SITE_URL=https://example.github.io npm run build` |

Node 22.12 or newer (the deploy workflow uses Node 24).

## Where things are

| Path | What it is |
| --- | --- |
| `src/styles/global.css` | All styling. Design tokens (colours, fonts, radii, widths) are at the top in `:root`. Start here. |
| `src/layouts/BaseLayout.astro` | `<html>`/`<head>`, meta and link-preview tags, header and footer. |
| `src/components/` | `Header`, `Footer`, `ProductCard`, `ProductBrowser` (search/filter/sort + grid), `Gallery` (photos + full-screen viewer), `CategoryTiles`, `ShareButton`, `SearchIcon`. |
| `src/pages/` | `index` (home), `shop` (all products), `category/[slug]`, `product/[slug]`, `manage` (owner dashboard: stock counts, "needs attention", editor shortcuts), `404`, `admin/` (the CMS: don't touch). |
| `src/lib/` | `catalog.ts` (loading and sorting products), `site.ts` (settings and categories), `images.ts` (photo sizes), `url.ts` (links), `format.ts` (prices), `contact.ts` (message links), `search.ts`. |
| `src/content/products/<slug>/index.md` | One folder per product: front matter + description, with its photos next to it. Written by the CMS. |
| `src/content.config.ts` | Product schema (deliberately forgiving so one bad entry can't break the build). |
| `src/data/settings.json`, `src/data/categories.json` | Store settings and the category list (edited in the CMS). |
| `src/cms/config.yml` | CMS fields, served as `/admin/config.yml`. |
| `scripts/import-products.mjs` | Bulk import from the local `import/` folder (`npm run import`). |

## Rules

1. **Links.** Build every internal URL with `url()`, `productUrl()`, `categoryUrl()` or `shopUrl()` from
   `src/lib/url.ts`. The live site is served from a sub-folder (`https://user.github.io/<repo>/`), so a
   hard-coded `href="/shop/"` breaks there. Files in `public/` need `url('/file.ext')` too.
2. **Product data belongs to the CMS.** Don't rename, remove or change the meaning of the front-matter
   fields: `title`, `images`, `category`, `brand`, `price`, `retailPrice`, `status`
   (`available`/`reserved`/`sold`), `size`, `condition`, `featured`, `draft`, `styleCode`, `colourway`,
   `includes`, `authenticity` (a key from `AUTHENTICITY_LABELS` in `src/lib/format.ts`), `tags`, `date`,
   plus the Markdown body (the description). A new field must be optional and added to both
   `src/content.config.ts` and `src/cms/config.yml`. Don't edit or delete products unless asked. The
   `example-*` products are placeholders that the owner will delete.
   **Drafts** (`draft: true`) must never appear on the public site: get products through
   `getAllProducts()`/`getListedProducts()` in `src/lib/catalog.ts`, which leave them out. Only the
   dashboard uses `getDraftProducts()`, and only for a count (the dashboard page is public).
3. **Keep the hooks the scripts rely on**, whatever the markup ends up looking like:
   - `ProductCard` outer element: `data-product`, `data-search`, `data-category`, `data-brand`,
     `data-price`, `data-status`, `data-date`, `data-title`, and the `hidden` prop.
   - `ProductBrowser`: `[data-browser]` with `data-page-size`, `[data-controls]` (a `<form>` whose fields
     are named `q`, `category`, `brand`, `sort`, `available`), `[data-grid]`, `[data-count]`,
     `[data-empty]`, `[data-more]`, `[data-clear]`.
   - `Gallery`: `[data-gallery]`, `[data-track]`, `[data-slide]`, `[data-thumb]`, `[data-counter]`,
     `[data-lightbox]`, `[data-lightbox-track]`, `[data-close]`, `[data-step]`.
   - `ShareButton`: `[data-share]`, `[data-share-label]`.
4. **Photos.** Get product photo URLs from `productPhoto()` and `sharePreview()` in `src/lib/images.ts`.
   Don't request new sizes with `<Image>`/`<Picture>`: every extra size is generated for every photo,
   which slows builds and grows the published site (GitHub Pages allows 1 GB). Keep decorative images
   small (under 200 KB).
5. **Stay static and free.** No SSR adapters, databases, paid services, API keys or trackers. Keep
   client-side JavaScript small and vanilla (Astro `<script>` tags), with no UI frameworks just for
   decoration. Self-host fonts (`@fontsource/*` packages or Astro's font support) instead of loading
   third-party CSS/JS from CDNs.
6. **Mobile first.** Most visitors open shared links on phones. Check 375px wide as well as desktop,
   keep tap targets at least 44px, and keep the photos front and centre.
7. **Leave alone** `.github/workflows/deploy.yml`, `src/pages/admin/` and the `site`/`base` lines in
   `astro.config.mjs` unless the owner asks.
8. **Astro 7 notes.** The compiler is strict about HTML: close every tag, and invalid nesting isn't
   auto-corrected. Whitespace between elements on separate lines is removed (`compressHTML: 'jsx'`),
   so use CSS gaps/margins or `{' '}` for spacing. Zod is v4, imported from `astro/zod`. Use
   `render(entry)` from `astro:content`; entries have `id`, not `slug`.
9. **Design for real stock, not the placeholders.** Expect mixed photo shapes and busy backgrounds,
   1–10 photos per product, long titles, missing prices ("Ask for price"), missing brands, sold and
   reserved badges, empty categories, and stores with 1,000+ products (the browser reveals cards 48 at
   a time).

## Before you finish

- `npm run build` succeeds and `npm run check` reports 0 errors.
- Home, Shop all (search, category and brand filters, sort, "Hide sold", Show more), a category page and
  a product page (swipe, thumbnails, full-screen viewer, share button) all still work, on phone and
  desktop widths.
- Describe the changes in plain English in the pull request (the owner isn't technical), with
  screenshots if you can.
