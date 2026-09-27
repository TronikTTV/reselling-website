// Which commit the site was built from, so the admin Studio can tell when a change has gone live.
// Used at build time only.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export interface BuildInfo {
  commit: string;
  builtAt: string;
}

function localCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/** Cloudflare Pages and GitHub Actions say which commit they're building; locally, ask git. */
export const buildInfo = (): BuildInfo => ({
  commit: process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || localCommit(),
  builtAt: new Date().toISOString(),
});

/** The id git (and GitHub) gives a file's contents, so the Studio can tell whether a file has changed since. */
export const gitBlobSha = (bytes: Uint8Array) =>
  createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
