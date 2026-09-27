# Signing in to the store admin

The store admin (the Studio at `/admin/`) saves changes straight into the store's GitHub repository.
To let it do that, you sign in with an **admin key**: a GitHub access token that works like a password.
Make it once, save it in your phone's passwords or notes, and paste it whenever a new phone or computer
asks.

The website itself can't check passwords (it's plain files), so a short made-up password such as
12321 couldn't keep other people out. The admin key can: without it, nobody can change the store.

## Make your admin key (once, about 2 minutes)

1. Open your site's `/admin/` (or tap **Store admin** at the bottom of any page), then tap **Where do I
   find my admin key?** and **Get my admin key**. GitHub opens with the name, "never expires" and
   "Contents: Read and write" already filled in.
   (Or use [this link](https://github.com/settings/personal-access-tokens/new?name=Central+Supply+admin&target_name=TronikTTV&expires_in=none&contents=write).)
2. Under **Repository access**, choose **Only select repositories** and pick **reselling-website**.
3. Tap **Generate token**. Copy the key it shows (it starts with `github_pat_`) and save it in your
   passwords or notes. GitHub only shows it once.

## Sign in on a phone or computer

1. Open your site's `/admin/`.
2. Paste your admin key and tap **Sign in**. Your phone or browser may offer to save it as a password.

That device stays signed in until you choose **Settings → Sign out on this device**. Signing in to the
Studio also signs in the classic editor at `/admin/cms/` on that device.

## Keep it safe

- Anyone with the key can change the store, so only paste it into your own site's store admin, never
  into chat or other websites.
- Lost it, or worried someone else has it? Delete it at
  [GitHub → Settings → Fine-grained tokens](https://github.com/settings/personal-access-tokens) and make
  a new one. Devices using the old key are signed out.

## On this PC without a key

Double-click **Start website.cmd**, open http://localhost:4321/admin/ and choose **Edit this PC's files**.
Changes are saved into the website folder; push them with GitHub Desktop (or `git push`) to put them
live.

## Want a "Sign In with GitHub" button instead?

It's possible for the classic editor, but it needs a separate sign-in helper running in your Cloudflare
account and a registered GitHub app: see the
[Sveltia CMS Authenticator](https://github.com/sveltia/sveltia-cms-auth). Once that exists, add its
address as `base_url` and remove the `auth_methods` line under `backend:` in `src/cms/config.yml`.
