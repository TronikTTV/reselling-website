// Categories: rename, reorder, describe, add and remove. Products follow when a category's web
// address changes or it's deleted.
import { $, fragment, html, pluralise, setHtml } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import { slugify } from '../lib/product-file.ts';
import { sortable } from '../lib/sortable.ts';
import type { Context, View } from '../shell.ts';
import type { Category } from '../store.ts';
import { confirmDialog, toast } from '../ui.ts';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function categoriesView(context: Context): View {
  const { store } = context;
  const el = document.createElement('div');
  el.className = 'st-categories';
  const open = new Set<string>();

  const usage = (slug: string) => store.productList().filter((product) => product.data.category === slug);

  function render() {
    const list = store.categories();
    const known = new Set(list.map((category) => category.slug));
    const other = store.productList().filter((product) => !known.has(product.data.category)).length;
    setHtml(
      el,
      html`
        <header class="st-page-head">
          <div>
            <p class="st-eyebrow">${icon('categories', 14)} How your store is organised</p>
            <h1 class="st-title">Categories</h1>
            <p class="st-subtitle">Drag to change the order they appear on your site. Empty categories are hidden from shoppers.</p>
          </div>
        </header>

        <section class="st-card">
          <ol class="st-cats" data-cats>
            ${list.map((category, index) => {
              const count = usage(category.slug).length;
              const expanded = open.has(category.slug);
              return html`
                <li class="st-cat ${expanded ? 'is-open' : ''}" data-key="${category.slug}" style="--i:${index}">
                  <div class="st-cat__row">
                    <span class="st-cat__grip" title="Drag to reorder">${icon('grip', 18)}</span>
                    <input class="st-input st-cat__name" value="${category.name}" data-name="${category.slug}" aria-label="Category name" />
                    <span class="st-cat__count">${pluralise(count, 'piece')}</span>
                    <button type="button" class="st-icon-btn st-icon-btn--sm" data-toggle="${category.slug}" aria-expanded="${expanded}" title="More">${icon('chevron-down', 16)}</button>
                  </div>
                  ${
                    expanded
                      ? html`<div class="st-cat__more">
                          <label class="st-field">
                            <span class="st-field__label">Web address</span>
                            <span class="st-slug"><span>/category/</span><input class="st-input" value="${category.slug}" data-slug="${category.slug}" autocomplete="off" spellcheck="false" /></span>
                            <span class="st-field__hint">${count ? `Changing it moves its ${pluralise(count, 'piece')} too. Old shared links to the category stop working.` : 'Lowercase letters, numbers and dashes.'}</span>
                          </label>
                          <label class="st-field">
                            <span class="st-field__label">Description</span>
                            <textarea class="st-input st-textarea" rows="2" data-description="${category.slug}" placeholder="Shown at the top of the category page (optional)">${category.description ?? ''}</textarea>
                          </label>
                          <div class="st-row">
                            ${count ? html`<a class="st-btn st-btn--ghost st-btn--sm" href="#/products?category=${encodeURIComponent(category.slug)}">${icon('products', 15)} See its products</a>` : ''}
                            ${count ? html`<a class="st-btn st-btn--ghost st-btn--sm" href="#/live?path=${encodeURIComponent(`/category/${category.slug}/`)}">${icon('wand', 15)} Edit on the page</a>` : ''}
                            <button type="button" class="st-btn st-btn--danger-ghost st-btn--sm" data-delete="${category.slug}">${icon('trash', 15)} Delete</button>
                          </div>
                        </div>`
                      : ''
                  }
                </li>
              `;
            })}
          </ol>
          ${other ? html`<p class="st-hint">${icon('info', 14)} ${pluralise(other, 'piece')} ${other === 1 ? 'has' : 'have'} no category and ${other === 1 ? 'shows' : 'show'} under "Other". <a class="st-link" href="#/products?category=other">Sort them</a></p>` : ''}
          <form class="st-cat-add" data-add>
            <input class="st-input" name="name" placeholder="New category, e.g. Sunglasses" autocomplete="off" />
            <button class="st-btn st-btn--primary">${icon('plus', 16)} Add</button>
          </form>
        </section>
      `,
    );
    sortable($('[data-cats]', el)!, {
      item: '.st-cat',
      onSort: (keys) => {
        const bySlug = new Map(store.categories().map((category) => [category.slug, category]));
        store.setCategories(keys.map((key) => bySlug.get(key)).filter((category): category is Category => Boolean(category)));
        render();
      },
    });
  }

  function save(list: Category[]) {
    store.setCategories(list);
  }

  el.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    const list = store.categories();
    if (target.dataset.name) {
      save(list.map((category) => (category.slug === target.dataset.name ? { ...category, name: target.value } : category)));
    } else if (target.dataset.description) {
      save(list.map((category) => (category.slug === target.dataset.description ? { ...category, description: target.value } : category)));
    }
  });

  el.addEventListener('change', async (event) => {
    const target = event.target as HTMLInputElement;
    if (target.dataset.name) {
      if (!target.value.trim()) {
        toast('A category needs a name.', { tone: 'warn' });
        target.focus();
      }
      return;
    }
    if (!target.dataset.slug) return;
    const from = target.dataset.slug;
    const to = slugify(target.value);
    target.value = to;
    if (to === from) return;
    if (!SLUG.test(to)) {
      toast('Use lowercase letters, numbers and dashes.', { tone: 'warn' });
      target.value = from;
      return;
    }
    if (store.categories().some((category) => category.slug === to)) {
      toast('Another category already uses that web address.', { tone: 'warn' });
      target.value = from;
      return;
    }
    const products = usage(from);
    if (products.length) {
      const ok = await confirmDialog({
        title: `Move ${pluralise(products.length, 'piece')} to /category/${to}/?`,
        body: 'Links people have shared to the old category address will stop working.',
        confirm: 'Change it',
      });
      if (!ok) {
        target.value = from;
        return;
      }
      for (const product of products) store.updateProduct(product.id, { category: to }, true);
    }
    save(store.categories().map((category) => (category.slug === from ? { ...category, slug: to } : category)));
    open.delete(from);
    open.add(to);
    store.emit('products');
    render();
  });

  el.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const input = form.elements.namedItem('name') as HTMLInputElement;
    const name = input.value.trim();
    if (!name) return;
    const base = slugify(name) || 'category';
    let slug = base;
    for (let n = 2; store.categories().some((category) => category.slug === slug); n++) slug = `${base}-${n}`;
    save([...store.categories(), { name, slug }]);
    render();
    toast(`${name} added. It appears on your site once it has products.`, { tone: 'ok' });
    $<HTMLInputElement>('[data-add] input', el)?.focus();
  });

  el.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const toggle = target.closest<HTMLElement>('[data-toggle]');
    if (toggle) {
      const slug = toggle.dataset.toggle!;
      if (open.has(slug)) open.delete(slug);
      else open.add(slug);
      render();
      return;
    }
    const remove = target.closest<HTMLElement>('[data-delete]');
    if (!remove) return;
    const slug = remove.dataset.delete!;
    const category = store.categories().find((item) => item.slug === slug);
    const products = usage(slug);
    const others = store.categories().filter((item) => item.slug !== slug);
    if (products.length === 0) {
      const ok = await confirmDialog({ title: `Delete ${category?.name ?? 'this category'}?`, confirm: 'Delete', danger: true });
      if (!ok) return;
      save(others);
      render();
      return;
    }
    // Ask where its products should go.
    const dialog = fragment(html`
      <dialog class="st-dialog">
        <form method="dialog" class="st-dialog__card">
          <h2 class="st-dialog__title">Delete ${category?.name ?? 'this category'}?</h2>
          <p class="st-dialog__body">Its ${pluralise(products.length, 'piece')} need somewhere to go.</p>
          <label class="st-field">
            <span class="st-field__label">Move them to</span>
            <span class="st-select st-select--block">
              <select name="target">
                ${others.map((item) => html`<option value="${item.slug}">${item.name}</option>`)}
              </select>
              ${icon('chevron-down', 14)}
            </span>
          </label>
          <div class="st-dialog__actions">
            <button class="st-btn st-btn--ghost" value="cancel">Cancel</button>
            <button class="st-btn st-btn--danger" value="ok">Move and delete</button>
          </div>
        </form>
      </dialog>
    `) as HTMLDialogElement;
    document.body.append(dialog);
    dialog.addEventListener('close', () => {
      const destination = (dialog.querySelector('select') as HTMLSelectElement).value;
      if (dialog.returnValue === 'ok' && destination) {
        for (const product of products) store.updateProduct(product.id, { category: destination }, true);
        save(others);
        store.emit('products');
        render();
        toast(`Moved ${pluralise(products.length, 'piece')} and deleted the category.`, { tone: 'ok' });
      }
      dialog.remove();
    });
    dialog.showModal();
  });

  render();
  return {
    el,
    update(reason) {
      if ((reason === 'load' || reason === 'categories' || reason === 'products') && !el.contains(document.activeElement)) render();
    },
  };
}
