// The Studio's frame: sidebar (tab bar on phones), page switching, the "Publish changes" bar and the
// live-site status. Each page ("view") lives in src/studio/views/.
import { $, $$, actions, fragment, html, nextFrame, pluralise, setHtml, sleep, timeAgo } from './lib/dom.ts';
import { icon, type IconName } from './lib/icons.ts';
import { StudioError } from './lib/backend.ts';
import type { Reason, Store } from './store.ts';
import { busy, confirmDialog, errorMessage, hydrateMedia, openSheet, thumb, toast } from './ui.ts';
import { addPhotosView } from './views/add-photos.ts';
import { categoriesView } from './views/categories.ts';
import { liveView } from './views/live.ts';
import { overviewView } from './views/overview.ts';
import { productEditorView } from './views/product-editor.ts';
import { productsView } from './views/products.ts';
import { settingsView } from './views/settings.ts';
import { textView } from './views/text.ts';

export interface View {
  el: HTMLElement;
  /** Called whenever the store changes. */
  update?(reason: Reason): void;
  destroy?(): void;
  /** Uses the whole screen (the live editor). */
  wide?: boolean;
}

export interface Route {
  name: string;
  /** Path parts after the page name, e.g. ["abc"] for #/products/abc. */
  parts: string[];
  query: URLSearchParams;
}

export interface Context {
  store: Store;
  route: Route;
  navigate(hash: string, options?: { replace?: boolean }): void;
  publish(): Promise<void>;
  signOut(): void;
}

type ViewFactory = (context: Context) => View;

const VIEWS: Record<string, ViewFactory> = {
  overview: overviewView,
  live: liveView,
  products: (context) => (context.route.parts[0] ? productEditorView(context) : productsView(context)),
  add: addPhotosView,
  text: textView,
  categories: categoriesView,
  settings: settingsView,
};

const NAV: { route: string; label: string; icon: IconName; hint?: string }[] = [
  { route: 'overview', label: 'Overview', icon: 'overview' },
  { route: 'live', label: 'Live editor', icon: 'live', hint: 'Click and edit your actual site' },
  { route: 'products', label: 'Products', icon: 'products' },
  { route: 'add', label: 'Add from photos', icon: 'sparkles', hint: 'Photos in, listings out' },
  { route: 'text', label: 'Site text', icon: 'text' },
  { route: 'categories', label: 'Categories', icon: 'categories' },
  { route: 'settings', label: 'Settings', icon: 'settings' },
];

const TABS = ['overview', 'products', 'live', 'text'];
const JUST_SAVED = 'central-supply.studio.just-saved';

export function parseRoute(hash = location.hash): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  const name = parts.shift() || 'overview';
  return { name: VIEWS[name] ? name : 'overview', parts, query: new URLSearchParams(query) };
}

export function mountShell(root: HTMLElement, store: Store, signOut: () => void) {
  const siteName = () => store.settings().siteName || store.config.siteName || 'Your store';

  setHtml(
    root,
    html`
      <div class="st-app" data-app>
        <aside class="st-side" aria-label="Studio">
          <a class="st-brand" href="#/">
            <span class="st-brand__mark">${icon('spark', 18)}</span>
            <span class="st-brand__text"><strong data-site-name></strong><em>Studio</em></span>
          </a>
          <nav class="st-nav" aria-label="Sections">
            ${NAV.map(
              (item) => html`
                <a class="st-nav__link" href="#/${item.route === 'overview' ? '' : item.route}" data-nav="${item.route}" title="${item.hint ?? item.label}">
                  ${icon(item.icon, 19)}
                  <span>${item.label}</span>
                  ${item.route === 'live' ? html`<span class="st-nav__badge">Visual</span>` : ''}
                  ${item.route === 'add' ? html`<span class="st-nav__badge">AI</span>` : ''}
                  <span class="st-nav__count" data-nav-count="${item.route}"></span>
                </a>
              `,
            )}
          </nav>
          <div class="st-side__foot">
            <button type="button" class="st-status" data-action="status" data-status></button>
            <a class="st-side__link" href="${store.siteUrl('/')}" target="_blank" rel="noopener">${icon('arrow-up-right', 16)} View your site</a>
            <div class="st-account" data-account></div>
          </div>
        </aside>

        <header class="st-top">
          <a class="st-brand st-brand--small" href="#/">
            <span class="st-brand__mark">${icon('spark', 16)}</span>
            <span class="st-brand__text"><strong data-site-name></strong><em>Studio</em></span>
          </a>
          <button type="button" class="st-status st-status--compact" data-action="status" data-status></button>
        </header>

        <main class="st-main" id="studio-main">
          <div class="st-view" data-view></div>
        </main>

        <nav class="st-tabs" aria-label="Sections">
          ${TABS.map((route) => {
            const item = NAV.find((entry) => entry.route === route)!;
            return html`<a class="st-tab" href="#/${route === 'overview' ? '' : route}" data-nav="${route}">${icon(item.icon, 22)}<span>${route === 'live' ? 'Live' : route === 'text' ? 'Text' : item.label}</span></a>`;
          })}
          <button type="button" class="st-tab" data-action="more">${icon('menu', 22)}<span>More</span></button>
        </nav>

        <div class="st-publish" data-publish hidden></div>
      </div>
    `,
  );

  const app = $('[data-app]', root)!;
  const viewHost = $('[data-view]', root)!;
  const publishBar = $('[data-publish]', root)!;
  let current: View | undefined;
  let route = parseRoute();
  let shownHash = '';

  const context: Context = {
    store,
    get route() {
      return route;
    },
    navigate(hash, options) {
      if (options?.replace) history.replaceState(null, '', hash);
      else if (location.hash !== hash) history.pushState(null, '', hash);
      show();
    },
    publish,
    signOut,
  };

  // ---------------------------------------------------------------- pages

  async function show() {
    const next = parseRoute();
    const sameView = current && location.hash === shownHash;
    shownHash = location.hash;
    route = next;
    $$('[data-nav]', root).forEach((link) => link.classList.toggle('is-active', link.dataset.nav === route.name));
    if (sameView && current?.update) {
      current.update('load');
      return;
    }
    current?.destroy?.();
    const view = VIEWS[route.name](context);
    current = view;
    app.classList.toggle('is-wide', Boolean(view.wide));
    view.el.classList.add('st-page', 'is-entering');
    viewHost.replaceChildren(view.el);
    hydrateMedia(store, view.el);
    if (!view.wide) window.scrollTo({ top: 0 });
    // (A background tab may never draw a frame: don't leave the page invisible.)
    await Promise.race([nextFrame(), sleep(120)]);
    view.el.classList.remove('is-entering');
  }

  // (Changing the address fires popstate too; hashchange alone covers links and back/forward.)
  window.addEventListener('hashchange', show);

  // ---------------------------------------------------------------- live status

  let wasUpdating = store.deployState() === 'updating';
  let statusTimer: number | undefined;

  function renderStatus() {
    const state = store.deployState();
    const labels = {
      live: { text: 'Live', sub: 'Your site is up to date' },
      updating: { text: 'Going live…', sub: `Updating your site · ${elapsed()}` },
      stuck: { text: 'Not live yet', sub: 'Tap to see why' },
      local: { text: 'This PC', sub: 'Saving to the website folder' },
      unknown: { text: 'Live site', sub: 'Checking…' },
    }[state];
    $$('[data-status]', root).forEach((button) => {
      button.className = `st-status st-status--${state}${button.classList.contains('st-status--compact') ? ' st-status--compact' : ''}`;
      setHtml(button, html`<span class="st-status__dot" aria-hidden="true"></span><span class="st-status__text"><strong>${labels.text}</strong><small>${labels.sub}</small></span>`);
      button.title = labels.sub;
    });
  }

  function elapsed() {
    const since = store.savedAt || new Date(store.snapshot?.date ?? Date.now()).getTime();
    const seconds = Math.max(0, Math.round((Date.now() - since) / 1000));
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
  }

  function schedulePoll() {
    window.clearTimeout(statusTimer);
    const state = store.deployState();
    if (state === 'local') return;
    const delay = state === 'updating' ? 6000 : state === 'stuck' ? 30000 : 120000;
    statusTimer = window.setTimeout(async () => {
      if (!document.hidden) await store.refreshDeploy();
      renderStatus();
      schedulePoll();
    }, delay);
  }

  // Keep the "Going live… 0m 42s" timer ticking.
  window.setInterval(() => {
    if (store.deployState() === 'updating') renderStatus();
  }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) store.refreshDeploy().then(renderStatus);
  });

  function showStatusSheet() {
    const state = store.deployState();
    const deployed = store.deployed;
    const sheet = openSheet({
      title: 'Your live site',
      content: html`
        <div class="st-status-sheet">
          <p class="st-status-sheet__state st-status--${state}"><span class="st-status__dot"></span>${
            {
              live: 'Live and up to date',
              updating: 'Your latest changes are going live',
              stuck: "Your latest changes aren't live yet",
              local: 'Working on this PC',
              unknown: 'Checking the live site…',
            }[state]
          }</p>
          ${
            state === 'updating'
              ? html`<p>Cloudflare is rebuilding your site with the changes. It usually takes about a minute. You can keep working meanwhile.</p>`
              : state === 'stuck'
                ? html`<p>It's been over 10 minutes. The update may have failed, usually because something in a product couldn't be read. Open Cloudflare → Workers & Pages → <strong>central-supply</strong> → Deployments to see what happened, or try publishing again.</p>
                    <a class="st-btn st-btn--ghost" href="https://dash.cloudflare.com/" target="_blank" rel="noopener">${icon('arrow-up-right', 16)} Open Cloudflare</a>`
                : state === 'local'
                  ? html`<p>Changes are saved straight into the website folder on this PC. They go live when the folder is uploaded to GitHub (ask Claude or use GitHub Desktop).</p>`
                  : html`<p>Everything you've published is on your site.</p>`
          }
          <dl class="st-meta">
            ${deployed?.builtAt ? html`<div><dt>Last updated</dt><dd>${timeAgo(deployed.builtAt)}</dd></div>` : ''}
            ${store.snapshot?.date ? html`<div><dt>Last saved</dt><dd>${timeAgo(store.snapshot.date)}</dd></div>` : ''}
          </dl>
          <div class="st-row">
            <a class="st-btn st-btn--primary" href="${store.siteUrl('/')}" target="_blank" rel="noopener">${icon('arrow-up-right', 16)} View your site</a>
            <button type="button" class="st-btn st-btn--ghost" data-check>${icon('refresh', 16)} Check again</button>
          </div>
        </div>
      `,
    });
    sheet.el.querySelector('[data-check]')?.addEventListener('click', async () => {
      await store.refreshDeploy();
      renderStatus();
      sheet.close();
      showStatusSheet();
    });
  }

  // ---------------------------------------------------------------- publishing

  function renderPublishBar() {
    const changes = store.changes();
    const visible = changes.length > 0 || store.publishing;
    publishBar.hidden = !visible;
    app.classList.toggle('has-publish', visible);
    if (!visible) return;
    setHtml(
      publishBar,
      html`
        <div class="st-publish__inner">
          <span class="st-publish__pulse" aria-hidden="true"></span>
          <p class="st-publish__text">
            <strong>${pluralise(changes.length, 'change')} not live yet</strong>
            <small>${changes.slice(0, 2).map((change) => change.title).join(' · ')}${changes.length > 2 ? ` +${changes.length - 2}` : ''}</small>
          </p>
          <button type="button" class="st-btn st-btn--ghost st-btn--sm" data-action="review">Review</button>
          <button type="button" class="st-btn st-btn--primary st-btn--sm" data-action="publish" ${store.publishing ? 'disabled' : ''}>
            ${icon('send', 16)} Publish
          </button>
        </div>
      `,
    );
  }

  async function publish() {
    if (store.publishing) return;
    const problems = store.problems();
    if (problems.length > 0) {
      toast(problems[0], { tone: 'warn' });
      return;
    }
    const overlay = busy('Getting ready…');
    // On this PC the preview reloads the page as soon as files are saved: say "saved" after it.
    if (store.backend.kind === 'local') sessionStorage.setItem(JUST_SAVED, String(Date.now()));
    try {
      const head = await store.publish((text) => overlay.update(text));
      sessionStorage.removeItem(JUST_SAVED);
      overlay.close();
      if (!head) {
        toast('Nothing new to publish. Everything is already saved.', { tone: 'info' });
        return;
      }
      if (store.backend.kind === 'local') {
        toast('Saved to this PC.', { tone: 'ok' });
      } else {
        wasUpdating = true;
        toast('Saved! Your site updates in about a minute.', { tone: 'ok' });
        schedulePoll();
      }
      renderStatus();
    } catch (error) {
      overlay.close();
      sessionStorage.removeItem(JUST_SAVED);
      if (error instanceof StudioError && error.kind === 'auth') {
        toast(error.message, { tone: 'error', action: { label: 'Sign in again', run: signOut } });
      } else {
        toast(errorMessage(error), { tone: 'error' });
      }
    }
  }

  function review() {
    const changes = store.changes();
    const sheet = openSheet({
      title: 'Changes not live yet',
      content: html`
        <p class="st-muted">Publishing saves all of these at once. Your site updates about a minute later.</p>
        <ul class="st-changes">
          ${changes.map(
            (change) => html`
              <li class="st-change">
                <span class="st-change__thumb">${change.thumb ? thumb(change.thumb.product, change.thumb.name) : icon(change.kind === 'text' ? 'text' : change.kind === 'categories' ? 'categories' : 'settings', 20)}</span>
                <span class="st-change__text"><strong>${change.title}</strong><small>${change.detail}</small></span>
                <button type="button" class="st-btn st-btn--ghost st-btn--sm" data-undo="${change.id}">${icon('undo', 15)} Undo</button>
              </li>
            `,
          )}
        </ul>
        <div class="st-row st-row--end">
          <button type="button" class="st-btn st-btn--ghost" data-discard-all>${icon('trash', 16)} Discard all</button>
          <button type="button" class="st-btn st-btn--primary" data-publish-now>${icon('send', 16)} Publish ${pluralise(changes.length, 'change')}</button>
        </div>
      `,
    });
    hydrateMedia(store, sheet.el);
    sheet.el.addEventListener('click', async (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const undo = target?.closest<HTMLElement>('[data-undo]');
      if (undo) {
        store.changes().find((change) => change.id === undo.dataset.undo)?.discard();
        undo.closest('li')?.remove();
        if (store.changes().length === 0) sheet.close();
        return;
      }
      if (target?.closest('[data-discard-all]')) {
        const ok = await confirmDialog({
          title: 'Discard every change?',
          body: "Everything you haven't published goes back to how it is on your site.",
          confirm: 'Discard all',
          danger: true,
        });
        if (ok) {
          store.discardAll();
          sheet.close();
          toast('Changes discarded.', { tone: 'info' });
        }
        return;
      }
      if (target?.closest('[data-publish-now]')) {
        sheet.close();
        publish();
      }
    });
  }

  function more() {
    const sheet = openSheet({
      title: 'More',
      content: html`
        <nav class="st-more">
          ${NAV.filter((item) => !TABS.includes(item.route)).map(
            (item) => html`<a class="st-more__link" href="#/${item.route}">${icon(item.icon, 20)}<span>${item.label}</span>${icon('chevron-right', 16)}</a>`,
          )}
          <a class="st-more__link" href="${store.siteUrl('/')}" target="_blank" rel="noopener">${icon('arrow-up-right', 20)}<span>View your site</span>${icon('chevron-right', 16)}</a>
        </nav>
      `,
    });
    sheet.el.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('a')) sheet.close();
    });
  }

  actions(root, {
    status: () => showStatusSheet(),
    review: () => review(),
    publish: () => publish(),
    more: () => more(),
  });

  // ---------------------------------------------------------------- keeping everything in step

  function renderChrome() {
    $$('[data-site-name]', root).forEach((element) => (element.textContent = siteName()));
    document.title = `Studio · ${siteName()}`;
    const products = store.productList();
    const productCount = $('[data-nav-count="products"]', root);
    if (productCount) productCount.textContent = String(products.length);
    const account = store.account;
    const accountEl = $('[data-account]', root);
    if (accountEl) {
      setHtml(
        accountEl,
        html`
          ${account?.avatar ? html`<img class="st-account__avatar" src="${account.avatar}" alt="" width="28" height="28" />` : html`<span class="st-account__avatar">${icon('key', 15)}</span>`}
          <span class="st-account__name">${account?.login ?? 'Signed in'}</span>
          <a class="st-icon-btn st-icon-btn--sm" href="#/settings" aria-label="Settings" title="Settings">${icon('settings', 16)}</a>
        `,
      );
    }
  }

  store.subscribe((reason) => {
    renderPublishBar();
    renderChrome();
    if (reason === 'deploy' || reason === 'load') {
      const state = store.deployState();
      if (wasUpdating && state === 'live') {
        toast('Your changes are live.', {
          tone: 'ok',
          action: { label: 'View site', run: () => window.open(store.siteUrl('/'), '_blank', 'noopener') },
        });
      }
      wasUpdating = state === 'updating';
      renderStatus();
      schedulePoll();
    }
    current?.update?.(reason);
    if (current) hydrateMedia(store, current.el);
  });

  window.addEventListener('beforeunload', (event) => {
    if (store.changes().length === 0 && !store.publishing) return;
    event.preventDefault();
    event.returnValue = '';
  });

  renderChrome();
  renderStatus();
  renderPublishBar();
  schedulePoll();
  const justSaved = Number(sessionStorage.getItem(JUST_SAVED));
  sessionStorage.removeItem(JUST_SAVED);
  if (justSaved && Date.now() - justSaved < 60_000) toast('Saved to this PC.', { tone: 'ok' });
  store.refreshDeploy().then(renderStatus);
  store.loadActivity();
  show();

  return { publish };
}

/** Shows `fragment` in place of `element` with a short fade (used by views re-drawing a part). */
export function swap(element: HTMLElement, markup: ReturnType<typeof html>) {
  const next = fragment(markup);
  element.replaceWith(next);
  return next;
}
