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
  commit(base: Snapshot, changes: TreeChange[], message: string, progress?: (text: string) => void): Promise<CommitResult>;
  account(): Promise<Account>;
  activity(): Promise<Activity[]>;
}

export type ErrorKind = 'auth' | 'permission' | 'missing' | 'rate' | 'network' | 'conflict' | 'invalid' | 'server';

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

export class GitHubBackend implements Backend {
  readonly kind = 'github' as const;
  readonly repo: string;
  readonly branch: string;
  private readonly token: string;
  private readonly api: string;
  /** How many API calls are left this hour (GitHub allows 5,000 with a key). */
  rateRemaining: number | undefined;

  constructor(repo: string, branch: string, token: string, api = 'https://api.github.com') {
    this.repo = repo;
    this.branch = branch;
    this.token = token;
    this.api = api;
  }

  private async request(path: string, init: RequestInit = {}, accept = 'application/vnd.github+json'): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Accept', accept);
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    let response: Response;
    try {
      response = await fetch(`${this.api}${path}`, { cache: 'no-store', ...init, headers });
    } catch {
      throw new StudioError('network', "Couldn't reach GitHub. Check your internet connection and try again.");
    }
    const remaining = Number(response.headers.get('x-ratelimit-remaining'));
    if (Number.isFinite(remaining) && response.headers.has('x-ratelimit-remaining')) this.rateRemaining = remaining;
    if (!response.ok) throw await this.error(response);
    return response;
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
    if ((status === 403 || status === 429) && (response.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(detail))) {
      return new StudioError('rate', 'GitHub needs a short break (too many requests this hour). Try again in a few minutes.', status);
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

  async commit(base: Snapshot, changes: TreeChange[], message: string, progress?: (text: string) => void): Promise<CommitResult> {
    const uploads = changes.filter((change) => change.blob && !change.uploaded);
    let count = 0;
    for (const change of uploads) {
      count += 1;
      const kind = change.blob!.type.startsWith('video/') ? 'video' : 'photo';
      progress?.(uploads.length > 1 ? `Uploading ${kind} ${count} of ${uploads.length}…` : `Uploading ${kind}…`);
      const content = await blobToBase64(change.blob!);
      const blob = await this.json<{ sha: string }>(`/repos/${this.repo}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content, encoding: 'base64' }),
      });
      change.uploaded = blob.sha;
    }

    progress?.('Saving…');
    const tree = changes.map((change) => {
      const entry = { path: change.path, mode: '100644', type: 'blob' };
      if (change.delete) return { ...entry, sha: null };
      if (change.content !== undefined) return { ...entry, content: change.content };
      return { ...entry, sha: change.uploaded ?? change.from?.sha };
    });
    const newTree = await this.json<{ sha: string }>(`/repos/${this.repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: base.treeSha, tree }),
    });
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
      // Someone else saved in the meantime (e.g. from another phone): start again from theirs.
      if (error instanceof StudioError && (error.kind === 'conflict' || error.status === 422)) return { conflict: true };
      throw error;
    }
    return { head: commit.sha };
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

  async commit(_base: Snapshot, changes: TreeChange[], message: string, progress?: (text: string) => void): Promise<CommitResult> {
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

  async account(): Promise<Account> {
    return { login: 'This PC' };
  }

  async activity(): Promise<Activity[]> {
    return (await (await this.request('/activity')).json()) as Activity[];
  }
}
