// Add from photos: drop in photos (one piece per photo) and each becomes a listing the AI fills in
// (category, name, brand, condition, what's included, description and a suggested price). The owner
// checks them, then adds them all at once; they go live with the next Publish.
//
// Each item holds a list of photos, so a later version can take a folder per product (several photos,
// with the name and price in the folder name) and put them through the same review.
import { AUTHENTICITY_LABELS } from '../../lib/labels.ts';
import { aiStatus, identify, type AiStatus, type Suggestion } from '../lib/ai.ts';
import { $, $$, html, pluralise, setHtml } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import { preparePhoto, type PreparedPhoto } from '../lib/media.ts';
import type { Context, View } from '../shell.ts';
import { categoryOptions, dropZone, errorMessage, pickFiles, toast } from '../ui.ts';
import { addTabs } from './add-tabs.ts';
import { CONDITIONS, INCLUDES } from './product-form.ts';

type ItemState = 'preparing' | 'thinking' | 'ready' | 'error';

interface ItemData {
  title: string;
  category: string;
  brand: string;
  price: number | null;
  condition: string;
  includes: string[];
  description: string;
  colourway: string;
  styleCode: string;
  authenticity: string;
}

interface Item {
  id: string;
  file: File;
  photos: PreparedPhoto[];
  preview: string;
  state: ItemState;
  error?: string;
  sample?: boolean;
  confidence?: number;
  /** Fields the owner changed, which the AI mustn't overwrite. */
  touched: Set<keyof ItemData>;
  data: ItemData;
}

const MAX_AT_ONCE = 40;
const WORKERS = 2;

// Kept while the Studio is open, so leaving the page and coming back doesn't lose anything.
const items: Item[] = [];
let asDrafts = false;

const newId = () => Math.random().toString(36).slice(2, 10);

const blank = (category: string): ItemData => ({
  title: '',
  category,
  brand: '',
  price: null,
  condition: '',
  includes: [],
  description: '',
  colourway: '',
  styleCode: '',
  authenticity: '',
});

function parsePrice(value: string): number | null {
  const cleaned = value.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
}

export function addPhotosView(context: Context): View {
  const { store } = context;
  const el = document.createElement('div');
  el.className = 'st-add';
  let ai: AiStatus = { available: false, sample: false };
  let running = 0;
  let aiChecked = false;

  const addable = () => items.filter((item) => (item.state === 'ready' || item.state === 'error') && item.photos.length > 0);
  const missingName = (item: Item) => !item.data.title.trim();

  // ---------------------------------------------------------------- work queue

  function apply(item: Item, listing: Suggestion) {
    const categories = store.categories();
    const suggested: Partial<ItemData> = {
      title: listing.title,
      category: categories.some((category) => category.slug === listing.category) ? listing.category : item.data.category,
      brand: listing.brand,
      price: listing.price,
      condition: listing.condition,
      includes: listing.includes,
      description: listing.description,
      colourway: listing.colourway,
      styleCode: listing.styleCode,
    };
    for (const [field, value] of Object.entries(suggested) as [keyof ItemData, never][]) {
      if (!item.touched.has(field) && value !== undefined && value !== null && value !== '') item.data[field] = value;
    }
    if (listing.price === null && !item.touched.has('price')) item.data.price = null;
    item.confidence = listing.confidence;
  }

  async function work(item: Item) {
    try {
      if (item.photos.length === 0) {
        item.state = 'preparing';
        renderItem(item);
        const photo = await preparePhoto(item.file);
        item.photos = [photo];
        URL.revokeObjectURL(item.preview);
        item.preview = URL.createObjectURL(photo.blob);
      }
      if (!ai.available) {
        item.state = 'ready';
        return;
      }
      item.state = 'thinking';
      renderItem(item);
      const { listing, sample } = await identify(store, item.photos[0].blob, item.file.name);
      if (!items.includes(item)) return;
      apply(item, listing);
      item.sample = sample;
      item.state = 'ready';
      item.error = undefined;
    } catch (error) {
      item.state = 'error';
      item.error = errorMessage(error);
    } finally {
      renderItem(item);
      renderFoot();
    }
  }

  async function pump() {
    if (!aiChecked) {
      ai = await aiStatus(store);
      aiChecked = true;
      renderIntro();
    }
    while (running < WORKERS) {
      const next = items.find((item) => item.state === 'preparing' && !(item as Item & { busy?: boolean }).busy);
      if (!next) break;
      (next as Item & { busy?: boolean }).busy = true;
      running += 1;
      work(next).finally(() => {
        (next as Item & { busy?: boolean }).busy = false;
        running -= 1;
        pump();
      });
    }
  }

  function addFiles(files: File[]) {
    const photos = files.filter((file) => file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif|hei[cf])$/i.test(file.name));
    if (photos.length === 0) {
      toast('Choose photos (JPG, PNG, WebP or iPhone photos).', { tone: 'warn' });
      return;
    }
    const room = MAX_AT_ONCE - items.length;
    if (room <= 0) {
      toast(`Add these ${items.length} first, then do the next batch.`, { tone: 'info' });
      return;
    }
    if (photos.length > room) toast(`Taking the first ${room}: up to ${MAX_AT_ONCE} at a time.`, { tone: 'info' });
    const fallback = store.categories()[0]?.slug ?? '';
    for (const file of photos.slice(0, room)) {
      items.push({ id: newId(), file, photos: [], preview: URL.createObjectURL(file), state: 'preparing', touched: new Set(), data: blank(fallback) });
    }
    render();
    pump();
  }

  // ---------------------------------------------------------------- adding them to the store

  function addAll() {
    const ready = addable();
    const unnamed = ready.filter(missingName);
    if (unnamed.length) {
      toast(`${pluralise(unnamed.length, 'piece')} still ${unnamed.length === 1 ? 'needs' : 'need'} a name.`, { tone: 'warn' });
      $(`[data-item="${unnamed[0].id}"] [data-f="title"]`, el)?.focus();
      return;
    }
    if (ready.length === 0) return;
    const now = Date.now();
    ready.forEach((item, index) => {
      const product = store.createProduct(item.data.category);
      store.updateProduct(
        product.id,
        {
          title: item.data.title.trim(),
          category: item.data.category,
          brand: item.data.brand.trim(),
          price: item.data.price,
          condition: item.data.condition,
          includes: item.data.includes,
          body: item.data.description.trim(),
          colourway: item.data.colourway.trim(),
          styleCode: item.data.styleCode.trim(),
          authenticity: item.data.authenticity,
          draft: asDrafts,
          // Keeps them in the order they were added (newest first on the site).
          date: new Date(now - index * 1000).toISOString(),
        },
        true,
      );
      store.addPhotos(
        product.id,
        item.photos.map((photo) => ({ name: photo.name, blob: photo.blob })),
      );
      URL.revokeObjectURL(item.preview);
      items.splice(items.indexOf(item), 1);
    });
    store.emit('products');
    toast(`${pluralise(ready.length, 'product')} added${asDrafts ? ' as drafts' : ''}. Press Publish to put ${ready.length === 1 ? 'it' : 'them'} on your site.`, { tone: 'ok', timeout: 7000 });
    context.navigate('#/products?status=changed');
  }

  // ---------------------------------------------------------------- drawing

  function renderIntro() {
    const box = $('[data-intro]', el);
    if (!box) return;
    const chip = !aiChecked
      ? html`<span class="st-ai-chip">${icon('sparkles', 14)} Checking the AI…</span>`
      : ai.available && ai.sample
        ? html`<span class="st-ai-chip st-ai-chip--sample">${icon('info', 14)} Sample suggestions on this PC · the real AI runs on your live site</span>`
        : ai.available
          ? html`<span class="st-ai-chip">${icon('sparkles', 14)} Free AI · about 150 photos a day</span>`
          : html`<span class="st-ai-chip st-ai-chip--off">${icon('alert', 14)} The AI isn't available here, so fill the details in yourself</span>`;
    setHtml(box, chip);
  }

  const itemFields = (item: Item) => {
    const { data } = item;
    const busy = item.state === 'preparing' || item.state === 'thinking';
    const symbol = store.currencySymbol();
    return html`
      <label class="st-field">
        <span class="st-field__label">Name ${missingName(item) && !busy ? html`<em class="st-required">Needed</em>` : ''}</span>
        <input class="st-input" data-f="title" value="${data.title}" placeholder="${busy ? 'Looking at the photo…' : 'e.g. Nike Dunk Low Panda'}" autocomplete="off" ${busy ? 'disabled' : ''} />
      </label>
      <div class="st-grid-2">
        <label class="st-field">
          <span class="st-field__label">Category</span>
          <span class="st-select st-select--block">
            <select data-f="category" ${busy ? 'disabled' : ''}>
              ${categoryOptions(store, data.category)}
            </select>
            ${icon('chevron-down', 14)}
          </span>
        </label>
        <label class="st-field">
          <span class="st-field__label">Price ${data.price !== null && !item.touched.has('price') && item.state === 'ready' && !item.sample ? html`<em class="st-ai-suggested">${icon('sparkles', 11)} suggested</em>` : ''}</span>
          <span class="st-money"><span>${symbol}</span><input class="st-input" data-f="price" value="${data.price ?? ''}" inputmode="decimal" placeholder="Ask for price" autocomplete="off" ${busy ? 'disabled' : ''} /></span>
        </label>
        <label class="st-field">
          <span class="st-field__label">Brand</span>
          <input class="st-input" data-f="brand" value="${data.brand}" autocomplete="off" ${busy ? 'disabled' : ''} />
        </label>
        <label class="st-field">
          <span class="st-field__label">Condition</span>
          <span class="st-select st-select--block">
            <select data-f="condition" ${busy ? 'disabled' : ''}>
              <option value="">Not set</option>
              ${CONDITIONS.map((value) => html`<option value="${value}" ${value === data.condition ? 'selected' : ''}>${value}</option>`)}
            </select>
            ${icon('chevron-down', 14)}
          </span>
        </label>
      </div>
      <div class="st-field">
        <span class="st-field__label">What's included</span>
        <div class="st-choices st-choices--sm">
          ${INCLUDES.map(
            (include) => html`<button type="button" class="st-choice ${data.includes.includes(include) ? 'is-on' : ''}" data-include="${include}" aria-pressed="${data.includes.includes(include)}" ${busy ? 'disabled' : ''}>${data.includes.includes(include) ? icon('check', 13) : icon('plus', 13)} ${include}</button>`,
          )}
        </div>
      </div>
      <label class="st-field">
        <span class="st-field__label">Description</span>
        <textarea class="st-input st-textarea" data-f="description" rows="3" placeholder="${busy ? 'Writing a description…' : 'A couple of lines about it'}" ${busy ? 'disabled' : ''}>${data.description}</textarea>
      </label>
      <label class="st-field">
        <span class="st-field__label">Where it's from</span>
        <span class="st-select st-select--block">
          <select data-f="authenticity" ${busy ? 'disabled' : ''}>
            <option value="">Don't show</option>
            ${Object.entries(AUTHENTICITY_LABELS).map(([value, label]) => html`<option value="${value}" ${value === data.authenticity ? 'selected' : ''}>${label}</option>`)}
          </select>
          ${icon('chevron-down', 14)}
        </span>
      </label>
    `;
  };

  function itemMarkup(item: Item) {
    const status =
      item.state === 'preparing'
        ? html`<span class="st-ai-status">${icon('image', 13)} Getting the photo ready…</span>`
        : item.state === 'thinking'
          ? html`<span class="st-ai-status st-ai-status--thinking">${icon('sparkles', 13)} Looking at it…</span>`
          : item.state === 'error'
            ? html`<span class="st-ai-status st-ai-status--error">${icon('alert', 13)} Fill in yourself</span>`
            : item.sample
              ? html`<span class="st-ai-status st-ai-status--sample">${icon('info', 13)} Sample</span>`
              : (item.confidence ?? 1) < 0.5
                ? html`<span class="st-ai-status st-ai-status--guess">${icon('sparkles', 13)} Best guess: check it</span>`
                : html`<span class="st-ai-status st-ai-status--ready">${icon('check', 13)} Filled in</span>`;
    return html`
      <article class="st-ai-card is-${item.state}" data-item="${item.id}">
        <div class="st-ai-card__inner">
        <div class="st-ai-card__media">
          <img src="${item.preview}" alt="" />
          ${status}
          <button type="button" class="st-icon-btn st-icon-btn--sm st-ai-card__remove" data-remove aria-label="Remove this photo" title="Remove">${icon('close', 15)}</button>
          ${item.state === 'thinking' ? html`<span class="st-ai-card__scan" aria-hidden="true"></span>` : ''}
        </div>
        <div class="st-ai-card__fields">
          ${item.error ? html`<p class="st-hint st-hint--warn">${icon('alert', 14)} ${item.error} <button type="button" class="st-link-btn" data-retry>Try again</button></p>` : ''}
          ${itemFields(item)}
        </div>
        </div>
      </article>
    `;
  }

  function renderItem(item: Item) {
    const card = $(`[data-item="${item.id}"]`, el);
    if (!card) return;
    // Don't redraw under someone typing in this card.
    if (card.contains(document.activeElement) && item.state === 'ready') return;
    const template = document.createElement('template');
    template.innerHTML = itemMarkup(item).value.trim();
    card.replaceWith(template.content.firstElementChild!);
  }

  function renderFoot() {
    const foot = $('[data-foot]', el);
    if (!foot) return;
    const ready = addable();
    const waiting = items.filter((item) => item.state === 'preparing' || item.state === 'thinking').length;
    foot.hidden = items.length === 0;
    setHtml(
      foot,
      html`
        <label class="st-toggle st-toggle--inline">
          <input type="checkbox" data-drafts ${asDrafts ? 'checked' : ''} />
          <span class="st-toggle__switch" aria-hidden="true"></span>
          <span class="st-toggle__text"><strong>Add as drafts</strong><small>Hidden until you switch them on</small></span>
        </label>
        <p class="st-add__count">${waiting ? html`${icon('sparkles', 14)} ${pluralise(waiting, 'photo')} still being looked at` : html`${pluralise(ready.length, 'piece')} ready`}</p>
        <button type="button" class="st-btn st-btn--primary" data-add-all ${ready.length === 0 ? 'disabled' : ''}>${icon('plus', 16)} Add ${ready.length ? pluralise(ready.length, 'product') : 'products'}</button>
      `,
    );
    const count = $('[data-count]', el);
    if (count) count.textContent = items.length ? `${pluralise(items.length, 'photo')}` : '';
  }

  function render() {
    setHtml(
      el,
      html`
        ${addTabs('photos')}
        <header class="st-page-head">
          <div>
            <p class="st-eyebrow">${icon('sparkles', 14)} AI listing</p>
            <h1 class="st-title">Add from <em class="st-title__accent">photos</em></h1>
            <p class="st-subtitle">Drop in photos, one piece per photo. Each one gets a category, name, description, what's included and a suggested price. Check them, then add them.</p>
            <div class="st-add__intro" data-intro></div>
          </div>
          <div class="st-page-head__actions">
            ${items.length ? html`<button type="button" class="st-btn st-btn--glass" data-choose>${icon('upload', 16)} Add more photos</button>` : ''}
          </div>
        </header>
        ${
          items.length === 0
            ? html`<button type="button" class="st-add__drop" data-choose>
                <span class="st-add__drop-icon">${icon('upload', 28)}</span>
                <strong>Choose photos</strong>
                <span>or drop them here · up to ${MAX_AT_ONCE} at a time</span>
                <span class="st-add__tips">
                  <span>${icon('check', 13)} One piece per photo</span>
                  <span>${icon('check', 13)} Clear, bright shots work best</span>
                  <span>${icon('check', 13)} Show the box or tags if you have them</span>
                </span>
              </button>`
            : html`<p class="st-muted st-add__meta"><span data-count></span> · Tap a card to change anything. Suggested prices are only a starting point.</p>
                <div class="st-ai-grid">${items.map(itemMarkup)}</div>`
        }
        <div class="st-add__foot" data-foot hidden></div>
      `,
    );
    renderIntro();
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
    if (field === 'price') item.data.price = parsePrice(target.value);
    else (item.data as unknown as Record<string, unknown>)[field] = target.value;
    if (field === 'title') {
      const required = target.closest('.st-field')?.querySelector('.st-required');
      if (required && target.value.trim()) required.remove();
    }
  });

  el.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.matches('[data-drafts]')) {
      asDrafts = target.checked;
      return;
    }
    const field = target.dataset.f as keyof ItemData | undefined;
    const item = field ? itemOf(target) : undefined;
    if (!item || !field || target.tagName !== 'SELECT') return;
    item.touched.add(field);
    (item.data as unknown as Record<string, unknown>)[field] = target.value;
  });

  el.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('[data-choose]')) {
      addFiles(await pickFiles({ accept: 'image/*', multiple: true }));
      return;
    }
    if (target.closest('[data-add-all]')) {
      addAll();
      return;
    }
    const item = itemOf(target);
    if (!item) return;
    if (target.closest('[data-remove]')) {
      items.splice(items.indexOf(item), 1);
      URL.revokeObjectURL(item.preview);
      const card = target.closest('[data-item]') as HTMLElement;
      card.classList.add('is-leaving');
      setTimeout(() => (items.length ? (card.remove(), renderFoot()) : render()), 200);
      return;
    }
    if (target.closest('[data-retry]')) {
      item.state = 'preparing';
      item.error = undefined;
      renderItem(item);
      pump();
      return;
    }
    const include = target.closest<HTMLElement>('[data-include]');
    if (include) {
      const value = include.dataset.include!;
      item.touched.add('includes');
      item.data.includes = item.data.includes.includes(value) ? item.data.includes.filter((entry) => entry !== value) : [...item.data.includes, value];
      const on = item.data.includes.includes(value);
      include.classList.toggle('is-on', on);
      include.setAttribute('aria-pressed', String(on));
      setHtml(include, html`${icon(on ? 'check' : 'plus', 13)} ${value}`);
    }
  });

  const leaveGuard = (event: BeforeUnloadEvent) => {
    if (items.length === 0) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', leaveGuard);

  render();
  dropZone(el, addFiles);
  pump();

  return {
    el,
    update(reason) {
      if (reason === 'categories' || reason === 'settings') {
        // Category names or the currency changed: redraw cards nobody is typing in.
        for (const item of items) renderItem(item);
      }
    },
    destroy() {
      window.removeEventListener('beforeunload', leaveGuard);
    },
  };
}
