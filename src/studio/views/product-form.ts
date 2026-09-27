// The product editor: photos, video and every detail of one product. Used full-page (Products → a
// product) and in the live editor's side panel. Every change is kept straight away as an unpublished
// change; nothing needs saving separately.
import { AUTHENTICITY_LABELS, STATUS_LABELS, type Status } from '../../lib/labels.ts';
import { $, $$, escapeHtml, html, raw, setHtml } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import { megabytes, preparePhoto, prepareVideo, videoPoster } from '../lib/media.ts';
import type { ProductData, ProductField } from '../lib/product-file.ts';
import { sortable } from '../lib/sortable.ts';
import type { Product, Reason, Store } from '../store.ts';
import { dropZone, errorMessage, hydrateMedia, pickFiles, thumb, toast } from '../ui.ts';

// Keep in step with src/cms/config.yml.
export const CONDITIONS = ['Brand new', 'New with tags', 'Like new', 'Very good', 'Good', 'Fair'];
export const INCLUDES = ['Original box', 'Replacement box', 'StockX tag', 'Receipt / proof of purchase', 'Dust bag', 'Extra laces', 'All original accessories'];
const MANY_PHOTOS = 10;

export type FormSection = 'photos' | 'video' | 'basics' | 'price' | 'status' | 'details' | 'description' | 'extra';

export interface ProductForm {
  el: HTMLElement;
  update(reason: Reason): void;
  focus(section?: FormSection | string): void;
}

/** Markdown-lite for the description preview: paragraphs, line breaks, **bold**, *italic*, lists and links. */
export function markdownPreview(text: string): string {
  const inline = (value: string) =>
    escapeHtml(value)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return text
    .trim()
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split('\n');
      if (lines.every((line) => /^\s*[-*]\s+/.test(line))) return `<ul>${lines.map((line) => `<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`;
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    })
    .join('');
}

const toLocalInput = (iso: string) => {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

function parsePrice(value: string): number | null {
  const cleaned = value.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
}

export function productForm(store: Store, id: string, options: { compact?: boolean } = {}): ProductForm {
  const el = document.createElement('div');
  el.className = `st-pform${options.compact ? ' st-pform--compact' : ''}`;
  const product = () => store.product(id) as Product;
  let mediaSignature = '';
  let busyPhotos = 0;

  const field = (name: ProductField) => raw(`data-field="${name}"`);

  function statusControl(data: ProductData) {
    return html`
      <div class="st-segmented st-segmented--status" role="radiogroup" aria-label="Status">
        ${(['available', 'reserved', 'sold'] as Status[]).map(
          (value) => html`
            <label class="st-seg st-seg--${value}">
              <input type="radio" name="status-${id}" value="${value}" ${field('status')} ${data.status === value ? 'checked' : ''} />
              <span>${STATUS_LABELS[value]}</span>
            </label>
          `,
        )}
      </div>
    `;
  }

  function render() {
    const current = product();
    const { data } = current;
    const categories = store.categories();
    const knownCategory = categories.some((category) => category.slug === data.category);
    const symbol = store.currencySymbol();

    setHtml(
      el,
      html`
        <section class="st-card st-pform__media" data-section="photos">
          <header class="st-card__head">
            <div>
              <h2 class="st-card__title">${icon('image', 18)} Photos</h2>
              <p class="st-card__sub">The first photo is the cover. Drag to reorder${matchMedia('(pointer: coarse)').matches ? ' (press and hold)' : ''}.</p>
            </div>
          </header>
          <div class="st-photos" data-photos></div>
        </section>

        <section class="st-card" data-section="video">
          <header class="st-card__head">
            <div>
              <h2 class="st-card__title">${icon('video', 18)} Video</h2>
              <p class="st-card__sub">A short clip (5–15 seconds, MP4, up to 24 MB). Vertical looks best.</p>
            </div>
          </header>
          <div data-video></div>
        </section>

        <section class="st-card" data-section="basics">
          <h2 class="st-card__title">${icon('products', 18)} The basics</h2>
          <label class="st-field">
            <span class="st-field__label">Name <em class="st-required">Required</em></span>
            <input class="st-input st-input--lg" ${field('title')} value="${data.title}" placeholder="e.g. Nike Dunk Low Panda" autocomplete="off" />
          </label>
          <div class="st-grid-2">
            <label class="st-field">
              <span class="st-field__label">Brand</span>
              <input class="st-input" ${field('brand')} value="${data.brand}" list="st-brands-${id}" placeholder="e.g. Nike" autocomplete="off" />
              <datalist id="st-brands-${id}">${store.brands().map((brand) => html`<option value="${brand}"></option>`)}</datalist>
            </label>
            <label class="st-field">
              <span class="st-field__label">Category</span>
              <span class="st-select st-select--block">
                <select ${field('category')}>
                  ${categories.map((category) => html`<option value="${category.slug}" ${category.slug === data.category ? 'selected' : ''}>${category.name}</option>`)}
                  ${!knownCategory ? html`<option value="${data.category}" selected>${data.category ? `${data.category} (not a category)` : 'Other'}</option>` : ''}
                </select>
                ${icon('chevron-down', 14)}
              </span>
            </label>
          </div>
        </section>

        <section class="st-card" data-section="price">
          <h2 class="st-card__title">${icon('pound', 18)} Price & status</h2>
          <div class="st-grid-2">
            <label class="st-field">
              <span class="st-field__label">Price</span>
              <span class="st-money"><span>${symbol}</span><input class="st-input" ${field('price')} value="${data.price ?? ''}" inputmode="decimal" placeholder="Ask for price" autocomplete="off" /></span>
              <span class="st-field__hint">Leave empty to show "Ask for price".</span>
            </label>
            <label class="st-field">
              <span class="st-field__label">Retail price (RRP)</span>
              <span class="st-money"><span>${symbol}</span><input class="st-input" ${field('retailPrice')} value="${data.retailPrice ?? ''}" inputmode="decimal" placeholder="Optional" autocomplete="off" /></span>
              <span class="st-field__hint">Shown crossed out when it's more than your price.</span>
            </label>
          </div>
          <div class="st-field">
            <span class="st-field__label">Status</span>
            ${statusControl(data)}
          </div>
          <div class="st-toggles">
            <label class="st-toggle">
              <input type="checkbox" ${field('featured')} ${data.featured ? 'checked' : ''} />
              <span class="st-toggle__switch" aria-hidden="true"></span>
              <span class="st-toggle__text"><strong>${icon('star', 15)} Feature on the home page</strong><small>Plays in the ads at the top. Add a video to make it move.</small></span>
            </label>
            <label class="st-toggle">
              <input type="checkbox" ${field('draft')} ${data.draft ? 'checked' : ''} />
              <span class="st-toggle__switch" aria-hidden="true"></span>
              <span class="st-toggle__text"><strong>${icon('eye-off', 15)} Draft (hidden)</strong><small>Keep it off the site until it's ready.</small></span>
            </label>
          </div>
        </section>

        <section class="st-card" data-section="details">
          <h2 class="st-card__title">${icon('info', 18)} Details</h2>
          <div class="st-grid-2">
            <label class="st-field">
              <span class="st-field__label">Size</span>
              <input class="st-input" ${field('size')} value="${data.size}" placeholder="e.g. UK 9, M, 42mm, 100ml" autocomplete="off" />
            </label>
            <label class="st-field">
              <span class="st-field__label">Condition</span>
              <span class="st-select st-select--block">
                <select ${field('condition')}>
                  <option value="">Not set</option>
                  ${[...CONDITIONS, ...(data.condition && !CONDITIONS.includes(data.condition) ? [data.condition] : [])].map(
                    (value) => html`<option value="${value}" ${data.condition === value ? 'selected' : ''}>${value}</option>`,
                  )}
                </select>
                ${icon('chevron-down', 14)}
              </span>
            </label>
            <label class="st-field">
              <span class="st-field__label">Colourway</span>
              <input class="st-input" ${field('colourway')} value="${data.colourway}" placeholder="e.g. White/Black" autocomplete="off" />
            </label>
            <label class="st-field">
              <span class="st-field__label">Style code / SKU</span>
              <input class="st-input" ${field('styleCode')} value="${data.styleCode}" placeholder="e.g. DD1391-100" autocomplete="off" />
            </label>
          </div>
          <label class="st-field">
            <span class="st-field__label">Where it's from</span>
            <span class="st-select st-select--block">
              <select ${field('authenticity')}>
                <option value="">Don't show</option>
                ${Object.entries(AUTHENTICITY_LABELS).map(([value, label]) => html`<option value="${value}" ${data.authenticity === value ? 'selected' : ''}>${label}</option>`)}
                ${data.authenticity && !AUTHENTICITY_LABELS[data.authenticity] ? html`<option value="${data.authenticity}" selected>${data.authenticity}</option>` : ''}
              </select>
              ${icon('chevron-down', 14)}
            </span>
            <span class="st-field__hint">Shown under the price, e.g. "Bought on StockX".</span>
          </label>
          <div class="st-field">
            <span class="st-field__label">What's included</span>
            <div class="st-choices" data-includes>
              ${[...INCLUDES, ...data.includes.filter((item) => !INCLUDES.includes(item))].map(
                (item) => html`<button type="button" class="st-choice ${data.includes.includes(item) ? 'is-on' : ''}" data-include="${item}" aria-pressed="${data.includes.includes(item)}">${data.includes.includes(item) ? icon('check', 14) : icon('plus', 14)} ${item}</button>`,
              )}
            </div>
          </div>
        </section>

        <section class="st-card" data-section="description">
          <header class="st-card__head">
            <h2 class="st-card__title">${icon('text', 18)} Description</h2>
            <div class="st-segmented st-segmented--sm" role="group" aria-label="Description view">
              <button type="button" class="is-active" data-desc-mode="write">Write</button>
              <button type="button" data-desc-mode="preview">Preview</button>
            </div>
          </header>
          <textarea class="st-input st-textarea" ${field('body')} rows="5" placeholder="Anything buyers should know: fit, flaws, how it's been worn, what's special…">${data.body}</textarea>
          <div class="st-prose st-prose--preview" data-desc-preview hidden></div>
          <p class="st-field__hint">Tip: **bold**, *italic*, and lines starting with "- " become a list.</p>
        </section>

        <section class="st-card" data-section="extra">
          <h2 class="st-card__title">${icon('search', 18)} Search & date</h2>
          <div class="st-field">
            <span class="st-field__label">Extra search words</span>
            <div class="st-tags" data-tags>
              ${data.tags.map((tag) => html`<span class="st-tag">${tag}<button type="button" data-remove-tag="${tag}" aria-label="Remove ${tag}">${icon('close', 12)}</button></span>`)}
              <input class="st-tags__input" data-tag-input placeholder="${data.tags.length ? 'Add another…' : 'Colour, model, material… press Enter'}" enterkeyhint="done" />
            </div>
          </div>
          <label class="st-field">
            <span class="st-field__label">Date added</span>
            <input class="st-input" type="datetime-local" ${field('date')} value="${toLocalInput(data.date)}" />
            <span class="st-field__hint">Newest pieces are shown first on your site.</span>
          </label>
        </section>
      `,
    );
    renderMedia(true);
  }

  // ---------------------------------------------------------------- photos and video

  function renderMedia(force = false) {
    const { data } = product();
    const signature = JSON.stringify([data.images, data.video, busyPhotos]);
    if (!force && signature === mediaSignature) return;
    mediaSignature = signature;

    const photos = $('[data-photos]', el);
    if (photos) {
      setHtml(
        photos,
        html`
          ${data.images.map(
            (name, index) => html`
              <figure class="st-photo" data-key="${name}" title="Drag to reorder">
                ${thumb(product(), name, 'thumb', `Photo ${index + 1}`)}
                ${index === 0 ? html`<span class="st-photo__cover">Cover</span>` : html`<span class="st-photo__num">${index + 1}</span>`}
                ${product().media.has(name) ? html`<span class="st-photo__new">New</span>` : ''}
                <span class="st-photo__actions">
                  ${index > 0 ? html`<button type="button" class="st-photo__btn" data-photo-cover="${name}" title="Make this the cover">${icon('star', 14)}</button>` : ''}
                  ${index > 0 ? html`<button type="button" class="st-photo__btn" data-photo-move="${name}" data-dir="-1" title="Move left">${icon('chevron-left', 14)}</button>` : ''}
                  ${index < data.images.length - 1 ? html`<button type="button" class="st-photo__btn" data-photo-move="${name}" data-dir="1" title="Move right">${icon('chevron-right', 14)}</button>` : ''}
                  <button type="button" class="st-photo__btn st-photo__btn--danger" data-photo-remove="${name}" title="Remove">${icon('trash', 14)}</button>
                </span>
              </figure>
            `,
          )}
          ${Array.from({ length: busyPhotos }, () => html`<div class="st-photo st-photo--busy"><span class="st-spinner"></span></div>`)}
          <button type="button" class="st-photo st-photo--add" data-add-photos>
            ${icon('upload', 22)}
            <span>${data.images.length ? 'Add more' : 'Add photos'}</span>
            <small>or drop them here</small>
          </button>
        `,
      );
      if (data.images.length >= MANY_PHOTOS) {
        photos.insertAdjacentHTML('beforeend', html`<p class="st-hint st-photos__hint">${icon('info', 14)} ${data.images.length} photos. Around ${MANY_PHOTOS} is plenty, and fewer photos keep your site fast.</p>`.value);
      }
      hydrateMedia(store, photos);
    }

    const video = $('[data-video]', el);
    if (video) {
      if (!data.video) {
        setHtml(
          video,
          html`<button type="button" class="st-video-add" data-add-video>
            ${icon('video', 24)}
            <span><strong>Add a video</strong><small>${data.featured ? 'It will play in the ads at the top of your home page.' : 'Switch on "Feature on the home page" to play it in the ads.'}</small></span>
          </button>`,
        );
      } else {
        const isNew = product().media.has(data.video);
        const file = store.fileOf(product(), data.video);
        setHtml(
          video,
          html`<div class="st-video">
            <div class="st-video__frame" data-video-frame>
              <button type="button" class="st-video__load" data-load-video>${icon('play', 22)}<span>Play preview</span></button>
            </div>
            <div class="st-video__info">
              <p><strong>${data.video}</strong><small>${isNew ? 'New, not live yet' : file ? megabytes(file.size) : ''}</small></p>
              <div class="st-row">
                <button type="button" class="st-btn st-btn--ghost st-btn--sm" data-add-video>${icon('refresh', 15)} Replace</button>
                <button type="button" class="st-btn st-btn--ghost st-btn--sm" data-remove-video>${icon('trash', 15)} Remove</button>
              </div>
              ${!data.featured ? html`<p class="st-hint">${icon('info', 14)} Only featured pieces play in the home page ads.</p>` : ''}
            </div>
          </div>`,
        );
        // New uploads can show a still straight away.
        const media = product().media.get(data.video);
        if (media?.url) {
          videoPoster(media.url).then((poster) => {
            const frame = $('[data-video-frame]', el);
            if (poster && frame) frame.style.backgroundImage = `url("${poster}")`;
          });
        }
      }
    }
  }

  async function addPhotos(files: File[]) {
    const images = files.filter((file) => file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif|hei[cf])$/i.test(file.name));
    if (images.length === 0) {
      if (files.some((file) => file.type.startsWith('video/'))) addVideo(files.find((file) => file.type.startsWith('video/'))!);
      return;
    }
    busyPhotos += images.length;
    renderMedia();
    const ready: { name: string; blob: Blob }[] = [];
    for (const file of images) {
      try {
        ready.push(await preparePhoto(file));
      } catch (error) {
        toast(`${file.name}: ${errorMessage(error)}`, { tone: 'error' });
      } finally {
        busyPhotos -= 1;
      }
    }
    if (ready.length > 0) store.addPhotos(id, ready);
    else renderMedia();
    if (ready.length > 0) toast(`${ready.length === 1 ? 'Photo' : `${ready.length} photos`} added. Publish to put ${ready.length === 1 ? 'it' : 'them'} live.`, { tone: 'ok', timeout: 3000 });
  }

  function addVideo(file: File) {
    try {
      const video = prepareVideo(file);
      store.setVideo(id, video);
      if (video.warning) toast(video.warning, { tone: 'warn', timeout: 9000 });
      if (!product().data.featured) {
        toast('Video added. Feature this piece to play it on the home page.', {
          tone: 'info',
          action: { label: 'Feature it', run: () => store.updateProduct(id, { featured: true }) },
          timeout: 8000,
        });
      }
    } catch (error) {
      toast(errorMessage(error), { tone: 'error', timeout: 10000 });
    }
  }

  async function loadVideo() {
    const { data } = product();
    const frame = $('[data-video-frame]', el);
    if (!frame || !data.video) return;
    setHtml(frame, html`<span class="st-spinner"></span>`);
    try {
      const url = await store.mediaUrl(product(), data.video, 'full');
      if (!url) throw new Error("The video file couldn't be found.");
      setHtml(frame, raw(`<video src="${escapeHtml(url)}" controls autoplay muted playsinline loop></video>`));
    } catch (error) {
      setHtml(frame, html`<p class="st-muted">${errorMessage(error)}</p>`);
    }
  }

  // ---------------------------------------------------------------- editing

  function readField(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): Partial<ProductData> | undefined {
    const name = input.dataset.field as ProductField;
    if (!name) return undefined;
    if (name === 'price' || name === 'retailPrice') return { [name]: parsePrice(input.value) };
    if (name === 'featured' || name === 'draft') return { [name]: (input as HTMLInputElement).checked };
    if (name === 'status') return (input as HTMLInputElement).checked ? { status: input.value as Status } : undefined;
    if (name === 'date') {
      const date = input.value ? new Date(input.value) : null;
      return { date: date && !Number.isNaN(date.getTime()) ? date.toISOString() : '' };
    }
    return { [name]: input.value };
  }

  el.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    if (!target.dataset.field || target.type === 'checkbox' || target.type === 'radio' || target.tagName === 'SELECT') return;
    const patch = readField(target);
    if (patch) store.updateProduct(id, patch);
    if (target.dataset.field === 'body') autoGrow(target as unknown as HTMLTextAreaElement);
  });

  el.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    if (!target.dataset.field) return;
    const patch = readField(target);
    if (!patch) return;
    // Tidy spaces once the field is left.
    if (typeof Object.values(patch)[0] === 'string' && target.dataset.field !== 'body') {
      const value = String(Object.values(patch)[0]).trim();
      if (target.value !== value && target.type !== 'datetime-local') target.value = value;
      store.updateProduct(id, { [target.dataset.field]: value });
      return;
    }
    store.updateProduct(id, patch);
  });

  el.addEventListener('keydown', (event) => {
    const target = event.target as HTMLInputElement;
    if (!target.matches('[data-tag-input]')) return;
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addTag(target.value);
    } else if (event.key === 'Backspace' && !target.value) {
      const { tags } = product().data;
      if (tags.length) store.updateProduct(id, { tags: tags.slice(0, -1) });
      renderTags();
    }
  });
  el.addEventListener('focusout', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.matches('[data-tag-input]') && target.value.trim()) addTag(target.value);
  });

  function addTag(value: string) {
    const tags = value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    const current = product().data.tags;
    const next = [...current, ...tags.filter((tag) => !current.some((existing) => existing.toLowerCase() === tag.toLowerCase()))];
    store.updateProduct(id, { tags: next });
    renderTags(true);
  }

  function renderTags(keepFocus = false) {
    const box = $('[data-tags]', el);
    if (!box) return;
    const { tags } = product().data;
    setHtml(
      box,
      html`${tags.map((tag) => html`<span class="st-tag">${tag}<button type="button" data-remove-tag="${tag}" aria-label="Remove ${tag}">${icon('close', 12)}</button></span>`)}
        <input class="st-tags__input" data-tag-input placeholder="${tags.length ? 'Add another…' : 'Colour, model, material… press Enter'}" enterkeyhint="done" />`,
    );
    if (keepFocus) $<HTMLInputElement>('[data-tag-input]', box)?.focus();
  }

  el.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const { data } = product();

    if (target.closest('[data-add-photos]')) {
      addPhotos(await pickFiles({ accept: 'image/*', multiple: true }));
      return;
    }
    // Phones: tap a photo to show its buttons (tap again, or another photo, to hide them).
    const tile = target.closest<HTMLElement>('.st-photo[data-key]');
    if (tile && !target.closest('button')) {
      const active = tile.classList.contains('is-active');
      $$('.st-photo.is-active', el).forEach((other) => other.classList.remove('is-active'));
      tile.classList.toggle('is-active', !active);
      return;
    }
    const remove = target.closest<HTMLElement>('[data-photo-remove]');
    if (remove) {
      const name = remove.dataset.photoRemove!;
      const before = data.images;
      store.updateProduct(id, { images: before.filter((image) => image !== name) });
      toast('Photo removed.', { tone: 'info', action: { label: 'Undo', run: () => store.updateProduct(id, { images: before }) } });
      return;
    }
    const cover = target.closest<HTMLElement>('[data-photo-cover]');
    if (cover) {
      const name = cover.dataset.photoCover!;
      store.updateProduct(id, { images: [name, ...data.images.filter((image) => image !== name)] });
      return;
    }
    const move = target.closest<HTMLElement>('[data-photo-move]');
    if (move) {
      const images = [...data.images];
      const from = images.indexOf(move.dataset.photoMove!);
      const to = from + Number(move.dataset.dir);
      if (from < 0 || to < 0 || to >= images.length) return;
      [images[from], images[to]] = [images[to], images[from]];
      store.updateProduct(id, { images });
      return;
    }
    if (target.closest('[data-add-video]')) {
      const [file] = await pickFiles({ accept: 'video/mp4,video/webm,video/quicktime,.mp4,.mov,.webm,.m4v' });
      if (file) addVideo(file);
      return;
    }
    if (target.closest('[data-remove-video]')) {
      const before = data.video;
      store.updateProduct(id, { video: '' });
      toast('Video removed.', { tone: 'info', action: { label: 'Undo', run: () => store.updateProduct(id, { video: before }) } });
      return;
    }
    if (target.closest('[data-load-video]')) {
      loadVideo();
      return;
    }
    const include = target.closest<HTMLElement>('[data-include]');
    if (include) {
      const item = include.dataset.include!;
      const next = data.includes.includes(item) ? data.includes.filter((value) => value !== item) : [...data.includes, item];
      store.updateProduct(id, { includes: next });
      const on = next.includes(item);
      include.classList.toggle('is-on', on);
      include.setAttribute('aria-pressed', String(on));
      setHtml(include, html`${icon(on ? 'check' : 'plus', 14)} ${item}`);
      return;
    }
    const removeTag = target.closest<HTMLElement>('[data-remove-tag]');
    if (removeTag) {
      store.updateProduct(id, { tags: data.tags.filter((tag) => tag !== removeTag.dataset.removeTag) });
      renderTags();
      return;
    }
    const mode = target.closest<HTMLElement>('[data-desc-mode]');
    if (mode) {
      const preview = mode.dataset.descMode === 'preview';
      $$('[data-desc-mode]', el).forEach((button) => button.classList.toggle('is-active', button === mode));
      const area = $<HTMLTextAreaElement>('[data-field="body"]', el);
      const box = $('[data-desc-preview]', el);
      if (area && box) {
        area.hidden = preview;
        box.hidden = !preview;
        setHtml(box, raw(markdownPreview(product().data.body) || '<p class="st-muted">Nothing written yet.</p>'));
      }
    }
  });

  el.addEventListener('contextmenu', (event) => {
    if (event.target instanceof Element && event.target.closest('.st-photo')) event.preventDefault();
  });

  const autoGrow = (area: HTMLTextAreaElement) => {
    area.style.height = 'auto';
    area.style.height = `${Math.min(area.scrollHeight + 2, 640)}px`;
  };

  /** Puts store values into fields that aren't being typed in (e.g. after an edit on the page). */
  function syncInputs() {
    const { data } = product();
    for (const input of $$<HTMLInputElement>('[data-field]', el)) {
      if (input === document.activeElement) continue;
      const name = input.dataset.field as ProductField;
      if (input.type === 'radio') input.checked = input.value === data.status;
      else if (input.type === 'checkbox') input.checked = Boolean(data[name]);
      else if (name === 'date') {
        const value = toLocalInput(data.date);
        if (input.value !== value) input.value = value;
      } else {
        const value = data[name] === null || data[name] === undefined ? '' : String(data[name]);
        if (input.value !== value) input.value = value;
      }
    }
  }

  render();
  dropZone(el, (files) => {
    const video = files.find((file) => file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(file.name));
    if (video && files.length === 1) addVideo(video);
    else addPhotos(files);
  });
  const photos = $('[data-photos]', el)!;
  sortable(photos, {
    item: '.st-photo[data-key]',
    onSort: (keys) => store.updateProduct(id, { images: keys }),
  });
  requestAnimationFrame(() => {
    const area = $<HTMLTextAreaElement>('[data-field="body"]', el);
    if (area) autoGrow(area);
  });

  return {
    el,
    update(reason) {
      if (!store.product(id)) return;
      if (reason === 'load') {
        render();
        return;
      }
      if (reason === 'categories' || reason === 'settings') {
        const focusedField = (document.activeElement as HTMLElement | null)?.dataset?.field;
        if (!focusedField) render();
        return;
      }
      renderMedia();
      syncInputs();
    },
    focus(section) {
      const target = $(`[data-section="${section === 'images' ? 'photos' : section === 'title' || section === 'brand' || section === 'category' ? 'basics' : section === 'authenticity' || section === 'tags' ? (section === 'tags' ? 'extra' : 'details') : section === 'body' ? 'description' : section}"]`, el);
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.classList.add('is-flash');
      setTimeout(() => target.classList.remove('is-flash'), 1400);
      const input = $<HTMLInputElement>('input:not([type="checkbox"]):not([type="radio"]), textarea, select', target);
      if (input && section !== 'photos' && section !== 'images' && section !== 'video') setTimeout(() => input.focus({ preventScroll: true }), 350);
    },
  };
}
