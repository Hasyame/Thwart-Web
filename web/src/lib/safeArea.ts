/**
 * Deciding whether the bottom safe-area inset is telling the truth.
 *
 * # The problem
 *
 * `env(safe-area-inset-bottom)` is supposed to say how much of the page the
 * system draws over — a home indicator, a gesture bar, the three navigation
 * buttons. Firefox and Chrome on Android report it while *also* ending the page
 * above the navigation bar, so the space is reserved twice: once by the
 * browser, which never gave us those pixels, and once by us, padding for a bar
 * that was never over our content.
 *
 * On a Pixel that is 48.3px of dead strip inside a tab bar that should be 55px
 * tall and comes out at 103px. Measured, not inferred: a probe pinned to
 * `bottom: 0` is plainly visible above the navigation buttons, which cannot
 * happen if the page runs underneath them.
 *
 * # The rule
 *
 * The inset is a lie when the browser window itself stops short of the screen
 * by more than the inset. `outerHeight` is the window including its own
 * toolbar, so `screen.height - outerHeight` is everything the system keeps
 * outside the window — the status bar, plus the navigation bar when the window
 * does not extend under it. If that figure comfortably exceeds the inset, the
 * navigation bar is already outside our pixels and padding for it is padding
 * twice.
 *
 * # Why it is safe
 *
 * It can only ever *remove* padding, and only against positive evidence:
 *
 * - `--safe-bottom` defaults to `env(safe-area-inset-bottom)` in the
 *   stylesheet, so no JavaScript, an old browser, or this file throwing all
 *   leave the layout exactly as it was.
 * - `outerHeight` is meaningless on several mobile browsers, which report it
 *   equal to `innerHeight`. That is treated as "cannot tell", not as evidence.
 *   iOS Safari is in this group, which is the one place the inset genuinely
 *   matters, and it keeps its padding.
 * - A window that really does run the full height of the screen leaves nothing
 *   outside it, the comparison fails, and the inset is kept.
 *
 * So the failure mode is the old behaviour, never a tab bar under a system bar.
 */

/** How much bigger the outside chrome must be than the inset to count. */
const MARGIN = 1.5;

/**
 * Whether `outerHeight` carries any information on this browser.
 *
 * Several mobile browsers report it equal to `innerHeight`, which would make
 * `screen.height - outerHeight` look like a large gap on a window that has no
 * gap at all — evidence for exactly the wrong conclusion. Requiring the window
 * to be genuinely taller than its content area is what rules that out: it can
 * only be true where the number means something.
 */
function outerHeightIsMeaningful(): boolean {
  return window.outerHeight > window.innerHeight + 1;
}

/**
 * Whether the bottom inset is reserving space the browser already withheld.
 *
 * Exported for the tests, which is the only reason it is not a closure.
 */
export function insetIsDoubled(inset: number): boolean {
  if (inset <= 0 || !outerHeightIsMeaningful()) {
    return false;
  }
  const outsideTheWindow = window.screen.height - window.outerHeight;
  return outsideTheWindow >= inset * MARGIN;
}

/**
 * Reads an `env()` value, which cannot be read any other way.
 *
 * There is no API for it: the only way to find out what one came to is to give
 * a real element a length that depends on it and ask what it measured.
 */
function measureInsetBottom(): number {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;left:0;bottom:0;width:0;visibility:hidden;pointer-events:none;' +
    'height:env(safe-area-inset-bottom)';
  document.body.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height;
}

/**
 * What one measurement says: the inset is doubled, it is not, or the browser
 * cannot tell (outerHeight carries nothing).
 */
export type InsetVerdict = 'doubled' | 'kept' | 'unknown';

export function verdictFor(inset: number): InsetVerdict {
  if (inset <= 0) {
    return 'kept';
  }
  if (!outerHeightIsMeaningful()) {
    return 'unknown';
  }
  return insetIsDoubled(inset) ? 'doubled' : 'kept';
}

/**
 * The verdict to apply, given this measurement and the last confident one.
 *
 * Chrome on Android hides its toolbar as the page scrolls down and shows it
 * again on the way up, and each time the window resizes. With the toolbar
 * hidden `outerHeight` equals `innerHeight` and says nothing; treating that
 * as "keep the inset" put the padding back on every scroll up and took it
 * off on every scroll down — a tab bar that doubled in height under the
 * thumb. An "unknown" reading never overturns a confident one; only a
 * confident reading does, and rotating the phone starts over.
 */
export function decide(current: InsetVerdict, previous: InsetVerdict | null): InsetVerdict {
  if (current !== 'unknown') {
    return current;
  }
  return previous ?? 'unknown';
}

let previous: InsetVerdict | null = null;

function apply(): void {
  try {
    const verdict = decide(verdictFor(measureInsetBottom()), previous);
    if (verdict !== 'unknown') {
      previous = verdict;
    }
    if (verdict === 'doubled') {
      document.documentElement.style.setProperty('--safe-bottom', '0px');
    } else {
      // Back to the stylesheet's own value rather than to a number of our own:
      // the situation can change under us when Android switches between
      // gesture and button navigation.
      document.documentElement.style.removeProperty('--safe-bottom');
    }
  } catch {
    // Whatever went wrong, the stylesheet default is already correct.
    document.documentElement.style.removeProperty('--safe-bottom');
  }
}

/** A rotation changes which edge the system bar is on: the memory starts over. */
function reset(): void {
  previous = null;
  apply();
}

/**
 * Starts watching, and returns the teardown.
 *
 * Re-runs on the events that can change the answer: rotating the phone swaps
 * which edge the system bar is on, and Android can switch between gesture and
 * button navigation while the page is open.
 */
export function watchSafeArea(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => undefined;
  }

  apply();

  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', reset);
  window.visualViewport?.addEventListener('resize', apply);

  return () => {
    window.removeEventListener('resize', apply);
    window.removeEventListener('orientationchange', reset);
    window.visualViewport?.removeEventListener('resize', apply);
  };
}
