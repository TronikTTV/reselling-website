// The Studio's state: the store's files as last saved, the owner's unpublished edits on top, and
// publishing them all as one save. Screens read from here and re-draw when it announces a change.
import { CATEGORY_SLUG, categorySlug, isWithin, labelOf, orderCategories, resolveCategory, type TreeCategory } from '../lib/category-tree.ts';
import { COPY_DEFAULTS, SITE_TEXT_DEFAULTS, type CopyKey } from '../lib/copy-fields.ts';
import { StudioError, type Account, type Activity, type Backend, type RemoteFile, type Snapshot, type TreeChange } from './lib/backend.ts';
import { emptyProduct, parseProduct, sameValue, slugify, writeProduct, type ProductData, type ProductField } from './lib/product-file.ts';

export interface StudioConfig {
  repo: string;
  branch: string;
  /** Site base path, e.g. "/" or "/reselling-website/". */
  base: string;
  /** Public address of the site. */
  site: string;
  /** GitHub page that makes a new admin key. */
  keyUrl: string;
  dev: boolean;
  siteName: string;
}

export interface NewMedia {
  name: string;
  kind: 'image' | 'video';
  /** A new upload… */
  blob?: Blob;
  /** …or a copy of another product's file (duplicating). */
  from?: RemoteFile;
  /** Preview address. */
  url?: string;
}

export interface Product {
  /** Folder name (the part of the web address after /product/). New products get a temporary one. */
  id: string;
  isNew: boolean;
  /** Folder in the repository. */
  dir: string;
  /** index.md as last saved. */
  file?: RemoteFile;
  raw: string | null;
  base: ProductData;
  edits: Partial<ProductData>;
  /** New photos/videos by file name. */
  media: Map<string, NewMedia>;
  deleted: boolean;
  /** base + edits. */
  data: ProductData;
}

interface JsonDoc {
  path: string;
  file?: RemoteFile;
  raw: string;
  base: Record<string, unknown>;
  /** Dotted path → new value. */
  edits: Map<string, unknown>;
}

interface CatalogFile {
  sha: string;
  url: string;
  thumb?: string;
}

interface Catalog {
  commit: string;
  builtAt: string;
  products: { path: string; sha: string; text: string; files: Record<string, CatalogFile> }[];
  data: { path: string; sha: string; text: string }[];
}

/**
 * A category or sub-category. Sub-categories' slugs start with their parent's ("shoes/nike"), and
 * `categories()` lists each one straight after its parent (see src/lib/category-tree.ts).
 */
export type Category = TreeCategory;

export interface Settings {
  siteName: string;
  tagline: string;
  heroHeading: string;
  heroAccent: string;
  ticker: string[];
  announcement: string;
  currency: string;
  hideSoldItems: boolean;
  contact: { instagram: string; tiktok: string; snapchat: string; whatsapp: string; email: string };
}

export interface Change {
  id: string;
  kind: 'product-new' | 'product-edit' | 'product-delete' | 'text' | 'settings' | 'categories';
  title: string;
  detail: string;
  thumb?: { product: Product; name: string };
  discard: () => void;
}

export type DeployState = 'live' | 'updating' | 'stuck' | 'local' | 'unknown';

export type Reason = 'load' | 'products' | 'text' | 'settings' | 'categories' | 'publish' | 'deploy' | 'activity';

export const PRODUCTS_DIR = 'src/content/products';

/**
 * About how many new photos and videos go in each part when publishing a lot at once. Each part is
 * saved (and goes live) before the next starts, so GitHub never has to take a huge save in one go.
 */
const STAGE_FILES = 40;

interface Stage {
  products: Product[];
  /** Whether the settings, site text and categories go in this part (always the first). */
  data: boolean;
  files: number;
}
export const DATA_FILES = {
  settings: 'src/data/settings.json',
  categories: 'src/data/categories.json',
  content: 'src/data/content.json',
} as const;

const FIELD_LABELS: Record<ProductField, string> = {
  title: 'name',
  images: 'photos',
  video: 'video',
  category: 'category',
  brand: 'brand',
  price: 'price',
  retailPrice: 'RRP',
  status: 'status',
  draft: 'draft',
  featured: 'home page',
  size: 'size',
  condition: 'condition',
  authenticity: "where it's from",
  styleCode: 'style code',
  colourway: 'colourway',
  includes: "what's included",
  tags: 'search words',
  date: 'date',
  body: 'description',
};

const CURRENCY_LOCALES: Record<string, string> = { GBP: 'en-GB', EUR: 'en-IE', USD: 'en-US', CAD: 'en-CA', AUD: 'en-AU', NZD: 'en-NZ' };

const clone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

function getPath(object: unknown, path: string): unknown {
  let value = object;
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function setPath(object: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  let target = object;
  for (const part of parts.slice(0, -1)) {
    const next = target[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) target[part] = {};
    target = target[part] as Record<string, unknown>;
  }
  target[parts[parts.length - 1]] = clone(value);
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function parseJson(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

const randomId = (length = 4) =>
  Array.from(crypto.getRandomValues(new Uint8Array(length)), (byte) => (byte % 16).toString(16)).join('');

/** Runs `task` over `items`, `limit` at a time. */
async function inBatches<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export class Store {
  readonly config: StudioConfig;
  readonly backend: Backend;
  snapshot: Snapshot | null = null;
  products = new Map<string, Product>();
  private json = new Map<string, JsonDoc>();
  private catalogFiles = new Map<string, CatalogFile>();
  deployed: { commit: string; builtAt: string } | null = null;
  /** When the last save was made, for the "going live" timer. */
  savedAt = 0;
  account: Account | null = null;
  activity: Activity[] = [];
  loaded = false;
  publishing = false;
  /** New products' temporary ids → their folder once published. */
  renamed = new Map<string, string>();
  private listeners = new Set<(reason: Reason) => void>();
  private blobUrls = new Map<string, Promise<string>>();

  constructor(config: StudioConfig, backend: Backend) {
    this.config = config;
    this.backend = backend;
  }

  // ---------------------------------------------------------------- events

  subscribe(listener: (reason: Reason) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(reason: Reason) {
    for (const listener of this.listeners) listener(reason);
  }

  /** A path on the site, with the base path added. */
  siteUrl(path = '/') {
    if (/^([a-z]+:|\/\/)/i.test(path)) return path;
    return `${this.config.base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  }

  // ---------------------------------------------------------------- loading

  private async fetchCatalog(): Promise<Catalog | null> {
    try {
      const response = await fetch(this.siteUrl(`/admin/catalog.json?t=${Date.now()}`), { cache: 'no-store' });
      if (!response.ok) return null;
      return (await response.json()) as Catalog;
    } catch {
      return null;
    }
  }

  async refreshDeploy(): Promise<void> {
    if (this.backend.kind === 'local') return;
    try {
      const response = await fetch(this.siteUrl(`/admin/build.json?t=${Date.now()}`), { cache: 'no-store' });
      if (response.ok) {
        const info = (await response.json()) as { commit: string; builtAt: string };
        const changed = info.commit !== this.deployed?.commit;
        this.deployed = info;
        if (changed) this.emit('deploy');
      }
    } catch {
      // Offline: try again next time.
    }
  }

  deployState(): DeployState {
    if (this.backend.kind === 'local') return 'local';
    if (!this.snapshot || !this.deployed?.commit) return 'unknown';
    if (this.deployed.commit === this.snapshot.head) return 'live';
    const since = this.savedAt || new Date(this.snapshot.date).getTime() || Date.now();
    return Date.now() - since > 10 * 60_000 ? 'stuck' : 'updating';
  }

  /** Loads everything. `progress` gets a short description of what's happening. */
  async load(progress?: (text: string) => void, head?: string): Promise<void> {
    progress?.('Opening your store…');
    const [snapshot, catalog] = await Promise.all([this.backend.snapshot(head), this.fetchCatalog()]);
    if (catalog && this.backend.kind !== 'local') this.deployed = { commit: catalog.commit, builtAt: catalog.builtAt };

    const known = new Map<string, { sha: string; text: string }>();
    this.catalogFiles.clear();
    for (const product of catalog?.products ?? []) {
      known.set(product.path, product);
      const dir = product.path.replace(/\/[^/]+$/, '');
      for (const [name, file] of Object.entries(product.files)) this.catalogFiles.set(`${dir}/${name}`, file);
    }
    for (const file of catalog?.data ?? []) known.set(file.path, file);

    // Anything that changed since the site was built (or isn't on it, like drafts) comes from GitHub.
    const read = async (file: RemoteFile) => {
      const cached = known.get(file.path);
      return cached && cached.sha === file.sha ? cached.text : this.backend.readText(file);
    };

    const entries = [...snapshot.files.values()].filter(
      (file) => file.path.startsWith(`${PRODUCTS_DIR}/`) && /^[^/]+\/index\.md$/.test(file.path.slice(PRODUCTS_DIR.length + 1)),
    );
    const toFetch = entries.filter((file) => known.get(file.path)?.sha !== file.sha).length;
    if (toFetch > 3) progress?.(`Fetching ${toFetch} products…`);

    const texts = await inBatches(entries, 6, read);
    const products = new Map<string, Product>();
    entries.forEach((file, index) => {
      const id = file.path.slice(PRODUCTS_DIR.length + 1).replace(/\/index\.md$/, '');
      const data = parseProduct(texts[index]);
      products.set(id, { id, isNew: false, dir: `${PRODUCTS_DIR}/${id}`, file, raw: texts[index], base: data, edits: {}, media: new Map(), deleted: false, data });
    });

    const json = new Map<string, JsonDoc>();
    await Promise.all(
      Object.values(DATA_FILES).map(async (path) => {
        const file = snapshot.files.get(path);
        const raw = file ? await read(file) : '{}';
        json.set(path, { path, file, raw, base: parseJson(raw), edits: new Map() });
      }),
    );

    this.snapshot = snapshot;
    this.products = products;
    this.json = json;
    this.loaded = true;
    this.emit('load');
  }

  async loadActivity() {
    try {
      this.activity = await this.backend.activity();
      this.emit('activity');
    } catch {
      // Not important enough to interrupt anything.
    }
  }

  // ---------------------------------------------------------------- products

  /** Published and new products (not ones marked for deletion), newest first. */
  productList(): Product[] {
    return [...this.products.values()]
      .filter((product) => !product.deleted)
      .sort((a, b) => (b.data.date || '').localeCompare(a.data.date || '') || a.data.title.localeCompare(b.data.title));
  }

  product(id: string) {
    return this.products.get(id);
  }

  updateProduct(id: string, patch: Partial<ProductData>, silent = false) {
    const product = this.products.get(id);
    if (!product) return;
    for (const [field, value] of Object.entries(patch) as [ProductField, unknown][]) {
      if (product.isNew || !sameValue(value, product.base[field])) (product.edits as Record<string, unknown>)[field] = value;
      else delete product.edits[field];
    }
    product.data = { ...product.base, ...product.edits };
    if (!silent) this.emit('products');
  }

  createProduct(category = ''): Product {
    const id = `new-${randomId(6)}`;
    const base = emptyProduct(category || this.categories()[0]?.slug || '');
    const product: Product = { id, isNew: true, dir: '', raw: null, base, edits: {}, media: new Map(), deleted: false, data: { ...base } };
    this.products.set(id, product);
    this.emit('products');
    return product;
  }

  duplicateProduct(id: string): Product | undefined {
    const source = this.products.get(id);
    if (!source) return undefined;
    const copy = this.createProduct(source.data.category);
    const data: ProductData = { ...clone(source.data), title: `${source.data.title} (copy)`, draft: true, featured: false, date: new Date().toISOString() };
    copy.base = data;
    copy.data = { ...data };
    for (const name of [...data.images, data.video].filter(Boolean)) {
      const media = source.media.get(name);
      const file = this.fileOf(source, name);
      if (media) copy.media.set(name, { ...media });
      else if (file) copy.media.set(name, { name, kind: name === data.video ? 'video' : 'image', from: file });
    }
    this.emit('products');
    return copy;
  }

  deleteProduct(id: string) {
    const product = this.products.get(id);
    if (!product) return;
    if (product.isNew) this.forget(product);
    else product.deleted = true;
    this.emit('products');
  }

  discardProduct(id: string) {
    const product = this.products.get(id);
    if (!product) return;
    if (product.isNew) {
      this.forget(product);
    } else {
      this.revoke(product);
      product.edits = {};
      product.media = new Map();
      product.deleted = false;
      product.data = { ...product.base };
    }
    this.emit('products');
  }

  private forget(product: Product) {
    this.revoke(product);
    this.products.delete(product.id);
  }

  private revoke(product: Product) {
    for (const media of product.media.values()) if (media.url?.startsWith('blob:')) URL.revokeObjectURL(media.url);
  }

  /** Adds new photos (already resized) to the end of a product's photos. */
  addPhotos(id: string, photos: { name: string; blob: Blob }[]) {
    const product = this.products.get(id);
    if (!product) return;
    for (const photo of photos) product.media.set(photo.name, { name: photo.name, kind: 'image', blob: photo.blob, url: URL.createObjectURL(photo.blob) });
    this.updateProduct(id, { images: [...product.data.images, ...photos.map((photo) => photo.name)] });
  }

  setVideo(id: string, video: { name: string; blob: Blob } | null) {
    const product = this.products.get(id);
    if (!product) return;
    if (video) product.media.set(video.name, { name: video.name, kind: 'video', blob: video.blob, url: URL.createObjectURL(video.blob) });
    this.updateProduct(id, { video: video?.name ?? '' });
  }

  hasChanges(product: Product) {
    return product.isNew || product.deleted || Object.keys(product.edits).length > 0;
  }

  /** The saved file for one of a product's photos/videos, if there is one. */
  fileOf(product: Product, name: string): RemoteFile | undefined {
    return product.dir ? this.snapshot?.files.get(`${product.dir}/${name}`) : undefined;
  }

  /**
   * Web address for a product's photo or video: a new upload's preview, the resized copy on the live
   * site, or (for anything newer than the site) the file fetched from GitHub.
   */
  mediaUrl(product: Product, name: string, size: 'thumb' | 'full' = 'thumb'): string | Promise<string> | undefined {
    const now = this.mediaUrlNow(product, name, size);
    if (now) return now;
    const file = product.media.get(name)?.from ?? this.fileOf(product, name);
    return file ? this.blobUrl(file) : undefined;
  }

  /** The address when it's known without downloading anything (new uploads, photos on the live site). */
  mediaUrlNow(product: Product, name: string, size: 'thumb' | 'full' = 'thumb'): string | undefined {
    if (!name) return undefined;
    const media = product.media.get(name);
    if (media?.url) return media.url;
    const file = media?.from ?? this.fileOf(product, name);
    if (!file) return undefined;
    const built = this.catalogFiles.get(file.path);
    if (built && built.sha === file.sha) return size === 'thumb' ? (built.thumb ?? built.url) : built.url;
    return undefined;
  }

  blobUrl(file: RemoteFile): Promise<string> {
    let url = this.blobUrls.get(file.sha);
    if (!url) {
      url = this.backend.readBlob(file).then((blob) => URL.createObjectURL(blob));
      url.catch(() => this.blobUrls.delete(file.sha));
      this.blobUrls.set(file.sha, url);
    }
    return url;
  }

  /** Existing brands, most used first (for suggestions). */
  brands(): string[] {
    const counts = new Map<string, number>();
    for (const product of this.productList()) if (product.data.brand) counts.set(product.data.brand, (counts.get(product.data.brand) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([brand]) => brand);
  }

  // ---------------------------------------------------------------- settings, text and categories

  private doc(path: string): JsonDoc {
    let doc = this.json.get(path);
    if (!doc) {
      doc = { path, raw: '{}', base: {}, edits: new Map() };
      this.json.set(path, doc);
    }
    return doc;
  }

  private effective(path: string): Record<string, unknown> {
    const doc = this.doc(path);
    const value = clone(doc.base);
    for (const [key, edit] of doc.edits) setPath(value, key, edit);
    return value;
  }

  private setJson(path: string, key: string, value: unknown, reason: Reason) {
    const doc = this.doc(path);
    if (sameJson(value, getPath(doc.base, key))) doc.edits.delete(key);
    else doc.edits.set(key, clone(value));
    this.emit(reason);
  }

  settings(): Settings {
    const s = this.effective(DATA_FILES.settings);
    const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));
    const contact = (s.contact ?? {}) as Record<string, unknown>;
    return {
      siteName: text(s.siteName),
      tagline: text(s.tagline),
      heroHeading: text(s.heroHeading),
      heroAccent: text(s.heroAccent),
      ticker: Array.isArray(s.ticker) ? s.ticker.map(text) : [],
      announcement: text(s.announcement),
      currency: text(s.currency).toUpperCase() || 'GBP',
      hideSoldItems: s.hideSoldItems === true,
      contact: {
        instagram: text(contact.instagram),
        tiktok: text(contact.tiktok),
        snapchat: text(contact.snapchat),
        whatsapp: text(contact.whatsapp),
        email: text(contact.email),
      },
    };
  }

  setSetting(key: string, value: unknown) {
    this.setJson(DATA_FILES.settings, key, value, 'settings');
  }

  /** The stored value of a text ("site:tagline", "copy:home.shopButton"), or '' when blank. */
  text(key: string): string {
    const [source, path] = splitKey(key);
    if (source === 'site') {
      const value = getPath(this.effective(DATA_FILES.settings), path);
      return Array.isArray(value) ? value.join('\n') : value === null || value === undefined ? '' : String(value);
    }
    if (source === 'copy') {
      const value = getPath(this.effective(DATA_FILES.content), path);
      return value === null || value === undefined ? '' : String(value);
    }
    return '';
  }

  /** What the site shows for a text: the stored value, or its default. */
  shownText(key: string): string {
    return this.text(key).trim() || defaultText(key);
  }

  setText(key: string, value: string) {
    const [source, path] = splitKey(key);
    if (source === 'site') {
      if (path === 'ticker') this.setSetting('ticker', value.split('\n').map((line) => line.trim()).filter(Boolean));
      else this.setSetting(path, value);
      this.emit('text');
    } else if (source === 'copy') {
      this.setJson(DATA_FILES.content, path, value, 'text');
    }
  }

  /** Every category, each followed by its sub-categories (a missing level is filled in). */
  categories(): Category[] {
    return [...this.categoryIndex().list];
  }

  /** Worked out again only when the categories change (filters ask for it for every product). */
  private categoryMemo: { base: unknown; edit: unknown; list: Category[]; known: Set<string>; bySlug: Map<string, Category> } | null = null;

  private categoryIndex() {
    const doc = this.doc(DATA_FILES.categories);
    const edit = doc.edits.get('categories');
    if (this.categoryMemo?.base === doc.base && this.categoryMemo.edit === edit) return this.categoryMemo;
    const raw = this.effective(DATA_FILES.categories).categories;
    const list: Category[] = orderCategories(
      (Array.isArray(raw) ? raw : []).map((item) => ({
        name: String(item?.name ?? '').trim(),
        slug: categorySlug(String(item?.slug ?? '') || String(item?.name ?? '')),
        description: item?.description ? String(item.description) : undefined,
      })),
    );
    this.categoryMemo = { base: doc.base, edit, list, known: new Set(list.map((category) => category.slug)), bySlug: new Map(list.map((category) => [category.slug, category])) };
    return this.categoryMemo;
  }

  setCategories(list: { name: string; slug: string; description?: string }[]) {
    const tidy = list.map(({ name, slug, description }) => (description?.trim() ? { name, slug, description: description.trim() } : { name, slug }));
    this.setJson(DATA_FILES.categories, 'categories', tidy, 'categories');
  }

  /** The category a product with this `category` shows under: the deepest one that exists, or ''. */
  resolveCategory(slug: string): string {
    return resolveCategory(slug, this.categoryIndex().known);
  }

  /** Whether a product's category is this one or inside it (sub-categories count). */
  inCategory(productCategory: string, slug: string): boolean {
    return isWithin(this.resolveCategory(productCategory) || categorySlug(productCategory), slug);
  }

  /** The name a product's category shows as ("P-6000"), or "Other". */
  categoryName(slug: string) {
    return this.categoryIndex().bySlug.get(this.resolveCategory(slug))?.name ?? (slug ? slug : 'Other');
  }

  /** The full name with the categories above it: "Trainers & Shoes › Nike › P-6000". */
  categoryLabel(slug: string) {
    const found = this.resolveCategory(slug);
    return found ? labelOf(found, this.categoryIndex().bySlug) : slug || 'Other';
  }

  formatPrice(amount: number | null | undefined): string {
    if (amount === null || amount === undefined) return '';
    const currency = this.settings().currency;
    try {
      return new Intl.NumberFormat(CURRENCY_LOCALES[currency] ?? 'en-GB', {
        style: 'currency',
        currency,
        minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${amount} ${currency}`;
    }
  }

  currencySymbol(): string {
    const currency = this.settings().currency;
    try {
      return (
        new Intl.NumberFormat(CURRENCY_LOCALES[currency] ?? 'en-GB', { style: 'currency', currency })
          .formatToParts(0)
          .find((part) => part.type === 'currency')?.value ?? currency
      );
    } catch {
      return currency;
    }
  }

  // ---------------------------------------------------------------- unpublished changes

  changes(): Change[] {
    const list: Change[] = [];
    for (const product of this.products.values()) {
      const name = product.data.title || 'Untitled product';
      const cover = product.data.images[0];
      const thumb = cover ? { product, name: cover } : undefined;
      if (product.isNew) {
        list.push({ id: product.id, kind: 'product-new', title: `New: ${name}`, detail: product.data.draft ? 'Saved as a draft' : 'Goes on the site', thumb, discard: () => this.discardProduct(product.id) });
      } else if (product.deleted) {
        list.push({ id: product.id, kind: 'product-delete', title: `Delete: ${name}`, detail: 'Removed from the site with its photos', thumb, discard: () => this.discardProduct(product.id) });
      } else if (Object.keys(product.edits).length > 0) {
        const fields = (Object.keys(product.edits) as ProductField[]).map((field) => FIELD_LABELS[field]);
        list.push({ id: product.id, kind: 'product-edit', title: name, detail: `Changed ${listText(fields)}`, thumb, discard: () => this.discardProduct(product.id) });
      }
    }
    const content = this.doc(DATA_FILES.content);
    const settings = this.doc(DATA_FILES.settings);
    const textKeys = [...settings.edits.keys()].filter((key) => TEXT_SETTINGS.has(key));
    const settingKeys = [...settings.edits.keys()].filter((key) => !TEXT_SETTINGS.has(key));
    if (content.edits.size + textKeys.length > 0) {
      const count = content.edits.size + textKeys.length;
      list.push({
        id: 'text',
        kind: 'text',
        title: 'Site text',
        detail: `${count} ${count === 1 ? 'piece of text' : 'pieces of text'} changed`,
        discard: () => {
          content.edits.clear();
          textKeys.forEach((key) => settings.edits.delete(key));
          this.emit('text');
        },
      });
    }
    if (settingKeys.length > 0) {
      list.push({
        id: 'settings',
        kind: 'settings',
        title: 'Store settings',
        detail: `Changed ${listText(settingKeys.map((key) => SETTING_LABELS[key] ?? key))}`,
        discard: () => {
          settingKeys.forEach((key) => settings.edits.delete(key));
          this.emit('settings');
        },
      });
    }
    const categories = this.doc(DATA_FILES.categories);
    if (categories.edits.size > 0) {
      list.push({
        id: 'categories',
        kind: 'categories',
        title: 'Categories',
        detail: 'Names, order or descriptions changed',
        discard: () => {
          categories.edits.clear();
          this.emit('categories');
        },
      });
    }
    return list;
  }

  /** Discards one piece of site text (back to what's live). */
  discardText(key: string) {
    const [source, path] = splitKey(key);
    this.doc(source === 'site' ? DATA_FILES.settings : DATA_FILES.content).edits.delete(path);
    this.emit('text');
  }

  isTextChanged(key: string) {
    const [source, path] = splitKey(key);
    return this.doc(source === 'site' ? DATA_FILES.settings : DATA_FILES.content).edits.has(path);
  }

  discardAll() {
    for (const product of [...this.products.values()]) if (this.hasChanges(product)) this.discardProduct(product.id);
    for (const doc of this.json.values()) doc.edits.clear();
    this.emit('products');
    this.emit('text');
    this.emit('settings');
    this.emit('categories');
  }

  /** Problems that stop publishing, e.g. a product without a name. */
  problems(): string[] {
    const list: string[] = [];
    for (const product of this.products.values()) {
      if (product.deleted || !this.hasChanges(product)) continue;
      if (!product.data.title.trim()) list.push('A product needs a name.');
    }
    const names = this.categories();
    if (names.some((category) => !category.name.trim())) list.push('Every category needs a name.');
    if (names.some((category) => !CATEGORY_SLUG.test(category.slug))) list.push('A category web address can only use lowercase letters, numbers and dashes.');
    if (new Set(names.map((category) => category.slug)).size !== names.length) list.push('Two categories have the same web address.');
    return [...new Set(list)];
  }

  // ---------------------------------------------------------------- publishing

  /**
   * Saves every change. Small changes go in one commit; lots of new photos go in parts of about 40,
   * each saved as it's done, so a big upload never has to succeed all at once and trying again after
   * a failure carries on with what's left. The files are re-read first, so edits made elsewhere in the
   * meantime (another phone, the classic editor) are kept rather than overwritten.
   *
   * `progress` gets what's happening, how far through it is (0–1), and whether Stop would work now.
   */
  async publish(progress?: (text: string, fraction?: number, canStop?: boolean) => void, signal?: AbortSignal): Promise<string | null> {
    const problems = this.problems();
    if (problems.length > 0) throw new StudioError('invalid', problems[0]);
    if (this.changes().length === 0) return null;
    const stages = this.stages();
    const report = { saved: 0, parts: stages.length };
    this.publishReport = report;

    this.publishing = true;
    this.emit('publish');
    try {
      let head: string | null = null;
      for (const [index, stage] of stages.entries()) {
        if (signal?.aborted) throw new StudioError('cancelled', 'Publishing stopped.');
        const many = stages.length > 1;
        const partProgress = (text: string, fraction?: number) =>
          progress?.(many ? `Part ${index + 1} of ${stages.length} · ${text}` : text, many ? (index + (fraction ?? 0)) / stages.length : fraction, text !== 'Saving…');
        head = (await this.publishStage(stage, partProgress, signal, many ? `part ${index + 1} of ${stages.length}` : '')) ?? head;
        report.saved = index + 1;
      }
      if (!head) return null;

      progress?.('Saved. Refreshing…', stages.length > 1 ? 1 : undefined, false);
      this.revokeAll();
      this.savedAt = Date.now();
      await this.load(undefined, this.backend.kind === 'github' ? head : undefined);
      this.loadActivity();
      return head;
    } finally {
      this.publishing = false;
      this.emit('publish');
    }
  }

  /** How far the last Publish got: parts saved, out of how many (to explain a failure part-way). */
  publishReport: { saved: number; parts: number } | null = null;

  /** New photos and videos a product would upload. */
  private newFiles(product: Product): number {
    const used = new Set([...product.data.images, product.data.video].filter(Boolean));
    return [...product.media.values()].filter((media) => media.blob && used.has(media.name)).length;
  }

  /** Splits what's unpublished into parts: small changes first, then new photos about 40 at a time. */
  private stages(): Stage[] {
    const pending = [...this.products.values()].filter((product) => this.hasChanges(product));
    const limit = this.backend.kind === 'github' ? STAGE_FILES : Infinity;
    const first: Stage = {
      products: pending.filter((product) => product.deleted || this.newFiles(product) === 0),
      data: [...this.json.values()].some((doc) => doc.edits.size > 0),
      files: 0,
    };
    const stages = [first];
    for (const product of pending) {
      const files = product.deleted ? 0 : this.newFiles(product);
      if (files === 0) continue;
      let stage = stages[stages.length - 1];
      if (stage.files > 0 && stage.files + files > limit) {
        stage = { products: [], data: false, files: 0 };
        stages.push(stage);
      }
      stage.products.push(product);
      stage.files += files;
    }
    return stages.filter((stage) => stage.products.length > 0 || stage.data);
  }

  /** Saves one part as a commit (starting again if the store changed meanwhile), then marks it saved. */
  private async publishStage(stage: Stage, progress: (text: string, fraction?: number) => void, signal: AbortSignal | undefined, part: string): Promise<string | null> {
    const ids = new Set(stage.products.map((product) => product.id));
    const message = commitMessage(
      this.changes().filter((change) => ids.has(change.id) || (stage.data && (change.kind === 'text' || change.kind === 'settings' || change.kind === 'categories'))),
      part,
    );
    // Kept across retries, so photos are only uploaded once (GitHubBackend also remembers them
    // between presses of Publish, so trying again after a failure carries on where it stopped).
    const uploads = new Map<string, TreeChange>();
    for (let attempt = 0; attempt < 3; attempt++) {
      progress('Getting ready…');
      const latest = await this.backend.snapshot();
      const folders = new Map<string, string>();
      const changes = await this.plan(latest, uploads, folders, stage);
      if (changes.length === 0) {
        // Already saved (e.g. the same edit made elsewhere): nothing left to do for this part.
        this.settle(stage, latest, [], folders);
        return null;
      }
      const result = await this.backend.commit(latest, changes, message, { progress, signal });
      if ('conflict' in result) continue;
      this.settle(stage, await this.backend.snapshot(this.backend.kind === 'github' ? result.head : undefined), changes, folders);
      return result.head;
    }
    throw new StudioError('conflict', 'The store kept changing while saving (maybe from another device). Try again in a moment.');
  }

  /** After a part is saved, its products, text and settings are no longer "not live yet". */
  private settle(stage: Stage, snapshot: Snapshot, changes: TreeChange[], folders: Map<string, string>) {
    const written = new Map(changes.filter((change) => change.content !== undefined).map((change) => [change.path, change.content as string]));
    for (const product of stage.products) {
      if (product.deleted) {
        this.forget(product);
        continue;
      }
      let saved = product;
      if (product.isNew) {
        const folder = folders.get(product.id);
        if (!folder) continue;
        // Now known by its folder. Keeps its new photos' previews until the Studio reloads.
        this.renamed.set(product.id, folder);
        this.products.delete(product.id);
        saved = { ...product, id: folder, isNew: false, dir: `${PRODUCTS_DIR}/${folder}` };
        this.products.set(folder, saved);
      }
      const path = `${saved.dir}/index.md`;
      saved.file = snapshot.files.get(path) ?? saved.file;
      saved.raw = written.get(path) ?? saved.raw;
      saved.base = { ...saved.data };
      saved.edits = {};
    }
    if (stage.data) {
      for (const doc of this.json.values()) {
        if (doc.edits.size === 0) continue;
        const text = written.get(doc.path);
        if (text !== undefined) {
          doc.raw = text;
          doc.base = parseJson(text);
        }
        doc.file = snapshot.files.get(doc.path) ?? doc.file;
        doc.edits.clear();
      }
    }
    this.snapshot = snapshot;
    this.savedAt = Date.now();
    this.emit('products');
  }

  private revokeAll() {
    for (const product of this.products.values()) this.revoke(product);
    for (const url of this.blobUrls.values()) url.then((value) => URL.revokeObjectURL(value)).catch(() => {});
    this.blobUrls.clear();
  }

  /** Works out the file changes for one part of what's unpublished, on top of the latest saved files. */
  private async plan(latest: Snapshot, uploads: Map<string, TreeChange>, folders: Map<string, string>, stage: Stage): Promise<TreeChange[]> {
    const changes: TreeChange[] = [];
    const readLatest = async (path: string, file: RemoteFile | undefined, raw: string | null): Promise<string | null> => {
      const remote = latest.files.get(path);
      if (!remote) return null;
      if (file && raw !== null && remote.sha === file.sha) return raw;
      return this.backend.readText(remote);
    };
    const addMedia = (product: Product, dir: string) => {
      const used = new Set([...product.data.images, product.data.video].filter(Boolean));
      for (const media of product.media.values()) {
        if (!used.has(media.name)) continue;
        const path = `${dir}/${media.name}`;
        let change = uploads.get(path);
        if (!change) {
          change = media.blob ? { path, blob: media.blob } : { path, from: media.from };
          uploads.set(path, change);
        }
        changes.push(change);
      }
    };

    for (const product of stage.products) {
      if (!this.hasChanges(product)) continue;

      if (product.deleted) {
        for (const path of latest.files.keys()) if (path.startsWith(`${product.dir}/`)) changes.push({ path, delete: true });
        continue;
      }

      if (product.isNew) {
        const folder = newFolder(product.data.title, latest);
        folders.set(product.id, folder);
        const dir = `${PRODUCTS_DIR}/${folder}`;
        changes.push({ path: `${dir}/index.md`, content: writeProduct(null, product.data) });
        addMedia(product, dir);
        continue;
      }

      const path = `${product.dir}/index.md`;
      const text = await readLatest(path, product.file, product.raw);
      if (text === null) continue; // Deleted elsewhere in the meantime.
      const fields = Object.keys(product.edits) as ProductField[];
      const next = writeProduct(text, product.data, fields);
      if (next !== text) changes.push({ path, content: next });
      addMedia(product, product.dir);

      // Photos and videos that were taken off the product are deleted too.
      const used = new Set([...product.data.images, product.data.video].filter(Boolean));
      for (const name of [...product.base.images, product.base.video].filter(Boolean)) {
        const file = `${product.dir}/${name}`;
        if (!used.has(name) && latest.files.has(file)) changes.push({ path: file, delete: true });
      }
    }

    for (const doc of stage.data ? this.json.values() : []) {
      if (doc.edits.size === 0) continue;
      const text = await readLatest(doc.path, doc.file, doc.raw);
      const value = text === null ? {} : parseJson(text);
      for (const [key, edit] of doc.edits) setPath(value, key, edit);
      const next = `${JSON.stringify(value, null, 2)}\n`;
      if (next !== text) changes.push({ path: doc.path, content: next });
    }
    return changes;
  }
}

const TEXT_SETTINGS = new Set(['siteName', 'tagline', 'heroHeading', 'heroAccent', 'ticker', 'announcement']);

const SETTING_LABELS: Record<string, string> = {
  currency: 'currency',
  hideSoldItems: 'hide sold items',
  'contact.instagram': 'Instagram',
  'contact.tiktok': 'TikTok',
  'contact.snapchat': 'Snapchat',
  'contact.whatsapp': 'WhatsApp',
  'contact.email': 'email',
};

export function splitKey(key: string): ['site' | 'copy' | 'other', string] {
  const index = key.indexOf(':');
  const source = key.slice(0, index);
  return [source === 'site' || source === 'copy' ? source : 'other', key.slice(index + 1)];
}

export function defaultText(key: string): string {
  const [source, path] = splitKey(key);
  if (source === 'copy') return COPY_DEFAULTS[path as CopyKey] ?? '';
  if (source === 'site') return (SITE_TEXT_DEFAULTS as Record<string, string>)[path] ?? '';
  return '';
}

function listText(items: string[]) {
  const unique = [...new Set(items)];
  if (unique.length <= 1) return unique[0] ?? '';
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
}

function newFolder(title: string, latest: Snapshot): string {
  const base = slugify(title).slice(0, 60).replace(/-+$/, '') || 'product';
  for (;;) {
    const folder = `${base}-${randomId(4)}`;
    const taken = [...latest.files.keys()].some((path) => path.startsWith(`${PRODUCTS_DIR}/${folder}/`));
    if (!taken) return folder;
  }
}

function commitMessage(changes: Change[], part = ''): string {
  const line = (change: Change) =>
    change.kind === 'product-new'
      ? `Add ${change.title.replace(/^New: /, '')}`
      : change.kind === 'product-delete'
        ? `Delete ${change.title.replace(/^Delete: /, '')}`
        : change.kind === 'product-edit'
          ? `Update ${change.title}: ${change.detail.replace(/^Changed /, '')}`
          : `Update ${change.title.toLowerCase()}`;
  const lines = changes.map(line);
  const title = lines.length === 1 ? lines[0] : `Update ${changes.length} things: ${changes.map((change) => change.title.replace(/^(New|Delete): /, '')).join(', ')}`;
  const label = part ? ` (${part})` : '';
  const room = 72 - label.length;
  const short = title.length > room ? `${title.slice(0, room - 1)}…` : title;
  return `${short}${label}\n\n${lines.length > 1 ? `${lines.map((item) => `- ${item}`).join('\n')}\n\n` : ''}Saved from the store admin (Studio).`;
}
