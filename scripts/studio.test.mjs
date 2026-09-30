// Tests for the admin Studio's saving logic (run with `npm run test:studio`).
// The GitHub API is replaced by a small in-memory fake that behaves like the real one for the calls
// the Studio makes, so publishing can be checked end to end without a real repository or key.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { accentParts } from '../src/lib/copy-fields.ts';
import { GitHubBackend } from '../src/studio/lib/backend.ts';
import { parseProduct, writeProduct } from '../src/studio/lib/product-file.ts';
import { Store } from '../src/studio/store.ts';

// The browser's FileReader, for turning uploads into base64 (Node doesn't have one).
globalThis.FileReader ??= class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then(
      (buffer) => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
        this.onload?.();
      },
      (error) => {
        this.error = error;
        this.onerror?.();
      },
    );
  }
};

const sha1 = (text) => createHash('sha1').update(text).digest('hex');
const blobSha = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

/** A tiny GitHub: blobs, flat trees, commits and one branch. */
function fakeGitHub(files) {
  const blobs = new Map();
  const trees = new Map();
  const commits = new Map();
  const calls = [];
  let head = '';
  let beforeRefUpdate = null;

  const putBlob = (bytes) => {
    const sha = blobSha(bytes);
    blobs.set(sha, bytes);
    return sha;
  };
  const putTree = (entries) => {
    const sha = sha1(JSON.stringify([...entries].sort()));
    trees.set(sha, new Map(entries));
    return sha;
  };
  const putCommit = (tree, parents, message) => {
    const sha = sha1(`${tree}${parents.join()}${message}${commits.size}`);
    commits.set(sha, { sha, tree, parents, message, date: new Date(Date.now() + commits.size * 1000).toISOString() });
    return sha;
  };
  const treeOf = (commit) => trees.get(commits.get(commit).tree);

  head = putCommit(putTree(Object.entries(files).map(([path, text]) => [path, putBlob(Buffer.from(text))])), [], 'Initial');

  /** Lets a test sneak in another commit (like a second device) just before the Studio's. */
  const commitElsewhere = (changes, message = 'Saved elsewhere') => {
    const entries = new Map(treeOf(head));
    for (const [path, text] of Object.entries(changes)) {
      if (text === null) entries.delete(path);
      else entries.set(path, putBlob(Buffer.from(text)));
    }
    head = putCommit(putTree(entries), [head], message);
  };

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'x-ratelimit-remaining': '4999' } });

  async function fetch(input, init = {}) {
    const url = new URL(String(input), 'https://api.github.com');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push(`${method} ${url.pathname}`);
    if (url.pathname.startsWith('/admin/')) return new Response('missing', { status: 404 });

    const auth = new Headers(init.headers).get('Authorization');
    if (auth !== 'Bearer good-key') return json({ message: 'Bad credentials' }, 401);

    const path = url.pathname.replace('/repos/me/store', '');
    if (url.pathname === '/user') return json({ login: 'owner', avatar_url: 'https://example.com/a.png' });
    if (path === '' && method === 'GET') return json({ full_name: 'me/store' });
    if (path === '/git/ref/heads/main') return json({ object: { sha: head } });
    let match;
    if ((match = /^\/git\/commits\/(\w+)$/.exec(path))) {
      const commit = commits.get(match[1]);
      return json({ sha: commit.sha, tree: { sha: commit.tree }, committer: { date: commit.date } });
    }
    if ((match = /^\/git\/trees\/(\w+)$/.exec(path)) && method === 'GET') {
      const tree = trees.get(match[1]);
      return json({ tree: [...tree].map(([file, sha]) => ({ path: file, type: 'blob', sha, size: blobs.get(sha).length })), truncated: false });
    }
    if ((match = /^\/git\/blobs\/(\w+)$/.exec(path))) return new Response(blobs.get(match[1]));
    if (path === '/git/blobs' && method === 'POST') {
      assert.equal(body.encoding, 'base64');
      return json({ sha: putBlob(Buffer.from(body.content, 'base64')) }, 201);
    }
    if (path === '/git/trees' && method === 'POST') {
      const entries = new Map(trees.get(body.base_tree));
      for (const entry of body.tree) {
        assert.equal(entry.mode, '100644');
        if (entry.content !== undefined) entries.set(entry.path, putBlob(Buffer.from(entry.content)));
        else if (entry.sha === null) {
          assert.ok(entries.has(entry.path), `deleting a file that isn't there: ${entry.path}`);
          entries.delete(entry.path);
        } else {
          assert.ok(blobs.has(entry.sha), `unknown blob for ${entry.path}`);
          entries.set(entry.path, entry.sha);
        }
      }
      return json({ sha: putTree(entries) }, 201);
    }
    if (path === '/git/commits' && method === 'POST') return json({ sha: putCommit(body.tree, body.parents, body.message) }, 201);
    if (path === '/git/refs/heads/main' && method === 'PATCH') {
      if (beforeRefUpdate) {
        const run = beforeRefUpdate;
        beforeRefUpdate = null;
        run();
      }
      const commit = commits.get(body.sha);
      if (!body.force && commit.parents[0] !== head) return json({ message: 'Update is not a fast forward' }, 422);
      head = body.sha;
      return json({ object: { sha: head } });
    }
    if (path === '/commits') return json([...commits.values()].reverse().map((commit) => ({ sha: commit.sha, commit: { message: commit.message, author: { name: 'owner', date: commit.date } }, author: { login: 'owner' } })));
    return json({ message: `Not handled: ${method} ${url.pathname}` }, 404);
  }

  return {
    fetch,
    calls,
    commitElsewhere,
    onNextRefUpdate: (run) => (beforeRefUpdate = run),
    get head() {
      return head;
    },
    message: () => commits.get(head).message,
    /** Every commit's message on the branch, oldest first. */
    history: () => {
      const list = [];
      for (let sha = head; sha; sha = commits.get(sha).parents[0]) list.unshift(commits.get(sha).message);
      return list;
    },
    text: (path) => {
      const sha = treeOf(head).get(path);
      return sha ? blobs.get(sha).toString('utf8') : undefined;
    },
    bytes: (path) => blobs.get(treeOf(head).get(path)),
    paths: () => [...treeOf(head).keys()].sort(),
  };
}

const PRODUCT = `---
title: "Black Cap"
images:
  - photo-1.webp
  - photo-2.webp
category: hats
brand: "Demo Co."
price: 25
status: available
tags:
  - "black"
date: 2026-09-22T06:00:00.000Z
---

A **cap**.
`;

const STARTING_FILES = {
  'src/content/products/black-cap/index.md': PRODUCT,
  'src/content/products/black-cap/photo-1.webp': 'photo one',
  'src/content/products/black-cap/photo-2.webp': 'photo two',
  'src/content/products/old-watch/index.md': '---\ntitle: Old Watch\nimages:\n  - w.webp\ncategory: watches\n---\n',
  'src/content/products/old-watch/w.webp': 'watch photo',
  'src/data/settings.json': `${JSON.stringify({ siteName: 'Central Supply', heroHeading: 'Rare finds.', ticker: ['Fresh drops'], contact: { instagram: 'me' } }, null, 2)}\n`,
  'src/data/categories.json': `${JSON.stringify({ categories: [{ name: 'Hats', slug: 'hats' }, { name: 'Watches', slug: 'watches' }] }, null, 2)}\n`,
  'src/data/content.json': `${JSON.stringify({ home: { shopButton: 'Shop the drop' } }, null, 2)}\n`,
  'README.md': 'not the Studio’s business',
};

const config = { repo: 'me/store', branch: 'main', base: '/', site: 'https://example.com/', keyUrl: '', dev: false, siteName: 'Central Supply' };

/** A pretend clock, so waiting for GitHub takes no real time in tests. */
function fakeClock(start = Date.parse('2026-09-29T12:00:00Z')) {
  const clock = {
    time: start,
    now: () => clock.time,
    sleep: async (ms) => {
      clock.time += ms;
    },
  };
  return clock;
}

async function openStore(github, key = 'good-key', options = {}) {
  globalThis.fetch = options.fetch ?? github.fetch;
  const clock = options.clock ?? fakeClock();
  const store = new Store(config, new GitHubBackend('me/store', 'main', key, undefined, { sleep: clock.sleep, now: clock.now, ...options.limits }));
  await store.load();
  return store;
}

/** Adds a new product with `count` photos, like "Add from folders" does. */
function addProductWithPhotos(store, title, count) {
  const product = store.createProduct('hats');
  store.updateProduct(product.id, { title, price: 50 });
  store.addPhotos(
    product.id,
    Array.from({ length: count }, (_, index) => ({ name: `photo-${index + 1}-abcde.webp`, blob: new Blob([`${title} photo ${index + 1}`], { type: 'image/webp' }) })),
  );
  return product;
}

const isBlobUpload = (input, init) => init?.method === 'POST' && String(input).endsWith('/git/blobs');
const rateLimited = (headers = {}) =>
  new Response(JSON.stringify({ message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

test('product files: untouched fields keep their formatting', () => {
  const data = parseProduct(PRODUCT);
  assert.equal(writeProduct(PRODUCT, data, []), PRODUCT);
  const edited = writeProduct(PRODUCT, { ...data, price: 30, title: 'Black Cap "Panda"' }, ['price', 'title']);
  assert.match(edited, /^title: "Black Cap \\"Panda\\""$/m);
  assert.match(edited, /^price: 30$/m);
  assert.match(edited, /^brand: "Demo Co."$/m);
  assert.match(edited, /\n\nA \*\*cap\*\*\.\n$/);
  assert.deepEqual(parseProduct(edited).tags, ['black']);
});

test('product files: blank values are left out, and files without front matter still work', () => {
  const data = parseProduct(PRODUCT);
  const edited = writeProduct(PRODUCT, { ...data, brand: '', price: null, tags: [] }, ['brand', 'price', 'tags']);
  assert.doesNotMatch(edited, /^(brand|price|tags):/m);
  const plain = writeProduct('Just a description.', { ...data, title: 'New' }, ['title']);
  assert.match(plain, /^---\ntitle: New\n/);
  assert.match(plain, /\n\nJust a description\.\n$/);
});

test('italic accents: *stars*, or the last word', () => {
  assert.deepEqual(accentParts('Shop by *vibe*'), [
    { text: 'Shop by ', accent: false },
    { text: 'vibe', accent: true },
  ]);
  assert.deepEqual(accentParts('More heat'), [
    { text: 'More ', accent: false },
    { text: 'heat', accent: true },
  ]);
  assert.deepEqual(accentParts('Slide into *the DMs.*'), [
    { text: 'Slide into ', accent: false },
    { text: 'the DMs.', accent: true },
  ]);
  assert.deepEqual(accentParts(''), []);
});

test('signing in with a wrong key explains what happened', async () => {
  const github = fakeGitHub(STARTING_FILES);
  globalThis.fetch = github.fetch;
  const backend = new GitHubBackend('me/store', 'main', 'wrong-key');
  await assert.rejects(backend.check(), (error) => error.kind === 'auth' && /admin key/.test(error.message));
});

test('loading: products, settings and text come from the repository', async () => {
  const github = fakeGitHub(STARTING_FILES);
  const store = await openStore(github);
  assert.deepEqual(
    store.productList().map((product) => product.id).sort(),
    ['black-cap', 'old-watch'],
  );
  assert.equal(store.product('black-cap').data.price, 25);
  assert.equal(store.settings().heroHeading, 'Rare finds.');
  assert.equal(store.shownText('copy:home.shopButton'), 'Shop the drop');
  assert.equal(store.shownText('copy:home.moreLink'), 'Shop all', 'missing text falls back to its default');
  assert.deepEqual(store.changes(), []);
});

test('publishing: every kind of change goes in one commit', async () => {
  const github = fakeGitHub(STARTING_FILES);
  const store = await openStore(github);

  store.updateProduct('black-cap', { price: 32.5, status: 'reserved', featured: true });
  store.addPhotos('black-cap', [{ name: 'new-side-1a2b3.webp', blob: new Blob(['new photo bytes'], { type: 'image/webp' }) }]);
  const cap = store.product('black-cap');
  store.updateProduct('black-cap', { images: ['new-side-1a2b3.webp', ...cap.data.images.filter((name) => name !== 'photo-1.webp' && name !== 'new-side-1a2b3.webp')] });
  store.setVideo('black-cap', { name: 'clip-9f8e7.mp4', blob: new Blob(['video bytes'], { type: 'video/mp4' }) });

  const created = store.createProduct('hats');
  store.updateProduct(created.id, { title: 'Nike Dunk Low Panda', price: 120 });
  store.addPhotos(created.id, [{ name: 'dunk-00001.webp', blob: new Blob(['dunk'], { type: 'image/webp' }) }]);
  const copy = store.duplicateProduct('old-watch');
  store.deleteProduct('old-watch');

  store.setText('copy:home.shopButton', 'Cop now');
  store.setText('site:heroHeading', 'Grails only.');
  store.setText('site:ticker', 'Fresh drops\nDM to cop');
  store.setSetting('contact.tiktok', 'centralsupply');
  store.setCategories([...store.categories(), { name: 'Shoes', slug: 'shoes' }]);

  assert.equal(store.changes().length, 7);
  const before = github.head;
  const head = await store.publish();
  assert.ok(head && head !== before);
  assert.equal(github.head, head);
  assert.match(github.message(), /^Update 7 things: /);
  assert.match(github.message(), /Saved from the store admin \(Studio\)\.$/);

  // The edited product: only the changed lines differ, new photo and video uploaded, old photo deleted.
  const capFile = github.text('src/content/products/black-cap/index.md');
  assert.match(capFile, /^price: 32\.5$/m);
  assert.match(capFile, /^status: reserved$/m);
  assert.match(capFile, /^featured: true$/m);
  assert.match(capFile, /^video: clip-9f8e7\.mp4$/m);
  assert.match(capFile, /^images:\n {2}- new-side-1a2b3\.webp\n {2}- photo-2\.webp$/m);
  assert.match(capFile, /^brand: "Demo Co\."$/m);
  assert.equal(github.text('src/content/products/black-cap/new-side-1a2b3.webp'), 'new photo bytes');
  assert.equal(github.text('src/content/products/black-cap/clip-9f8e7.mp4'), 'video bytes');
  assert.equal(github.text('src/content/products/black-cap/photo-1.webp'), undefined);

  // The new product, with its folder named after it.
  const newFolder = github.paths().find((path) => /^src\/content\/products\/nike-dunk-low-panda-[0-9a-f]{4}\/index\.md$/.test(path));
  assert.ok(newFolder, 'new product saved');
  assert.match(github.text(newFolder), /^title: Nike Dunk Low Panda$/m);
  assert.equal(github.text(newFolder.replace('index.md', 'dunk-00001.webp')), 'dunk');
  assert.equal(store.renamed.get(created.id), newFolder.split('/')[3]);

  // The duplicate is a draft with the original's photo, which was copied, not re-uploaded.
  const copyFolder = github.paths().find((path) => /^src\/content\/products\/old-watch-copy-[0-9a-f]{4}\/index\.md$/.test(path));
  assert.ok(copyFolder, 'duplicate saved');
  assert.match(github.text(copyFolder), /^draft: true$/m);
  assert.equal(github.text(copyFolder.replace('index.md', 'w.webp')), 'watch photo');
  assert.ok(!store.renamed.has(copy.id) || store.renamed.get(copy.id) === copyFolder.split('/')[3]);

  // The deleted product is gone with its photo; nothing outside the Studio's folders was touched.
  assert.ok(!github.paths().some((path) => path.startsWith('src/content/products/old-watch/')));
  assert.equal(github.text('README.md'), 'not the Studio’s business');

  // Settings, text and categories.
  const settings = JSON.parse(github.text('src/data/settings.json'));
  assert.equal(settings.heroHeading, 'Grails only.');
  assert.deepEqual(settings.ticker, ['Fresh drops', 'DM to cop']);
  assert.equal(settings.contact.tiktok, 'centralsupply');
  assert.equal(settings.contact.instagram, 'me');
  assert.equal(JSON.parse(github.text('src/data/content.json')).home.shopButton, 'Cop now');
  assert.deepEqual(JSON.parse(github.text('src/data/categories.json')).categories.map((category) => category.slug), ['hats', 'watches', 'shoes']);

  // Afterwards the Studio shows the saved state with nothing left to publish.
  assert.deepEqual(store.changes(), []);
  assert.equal(store.product('black-cap').data.price, 32.5);
  assert.equal(store.snapshot.head, head);
});

test('publishing: changes saved elsewhere in the meantime are kept', async () => {
  const github = fakeGitHub(STARTING_FILES);
  const store = await openStore(github);

  // Another device changes the same product's description and the tagline after the Studio loaded…
  github.commitElsewhere({
    'src/content/products/black-cap/index.md': PRODUCT.replace('A **cap**.', 'Edited on my phone.'),
    'src/data/settings.json': `${JSON.stringify({ siteName: 'Central Supply', heroHeading: 'Rare finds.', tagline: 'From the phone', ticker: ['Fresh drops'], contact: { instagram: 'me' } }, null, 2)}\n`,
  });
  // …and again right as the Studio saves, forcing it to start over.
  github.onNextRefUpdate(() => github.commitElsewhere({ 'src/content/products/old-watch/index.md': '---\ntitle: Old Watch (renamed)\nimages:\n  - w.webp\ncategory: watches\n---\n' }));

  store.updateProduct('black-cap', { price: 40 });
  store.setText('site:heroHeading', 'Grails only.');
  store.addPhotos('black-cap', [{ name: 'extra-12345.webp', blob: new Blob(['extra'], { type: 'image/webp' }) }]);
  await store.publish();

  const capFile = github.text('src/content/products/black-cap/index.md');
  assert.match(capFile, /^price: 40$/m, 'our change');
  assert.match(capFile, /Edited on my phone\./, 'their change');
  assert.match(capFile, /- extra-12345\.webp/);
  const settings = JSON.parse(github.text('src/data/settings.json'));
  assert.equal(settings.heroHeading, 'Grails only.');
  assert.equal(settings.tagline, 'From the phone');
  assert.match(github.text('src/content/products/old-watch/index.md'), /renamed/);
  // The photo was uploaded once, even though saving had to start again.
  assert.equal(github.calls.filter((call) => call === 'POST /repos/me/store/git/blobs').length, 1);
});

test('publishing: problems are caught before anything is saved', async () => {
  const github = fakeGitHub(STARTING_FILES);
  const store = await openStore(github);
  const created = store.createProduct('hats');
  store.updateProduct(created.id, { price: 10 });
  const before = github.head;
  await assert.rejects(store.publish(), /needs a name/);
  assert.equal(github.head, before);
  store.discardProduct(created.id);
  assert.deepEqual(store.changes(), []);
  assert.equal(await store.publish(), null, 'nothing to publish');
});

test('undoing a change back to how it was leaves nothing to publish', async () => {
  const github = fakeGitHub(STARTING_FILES);
  const store = await openStore(github);
  store.updateProduct('black-cap', { price: 99 });
  store.updateProduct('black-cap', { price: 25 });
  store.setText('copy:home.shopButton', 'Something else');
  store.setText('copy:home.shopButton', 'Shop the drop');
  assert.deepEqual(store.changes(), []);
});

test('publishing lots of photos: sent about one a second, and a "slow down" from GitHub is waited out', async () => {
  const github = fakeGitHub(STARTING_FILES);
  const clock = fakeClock();
  const sentAt = [];
  let refusals = 1;
  const fetch = async (input, init) => {
    if (isBlobUpload(input, init)) {
      // GitHub turns the third photo away once, asking for 30 seconds' break.
      if (sentAt.length === 2 && refusals-- > 0) return rateLimited({ 'retry-after': '30' });
      sentAt.push(clock.time);
    }
    return github.fetch(input, init);
  };
  const store = await openStore(github, 'good-key', { fetch, clock });
  addProductWithPhotos(store, 'Jordan 4 Military Black', 6);

  const messages = [];
  const fractions = [];
  const head = await store.publish((text, fraction) => {
    messages.push(text);
    if (fraction !== undefined) fractions.push(fraction);
  });

  assert.ok(head, 'published');
  const folder = github.paths().find((path) => /^src\/content\/products\/jordan-4-military-black-[0-9a-f]{4}\/index\.md$/.test(path));
  assert.ok(folder);
  for (let index = 1; index <= 6; index++) {
    assert.equal(github.text(folder.replace('index.md', `photo-${index}-abcde.webp`)), `Jordan 4 Military Black photo ${index}`);
  }
  assert.equal(sentAt.length, 6, 'each photo stored once');
  for (let index = 1; index < sentAt.length; index++) assert.ok(sentAt[index] - sentAt[index - 1] >= 1000, 'at most one photo a second');
  assert.ok(sentAt[2] - sentAt[1] >= 30_000, 'waited as long as GitHub asked');
  assert.ok(messages.some((text) => /GitHub asked for a short break/.test(text)));
  assert.ok(messages.some((text) => /^Uploading photo 6 of 6/.test(text)));
  assert.deepEqual(fractions.slice(0, 2), [0, 1 / 6]);
  assert.equal(fractions.at(-1), 1);
});

test('publishing: after it fails part-way, trying again carries on without sending photos twice', async () => {
  const github = fakeGitHub(STARTING_FILES);
  let stored = 0;
  let dropsAfter = 3;
  const fetch = async (input, init) => {
    if (isBlobUpload(input, init)) {
      // The connection drops after three photos, for longer than the Studio's own retries.
      if (stored === dropsAfter) throw new TypeError('Failed to fetch');
      stored += 1;
    }
    return github.fetch(input, init);
  };
  const store = await openStore(github, 'good-key', { fetch });
  addProductWithPhotos(store, 'Corteiz Alcatraz Hoodie', 5);
  const before = github.head;

  await assert.rejects(store.publish(), (error) => error.kind === 'network');
  assert.equal(github.head, before, 'nothing saved');
  assert.equal(store.changes().length, 1, 'the new product is still waiting to be published');

  dropsAfter = -1; // Back online.
  const head = await store.publish();
  assert.ok(head);
  assert.equal(stored, 5, 'the three photos sent before were not sent again');
  const folder = github.paths().find((path) => path.includes('corteiz-alcatraz-hoodie-') && path.endsWith('/index.md'));
  assert.match(github.text(folder), /- photo-5-abcde\.webp/);
  assert.equal(github.text(folder.replace('index.md', 'photo-1-abcde.webp')), 'Corteiz Alcatraz Hoodie photo 1');
});

test('publishing: Stop ends it before anything is saved, and the next try finishes the job', async () => {
  const github = fakeGitHub(STARTING_FILES);
  const store = await openStore(github);
  addProductWithPhotos(store, 'Stussy 8 Ball Tee', 4);
  const before = github.head;

  const stopper = new AbortController();
  await assert.rejects(
    store.publish((text) => {
      if (/^Uploading photo 3 of 4/.test(text)) stopper.abort();
    }, stopper.signal),
    (error) => error.kind === 'cancelled',
  );
  assert.equal(github.head, before, 'nothing saved');
  assert.equal(store.publishing, false);
  assert.equal(store.changes().length, 1);

  const uploads = () => github.calls.filter((call) => call === 'POST /repos/me/store/git/blobs').length;
  assert.ok(uploads() < 4, 'stopped before sending them all');
  assert.ok(await store.publish());
  assert.equal(uploads(), 4, 'the rest were sent on the next try, none twice');
  assert.ok(github.paths().some((path) => path.includes('stussy-8-ball-tee-') && path.endsWith('photo-4-abcde.webp')));
});

test('publishing: a save whose answer is lost on the way back still counts as saved (no duplicates)', async () => {
  const github = fakeGitHub(STARTING_FILES);
  let dropAnswer = true;
  const fetch = async (input, init) => {
    const response = await github.fetch(input, init);
    // GitHub moves the branch, but the answer never arrives.
    if (init?.method === 'PATCH' && dropAnswer) {
      dropAnswer = false;
      throw new TypeError('Failed to fetch');
    }
    return response;
  };
  const store = await openStore(github, 'good-key', { fetch });
  addProductWithPhotos(store, 'Nike Tech Fleece', 1);
  const head = await store.publish();
  assert.equal(head, github.head);
  assert.equal(github.paths().filter((path) => path.includes('nike-tech-fleece-') && path.endsWith('/index.md')).length, 1);
  assert.deepEqual(store.changes(), []);
});

test('publishing more photos than GitHub takes in an hour waits for the next hour, then finishes', async () => {
  const github = fakeGitHub(STARTING_FILES);
  const clock = fakeClock();
  const start = clock.time;
  const store = await openStore(github, 'good-key', { clock, limits: { perHour: 4 } });
  addProductWithPhotos(store, 'Carhartt Detroit Jacket', 6);
  const messages = [];
  assert.ok(await store.publish((text) => messages.push(text)));
  assert.ok(clock.time - start >= 60 * 60_000, 'waited for the hour');
  assert.ok(messages.some((text) => /GitHub takes about 500 photos an hour/.test(text)));
  assert.equal(github.paths().filter((path) => path.includes('carhartt-detroit-jacket-') && path.endsWith('.webp')).length, 6);
});

test('GitHub saying "too many requests" is explained plainly when waiting would take too long', async () => {
  const github = fakeGitHub(STARTING_FILES);
  const clock = fakeClock();
  const fetch = async (input, init) =>
    // Out of requests until two hours from now: longer than the Studio waits.
    isBlobUpload(input, init)
      ? rateLimited({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.round(clock.time / 1000) + 2 * 3600) })
      : github.fetch(input, init);
  const store = await openStore(github, 'good-key', { fetch, clock });
  addProductWithPhotos(store, 'Arc Teryx Beta', 1);
  await assert.rejects(store.publish(), (error) => error.kind === 'rate' && /Wait a few minutes, then try again/.test(error.message));
});

test('a big upload is published in parts of about 40 photos, each saved as it goes', async () => {
  const github = fakeGitHub(STARTING_FILES);
  const store = await openStore(github);
  for (let index = 1; index <= 5; index++) addProductWithPhotos(store, `Drop ${index}`, 12);
  store.setText('site:heroHeading', 'New drop.');

  const messages = [];
  const stoppable = [];
  const head = await store.publish((text, fraction, canStop) => {
    messages.push(text);
    stoppable.push(canStop);
  });
  assert.ok(head);

  // 60 photos: three products (36 photos, plus the text) in part 1, two in part 2.
  const saves = github.history().slice(1);
  assert.equal(saves.length, 2);
  assert.match(saves[0], /^Update 4 things: .*\(part 1 of 2\)\n/);
  assert.match(saves[1], /^Update 2 things: Drop 4, Drop 5 \(part 2 of 2\)\n/);
  assert.ok(messages.some((text) => /^Part 1 of 2 · Uploading photo 36 of 36/.test(text)));
  assert.ok(messages.some((text) => /^Part 2 of 2 · Uploading photo 24 of 24/.test(text)));
  assert.equal(stoppable[messages.indexOf('Part 1 of 2 · Saving…')], false, 'no Stop while a part is saving');

  for (let index = 1; index <= 5; index++) {
    const folder = github.paths().find((path) => path.startsWith(`src/content/products/drop-${index}-`) && path.endsWith('/index.md'));
    assert.ok(folder, `Drop ${index} saved`);
    assert.equal(github.paths().filter((path) => path.startsWith(folder.replace('index.md', '')) && path.endsWith('.webp')).length, 12);
  }
  assert.equal(JSON.parse(github.text('src/data/settings.json')).heroHeading, 'New drop.');
  assert.deepEqual(store.changes(), []);
});

test('if a later part fails, the parts before stay saved, and trying again finishes the rest once', async () => {
  const github = fakeGitHub(STARTING_FILES);
  let stored = 0;
  let broken = true;
  const fetch = async (input, init) => {
    if (isBlobUpload(input, init)) {
      // GitHub keeps failing ("error 500") from the 37th photo, i.e. in part 2.
      if (broken && stored === 36) return new Response(JSON.stringify({ message: 'Server Error' }), { status: 500 });
      stored += 1;
    }
    return github.fetch(input, init);
  };
  const store = await openStore(github, 'good-key', { fetch });
  for (let index = 1; index <= 5; index++) addProductWithPhotos(store, `Drop ${index}`, 12);

  const messages = [];
  await assert.rejects(
    store.publish((text) => messages.push(text)),
    (error) => error.kind === 'server' && /500/.test(error.message),
  );
  assert.ok(messages.some((text) => /GitHub didn't answer properly/.test(text)), 'retried before giving up');
  assert.deepEqual(store.publishReport, { saved: 1, parts: 2 });
  const savedFolders = () => github.paths().filter((path) => /^src\/content\/products\/drop-\d-[0-9a-f]{4}\/index\.md$/.test(path));
  assert.equal(savedFolders().length, 3, 'part 1 is on the branch');
  assert.deepEqual(
    store.changes().map((change) => change.title),
    ['New: Drop 4', 'New: Drop 5'],
    'only part 2 is still waiting',
  );
  assert.ok(store.product(savedFolders()[0].split('/')[3]), 'saved products are shown under their folder');

  broken = false;
  assert.ok(await store.publish());
  assert.equal(savedFolders().length, 5, 'no duplicates');
  assert.equal(stored, 60, 'every photo stored exactly once');
  assert.deepEqual(store.changes(), []);
});
