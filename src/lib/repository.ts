// Works out which GitHub repository and branch the admin editor saves to. Used at build time only.
import { execSync } from 'node:child_process';

/** Used when neither the build host nor git can say (e.g. a copy of the folder without git). */
const DEFAULT_REPOSITORY = 'TronikTTV/reselling-website';

/** "owner/repo": from the build host's settings, otherwise from this folder's git remote. */
export function githubRepository(): string {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const remote = execSync('git config --get remote.origin.url', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // Only the owner and name are kept, never anything else that may be in the URL.
    const match = remote.trim().match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
    if (match) return `${match[1]}/${match[2]}`;
  } catch {
    // Not a git folder: fall back to the default below.
  }
  return DEFAULT_REPOSITORY;
}

/** The branch being built (GitHub Actions, then Cloudflare Pages), otherwise "main". */
export const githubBranch = (): string => process.env.GITHUB_REF_NAME || process.env.CF_PAGES_BRANCH || 'main';

/**
 * GitHub's "new fine-grained token" page with everything filled in except picking the repository:
 * a key that can only change files, never expires, and can be deleted at any time.
 */
export function adminKeyUrl(): string {
  const [owner, name] = githubRepository().split('/');
  const params = new URLSearchParams({
    name: 'Central Supply admin',
    description: `Lets the store editor save changes to ${owner}/${name}. Delete it to sign the editor out everywhere.`,
    target_name: owner,
    expires_in: 'none',
    contents: 'write',
  });
  return `https://github.com/settings/personal-access-tokens/new?${params}`;
}
