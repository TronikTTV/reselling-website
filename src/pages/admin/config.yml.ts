// Serves the admin page's settings at /admin/config.yml.
// The template is src/cms/config.yml. The GitHub repository, branch and site
// address are filled in automatically (see src/lib/repository.ts), so the
// admin page keeps working even if the repository is renamed or the site moves host.
import type { APIRoute } from 'astro';
import template from '../../cms/config.yml?raw';
import { githubBranch, githubRepository } from '../../lib/repository';

export const GET: APIRoute = () => {
  const siteUrl = new URL(import.meta.env.BASE_URL, import.meta.env.SITE ?? 'http://localhost:4321').href;

  const config = template
    .replaceAll('__GITHUB_REPOSITORY__', githubRepository())
    .replaceAll('__GITHUB_BRANCH__', githubBranch())
    .replaceAll('__SITE_URL__', siteUrl);

  return new Response(config, { headers: { 'Content-Type': 'text/yaml; charset=utf-8' } });
};
