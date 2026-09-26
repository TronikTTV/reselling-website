# Admin sign-in: the "Sign In with GitHub" button

A one-time setup of about 15 minutes. Afterwards you sign in to the editor with one tap on any phone
or computer.

**Why it works like this:** the website is plain files, so it can't check passwords itself. The editor
saves your changes straight into your GitHub repository, and GitHub decides who's allowed to. The
button needs a small free helper, the [Sveltia CMS Authenticator](https://github.com/sveltia/sveltia-cms-auth),
running on Cloudflare to finish GitHub's sign-in.

You need your GitHub account and a free [Cloudflare](https://dash.cloudflare.com/sign-up) account.
The same Cloudflare account hosts the website.

## 1. Put the site online

Follow [Share the website with friends](share-with-friends.md). Note your site's address, for
example `https://central-supply.pages.dev`.

## 2. Add the sign-in helper to Cloudflare

1. Open [github.com/sveltia/sveltia-cms-auth](https://github.com/sveltia/sveltia-cms-auth) and press
   **Deploy to Cloudflare**.
2. Sign in to Cloudflare and GitHub when asked, and keep the suggested settings.
3. When it's finished, copy the helper's address. It looks like
   `https://sveltia-cms-auth.YOUR-NAME.workers.dev`.

## 3. Register the sign-in on GitHub

1. Open [github.com/settings/applications/new](https://github.com/settings/applications/new).
2. Fill in:
   - **Application name:** `Central Supply admin`
   - **Homepage URL:** your site's address, e.g. `https://central-supply.pages.dev`
   - **Authorization callback URL:** the helper's address with `/callback` on the end, e.g.
     `https://sveltia-cms-auth.YOUR-NAME.workers.dev/callback`
3. Press **Register application**. Copy the **Client ID**, then press **Generate a new client
   secret** and copy that too. Keep the secret private: don't paste it into chat or any website file.

## 4. Give the helper those details

In Cloudflare, open **Workers & Pages → sveltia-cms-auth → Settings → Variables and Secrets** and add:

| Name | Type | Value |
| --- | --- | --- |
| `GITHUB_CLIENT_ID` | Text | the Client ID |
| `GITHUB_CLIENT_SECRET` | Secret | the client secret |
| `ALLOWED_DOMAINS` | Text | your site's address without `https://`, plus `localhost`, e.g. `central-supply.pages.dev, localhost` |

Then press **Deploy** (or **Save and deploy**).

## 5. Point the editor at the helper

Add the helper's address to `src/cms/config.yml`, under `backend:`:

```yaml
backend:
  name: github
  base_url: https://sveltia-cms-auth.YOUR-NAME.workers.dev
```

Commit and push. The site rebuilds in a couple of minutes. (Or just send the helper's address in
chat and it can be added for you. The address isn't secret.)

## 6. Sign in

Open your site's `/manage/` page, press **All products**, then **Sign In with GitHub** and approve it.
Each device stays signed in until you sign out.

## If something goes wrong

- **"The redirect_uri is not associated with this application":** the callback URL in step 3 must be
  exactly the helper's address followed by `/callback`.
- **"Your domain is not allowed to use the authenticator":** add your site's address (without
  `https://`) to `ALLOWED_DOMAINS` in step 4 and deploy again.
- **You can't sign in at all:** **Sign In Using Access Token** still works as a backup; see the
  README.
- **Saved changes don't appear:** in Cloudflare, open your Pages project → **Deployments** to see
  whether the rebuild finished.
