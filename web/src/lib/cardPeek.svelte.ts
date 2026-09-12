/**
 * A card shown under the pointer, without a click.
 *
 * What MarvelCDB does when you rest the mouse on a name: the card's picture
 * and its rules beside it, gone when the pointer leaves. A hint, not a
 * destination -- the click still opens the card window, where the card can
 * be read with both hands.
 *
 * Pointer devices only. A finger has no hover: the first touch would open a
 * panel that the same touch was meant to click through, and a panel that
 * needs a second tap to dismiss is worse than none. `(hover: hover)` is the
 * media query that says whether the primary input can hover at all, and it
 * is consulted at each show rather than once, because a laptop with a
 * touchscreen answers differently depending on what was used last.
 *
 * One at a time, as a singleton: a panel per row would be a panel per row.
 */

export interface PeekAnchor {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export const peek = $state<{ code: string | null; anchor: PeekAnchor | null }>({ code: null, anchor: null });

let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function canHover(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;
}

/** Shows the card for an element, if this device hovers. */
export function showPeek(code: string, element: Element): void {
  if (!canHover()) {
    return;
  }
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  const box = element.getBoundingClientRect();
  peek.code = code;
  peek.anchor = { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
}

/**
 * Hides it, a moment later.
 *
 * Moving from one row to the next passes through a gap where nothing is
 * hovered; hiding on the instant would blink the panel off and on between
 * every pair of rows. A short grace, cancelled by the next show, keeps the
 * panel steady while the pointer walks down a list.
 */
export function hidePeek(): void {
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
  }
  hideTimer = setTimeout(() => {
    peek.code = null;
    peek.anchor = null;
    hideTimer = null;
  }, 80);
}
