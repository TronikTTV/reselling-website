// Shared bits of Studio interface: toasts, confirm dialogs, sheets, the busy overlay and photo loading.
import { $, $$, fragment, html, type Markup } from './lib/dom.ts';
import { icon, type IconName } from './lib/icons.ts';
import type { Product, Store } from './store.ts';

// ---------------------------------------------------------------- toasts

type Tone = 'ok' | 'info' | 'warn' | 'error';

const TONE_ICONS: Record<Tone, IconName> = { ok: 'check', info: 'info', warn: 'alert', error: 'alert' };

export function toast(message: string, options: { tone?: Tone; action?: { label: string; run: () => void }; timeout?: number } = {}) {
  const { tone = 'info', action, timeout = tone === 'error' ? 9000 : 4500 } = options;
  let stack = $('[data-toasts]');
  if (!stack) {
    stack = fragment(html`<div class="st-toasts" data-toasts aria-live="polite"></div>`);
    document.body.append(stack);
  }
  const item = fragment(html`
    <div class="st-toast st-toast--${tone}" role="${tone === 'error' ? 'alert' : 'status'}">
      <span class="st-toast__icon">${icon(TONE_ICONS[tone], 18)}</span>
      <p class="st-toast__text">${message}</p>
      ${action ? html`<button type="button" class="st-toast__action" data-toast-action>${action.label}</button>` : ''}
      <button type="button" class="st-toast__close" data-toast-close aria-label="Dismiss">${icon('close', 16)}</button>
    </div>
  `);
  const close = () => {
    item.classList.add('is-leaving');
    setTimeout(() => item.remove(), 260);
  };
  item.querySelector('[data-toast-close]')?.addEventListener('click', close);
  item.querySelector('[data-toast-action]')?.addEventListener('click', () => {
    action?.run();
    close();
  });
  stack.append(item);
  if (timeout > 0) setTimeout(close, timeout);
  return close;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Try again.';
}

// ---------------------------------------------------------------- dialogs

export function confirmDialog(options: {
  title: string;
  body?: string;
  confirm: string;
  cancel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = fragment(html`
      <dialog class="st-dialog">
        <form method="dialog" class="st-dialog__card">
          <h2 class="st-dialog__title">${options.title}</h2>
          ${options.body ? html`<p class="st-dialog__body">${options.body}</p>` : ''}
          <div class="st-dialog__actions">
            <button class="st-btn st-btn--ghost" value="cancel">${options.cancel ?? 'Cancel'}</button>
            <button class="st-btn ${options.danger ? 'st-btn--danger' : 'st-btn--primary'}" value="ok" autofocus>${options.confirm}</button>
          </div>
        </form>
      </dialog>
    `) as HTMLDialogElement;
    document.body.append(dialog);
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok');
      setTimeout(() => dialog.remove(), 200);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close('cancel');
    });
    dialog.showModal();
  });
}

/** A text prompt in the Studio's style. Resolves to the text, or null when cancelled. */
export function promptDialog(options: { title: string; label: string; value?: string; confirm: string; placeholder?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = fragment(html`
      <dialog class="st-dialog">
        <form method="dialog" class="st-dialog__card">
          <h2 class="st-dialog__title">${options.title}</h2>
          <label class="st-field">
            <span class="st-field__label">${options.label}</span>
            <input class="st-input" name="value" value="${options.value ?? ''}" placeholder="${options.placeholder ?? ''}" autocomplete="off" />
          </label>
          <div class="st-dialog__actions">
            <button class="st-btn st-btn--ghost" value="cancel" formnovalidate>Cancel</button>
            <button class="st-btn st-btn--primary" value="ok">${options.confirm}</button>
          </div>
        </form>
      </dialog>
    `) as HTMLDialogElement;
    const input = $<HTMLInputElement>('input', dialog)!;
    // Enter saves (the form's first button is Cancel).
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      dialog.close('ok');
    });
    document.body.append(dialog);
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok' ? input.value.trim() : null);
      setTimeout(() => dialog.remove(), 200);
    });
    dialog.showModal();
    input.select();
  });
}

// ---------------------------------------------------------------- sheets

/** A panel that slides in from the right (from the bottom on phones). Returns a function that closes it. */
export function openSheet(options: { title: string; content: Markup; wide?: boolean; onClose?: () => void }): { el: HTMLElement; close: () => void } {
  const sheet = fragment(html`
    <dialog class="st-sheet ${options.wide ? 'st-sheet--wide' : ''}">
      <div class="st-sheet__panel">
        <header class="st-sheet__head">
          <h2 class="st-sheet__title">${options.title}</h2>
          <button type="button" class="st-icon-btn" data-sheet-close aria-label="Close">${icon('close')}</button>
        </header>
        <div class="st-sheet__body">${options.content}</div>
      </div>
    </dialog>
  `) as HTMLDialogElement;
  document.body.append(sheet);
  const close = () => {
    if (!sheet.open) return;
    sheet.classList.add('is-leaving');
    setTimeout(() => sheet.close(), 220);
  };
  sheet.addEventListener('close', () => {
    options.onClose?.();
    sheet.remove();
  });
  sheet.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) close();
  });
  sheet.querySelector('[data-sheet-close]')?.addEventListener('click', close);
  sheet.showModal();
  return { el: sheet, close };
}

// ---------------------------------------------------------------- busy overlay

/**
 * A "please wait" card over the page. `update` changes its words and, given a fraction (0–1), shows a
 * progress bar. With `stop`, it has a Stop button until `lock` is called.
 */
export function busy(text: string, options: { note?: string; stop?: () => void } = {}) {
  const overlay = fragment(html`
    <div class="st-busy" role="status" aria-live="polite">
      <div class="st-busy__card ${options.note || options.stop ? 'is-wide' : ''}">
        <span class="st-spinner" aria-hidden="true"></span>
        <p class="st-busy__text" data-busy-text>${text}</p>
        <div class="st-busy__bar" data-busy-bar hidden><span></span></div>
        ${options.note ? html`<p class="st-busy__note">${options.note}</p>` : ''}
        ${options.stop ? html`<button type="button" class="st-btn st-btn--ghost st-btn--sm st-busy__stop" data-busy-stop>Stop</button>` : ''}
      </div>
    </div>
  `);
  const stop = $<HTMLButtonElement>('[data-busy-stop]', overlay);
  stop?.addEventListener('click', () => {
    stop.disabled = true;
    stop.textContent = 'Stopping…';
    options.stop?.();
  });
  document.body.append(overlay);
  return {
    update: (value: string, fraction?: number) => {
      const target = $('[data-busy-text]', overlay);
      if (target) target.textContent = value;
      const bar = $<HTMLElement>('[data-busy-bar]', overlay);
      if (bar && fraction !== undefined) {
        bar.hidden = false;
        bar.parentElement?.classList.add('is-wide');
        bar.style.setProperty('--progress', String(Math.min(1, Math.max(0, fraction))));
      }
    },
    /** Shows or hides the Stop button (hidden while stopping wouldn't take effect). */
    stoppable: (on: boolean) => {
      if (stop) stop.hidden = !on;
    },
    close: () => {
      overlay.classList.add('is-leaving');
      setTimeout(() => overlay.remove(), 220);
    },
  };
}

// ---------------------------------------------------------------- photos

/** An <img> that the Studio fills in once it knows the address (see hydrateMedia). */
export function thumb(product: Product | undefined, name: string | undefined, size: 'thumb' | 'full' = 'thumb', alt = ''): Markup {
  if (!product || !name) return html`<span class="st-thumb st-thumb--empty">${icon('image', 22)}</span>`;
  return html`<img class="st-thumb" alt="${alt}" data-media-product="${product.id}" data-media-name="${name}" data-media-size="${size}" decoding="async" />`;
}

let observer: IntersectionObserver | undefined;

async function fill(store: Store, image: HTMLImageElement) {
  const product = store.product(image.dataset.mediaProduct ?? '');
  const name = image.dataset.mediaName ?? '';
  if (!product) return;
  image.classList.add('is-loading');
  try {
    const url = await store.mediaUrl(product, name, image.dataset.mediaSize === 'full' ? 'full' : 'thumb');
    if (!url) throw new Error('missing');
    image.src = url;
    await image.decode().catch(() => {});
    image.classList.add('is-loaded');
  } catch {
    image.classList.add('is-missing');
  } finally {
    image.classList.remove('is-loading');
  }
}

/** Loads the photos in `root` as they scroll into view. */
export function hydrateMedia(store: Store, root: ParentNode) {
  const images = $$<HTMLImageElement>('img[data-media-name]:not([data-hydrated])', root);
  if (images.length === 0) return;
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer?.unobserve(entry.target);
        const image = entry.target as HTMLImageElement & { studio?: Store };
        if (image.studio) fill(image.studio, image);
      }
    },
    { rootMargin: '400px' },
  );
  for (const image of images) {
    image.dataset.hydrated = '';
    const product = store.product(image.dataset.mediaProduct ?? '');
    const now = product ? store.mediaUrlNow(product, image.dataset.mediaName ?? '', image.dataset.mediaSize === 'full' ? 'full' : 'thumb') : undefined;
    if (now) {
      // Already on the site (or just uploaded): let the browser load it when it's near the screen.
      image.loading = 'lazy';
      const done = () => image.classList.add('is-loaded');
      image.addEventListener('load', done, { once: true });
      image.addEventListener('error', () => image.classList.add('is-missing'), { once: true });
      image.src = now;
      if (image.complete && image.naturalWidth) done();
      continue;
    }
    // Needs downloading from GitHub: only once it scrolls into view.
    (image as HTMLImageElement & { studio?: Store }).studio = store;
    observer.observe(image);
  }
}

/** <option>s for every category, sub-categories named with the ones above them ("Trainers & Shoes › Nike"). */
export function categoryOptions(store: Store, selected: string): Markup {
  return html`${store.categories().map((category) => html`<option value="${category.slug}" ${category.slug === selected ? 'selected' : ''}>${store.categoryLabel(category.slug)}</option>`)}`;
}

/** Reads files chosen in a file picker or dropped on the page. */
export function pickFiles(options: { accept: string; multiple?: boolean }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = options.accept;
    input.multiple = options.multiple ?? false;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(Array.from(input.files ?? []));
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

/** Lets files be dropped onto an element. */
export function dropZone(element: HTMLElement, onFiles: (files: File[]) => void) {
  let depth = 0;
  element.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    depth += 1;
    element.classList.add('is-dropping');
  });
  element.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  element.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) element.classList.remove('is-dropping');
  });
  element.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    depth = 0;
    element.classList.remove('is-dropping');
    onFiles(Array.from(event.dataTransfer.files));
  });
}
