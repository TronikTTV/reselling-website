// Where the Studio reads and saves the store's files.
//
// - GitHubBackend: the live store. Uses the owner's admin key (a GitHub access token) to read the
//   repository and to save every change as one commit, which Cloudflare Pages then publishes.
// - LocalBackend: only while running `npm run dev` on the owner's PC. Reads and writes the files in
//   the website folder directly (see scripts/studio-dev-api.mjs), for trying things without a key.

export interface RemoteFile {
  path: string;
  /** Git's id for the file's contents. */
  sha: string;
  size: number;
}

export interface Snapshot {
  /** The commit the files are from. */
  head: string;
  treeSha: string;
  /** When that commit was made (ISO). */
  date: string;
  /** Files under src/content/products/ and src/data/, by path. */
  files: Map<string, RemoteFile>;
}

export interface TreeChange {
  path: string;
  /** New text contents. */
  content?: string;
  /** New binary contents (photos and videos). */
  blob?: Blob;
  /** Copy of an existing file (duplicating a product's photos). */
  from?: RemoteFile;
  delete?: boolean;
  /** Set once a blob has been uploaded, so a retry doesn't upload it again. */
  uploaded?: string;
}

export type CommitResult = { head: string } | { conflict: true };

export interface CommitOptions {
  /** What's happening, in plain words, and how far through the uploads it is (0–1). */
  progress?: (text: string, fraction?: number) => void;
  /** Stops before saving (photos already sent are remembered, so the next try carries on). */
  signal?: AbortSignal;
}

export interface Activity {
  sha: string;
  message: string;
  date: string;
  author: string;
}

export interface Account {
  login: string;
  name?: string;
  avatar?: string;
}

export interface Backend {
  readonly kind: 'github' | 'local';
  /** The files as they are now, or as of a given commit. */
  snapshot(head?: string): Promise<Snapshot>;
  readText(file: RemoteFile): Promise<string>;
  readBlob(file: RemoteFile): Promise<Blob>;
  commit(base: Snapshot, changes: TreeChange[], message: string, options?: CommitOptions): Promise<CommitResult>;
  account(): Promise<Account>;
  activity(): Promise<Activity[]>;
  /** Headers that prove to this site's own endpoints (e.g. /api/identify) that it's the owner. */
  authHeaders(): Record<string, string>;
}

export type ErrorKind = 'auth' | 'permission' | 'missing' | 'rate' | 'network' | 'conflict' | 'invalid' | 'server' | 'cancelled';

export class StudioError extends Error {
  readonly kind: ErrorKind;
  readonly status: number;
  constructor(kind: ErrorKind, message: string, status = 0) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

const CONTENT_PATHS = ['src/content/products/', 'src/data/'];
const isContent = (path: string) => CONTENT_PATHS.some((prefix) => path.startsWith(prefix));

/** base64 of a file, for GitHub's upload API. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(blob);
  });
}

interface GitTreeEntry {
  path: string;
  type: string;
  sha: string;
  size?: number;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** The longest the Studio waits for GitHub in one go before giving up. */
const MAX_WAIT = 65 * MINUTE;
/** Waits before trying again after the connection drops or GitHub has a problem ("error 500"). */
const RETRY_WAITS = [3 * SECOND, 10 * SECOND, 30 * SECOND, 60 * SECOND];

export interface GitHubOptions {
  /**
   * How many saving requests (one per photo) to send per minute and per hour. GitHub turns away more
   * than 80 a minute or 500 an hour, which a big folder of photos easily reaches.
   */
  perMinute?: number;
  perHour?: number;
  /** For tests: a pretend clock. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

type WaitReason = 'pace' | 'hour' | 'rate' | 'retry';

const clock = (ms: number) => {
  const seconds = Math.ceil(ms / SECOND);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

function waitText(reason: WaitReason, left: number, until: number): string {
  if (reason === 'hour') {
    const time = new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `GitHub takes about 500 photos an hour, so the rest go at ${time} (in ${Math.ceil(left / MINUTE)} min). Keep this page open, or press Stop and publish later.`;
  }
  if (reason === 'rate') return `GitHub asked for a short break. Carrying on in ${clock(left)}…`;
  if (reason === 'retry') return `GitHub didn't answer properly (it happens when it's busy). Trying again in ${Math.ceil(left / SECOND)}s…`;
  return 'Sending photos at a steady pace so GitHub accepts them all…';
}

function uploadText(kind: string, index: number, total: number, elapsed: number): string {
  if (total === 1) return `Uploading ${kind}…`;
  let text = `Uploading ${kind} ${index + 1} of ${total}`;
  if (total >= 20 && index >= 5) {
    const left = (elapsed / index) * (total - index);
    text += left < MINUTE ? ' · under a minute left' : ` · about ${Math.round(left / MINUTE)} min left`;
  }
  return `${text}…`;
}

/** How long GitHub asked us to wait (see "rate limits" in GitHub's REST API docs). */
function retryDelay(response: Response, attempt: number, now: number): number {
  const after = Number(response.headers.get('retry-after'));
  if (response.headers.has('retry-after') && Number.isFinite(after) && after >= 0) return Math.max(after * SECOND, SECOND);
  if (response.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(response.headers.get('x-ratelimit-reset')) * SECOND;
    if (Number.isFinite(reset) && reset > now) return reset - now + SECOND;
  }
  // Otherwise at least a minute, longer each time.
  return Math.min(MINUTE * 2 ** attempt, 10 * MINUTE);
}

export class GitHubBackend implements Backend {
  readonly kind = 'github' as const;
  readonly repo: string;
  readonly branch: string;
  private readonly token: string;
  private readonly api: string;
  /** How many API calls are left this hour (GitHub allows 5,000 with a key). */
  rateRemaining: number | undefined;
  private readonly perMinute: number;
  private readonly perHour: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  /** When recent saving requests were sent, to keep under GitHub's limits. */
  private sentTimes: number[] = [];
  /** Photos and videos already on GitHub while this page is open, so trying again carries on. */
  private readonly sent = new WeakMap<Blob, string>();
  /** The publish in progress: where to say what's happening, and its Stop button. */
  private task: CommitOptions | null = null;
  private fraction: number | undefined;

  constructor(repo: string, branch: string, token: string, api = 'https://api.github.com', options: GitHubOptions = {}) {
    this.repo = repo;
    this.branch = branch;
    this.token = token;
    this.api = api;
    this.perMinute = options.perMinute ?? 60;
    this.perHour = options.perHour ?? 480;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
  }

  /**
   * Sends a request, waiting and trying again when GitHub asks for a break or the connection drops
   * for a moment, and keeping saving requests under GitHub's per-minute and per-hour limits.
   */
  private async request(path: string, init: RequestInit = {}, accept = 'application/vnd.github+json'): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Accept', accept);
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const saving = (init.method ?? 'GET') !== 'GET';
    let waited = 0;
    for (let attempt = 0; ; attempt++) {
      if (saving) waited += await this.pace();
      let response: Response;
      try {
        response = await fetch(`${this.api}${path}`, { cache: 'no-store', ...init, headers });
      } catch {
        if (attempt < RETRY_WAITS.length) {
          await this.pause(RETRY_WAITS[attempt], 'retry');
          continue;
        }
        throw new StudioError('network', "Couldn't reach GitHub. Check your internet connection and try again.");
      }
      const remaining = Number(response.headers.get('x-ratelimit-remaining'));
      if (Number.isFinite(remaining) && response.headers.has('x-ratelimit-remaining')) this.rateRemaining = remaining;
      if (response.ok) return response;
      const error = await this.error(response);
      if (error.kind === 'rate') {
        const delay = retryDelay(response, attempt, this.now());
        if (waited + delay <= MAX_WAIT) {
          waited += delay;
          await this.pause(delay, delay > 15 * MINUTE ? 'hour' : 'rate');
          continue;
        }
      } else if (error.kind === 'server' && error.status >= 500 && attempt < RETRY_WAITS.length) {
        // GitHub sometimes answers "500" when it's busy: it usually works a little later.
        await this.pause(RETRY_WAITS[attempt], 'retry');
        continue;
      }
      throw error;
    }
  }

  /** Spaces out saving requests (about one a second) and waits when this hour's allowance is used up. */
  private async pace(): Promise<number> {
    const now = this.now();
    this.sentTimes = this.sentTimes.filter((time) => now - time < HOUR);
    const last = this.sentTimes[this.sentTimes.length - 1];
    let delay = last === undefined ? 0 : Math.max(0, last + MINUTE / this.perMinute - now);
    if (this.sentTimes.length >= this.perHour) delay = Math.max(delay, this.sentTimes[this.sentTimes.length - this.perHour] + HOUR - now);
    if (delay > 0) await this.pause(delay, delay > MINUTE ? 'hour' : 'pace');
    this.sentTimes.push(this.now());
    return delay;
  }

  /** Waits, saying why when it's more than a moment. Pressing Stop ends the wait. */
  private async pause(ms: number, reason: WaitReason) {
    const until = this.now() + ms;
    for (;;) {
      this.checkStop();
      const left = until - this.now();
      if (left <= 0) return;
      if (reason !== 'pace' || left > 3 * SECOND) this.task?.progress?.(waitText(reason, left, until), this.fraction);
      await this.sleep(Math.min(left, SECOND));
    }
  }

  private checkStop() {
    if (this.task?.signal?.aborted) throw new StudioError('cancelled', 'Publishing stopped.');
  }

  /** Whether the branch is at this commit (to check a save whose answer got lost on the way back). */
  private async headIs(sha: string): Promise<boolean> {
    try {
      return (await this.json<{ object: { sha: string } }>(`/repos/${this.repo}/git/ref/heads/${this.branch}`)).object.sha === sha;
    } catch {
      return false;
    }
  }

  private async error(response: Response): Promise<StudioError> {
    let detail = '';
    try {
      const body = (await response.json()) as { message?: string };
      detail = body?.message ?? '';
    } catch {
      // Not JSON.
    }
    const { status } = response;
    if (status === 401) {
      return new StudioError('auth', "Your admin key didn't work. It may have been mistyped, or deleted on GitHub.", status);
    }
    if (
      status === 429 ||
      (status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after') || /rate limit|abuse/i.test(detail)))
    ) {
      return new StudioError('rate', 'GitHub is limiting how fast things can be saved right now. Wait a few minutes, then try again.', status);
    }
    if (status === 403) {
      return new StudioError(
        'permission',
        `Your admin key can't save changes. Make a new one with "Contents: Read and write" access to ${this.repo}.`,
        status,
      );
    }
    if (status === 404) {
      return new StudioError('missing', `GitHub couldn't find ${this.repo}. Check your admin key was made for that repository.`, status);
    }
    if (status === 409 || status === 422) {
      return new StudioError(/fast.?forward|reference/i.test(detail) ? 'conflict' : 'invalid', detail || 'GitHub turned that change down.', status);
    }
    return new StudioError('server', `GitHub had a problem (${status}${detail ? `: ${detail}` : ''}). Try again in a moment.`, status);
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await (await this.request(path, init)).json()) as T;
  }

  async snapshot(at?: string): Promise<Snapshot> {
    // Straight after saving, GitHub can briefly still report the old branch, so a known commit is read directly.
    const head = at ?? (await this.json<{ object: { sha: string } }>(`/repos/${this.repo}/git/ref/heads/${this.branch}`)).object.sha;
    const commit = await this.json<{ tree: { sha: string }; committer?: { date?: string } }>(`/repos/${this.repo}/git/commits/${head}`);
    const treeSha = commit.tree.sha;
    const tree = await this.json<{ tree: GitTreeEntry[]; truncated: boolean }>(`/repos/${this.repo}/git/trees/${treeSha}?recursive=1`);

    let entries = tree.tree;
    if (tree.truncated) entries = await this.contentEntries(treeSha);

    const files = new Map<string, RemoteFile>();
    for (const entry of entries) {
      if (entry.type === 'blob' && isContent(entry.path)) files.set(entry.path, { path: entry.path, sha: entry.sha, size: entry.size ?? 0 });
    }
    return { head, treeSha, date: commit.committer?.date ?? '', files };
  }

  /** For very big repositories: list just the products and data folders. */
  private async contentEntries(treeSha: string): Promise<GitTreeEntry[]> {
    const child = async (sha: string, name: string) =>
      (await this.json<{ tree: GitTreeEntry[] }>(`/repos/${this.repo}/git/trees/${sha}`)).tree.find((entry) => entry.path === name && entry.type === 'tree');
    const src = await child(treeSha, 'src');
    if (!src) return [];
    const [content, data] = await Promise.all([child(src.sha, 'content'), child(src.sha, 'data')]);
    const products = content ? await child(content.sha, 'products') : undefined;
    const list = async (entry: GitTreeEntry | undefined, prefix: string) =>
      entry
        ? (await this.json<{ tree: GitTreeEntry[] }>(`/repos/${this.repo}/git/trees/${entry.sha}?recursive=1`)).tree.map((item) => ({
            ...item,
            path: `${prefix}${item.path}`,
          }))
        : [];
    return [...(await list(products, 'src/content/products/')), ...(await list(data, 'src/data/'))];
  }

  async readBlob(file: RemoteFile): Promise<Blob> {
    // A file's contents never change for a given id, so the browser may keep a copy.
    return (await this.request(`/repos/${this.repo}/git/blobs/${file.sha}`, { cache: 'force-cache' }, 'application/vnd.github.raw')).blob();
  }

  async readText(file: RemoteFile): Promise<string> {
    return new TextDecoder().decode(await (await this.readBlob(file)).arrayBuffer());
  }

  async commit(base: Snapshot, changes: TreeChange[], message: string, options: CommitOptions = {}): Promise<CommitResult> {
    const { progress } = options;
    this.task = options;
    this.fraction = undefined;
    try {
      for (const change of changes) {
        const known = change.blob && !change.uploaded ? this.sent.get(change.blob) : undefined;
        if (known) change.uploaded = known;
      }
      const uploads = changes.filter((change) => change.blob && !change.uploaded);
      const started = this.now();
      for (const [index, change] of uploads.entries()) {
        this.checkStop();
        const kind = change.blob!.type.startsWith('video/') ? 'video' : 'photo';
        this.fraction = uploads.length > 1 ? index / uploads.length : undefined;
        progress?.(uploadText(kind, index, uploads.length, this.now() - started), this.fraction);
        const content = await blobToBase64(change.blob!);
        const blob = await this.json<{ sha: string }>(`/repos/${this.repo}/git/blobs`, {
          method: 'POST',
          body: JSON.stringify({ content, encoding: 'base64' }),
        });
        change.uploaded = blob.sha;
        this.sent.set(change.blob!, blob.sha);
      }
      this.checkStop();

      // Saving takes a moment from here, and stopping half-way could leave it unclear whether it saved.
      this.task = { progress };
      this.fraction = uploads.length > 1 ? 1 : undefined;
      progress?.('Saving…', this.fraction);
      const tree = changes.map((change) => {
        const entry = { path: change.path, mode: '100644', type: 'blob' };
        if (change.delete) return { ...entry, sha: null };
        if (change.content !== undefined) return { ...entry, content: change.content };
        return { ...entry, sha: change.uploaded ?? change.from?.sha };
      });
      let newTree: { sha: string };
      try {
        newTree = await this.json<{ sha: string }>(`/repos/${this.repo}/git/trees`, {
          method: 'POST',
          body: JSON.stringify({ base_tree: base.treeSha, tree }),
        });
      } catch (error) {
        // In case GitHub no longer has photos sent on an earlier try: send them again next time.
        for (const change of changes) if (change.blob) this.sent.delete(change.blob);
        throw error;
      }
      const commit = await this.json<{ sha: string }>(`/repos/${this.repo}/git/commits`, {
        method: 'POST',
        body: JSON.stringify({ message, tree: newTree.sha, parents: [base.head] }),
      });
      try {
        await this.request(`/repos/${this.repo}/git/refs/heads/${this.branch}`, {
          method: 'PATCH',
          body: JSON.stringify({ sha: commit.sha, force: false }),
        });
      } catch (error) {
        // The save may have worked with the answer lost on the way back (or a retry then refused).
        if (error instanceof StudioError && (error.kind === 'network' || error.kind === 'conflict' || error.status === 422) && (await this.headIs(commit.sha))) {
          return { head: commit.sha };
        }
        // Someone else saved in the meantime (e.g. from another phone): start again from theirs.
        if (error instanceof StudioError && (error.kind === 'conflict' || error.status === 422)) return { conflict: true };
        throw error;
      }
      return { head: commit.sha };
    } finally {
      this.task = null;
    }
  }

  authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }

  async account(): Promise<Account> {
    const user = await this.json<{ login: string; name?: string | null; avatar_url?: string }>('/user');
    return { login: user.login, name: user.name ?? undefined, avatar: user.avatar_url };
  }

  /** Checks the key can see the repository (it can't check it can save without saving something). */
  async check(): Promise<void> {
    await this.request(`/repos/${this.repo}`);
  }

  async activity(): Promise<Activity[]> {
    const commits = await this.json<
      { sha: string; commit: { message: string; author?: { name?: string; date?: string } }; author?: { login?: string } | null }[]
    >(`/repos/${this.repo}/commits?sha=${encodeURIComponent(this.branch)}&per_page=15`);
    return commits.map((item) => ({
      sha: item.sha,
      message: item.commit.message,
      date: item.commit.author?.date ?? '',
      author: item.author?.login ?? item.commit.author?.name ?? '',
    }));
  }
}

/** Files on this PC, through the dev server (npm run dev). */
export class LocalBackend implements Backend {
  readonly kind = 'local' as const;
  private readonly root: string;

  constructor(root = '/__studio') {
    this.root = root;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${this.root}${path}`, {
        cache: 'no-store',
        ...init,
        headers: { 'X-Studio': '1', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      });
    } catch {
      throw new StudioError('network', "Couldn't reach the preview on this PC. Is it still running?");
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new StudioError(response.status === 404 ? 'missing' : 'server', text || `The preview on this PC had a problem (${response.status}).`, response.status);
    }
    return response;
  }

  async snapshot(): Promise<Snapshot> {
    const data = (await (await this.request('/snapshot')).json()) as { head: string; date: string; files: RemoteFile[] };
    return { head: data.head, treeSha: data.head, date: data.date, files: new Map(data.files.map((file) => [file.path, file])) };
  }

  async readBlob(file: RemoteFile): Promise<Blob> {
    return (await this.request(`/file?path=${encodeURIComponent(file.path)}`)).blob();
  }

  async readText(file: RemoteFile): Promise<string> {
    return new TextDecoder().decode(await (await this.readBlob(file)).arrayBuffer());
  }

  async commit(_base: Snapshot, changes: TreeChange[], message: string, { progress }: CommitOptions = {}): Promise<CommitResult> {
    progress?.('Saving to this PC…');
    const payload = await Promise.all(
      changes.map(async (change) => {
        if (change.delete) return { path: change.path, delete: true };
        if (change.content !== undefined) return { path: change.path, content: change.content };
        if (change.blob) return { path: change.path, base64: await blobToBase64(change.blob) };
        return { path: change.path, from: change.from?.path };
      }),
    );
    const result = (await (await this.request('/commit', { method: 'POST', body: JSON.stringify({ message, changes: payload }) })).json()) as { head: string };
    return { head: result.head };
  }

  authHeaders(): Record<string, string> {
    return { 'X-Studio': '1' };
  }

  async account(): Promise<Account> {
    return { login: 'This PC' };
  }

  async activity(): Promise<Activity[]> {
    return (await (await this.request('/activity')).json()) as Activity[];
  }
}
