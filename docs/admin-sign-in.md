# Signing in to the admin editor

The editor at `/admin/` saves changes straight into the store's GitHub repository. To let it do that,
you sign in with an **admin key**: a GitHub access token that works like a password. Make it once,
save it in your phone's passwords or notes, and paste it whenever a new phone or computer asks.

The website itself can't check passwords (it's plain files), so a short made-up password such as
12321 couldn't keep other people out. The admin key can: without it, nobody can change the store.

## Make your admin key (once, about 2 minutes)

1. Open the **Owner dashboard** (link at the bottom of every page) and tap **Get my admin key**.
   GitHub opens with the name, "never expires" and "Contents: Read and write" already filled in.
   (Or use [this link](https://github.com/settings/personal-access-tokens/new?name=Central+Supply+admin&target_name=TronikTTV&expires_in=none&contents=write).)
2. Under **Repository access**, choose **Only select repositories** and pick **reselling-website**.
3. Tap **Generate token**. Copy the key it shows (it starts with `github_pat_`) and save it in your
   passwords or notes. GitHub only shows it once.

## Sign in on a phone or computer

1. Open the Owner dashboard and press **All products** (or go to your site's `/admin/`).
2. Tap **Sign In Using Access Token**, paste your admin key and confirm.

That device stays signed in until you sign out from the editor's account menu.

## Keep it safe

- Anyone with the key can change the store, so only paste it into your own site's editor, never into
  chat or other websites.
- Lost it, or worried someone else has it? Delete it at
  [GitHub → Settings → Fine-grained tokens](https://github.com/settings/personal-access-tokens) and make
  a new one. Devices using the old key are signed out.

## On this PC without a key

Double-click **Start website.cmd**, open http://localhost:4321/admin/ in Chrome or Edge, and choose
**Work with Local Repository**. Pick the website folder. Changes are saved into the folder; push them
with GitHub Desktop (or `git push`) to put them live.

## Want a "Sign In with GitHub" button instead?

It's possible, but it needs a separate sign-in helper running in your Cloudflare account and a
registered GitHub app: see the
[Sveltia CMS Authenticator](https://github.com/sveltia/sveltia-cms-auth). Once that exists, add its
address as `base_url` and remove the `auth_methods` line under `backend:` in `src/cms/config.yml`.
