// Site text: every piece of wording on the site, grouped by page, with a jump to see it in the live editor.
import { accentParts, TEXT_GROUPS, type TextField, type TextGroup } from '../../lib/copy-fields.ts';
import { $, $$, html, setHtml } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import { sortable } from '../lib/sortable.ts';
import type { Context, View } from '../shell.ts';
import { defaultText, type Store } from '../store.ts';

/** A page where a group of text can be seen. */
export function pageFor(store: Store, group: TextGroup): string {
  if (group.page === 'product') {
    const product = store.productList().find((item) => !item.isNew && !item.base.draft);
    return product ? `/product/${product.id}/` : '/';
  }
  return group.page;
}

export function groupOf(key: string) {
  return TEXT_GROUPS.find((group) => group.fields.some((field) => field.key === key));
}

export function fieldOf(key: string): TextField | undefined {
  return TEXT_GROUPS.flatMap((group) => group.fields).find((field) => field.key === key);
}

export const accentPreview = (value: string) =>
  html`${accentParts(value).map((part) => (part.accent ? html`<em>${part.text}</em>` : part.text))}`;

export function textView(context: Context): View {
  const { store } = context;
  const el = document.createElement('div');
  el.className = 'st-text';
  let group = TEXT_GROUPS.find((item) => item.id === context.route.parts[0]) ?? TEXT_GROUPS[0];

  const changedIn = (item: TextGroup) => item.fields.filter((field) => store.isTextChanged(field.key)).length;

  function fieldMarkup(field: TextField) {
    const value = store.text(field.key);
    const fallback = defaultText(field.key);
    const changed = store.isTextChanged(field.key);
    const show = `#/live?path=${encodeURIComponent(pageFor(store, group))}&key=${encodeURIComponent(field.key)}`;
    if (field.list) {
      const phrases = store.settings().ticker;
      return html`
        <div class="st-textfield ${changed ? 'is-changed' : ''}" data-key="${field.key}">
          <div class="st-textfield__head">
            <span class="st-field__label">${field.label}</span>
            <span class="st-textfield__tools">
              ${changed ? html`<button type="button" class="st-link-btn" data-undo-text="${field.key}">${icon('undo', 14)} Undo</button>` : ''}
              <a class="st-link-btn" href="${show}">${icon('eye', 14)} Show on page</a>
            </span>
          </div>
          ${field.hint ? html`<p class="st-field__hint">${field.hint}</p>` : ''}
          <ol class="st-phrases" data-phrases>
            ${phrases.map(
              (phrase, index) => html`
                <li class="st-phrase" data-key="${index}">
                  <span class="st-phrase__grip" aria-hidden="true">${icon('grip', 16)}</span>
                  <input class="st-input" value="${phrase}" data-phrase="${index}" aria-label="Phrase ${index + 1}" />
                  <button type="button" class="st-icon-btn st-icon-btn--sm" data-remove-phrase="${index}" aria-label="Remove">${icon('close', 15)}</button>
                </li>
              `,
            )}
          </ol>
          <button type="button" class="st-btn st-btn--ghost st-btn--sm" data-add-phrase>${icon('plus', 15)} Add a phrase</button>
        </div>
      `;
    }
    return html`
      <label class="st-textfield ${changed ? 'is-changed' : ''}" data-key="${field.key}">
        <span class="st-textfield__head">
          <span class="st-field__label">${field.label}${changed ? html`<span class="st-dot" title="Not live yet"></span>` : ''}</span>
          <span class="st-textfield__tools">
            ${changed ? html`<button type="button" class="st-link-btn" data-undo-text="${field.key}">${icon('undo', 14)} Undo</button>` : ''}
            <a class="st-link-btn" href="${show}">${icon('eye', 14)} Show on page</a>
          </span>
        </span>
        ${
          field.long
            ? html`<textarea class="st-input st-textarea" rows="3" data-text="${field.key}" placeholder="${fallback || 'Empty'}">${value}</textarea>`
            : html`<input class="st-input" data-text="${field.key}" value="${value}" placeholder="${fallback || 'Empty'}" autocomplete="off" />`
        }
        ${field.accent ? html`<span class="st-accent-preview" data-accent-preview="${field.key}">${accentPreview(value || fallback)}</span>` : ''}
        ${field.hint ? html`<span class="st-field__hint">${field.hint}</span>` : ''}
        ${fallback && value.trim() !== fallback ? html`<span class="st-field__hint st-field__default">Default: ${fallback}${value.trim() ? html` · <button type="button" class="st-link-btn" data-reset-text="${field.key}">Use default</button>` : ''}</span>` : ''}
      </label>
    `;
  }

  function renderNav() {
    const nav = $('[data-groups]', el);
    if (!nav) return;
    setHtml(
      nav,
      html`${TEXT_GROUPS.map((item) => {
        const changed = changedIn(item);
        return html`<a class="st-groups__link ${item.id === group.id ? 'is-active' : ''}" href="#/text/${item.id}" data-group="${item.id}">
          <span>${item.label}</span>
          ${changed ? html`<span class="st-groups__badge">${changed}</span>` : html`<span class="st-groups__count">${item.fields.length}</span>`}
        </a>`;
      })}`,
    );
  }

  function renderFields() {
    const box = $('[data-fields]', el);
    if (!box) return;
    setHtml(
      box,
      html`
        <header class="st-card__head">
          <div>
            <h2 class="st-card__title">${group.label}</h2>
            <p class="st-card__sub">${group.description}</p>
          </div>
          <a class="st-btn st-btn--glass st-btn--sm" href="#/live?path=${encodeURIComponent(pageFor(store, group))}">${icon('wand', 16)} Edit on the page</a>
        </header>
        <div class="st-textfields">${group.fields.map(fieldMarkup)}</div>
      `,
    );
    const phrases = $('[data-phrases]', box);
    if (phrases) {
      sortable(phrases, {
        item: '.st-phrase',
        onSort: (keys) => {
          const current = store.settings().ticker;
          store.setSetting('ticker', keys.map((key) => current[Number(key)]).filter((phrase) => phrase !== undefined));
          store.emit('text');
          renderFields();
        },
      });
    }
  }

  function render() {
    setHtml(
      el,
      html`
        <header class="st-page-head">
          <div>
            <p class="st-eyebrow">${icon('text', 14)} Words on your site</p>
            <h1 class="st-title">Site text</h1>
            <p class="st-subtitle">Change any heading, button or line of text. Leave one empty to use its default.</p>
          </div>
          <div class="st-page-head__actions">
            <a class="st-btn st-btn--primary" href="#/live">${icon('wand', 17)} Edit on the page instead</a>
          </div>
        </header>
        <div class="st-text__layout">
          <nav class="st-groups" data-groups aria-label="Pages"></nav>
          <section class="st-card st-text__fields" data-fields></section>
        </div>
      `,
    );
    renderNav();
    renderFields();
  }

  function updateMarkers(key: string) {
    const wrapper = $(`[data-key="${CSS.escape(key)}"]`, el);
    const changed = store.isTextChanged(key);
    if (wrapper && wrapper.classList.contains('is-changed') !== changed) {
      // Redraw just this field (keeping the cursor) when its "not live yet" state flips.
      const input = $<HTMLInputElement>('[data-text]', wrapper);
      const position = input?.selectionStart ?? null;
      renderFields();
      const next = $<HTMLInputElement>(`[data-text="${CSS.escape(key)}"]`, el);
      next?.focus();
      if (next && position !== null) next.setSelectionRange(position, position);
    }
    const preview = $(`[data-accent-preview="${CSS.escape(key)}"]`, el);
    if (preview) setHtml(preview, accentPreview(store.text(key) || defaultText(key)));
    renderNav();
  }

  el.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.dataset.text) {
      store.setText(target.dataset.text, target.value);
      updateMarkers(target.dataset.text);
    } else if (target.dataset.phrase !== undefined) {
      const phrases = [...store.settings().ticker];
      phrases[Number(target.dataset.phrase)] = target.value;
      store.setSetting('ticker', phrases);
      store.emit('text');
      renderNav();
    }
  });

  el.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.dataset.phrase === undefined) return;
    // Blank phrases are dropped once you leave them.
    const phrases = store.settings().ticker.map((phrase) => phrase.trim());
    if (phrases.some((phrase) => !phrase)) {
      store.setSetting('ticker', phrases.filter(Boolean));
      store.emit('text');
      renderFields();
    }
  });

  el.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const groupLink = target.closest<HTMLElement>('[data-group]');
    if (groupLink) {
      event.preventDefault();
      group = TEXT_GROUPS.find((item) => item.id === groupLink.dataset.group) ?? group;
      history.replaceState(null, '', `#/text/${group.id}`);
      renderNav();
      renderFields();
      $('[data-fields]', el)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    const undo = target.closest<HTMLElement>('[data-undo-text]');
    if (undo) {
      event.preventDefault();
      store.discardText(undo.dataset.undoText!);
      renderNav();
      renderFields();
      return;
    }
    const reset = target.closest<HTMLElement>('[data-reset-text]');
    if (reset) {
      event.preventDefault();
      store.setText(reset.dataset.resetText!, '');
      renderNav();
      renderFields();
      return;
    }
    if (target.closest('[data-add-phrase]')) {
      store.setSetting('ticker', [...store.settings().ticker, '']);
      store.emit('text');
      renderFields();
      const inputs = $$<HTMLInputElement>('[data-phrase]', el);
      inputs[inputs.length - 1]?.focus();
      return;
    }
    const remove = target.closest<HTMLElement>('[data-remove-phrase]');
    if (remove) {
      const phrases = [...store.settings().ticker];
      phrases.splice(Number(remove.dataset.removePhrase), 1);
      store.setSetting('ticker', phrases);
      store.emit('text');
      renderFields();
    }
  });

  render();
  return {
    el,
    update(reason) {
      if (reason === 'load') render();
      else if (reason === 'text' && !el.contains(document.activeElement)) {
        renderNav();
        renderFields();
      }
    },
  };
}
