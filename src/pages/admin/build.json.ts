// /admin/build.json: the commit this copy of the site was built from. The admin Studio checks it after
// publishing to tell the owner when their changes are live.
import type { APIRoute } from 'astro';
import { root } from 'astro:config/server';
import { fileURLToPath } from 'node:url';
import { buildInfo } from '../../lib/build-info';

export const GET: APIRoute = () =>
  new Response(JSON.stringify(buildInfo(fileURLToPath(root))), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
