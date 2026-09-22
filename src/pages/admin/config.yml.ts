// Serves the admin page's settings at /admin/config.yml.
// The template is src/cms/config.yml. The GitHub repository, branch and site
// address are filled in automatically when GitHub builds the site, so the
// admin page keeps working even if the repository is renamed.
import type { APIRoute } from 'astro';
import template from '../../cms/config.yml?raw';

export const GET: APIRoute = () => {
  const repo = process.env.GITHUB_REPOSITORY || 'your-github-username/your-repository';
  const branch = process.env.GITHUB_REF_NAME || 'main';
  const siteUrl = new URL(import.meta.env.BASE_URL, import.meta.env.SITE ?? 'http://localhost:4321').href;

  const config = template
    .replaceAll('__GITHUB_REPOSITORY__', repo)
    .replaceAll('__GITHUB_BRANCH__', branch)
    .replaceAll('__SITE_URL__', siteUrl);

  return new Response(config, { headers: { 'Content-Type': 'text/yaml; charset=utf-8' } });
};
