# Reselling website

**Live site: https://central-supply.pages.dev** · Store admin: https://central-supply.pages.dev/admin/

A free product catalogue that stays online around the clock. Friends open one link, browse by
category, search, filter by brand, sort by price, and message you about anything they like.

- **Static hosting.** Once published, it stays up when your PC is off. See [sharing the website](docs/share-with-friends.md) for hosting setup.
- **Run everything from the store admin**, on your phone or PC: products, photos and videos, every
  word on the site, categories and contact details, plus a live editor where you click your actual
  site to change it.
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

## The store admin (Studio)

Open **/admin/** on your site, or tap **Store admin** at the very bottom of any page. The old
`/manage/` dashboard address takes you there too.

**Signing in.** The first time on each phone or computer, paste your **admin key** (the long code
starting `github_pat_` that you saved in your passwords or notes). That device then stays signed in.
Lost it? The sign-in screen's **Where do I find my admin key?** has a button that makes a new one in
about two minutes. See [Signing in](docs/admin-sign-in.md).

What's inside:

- **Overview:** your stock at a glance (live, available, reserved, sold, stock value, drafts), pieces
  missing a photo, price, size or brand, the ads at the top of your home page, the latest pieces,
  quick edits and recent activity.
- **Live editor:** your actual site in a frame. Everything you can change gets an outline when you
  hover. Click any text to type straight onto the page; click a product or photo to edit it in the side
  panel. Pick any page from the menu, switch between phone and computer views, or choose **Browse** to
  click around normally.
- **Products:** search, filters (available, reserved, sold, drafts, on the home page, needs attention,
  not live yet), grid or list, change a status or feature a piece in one tap, and edit lots at once
  (select them, then mark sold, feature, hide, move category or delete).
- **Add products:** from photos (AI fills in each listing), from folders (one folder per product with
  its photos and a text file), or one by hand. See below.
- **Product editor:** drop in photos (they're shrunk to 1600px and cleaned of location data), drag to
  reorder or pick the cover, add a video, and fill in every detail. **Fill in from photo** asks the AI
  about the cover photo and fills in whatever is still empty. **Duplicate** copies a piece so a similar
  one takes seconds to list.
- **Site text:** every heading, button and line of text, grouped by page, each with its default and a
  **Show on page** button. In titles, words in **stars** become the italic accent.
- **Categories:** rename, drag to reorder, add descriptions, add or delete (products move with them).
  Press **+** on a category to put **sub-categories** inside it, as deep as you like: Trainers & Shoes ›
  Nike › P-6000. Each has its own page (`/category/shoes/nike/p-6000/`), shoppers see a category's
  sub-categories as buttons at the top of its page, and a category shows everything inside it.
- **Settings:** store name, currency, whether sold pieces stay up, contact details (these become the DM
  buttons, so fill in at least one), and your admin key.

**Publishing.** Changes wait in the **Publish** bar at the bottom, where you can review or undo any of
them. Press **Publish** and they're all saved at once; your site updates about a minute later. The
status light shows **Going live…** and then **Live** when it's done.

Each product can also have:

- **Draft (hidden):** keep a listing off the site until it's ready.
- **Where it's from:** e.g. *Bought on StockX*, shown under the price on the product page.
- **Style code / SKU**, **Colourway** and **What's included** (box, StockX tag, receipt…). People can
  search by style code.
- **Video:** a short clip (5–15 seconds, MP4, up to 24 MB; vertical looks best).

Tips:

- **Sold something?** In Products, change its status to *Sold*. It stays on the site with a SOLD badge,
  or you can hide sold pieces completely in Settings.
- **No price?** Leave it empty and the site shows "Ask for price".
- **Delete the example products** (all named "Example …") once you've added your own: tick them in
  Products and press **Delete**, then **Publish**.

On this PC you can also edit without a key: double-click **Start website.cmd**, open
http://localhost:4321/admin/ and choose **Edit this PC's files**. Changes are saved into the folder and
go live when it's pushed to GitHub. The previous editor (Sveltia CMS) is still at `/admin/cms/` if you
ever need it.

### Add from folders (bulk)

On a computer, open **Add products → From folders** in the store admin and choose (or drag in) a folder
with one folder per product inside it:

```text
Stock
  Trainers
    Nike Dunk Low Panda
      1.jpg  2.jpg  3.jpg
      details.txt
    Jordan 4 Military Black £180
      front.jpg  side.jpg
  Clothing
    Corteiz Alcatraz Hoodie
      ...
```

The text file (any name ending in `.txt`) looks like this, and **Download an example text file** gives
you one to copy:

```text
Name: Nike Dunk Low Retro Panda
Price: 120
Colourway: White/Black
Code: DD1391-100
Size: UK 9
Bio: Brand new in the box.
```

- Only **Name** is needed; leave out any line you don't have. **Bio** is optional, and there's a switch
  to add them all without descriptions.
- No labels? Put the name, price, colourway and code on their own lines, in that order, then the bio.
- No text file? The folder name becomes the name, with the price if it ends in one (`Jordan 4 £180`).
- Folders inside **Trainers**, **Clothing** and so on go in that category; others use the category you
  pick at the top. The first photo (or one named `cover`) is the cover, up to 12 photos each.
- Folders inside those become **sub-categories**: `Stock/Trainers/Nike/P-6000/<product folders>` files
  them under Trainers & Shoes › Nike › P-6000, making Nike and P-6000 if they don't exist yet (marked
  "new" in the list; there's a switch to turn this off). A text file can say `Category: Trainers > Nike`.
- Check the list, change anything, then **Add products** and **Publish**. Up to 100 products at a time.
  Phones can't pick folders, so use a computer (Chrome, Edge or Firefox).
- Publishing lots of photos goes in parts of about 40, each saved (and live) before the next starts,
  at about one photo a second, which GitHub accepts. Keep the page open; there's a progress bar and a
  **Stop** button. If something goes wrong, the message stays until you close it: press **Try again** and
  it carries on where it stopped (photos already sent aren't sent twice).

### Add from photos (AI)

In the store admin, open **Add products → From photos** (or press **Add from photos** on the Overview or
Products page):

1. Choose or drop in photos, one piece per photo (up to 40 at a time). Clear, bright shots work best,
   and showing the box or tags lets it tick **What's included**.
2. Each photo becomes a card. The AI picks the category and fills in the name, brand, condition, what's
   included, a short description and a **suggested price** (a typical UK resale price; use it as a
   starting point). Anything it's unsure about says **Best guess: check it**.
3. Change whatever you like on the cards, then press **Add products**. Switch on **Add as drafts** to
   keep them hidden until you've checked them in Products. Press **Publish** to put them live.

It runs on your Cloudflare account's free AI allowance: about 150 photos a day, at no cost (it simply
pauses until the next day if you ever use it all). Only your admin key can use it. On this PC (the local
preview) it gives sample suggestions instead, based on the file names.

Coming later: whole folders at once (several photos per piece, with the name and price taken from the
folder name), for clothing.

### Video ads at the top of the home page

The top of the home page plays your **featured** products like stories: muted, looping, with progress
bars. Visitors can tap to skip, hold to pause and turn the sound on. Each ad shows the whole product
(photo or video) in its own frame over a soft blurred background, with the words beside it on computers
and underneath on phones, so nothing is cut off or covered, and it always fits the first screen.
Products with a video play first; without one, the photo gently floats. The Overview shows which pieces
are in the ads, in order.

To add one: open the product, switch on **Feature on the home page**, add a **Video** if you have one,
and publish. Keep clips short and small; CapCut or TikTok's "save video" at 720p works well.
iPhone camera files can be too big, and some Android phones can't play iPhone's HEVC format, so export
them as MP4 first.

The rest of the home page is the scrolling ticker, your headline, the newest pieces, categories and
"How it works", all editable in the Live editor or Site text. It all animates in as you scroll. If your
own computer has animation effects turned off (Windows **Settings → Accessibility → Visual effects**),
you'll see a calmer version with fades only. Phones show the full motion.

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

The storefront is dark and premium: near-black with slow aurora glows and film grain, Geist and
Instrument Serif italic type, glass panels, electric-blue gradients, the story-style ad reel, a tilted
ticker, swipe rows, a bento category grid, and page transitions where a product's photo flies into
its page. Change the headline, tagline, ticker and any other wording in the store admin's Live editor
or Site text; the reel follows your featured products automatically. All colours and fonts are set at the top of
`src/styles/global.css`.

Run `npm run check`, `npm run build`, `npm run test:import` and `npm run test:studio` (the Studio and the
AI) before publishing. Check phone and
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

Then open http://localhost:4321. The store admin also works locally at
http://localhost:4321/admin/: choose **Edit this PC's files**. Changes are saved straight into the
files, and you push them with `git`.

## How it works

| Part | Where | Cost |
| --- | --- | --- |
| Website code, products and photos | This GitHub repository | Free |
| Hosting | Cloudflare Pages, rebuilt automatically on every change ([setup](docs/share-with-friends.md)) | Free |
| Store admin | The Studio at `/admin/` (part of this site, saves to GitHub with your admin key); the classic [Sveltia CMS](https://sveltiacms.app) editor at `/admin/cms/` | Free |
| AI for "Add from photos" | Cloudflare Workers AI, through `functions/api/identify.ts` | Free daily allowance |

**Limits:** Cloudflare Pages allows unlimited visitors, 20,000 files per site and 500 rebuilds a month.
The tighter limit is GitHub, which recommends keeping a repository under about 1 GB: roughly
3,000–4,000 photos. If you ever get close, the site can be switched to store photos on a free
image host instead.

**Troubleshooting:** if a change hasn't shown up after a few minutes (the store admin's status light
says **Not live yet**), open your project in Cloudflare → **Deployments**. A failed deployment's log says why (usually a typo in a product).
