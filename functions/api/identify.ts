// /api/identify: the admin Studio's "Add from photos" (a Cloudflare Pages Function). The work is done in
// src/lib/identify.ts; GET says whether the AI is available, POST looks at one photo.
import { identifyPhoto, identifyStatus, type IdentifyEnv } from '../../src/lib/identify.ts';

interface PagesContext {
  request: Request;
  env: IdentifyEnv;
}

export const onRequestGet = ({ env }: PagesContext) => identifyStatus(env);

export const onRequestPost = ({ request, env }: PagesContext) => identifyPhoto(request, env);
