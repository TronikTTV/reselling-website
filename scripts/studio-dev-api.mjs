// Only while running `npm run dev`: lets the admin Studio (/admin/) read and save the website folder's
// files directly ("Edit this PC's files"), without an admin key. Nothing here is part of the built site.
//
// It only touches src/content/products/ and src/data/, and only answers the Studio itself (requests
// must carry the X-Studio header, which other websites can't send to this server).
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOTS = ['src/content/products/', 'src/data/'];
const MAX_BODY = 60 * 1024 * 1024;
const TYPES = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const gitSha = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

// "Add from photos" on this PC: the real AI only runs on the live site (functions/api/identify.ts), so
// this gives sample suggestions from the photo's file name, clearly marked as samples.
const GUESSES = [
  [/watch|rolex|omega|casio|seiko|chrono/, 'watches'],
  [/cap|hat|beanie|bucket/, 'hats'],
  [/dunk|jordan|yeezy|trainer|sneaker|shoe|air ?max|air ?force|samba|gazelle|new ?balance|slide/, 'shoes'],
  [/hoodie|tee|t-?shirt|shirt|jacket|jumper|sweat|trouser|jeans|shorts|coat|fleece|tracksuit/, 'clothing'],
  [/sunglass|glasses|shades/, 'glasses'],
  [/sock/, 'socks'],
  [/airpod|earbud|headphone|phone|console|switch|playstation|ps5|ipad|laptop|speaker/, 'electronics'],
  [/perfume|parfum|cologne|fragrance|toilette|edp|edt|\d+ ?ml\b/, 'fragrances'],
  [/bag|backpack|tote|pouch/, 'bags'],
  [/chain|ring|bracelet|necklace|pendant|earring/, 'jewellery'],
  [/wallet|belt|cardholder|keyring|scarf/, 'accessories'],
];

function sampleListing(filename, categories) {
  const words = String(filename || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const lower = words.toLowerCase();
  const slugs = new Set(categories.map((category) => category.slug));
  const guess = GUESSES.find(([pattern, slug]) => slugs.has(slug) && pattern.test(lower));
  const title = words && !/^(img|dsc|photo|image|pxl)\s?\d/i.test(words) ? words.replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'New piece';
  return {
    category: guess ? guess[1] : (categories[0]?.slug ?? ''),
    title,
    brand: '',
    description: 'Sample description: on your live site the AI writes this from the photo.',
    includes: [],
    condition: '',
    colourway: '',
    styleCode: '',
    price: null,
    confidence: 0.2,
  };
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const json = (res, body) => send(res, 200, body, 'application/json; charset=utf-8');

/** A repository path the Studio may touch, or null. */
function safePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value)) return null;
  const normal = path.posix.normalize(value);
  if (normal !== value || normal.split('/').includes('..')) return null;
  return ROOTS.some((root) => normal.startsWith(root)) ? normal : null;
}

async function walk(root, folder, files) {
  let entries = [];
  try {
    entries = await fs.readdir(path.join(root, folder), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const relative = `${folder}${entry.name}`;
    if (entry.isDirectory()) await walk(root, `${relative}/`, files);
    else if (entry.isFile()) files.push(relative);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Too big: upload files of 24 MB or less.'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const gitLog = (root) =>
  new Promise((resolve) => {
    execFile('git', ['log', '-15', '--format=%H%x1f%s%x1f%aI%x1f%an'], { cwd: root }, (error, stdout) => {
      if (error) return resolve([]);
      resolve(
        stdout
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const [sha, message, date, author] = line.split('\x1f');
            return { sha, message, date, author };
          }),
      );
    });
  });

export default function studioDevApi() {
  let root = process.cwd();

  async function snapshot() {
    const paths = [];
    for (const folder of ROOTS) await walk(root, folder, paths);
    const files = [];
    let latest = 0;
    for (const file of paths.sort()) {
      const full = path.join(root, file);
      const [bytes, stat] = await Promise.all([fs.readFile(full), fs.stat(full)]);
      latest = Math.max(latest, stat.mtimeMs);
      files.push({ path: file, sha: gitSha(bytes), size: bytes.length });
    }
    const head = createHash('sha1')
      .update(files.map((file) => `${file.path} ${file.sha}`).join('\n'))
      .digest('hex');
    return { head, date: new Date(latest || Date.now()).toISOString(), files };
  }

  async function commit(body) {
    const { changes } = JSON.parse(body);
    if (!Array.isArray(changes)) throw new Error('No changes sent.');
    const touched = new Set();
    for (const change of changes) {
      const file = safePath(change?.path);
      if (!file) throw new Error(`Not allowed: ${change?.path}`);
      const full = path.join(root, file);
      touched.add(path.dirname(full));
      if (change.delete) {
        await fs.rm(full, { force: true });
        continue;
      }
      await fs.mkdir(path.dirname(full), { recursive: true });
      if (typeof change.content === 'string') await fs.writeFile(full, change.content, 'utf8');
      else if (typeof change.base64 === 'string') await fs.writeFile(full, Buffer.from(change.base64, 'base64'));
      else if (typeof change.from === 'string') {
        const source = safePath(change.from);
        if (!source) throw new Error(`Not allowed: ${change.from}`);
        await fs.copyFile(path.join(root, source), full);
      } else throw new Error(`Nothing to save for ${file}`);
    }
    // Remove product folders that are now empty (a deleted product).
    for (const folder of touched) {
      if (!folder.startsWith(path.join(root, 'src/content/products'))) continue;
      try {
        if ((await fs.readdir(folder)).length === 0) await fs.rmdir(folder);
      } catch {
        // Already gone.
      }
    }
    return (await snapshot()).head;
  }

  return {
    name: 'studio-dev-api',
    apply: 'serve',
    configResolved(config) {
      root = config.root || root;
    },
    configureServer(server) {
      server.middlewares.use('/api/identify', async (req, res) => {
        try {
          if (req.method === 'GET') return json(res, { ai: true, sample: true });
          if (req.method !== 'POST') return send(res, 405, 'POST only.');
          const body = JSON.parse((await readBody(req)) || '{}');
          const categories = Array.isArray(body.categories) ? body.categories : [];
          return json(res, { listing: sampleListing(body.filename, categories), sample: true, model: 'sample' });
        } catch (error) {
          return send(res, 500, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), 'application/json');
        }
      });

      server.middlewares.use('/__studio', async (req, res) => {
        try {
          const origin = req.headers.origin;
          if (req.headers['x-studio'] !== '1' || (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin))) {
            return send(res, 403, 'The Studio API only answers the Studio on this PC.');
          }
          const url = new URL(req.url ?? '/', 'http://localhost');
          if (req.method === 'GET' && url.pathname === '/snapshot') return json(res, await snapshot());
          if (req.method === 'GET' && url.pathname === '/activity') return json(res, await gitLog(root));
          if (req.method === 'GET' && url.pathname === '/file') {
            const file = safePath(url.searchParams.get('path'));
            if (!file) return send(res, 400, 'Not allowed.');
            try {
              const bytes = await fs.readFile(path.join(root, file));
              return send(res, 200, bytes, TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
            } catch {
              return send(res, 404, 'Not found.');
            }
          }
          if (req.method === 'POST' && url.pathname === '/commit') return json(res, { head: await commit(await readBody(req)) });
          return send(res, 404, 'Not found.');
        } catch (error) {
          return send(res, 500, error instanceof Error ? error.message : String(error));
        }
      });
    },
  };
}
