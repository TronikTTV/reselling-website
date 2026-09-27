# Connect this folder to your GitHub account

This folder is now connected to `https://github.com/TronikTTV/reselling-website.git`, with a local
commit named **First version of my store**. The steps below are retained for reference. New changes
are saved using **Commit to main**, then **Push origin** in GitHub Desktop.

1. Install [GitHub Desktop](https://desktop.github.com/) and sign in to your GitHub account.
2. Choose **File → Add local repository** and select `D:\reselling website`.
3. On the Changes tab, leave the website changes selected. Enter **First version of my store** in
   the Summary box, then click **Commit to main**.
4. Click **Publish repository**, name it **reselling-website**, and choose your personal account.
5. Choose whether the repository should be public or private, then click **Publish repository**.
   Public means other people can see the source code, product details and uploaded photos.
   Raw supplier review batches in `import/` are excluded by the existing ignore rules.
6. Use **Repository → View on GitHub** and copy the repository URL. Send that URL back in this chat
   so the remote and deployment setup can be checked. Do not send your account password or access token.

[GitHub Desktop’s official publishing instructions](https://docs.github.com/en/desktop/adding-and-cloning-repositories/adding-an-existing-project-to-github-using-github-desktop)

## Deployment already present in this project

The existing workflow is configured for GitHub Pages. GitHub Free supports Pages from a public
repository. If using Pages, set **Settings → Pages → Source → GitHub Actions**. Then open
**Actions → Deploy website → Run workflow**, select `main`, and run it. The first automatic run
can fail if Pages was not enabled when you published the repository.

Before using Pages for a reseller catalogue, check [GitHub’s Pages usage rules](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits):
they exclude sites primarily directed at facilitating commercial transactions. Keeping the code on
GitHub and choosing a suitable static host are separate decisions. No hosting changes have been made here.

## Editing your listings

Until the site is connected and deployed, run the local preview, open its `/admin/` page and choose
**Edit this PC's files**. After publishing, the store admin saves to the GitHub repository with your
admin key (see [Signing in](admin-sign-in.md)). A shared website PIN is not GitHub authentication.

The workflow fills in the repository address automatically. You do not need to put a GitHub password
in a file or send it in chat.
