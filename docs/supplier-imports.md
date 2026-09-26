# Importing from your suppliers

Husky Yupoo (`huskyreps.x.yupoo.com`) and Luxury Brand (`luxurybrand.top`) now have specific local
catalogue adapters. They prepare a review batch; they do not immediately add listings to your store.

## Easy start on this PC

Double-click **Prepare supplier import.cmd** in the website folder. Paste a supplier homepage,
category or product link, choose the number of listings and choose 1–10 photos per listing.
The default is 20 listings with up to 4 photos each.

Open `review.html` in the newly created batch folder under `import/`. You can change titles,
categories and your selling prices, untick photos, and exclude listings. Supplier prices are not
copied automatically. A blank price becomes “Ask for price”. Changes in the review page are temporary
until you download the selected listings.

Download the selected listings and save them as `import/reviewed-products.json`. Then:

```bash
npm run import:web -- --file import/reviewed-products.json --keep-prices --dry-run
npm run import:web -- --file import/reviewed-products.json --keep-prices
```

The original `products.json` batch includes review flags and cannot be imported accidentally. Use
the file downloaded from the review page. Existing source URLs are skipped so rerunning an import
does not overwrite your prices or produce duplicate listings.

After importing, check the listings in the CMS, then commit and push the changes using GitHub Desktop.
Nothing is published automatically by the local importer itself.

## Larger batches and resuming

```bash
npm run import:catalog -- --source https://huskyreps.x.yupoo.com/ --limit 20 --out import/husky-batch
npm run import:catalog -- --source https://huskyreps.x.yupoo.com/ --limit 1000 --pages 20 --out import/husky-batch --resume
npm run import:catalog -- --source https://luxurybrand.top/product-category/perfume-cologne/ --limit 20 --out import/fragrance-batch
```

`--limit` is the total number of prepared listings in the batch, including previous runs. `--pages`
limits catalogue pages per run; product pages are fetched separately. The default is five catalogue
pages per run. Use the same source, category override and photo count when resuming. Increase the
limit to continue. Progress is checkpointed after each page. Failed pages are retried when resuming.
Three consecutive failures stop the run for inspection; errors and remaining URLs are in `progress.json`.

You can override the guessed category with `--category clothing` (or another existing category slug).
The output directory must be inside `import/`. Batch files and preview photos stay out of Git.

## What to review

- Husky albums can combine several items, colours, sizes, price notes, videos and size charts. The
  adapter selects the first few static photos; it does not understand which colour or size you stock.
- Obvious information/category albums are skipped using a conservative title/photo-count heuristic.
  Skipped URLs are listed in `progress.json` so omissions can be checked. Other informational albums
  can still reach review. Unknown Husky categories default to clothing and need checking.
- Luxury Brand gallery photos are kept separate from unrelated sidebar recommendations. Variant
  choices are shown in the review notes; one parent listing is prepared per product page. Variants
  are not split into separate stock records or given guessed quantities or prices.
- Price and currency metadata can differ from the browser display. Set your own selling prices in
  the review page. No exchange-rate conversion, supplier-price copying or automatic markup occurs.
- The preview page uses downloaded, compressed thumbnails. Importing downloads the chosen product
  photos at higher resolution and compresses them again for the catalogue.
- The collectors only follow public links on the selected supplier host. They do not sign in,
  submit access codes, bypass CAPTCHAs or import protected content. A changed supplier layout can
  require an adapter update.
- Thousands of listings are supported as bounded, resumable batches, but image storage and static
  hosting limits still apply. Test a small batch before increasing the count.

The initial verification used two public listings from each supplier and compressed real images;
it was not a complete download of either supplier’s catalogue. No supplier listings were published.
