# Share 1:1 Shop with friends

`http://localhost:4321/` only opens the website on your own PC. To send a link that works on friends'
phones, publish the website to a host. Once published, your PC can be switched off.

Your code is already connected to `TronikTTV/reselling-website` on GitHub. The latest local changes
must be committed and pushed before a host connected to GitHub can build them.

## Publish with Cloudflare Pages

1. In GitHub Desktop, select this repository, review the website changes, enter a commit summary,
   choose **Commit to main**, then **Push origin**.
2. Sign in to [Cloudflare](https://dash.cloudflare.com/) and open **Workers & Pages**.
3. Choose **Create application → Pages → Import an existing Git repository**. Connect GitHub and
   select `TronikTTV/reselling-website`.
4. Choose a project name such as `one-to-one-shop` if available. The store will still display
   **1:1 Shop**; website addresses cannot contain the colon.
5. Set the production branch to `main`, build command to `npm run build`, and output directory to
   `dist`. Keep the repository root as the build root. This project is already static; it needs no
   server adapter.
6. Add these build environment variables:

   | Name | Value |
   | --- | --- |
   | `NODE_VERSION` | `24` |
   | `GITHUB_REPOSITORY` | `TronikTTV/reselling-website` |
   | `GITHUB_REF_NAME` | `main` |
   | `BASE_PATH` | `/` |
   | `SITE_URL` | `https://YOUR-ACTUAL-PROJECT-NAME.pages.dev` |

   Replace the example `SITE_URL` with the address for the project name you actually chose. The
   GitHub variables connect the existing admin editor to the correct repository; they are not passwords.
7. Choose **Save and Deploy**. Once successful, open the public `pages.dev` link and check the site.
8. Send that public link through WhatsApp, Instagram, or any messaging app. A product page's
   **Copy link** button shares that particular listing.

Future pushes to the connected branch rebuild the website automatically. Changes saved to GitHub
through the admin editor also trigger a rebuild. Closing your local preview does not stop the public site.

This guide does not create an account or publish the site for you. No public deployment has been
verified during the launcher work.

[Cloudflare's Astro deployment settings](https://developers.cloudflare.com/pages/framework-guides/deploy-an-astro-site/)
and [Git integration instructions](https://developers.cloudflare.com/pages/get-started/git-integration/).

## Why use a different host from the existing workflow?

The repository includes a GitHub Pages workflow. GitHub's rules exclude sites primarily intended
to facilitate commercial transactions, which is relevant to this reseller catalogue. You can keep
the code on GitHub while hosting the website elsewhere. The existing workflow has not been changed.

[GitHub Pages usage rules](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
