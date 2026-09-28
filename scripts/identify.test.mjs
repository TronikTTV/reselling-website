// Tests for /api/identify (functions/api/identify.ts → src/lib/identify.ts), the AI behind the Studio's
// "Add from photos".
// Workers AI and GitHub are replaced by fakes. Run with `npm run test:studio`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onRequestGet, onRequestPost } from '../functions/api/identify.ts';
import { readAnswer, tidy } from '../src/lib/identify.ts';

const CATEGORIES = [
  { slug: 'shoes', name: 'Trainers & Shoes' },
  { slug: 'fragrances', name: 'Colognes & Fragrances' },
  { slug: 'watches', name: 'Watches' },
];
const IMAGE = `data:image/jpeg;base64,${Buffer.from('fake jpeg').toString('base64')}`;

let githubCalls = 0;
/** GitHub says which keys can change the store. */
function fakeGitHub(allowedKeys) {
  githubCalls = 0;
  globalThis.fetch = async (url, init) => {
    githubCalls += 1;
    assert.match(String(url), /^https:\/\/api\.github\.com\/repos\/TronikTTV\/reselling-website$/);
    const key = new Headers(init.headers).get('Authorization')?.replace('Bearer ', '');
    assert.ok(new Headers(init.headers).get('User-Agent'), 'GitHub needs a User-Agent');
    if (!key || key === 'broken') return new Response('{}', { status: 401 });
    return new Response(JSON.stringify({ permissions: { push: allowedKeys.includes(key), pull: true } }), { status: 200 });
  };
}

const post = (body, key = 'owner-key') =>
  new Request('https://central-supply.pages.dev/api/identify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });

const aiAnswering = (...answers) => {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      const answer = answers.shift();
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
};

test('says whether the AI is switched on', async () => {
  assert.deepEqual(await (await onRequestGet({ request: new Request('https://x/api/identify'), env: { AI: aiAnswering() } })).json(), { ai: true });
  assert.deepEqual(await (await onRequestGet({ request: new Request('https://x/api/identify'), env: {} })).json(), { ai: false });
});

test('only the store owner can use it', async () => {
  fakeGitHub(['owner-key']);
  const ai = aiAnswering();
  const noKey = await onRequestPost({ request: post({ image: IMAGE, categories: CATEGORIES }, ''), env: { AI: ai } });
  assert.equal(noKey.status, 401);
  const stranger = await onRequestPost({ request: post({ image: IMAGE, categories: CATEGORIES }, 'someone-elses-key'), env: { AI: ai } });
  assert.equal(stranger.status, 403);
  const broken = await onRequestPost({ request: post({ image: IMAGE, categories: CATEGORIES }, 'broken'), env: { AI: ai } });
  assert.equal(broken.status, 403);
  assert.equal(ai.calls.length, 0, 'the AI was never asked');
});

test('turns a photo into a tidy listing', async () => {
  fakeGitHub(['owner-key']);
  const ai = aiAnswering({
    response: `Sure! Here it is:\n{"category":"Trainers & Shoes","title":"\\"Nike Dunk Low Retro Panda\\"","brand":"Nike","description":"100% authentic Nike Dunk Low in the classic black and white Panda colourway. Leather upper.","includes":["original box","Price tag","Dust bag"],"condition":"brand new","colourway":"White/Black","styleCode":"DD1391-100","price":"£119.50","confidence":0.92}`,
  });
  const response = await onRequestPost({ request: post({ image: IMAGE, categories: CATEGORIES, currency: 'GBP', filename: 'IMG_2041' }), env: { AI: ai } });
  assert.equal(response.status, 200);
  const { listing, model } = await response.json();
  assert.equal(model, '@cf/meta/llama-4-scout-17b-16e-instruct');
  assert.deepEqual(listing, {
    category: 'shoes',
    title: 'Nike Dunk Low Retro Panda',
    brand: 'Nike',
    description: 'Nike Dunk Low in the classic black and white Panda colourway. Leather upper.',
    includes: ['Original box', 'Dust bag'],
    condition: 'Brand new',
    colourway: 'White/Black',
    styleCode: 'DD1391-100',
    price: 120,
    confidence: 0.92,
  });
  // The photo went to the model as a data URL, with the store's categories in the question.
  const { input } = ai.calls[0];
  const [, user] = input.messages;
  assert.equal(user.content[1].image_url.url, IMAGE);
  assert.match(user.content[0].text, /shoes \(Trainers & Shoes\)/);
  assert.match(user.content[0].text, /IMG_2041/);
  assert.equal(input.response_format.type, 'json_schema');
});

test('checks the key with GitHub once per batch, not once per photo', async () => {
  fakeGitHub(['batch-key']);
  const ai = aiAnswering({ response: { category: 'watches', title: 'Watch', description: 'A watch.', price: 100 } }, { response: { category: 'watches', title: 'Watch 2', description: 'Another.', price: 90 } });
  await onRequestPost({ request: post({ image: IMAGE, categories: CATEGORIES }, 'batch-key'), env: { AI: ai } });
  await onRequestPost({ request: post({ image: IMAGE, categories: CATEGORIES }, 'batch-key'), env: { AI: ai } });
  assert.equal(githubCalls, 1);
});

test('uses the second model when the first is busy', async () => {
  fakeGitHub(['owner-key']);
  const ai = aiAnswering(new Error('3040: Capacity temporarily exceeded'), { response: { category: 'fragrances', title: 'Dior Sauvage EDT 100ml', description: 'Fresh and spicy.', price: 85 } });
  const response = await onRequestPost({ request: post({ image: IMAGE, categories: CATEGORIES }), env: { AI: ai } });
  const { listing, model } = await response.json();
  assert.equal(model, '@cf/mistralai/mistral-small-3.1-24b-instruct');
  assert.equal(listing.title, 'Dior Sauvage EDT 100ml');
  assert.ok(ai.calls[1].input.guided_json, 'the second model gets its JSON shape its own way');
});

test('explains when the free allowance is used up for the day', async () => {
  fakeGitHub(['owner-key']);
  const ai = aiAnswering(new Error('4006: you have used up your daily free allocation of 10,000 neurons'));
  const response = await onRequestPost({ request: post({ image: IMAGE, categories: CATEGORIES }), env: { AI: ai } });
  assert.equal(response.status, 429);
  assert.match((await response.json()).error, /free AI allowance/);
  assert.equal(ai.calls.length, 1, "doesn't try the other model when the allowance is gone");
});

test('turns away bad requests', async () => {
  fakeGitHub(['owner-key']);
  const ai = aiAnswering();
  const noImage = await onRequestPost({ request: post({ image: 'https://example.com/photo.jpg', categories: CATEGORIES }), env: { AI: ai } });
  assert.equal(noImage.status, 400);
  const noCategories = await onRequestPost({ request: post({ image: IMAGE, categories: [] }), env: { AI: ai } });
  assert.equal(noCategories.status, 400);
  const noAi = await onRequestPost({ request: post({ image: IMAGE, categories: CATEGORIES }), env: {} });
  assert.equal(noAi.status, 503);
});

test('reading and tidying answers', () => {
  assert.equal(readAnswer({ response: 'not json at all' }), null);
  assert.deepEqual(readAnswer({ response: { title: 'x' } }), { title: 'x' });
  assert.deepEqual(readAnswer('```json\n{"title":"y"}\n```'), { title: 'y' });
  const odd = tidy({ category: 'spaceships', title: 'x'.repeat(200), price: -5, confidence: 7, includes: 'box' }, CATEGORIES);
  assert.equal(odd.category, '');
  assert.equal(odd.title.length, 90);
  assert.equal(odd.price, null);
  assert.equal(odd.confidence, 1);
  assert.deepEqual(odd.includes, []);
});
