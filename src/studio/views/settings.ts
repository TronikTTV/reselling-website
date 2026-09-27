// Settings: store name, currency, sold items, contact details, and the admin key.
import { $, html, setHtml } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import type { Context, View } from '../shell.ts';
import { confirmDialog, toast } from '../ui.ts';

const CURRENCIES = [
  ['GBP', '£ Pound (GBP)'],
  ['EUR', '€ Euro (EUR)'],
  ['USD', '$ US Dollar (USD)'],
  ['CAD', '$ Canadian Dollar (CAD)'],
  ['AUD', '$ Australian Dollar (AUD)'],
];

const handle = (value: string) => (value.replace(/[?#].*$/, '').split('/').filter(Boolean).pop() ?? '').replace(/^@/, '');

export function settingsView(context: Context): View {
  const { store } = context;
  const el = document.createElement('div');
  el.className = 'st-settings';

  function contactPreview() {
    const { contact } = store.settings();
    const links = [
      contact.instagram && { icon: 'instagram' as const, label: `DMs open on instagram.com/${handle(contact.instagram)}` },
      contact.whatsapp && { icon: 'whatsapp' as const, label: `WhatsApp chat with ${contact.whatsapp}` },
      contact.snapchat && { icon: 'arrow-up-right' as const, label: `Snapchat: ${handle(contact.snapchat)}` },
      contact.tiktok && { icon: 'arrow-up-right' as const, label: `TikTok: @${handle(contact.tiktok)}` },
      contact.email && { icon: 'mail' as const, label: `Email: ${contact.email}` },
    ].filter((link): link is { icon: 'instagram' | 'whatsapp' | 'arrow-up-right' | 'mail'; label: string } => Boolean(link));
    return links.length
      ? html`<ul class="st-contact-preview">${links.map((link) => html`<li>${icon(link.icon, 16)} ${link.label}</li>`)}</ul>`
      : html`<p class="st-hint st-hint--warn">${icon('alert', 14)} Add at least one way to reach you, or shoppers can't message you about a piece.</p>`;
  }

  function render() {
    const settings = store.settings();
    const account = store.account;
    const local = store.backend.kind === 'local';
    setHtml(
      el,
      html`
        <header class="st-page-head">
          <div>
            <p class="st-eyebrow">${icon('settings', 14)} Your store</p>
            <h1 class="st-title">Settings</h1>
            <p class="st-subtitle">Store details, how people reach you, and your admin key.</p>
          </div>
        </header>

        <div class="st-columns st-columns--even">
          <div class="st-stack">
            <section class="st-card">
              <h2 class="st-card__title">${icon('bag', 18)} Store</h2>
              <label class="st-field">
                <span class="st-field__label">Store name</span>
                <input class="st-input st-input--lg" data-setting="siteName" value="${settings.siteName}" autocomplete="off" />
                <span class="st-field__hint">In the header, footer, browser tab and link previews.</span>
              </label>
              <label class="st-field">
                <span class="st-field__label">Currency</span>
                <span class="st-select st-select--block">
                  <select data-setting="currency">
                    ${CURRENCIES.map(([value, label]) => html`<option value="${value}" ${settings.currency === value ? 'selected' : ''}>${label}</option>`)}
                  </select>
                  ${icon('chevron-down', 14)}
                </span>
              </label>
              <label class="st-toggle">
                <input type="checkbox" data-setting="hideSoldItems" ${settings.hideSoldItems ? 'checked' : ''} />
                <span class="st-toggle__switch" aria-hidden="true"></span>
                <span class="st-toggle__text"><strong>Hide sold pieces from the shop</strong><small>When off, sold pieces stay up with a SOLD badge (good for showing what you've shifted).</small></span>
              </label>
              <a class="st-link" href="#/text">${icon('text', 15)} Headline, tagline, ticker and other wording are in Site text</a>
            </section>

            <section class="st-card">
              <h2 class="st-card__title">${icon('instagram', 18)} How people reach you</h2>
              <p class="st-card__sub">These become the DM buttons on every product. The first one filled in is the main "DM to cop" button.</p>
              <div class="st-grid-2">
                <label class="st-field">
                  <span class="st-field__label">${icon('instagram', 14)} Instagram username</span>
                  <input class="st-input" data-setting="contact.instagram" value="${settings.contact.instagram}" placeholder="yourname" autocomplete="off" />
                </label>
                <label class="st-field">
                  <span class="st-field__label">${icon('whatsapp', 14)} WhatsApp number</span>
                  <input class="st-input" data-setting="contact.whatsapp" value="${settings.contact.whatsapp}" placeholder="07700 900123" inputmode="tel" autocomplete="off" />
                </label>
                <label class="st-field">
                  <span class="st-field__label">Snapchat username</span>
                  <input class="st-input" data-setting="contact.snapchat" value="${settings.contact.snapchat}" autocomplete="off" />
                </label>
                <label class="st-field">
                  <span class="st-field__label">TikTok username</span>
                  <input class="st-input" data-setting="contact.tiktok" value="${settings.contact.tiktok}" autocomplete="off" />
                </label>
                <label class="st-field st-grid-2__wide">
                  <span class="st-field__label">${icon('mail', 14)} Email address</span>
                  <input class="st-input" type="email" data-setting="contact.email" value="${settings.contact.email}" autocomplete="off" />
                </label>
              </div>
              <div data-contact-preview>${contactPreview()}</div>
            </section>
          </div>

          <div class="st-stack">
            <section class="st-card">
              <h2 class="st-card__title">${icon('key', 18)} ${local ? 'Working on this PC' : 'Your admin key'}</h2>
              ${
                local
                  ? html`<p class="st-card__sub">You're editing the files in the website folder directly. Nothing goes live until the folder is uploaded to GitHub.</p>`
                  : html`
                      <div class="st-account-card">
                        ${account?.avatar ? html`<img src="${account.avatar}" alt="" width="44" height="44" />` : html`<span class="st-account-card__icon">${icon('key', 20)}</span>`}
                        <p><strong>Signed in${account?.login ? ` as ${account.login}` : ''}</strong><small>Saving to ${store.config.repo} · ${store.config.branch}</small></p>
                      </div>
                      <p class="st-card__sub">Your admin key works like a password. This device remembers it until you sign out. Lost it, or worried someone else has it? Delete it on GitHub and make a new one.</p>
                    `
              }
              <div class="st-row">
                ${local ? '' : html`<a class="st-btn st-btn--ghost st-btn--sm" href="${store.config.keyUrl}" target="_blank" rel="noopener">${icon('key', 15)} Make a new key</a>`}
                ${local ? '' : html`<a class="st-btn st-btn--ghost st-btn--sm" href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener">${icon('arrow-up-right', 15)} Manage keys on GitHub</a>`}
                <button type="button" class="st-btn st-btn--danger-ghost st-btn--sm" data-sign-out>${icon('logout', 15)} ${local ? 'Leave this PC mode' : 'Sign out on this device'}</button>
              </div>
            </section>

            <section class="st-card">
              <h2 class="st-card__title">${icon('help', 18)} Good to know</h2>
              <ul class="st-tips">
                <li>${icon('send', 15)} <span>Nothing changes on your site until you press <strong>Publish</strong>. Your site then updates in about a minute.</span></li>
                <li>${icon('wand', 15)} <span>The <strong>Live editor</strong> shows your real site. Click any text or photo on it to change it.</span></li>
                <li>${icon('image', 15)} <span>Photos are shrunk to 1600px and location data is removed before they're uploaded.</span></li>
                <li>${icon('video', 15)} <span>Videos: 5–15 seconds, MP4, up to 24 MB. Featured pieces with a video play first in the home page ads.</span></li>
                <li>${icon('copy', 15)} <span>Listing something similar? Open a product and press <strong>Duplicate</strong>.</span></li>
              </ul>
              <a class="st-link" href="${store.siteUrl('/admin/cms/')}">${icon('arrow-up-right', 15)} Open the classic editor</a>
            </section>
          </div>
        </div>
      `,
    );
  }

  el.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    const key = target.dataset.setting;
    if (!key || target.type === 'checkbox' || target.tagName === 'SELECT') return;
    store.setSetting(key, target.value);
    if (key.startsWith('contact.')) {
      const preview = $('[data-contact-preview]', el);
      if (preview) setHtml(preview, contactPreview());
    }
  });

  el.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    const key = target.dataset.setting;
    if (!key) return;
    if (target.type === 'checkbox') store.setSetting(key, target.checked);
    else if (target.tagName === 'SELECT') store.setSetting(key, target.value);
    else {
      target.value = target.value.trim();
      store.setSetting(key, target.value);
    }
  });

  el.addEventListener('click', async (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-sign-out]')) return;
    if (store.changes().length) {
      const ok = await confirmDialog({
        title: 'Sign out with unpublished changes?',
        body: "They'll be lost. Publish them first if you want to keep them.",
        confirm: 'Sign out anyway',
        danger: true,
      });
      if (!ok) return;
    }
    toast('Signed out.', { tone: 'info' });
    context.signOut();
  });

  render();
  return {
    el,
    update(reason) {
      if (!el.contains(document.activeElement) && (reason === 'load' || reason === 'settings')) render();
    },
  };
}
