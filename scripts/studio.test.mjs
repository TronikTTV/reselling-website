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

async function openStore(github, key = 'good-key') {
  globalThis.fetch = github.fetch;
  const store = new Store(config, new GitHubBackend('me/store', 'main', key));
  await store.load();
  return store;
}

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
