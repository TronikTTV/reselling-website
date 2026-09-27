// Serves the classic editor's settings at /admin/config.yml.
// The template is src/cms/config.yml. The GitHub repository, branch and site
// address are filled in automatically (see src/lib/repository.ts), so the
// editor keeps working even if the repository is renamed or the site moves host.
// The "Site text" section is generated from src/lib/copy-fields.ts, like the Studio's.
import type { APIRoute } from 'astro';
import template from '../../cms/config.yml?raw';
import { COPY_DEFAULTS, TEXT_GROUPS, type CopyKey } from '../../lib/copy-fields';
import { githubBranch, githubRepository } from '../../lib/repository';

const GROUP_LABELS: Record<string, string> = {
  common: 'Buttons',
  home: 'Home page',
  reel: 'Ads at the top',
  nav: 'Menu',
  search: 'Search',
  product: 'Product pages',
  shop: 'Shop & categories',
  footer: 'Footer',
  notFound: 'Page not found',
};

// JSON strings are valid double-quoted YAML strings.
const quote = (value: string) => JSON.stringify(value);

function siteTextFile(): string {
  const fields = new Map(TEXT_GROUPS.flatMap((group) => group.fields).map((field) => [field.key, field]));
  const groups = new Map<string, string[]>();
  for (const key of Object.keys(COPY_DEFAULTS)) {
    const [group, name] = key.split('.');
    groups.set(group, [...(groups.get(group) ?? []), name]);
  }

  const lines = [
    '      - name: text',
    '        label: Site text',
    '        file: src/data/content.json',
    '        fields:',
  ];
  for (const [group, names] of groups) {
    lines.push(
      `          - name: ${group}`,
      `            label: ${quote(GROUP_LABELS[group] ?? group)}`,
      '            widget: object',
      '            required: false',
      '            collapsed: true',
      '            fields:',
    );
    for (const name of names) {
      const key = `${group}.${name}` as CopyKey;
      const field = fields.get(`copy:${key}`);
      const hint = [`Default: ${COPY_DEFAULTS[key]}`, field?.hint].filter(Boolean).join(' · ');
      lines.push(
        `              - name: ${name}`,
        `                label: ${quote(field?.label ?? name)}`,
        `                widget: ${field?.long ? 'text' : 'string'}`,
        '                required: false',
        `                hint: ${quote(hint)}`,
      );
    }
  }
  return lines.join('\n');
}

export const GET: APIRoute = () => {
  const siteUrl = new URL(import.meta.env.BASE_URL, import.meta.env.SITE ?? 'http://localhost:4321').href;

  const config = template
    .replaceAll('__GITHUB_REPOSITORY__', githubRepository())
    .replaceAll('__GITHUB_BRANCH__', githubBranch())
    .replaceAll('__SITE_URL__', siteUrl)
    .replace(/^[ \t]*# __SITE_TEXT__.*$/m, siteTextFile());

  return new Response(config, { headers: { 'Content-Type': 'text/yaml; charset=utf-8' } });
};
