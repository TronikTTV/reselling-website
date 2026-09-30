// Products: every piece in the store with search, filters, sorting, quick status changes and bulk edits.
import { $, $$, debounce, formatNumber, html, pluralise, setHtml } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import type { Status } from '../lib/product-file.ts';
import { missing } from '../insights.ts';
import type { Context, View } from '../shell.ts';
import type { Product } from '../store.ts';
import { categoryOptions, confirmDialog, hydrateMedia, thumb, toast } from '../ui.ts';

const PAGE = 60;
const VIEW_KEY = 'central-supply.studio.products-view';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'available', label: 'Available' },
  { id: 'reserved', label: 'Reserved' },
  { id: 'sold', label: 'Sold' },
  { id: 'draft', label: 'Drafts' },
  { id: 'featured', label: 'On home page' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'changed', label: 'Not live yet' },
] as const;

const SORTS = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  'price-desc': 'Price: high to low',
  'price-asc': 'Price: low to high',
  name: 'Name: A to Z',
} as const;

const normalise = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function productsView(context: Context): View {
  const { store } = context;
  const query = context.route.query;
  let status = query.get('status') ?? 'all';
  let category = query.get('category') ?? '';
  let search = query.get('q') ?? '';
  let sort = (query.get('sort') ?? 'newest') as keyof typeof SORTS;
  let limit = PAGE;
  let layout = 'grid';
  try {
    layout = localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    // Storage blocked: use the grid.
  }
  const selected = new Set<string>();

  const el = document.createElement('div');
  el.className = 'st-products';

  const matchesStatus = (product: Product, id: string) => {
    const { data } = product;
    switch (id) {
      case 'available':
      case 'reserved':
      case 'sold':
        return !data.draft && data.status === id;
      case 'draft':
        return data.draft;
      case 'featured':
        return !data.draft && data.featured;
      case 'attention':
        return !data.draft && missing(product).length > 0;
      case 'changed':
        return store.hasChanges(product);
      default:
        return true;
    }
  };

  function filtered() {
    const words = normalise(search).split(/\s+/).filter(Boolean);
    const list = store.productList().filter((product) => {
      const { data } = product;
      if (!matchesStatus(product, status)) return false;
      // A category includes its sub-categories; "other" is anything not in a category.
      if (category && (category === 'other' ? store.resolveCategory(data.category) : !store.inCategory(data.category, category))) return false;
      if (words.length === 0) return true;
      const haystack = normalise([data.title, data.brand, data.size, data.styleCode, data.colourway, data.condition, store.categoryLabel(data.category), ...data.tags].join(' '));
      return words.every((word) => haystack.includes(word));
    });
    const price = (product: Product, direction: number) => (product.data.price === null ? Number.POSITIVE_INFINITY : product.data.price * direction);
    const sorters: Record<string, (a: Product, b: Product) => number> = {
      newest: () => 0,
      oldest: (a, b) => (a.data.date || '').localeCompare(b.data.date || ''),
      'price-asc': (a, b) => price(a, 1) - price(b, 1),
      'price-desc': (a, b) => price(a, -1) - price(b, -1),
      name: (a, b) => a.data.title.localeCompare(b.data.title),
    };
    return list.sort(sorters[sort] ?? sorters.newest);
  }

  function syncAddress() {
    const params = new URLSearchParams();
    if (status !== 'all') params.set('status', status);
    if (category) params.set('category', category);
    if (search) params.set('q', search);
    if (sort !== 'newest') params.set('sort', sort);
    const hash = `#/products${params.size ? `?${params}` : ''}`;
    history.replaceState(null, '', hash);
  }

  function badges(product: Product) {
    const { data } = product;
    return html`
      ${data.draft ? html`<span class="st-pill st-pill--draft">${icon('eye-off', 12)} Draft</span>` : ''}
      ${!data.draft && data.status !== 'available' ? html`<span class="st-pill st-pill--${data.status}">${data.status === 'sold' ? 'Sold' : 'Reserved'}</span>` : ''}
      ${data.featured ? html`<span class="st-pill st-pill--featured" title="On the home page">${icon('star-fill', 12)}</span>` : ''}
      ${data.video ? html`<span class="st-pill st-pill--video" title="Has a video">${icon('play', 11)}</span>` : ''}
      ${store.hasChanges(product) ? html`<span class="st-pill st-pill--changed" title="Not live yet">${product.isNew ? 'New' : 'Edited'}</span>` : ''}
    `;
  }

  const statusSelect = (product: Product) => html`
    <label class="st-status-select st-status-select--${product.data.status}">
      <span class="st-sr">Status</span>
      <select data-status-select="${product.id}">
        ${(['available', 'reserved', 'sold'] as Status[]).map((value) => html`<option value="${value}" ${product.data.status === value ? 'selected' : ''}>${value[0].toUpperCase() + value.slice(1)}</option>`)}
      </select>
      ${icon('chevron-down', 14)}
    </label>
  `;

  const card = (product: Product, index: number) => {
    const { data } = product;
    const href = `#/products/${encodeURIComponent(product.id)}`;
    return html`
      <article class="st-pcard ${selected.has(product.id) ? 'is-selected' : ''} ${data.draft ? 'is-draft' : ''}" data-id="${product.id}" style="--i:${index % 12}">
        <label class="st-check st-pcard__check" title="Select">
          <input type="checkbox" data-select="${product.id}" ${selected.has(product.id) ? 'checked' : ''} />
          <span>${icon('check', 14)}</span>
        </label>
        <a class="st-pcard__media" href="${href}">
          ${thumb(product, data.images[0], 'thumb', data.title)}
          <span class="st-pcard__badges">${badges(product)}</span>
          ${data.images.length > 1 ? html`<span class="st-pcard__count">${icon('image', 12)} ${data.images.length}</span>` : ''}
        </a>
        <div class="st-pcard__body">
          <a class="st-pcard__title" href="${href}">${data.title || 'Untitled'}</a>
          <p class="st-pcard__meta">${[data.brand, data.size].filter(Boolean).join(' · ') || store.categoryName(data.category)}</p>
          <div class="st-pcard__foot">
            <span class="st-pcard__price">${store.formatPrice(data.price) || html`<span class="st-muted">No price</span>`}</span>
            ${statusSelect(product)}
          </div>
        </div>
        <div class="st-pcard__quick">
          <button type="button" class="st-icon-btn st-icon-btn--sm ${data.featured ? 'is-on' : ''}" data-toggle-featured="${product.id}" title="${data.featured ? 'Take off the home page' : 'Feature on the home page'}" aria-pressed="${data.featured}">${icon(data.featured ? 'star-fill' : 'star', 16)}</button>
          <button type="button" class="st-icon-btn st-icon-btn--sm ${data.draft ? 'is-on' : ''}" data-toggle-draft="${product.id}" title="${data.draft ? 'Show on the site' : 'Hide from the site (draft)'}" aria-pressed="${data.draft}">${icon(data.draft ? 'eye-off' : 'eye', 16)}</button>
        </div>
      </article>
    `;
  };

  const row = (product: Product) => {
    const { data } = product;
    const href = `#/products/${encodeURIComponent(product.id)}`;
    return html`
      <div class="st-prow ${selected.has(product.id) ? 'is-selected' : ''} ${data.draft ? 'is-draft' : ''}" data-id="${product.id}" role="row">
        <label class="st-check" title="Select"><input type="checkbox" data-select="${product.id}" ${selected.has(product.id) ? 'checked' : ''} /><span>${icon('check', 14)}</span></label>
        <a class="st-prow__thumb" href="${href}">${thumb(product, data.images[0])}</a>
        <a class="st-prow__main" href="${href}">
          <strong>${data.title || 'Untitled'}</strong>
          <small>${[data.brand, data.size, store.categoryName(data.category)].filter(Boolean).join(' · ')}</small>
        </a>
        <span class="st-prow__badges">${badges(product)}</span>
        <span class="st-prow__price">${store.formatPrice(data.price) || html`<span class="st-muted">—</span>`}</span>
        ${statusSelect(product)}
        <span class="st-prow__quick">
          <button type="button" class="st-icon-btn st-icon-btn--sm ${data.featured ? 'is-on' : ''}" data-toggle-featured="${product.id}" title="${data.featured ? 'Take off the home page' : 'Feature on the home page'}">${icon(data.featured ? 'star-fill' : 'star', 16)}</button>
          <button type="button" class="st-icon-btn st-icon-btn--sm ${data.draft ? 'is-on' : ''}" data-toggle-draft="${product.id}" title="${data.draft ? 'Show on the site' : 'Hide from the site (draft)'}">${icon(data.draft ? 'eye-off' : 'eye', 16)}</button>
        </span>
      </div>
    `;
  };

  function renderResults() {
    const list = filtered();
    const results = $('[data-results]', el);
    const counts = $('[data-result-count]', el);
    if (counts) counts.textContent = pluralise(list.length, 'piece');
    if (!results) return;
    if (list.length === 0) {
      setHtml(
        results,
        html`<div class="st-empty">
          ${icon('search', 26)}
          <p><strong>Nothing here.</strong></p>
          <p class="st-muted">${store.productList().length === 0 ? 'Add your first product to get started.' : 'Try another search or filter.'}</p>
          ${store.productList().length === 0 ? html`<a class="st-btn st-btn--primary" href="#/products/new">${icon('plus', 16)} Add a product</a>` : html`<button type="button" class="st-btn st-btn--ghost" data-clear>Clear filters</button>`}
        </div>`,
      );
      return;
    }
    const shown = list.slice(0, limit);
    setHtml(
      results,
      html`
        ${layout === 'grid' ? html`<div class="st-pgrid">${shown.map(card)}</div>` : html`<div class="st-plist" role="table">${shown.map(row)}</div>`}
        ${list.length > limit ? html`<div class="st-more-row"><button type="button" class="st-btn st-btn--ghost" data-more>Show ${formatNumber(Math.min(PAGE, list.length - limit))} more</button></div>` : ''}
      `,
    );
    hydrateMedia(store, results);
  }

  function renderFilters() {
    const target = $('[data-filters]', el);
    if (!target) return;
    const all = store.productList();
    setHtml(
      target,
      html`${FILTERS.map((filter) => {
        const count = all.filter((product) => matchesStatus(product, filter.id)).length;
        if (count === 0 && filter.id !== 'all' && filter.id !== status && ['changed', 'attention', 'draft', 'reserved', 'featured'].includes(filter.id)) return '';
        return html`<button type="button" class="st-filter ${status === filter.id ? 'is-active' : ''} st-filter--${filter.id}" data-filter="${filter.id}" aria-pressed="${status === filter.id}">
          ${filter.label}<span class="st-filter__count">${formatNumber(count)}</span>
        </button>`;
      })}`,
    );
  }

  function renderBulk() {
    const bar = $('[data-bulk]', el);
    if (!bar) return;
    bar.hidden = selected.size === 0;
    if (selected.size === 0) return;
    setHtml(
      bar,
      html`
        <span class="st-bulk__count">${pluralise(selected.size, 'piece')} selected</span>
        <div class="st-bulk__actions">
          <button type="button" class="st-btn st-btn--ghost st-btn--sm" data-bulk-status="available">Available</button>
          <button type="button" class="st-btn st-btn--ghost st-btn--sm" data-bulk-status="reserved">Reserved</button>
          <button type="button" class="st-btn st-btn--ghost st-btn--sm" data-bulk-status="sold">Sold</button>
          <span class="st-bulk__sep" aria-hidden="true"></span>
          <button type="button" class="st-btn st-btn--ghost st-btn--sm" data-bulk="feature">${icon('star', 15)} Feature</button>
          <button type="button" class="st-btn st-btn--ghost st-btn--sm" data-bulk="unfeature">Unfeature</button>
          <button type="button" class="st-btn st-btn--ghost st-btn--sm" data-bulk="hide">${icon('eye-off', 15)} Hide</button>
          <button type="button" class="st-btn st-btn--ghost st-btn--sm" data-bulk="show">${icon('eye', 15)} Show</button>
          <label class="st-select st-select--sm">
            <select data-bulk-category aria-label="Move to category">
              <option value="">Move to…</option>
              ${categoryOptions(store, '')}
            </select>
            ${icon('chevron-down', 14)}
          </label>
          <button type="button" class="st-btn st-btn--danger st-btn--sm" data-bulk="delete">${icon('trash', 15)} Delete</button>
        </div>
        <button type="button" class="st-icon-btn st-icon-btn--sm" data-bulk="clear" aria-label="Clear selection">${icon('close', 16)}</button>
      `,
    );
  }

  function render() {
    setHtml(
      el,
      html`
        <header class="st-page-head">
          <div>
            <p class="st-eyebrow">${icon('products', 14)} Your stock</p>
            <h1 class="st-title">Products</h1>
            <p class="st-subtitle" data-result-count></p>
          </div>
          <div class="st-page-head__actions">
            <a class="st-btn st-btn--primary" href="#/add">${icon('sparkles', 17)} Add from photos</a>
            <a class="st-btn st-btn--ghost st-hide-touch" href="#/add/folders">${icon('folder', 17)} Add from folders</a>
            <a class="st-btn st-btn--ghost" href="#/products/new">${icon('plus', 17)} Add by hand</a>
          </div>
        </header>

        <div class="st-toolbar">
          <label class="st-search">
            ${icon('search', 18)}
            <input type="search" placeholder="Search name, brand, size, style code…" value="${search}" data-search autocomplete="off" />
          </label>
          <label class="st-select">
            <select data-category aria-label="Category">
              <option value="">All categories</option>
              ${categoryOptions(store, category)}
              <option value="other" ${category === 'other' ? 'selected' : ''}>Other</option>
            </select>
            ${icon('chevron-down', 14)}
          </label>
          <label class="st-select">
            <select data-sort aria-label="Sort">
              ${Object.entries(SORTS).map(([value, label]) => html`<option value="${value}" ${sort === value ? 'selected' : ''}>${label}</option>`)}
            </select>
            ${icon('chevron-down', 14)}
          </label>
          <div class="st-segmented" role="group" aria-label="Layout">
            <button type="button" class="${layout === 'grid' ? 'is-active' : ''}" data-layout="grid" aria-label="Grid" title="Grid">${icon('grid', 17)}</button>
            <button type="button" class="${layout === 'list' ? 'is-active' : ''}" data-layout="list" aria-label="List" title="List">${icon('list', 17)}</button>
          </div>
        </div>

        <div class="st-filters" data-filters role="group" aria-label="Show"></div>
        <div class="st-bulk" data-bulk hidden></div>
        <div data-results></div>
      `,
    );
    renderFilters();
    renderResults();
    renderBulk();
  }

  const runSearch = debounce(() => {
    limit = PAGE;
    syncAddress();
    renderResults();
  }, 120);

  el.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;
    if (target.matches('[data-search]')) {
      search = (target as HTMLInputElement).value;
      runSearch();
    }
  });

  el.addEventListener('change', async (event) => {
    const target = event.target as HTMLElement;
    if (target.matches('[data-category]')) {
      category = (target as HTMLSelectElement).value;
      limit = PAGE;
      syncAddress();
      renderResults();
    } else if (target.matches('[data-sort]')) {
      sort = (target as HTMLSelectElement).value as keyof typeof SORTS;
      syncAddress();
      renderResults();
    } else if (target.matches('[data-status-select]')) {
      const id = target.dataset.statusSelect!;
      store.updateProduct(id, { status: (target as HTMLSelectElement).value as Status });
      toast(`Marked as ${(target as HTMLSelectElement).value}. Publish to update your site.`, { tone: 'info', timeout: 2500 });
    } else if (target.matches('[data-select]')) {
      const id = target.dataset.select!;
      if ((target as HTMLInputElement).checked) selected.add(id);
      else selected.delete(id);
      target.closest('[data-id]')?.classList.toggle('is-selected', selected.has(id));
      renderBulk();
    } else if (target.matches('[data-bulk-category]')) {
      const slug = (target as HTMLSelectElement).value;
      if (!slug) return;
      for (const id of selected) store.updateProduct(id, { category: slug }, true);
      store.emit('products');
      toast(`Moved ${pluralise(selected.size, 'piece')} to ${store.categoryLabel(slug)}.`, { tone: 'ok' });
      selected.clear();
      renderBulk();
    }
  });

  el.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const filter = target.closest<HTMLElement>('[data-filter]');
    if (filter) {
      status = filter.dataset.filter!;
      limit = PAGE;
      syncAddress();
      renderFilters();
      renderResults();
      return;
    }
    const layoutButton = target.closest<HTMLElement>('[data-layout]');
    if (layoutButton) {
      layout = layoutButton.dataset.layout === 'list' ? 'list' : 'grid';
      try {
        localStorage.setItem(VIEW_KEY, layout);
      } catch {
        // Not remembered: fine.
      }
      $$('[data-layout]', el).forEach((button) => button.classList.toggle('is-active', button.dataset.layout === layout));
      renderResults();
      return;
    }
    if (target.closest('[data-more]')) {
      limit += PAGE;
      renderResults();
      return;
    }
    if (target.closest('[data-clear]')) {
      status = 'all';
      category = '';
      search = '';
      syncAddress();
      render();
      return;
    }
    const featured = target.closest<HTMLElement>('[data-toggle-featured]');
    if (featured) {
      const product = store.product(featured.dataset.toggleFeatured!);
      if (product) store.updateProduct(product.id, { featured: !product.data.featured });
      return;
    }
    const draft = target.closest<HTMLElement>('[data-toggle-draft]');
    if (draft) {
      const product = store.product(draft.dataset.toggleDraft!);
      if (product) store.updateProduct(product.id, { draft: !product.data.draft });
      return;
    }
    const bulkStatus = target.closest<HTMLElement>('[data-bulk-status]');
    if (bulkStatus) {
      for (const id of selected) store.updateProduct(id, { status: bulkStatus.dataset.bulkStatus as Status }, true);
      store.emit('products');
      toast(`Marked ${pluralise(selected.size, 'piece')} as ${bulkStatus.dataset.bulkStatus}.`, { tone: 'ok' });
      return;
    }
    const bulk = target.closest<HTMLElement>('[data-bulk]');
    if (bulk) {
      const action = bulk.dataset.bulk;
      if (action === 'clear') {
        selected.clear();
        renderResults();
        renderBulk();
        return;
      }
      if (action === 'delete') {
        const ok = await confirmDialog({
          title: `Delete ${pluralise(selected.size, 'piece')}?`,
          body: 'They come off your site with their photos when you publish. Until then you can undo it.',
          confirm: 'Delete',
          danger: true,
        });
        if (!ok) return;
        for (const id of selected) store.deleteProduct(id);
        toast(`${pluralise(selected.size, 'piece')} will be deleted when you publish.`, { tone: 'info' });
        selected.clear();
        renderBulk();
        return;
      }
      const patch = { feature: { featured: true }, unfeature: { featured: false }, hide: { draft: true }, show: { draft: false } }[action ?? ''];
      if (patch) {
        for (const id of selected) store.updateProduct(id, patch, true);
        store.emit('products');
      }
    }
  });

  render();
  return {
    el,
    update(reason) {
      if (reason === 'load') {
        // Products may have been added or removed.
        for (const id of [...selected]) if (!store.product(id)) selected.delete(id);
      }
      if (['load', 'products', 'categories', 'settings'].includes(reason)) {
        renderFilters();
        renderResults();
        renderBulk();
      }
    },
  };
}
