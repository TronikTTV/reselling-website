# Instructions for AI coding agents (Codex, Claude, etc.)

## What this project is

A product catalogue website for a small reseller: watches, hats, clothing, trainers, glasses, socks,
electronics, fragrances, bags, jewellery, accessories and so on. Friends and followers open a shared
link, browse by category, search, filter and sort, then message the owner about an item. There is no
checkout and no payments.

- **Astro 7**, fully static output. No server, no database.
- **Hosted free on Cloudflare Pages**, which rebuilds on every push to `main` (build `npm run build`,
  output `dist`; the site address comes from `CF_PAGES_URL`, see `astro.config.mjs`).
  `.github/workflows/deploy.yml` is a manual-only GitHub Pages backup. It must stay free and static.
- **The owner runs the store from the admin Studio** at `/admin/` (`src/studio/`): products with photos
  and videos, "Add from photos" (AI fills in listings from photos), every piece of site text, categories,
  settings, and a live editor that shows the real site to click and edit. It runs in the browser and saves to this repo as commits, using the owner's admin
  key (a GitHub access token). The classic editor (Sveltia CMS) is kept at `/admin/cms/`. The owner is
  not a developer.
- The owner mostly uses you for **visual design**: layout, typography, colour, spacing, components and
  motion. Everything described under "Rules" must keep working.

## Commands

| Task | Command |
| --- | --- |
| Install | `npm ci` |
| Dev server | `npm run dev` (http://localhost:4321) |
| Build (must pass) | `npm run build` |
| Type check (must report 0 errors) | `npm run check` |
| Studio saving tests (must pass) | `npm run test:studio` |
| Build in a sub-folder (as GitHub Pages would serve it) | `BASE_PATH=/test-repo SITE_URL=https://example.github.io npm run build` |

Node 22.12 or newer (the deploy workflow uses Node 24).

## Where things are

| Path | What it is |
| --- | --- |
| `src/styles/global.css` | All storefront styling. Design tokens (colours, gradients, fonts, radii, easing) are at the top in `:root`. Start here. Fonts are Geist Variable and Instrument Serif italic from `@fontsource`, imported in `BaseLayout.astro`. |
| `src/layouts/BaseLayout.astro` | `<html>`/`<head>`, meta and link-preview tags, header and footer. |
| `src/components/` | `Header` (with the search sheet), `Footer`, `AdReel` (story-style video/photo ads at the top of the home page), `Marquee` (ticker), `ProductRail` (swipe row), `ProductCard`, `ProductBrowser` (search/filter/sort + grid), `Gallery` (photos + full-screen viewer), `CategoryTiles` (bento grid), `ShareButton`, `Icon` (all icons), `Copy` (a piece of editable site text), `Words` (text that never splits a hyphenated word across lines). |
| `src/pages/` | `index` (home), `shop` (all products), `category/[slug]`, `product/[slug]`, `404`, `manage` (old dashboard address, forwards to `/admin/`), `admin/` (the Studio page; `cms/` the classic editor; `catalog.json` and `build.json`, data the Studio reads; `config.yml` for the classic editor). |
| `src/lib/` | `catalog.ts` (loading and sorting products), `site.ts` (settings and categories), `copy.ts` + `copy-fields.ts` (site wording, its defaults and how the Studio labels it), `images.ts` (photo sizes), `url.ts` (links), `format.ts` + `labels.ts` (prices, status and "where it's from" labels), `contact.ts` (message links), `search.ts`, `videos.ts`, `build-info.ts`, `identify.ts` (the AI behind "Add from photos", run on Cloudflare). |
| `src/content/products/<slug>/index.md` | One folder per product: front matter + description, with its photos and video next to it. Written by the Studio. |
| `src/content.config.ts` | Product schema (deliberately forgiving so one bad entry can't break the build). |
| `src/data/settings.json`, `categories.json`, `content.json` | Store settings, the category list, and the site's wording (all edited in the Studio). |
| `src/studio/` | The admin Studio, vanilla TypeScript: `main.ts` (sign-in), `shell.ts` (frame, Publish bar, live status), `store.ts` (data, unpublished changes, publishing), `views/` (Overview, Products, product editor, "Add products": `add-photos.ts` from photos with AI and `add-folders.ts` from folders, Site text, Categories, Settings, and `live.ts`, the live editor), `lib/backend.ts` (GitHub API, or this PC's files; keeps uploads under GitHub's limits of 80 a minute and 500 an hour, waits and retries when GitHub asks, and remembers what's uploaded so a retry carries on), `lib/ai.ts` (asking /api/identify), `lib/folder-import.ts` (reading product folders and their text files), `lib/product-file.ts` (reading/writing product files), `studio.css`. |
| `functions/api/identify.ts`, `wrangler.toml` | The only server code: a Cloudflare Pages Function for "Add from photos" (logic in `src/lib/identify.ts`), using the account's free Workers AI allowance through the `AI` binding in `wrangler.toml`. Only works with the owner's admin key. |
| `src/cms/config.yml` | Classic editor fields, served as `/admin/config.yml` (its Site text section is generated from `copy-fields.ts`). |
| `scripts/import-products.mjs` | Bulk import from the local `import/` folder (`npm run import`). |
| `scripts/studio-dev-api.mjs` | Only during `npm run dev`: lets the Studio edit this folder's files ("Edit this PC's files") and answers /api/identify with sample suggestions. |

## Rules

1. **Links.** Build every internal URL with `url()`, `productUrl()`, `categoryUrl()` or `shopUrl()` from
   `src/lib/url.ts`. The live site is served from a sub-folder (`https://user.github.io/<repo>/`), so a
   hard-coded `href="/shop/"` breaks there. Files in `public/` need `url('/file.ext')` too.
2. **Product data belongs to the owner.** Don't rename, remove or change the meaning of the front-matter
   fields: `title`, `images`, `category`, `brand`, `price`, `retailPrice`, `status`
   (`available`/`reserved`/`sold`), `size`, `condition`, `featured`, `draft`, `styleCode`, `colourway`,
   `includes`, `authenticity` (a key from `AUTHENTICITY_LABELS` in `src/lib/labels.ts`), `video` (a file in the
   product's folder, resolved by `productVideo()` in `src/lib/videos.ts`), `tags`, `date`,
   plus the Markdown body (the description). A new field must be optional and added to
   `src/content.config.ts`, `src/cms/config.yml` and the Studio (`src/studio/lib/product-file.ts` and
   `src/studio/views/product-form.ts`). Don't edit or delete products unless asked. The
   `example-*` products are placeholders that the owner will delete.
   **Drafts** (`draft: true`) must never appear on the public site: get products through
   `getAllProducts()`/`getListedProducts()` in `src/lib/catalog.ts`, which leave them out. That includes
   `/admin/catalog.json` (public); the Studio fetches drafts from GitHub after sign-in.
3. **Wording belongs to Site text.** Visible text on the storefront goes through `<Copy name="…" />` or
   `copy()` (`src/lib/copy.ts`) so the owner can change it in the Studio. To add a new piece of text, add
   its default to `COPY_DEFAULTS` and a field to `TEXT_GROUPS` in `src/lib/copy-fields.ts`; the Studio and
   the classic editor pick it up. In titles, words in `*stars*` (or else the last word) get the italic
   accent (`<Copy name="…" accent />`).
4. **Keep the hooks the scripts rely on**, whatever the markup ends up looking like:
   - `ProductCard` outer element: `data-product`, `data-search`, `data-category`, `data-brand`,
     `data-price`, `data-status`, `data-date`, `data-title`, and the `hidden` prop.
   - `ProductBrowser`: `[data-browser]` with `data-page-size`, `[data-controls]` (a `<form>` whose fields
     are named `q`, `category`, `brand`, `sort`, `available`), `[data-grid]`, `[data-count]`,
     `[data-empty]`, `[data-more]`, `[data-clear]`.
   - `Gallery`: `[data-gallery]`, `[data-track]`, `[data-slide]`, `[data-thumb]`, `[data-counter]`,
     `[data-lightbox]`, `[data-lightbox-track]`, `[data-close]`, `[data-step]`.
   - `ShareButton`: `[data-share]`, `[data-share-label]`.
   - `AdReel`: `[data-reel]`, `[data-reel-slide]` (+ `.is-active`), `[data-reel-video]`, `[data-reel-go]`,
     `[data-reel-sound]`. The active progress bar's CSS animation (`.reel__bar.is-active .reel__fill`)
     is what advances the slides: its `animationend` event moves to the next one. Each product is shown
     whole: `.reel__frame` takes the photo's or video's shape from `--ar` (the script sets it for videos
     once they load) and the largest size that fits `.reel__stage`; `.reel__backdrop` is a blurred copy.
     Don't crop products with `object-fit: cover` on a differently shaped box, and keep the words and
     buttons off the product. The reel's height fills the first screen using `--reel-top` (set by the
     script), so the buttons are always in view.
   - Site-wide (`BaseLayout.astro` script): `[data-reveal]` (gets `.is-in` when scrolled into view),
     `img[data-fade]` (gets `.is-loaded`), `[data-header]` (gets `data-scrolled` / `data-hidden`),
     `[data-search-sheet]` with `[data-open-search]` / `[data-close-search]`, and `a[data-vt-link]` containing
     `[data-vt-photo]` for the photo that flies into the product page (view transition name `product-photo`;
     only one element may have it at a time). Product page: `[data-main-cta]` and `[data-buy-bar]`.
   - **Live editor** (the Studio shows the real site and reaches into it; see `src/studio/views/live.ts`):
     `data-edit="…"` marks what can be clicked and edited.
     - Text: `copy:<key>` (the `Copy` component adds it) and `site:<key>` for settings text
       (`siteName`, `tagline`, `heroHeading`, `heroAccent`, `announcement`).
     - The ticker: `site:ticker` on the marquee, with `data-field="phrase" data-i="<n>"` on each phrase.
     - Anything showing one product (cards, reel slides, the buy bar): `product:<id>`, with
       `data-field="title|brand|price|meta|image|video"` on the parts inside.
     - Product page parts: `product:<id>:title|brand|price|images|details|body|tags|authenticity`. Gallery
       photos carry `data-field="image" data-i="<n>"`.
     - Categories: `category:<slug>:name` and `category:<slug>:description`.
5. **Photos.** Get product photo URLs from `productPhoto()` and `sharePreview()` in `src/lib/images.ts`.
   Don't request new sizes with `<Image>`/`<Picture>`: every extra size is generated for every photo,
   which slows builds and grows the published site (Cloudflare Pages allows 20,000 files per site). Keep decorative images
   small (under 200 KB).
6. **Stay static and free.** No SSR adapters, databases, paid services, API keys or trackers. Keep
   client-side JavaScript small and vanilla (Astro `<script>` tags), with no UI frameworks just for
   decoration. Self-host fonts (`@fontsource/*` packages or Astro's font support) instead of loading
   third-party CSS/JS from CDNs. (The Studio's larger script only loads on `/admin/`.) The one piece of
   server code is `functions/api/identify.ts` (free Workers AI, owner-only); don't add more, and never put
   an API key in the site.
7. **Motion.** The site is meant to feel alive (the owner asked for lots of clean animation), but
   it's kept to `transform`/`opacity` so it stays smooth in TikTok's in-app browser. Under
   `prefers-reduced-motion: reduce` (the owner's own PC has Windows animation effects switched off) keep
   fades, crossfades and colour, and drop sliding, zooming and auto-scrolling: see the last block of
   `global.css`. Check both settings.
8. **Mobile first.** Most visitors open shared links on phones. Check 375px wide as well as desktop,
   keep tap targets at least 44px, and keep the photos front and centre.
9. **Leave alone** `.github/workflows/deploy.yml`, `src/pages/admin/`, `src/studio/` (the owner's admin,
   not the storefront design) and the `site`/`base` lines in `astro.config.mjs` unless the owner asks. If
   you do change the Studio, run `npm run test:studio` and check it on a phone.
10. **Astro 7 notes.** The compiler is strict about HTML: close every tag, and invalid nesting isn't
   auto-corrected. Whitespace between elements on separate lines is removed (`compressHTML: 'jsx'`),
   so use CSS gaps/margins or `{' '}` for spacing. Zod is v4, imported from `astro/zod`. Use
   `render(entry)` from `astro:content`; entries have `id`, not `slug`.
11. **Design for real stock, not the placeholders.** Expect mixed photo shapes and busy backgrounds,
   1–10 photos per product, long titles, missing prices ("Ask for price"), missing brands, sold and
   reserved badges, empty categories, and stores with 1,000+ products (the browser reveals cards 48 at
   a time).

## Before you finish

- `npm run build` succeeds, `npm run check` reports 0 errors and `npm run test:studio` passes (it also
  tests /api/identify and the folder reader).
- Home, Shop all (search, category and brand filters, sort, "Hide sold", Show more), a category page and
  a product page (swipe, thumbnails, full-screen viewer, share button) all still work, on phone and
  desktop widths.
- In the Studio's live editor (`npm run dev`, open `/admin/`, choose "Edit this PC's files"), hovering the
  headline, a product card and a section title still outlines them, and clicking lets you edit them.
- Describe the changes in plain English in the pull request (the owner isn't technical), with
  screenshots if you can.
