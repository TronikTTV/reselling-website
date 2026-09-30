// Categories: rename, reorder, describe, add and remove, with sub-categories inside them as deep as
// needed (Trainers & Shoes › Nike › P-6000). A sub-category's web address starts with its parent's
// ("shoes/nike"), so moving or deleting a category takes its sub-categories and products with it.
import { categorySlug, CATEGORY_SLUG, insertCategory, isWithin, moveAddress, parentOf, slugifyPart } from '../../lib/category-tree.ts';
import { $, fragment, html, pluralise, setHtml, type Markup } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import { sortable } from '../lib/sortable.ts';
import type { Context, View } from '../shell.ts';
import type { Category } from '../store.ts';
import { confirmDialog, promptDialog, toast } from '../ui.ts';

export function categoriesView(context: Context): View {
  const { store } = context;
  const el = document.createElement('div');
  el.className = 'st-categories';
  const open = new Set<string>();

  /** Products in a category or any of its sub-categories. */
  const usage = (slug: string) =>
    store.productList().filter((product) => store.inCategory(product.data.category, slug) || isWithin(categorySlug(product.data.category), slug));

  const save = (list: { name: string; slug: string; description?: string }[]) => store.setCategories(list);

  function row(category: Category, children: Map<string, Category[]>, index: number): Markup {
    const count = usage(category.slug).length;
    const expanded = open.has(category.slug);
    const subs = children.get(category.slug) ?? [];
    const prefix = category.parent ? `/category/${category.parent}/` : '/category/';
    return html`
      <li class="st-cat ${expanded ? 'is-open' : ''}" data-key="${category.slug}" data-parent="${category.parent}" style="--i:${index}">
        <div class="st-cat__row">
          <span class="st-cat__grip" title="Drag to reorder">${icon('grip', 18)}</span>
          <input class="st-input st-cat__name" value="${category.name}" data-name="${category.slug}" aria-label="${category.parent ? 'Sub-category name' : 'Category name'}" />
          <span class="st-cat__count">${pluralise(count, 'piece')}</span>
          <button type="button" class="st-icon-btn st-icon-btn--sm" data-add-sub="${category.slug}" title="Add a sub-category inside ${category.name}" aria-label="Add a sub-category inside ${category.name}">${icon('plus', 16)}</button>
          <button type="button" class="st-icon-btn st-icon-btn--sm" data-toggle="${category.slug}" aria-expanded="${expanded}" title="More">${icon('chevron-down', 16)}</button>
        </div>
        ${
          expanded
            ? html`<div class="st-cat__more">
                <label class="st-field">
                  <span class="st-field__label">Web address</span>
                  <span class="st-slug"><span>${prefix}</span><input class="st-input" value="${category.slug.split('/').pop() ?? ''}" data-slug="${category.slug}" autocomplete="off" spellcheck="false" /></span>
                  <span class="st-field__hint">${count ? `Changing it moves its ${pluralise(count, 'piece')} too. Old shared links to it stop working.` : 'Lowercase letters, numbers and dashes.'}</span>
                </label>
                <label class="st-field">
                  <span class="st-field__label">Description</span>
                  <textarea class="st-input st-textarea" rows="2" data-description="${category.slug}" placeholder="Shown at the top of its page (optional)">${category.description ?? ''}</textarea>
                </label>
                <div class="st-row">
                  <button type="button" class="st-btn st-btn--ghost st-btn--sm" data-add-sub="${category.slug}">${icon('plus', 15)} Add a sub-category</button>
                  ${count ? html`<a class="st-btn st-btn--ghost st-btn--sm" href="#/products?category=${encodeURIComponent(category.slug)}">${icon('products', 15)} See its products</a>` : ''}
                  ${count ? html`<a class="st-btn st-btn--ghost st-btn--sm" href="#/live?path=${encodeURIComponent(`/category/${category.slug}/`)}">${icon('wand', 15)} Edit on the page</a>` : ''}
                  <button type="button" class="st-btn st-btn--danger-ghost st-btn--sm" data-delete="${category.slug}">${icon('trash', 15)} Delete</button>
                </div>
              </div>`
            : ''
        }
        ${subs.length ? html`<ol class="st-cats st-cats--sub" data-cats="${category.slug}">${subs.map((sub, subIndex) => row(sub, children, subIndex))}</ol>` : ''}
      </li>
    `;
  }

  function render() {
    const list = store.categories();
    const children = new Map<string, Category[]>();
    for (const category of list) children.set(category.parent, [...(children.get(category.parent) ?? []), category]);
    const other = store.productList().filter((product) => !store.resolveCategory(product.data.category)).length;
    setHtml(
      el,
      html`
        <header class="st-page-head">
          <div>
            <p class="st-eyebrow">${icon('categories', 14)} How your store is organised</p>
            <h1 class="st-title">Categories</h1>
            <p class="st-subtitle">Drag to change the order they appear on your site. Press + on a category to put sub-categories inside it, like Trainers & Shoes › Nike › P\u20116000. Empty ones are hidden from shoppers.</p>
          </div>
        </header>

        <section class="st-card">
          <ol class="st-cats" data-cats="">
            ${(children.get('') ?? []).map((category, index) => row(category, children, index))}
          </ol>
          ${other ? html`<p class="st-hint">${icon('info', 14)} ${pluralise(other, 'piece')} ${other === 1 ? 'has' : 'have'} no category and ${other === 1 ? 'shows' : 'show'} under "Other". <a class="st-link" href="#/products?category=other">Sort them</a></p>` : ''}
          <form class="st-cat-add" data-add>
            <input class="st-input" name="name" placeholder="New category, e.g. Sunglasses" autocomplete="off" />
            <button class="st-btn st-btn--primary">${icon('plus', 16)} Add</button>
          </form>
        </section>
      `,
    );
    // Each level is dragged on its own: sub-categories stay inside their category.
    for (const group of el.querySelectorAll<HTMLElement>('[data-cats]')) {
      const parent = group.dataset.cats ?? '';
      sortable(group, { item: `.st-cat[data-parent="${parent}"]`, onSort: (keys) => reorder(parent, keys) });
    }
  }

  /** Saves a new order for one category's sub-categories (or the top level). */
  function reorder(parent: string, keys: string[]) {
    const list = store.categories();
    const bySlug = new Map(list.map((category) => [category.slug, category]));
    const children = new Map<string, Category[]>();
    for (const category of list) children.set(category.parent, [...(children.get(category.parent) ?? []), category]);
    children.set(parent, keys.map((key) => bySlug.get(key)).filter((category): category is Category => Boolean(category)));
    const ordered: Category[] = [];
    const walk = (slug: string) => {
      for (const category of children.get(slug) ?? []) {
        ordered.push(category);
        walk(category.slug);
      }
    };
    walk('');
    save(ordered);
    render();
  }

  /** A web address nobody else is using: "shoes/nike", else "shoes/nike-2". */
  function freeSlug(parent: string, name: string) {
    const base = `${parent ? `${parent}/` : ''}${slugifyPart(name) || 'category'}`;
    let slug = base;
    for (let n = 2; store.categories().some((category) => category.slug === slug); n++) slug = `${base}-${n}`;
    return slug;
  }

  async function addSubcategory(parentSlug: string) {
    const parent = store.categories().find((category) => category.slug === parentSlug);
    if (!parent) return;
    const name = await promptDialog({ title: `New sub-category in ${parent.name}`, label: 'Name', placeholder: 'e.g. Nike', confirm: 'Add' });
    if (!name) return;
    save(insertCategory(store.categories(), { name, slug: freeSlug(parent.slug, name), parent: parent.slug, depth: parent.depth + 1 }));
    render();
    toast(`${name} added inside ${parent.name}. It appears on your site once it has products.`, { tone: 'ok' });
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
    const parent = parentOf(from);
    const own = slugifyPart(target.value);
    const to = `${parent ? `${parent}/` : ''}${own}`;
    target.value = own;
    if (to === from) return;
    if (!own || !CATEGORY_SLUG.test(to)) {
      toast('Use lowercase letters, numbers and dashes.', { tone: 'warn' });
      target.value = from.split('/').pop() ?? '';
      return;
    }
    if (store.categories().some((category) => category.slug === to)) {
      toast('Another category already uses that web address.', { tone: 'warn' });
      target.value = from.split('/').pop() ?? '';
      return;
    }
    const products = usage(from);
    if (products.length) {
      const ok = await confirmDialog({
        title: `Move ${pluralise(products.length, 'piece')} to /category/${to}/?`,
        body: 'Links people have shared to the old address will stop working.',
        confirm: 'Change it',
      });
      if (!ok) {
        target.value = from.split('/').pop() ?? '';
        return;
      }
      for (const product of products) store.updateProduct(product.id, { category: moveAddress(categorySlug(product.data.category), from, to) }, true);
    }
    // Its sub-categories move with it.
    save(store.categories().map((category) => ({ ...category, slug: moveAddress(category.slug, from, to) })));
    for (const slug of [...open]) {
      if (!isWithin(slug, from)) continue;
      open.delete(slug);
      open.add(moveAddress(slug, from, to));
    }
    store.emit('products');
    render();
  });

  el.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const input = form.elements.namedItem('name') as HTMLInputElement;
    const name = input.value.trim();
    if (!name) return;
    save([...store.categories(), { name, slug: freeSlug('', name), parent: '', depth: 0 }]);
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
    const add = target.closest<HTMLElement>('[data-add-sub]');
    if (add) {
      addSubcategory(add.dataset.addSub!);
      return;
    }
    const remove = target.closest<HTMLElement>('[data-delete]');
    if (!remove) return;
    const slug = remove.dataset.delete!;
    const list = store.categories();
    const category = list.find((item) => item.slug === slug);
    const inside = list.filter((item) => item.slug !== slug && isWithin(item.slug, slug));
    const products = usage(slug);
    const others = list.filter((item) => !isWithin(item.slug, slug));
    const name = category?.name ?? 'this category';
    const title = inside.length ? `Delete ${name} and its ${pluralise(inside.length, 'sub-category', 'sub-categories')}?` : `Delete ${name}?`;
    if (products.length === 0) {
      const ok = await confirmDialog({ title, confirm: 'Delete', danger: true });
      if (!ok) return;
      save(others);
      render();
      return;
    }
    // Ask where its products should go (its parent category, to start with).
    const parent = parentOf(slug);
    const dialog = fragment(html`
      <dialog class="st-dialog">
        <form method="dialog" class="st-dialog__card">
          <h2 class="st-dialog__title">${title}</h2>
          <p class="st-dialog__body">Its ${pluralise(products.length, 'piece')} need somewhere to go.</p>
          <label class="st-field">
            <span class="st-field__label">Move them to</span>
            <span class="st-select st-select--block">
              <select name="target">
                ${others.map((item) => html`<option value="${item.slug}" ${item.slug === parent ? 'selected' : ''}>${store.categoryLabel(item.slug)}</option>`)}
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
      const destination = (dialog.querySelector('select') as HTMLSelectElement | null)?.value ?? '';
      if (dialog.returnValue === 'ok' && destination) {
        for (const product of products) store.updateProduct(product.id, { category: destination }, true);
        save(others);
        store.emit('products');
        render();
        toast(`Moved ${pluralise(products.length, 'piece')} to ${store.categoryLabel(destination)} and deleted ${name}.`, { tone: 'ok' });
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
