// Talking to the site's /api/identify (functions/api/identify.ts): send a small copy of a product photo,
// get back a suggested listing. On this PC (npm run dev) a stand-in answers with sample suggestions.
import { StudioError } from './backend.ts';
import type { Store } from '../store.ts';

export interface Suggestion {
  category: string;
  title: string;
  brand: string;
  description: string;
  includes: string[];
  condition: string;
  colourway: string;
  styleCode: string;
  price: number | null;
  confidence: number;
}

export interface AiStatus {
  available: boolean;
  /** Only sample answers (the preview on this PC), not the real AI. */
  sample: boolean;
}

let status: Promise<AiStatus> | undefined;

/** Whether "Add from photos" can be used on this copy of the site. */
export function aiStatus(store: Store): Promise<AiStatus> {
  status ??= fetch(store.siteUrl('/api/identify'), { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) return { available: false, sample: false };
      const body = (await response.json()) as { ai?: boolean; sample?: boolean };
      return { available: body.ai === true, sample: body.sample === true };
    })
    .catch(() => ({ available: false, sample: false }));
  return status;
}

/** A JPEG data URL at most `size` pixels across: small enough to send, big enough to recognise. */
async function smallJpeg(photo: Blob, size = 640): Promise<string> {
  const bitmap = await createImageBitmap(photo);
  const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.82);
}

export async function identify(store: Store, photo: Blob, filename = ''): Promise<{ listing: Suggestion; sample: boolean }> {
  const image = await smallJpeg(photo);
  let response: Response;
  try {
    response = await fetch(store.siteUrl('/api/identify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...store.backend.authHeaders() },
      body: JSON.stringify({
        image,
        categories: store.categories().map(({ slug, name }) => ({ slug, name })),
        currency: store.settings().currency,
        filename: filename.replace(/\.[^.]+$/, ''),
      }),
    });
  } catch {
    throw new StudioError('network', "Couldn't reach the AI. Check your internet connection and try again.");
  }
  const body = (await response.json().catch(() => ({}))) as { listing?: Suggestion; error?: string; sample?: boolean };
  if (!response.ok || !body.listing) {
    throw new StudioError(response.status === 429 ? 'rate' : 'server', body.error || `The AI had a problem (${response.status}).`, response.status);
  }
  return { listing: body.listing, sample: body.sample === true };
}
