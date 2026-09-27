// The Studio starts here: sign in with the admin key (remembered on this device), load the store,
// then show the Studio. See src/studio/shell.ts for the rest.
import { html, setHtml } from './lib/dom.ts';
import { GitHubBackend, LocalBackend, StudioError, type Backend } from './lib/backend.ts';
import { icon } from './lib/icons.ts';
import { mountShell } from './shell.ts';
import { Store, type StudioConfig } from './store.ts';
import { errorMessage } from './ui.ts';

const KEY = 'central-supply.studio.key';
const MODE = 'central-supply.studio.mode';
/** Where the classic editor (Sveltia CMS) keeps its sign-in, so one sign-in covers both. */
const CLASSIC = 'sveltia-cms.user';

const config = JSON.parse(document.getElementById('studio-config')?.textContent ?? '{}') as StudioConfig;
const root = document.getElementById('studio') as HTMLElement;

const storage = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Private browsing: the key just isn't remembered.
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing to remove.
    }
  },
};

function classicToken(): string {
  try {
    const user = JSON.parse(storage.get(CLASSIC) ?? 'null') as { backendName?: string; token?: unknown } | null;
    return user?.backendName === 'github' && typeof user.token === 'string' ? user.token : '';
  } catch {
    return '';
  }
}

const savedKey = () => storage.get(KEY) || classicToken();

function rememberKey(token: string) {
  storage.set(KEY, token);
  storage.remove(MODE);
  // Sign the classic editor in too, unless it already is.
  if (!classicToken()) storage.set(CLASSIC, JSON.stringify({ backendName: 'github', token }));
}

function signOut() {
  const token = storage.get(KEY);
  storage.remove(KEY);
  storage.remove(MODE);
  if (token && classicToken() === token) storage.remove(CLASSIC);
  history.replaceState(null, '', location.pathname);
  location.reload();
}

const github = (token: string) => new GitHubBackend(config.repo, config.branch, token);

// ---------------------------------------------------------------- screens

function loadingScreen(text: string) {
  setHtml(
    root,
    html`
      <div class="st-boot">
        <div class="st-boot__aurora" aria-hidden="true"></div>
        <span class="st-boot__mark">${icon('spark', 30)}</span>
        <p class="st-boot__name">${config.siteName} <em>Studio</em></p>
        <p class="st-boot__text" data-boot-text>${text}</p>
        <span class="st-boot__bar" aria-hidden="true"><span></span></span>
      </div>
    `,
  );
}

function setLoadingText(text: string) {
  const target = root.querySelector('[data-boot-text]');
  if (target) target.textContent = text;
}

function signInScreen(error = '') {
  const repoName = config.repo.split('/')[1] ?? config.repo;
  setHtml(
    root,
    html`
      <div class="st-signin">
        <div class="st-boot__aurora" aria-hidden="true"></div>
        <form class="st-signin__card" data-sign-in novalidate>
          <span class="st-signin__mark">${icon('spark', 26)}</span>
          <p class="st-eyebrow">${config.siteName}</p>
          <h1 class="st-signin__title">Welcome to your <em>Studio.</em></h1>
          <p class="st-signin__lead">Products, photos, videos, every word on your site, and a live editor where you click your actual site to change it.</p>

          <input type="text" name="username" value="${config.siteName} admin" autocomplete="username" hidden />
          <label class="st-field">
            <span class="st-field__label">${icon('key', 14)} Your admin key</span>
            <span class="st-keyfield">
              <input class="st-input st-input--lg" type="password" name="key" placeholder="github_pat_…" autocomplete="current-password" spellcheck="false" autocapitalize="off" required />
              <button type="button" class="st-icon-btn st-icon-btn--sm" data-reveal-key aria-label="Show key" title="Show key">${icon('eye', 17)}</button>
            </span>
          </label>
          <p class="st-signin__error" data-error role="alert" ${error ? '' : 'hidden'}>${icon('alert', 15)} <span>${error}</span></p>
          <button class="st-btn st-btn--primary st-btn--lg st-btn--block" data-submit>${icon('arrow-right', 18)} Sign in</button>

          <details class="st-signin__help">
            <summary>${icon('help', 15)} Where do I find my admin key?</summary>
            <p>It's the key you saved in your passwords or notes (it starts with <code>github_pat_</code>). Don't have one, or lost it? Make a new one in about 2 minutes:</p>
            <ol>
              <li>Tap <strong>Get my admin key</strong>. GitHub opens with everything filled in.</li>
              <li>Under <strong>Repository access</strong>, choose <strong>Only select repositories</strong> and pick <strong>${repoName}</strong>.</li>
              <li>Tap <strong>Generate token</strong>, copy the key, save it somewhere safe and paste it above.</li>
            </ol>
            <a class="st-btn st-btn--ghost st-btn--sm" href="${config.keyUrl}" target="_blank" rel="noopener">${icon('key', 15)} Get my admin key</a>
          </details>

          ${
            config.dev
              ? html`<div class="st-signin__local">
                  <p>Running on this PC?</p>
                  <button type="button" class="st-btn st-btn--glass st-btn--block" data-local>${icon('desktop', 17)} Edit this PC's files (no key needed)</button>
                </div>`
              : ''
          }
          <p class="st-signin__foot">Your key stays on this device. <a href="${config.base.replace(/\/?$/, '/')}admin/cms/">Classic editor</a></p>
        </form>
      </div>
    `,
  );

  const form = root.querySelector<HTMLFormElement>('[data-sign-in]')!;
  const input = form.querySelector<HTMLInputElement>('input[name="key"]')!;
  const errorBox = form.querySelector<HTMLElement>('[data-error]')!;
  const submit = form.querySelector<HTMLButtonElement>('[data-submit]')!;
  const showError = (message: string) => {
    errorBox.hidden = false;
    errorBox.querySelector('span')!.textContent = message;
    form.classList.remove('is-shaking');
    void form.offsetWidth;
    form.classList.add('is-shaking');
  };
  if (!matchMedia('(pointer: coarse)').matches) input.focus();

  form.querySelector('[data-reveal-key]')?.addEventListener('click', () => {
    input.type = input.type === 'password' ? 'text' : 'password';
  });
  form.querySelector('[data-local]')?.addEventListener('click', () => {
    storage.set(MODE, 'local');
    start(new LocalBackend());
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = input.value.trim().replace(/^Bearer\s+/i, '');
    if (!token) {
      showError('Paste your admin key first.');
      return;
    }
    if (/\s/.test(token) || token.length < 20) {
      showError("That doesn't look like an admin key. It's a long code starting with github_pat_.");
      return;
    }
    submit.disabled = true;
    setHtml(submit, html`<span class="st-spinner st-spinner--sm"></span> Checking…`);
    try {
      const backend = github(token);
      await backend.check();
      rememberKey(token);
      start(backend);
    } catch (error) {
      submit.disabled = false;
      setHtml(submit, html`${icon('arrow-right', 18)} Sign in`);
      showError(errorMessage(error));
    }
  });
}

function errorScreen(error: unknown, retry: () => void) {
  setHtml(
    root,
    html`
      <div class="st-boot">
        <div class="st-boot__aurora" aria-hidden="true"></div>
        <span class="st-boot__mark st-boot__mark--warn">${icon('alert', 28)}</span>
        <p class="st-boot__name">Couldn't open your store</p>
        <p class="st-boot__text">${errorMessage(error)}</p>
        <div class="st-row st-row--center">
          <button type="button" class="st-btn st-btn--primary" data-retry>${icon('refresh', 16)} Try again</button>
          <button type="button" class="st-btn st-btn--ghost" data-sign-out>${icon('logout', 16)} Sign out</button>
        </div>
      </div>
    `,
  );
  root.querySelector('[data-retry]')?.addEventListener('click', retry);
  root.querySelector('[data-sign-out]')?.addEventListener('click', signOut);
}

// ---------------------------------------------------------------- starting up

async function start(backend: Backend) {
  loadingScreen('Opening your store…');
  const store = new Store(config, backend);
  try {
    // The account (name and picture) is nice to have; a bad key is caught by loading anyway.
    const account = backend.account().catch(() => null);
    await store.load(setLoadingText);
    store.account = await account;
  } catch (error) {
    if (error instanceof StudioError && ['auth', 'missing', 'permission'].includes(error.kind) && backend.kind === 'github') {
      storage.remove(KEY);
      signInScreen(error.message);
      return;
    }
    errorScreen(error, () => start(backend));
    return;
  }
  mountShell(root, store, signOut);
  if (config.dev) (window as unknown as { studio: Store }).studio = store;
}

if (config.dev && storage.get(MODE) === 'local') start(new LocalBackend());
else if (savedKey()) start(github(savedKey()));
else signInScreen();
