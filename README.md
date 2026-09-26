# Reselling website

**Live site: https://central-supply.pages.dev** · Editor: https://central-supply.pages.dev/admin/ · Dashboard: https://central-supply.pages.dev/manage/

A free product catalogue that stays online around the clock. Friends open one link, browse by
category, search, filter by brand, sort by price, and message you about anything they like.

- **Static hosting.** Once published, it stays up when your PC is off. See [sharing the website](docs/share-with-friends.md) for hosting setup.
- **Add products from your phone or PC** on the admin page. Photos are shrunk automatically.
- **Plenty of room.** Roughly 3,000–4,000 photos (about 800–1,000 products with 4 photos each) fit
  within GitHub's free limits.
- **Ready for Codex.** [AGENTS.md](AGENTS.md) tells ChatGPT Codex how the site works, so it can
  restyle everything without breaking it.

---

## Start, restart and stop the local website

In this folder, double-click one of these Windows command files:

- **Start website.cmd** starts the preview in the background and opens your browser. Running it
  again reuses the same preview.
- **Restart website.cmd** stops this project's preview, starts it fresh, and opens your browser.
  It also works when the preview is already off.
- **Stop website.cmd** turns the preview off. It is safe to run when already stopped.

Closing just the browser tab does not stop the preview. These controls only affect this project's
local preview; they do not publish changes. The older Open/Close files still work too.
The localhost address works on this PC. Friends use the deployed website's address on their phones.
Follow [Share the website with friends](docs/share-with-friends.md) to get a public link.

## Adding a product (admin page)

The **Owner dashboard** link in the footer opens `/manage/`: stock counts, listings that still need
a price, size or photos, and one-tap shortcuts into the editor at `/admin/`.

1. On the live site, open the dashboard and press **All products** or **Add a product**.
2. The first time on each phone or computer, tap **Sign In Using Access Token** and paste your
   **admin key**. The key works like a password: you make it once with the dashboard's **Get my admin
   key** button and save it in your passwords or notes. See [Signing in](docs/admin-sign-in.md).
3. Press **New Product**. Add photos (the first one is the cover; drag to reorder), the name,
   category, price and so on, then **Save**. The live site updates in about 1–2 minutes.

On this PC you can also edit without signing in: double-click **Start website.cmd**, open
http://localhost:4321/admin/ in Chrome or Edge, choose **Work with Local Repository** and pick this
folder. Those changes are saved into the folder and go live when you push them.

Each product can also have:

- **Draft (hide from the shop):** save a listing without it appearing anywhere until you switch it off.
- **Where it's from:** e.g. *Bought on StockX (verified authentic)*, shown as a badge on the product page.
- **Style code / SKU**, **Colourway** and **What's included** (box, StockX tag, receipt…). People can
  search by style code.

Tips:

- **Sold something?** Change its **Status** to *Sold*. It stays on the site with a SOLD badge, or you
  can hide sold items completely in Settings.
- **No price?** Leave it empty and the site shows "Ask for price".
- **Delete the example products** (all named "Example …") once you've added your own.

## Store settings and categories

On the admin page, open **Settings**:

- **Store settings:** store name, tagline, announcement bar, currency, and **how people can contact
  you** (Instagram, WhatsApp, Snapchat, TikTok, email). These become the "Message me" buttons on every
  product, so fill in at least one.
- **Categories:** add, rename or drag to reorder. The "web address" is used in links, e.g. `watches`
  becomes `/category/watches/`.

## Adding lots of products at once (on this PC)

See [import/README.txt](import/README.txt). In short: put photos in
`import\<category>\<product name £price>\`, run `npm run import`, check the result with
`npm run dev`, then upload the changes:

```bash
git add -A
git commit -m "Add new products"
git push
```

## Batch import from websites (on this PC)

**For your Husky Yupoo and Luxury Brand suppliers:** double-click **Prepare supplier import.cmd**
in this folder. It prepares an editable review page with compressed photo previews. Follow
[Supplier imports](docs/supplier-imports.md) for selecting listings, setting prices and resuming
larger batches. No stock is added until you import the reviewed export.

Use public product pages whose photos you have permission to reuse. Save one product-page URL
per line in `import/urls.txt`. Choose an existing category web address from Settings → Categories:

```bash
npm run import:web -- --file import/urls.txt --category clothing --dry-run
npm run import:web -- --file import/urls.txt --category clothing
```

The first command previews names, photo counts and prices without creating files. It fetches pages,
but does not download or validate the image bytes until you run the second command. Product pages
must provide standard **Product JSON-LD** data. This generic URL-list command does not discover
every product on a website, follow catalogue pagination, bypass logins or import arbitrary albums.
Use the supplier-specific batch collector above for Husky catalogue discovery and Luxury Brand
category pagination. Other Yupoo sellers require separate testing. Downloaded photos can also use
the existing photo-folder importer.

For supplier exports, save an array like this as `import/products.json`:

```json
[
  {
    "source": "https://supplier.example/products/jacket-123",
    "title": "Blue jacket",
    "category": "clothing",
    "images": ["https://supplier.example/photos/jacket-123.jpg"],
    "brand": "Brand name",
    "size": "M",
    "price": 45,
    "currency": "GBP"
  }
]
```

Run `npm run import:web -- --file import/products.json --dry-run`, then remove `--dry-run` after
reviewing. There is no row limit; downloads run sequentially to keep memory and requests bounded.
Start with a small batch to check the source before importing thousands.

- Prices are **left blank by default**. Add `--keep-prices` to retain them; their currency must match
  your store, with no automatic conversion or markup. Always review imported prices before publishing.
- Photos are converted to WebP at up to 1600px. Each product accepts 1–10 photos, with a 12 MB download
  limit per image. A failed photo prevents that listing being created, so rerunning can retry it.
- Source URLs provide stable identity. Rerunning skips existing imports without overwriting your edits.
  Use the same source URL when retrying; different URLs for the same item can still produce duplicates.
- Names, brand, availability, and photos are read from product data. Descriptions are left for you to
  edit. JSON exports also support size and condition. Categories must already exist in the store.
- Results and failed row numbers are saved in `import/web-import-report.json` after a real run.
  A nonzero exit status means some rows failed; successful listings stay available for review.
- Inspect the listings in the editor, then commit and push to publish. Imports do not publish by themselves.
- Thousands of products may exceed the host’s image storage or build limits; compressed file size and
  photo counts determine capacity, not just the number of listings.

## Design and checking changes

The storefront uses an off-white and olive palette, a featured-product spotlight, horizontally
scrollable categories, full-photo cards, and reduced-motion-aware transitions. Change the homepage
heading in **Settings → Store settings**; the spotlight follows your featured products automatically.
Existing product photos and listings are kept intact.

Run `npm run check`, `npm run build`, and `npm run test:import` before publishing. Check phone and
desktop browsing, filters, sorting, galleries and sharing. No deployment or GitHub connection is
created by these commands.

## Letting Codex redesign it

1. Go to [chatgpt.com/codex](https://chatgpt.com/codex), connect your GitHub account and choose this
   repository.
2. Describe the look you want, for example:
   > Redesign the whole look of this site: premium streetwear-resale feel, black and white, bold
   > type, big photos. Follow AGENTS.md.
3. Codex opens a *pull request*. Have a look at it on GitHub and press **Merge**. The live site updates
   a couple of minutes later.

## Working on it on your PC (optional)

```bash
npm install
npm run dev
```

Then open http://localhost:4321. The admin page also works locally at
http://localhost:4321/admin/: choose **Work with Local Repository** (Chrome or Edge) and pick this
folder. Changes are saved straight into the files, and you push them with `git`.

## How it works

| Part | Where | Cost |
| --- | --- | --- |
| Website code, products and photos | This GitHub repository | Free |
| Hosting | Cloudflare Pages, rebuilt automatically on every change ([setup](docs/share-with-friends.md)) | Free |
| Admin page | [Sveltia CMS](https://sveltiacms.app) (open source) at `/admin/` | Free |

**Limits:** Cloudflare Pages allows unlimited visitors, 20,000 files per site and 500 rebuilds a month.
The tighter limit is GitHub, which recommends keeping a repository under about 1 GB: roughly
3,000–4,000 photos. If you ever get close, the admin page can be switched to store photos on a free
image host instead.

**Troubleshooting:** if a change hasn't shown up after a few minutes, open your project in
Cloudflare → **Deployments**. A failed deployment's log says why (usually a typo in a product).
