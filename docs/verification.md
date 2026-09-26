# Storefront refresh

## Owner dashboard, drafts and StockX details — 26 September 2026

- Store renamed to **Central Supply**. The Instagram contact `Centralsupply.uk` adds **Message on
  Instagram** (`https://ig.me/m/Centralsupply.uk`) to product pages and the footer.
- New optional product fields: `draft`, `styleCode`, `colourway`, `includes`, `authenticity`. Checked
  with temporary test products, removed afterwards: the draft had no product page (404), was absent
  from the shop and only counted (not named) on the dashboard. The StockX listing showed the
  authenticity badge and new details, and searching its style code `DD1391-100` found it.
- `/manage/` is now an owner dashboard: stock counts and value, a "Needs attention" list (missing
  price, size or photos) with editor links in Sveltia's `#/collections/products/entries/<folder>/index`
  format, and a per-category table. Checked at 375px (no horizontal overflow) and 1440px.
- `npm run import -- --draft` imports as drafts. Fixed a Windows file lock (sharp's cache) that stopped
  originals moving to `import/_done` and aborted the batch; moves now retry, then warn instead of aborting.
- The admin configuration falls back to the git remote, so the local editor targets
  `TronikTTV/reselling-website` without environment variables.
- The CMS configuration validated against Sveltia's JSON schema and loaded without warnings.
  **Sign In with GitHub has not been tested yet:** it needs the one-time setup in
  [admin-sign-in.md](admin-sign-in.md).
- `astro check`: 0 errors. Normal and `/test-repo` builds passed, importer tests 11/11, and all 27 pages
  plus the dashboard, shop and home images returned HTTP 200 on the dev server.

## Local controls — 26 September 2026

- Added Start website.cmd, Restart website.cmd and Stop website.cmd, using the shared PowerShell
  helper. Existing Open/Close launchers remain compatible.
- Start returned HTTP 200. A repeated start preserved the server PID. Restart replaced that PID
  and returned HTTP 200. Running Stop website.cmd ended the tracked process and stopped HTTP
  responses. A repeated stop succeeded, and restarting from stopped returned HTTP 200.
- Tests used the helper's NoBrowser switch for start/restart to avoid opening extra browser tabs.
  The preview was left running. Astro check reported zero errors/warnings, and the build passed.
- Added docs/share-with-friends.md with publishing instructions and the build settings required by
  this repository's CMS. No changes were pushed and no public deployment was made.

The collection now has an all-black space theme with blue accents, a sparse starfield, a softly lit
orbital homepage feature, dark filters and panels, and motion that respects reduced-motion settings.
Product photos remain fully visible instead of being cropped. Existing product files are unchanged.

The footer’s Owner tools link leads to the existing store editor and instructions for local batch
imports. Homepage heading text is now editable in Store settings. Product pages have separate Share
and Copy link buttons, plus guidance when no contact method has been configured.

## Space theme — 22 September 2026

- Store name set to **1:1 Shop** in the CMS-backed settings, updating the header, footer, browser
  titles and social sharing metadata together.
- Reviewed https://sukarrplugss.com/ as the owner's reference for the black and electric-blue palette.
- Black backgrounds now cover the header, home, catalogue, categories, product details, owner tools
  and footer. Form fields and native selects use a dark colour scheme with readable light text.
- The small local star SVG repeats behind the site; a CSS planet and orbit add depth to the hero.
  These decorative layers ignore pointer events. There is no animation library, canvas loop or
  external asset request. The brief orbit entrance and existing hover motion respect reduced motion.
- The stars asset URL uses the shared base-path helper so sub-folder hosting continues to work.
- Checked the home and shop at 375px and 1440px, with no horizontal page overflow. Rechecked brand
  filtering, descending prices and Hide sold; existing gallery and pagination hooks are preserved.
- On the phone product page, category navigation, thumbnails, full-screen next/close and Copy link
  were rechecked. Astro check passed with zero errors and warnings; both production builds passed,
  and the generated sub-folder homepage references `/test-repo/stars.svg` correctly.

## Black-and-white refresh verification — 22 September 2026

The phone header is about 109px tall with a direct search link, scrolling categories and two-column
product browsing. The featured item becomes a small horizontal card on phones. The styling now uses
one shared set of rules instead of layers of conflicting redesign overrides.

Double-click **Open website.cmd** to start the local preview and open the browser; double-click
**Close website.cmd** to stop it. Astro tracks the preview for this project. The controls were tested
for starting, reusing an existing server, stopping, stopping again when already off, and restarting.
The preview remains running at http://localhost:4321/.

- Home, shop and product layouts visually inspected at 375px and 1440px. No horizontal page overflow
  on the phone homepage. Categories remain independently scrollable.
- Phone search returned the hoodie, unmatched search showed the empty state, Clothing returned two
  items, Sample Brand returned five, Hide sold returned eleven, and ascending prices put the missing
  price last. Category links and reset controls worked.
- Horizontal gallery scrolling advanced to photo two. Thumbnails opened the chosen photo, the
  full-screen next control advanced to photo three, and closing preserved that selection. Copy link
  displayed its success message. Native share-sheet completion remains unverified.
- A temporary eight-item batch rendered eight cards; scrolling the Show more control into view
  automatically revealed all twelve and hid the control. The normal batch size of 48 was restored.
- Final Astro check and both normal and sub-folder production builds passed.

## Earlier foundation and importer checks

- Production build succeeds, including a build under `/test-repo/` for GitHub Pages.
- Astro check reports 0 errors and 0 warnings.
- Importer tests cover structured product extraction, price handling, validation, stable source
  identity, image compression, duplicate skipping, failed-download cleanup, supplier discovery,
  variant notes, review-page escaping and resumable batches.
- Home, collection, category, product and owner pages inspected at 375px and desktop widths.
- Search, combined category and brand filters, ascending and descending prices, hide sold, filter
  reset, no-result recovery and URL-restored filters verified in the browser.
- A temporary 1,000-card fixture starts with 48 visible cards and loads 96 when Show more comes into
  view. Filtering returns 84 matches and resets to 48 visible cards. No stock files were created.
- Gallery horizontal scrolling, thumbnails, full-screen navigation, and synchronisation on closing
  verified. Copy link displays “Link copied!” on phone and desktop widths.
- Owner tools opens the Sveltia CMS login. No credentials entered and no CMS content saved during testing.
- Both supplier sample batches contain two listings, with eight compressed Husky preview photos and
  two Luxury Brand preview photos. Generated review-page scripts were syntax-checked and escaping
  was tested. Browser interaction with the local review files was blocked by the browser URL policy,
  so their edit/download controls have not been visually exercised in this environment.

## Remaining setup and limits

- The checkout is connected to `TronikTTV/reselling-website`, with the first store commit on
  `main` tracking `origin/main`. The latest supplier-import changes are uncommitted and have not
  been published by this agent. Live admin access requires GitHub authentication; a shared password
  alone cannot secure write access on a static site. Review the hosting note in github-setup.md before deployment.
- Website imports run locally. Supplier adapters now support Husky Yupoo albums/catalogues and
  Luxury Brand product/category pages. Two real listings per supplier were prepared for review,
  and actual image downloads/compression were tested. This is not a full-catalogue verification.
- Supplier discovery follows pagination with explicit batch limits and a resume option. It does
  not run from the hosted admin page. Prices are set in the local review page before importing.
- The 1,000-card fixture checks browsing behaviour, not hosting capacity or a 1,000-product image build.
  Image storage and deployment limits still apply.
- Native operating-system share-sheet completion could not be verified in the embedded browser;
  the explicit Copy link action was verified.
- Add real photos, a store name and at least one contact method through the editor before sharing
  the store with friends. The supplied example listings remain in place.
