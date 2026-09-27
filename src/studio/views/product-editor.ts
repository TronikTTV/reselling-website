// Products → one product, full page.
import { $, html, setHtml } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import type { Context, View } from '../shell.ts';
import { confirmDialog, toast } from '../ui.ts';
import { productForm } from './product-form.ts';

export function productEditorView(context: Context): View {
  const { store } = context;
  let id = context.route.parts[0];

  if (id === 'new') {
    id = store.createProduct(context.route.query.get('category') ?? '').id;
    history.replaceState(null, '', `#/products/${encodeURIComponent(id)}`);
  }

  const el = document.createElement('div');
  el.className = 'st-editor-page';

  if (!store.product(id)) {
    const moved = store.renamed.get(id);
    if (moved && store.product(moved)) {
      queueMicrotask(() => context.navigate(`#/products/${encodeURIComponent(moved)}`, { replace: true }));
    }
    setHtml(
      el,
      html`<div class="st-empty st-empty--page">
        ${icon('search', 28)}
        <p><strong>That product isn't here.</strong></p>
        <p class="st-muted">It may have been deleted, or it was a new product that wasn't published.</p>
        <a class="st-btn st-btn--primary" href="#/products">${icon('arrow-left', 16)} All products</a>
      </div>`,
    );
    return { el };
  }

  const form = productForm(store, id);

  function renderHead() {
    const product = store.product(id);
    const head = $('[data-head]', el);
    if (!product || !head) return;
    const { data } = product;
    const pageUrl = store.siteUrl(`/product/${encodeURIComponent(product.id)}/`);
    const onSite = !product.isNew && !product.base.draft;
    setHtml(
      head,
      html`
        <a class="st-back" href="#/products">${icon('arrow-left', 16)} Products</a>
        <div class="st-editor-head__main">
          <h1 class="st-title st-title--product">${data.title || (product.isNew ? 'New product' : 'Untitled')}</h1>
          <p class="st-editor-head__meta">
            ${product.isNew ? html`<span class="st-pill st-pill--changed">New · not live yet</span>` : ''}
            ${!product.isNew && store.hasChanges(product) ? html`<span class="st-pill st-pill--changed">Edited · not live yet</span>` : ''}
            ${data.draft ? html`<span class="st-pill st-pill--draft">${icon('eye-off', 12)} Draft</span>` : html`<span class="st-pill st-pill--${data.status}">${data.status}</span>`}
            ${data.featured ? html`<span class="st-pill st-pill--featured">${icon('star-fill', 12)} Home page</span>` : ''}
            <span class="st-muted">${store.categoryName(data.category)}${data.price !== null ? ` · ${store.formatPrice(data.price)}` : ''}</span>
          </p>
        </div>
        <div class="st-editor-head__actions">
          ${onSite ? html`<a class="st-btn st-btn--glass st-btn--sm" href="#/live?path=${encodeURIComponent(`/product/${product.id}/`)}">${icon('wand', 16)} Edit on the page</a>` : ''}
          ${onSite ? html`<a class="st-btn st-btn--ghost st-btn--sm" href="${pageUrl}" target="_blank" rel="noopener">${icon('arrow-up-right', 16)} View</a>` : ''}
          <button type="button" class="st-btn st-btn--ghost st-btn--sm" data-duplicate title="Make a copy to list a similar piece">${icon('copy', 16)} Duplicate</button>
          ${store.hasChanges(product) && !product.isNew ? html`<button type="button" class="st-btn st-btn--ghost st-btn--sm" data-discard>${icon('undo', 16)} Undo changes</button>` : ''}
          <button type="button" class="st-btn st-btn--danger-ghost st-btn--sm" data-delete>${icon('trash', 16)} Delete</button>
        </div>
      `,
    );
  }

  setHtml(el, html`<header class="st-editor-head" data-head></header><div data-form></div>`);
  $('[data-form]', el)!.replaceWith(form.el);
  renderHead();

  el.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const product = store.product(id);
    if (!product) return;
    if (target.closest('[data-duplicate]')) {
      const copy = store.duplicateProduct(id);
      if (copy) {
        toast('Copy made (as a draft). Change what\'s different and publish.', { tone: 'ok' });
        context.navigate(`#/products/${encodeURIComponent(copy.id)}`);
      }
    } else if (target.closest('[data-discard]')) {
      store.discardProduct(id);
      context.navigate(`#/products/${encodeURIComponent(id)}`, { replace: true });
      toast('Changes undone.', { tone: 'info' });
    } else if (target.closest('[data-delete]')) {
      const ok = await confirmDialog({
        title: product.isNew ? 'Throw away this new product?' : `Delete "${product.data.title || 'this product'}"?`,
        body: product.isNew ? "It hasn't been published, so it's simply removed." : 'It comes off your site with its photos when you publish. Until then you can undo it from the Publish bar.',
        confirm: product.isNew ? 'Throw away' : 'Delete',
        danger: true,
      });
      if (!ok) return;
      store.deleteProduct(id);
      context.navigate('#/products');
      if (!product.isNew) {
        toast('Deleted. It goes when you publish.', { tone: 'info', action: { label: 'Undo', run: () => store.discardProduct(id) } });
      }
    }
  });

  return {
    el,
    update(reason) {
      if (!store.product(id)) {
        // Published: new products get their real web address.
        const moved = store.renamed.get(id);
        if (moved) context.navigate(`#/products/${encodeURIComponent(moved)}`, { replace: true });
        return;
      }
      renderHead();
      form.update(reason);
    },
  };
}
