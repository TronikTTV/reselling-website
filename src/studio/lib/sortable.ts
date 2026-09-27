// Drag to reorder (photos, categories, ticker phrases). With a mouse, drag straight away; on a phone,
// press and hold for a moment first, so swiping still scrolls the page.
export function sortable(
  container: HTMLElement,
  options: { item: string; onSort: (keys: string[]) => void; key?: (element: HTMLElement) => string },
) {
  const keyOf = options.key ?? ((element: HTMLElement) => element.dataset.key ?? '');
  let drag:
    | {
        element: HTMLElement;
        pointerId: number;
        startX: number;
        startY: number;
        started: boolean;
        before: string;
        timer?: number;
      }
    | undefined;

  const items = () => Array.from(container.querySelectorAll<HTMLElement>(options.item));
  const order = () => items().map(keyOf).join('\n');

  const preventScroll = (event: TouchEvent) => {
    if (drag?.started) event.preventDefault();
  };

  function begin() {
    if (!drag) return;
    drag.started = true;
    drag.element.classList.add('is-dragging');
    container.classList.add('is-sorting');
    navigator.vibrate?.(8);
  }

  function finish(cancelled: boolean) {
    if (!drag) return;
    window.clearTimeout(drag.timer);
    const { element, started, before } = drag;
    drag = undefined;
    document.removeEventListener('touchmove', preventScroll);
    if (!started) return;
    element.classList.remove('is-dragging');
    element.style.transform = '';
    container.classList.remove('is-sorting');
    // Stop the click that follows a drag from opening anything.
    const swallow = (event: Event) => {
      event.stopPropagation();
      event.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 50);
    if (!cancelled && order() !== before) options.onSort(items().map(keyOf));
  }

  container.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('button:not([data-drag]), input, select, textarea, a[href]:not([data-drag])')) return;
    const element = target.closest<HTMLElement>(options.item);
    if (!element || !container.contains(element)) return;
    drag = { element, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, started: false, before: order() };
    if (event.pointerType === 'touch') {
      document.addEventListener('touchmove', preventScroll, { passive: false });
      drag.timer = window.setTimeout(begin, 260);
    }
  });

  container.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.started) {
      if (event.pointerType === 'touch') {
        // Moving before the hold finished: it's a scroll, not a drag.
        if (Math.hypot(dx, dy) > 8) finish(true);
        return;
      }
      if (Math.hypot(dx, dy) < 6) return;
      begin();
    }
    const { element } = drag;
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Already captured.
    }
    element.style.transform = `translate(${dx}px, ${dy}px)`;

    // Move the item in the list when the pointer is over another one.
    element.style.visibility = 'hidden';
    const under = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(options.item);
    element.style.visibility = '';
    if (!under || under === element || !container.contains(under)) return;
    const list = items();
    const before = element.getBoundingClientRect();
    if (list.indexOf(under) > list.indexOf(element)) under.after(element);
    else under.before(element);
    // Keep it under the pointer now that its place has moved.
    const after = element.getBoundingClientRect();
    drag.startX += after.left - before.left;
    drag.startY += after.top - before.top;
    element.style.transform = `translate(${event.clientX - drag.startX}px, ${event.clientY - drag.startY}px)`;
  });

  container.addEventListener('pointerup', () => finish(false));
  container.addEventListener('pointercancel', () => finish(true));
  container.addEventListener('lostpointercapture', () => {
    if (drag?.started) finish(false);
  });
}
