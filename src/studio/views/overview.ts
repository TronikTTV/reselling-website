// Overview: the Studio's home. Stock at a glance, what needs finishing, the home page ads,
// shortcuts and recent activity.
import { formatNumber, html, setHtml, timeAgo } from '../lib/dom.ts';
import { icon, type IconName } from '../lib/icons.ts';
import { byCategory, listed, missing, reel, stats } from '../insights.ts';
import type { Context, View } from '../shell.ts';
import { hydrateMedia, thumb, toast } from '../ui.ts';

function greeting() {
  const hour = new Date().getHours();
  return hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export function overviewView(context: Context): View {
  const { store } = context;
  const el = document.createElement('div');
  el.className = 'st-overview';

  function render() {
    const numbers = stats(store);
    const settings = store.settings();
    const attention = listed(store)
      .map((product) => ({ product, missing: missing(product) }))
      .filter((row) => row.missing.length > 0)
      .sort((a, b) => b.missing.length - a.missing.length)
      .slice(0, 6);
    const ads = reel(store);
    const categories = byCategory(store).filter((row) => row.count > 0);
    const maxCount = Math.max(1, ...categories.map((row) => row.count));
    const newest = store.productList().slice(0, 8);
    const siteAddress = store.config.site.replace(/^https?:\/\//, '').replace(/\/$/, '');

    const statCards: { label: string; value: string; note?: string; icon: IconName; href: string; tone?: string }[] = [
      { label: 'Live on the site', value: formatNumber(numbers.live), note: numbers.addedThisWeek ? `+${numbers.addedThisWeek} this week` : undefined, icon: 'box', href: '#/products' },
      { label: 'Available', value: formatNumber(numbers.available), icon: 'bag', href: '#/products?status=available', tone: 'ok' },
      { label: 'Reserved', value: formatNumber(numbers.reserved), icon: 'clock', href: '#/products?status=reserved', tone: 'warn' },
      { label: 'Sold', value: formatNumber(numbers.sold), note: numbers.soldValue ? `${store.formatPrice(numbers.soldValue)} total` : undefined, icon: 'sold', href: '#/products?status=sold', tone: 'sold' },
      { label: 'Stock value', value: store.formatPrice(numbers.stockValue) || store.formatPrice(0), note: `${formatNumber(numbers.pricedUnsold)} priced, unsold`, icon: 'pound', href: '#/products?status=available' },
      { label: 'Drafts', value: formatNumber(numbers.drafts), note: 'Hidden from the site', icon: 'draft', href: '#/products?status=draft' },
    ];

    setHtml(
      el,
      html`
        <header class="st-hero">
          <div class="st-hero__glow" aria-hidden="true"></div>
          <p class="st-eyebrow">${icon('spark', 14)} ${greeting()}${store.account?.login && store.account.login !== 'This PC' ? `, ${store.account.login}` : ''}</p>
          <h1 class="st-hero__title">${settings.siteName || 'Your store'}, <em>at a glance.</em></h1>
          <p class="st-hero__sub">
            <a href="${store.siteUrl('/')}" target="_blank" rel="noopener">${siteAddress} ${icon('arrow-up-right', 14)}</a>
            ${store.snapshot?.date ? html`<span>· Last saved ${timeAgo(store.snapshot.date)}</span>` : ''}
          </p>
          <div class="st-hero__actions">
            <a class="st-btn st-btn--primary" href="#/products/new">${icon('plus', 17)} Add a product</a>
            <a class="st-btn st-btn--glass" href="#/live">${icon('wand', 17)} Edit your site live</a>
            <button type="button" class="st-btn st-btn--ghost" data-share>${icon('share', 16)} Share store</button>
          </div>
        </header>

        <section class="st-stats" aria-label="Stock">
          ${statCards.map(
            (card, index) => html`
              <a class="st-stat ${card.tone ? `st-stat--${card.tone}` : ''}" href="${card.href}" style="--i:${index}">
                <span class="st-stat__icon">${icon(card.icon, 18)}</span>
                <span class="st-stat__value">${card.value}</span>
                <span class="st-stat__label">${card.label}</span>
                ${card.note ? html`<span class="st-stat__note">${card.note}</span>` : ''}
              </a>
            `,
          )}
        </section>

        <div class="st-columns">
          <div class="st-stack">
            <section class="st-card">
              <header class="st-card__head">
                <div>
                  <h2 class="st-card__title">${icon('alert', 18)} Needs attention</h2>
                  <p class="st-card__sub">Unsold pieces missing something buyers look for.</p>
                </div>
                ${numbers.attention > 0 ? html`<a class="st-link" href="#/products?status=attention">See all ${numbers.attention}</a>` : ''}
              </header>
              ${
                attention.length === 0
                  ? html`<div class="st-empty st-empty--small">${icon('check', 22)}<p>Every unsold piece has photos, a price, a size and a brand. Nice.</p></div>`
                  : html`<ul class="st-list">
                      ${attention.map(
                        ({ product, missing: gaps }) => html`
                          <li>
                            <a class="st-list__row" href="#/products/${encodeURIComponent(product.id)}">
                              <span class="st-list__thumb">${thumb(product, product.data.images[0])}</span>
                              <span class="st-list__text">
                                <strong>${product.data.title || 'Untitled'}</strong>
                                <span class="st-chips">${gaps.map((gap) => html`<span class="st-chip st-chip--warn">${gap}</span>`)}</span>
                              </span>
                              <span class="st-list__go">Fix ${icon('chevron-right', 15)}</span>
                            </a>
                          </li>
                        `,
                      )}
                    </ul>`
              }
            </section>

            <section class="st-card">
              <header class="st-card__head">
                <div>
                  <h2 class="st-card__title">${icon('video', 18)} Ads at the top of your home page</h2>
                  <p class="st-card__sub">Your featured pieces play like stories. Ones with a video go first.</p>
                </div>
                <a class="st-link" href="#/products?status=featured">Manage</a>
              </header>
              ${
                ads.length === 0
                  ? html`<div class="st-empty st-empty--small">${icon('video', 22)}<p>Add products with photos to fill the ads.</p></div>`
                  : html`<div class="st-reel">
                      ${ads.map(
                        (product, index) => html`
                          <a class="st-reel__item" href="#/products/${encodeURIComponent(product.id)}" style="--i:${index}">
                            ${thumb(product, product.data.images[0])}
                            <span class="st-reel__num">${index + 1}</span>
                            ${
                              product.data.video
                                ? html`<span class="st-reel__badge st-reel__badge--video">${icon('play', 12)} Video</span>`
                                : product.data.featured
                                  ? html`<span class="st-reel__badge">Photo</span>`
                                  : html`<span class="st-reel__badge st-reel__badge--auto">Newest</span>`
                            }
                            <span class="st-reel__title">${product.data.title}</span>
                          </a>
                        `,
                      )}
                    </div>
                    <p class="st-hint">${icon('info', 14)} Switch on <strong>Feature on the home page</strong> in a product and add a short video to make it play here.</p>`
              }
            </section>

            <section class="st-card">
              <header class="st-card__head">
                <div>
                  <h2 class="st-card__title">${icon('spark', 18)} Latest pieces</h2>
                  <p class="st-card__sub">The newest things in your store.</p>
                </div>
                <a class="st-link" href="#/products">All products</a>
              </header>
              <div class="st-shelf">
                ${newest.map(
                  (product) => html`
                    <a class="st-shelf__item" href="#/products/${encodeURIComponent(product.id)}">
                      <span class="st-shelf__media">${thumb(product, product.data.images[0])}
                        ${product.data.draft ? html`<span class="st-pill st-pill--draft">Draft</span>` : product.data.status !== 'available' ? html`<span class="st-pill st-pill--${product.data.status}">${product.data.status}</span>` : ''}
                      </span>
                      <span class="st-shelf__title">${product.data.title || 'Untitled'}</span>
                      <span class="st-shelf__price">${store.formatPrice(product.data.price) || 'Ask for price'}</span>
                    </a>
                  `,
                )}
                <a class="st-shelf__item st-shelf__add" href="#/products/new">
                  <span class="st-shelf__media">${icon('plus', 26)}</span>
                  <span class="st-shelf__title">Add a product</span>
                </a>
              </div>
            </section>
          </div>

          <div class="st-stack">
            <section class="st-card">
              <h2 class="st-card__title">${icon('wand', 18)} Quick edits</h2>
              <div class="st-quick">
                <a class="st-quick__item" href="#/live?key=${encodeURIComponent('site:heroHeading')}">${icon('text', 18)}<span>Change the headline</span></a>
                <a class="st-quick__item" href="#/live?key=${encodeURIComponent('site:ticker')}">${icon('arrow-right', 18)}<span>Edit the scrolling ticker</span></a>
                <a class="st-quick__item" href="#/text/header">${icon('info', 18)}<span>Add an announcement bar</span></a>
                <a class="st-quick__item" href="#/products?status=featured">${icon('video', 18)}<span>Upload an ad video</span></a>
                <a class="st-quick__item" href="#/categories">${icon('categories', 18)}<span>Organise categories</span></a>
                <a class="st-quick__item" href="#/settings">${icon('instagram', 18)}<span>Contact details</span></a>
              </div>
            </section>

            <section class="st-card">
              <h2 class="st-card__title">${icon('categories', 18)} By category</h2>
              ${
                categories.length === 0
                  ? html`<p class="st-muted">No products yet.</p>`
                  : html`<ul class="st-bars">
                      ${categories.map(
                        (row) => html`
                          <li class="st-bars__row">
                            <a href="#/products?category=${encodeURIComponent(row.slug || 'other')}">
                              <span class="st-bars__label">${row.name}</span>
                              <span class="st-bars__count">${row.count}</span>
                              <span class="st-bars__track"><span class="st-bars__fill" style="--w:${(row.count / maxCount) * 100}%"></span></span>
                            </a>
                          </li>
                        `,
                      )}
                    </ul>`
              }
            </section>

            <section class="st-card">
              <h2 class="st-card__title">${icon('clock', 18)} Recent activity</h2>
              ${
                store.activity.length === 0
                  ? html`<p class="st-muted">${store.backend.kind === 'local' ? 'Changes on this PC show up here once they are committed.' : 'Loading…'}</p>`
                  : html`<ol class="st-activity">
                      ${store.activity.slice(0, 8).map(
                        (item) => html`
                          <li>
                            <span class="st-activity__dot" aria-hidden="true"></span>
                            <span class="st-activity__text">${item.message.split('\n')[0]}</span>
                            <span class="st-activity__time">${timeAgo(item.date)}</span>
                          </li>
                        `,
                      )}
                    </ol>`
              }
            </section>
          </div>
        </div>
      `,
    );
    hydrateMedia(store, el);
  }

  el.addEventListener('click', async (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-share]')) return;
    const url = store.config.site;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: store.settings().siteName, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast('Link copied. Paste it anywhere to share your store.', { tone: 'ok' });
    } catch {
      // Share sheet closed.
    }
  });

  render();
  return {
    el,
    update(reason) {
      if (reason !== 'publish') render();
    },
  };
}
