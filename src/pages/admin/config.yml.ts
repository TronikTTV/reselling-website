// Serves the admin page's settings at /admin/config.yml.
// The template is src/cms/config.yml. The GitHub repository, branch and site
// address are filled in automatically, so the admin page keeps working even if
// the repository is renamed or the site moves host.
import { execSync } from 'node:child_process';
import type { APIRoute } from 'astro';
import template from '../../cms/config.yml?raw';

/** "owner/repo": from the build host's settings, otherwise from this folder's git remote. */
function repository() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const remote = execSync('git config --get remote.origin.url', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    // Only the owner and name are kept, never anything else that may be in the URL.
    const match = remote.trim().match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
    if (match) return `${match[1]}/${match[2]}`;
  } catch {
    // Not a git folder; fall through to the placeholder.
  }
  return 'your-github-username/your-repository';
}

export const GET: APIRoute = () => {
  const branch = process.env.GITHUB_REF_NAME || process.env.CF_PAGES_BRANCH || 'main';
  const siteUrl = new URL(import.meta.env.BASE_URL, import.meta.env.SITE ?? 'http://localhost:4321').href;

  const config = template
    .replaceAll('__GITHUB_REPOSITORY__', repository())
    .replaceAll('__GITHUB_BRANCH__', branch)
    .replaceAll('__SITE_URL__', siteUrl);

  return new Response(config, { headers: { 'Content-Type': 'text/yaml; charset=utf-8' } });
};
