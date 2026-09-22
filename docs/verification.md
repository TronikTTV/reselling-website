# Storefront refresh

The collection now has a warm off-white and olive design, a featured-item spotlight, compact
category browsing, clearer product details, and subtle motion that respects reduced-motion settings.
Product photos remain fully visible instead of being cropped. Existing product files are unchanged.

The footer’s Owner tools link leads to the existing store editor and instructions for local batch
imports. Homepage heading text is now editable in Store settings. Product pages have separate Share
and Copy link buttons, plus guidance when no contact method has been configured.

## Checks completed

- Production build succeeds, including a build under `/test-repo/` for GitHub Pages.
- Astro check reports 0 errors and 0 warnings.
- Five importer tests pass: structured product extraction, price handling, validation, stable
  source identity, image compression, duplicate skipping and cleanup after failed downloads.
- Home, collection, category, product and owner pages inspected at 375px and desktop widths.
- Search, combined category and brand filters, ascending and descending prices, hide sold, filter
  reset, no-result recovery and URL-restored filters verified in the browser.
- A temporary 1,000-card fixture starts with 48 visible cards and loads 96 when Show more comes into
  view. Filtering returns 84 matches and resets to 48 visible cards. No stock files were created.
- Gallery horizontal scrolling, thumbnails, full-screen navigation, and synchronisation on closing
  verified. Copy link displays “Link copied!” on phone and desktop widths.
- Owner tools opens the Sveltia CMS login. No credentials entered and no CMS content saved during testing.

## Remaining setup and limits

- No GitHub remote is configured in this checkout. The changes have not been published. Live admin
  access requires repository setup and GitHub authentication; a shared password alone cannot secure
  write access on a static site.
- Website imports run locally and support product-page URLs with Product JSON-LD, or JSON manifests.
  They have not been tested against a real supplier. A Yupoo adapter needs an actual album URL.
- Bulk imports do not discover every product on a website or run from the hosted admin page.
  Prices are blank by default and imported stock is reviewed before publishing.
- The 1,000-card fixture checks browsing behaviour, not hosting capacity or a 1,000-product image build.
  Image storage and deployment limits still apply.
- Native operating-system share-sheet completion could not be verified in the embedded browser;
  the explicit Copy link action was verified.
- Add real photos, a store name and at least one contact method through the editor before sharing
  the store with friends. The supplied example listings remain in place.
