// The live editor: the real site in a frame. Hover to see what can be edited, click text to type on the
// page, click a product or photo to edit it in the side panel. Changes show on the page straight away
// and go live when published.
//
// The site marks editable things with data-edit="…" (and data-field="…" inside product cards); see
// AGENTS.md. The frame is the same website, so the Studio can reach into its page directly.
import { accentParts, TEXT_GROUPS } from '../../lib/copy-fields.ts';
import { $, $$, escapeHtml, html, setHtml } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import type { Context, View } from '../shell.ts';
import { defaultText, type Product, type Reason } from '../store.ts';
import { hydrateMedia, openSheet, toast } from '../ui.ts';
import { productForm, type ProductForm } from './product-form.ts';
import { accentPreview, fieldOf } from './text.ts';

type Target =
  | { kind: 'text'; key: string }
  | { kind: 'ticker'; key: string }
  | { kind: 'product'; key: string; id: string; part?: string }
  | { kind: 'product-text'; key: string; id: string; field: 'title' | 'brand' }
  | { kind: 'category'; key: string; slug: string; field: 'name' | 'description' };

const PRODUCT_PARTS: Record<string, string> = {
  images: 'Photos',
  video: 'Video',
  price: 'Price & status',
  details: 'Details',
  body: 'Description',
  tags: 'Search words',
  authenticity: "Where it's from",
  title: 'Product name',
  brand: 'Brand',
};

const DEVICE_KEY = 'central-supply.studio.live-device';

export function parseTarget(key: string): Target | undefined {
  const [type, ...rest] = key.split(':');
  if (type === 'site' && rest[0] === 'ticker') return { kind: 'ticker', key };
  if (type === 'site' || type === 'copy') return { kind: 'text', key };
  if (type === 'product' && rest[0]) {
    const [id, part] = rest;
    if (part === 'title' || part === 'brand') return { kind: 'product-text', key, id, field: part };
    return { kind: 'product', key, id, part };
  }
  if (type === 'category' && rest[0]) return { kind: 'category', key, slug: rest[0], field: rest[1] === 'description' ? 'description' : 'name' };
  return undefined;
}

/** Only this site's own pages can be shown in the frame. */
function safePath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\s]/.test(value)) return '/';
  return value;
}

const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

// Styles added to the site's page while it's in the editor.
const PAGE_STYLE = `
html[data-studio-edit] [data-edit] { cursor: pointer; }
html[data-studio-edit] .reel__fill { animation-play-state: paused !important; }
[data-studio-editing] {
  outline: 2px solid #36d6ff !important;
  outline-offset: 5px;
  border-radius: 4px;
  caret-color: #36d6ff;
  cursor: text !important;
  -webkit-user-select: text !important;
  user-select: text !important;
  min-width: 1ch;
}
[data-studio-editing]:empty::before { content: attr(data-studio-placeholder); opacity: .45; }
[data-studio-flash] { animation: studio-flash 1.4s ease; }
@keyframes studio-flash { 0%, 60% { outline: 3px solid rgba(54, 214, 255, .9); outline-offset: 6px; } 100% { outline: 3px solid transparent; outline-offset: 12px; } }
`;

// The highlight boxes and the Done/Cancel bar live in a shadow root, so the site's styles can't touch them.
const LAYER_STYLE = `
:host { all: initial; }
:host { --s: 1; }
.box { position: fixed; pointer-events: none; border: calc(2px * var(--s)) solid #5b7cff; border-radius: 10px; box-shadow: 0 0 0 5px rgba(91,124,255,.16); opacity: 0; transition: opacity .15s ease, transform .15s ease; }
.box.is-on { opacity: 1; }
.box--selected { border-color: #36d6ff; box-shadow: 0 0 0 5px rgba(54,214,255,.18), 0 0 40px rgba(54,214,255,.25); }
.label { position: absolute; left: -2px; bottom: calc(100% + 6px); transform: scale(var(--s)); transform-origin: bottom left; display: inline-flex; align-items: center; gap: 6px; max-width: 280px; padding: 5px 9px; border-radius: 7px; background: #5b7cff; color: #fff; font: 600 11.5px/1.2 'Geist Variable', system-ui, sans-serif; letter-spacing: .01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 6px 20px rgba(0,0,0,.35); }
.box.is-below .label { bottom: auto; top: calc(100% + 6px); transform-origin: top left; }
.box--selected .label { background: #36d6ff; color: #041018; }
.label small { opacity: .75; font-weight: 500; }
.bar { position: fixed; pointer-events: auto; transform: scale(var(--s)); transform-origin: top left; display: none; align-items: center; gap: 6px; padding: 6px; border-radius: 14px; background: rgba(14,14,19,.94); border: 1px solid rgba(255,255,255,.14); box-shadow: 0 18px 50px rgba(0,0,0,.55); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); font: 500 12.5px/1.2 'Geist Variable', system-ui, sans-serif; color: #f4f4f7; z-index: 2; }
.bar.is-on { display: flex; animation: pop .18s cubic-bezier(.22,1,.36,1); }
@keyframes pop { from { opacity: 0; transform: translateY(6px) scale(.97); } }
.bar button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 12px; border-radius: 10px; cursor: pointer; font: 600 12.5px/1 'Geist Variable', system-ui, sans-serif; }
.bar .done { background: linear-gradient(115deg, #7b9bff, #5b7cff 45%, #9b7bff); color: #fff; }
.bar .cancel { color: #c9c9d3; }
.bar .cancel:hover { background: rgba(255,255,255,.08); }
.bar .hint { padding: 0 6px; color: #a3a3ae; white-space: nowrap; }
@media (max-width: 520px) { .bar .hint { display: none; } }
`;

export function liveView(context: Context): View {
  const { store } = context;
  let path = safePath(context.route.query.get('path'));
  let pendingKey = context.route.query.get('key') ?? '';
  let editMode = true;
  let device: 'phone' | 'desktop' = 'desktop';
  try {
    device = localStorage.getItem(DEVICE_KEY) === 'phone' || matchMedia('(max-width: 720px)').matches ? 'phone' : 'desktop';
  } catch {
    // Use the default.
  }

  const el = document.createElement('div');
  el.className = 'st-live';
  let doc: Document | null = null;
  let win: Window | null = null;
  let layer: ShadowRoot | null = null;
  let hovered: HTMLElement | null = null;
  let selected: { element: HTMLElement; target: Target } | null = null;
  let editing: { element: HTMLElement; target: Target; originalHtml: string; original: string; start: string; accent: boolean } | null = null;
  let form: ProductForm | null = null;
  let formProduct = '';
  let mobileSheet: ReturnType<typeof openSheet> | null = null;
  let scrollAfterLoad: number | null = null;
  let layerHost: HTMLElement | null = null;
  /** How much the frame is shrunk to show the desktop site in a smaller space. */
  let frameScale = 1;
  const narrow = () => matchMedia('(max-width: 900px)').matches;

  setHtml(
    el,
    html`
      <div class="st-live__bar">
        <div class="st-live__where">
          <label class="st-select st-live__pages">
            <span class="st-sr">Page</span>
            <select data-page></select>
            ${icon('chevron-down', 14)}
          </label>
          <span class="st-live__path" data-path></span>
        </div>
        <div class="st-segmented st-live__mode" role="group" aria-label="Mode">
          <button type="button" data-mode="edit" class="is-active" title="Click things to edit them">${icon('edit', 16)}<span>Edit</span></button>
          <button type="button" data-mode="browse" title="Click around your site normally">${icon('cursor', 16)}<span>Browse</span></button>
        </div>
        <div class="st-live__tools">
          <div class="st-segmented st-live__device" role="group" aria-label="Screen size">
            <button type="button" data-device="phone" title="Phone">${icon('phone', 17)}</button>
            <button type="button" data-device="desktop" title="Computer">${icon('desktop', 17)}</button>
          </div>
          <button type="button" class="st-icon-btn" data-reload title="Reload">${icon('refresh', 17)}</button>
          <button type="button" class="st-icon-btn st-live__panel-toggle" data-toggle-panel title="Show or hide the side panel" aria-pressed="true">${icon('list', 17)}</button>
          <a class="st-icon-btn" data-open title="Open in a new tab" target="_blank" rel="noopener">${icon('arrow-up-right', 17)}</a>
        </div>
      </div>
      <div class="st-live__stage">
        <div class="st-live__canvas" data-canvas>
          <div class="st-live__device-frame" data-frame>
            <iframe title="Your site" data-iframe></iframe>
            <div class="st-live__loading" data-loading><span class="st-spinner"></span><span>Loading your site…</span></div>
          </div>
        </div>
        <aside class="st-live__panel" data-panel aria-label="Editor"></aside>
      </div>
    `,
  );

  const iframe = $<HTMLIFrameElement>('[data-iframe]', el)!;
  const panel = $('[data-panel]', el)!;
  const frame = $('[data-frame]', el)!;

  // ---------------------------------------------------------------- toolbar

  function renderPages() {
    const select = $<HTMLSelectElement>('[data-page]', el);
    if (!select) return;
    const products = store.productList().filter((product) => !product.isNew && !product.base.draft);
    // Categories (and sub-categories) with something in them have a page.
    const categories = store.categories().filter((category) => products.some((product) => store.inCategory(product.base.category, category.slug)));
    const options: [string, string][] = [
      ['/', 'Home page'],
      ['/shop/', 'Shop all'],
      ...categories.map((category): [string, string] => [`/category/${category.slug}/`, `Category: ${store.categoryLabel(category.slug)}`]),
      ...products.slice(0, 200).map((product): [string, string] => [`/product/${product.id}/`, `Product: ${product.base.title}`]),
      ['/404/', 'Page not found'],
    ];
    if (!options.some(([value]) => value === path)) options.unshift([path, path]);
    setHtml(select, html`${options.map(([value, label]) => html`<option value="${value}" ${value === path ? 'selected' : ''}>${label}</option>`)}`);
  }

  function renderBar() {
    $$('[data-mode]', el).forEach((button) => button.classList.toggle('is-active', (button.dataset.mode === 'edit') === editMode));
    $$('[data-device]', el).forEach((button) => button.classList.toggle('is-active', button.dataset.device === device));
    el.classList.toggle('is-phone', device === 'phone');
    el.classList.toggle('is-browsing', !editMode);
    const pathEl = $('[data-path]', el);
    if (pathEl) pathEl.textContent = path;
    const open = $<HTMLAnchorElement>('[data-open]', el);
    if (open) open.href = store.siteUrl(path);
  }

  function load(nextPath: string, keepScroll = false) {
    path = safePath(nextPath);
    scrollAfterLoad = keepScroll && win ? win.scrollY : null;
    finishInline(true);
    deselect();
    $('[data-loading]', el)?.classList.add('is-on');
    iframe.src = store.siteUrl(path);
    syncAddress();
    renderPages();
    renderBar();
  }

  function syncAddress() {
    const params = new URLSearchParams({ path });
    history.replaceState(null, '', `#/live?${params}`);
  }

  // ---------------------------------------------------------------- the page in the frame

  function onFrameLoad() {
    try {
      doc = iframe.contentDocument;
      win = iframe.contentWindow;
    } catch {
      doc = null;
    }
    // (A new frame reports loading its blank placeholder page first: wait for the real one.)
    if (!doc || !win || win.location.href === 'about:blank') return;
    $('[data-loading]', el)?.classList.remove('is-on');

    // Follow links clicked inside the frame (but not into the admin itself).
    const framePath = win.location.pathname.slice(store.siteUrl('/').length - 1) || '/';
    if (framePath.startsWith('/admin')) {
      toast("That's this admin. Pick a page of your site from the menu at the top.", { tone: 'info' });
      load(path);
      return;
    }
    if (framePath !== path) {
      path = safePath(framePath);
      syncAddress();
      renderPages();
    }
    renderBar();

    const style = doc.createElement('style');
    style.dataset.studio = '';
    style.textContent = PAGE_STYLE;
    doc.head.append(style);
    doc.documentElement.toggleAttribute('data-studio-edit', editMode);
    // Hide Astro's developer toolbar in the frame when running locally.
    doc.querySelector('astro-dev-toolbar')?.setAttribute('hidden', '');

    const host = doc.createElement('div');
    host.dataset.studioLayer = '';
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
    host.style.setProperty('--s', String(1 / frameScale));
    layerHost = host;
    layer = host.attachShadow({ mode: 'open' });
    layer.innerHTML = `<style>${LAYER_STYLE}</style><div class="box" data-hover><span class="label"></span></div><div class="box box--selected" data-selected><span class="label"></span></div><div class="bar" data-inline-bar><button type="button" class="done" data-done>✓ Done</button><button type="button" class="cancel" data-cancel>Cancel</button><span class="hint" data-hint></span></div>`;
    doc.body.append(host);

    layer.querySelector('[data-done]')?.addEventListener('pointerdown', (event) => event.preventDefault());
    layer.querySelector('[data-cancel]')?.addEventListener('pointerdown', (event) => event.preventDefault());
    layer.querySelector('[data-done]')?.addEventListener('click', () => finishInline(true));
    layer.querySelector('[data-cancel]')?.addEventListener('click', () => finishInline(false));

    doc.addEventListener('mousemove', onHover, { passive: true });
    doc.addEventListener('mouseleave', () => setBox('hover', null));
    doc.addEventListener('click', onClick, true);
    for (const type of ['pointerdown', 'pointerup', 'mousedown']) doc.addEventListener(type, onPress, true);
    doc.addEventListener('submit', (event) => {
      if (editMode) event.preventDefault();
    }, true);
    doc.addEventListener('keydown', onKey, true);
    win.addEventListener('scroll', place, { passive: true });
    win.addEventListener('resize', place);

    syncPage();
    if (scrollAfterLoad !== null) win.scrollTo(0, scrollAfterLoad);
    scrollAfterLoad = null;
    if (pendingKey) {
      const key = pendingKey;
      pendingKey = '';
      setTimeout(() => reveal(key), 350);
    }
    renderPanel();
  }

  iframe.addEventListener('load', onFrameLoad);

  // (Elements in the frame belong to its own window, so `instanceof Element` can't be used for them.)
  const editableOf = (node: EventTarget | null): HTMLElement | null =>
    node && typeof (node as Element).closest === 'function' ? ((node as Element).closest<HTMLElement>('[data-edit]') ?? null) : null;

  function labelFor(target: Target): { title: string; sub?: string } {
    if (target.kind === 'text' || target.kind === 'ticker') return { title: fieldOf(target.key)?.label ?? 'Text', sub: 'click to edit' };
    if (target.kind === 'category') return { title: target.field === 'name' ? 'Category name' : 'Category description', sub: 'click to edit' };
    const product = store.product(target.id);
    if (target.kind === 'product-text') return { title: PRODUCT_PARTS[target.field], sub: 'click to edit' };
    if (target.part) return { title: PRODUCT_PARTS[target.part] ?? 'Product', sub: product?.data.title };
    return { title: product?.data.title || 'Product', sub: 'click to edit' };
  }

  function setBox(which: 'hover' | 'selected', element: HTMLElement | null, target?: Target) {
    const box = layer?.querySelector<HTMLElement>(which === 'hover' ? '[data-hover]' : '[data-selected]');
    if (!box) return;
    if (!element || !element.isConnected) {
      box.classList.remove('is-on');
      return;
    }
    const rect = element.getBoundingClientRect();
    const pad = 6;
    box.style.left = `${rect.left - pad}px`;
    box.style.top = `${rect.top - pad}px`;
    box.style.width = `${rect.width + pad * 2}px`;
    box.style.height = `${rect.height + pad * 2}px`;
    box.classList.toggle('is-below', rect.top < 40 / frameScale);
    if (target) {
      const label = labelFor(target);
      const labelEl = box.querySelector('.label');
      if (labelEl) labelEl.innerHTML = `${escapeHtml(label.title)}${label.sub ? ` <small>${escapeHtml(label.sub)}</small>` : ''}`;
    }
    box.classList.add('is-on');
  }

  function place() {
    if (hovered) setBox('hover', hovered);
    if (selected && !editing) setBox('selected', selected.element);
    if (editing) {
      setBox('selected', null);
      placeBar(editing.element);
    }
  }

  function placeBar(element: HTMLElement) {
    const bar = layer?.querySelector<HTMLElement>('[data-inline-bar]');
    if (!bar || !win) return;
    const rect = element.getBoundingClientRect();
    const zoom = 1 / frameScale;
    const width = (bar.offsetWidth || 220) * zoom;
    const height = 48 * zoom;
    const left = Math.max(8, Math.min(rect.left, win.innerWidth - width - 8));
    const above = rect.top - height - 8 * zoom;
    bar.style.left = `${left}px`;
    bar.style.top = `${above > 8 ? above : Math.min(rect.bottom + 12 * zoom, win.innerHeight - height - 8)}px`;
  }

  function onHover(event: MouseEvent) {
    if (!editMode || editing) return;
    const element = editableOf(event.target);
    if (element === hovered) return;
    hovered = element;
    const target = element ? parseTarget(element.dataset.edit ?? '') : undefined;
    if (!element || !target || element === selected?.element) setBox('hover', null);
    else setBox('hover', element, target);
  }

  function onPress(event: Event) {
    if (!editMode) return;
    const element = editableOf(event.target);
    if (element || (event.target as Element)?.closest?.('[data-studio-layer]')) event.stopPropagation();
  }

  function onKey(event: KeyboardEvent) {
    if (!editing) {
      if (event.key === 'Escape' && selected) deselect();
      return;
    }
    const long = fieldOf(editing.target.key)?.long || (editing.target.kind === 'category' && editing.target.field === 'description');
    if (event.key === 'Enter' && !(long && event.shiftKey)) {
      event.preventDefault();
      finishInline(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finishInline(false);
    }
  }

  function onClick(event: MouseEvent) {
    if (!editMode || !doc) return;
    const target = event.target as Element;
    if (target?.closest?.('[data-studio-layer]')) return;
    if (editing && editing.element.contains(target)) {
      event.preventDefault();
      return;
    }
    const element = editableOf(target);
    if (!element) {
      const link = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (editing) finishInline(true);
      if (link) {
        const url = new URL(link.href, doc.baseURI);
        if (url.origin !== location.origin || link.target === '_blank') {
          event.preventDefault();
          toast('Links to other sites are paused while editing. Switch to Browse to try them.', { tone: 'info', timeout: 3000 });
        } else if (url.pathname.startsWith(store.siteUrl('/admin/'))) {
          event.preventDefault();
        }
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    select(element);
  }

  // ---------------------------------------------------------------- selecting and inline editing

  function setPanelHidden(hidden: boolean) {
    el.classList.toggle('is-panel-hidden', hidden);
    $('[data-toggle-panel]', el)?.setAttribute('aria-pressed', String(!hidden));
    setTimeout(fitFrame, 30);
  }

  function select(element: HTMLElement) {
    const target = parseTarget(element.dataset.edit ?? '');
    if (!target) return;
    // Products and lists are edited in the panel, so bring it back if it was hidden.
    if (target.kind === 'product' || target.kind === 'ticker') setPanelHidden(false);
    if (editing && editing.element !== element) finishInline(true);
    selected = { element, target };
    setBox('hover', null);
    hovered = null;
    if (target.kind === 'text' || target.kind === 'product-text' || target.kind === 'category') {
      startInline(element, target);
    } else {
      setBox('selected', element, target);
    }
    renderPanel();
  }

  function deselect() {
    finishInline(true);
    selected = null;
    setBox('selected', null);
    renderPanel();
  }

  function valueOf(target: Target): string {
    if (target.kind === 'text') return store.text(target.key);
    if (target.kind === 'product-text') return store.product(target.id)?.data[target.field] ?? '';
    if (target.kind === 'category') {
      const category = store.categories().find((item) => item.slug === target.slug);
      return target.field === 'name' ? (category?.name ?? '') : (category?.description ?? '');
    }
    return '';
  }

  function writeValue(target: Target, value: string) {
    if (target.kind === 'text') store.setText(target.key, value);
    else if (target.kind === 'product-text') store.updateProduct(target.id, { [target.field]: value });
    else if (target.kind === 'category') {
      store.setCategories(store.categories().map((category) => (category.slug === target.slug ? { ...category, [target.field]: value } : category)));
    }
  }

  function startInline(element: HTMLElement, target: Target) {
    if (!doc) return;
    const original = valueOf(target);
    const start = original || (target.kind === 'text' ? defaultText(target.key) : '');
    editing = { element, target, originalHtml: element.innerHTML, original, start, accent: Boolean(fieldOf(target.key)?.accent) || Boolean(element.querySelector('em')) };
    element.textContent = start;
    let mode = 'plaintext-only';
    element.setAttribute('contenteditable', mode);
    if (element.contentEditable !== mode) {
      mode = 'true';
      element.setAttribute('contenteditable', mode);
    }
    element.setAttribute('data-studio-editing', '');
    element.setAttribute('data-studio-placeholder', target.kind === 'product-text' ? PRODUCT_PARTS[target.field] : 'Type here');
    element.spellcheck = true;
    element.focus({ preventScroll: true });
    const range = doc.createRange();
    range.selectNodeContents(element);
    const selection = win?.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.addEventListener('input', onInlineInput);
    element.addEventListener('paste', onPaste);
    element.addEventListener('blur', onInlineBlur);

    const bar = layer?.querySelector<HTMLElement>('[data-inline-bar]');
    const hint = layer?.querySelector<HTMLElement>('[data-hint]');
    if (hint) hint.textContent = editing.accent ? '*stars* = italic · Enter to save' : 'Enter to save · Esc to cancel';
    bar?.classList.add('is-on');
    setBox('selected', null);
    placeBar(element);
  }

  function onPaste(event: ClipboardEvent) {
    // Keep pasted text plain.
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    doc?.execCommand('insertText', false, text.replace(/\s+/g, ' '));
  }

  function onInlineInput() {
    if (!editing) return;
    writeValue(editing.target, clean(editing.element.textContent ?? ''));
    // Mirror into other copies of the same text (e.g. the store name in the header and footer).
    for (const other of $$<HTMLElement>(`[data-edit="${CSS.escape(editing.target.key)}"]`, doc!)) {
      if (other !== editing.element) render(other, editing.target);
    }
    syncPanelText();
    placeBar(editing.element);
  }

  function onInlineBlur() {
    // Clicking the Done bar keeps focus, so a blur means the owner clicked elsewhere: keep the text.
    setTimeout(() => {
      if (editing && doc?.activeElement !== editing.element) finishInline(true);
    }, 0);
  }

  /** Ends typing on the page. `redraw: false` leaves the side panel as it is (the owner is using it). */
  function finishInline(save: boolean, redraw = true) {
    if (!editing) return;
    const { element, target, originalHtml, original, start } = editing;
    editing = null;
    element.removeEventListener('input', onInlineInput);
    element.removeEventListener('paste', onPaste);
    element.removeEventListener('blur', onInlineBlur);
    element.removeAttribute('contenteditable');
    element.removeAttribute('data-studio-editing');
    element.removeAttribute('data-studio-placeholder');
    layer?.querySelector('[data-inline-bar]')?.classList.remove('is-on');
    const value = clean(element.textContent ?? '');
    if (!save) {
      writeValue(target, original);
      element.innerHTML = originalHtml;
    } else {
      if (value !== clean(start)) writeValue(target, value);
      render(element, target);
    }
    for (const other of $$<HTMLElement>(`[data-edit="${CSS.escape(target.key)}"]`, doc ?? document)) if (other !== element) render(other, target);
    win?.getSelection()?.removeAllRanges();
    if (selected?.element === element) setBox('selected', element, target);
    if (redraw) renderPanel();
  }

  /** What an element should show for its text. */
  function shown(target: Target, element: HTMLElement): string | null {
    if (target.kind === 'text') return store.shownText(target.key);
    if (target.kind === 'product-text') {
      const product = store.product(target.id);
      if (!product) return null;
      return target.field === 'brand' ? product.data.brand || store.categoryName(product.data.category) : product.data.title;
    }
    if (target.kind === 'category') {
      const value = valueOf(target);
      // A blank description shows the site's own default sentence: leave it as it is.
      if (!value) return target.field === 'name' ? element.textContent : null;
      return value;
    }
    return null;
  }

  function render(element: HTMLElement, target: Target) {
    if (element.hasAttribute('data-studio-editing')) return;
    const value = shown(target, element);
    if (value === null) return;
    const accent = Boolean(fieldOf(target.key)?.accent) || (target.kind === 'category' && target.field === 'name' && Boolean(element.querySelector('em')));
    if (accent) {
      element.innerHTML = accentParts(value)
        .map((part) => (part.accent ? `<em>${escapeHtml(part.text)}</em>` : escapeHtml(part.text)))
        .join('');
    } else {
      element.textContent = value.replace(/\*/g, '');
    }
  }

  // ---------------------------------------------------------------- keeping the page in step with the Studio

  /**
   * Shows unpublished (and just-published) changes on the page: anything the page shows differently
   * from what the Studio has is redrawn.
   */
  function syncPage() {
    if (!doc) return;
    for (const element of $$<HTMLElement>('[data-edit]', doc)) {
      const target = parseTarget(element.dataset.edit ?? '');
      if (!target || element.hasAttribute('data-studio-editing')) continue;
      if (target.kind === 'text' || target.kind === 'product-text' || target.kind === 'category') {
        const value = shown(target, element);
        if (value !== null && clean(element.textContent ?? '') !== clean(value.replace(/\*/g, ''))) render(element, target);
      } else if (target.kind === 'ticker') {
        const phrases = store.settings().ticker;
        for (const phrase of $$<HTMLElement>('[data-field="phrase"]', element)) {
          const next = phrases[Number(phrase.dataset.i)];
          if (next !== undefined && phrase.textContent !== next) phrase.textContent = next;
        }
      } else if (target.kind === 'product') {
        syncProduct(element, target.id);
      }
    }
  }

  function syncProduct(scope: HTMLElement, id: string) {
    const product = store.product(id);
    if (!product) return;
    const { data } = product;
    const ask = store.shownText('copy:common.askPrice');
    const values: Record<string, string> = {
      title: data.title,
      brand: data.brand || store.categoryName(data.category),
      price: store.formatPrice(data.price) || ask,
      meta: [store.formatPrice(data.price) || ask, data.size, data.condition].filter(Boolean).join(' · '),
    };
    for (const [field, value] of Object.entries(values)) {
      for (const element of $$<HTMLElement>(`[data-field="${field}"]`, scope)) {
        if (clean(element.textContent ?? '') !== clean(value)) element.textContent = value;
      }
    }
    // Photos: only when they were changed in the Studio (published photos are already on the page).
    if (product.edits.images !== undefined || product.media.size > 0) {
      const images = $$<HTMLImageElement>('img[data-field="image"]', scope);
      images.forEach((image, index) => {
        const name = data.images[image.dataset.i !== undefined ? Number(image.dataset.i) : index === 0 ? 0 : index];
        if (!name || image.dataset.studioImage === name) return;
        image.dataset.studioImage = name;
        Promise.resolve(store.mediaUrl(product, name, 'full')).then((url) => {
          if (!url) return;
          image.removeAttribute('srcset');
          image.src = url;
        });
      });
    }
  }

  function reveal(key: string) {
    if (!doc) return;
    const element = doc.querySelector<HTMLElement>(`[data-edit="${CSS.escape(key)}"]`);
    if (!element) {
      toast("That isn't on this page. Try another page from the menu at the top.", { tone: 'info' });
      return;
    }
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element.setAttribute('data-studio-flash', '');
    setTimeout(() => element.removeAttribute('data-studio-flash'), 1500);
    setTimeout(() => select(element), 450);
  }

  // ---------------------------------------------------------------- side panel

  function editableOnPage() {
    if (!doc) return { texts: [] as string[], products: [] as string[] };
    const keys = [...new Set($$<HTMLElement>('[data-edit]', doc).map((element) => element.dataset.edit ?? ''))];
    const texts = keys.filter((key) => key.startsWith('site:') || key.startsWith('copy:'));
    const products = [...new Set(keys.filter((key) => key.startsWith('product:')).map((key) => key.split(':')[1]))];
    return { texts, products };
  }

  function idlePanel() {
    const { texts, products } = editableOnPage();
    const byGroup = TEXT_GROUPS.map((group) => ({ group, keys: group.fields.map((field) => field.key).filter((key) => texts.includes(key)) })).filter((entry) => entry.keys.length);
    return html`
      <div class="st-lpanel__intro">
        <span class="st-lpanel__icon">${icon('wand', 22)}</span>
        <h2>${editMode ? 'Click anything to edit it' : 'Browsing'}</h2>
        <p>${editMode ? 'Hover over your site: everything with an outline can be changed. Text is typed straight onto the page; products and photos open here.' : 'Your site works normally in Browse mode. Switch back to Edit to change things.'}</p>
      </div>
      ${
        editMode && (texts.length || products.length)
          ? html`<div class="st-lpanel__section">
              <h3>On this page</h3>
              ${byGroup.map(
                ({ group, keys }) => html`
                  <p class="st-lpanel__group">${group.label}</p>
                  <ul class="st-lpanel__list">
                    ${keys.map((key) => html`<li><button type="button" data-reveal="${key}"><span>${fieldOf(key)?.label}</span><small>${store.shownText(key).replace(/\*/g, '') || 'Empty'}</small></button></li>`)}
                  </ul>
                `,
              )}
              ${
                products.length
                  ? html`<p class="st-lpanel__group">Products</p>
                      <ul class="st-lpanel__list st-lpanel__list--products">
                        ${products.slice(0, 12).map((id) => {
                          const product = store.product(id);
                          return product ? html`<li><button type="button" data-reveal="product:${id}"><span>${product.data.title}</span><small>${store.formatPrice(product.data.price) || 'No price'}</small></button></li>` : '';
                        })}
                      </ul>`
                  : ''
              }
            </div>`
          : ''
      }
      <div class="st-lpanel__section">
        <h3>Tips</h3>
        <ul class="st-tips">
          <li>${icon('check', 15)} <span>Changes appear on the page as you make them. Press <strong>Publish</strong> to put them live.</span></li>
          <li>${icon('phone', 15)} <span>Check how it looks on a phone with the phone button at the top.</span></li>
          <li>${icon('cursor', 15)} <span>Use <strong>Browse</strong> to click around your site, then switch back to <strong>Edit</strong>.</span></li>
        </ul>
      </div>
    `;
  }

  function textPanel(target: Target) {
    const field = fieldOf(target.key);
    const value = valueOf(target);
    const fallback = target.kind === 'text' ? defaultText(target.key) : '';
    const count = doc ? $$(`[data-edit="${CSS.escape(target.key)}"]`, doc).length : 1;
    const title =
      target.kind === 'text'
        ? (field?.label ?? 'Text')
        : target.kind === 'product-text'
          ? `${PRODUCT_PARTS[target.field]} · ${store.product(target.id)?.data.title ?? ''}`
          : target.kind === 'category'
            ? `Category ${target.field}`
            : 'Text';
    const long = field?.long || (target.kind === 'category' && target.field === 'description');
    const changed = target.kind === 'text' ? store.isTextChanged(target.key) : false;
    return html`
      <div class="st-lpanel__head">
        <p class="st-eyebrow">${icon('text', 13)} Editing text</p>
        <h2>${title}</h2>
        ${field?.hint ? html`<p class="st-lpanel__hint">${field.hint}</p>` : ''}
      </div>
      <label class="st-field">
        <span class="st-field__label">Text</span>
        ${
          long
            ? html`<textarea class="st-input st-textarea" rows="4" data-panel-text placeholder="${fallback}">${value}</textarea>`
            : html`<input class="st-input" data-panel-text value="${value}" placeholder="${fallback}" autocomplete="off" />`
        }
      </label>
      ${field?.accent ? html`<p class="st-accent-preview" data-panel-accent>${accentPreview(value || fallback)}</p>` : ''}
      ${fallback && value.trim() !== fallback ? html`<p class="st-field__hint">Default: ${fallback} · <button type="button" class="st-link-btn" data-panel-default>Use default</button></p>` : ''}
      ${count > 1 ? html`<p class="st-hint">${icon('info', 14)} Used in ${count} places on this page. They all change together.</p>` : ''}
      <div class="st-row">
        ${changed ? html`<button type="button" class="st-btn st-btn--ghost st-btn--sm" data-panel-undo>${icon('undo', 15)} Undo</button>` : ''}
        <button type="button" class="st-btn st-btn--primary st-btn--sm" data-panel-done>${icon('check', 15)} Done</button>
      </div>
    `;
  }

  function tickerPanel() {
    const phrases = store.settings().ticker;
    return html`
      <div class="st-lpanel__head">
        <p class="st-eyebrow">${icon('text', 13)} Editing text</p>
        <h2>Scrolling ticker</h2>
        <p class="st-lpanel__hint">Short phrases that scroll across the home page. New phrases show on the page after publishing.</p>
      </div>
      <ol class="st-phrases">
        ${phrases.map(
          (phrase, index) => html`<li class="st-phrase"><input class="st-input" value="${phrase}" data-ticker="${index}" aria-label="Phrase ${index + 1}" /><button type="button" class="st-icon-btn st-icon-btn--sm" data-ticker-remove="${index}" aria-label="Remove">${icon('close', 15)}</button></li>`,
        )}
      </ol>
      <button type="button" class="st-btn st-btn--ghost st-btn--sm" data-ticker-add>${icon('plus', 15)} Add a phrase</button>
    `;
  }

  function productPanel(product: Product) {
    return html`
      <div class="st-lpanel__head st-lpanel__head--product">
        <p class="st-eyebrow">${icon('products', 13)} Editing product</p>
        <h2>${product.data.title || 'Untitled'}</h2>
        <div class="st-row">
          <a class="st-btn st-btn--ghost st-btn--sm" href="#/products/${encodeURIComponent(product.id)}">${icon('arrow-up-right', 15)} Full editor</a>
          ${path !== `/product/${product.id}/` && !product.isNew && !product.base.draft ? html`<button type="button" class="st-btn st-btn--ghost st-btn--sm" data-go="/product/${product.id}/">${icon('eye', 15)} Open its page</button>` : ''}
        </div>
      </div>
      <div data-form-slot></div>
    `;
  }

  function renderPanel() {
    const target = selected?.target;
    let content;
    if (!target) content = idlePanel();
    else if (target.kind === 'ticker') content = tickerPanel();
    else if (target.kind === 'product') {
      const product = store.product(target.id);
      content = product ? productPanel(product) : html`<p class="st-muted">This product has been removed.</p>`;
    } else content = textPanel(target);

    const body = html`
      ${target ? html`<button type="button" class="st-icon-btn st-lpanel__close" data-deselect aria-label="Close">${icon('close', 18)}</button>` : ''}
      <div class="st-lpanel">${content}</div>
    `;

    // Products keep their form (and its scroll position) while it's the same product.
    if (target?.kind === 'product' && form && formProduct === target.id && (narrow() ? mobileSheet : panel.querySelector('[data-form-slot], .st-pform'))) {
      form.focus(target.part ?? 'photos');
      return;
    }
    form = null;
    formProduct = '';

    if (narrow()) {
      setHtml(panel, html``);
      // On phones, products and the ticker open in a sheet that slides up; text is typed on the page.
      if (!target || (target.kind !== 'product' && target.kind !== 'ticker')) {
        mobileSheet?.close();
        mobileSheet = null;
        return;
      }
      mobileSheet?.close();
      const sheet: ReturnType<typeof openSheet> = openSheet({
        title: target.kind === 'product' ? 'Edit product' : 'Edit text',
        content: body,
        onClose: () => {
          if (mobileSheet !== sheet) return;
          mobileSheet = null;
          selected = null;
          form = null;
          setBox('selected', null);
        },
      });
      mobileSheet = sheet;
      panelEvents(sheet.el);
      wirePanel(sheet.el, target);
      return;
    }
    setHtml(panel, body);
    wirePanel(panel, target);
  }

  function wirePanel(root: HTMLElement, target: Target | undefined) {
    if (target?.kind === 'product') {
      const slot = $('[data-form-slot]', root);
      if (slot) {
        form = productForm(store, target.id, { compact: true });
        formProduct = target.id;
        slot.replaceWith(form.el);
        hydrateMedia(store, form.el);
        requestAnimationFrame(() => form?.focus(target.part ?? 'photos'));
      }
    }
  }

  function syncPanelText() {
    const input = $<HTMLInputElement>('[data-panel-text]', panel);
    if (input && editing && document.activeElement !== input) input.value = valueOf(editing.target);
    const accent = $('[data-panel-accent]', panel);
    if (accent && editing) setHtml(accent, accentPreview(valueOf(editing.target) || defaultText(editing.target.key)));
  }

  function panelEvents(root: HTMLElement) {
    // Using the panel ends typing on the page (keeping what was typed).
    root.addEventListener('pointerdown', () => finishInline(true, false));
    root.addEventListener('focusin', () => finishInline(true, false));
    root.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement;
      const current = selected?.target;
      if (target.matches('[data-panel-text]') && current) {
        writeValue(current, target.value);
        if (doc) for (const element of $$<HTMLElement>(`[data-edit="${CSS.escape(current.key)}"]`, doc)) render(element, current);
        const accent = $('[data-panel-accent]', root);
        if (accent) setHtml(accent, accentPreview(target.value || defaultText(current.key)));
        if (selected) setBox('selected', selected.element, current);
      } else if (target.dataset.ticker !== undefined) {
        const phrases = [...store.settings().ticker];
        phrases[Number(target.dataset.ticker)] = target.value;
        store.setSetting('ticker', phrases);
        store.emit('text');
        syncPage();
      }
    });
    root.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const current = selected?.target;
      if (target.closest('[data-deselect]') || target.closest('[data-panel-done]')) {
        deselect();
        return;
      }
      const revealKey = target.closest<HTMLElement>('[data-reveal]')?.dataset.reveal;
      if (revealKey) {
        // Products: their card, or any part of their page.
        const element =
          doc?.querySelector<HTMLElement>(`[data-edit="${CSS.escape(revealKey)}"]`) ??
          (revealKey.startsWith('product:') ? doc?.querySelector<HTMLElement>(`[data-edit^="${CSS.escape(`${revealKey}:`)}"]`) : null);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => select(element), 400);
        }
        return;
      }
      const go = target.closest<HTMLElement>('[data-go]')?.dataset.go;
      if (go) {
        load(go);
        return;
      }
      if (target.closest('[data-panel-default]') && current) {
        writeValue(current, '');
        syncPage();
        renderPanel();
        return;
      }
      if (target.closest('[data-panel-undo]') && current?.kind === 'text') {
        store.discardText(current.key);
        syncPage();
        renderPanel();
        return;
      }
      if (target.closest('[data-ticker-add]')) {
        store.setSetting('ticker', [...store.settings().ticker, 'New phrase']);
        store.emit('text');
        renderPanel();
        return;
      }
      const remove = target.closest<HTMLElement>('[data-ticker-remove]');
      if (remove) {
        const phrases = [...store.settings().ticker];
        phrases.splice(Number(remove.dataset.tickerRemove), 1);
        store.setSetting('ticker', phrases);
        store.emit('text');
        renderPanel();
      }
    });
  }
  panelEvents(panel);

  // ---------------------------------------------------------------- toolbar events

  el.addEventListener('change', (event) => {
    const target = event.target as HTMLSelectElement;
    if (target.matches('[data-page]')) load(target.value);
  });

  el.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || panel.contains(target)) return;
    const mode = target.closest<HTMLElement>('[data-mode]');
    if (mode) {
      editMode = mode.dataset.mode === 'edit';
      if (!editMode) deselect();
      doc?.documentElement.toggleAttribute('data-studio-edit', editMode);
      setBox('hover', null);
      renderBar();
      renderPanel();
      return;
    }
    const deviceButton = target.closest<HTMLElement>('[data-device]');
    if (deviceButton) {
      device = deviceButton.dataset.device === 'phone' ? 'phone' : 'desktop';
      try {
        localStorage.setItem(DEVICE_KEY, device);
      } catch {
        // Not remembered.
      }
      renderBar();
      fitFrame();
      setTimeout(fitFrame, 600);
      return;
    }
    if (target.closest('[data-reload]')) {
      load(path, true);
      return;
    }
    if (target.closest('[data-toggle-panel]')) {
      setPanelHidden(!el.classList.contains('is-panel-hidden'));
    }
  });

  // On a computer the site is shown at a real desktop width and shrunk to fit the space.
  const canvas = $('[data-canvas]', el)!;
  const DESKTOP_WIDTH = 1280;
  // Never shrink below this, so text on the page stays readable.
  const MIN_SCALE = 0.62;
  function fitFrame() {
    const box = canvas.getBoundingClientRect();
    frameScale = 1;
    if (device === 'desktop' && !narrow() && box.width > 0 && box.width < DESKTOP_WIDTH) {
      const width = Math.round(Math.min(DESKTOP_WIDTH, box.width / MIN_SCALE));
      frameScale = box.width / width;
      iframe.style.width = `${width}px`;
      iframe.style.height = `${box.height / frameScale}px`;
      iframe.style.transform = `scale(${frameScale})`;
      iframe.style.transformOrigin = '0 0';
    } else {
      iframe.style.width = '';
      iframe.style.height = '';
      iframe.style.transform = '';
    }
    layerHost?.style.setProperty('--s', String(1 / frameScale));
    place();
  }
  const resizeObserver = new ResizeObserver(fitFrame);
  resizeObserver.observe(canvas);

  renderBar();
  renderPages();
  load(path);
  frame.addEventListener('transitionend', place);

  return {
    el,
    wide: true,
    update(reason: Reason) {
      if (reason === 'deploy' && store.deployState() === 'live') {
        // The site has been rebuilt with the published changes: show the real thing.
        load(path, true);
        return;
      }
      if (reason === 'load' && store.backend.kind === 'local' && !store.publishing) {
        load(path, true);
        return;
      }
      if (reason === 'load') renderPages();
      syncPage();
      form?.update(reason);
      if (selected?.target.kind === 'product') {
        const heading = (narrow() ? mobileSheet?.el : panel)?.querySelector('.st-lpanel__head h2');
        const product = store.product(selected.target.id);
        if (heading && product) heading.textContent = product.data.title || 'Untitled';
      }
      if (!selected && !editing && (reason === 'text' || reason === 'products' || reason === 'load')) {
        const active = document.activeElement;
        if (!panel.contains(active)) renderPanel();
      }
      if (selected && selected.target.kind !== 'product' && !editing && !panel.contains(document.activeElement)) renderPanel();
      if (selected) setBox('selected', selected.element.isConnected ? selected.element : null, selected.target);
    },
    destroy() {
      finishInline(true);
      mobileSheet?.close();
      resizeObserver.disconnect();
    },
  };
}

