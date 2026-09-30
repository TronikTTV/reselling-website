// The AI behind the admin Studio's "Add from photos": looks at one product photo with Cloudflare
// Workers AI and suggests a listing (category, title, brand, description, what's included, condition
// and a price). Served at /api/identify by functions/api/identify.ts, a Cloudflare Pages Function, so
// it runs on Cloudflare using the account's free daily Workers AI allowance (on the free plan it simply
// stops for the day when that's used up). The AI binding is set up in wrangler.toml.
//
// Only the store owner can use it: requests must carry the admin key, and GitHub must confirm that key
// can change the store's repository.

interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface IdentifyEnv {
  AI?: AiBinding;
  /** "owner/repo" whose admin keys may use this. */
  STORE_REPO?: string;
}

interface Category {
  slug: string;
  name: string;
}

export interface Listing {
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

const DEFAULT_REPO = 'TronikTTV/reselling-website';

/** Tried in order: the first is the best at recognising products; the second takes over if it's busy. */
const MODELS = ['@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/mistralai/mistral-small-3.1-24b-instruct'];

// Keep in step with src/studio/views/product-form.ts.
const INCLUDES = ['Original box', 'Replacement box', 'StockX tag', 'Receipt / proof of purchase', 'Dust bag', 'Extra laces', 'All original accessories'];
const CONDITIONS = ['Brand new', 'New with tags', 'Like new', 'Very good', 'Good', 'Fair'];

const MAX_IMAGE_CHARS = 2_500_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

// ---------------------------------------------------------------- who's asking

/** Keys already checked with GitHub (by hash, never the key itself), so a batch of photos checks once. */
const approved = new Map<string, number>();

async function hash(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function canChangeStore(key: string, repo: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const id = await hash(`${repo}:${key}`);
  if ((approved.get(id) ?? 0) > Date.now()) return true;
  const response = await fetcher(`https://api.github.com/repos/${repo}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'central-supply-studio',
    },
  });
  if (!response.ok) return false;
  const data = (await response.json()) as { permissions?: { push?: boolean; admin?: boolean } };
  const allowed = data.permissions?.push === true || data.permissions?.admin === true;
  if (allowed) approved.set(id, Date.now() + 10 * 60_000);
  return allowed;
}

// ---------------------------------------------------------------- asking the AI

export function prompt(categories: Category[], currency: string, filename = '') {
  const symbol = { GBP: '£', EUR: '€', USD: '$', CAD: 'CA$', AUD: 'A$' }[currency] ?? currency;
  return [
    'Look at this photo of one item for sale and write its listing for a UK resale store (sneakers, streetwear, watches, fragrances, accessories, electronics).',
    filename ? `The photo's file name is "${filename}" (it may or may not describe the item).` : '',
    '',
    'Reply with JSON only, with these fields:',
    `- category: the best match from these slugs: ${categories.map((category) => `${category.slug} (${category.name})`).join(', ')}.`,
    `- title: what a reseller would call it, e.g. "Nike Dunk Low Retro Panda", "Carolina Herrera Good Girl 80ml", "Stone Island Crewneck Sweatshirt". Brand and model when you can recognise them. Max 70 characters, no emojis.`,
    '- brand: the brand, or "" if you can\'t tell.',
    '- description: 2 or 3 short, friendly sentences in UK English about what it is, its colour and standout details you can see. Don\'t mention the photo, don\'t call it authentic, genuine or verified, and don\'t guess a size.',
    `- includes: only things you can see in the photo, from this list: ${INCLUDES.join(', ')}. Otherwise [].`,
    `- condition: one of ${CONDITIONS.join(', ')}, judged from the photo, or "".`,
    '- colourway: its main colours, e.g. "White/Black", or "".',
    '- styleCode: only if a style code or SKU is clearly readable in the photo, otherwise "".',
    `- price: a typical resale price in ${currency} (${symbol}) for this item in the condition shown, as a number. If you can't tell exactly what it is, estimate from similar items.`,
    '- confidence: from 0 to 1, how sure you are what the item is.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

const SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string' },
    title: { type: 'string' },
    brand: { type: 'string' },
    description: { type: 'string' },
    includes: { type: 'array', items: { type: 'string' } },
    condition: { type: 'string' },
    colourway: { type: 'string' },
    styleCode: { type: 'string' },
    price: { type: 'number' },
    confidence: { type: 'number' },
  },
  required: ['category', 'title', 'description', 'price'],
};

/** The model's answer as an object, whether it came back as an object or as text with JSON in it. */
export function readAnswer(result: unknown): Record<string, unknown> | null {
  const answer = result && typeof result === 'object' && 'response' in result ? (result as { response: unknown }).response : result;
  if (answer && typeof answer === 'object') return answer as Record<string, unknown>;
  if (typeof answer !== 'string') return null;
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(answer.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const text = (value: unknown, max: number) =>
  (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)).replace(/\s+/g, ' ').trim().slice(0, max);

/** Keeps only sensible values, so a confused answer can't put nonsense in the store. */
export function tidy(raw: Record<string, unknown>, categories: Category[]): Listing {
  const slugs = new Map(categories.map((category) => [category.slug.toLowerCase(), category.slug]));
  const names = new Map(categories.map((category) => [category.name.toLowerCase(), category.slug]));
  const wanted = text(raw.category, 160).toLowerCase();
  const category = slugs.get(wanted) ?? names.get(wanted) ?? categories.find((item) => wanted && (item.name.toLowerCase().includes(wanted) || wanted.includes(item.slug)))?.slug ?? '';

  const includes = (Array.isArray(raw.includes) ? raw.includes : [])
    .map((item) => INCLUDES.find((allowed) => allowed.toLowerCase() === text(item, 60).toLowerCase()))
    .filter((item): item is string => Boolean(item));
  const condition = CONDITIONS.find((allowed) => allowed.toLowerCase() === text(raw.condition, 40).toLowerCase()) ?? '';

  const amount = typeof raw.price === 'number' ? raw.price : Number(String(raw.price ?? '').replace(/[^0-9.]/g, ''));
  const price = Number.isFinite(amount) && amount > 0 ? Math.round(amount) : null;
  const confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) ? Math.min(1, Math.max(0, raw.confidence)) : 0.5;
  const description = text(raw.description, 600).replace(/\b(100% )?(authentic|genuine|legit|verified)\b[,.]?\s*/gi, '').trim();

  return {
    category,
    title: text(raw.title, 90).replace(/^["']|["']$/g, ''),
    brand: text(raw.brand, 60),
    description,
    includes: [...new Set(includes)],
    condition,
    colourway: text(raw.colourway, 60),
    styleCode: text(raw.styleCode, 40),
    price,
    confidence,
  };
}

async function ask(ai: AiBinding, image: string, categories: Category[], currency: string, filename: string) {
  const messages = [
    { role: 'system', content: 'You write product listings for a UK resale store. You always reply with a single JSON object and nothing else.' },
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt(categories, currency, filename) },
        { type: 'image_url', image_url: { url: image } },
      ],
    },
  ];
  let lastError: unknown;
  for (const model of MODELS) {
    try {
      const options = model.includes('llama-4')
        ? { response_format: { type: 'json_schema', json_schema: SCHEMA } }
        : { guided_json: SCHEMA };
      const answer = readAnswer(await ai.run(model, { messages, max_tokens: 700, temperature: 0.2, ...options }));
      if (answer) return { answer, model };
      lastError = new Error('The AI gave an answer that could not be read.');
    } catch (error) {
      lastError = error;
      // Used up for today: no point trying the other model.
      if (/limit|neuron|quota|429/i.test(String(error))) break;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------- the endpoint

/** GET: whether the AI is available (nothing is sent to it). */
export function identifyStatus(env: IdentifyEnv): Response {
  return json({ ai: Boolean(env.AI) });
}

/** POST: { image: data URL, categories: [{ slug, name }], currency, filename } → { listing, model }. */
export async function identifyPhoto(request: Request, env: IdentifyEnv): Promise<Response> {
  const key = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!key) return json({ error: 'Sign in to the store admin first.' }, 401);
  let allowed = false;
  try {
    allowed = await canChangeStore(key, env.STORE_REPO || DEFAULT_REPO);
  } catch {
    return json({ error: "Couldn't check your admin key with GitHub. Try again in a moment." }, 502);
  }
  if (!allowed) return json({ error: "Your admin key can't change this store, so it can't use Add from photos." }, 403);
  if (!env.AI) return json({ error: "The AI isn't switched on for this site. It needs the AI binding in wrangler.toml." }, 503);

  let body: { image?: unknown; categories?: unknown; currency?: unknown; filename?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'That request was empty.' }, 400);
  }
  const image = typeof body.image === 'string' ? body.image : '';
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(image) || image.length > MAX_IMAGE_CHARS) {
    return json({ error: 'Send one photo (JPEG, PNG or WebP) of up to about 1.8 MB.' }, 400);
  }
  const categories = (Array.isArray(body.categories) ? body.categories : [])
    // Sub-categories have longer addresses and names ("shoes/nike/p-6000", "Trainers & Shoes › Nike › P-6000").
    .map((item) => ({ slug: text((item as Category)?.slug, 160), name: text((item as Category)?.name, 200) }))
    .filter((item) => /^[a-z0-9-]+$/.test(item.slug) && item.name)
    .slice(0, 60);
  if (categories.length === 0) return json({ error: 'The store has no categories to choose from.' }, 400);
  const currency = /^[A-Z]{3}$/.test(String(body.currency)) ? String(body.currency) : 'GBP';
  const filename = text(body.filename, 80).replace(/["\\]/g, '');

  try {
    const { answer, model } = await ask(env.AI, image, categories, currency, filename);
    return json({ listing: tidy(answer, categories), model });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    if (/limit|neuron|quota|429/i.test(message)) {
      return json({ error: "Today's free AI allowance has been used up. It resets tomorrow; you can still fill these in yourself." }, 429);
    }
    return json({ error: "The AI couldn't look at that photo just now. Try again in a moment." }, 502);
  }
}
