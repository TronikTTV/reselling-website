// Add from folders: choose (or drop) a folder with one sub-folder per product. Each holds the product's
// photos and a text file with its name, price, colourway and code (a bio is optional). The owner checks
// the list, then adds them all; they go live with the next Publish.
import { aiStatus, identify } from '../lib/ai.ts';
import { $, html, pluralise, setHtml } from '../lib/dom.ts';
import {
  fromFolderName,
  groupFolders,
  guessBrand,
  matchCategory,
  parseDetails,
  type FolderEntry,
  type ProductFolder,
} from '../lib/folder-import.ts';
import { icon } from '../lib/icons.ts';
import { preparePhoto } from '../lib/media.ts';
import type { Context, View } from '../shell.ts';
import { busy, confirmDialog, errorMessage, toast } from '../ui.ts';
import { addTabs } from './add-tabs.ts';
import { CONDITIONS } from './product-form.ts';

interface ItemData {
  title: string;
  price: number | null;
  category: string;
  colourway: string;
  code: string;
  size: string;
  brand: string;
  condition: string;
  bio: string;
}

interface Item {
  id: string;
  folder: ProductFolder;
  preview: string;
  hasText: boolean;
  /** Where the category came from: the text file, the folder it's in, or the default for the batch. */
  categoryFrom: 'text' | 'folder' | 'default';
  touched: Set<keyof ItemData>;
  data: ItemData;
}

const MAX_PRODUCTS = 100;
const MAX_PHOTOS_EACH = 12;
/** Publishing sends about one photo a second, and GitHub takes about 500 an hour (see lib/backend.ts). */
const PHOTOS_PER_HOUR = 480;
const publishMinutes = (photos: number) => Math.max(1, Math.round(photos / 60));

const TEMPLATE = `Name: Nike Dunk Low Retro Panda
Price: 120
Colourway: White/Black
Code: DD1391-100
Size: UK 9
Bio: Brand new in the box. (This line is optional: leave it out if you don't want a description.)
`;

// Kept while the Studio is open, so leaving the page and coming back doesn't lose the list.
const items: Item[] = [];
let sourceName = '';
const options = { useBio: true, drafts: false, defaultCategory: '', condition: '', aiBio: false };

const newId = () => Math.random().toString(36).slice(2, 10);
const normal = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function priceOf(value: string): number | null {
  const cleaned = value.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
}

/** Reads a dropped folder (and everything inside it). */
async function readDrop(transfer: DataTransfer): Promise<FolderEntry[]> {
  const entries: FolderEntry[] = [];
  const roots = Array.from(transfer.items)
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => Boolean(entry));
  if (roots.length === 0) return Array.from(transfer.files, (file) => ({ path: file.name, file }));

  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      entries.push({ path: `${path}${entry.name}`, file });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, `${path}${entry.name}/`);
    }
  };
  for (const root of roots) await walk(root, '');
  return entries;
}

/** The browser's folder picker (computers; phones can't pick folders). */
function pickFolder(): Promise<FolderEntry[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.setAttribute('webkitdirectory', '');
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(Array.from(input.files ?? [], (file) => ({ path: file.webkitRelativePath || file.name, file })));
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

export function addFoldersView(context: Context): View {
  const { store } = context;
  const el = document.createElement('div');
  el.className = 'st-add st-add--folders';
  const touch = matchMedia('(pointer: coarse)').matches;
  let aiAvailable = false;
  aiStatus(store).then((status) => {
    aiAvailable = status.available && !status.sample;
    const box = $('[data-ai-option]', el);
    if (box) box.hidden = !aiAvailable;
  });

  if (!options.defaultCategory) options.defaultCategory = store.categories()[0]?.slug ?? '';

  // ---------------------------------------------------------------- reading the folders

  function alreadyInStore(data: ItemData) {
    return store.productList().some(
      (product) =>
        (data.code && product.data.styleCode.toLowerCase() === data.code.toLowerCase() && (product.data.size || '') === data.size) ||
        (normal(product.data.title) === normal(data.title) && (product.data.size || '') === data.size),
    );
  }

  async function load(entries: FolderEntry[]) {
    if (entries.every((entry) => !entry.path.replace(/\\/g, '/').includes('/'))) {
      toast('Choose or drop a folder (with a folder for each product inside). For loose photos, use From photos.', { tone: 'info', timeout: 8000 });
      return;
    }
    const folders = groupFolders(entries);
    if (folders.length === 0) {
      toast("No product folders with photos in them were found. Give each product its own folder with its photos (and a text file) inside.", { tone: 'warn', timeout: 9000 });
      return;
    }
    if (folders.length > MAX_PRODUCTS) {
      toast(`Found ${folders.length} products. Taking the first ${MAX_PRODUCTS}: add these, then do the rest.`, { tone: 'info', timeout: 8000 });
    }
    const categories = store.categories();
    const root = entries[0]?.path.replace(/\\/g, '/').split('/')[0] ?? '';
    sourceName = folders.length > 1 || !folders[0].path.includes('/') ? root : folders[0].name;

    for (const folder of folders.slice(0, MAX_PRODUCTS)) {
      const details = folder.text ? parseDetails(await folder.text.file.text()) : parseDetails('');
      const fromName = fromFolderName(folder.name || sourceName);
      const title = details.name || fromName.name;
      const textCategory = matchCategory(details.category, categories);
      const folderCategory = matchCategory(folder.parent, categories);
      const data: ItemData = {
        title,
        price: details.price ?? fromName.price,
        category: textCategory || folderCategory || options.defaultCategory,
        colourway: details.colourway,
        code: details.code,
        size: details.size,
        brand: details.brand || guessBrand(title),
        condition: CONDITIONS.find((value) => value.toLowerCase() === details.condition.toLowerCase()) ?? '',
        bio: details.bio,
      };
      items.push({
        id: newId(),
        folder,
        preview: URL.createObjectURL(folder.photos[0].file),
        hasText: Boolean(folder.text),
        categoryFrom: textCategory ? 'text' : folderCategory ? 'folder' : 'default',
        touched: new Set(),
        data,
      });
    }
    render();
  }

  // ---------------------------------------------------------------- adding them to the store

  async function addAll() {
    const ready = items.filter((item) => item.data.title.trim());
    const unnamed = items.length - ready.length;
    if (unnamed > 0) {
      toast(`${pluralise(unnamed, 'product')} still ${unnamed === 1 ? 'needs' : 'need'} a name.`, { tone: 'warn' });
      $(`[data-item="${items.find((item) => !item.data.title.trim())?.id}"] [data-f="title"]`, el)?.focus();
      return;
    }
    if (ready.length === 0) return;
    const totalPhotos = ready.reduce((sum, item) => sum + Math.min(item.folder.photos.length, MAX_PHOTOS_EACH), 0);
    if (totalPhotos > PHOTOS_PER_HOUR) {
      const ok = await confirmDialog({
        title: `That's ${totalPhotos} photos`,
        body: `GitHub, where your site is saved, takes about ${PHOTOS_PER_HOUR} photos an hour. Publishing all of these pauses part-way for up to an hour (with the page kept open). Adding them in two goes is quicker.`,
        confirm: 'Add them all',
        cancel: 'Go back',
      });
      if (!ok) return;
    }
    const overlay = busy('Getting the photos ready…');
    let done = 0;
    let added = 0;
    const skippedPhotos: string[] = [];
    const now = Date.now();
    try {
      for (const [index, item] of ready.entries()) {
        const photos = [];
        for (const photo of item.folder.photos.slice(0, MAX_PHOTOS_EACH)) {
          done += 1;
          overlay.update(`Getting photos ready: ${done} of ${totalPhotos}…`, totalPhotos > 1 ? (done - 1) / totalPhotos : undefined);
          try {
            photos.push(await preparePhoto(photo.file));
          } catch {
            skippedPhotos.push(photo.path);
          }
        }
        if (photos.length === 0) continue;

        let bio = options.useBio ? item.data.bio.trim() : '';
        if (!bio && options.aiBio && aiAvailable) {
          overlay.update(`Writing a description for ${item.data.title}…`);
          try {
            bio = (await identify(store, photos[0].blob, item.data.title)).listing.description;
          } catch {
            // No description is fine.
          }
        }

        const product = store.createProduct(item.data.category);
        store.updateProduct(
          product.id,
          {
            title: item.data.title.trim(),
            price: item.data.price,
            category: item.data.category,
            colourway: item.data.colourway.trim(),
            styleCode: item.data.code.trim(),
            size: item.data.size.trim(),
            brand: item.data.brand.trim(),
            condition: item.data.condition || options.condition,
            body: bio,
            draft: options.drafts,
            // Keeps them in folder order, first folder first on the site.
            date: new Date(now - index * 1000).toISOString(),
          },
          true,
        );
        store.addPhotos(
          product.id,
          photos.map((photo) => ({ name: photo.name, blob: photo.blob })),
        );
        added += 1;
      }
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    } finally {
      overlay.close();
    }
    for (const item of items) URL.revokeObjectURL(item.preview);
    items.length = 0;
    store.emit('products');
    if (skippedPhotos.length) {
      toast(`${pluralise(skippedPhotos.length, 'photo')} couldn't be opened and ${skippedPhotos.length === 1 ? 'was' : 'were'} left out (iPhone HEIC photos need Safari, or save them as JPG).`, { tone: 'warn', timeout: 10000 });
    }
    toast(`${pluralise(added, 'product')} added${options.drafts ? ' as drafts' : ''}. Press Publish to put ${added === 1 ? 'it' : 'them'} on your site.`, { tone: 'ok', timeout: 8000 });
    context.navigate('#/products?status=changed');
  }

  // ---------------------------------------------------------------- drawing

  const categorySelect = (item: Item) => html`
    <span class="st-select st-select--block">
      <select data-f="category" aria-label="Category">
        ${store.categories().map((category) => html`<option value="${category.slug}" ${category.slug === item.data.category ? 'selected' : ''}>${category.name}</option>`)}
      </select>
      ${icon('chevron-down', 14)}
    </span>
  `;

  function notes(item: Item) {
    const list = [];
    if (!item.hasText) list.push(html`<span class="st-chip st-chip--warn">No text file: name from the folder</span>`);
    if (item.data.price === null) list.push(html`<span class="st-chip">No price: shows "Ask for price"</span>`);
    if (item.folder.photos.length > MAX_PHOTOS_EACH) list.push(html`<span class="st-chip st-chip--warn">Only the first ${MAX_PHOTOS_EACH} photos are used</span>`);
    if (alreadyInStore(item.data)) list.push(html`<span class="st-chip st-chip--warn">Might already be in your store</span>`);
    return list;
  }

  const row = (item: Item) => {
    const { data } = item;
    const symbol = store.currencySymbol();
    return html`
      <article class="st-bulk-row" data-item="${item.id}">
        <div class="st-bulk-row__media">
          <img src="${item.preview}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
          <span class="st-bulk-row__count">${icon('image', 12)} ${item.folder.photos.length}</span>
        </div>
        <div class="st-bulk-row__main">
          <div class="st-bulk-row__top">
            <label class="st-field st-bulk-row__name">
              <span class="st-sr">Name</span>
              <input class="st-input" data-f="title" value="${data.title}" placeholder="Name" autocomplete="off" />
            </label>
            <label class="st-field st-bulk-row__price">
              <span class="st-sr">Price</span>
              <span class="st-money"><span>${symbol}</span><input class="st-input" data-f="price" value="${data.price ?? ''}" inputmode="decimal" placeholder="Ask" autocomplete="off" /></span>
            </label>
          </div>
          <div class="st-bulk-row__grid">
            <label class="st-field"><span class="st-field__label">Category</span>${categorySelect(item)}</label>
            <label class="st-field"><span class="st-field__label">Colourway</span><input class="st-input" data-f="colourway" value="${data.colourway}" autocomplete="off" /></label>
            <label class="st-field"><span class="st-field__label">Code</span><input class="st-input" data-f="code" value="${data.code}" autocomplete="off" /></label>
            <label class="st-field"><span class="st-field__label">Size</span><input class="st-input" data-f="size" value="${data.size}" autocomplete="off" /></label>
            <label class="st-field"><span class="st-field__label">Brand</span><input class="st-input" data-f="brand" value="${data.brand}" autocomplete="off" /></label>
          </div>
          <details class="st-bulk-row__bio">
            <summary>${icon('text', 14)} Bio ${data.bio ? html`<span class="st-muted">(from the text file)</span>` : html`<span class="st-muted">(none)</span>`}</summary>
            <textarea class="st-input st-textarea" data-f="bio" rows="3" placeholder="Optional description">${data.bio}</textarea>
          </details>
          <p class="st-bulk-row__notes"><span class="st-bulk-row__path">${icon('folder', 12)} ${item.folder.path || sourceName}</span>${notes(item)}</p>
        </div>
        <button type="button" class="st-icon-btn st-icon-btn--sm st-bulk-row__remove" data-remove aria-label="Leave this one out" title="Leave this one out">${icon('close', 15)}</button>
      </article>
    `;
  };

  function renderFoot() {
    const foot = $('[data-foot]', el);
    if (!foot) return;
    foot.hidden = items.length === 0;
    const photos = items.reduce((sum, item) => sum + Math.min(item.folder.photos.length, MAX_PHOTOS_EACH), 0);
    setHtml(
      foot,
      html`
        <label class="st-toggle st-toggle--inline">
          <input type="checkbox" data-option="drafts" ${options.drafts ? 'checked' : ''} />
          <span class="st-toggle__switch" aria-hidden="true"></span>
          <span class="st-toggle__text"><strong>Add as drafts</strong><small>Hidden until you switch them on</small></span>
        </label>
        <p class="st-add__count">${pluralise(items.length, 'product')} · ${pluralise(photos, 'photo')}${photos > 60 ? ` · about ${publishMinutes(photos)} min to publish` : ''}</p>
        <button type="button" class="st-btn st-btn--primary" data-add-all ${items.length === 0 ? 'disabled' : ''}>${icon('plus', 16)} Add ${pluralise(items.length, 'product')}</button>
      `,
    );
  }

  function render() {
    setHtml(
      el,
      html`
        ${addTabs('folders')}
        <header class="st-page-head">
          <div>
            <p class="st-eyebrow">${icon('folder', 14)} Bulk add</p>
            <h1 class="st-title">Add from <em class="st-title__accent">folders</em></h1>
            <p class="st-subtitle">One folder per product, with its photos and a text file giving the name, price, colourway and code. A bio is optional.</p>
          </div>
          <div class="st-page-head__actions">
            ${items.length ? html`<button type="button" class="st-btn st-btn--glass" data-choose>${icon('folder', 16)} Add another folder</button><button type="button" class="st-btn st-btn--ghost" data-clear>${icon('close', 16)} Start again</button>` : ''}
          </div>
        </header>
        ${
          items.length === 0
            ? html`
                <div class="st-columns st-columns--even">
                  <button type="button" class="st-add__drop" data-choose>
                    <span class="st-add__drop-icon">${icon('folder', 28)}</span>
                    <strong>Choose a folder</strong>
                    <span>or drag it here · up to ${MAX_PRODUCTS} products at a time</span>
                    ${touch ? html`<span class="st-hint st-hint--warn">${icon('info', 14)} Phones can't pick folders: do this on a computer (Chrome, Edge or Firefox), or use From photos.</span>` : ''}
                  </button>
                  <section class="st-card st-folder-help">
                    <h2 class="st-card__title">${icon('info', 18)} How to set it up</h2>
                    <pre class="st-tree">${`📁 Stock
   📁 Trainers
      📁 Nike Dunk Low Panda
         🖼 1.jpg  🖼 2.jpg  🖼 3.jpg
         📄 details.txt
      📁 Jordan 4 Military Black £180
         🖼 front.jpg  🖼 side.jpg
   📁 Clothing
      📁 Corteiz Alcatraz Hoodie
         …`}</pre>
                    <p class="st-card__sub">The text file (any name ending in .txt):</p>
                    <pre class="st-txt">${TEMPLATE.trim()}</pre>
                    <ul class="st-tips">
                      <li>${icon('check', 15)} <span>Only <strong>Name</strong> is needed. Leave out any line you don't have, <strong>Bio</strong> included.</span></li>
                      <li>${icon('check', 15)} <span>No labels? Put the name, price, colourway and code on their own lines, in that order, then the bio.</span></li>
                      <li>${icon('check', 15)} <span>No text file? The folder name is used, with a price if it ends in one, like <strong>Jordan 4 £180</strong>.</span></li>
                      <li>${icon('check', 15)} <span>Folders inside <strong>Trainers</strong>, <strong>Clothing</strong> etc. go in that category. The first photo (or one called <strong>cover</strong>) is the cover.</span></li>
                    </ul>
                    <button type="button" class="st-btn st-btn--ghost st-btn--sm" data-template>${icon('upload', 15)} Download an example text file</button>
                  </section>
                </div>
              `
            : html`
                <section class="st-card st-bulk-options">
                  <label class="st-field">
                    <span class="st-field__label">Category when a folder doesn't say</span>
                    <span class="st-select st-select--block">
                      <select data-option="defaultCategory">
                        ${store.categories().map((category) => html`<option value="${category.slug}" ${category.slug === options.defaultCategory ? 'selected' : ''}>${category.name}</option>`)}
                      </select>
                      ${icon('chevron-down', 14)}
                    </span>
                  </label>
                  <label class="st-field">
                    <span class="st-field__label">Condition for all</span>
                    <span class="st-select st-select--block">
                      <select data-option="condition">
                        <option value="">Not set</option>
                        ${CONDITIONS.map((value) => html`<option value="${value}" ${value === options.condition ? 'selected' : ''}>${value}</option>`)}
                      </select>
                      ${icon('chevron-down', 14)}
                    </span>
                  </label>
                  <label class="st-toggle">
                    <input type="checkbox" data-option="useBio" ${options.useBio ? 'checked' : ''} />
                    <span class="st-toggle__switch" aria-hidden="true"></span>
                    <span class="st-toggle__text"><strong>Use the bios from the text files</strong><small>Switch off to add them without descriptions.</small></span>
                  </label>
                  <label class="st-toggle" data-ai-option ${aiAvailable ? '' : 'hidden'}>
                    <input type="checkbox" data-option="aiBio" ${options.aiBio ? 'checked' : ''} />
                    <span class="st-toggle__switch" aria-hidden="true"></span>
                    <span class="st-toggle__text"><strong>${icon('sparkles', 14)} No bio? Let the AI write one</strong><small>From each product's first photo, using the free allowance.</small></span>
                  </label>
                </section>
                <p class="st-muted st-add__meta">${icon('folder', 14)} ${sourceName ? html`<strong>${sourceName}</strong> · ` : ''}${pluralise(items.length, 'product')} found. Change anything before adding.</p>
                <div class="st-bulk-list">${items.map(row)}</div>
              `
        }
        <div class="st-add__foot" data-foot hidden></div>
      `,
    );
    renderFoot();
  }

  // ---------------------------------------------------------------- events

  const itemOf = (target: Element) => items.find((item) => item.id === target.closest<HTMLElement>('[data-item]')?.dataset.item);

  el.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    const field = target.dataset.f as keyof ItemData | undefined;
    const item = field ? itemOf(target) : undefined;
    if (!item || !field) return;
    item.touched.add(field);
    if (field === 'price') item.data.price = priceOf(target.value);
    else (item.data as unknown as Record<string, unknown>)[field] = target.value;
  });

  el.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    const option = target.dataset.option as keyof typeof options | undefined;
    if (option) {
      if (target.type === 'checkbox') (options as Record<string, unknown>)[option] = target.checked;
      else (options as Record<string, unknown>)[option] = target.value;
      if (option === 'defaultCategory') {
        // Products whose folder didn't say follow the new default.
        for (const item of items) if (item.categoryFrom === 'default' && !item.touched.has('category')) item.data.category = target.value;
        render();
      }
      return;
    }
    const field = target.dataset.f as keyof ItemData | undefined;
    const item = field ? itemOf(target) : undefined;
    if (item && field === 'category') {
      item.touched.add('category');
      item.data.category = target.value;
    }
  });

  el.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('[data-choose]')) {
      const entries = await pickFolder();
      if (entries.length) load(entries);
      return;
    }
    if (target.closest('[data-add-all]')) {
      addAll();
      return;
    }
    if (target.closest('[data-template]')) {
      const url = URL.createObjectURL(new Blob([TEMPLATE.replace(/\n/g, '\r\n')], { type: 'text/plain' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'details.txt';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return;
    }
    if (target.closest('[data-clear]')) {
      for (const item of items) URL.revokeObjectURL(item.preview);
      items.length = 0;
      render();
      return;
    }
    const item = itemOf(target);
    if (item && target.closest('[data-remove]')) {
      items.splice(items.indexOf(item), 1);
      URL.revokeObjectURL(item.preview);
      render();
    }
  });

  // Drag a folder onto the page.
  el.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      el.classList.add('is-dropping');
    }
  });
  el.addEventListener('dragleave', (event) => {
    if (!el.contains(event.relatedTarget as Node | null)) el.classList.remove('is-dropping');
  });
  el.addEventListener('drop', async (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    el.classList.remove('is-dropping');
    const entries = await readDrop(event.dataTransfer);
    if (entries.length) load(entries);
  });
  // (Also lets tests hand over a folder's files directly.)
  el.addEventListener('studio:folder', (event) => load((event as CustomEvent<FolderEntry[]>).detail));

  const leaveGuard = (event: BeforeUnloadEvent) => {
    if (items.length === 0) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', leaveGuard);

  render();
  return {
    el,
    update(reason) {
      if ((reason === 'categories' || reason === 'settings') && !el.contains(document.activeElement)) render();
    },
    destroy() {
      window.removeEventListener('beforeunload', leaveGuard);
    },
  };
}
