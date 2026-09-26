# Put Central Supply online

`http://localhost:4321/` only opens the website on your own PC. To send a link that works on
friends' phones, the site is hosted on **Cloudflare Pages**: free, allowed for shops, and it stays up
when your PC is off.

**Already done:** the site is live at **https://central-supply.pages.dev** (Cloudflare Pages project
`central-supply`, connected to `TronikTTV/reselling-website`, branch `main`). The steps below are kept
for reference.

## One-time setup (about 5 minutes)

1. Sign up for free at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) and confirm
   your email address.
2. In the Cloudflare dashboard, open **Workers & Pages**, then choose **Create application →
   Pages → Connect to Git**.
3. Choose **GitHub**, sign in, and allow Cloudflare to see the **reselling-website** repository.
   Select it and press **Begin setup**.
4. Fill in:
   - **Project name:** `central-supply`. This becomes the address, `central-supply.pages.dev`. If
     it's taken, pick something close.
   - **Production branch:** `main`
   - **Framework preset:** `Astro` (this fills in build command `npm run build` and output
     directory `dist`).
   - Leave everything else, including environment variables, as it is. The site works out its own
     address and the correct Node.js version by itself.
5. Press **Save and Deploy**. After a couple of minutes you get the link to send people.

## Afterwards

- Every change saved in the admin editor, merged from Codex or pushed from this PC rebuilds the site
  automatically. It takes about 1–2 minutes.
- A product page's **Copy link** button shares that particular listing.
- If a change doesn't appear, open your project in Cloudflare → **Deployments** to see what happened.
- Using your own domain later? Add it under the project's **Custom domains**, then add a `SITE_URL`
  environment variable with the full address (e.g. `https://centralsupply.uk`) so link previews use it.

## Why not GitHub Pages?

GitHub's rules exclude sites that are mainly for selling, which a shop catalogue is. The code stays on
GitHub and only the hosting is on Cloudflare. The old GitHub Pages workflow is kept as a manual
backup (Actions tab → **Run workflow**) and no longer runs on every change.
[GitHub Pages usage rules](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
