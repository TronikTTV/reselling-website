// Tiny helpers for building the Studio's screens without a framework.
//
// html`…` builds markup from a template, escaping every value unless it's wrapped in raw() or is
// itself html`…`, so product names and other text can never inject markup.

export class Markup {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);

/** Trusted markup (icons, already-escaped HTML). */
export const raw = (value: string) => new Markup(value);

function render(value: unknown): string {
  if (value instanceof Markup) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === null || value === undefined || value === false || value === true) return '';
  return escapeHtml(value);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Markup {
  let out = strings[0];
  for (let index = 0; index < values.length; index++) out += render(values[index]) + strings[index + 1];
  return new Markup(out);
}

/** Replaces an element's contents with markup. */
export function setHtml(element: Element, markup: Markup | string) {
  element.innerHTML = typeof markup === 'string' ? markup : markup.value;
}

/** Creates one element from markup. */
export function fragment(markup: Markup): HTMLElement {
  const template = document.createElement('template');
  template.innerHTML = markup.value.trim();
  return template.content.firstElementChild as HTMLElement;
}

export const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) =>
  root.querySelector<T>(selector);
export const $$ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll<T>(selector));

/**
 * Listens for clicks (or another event) on elements with data-action="name" inside root, and calls
 * the matching handler with the element.
 */
export function actions<E extends Event = MouseEvent>(
  root: HTMLElement,
  handlers: Record<string, (element: HTMLElement, event: E) => void>,
  type = 'click',
) {
  const listener = (event: Event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null;
    if (!target || !root.contains(target)) return;
    const handler = handlers[target.dataset.action ?? ''];
    if (!handler) return;
    handler(target, event as E);
  };
  root.addEventListener(type, listener);
  return () => root.removeEventListener(type, listener);
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** "£1,234" style number with thousands separators. */
export const formatNumber = (value: number) => value.toLocaleString('en-GB');

/** "just now", "5 min ago", "3 hours ago", "2 days ago", then the date. */
export function timeAgo(date: Date | string | number | undefined): string {
  if (date === undefined) return '';
  const time = new Date(date).getTime();
  if (!Number.isFinite(time)) return '';
  const seconds = Math.round((Date.now() - time) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined });
}

export const pluralise = (count: number, word: string, plural = `${word}s`) =>
  `${formatNumber(count)} ${count === 1 ? word : plural}`;

/** Waits for the next frame (twice, so a style change is painted before the next one). */
export const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Calls fn at most once per `ms`, with the latest arguments. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: number | undefined;
  return (...args: A) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}
