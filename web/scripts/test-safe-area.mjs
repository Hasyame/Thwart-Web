/**
 * Whether the bottom safe-area inset is believed, and when it is not.
 *
 * The rule can only ever remove padding, so there is exactly one way for it to
 * do harm: dropping an inset that was real, which puts the tab bar's tap
 * targets underneath a home indicator or a gesture bar. Every case below that
 * ends in "keep" is guarding against that, and the single "drop" is the bug it
 * exists to fix.
 *
 *   npm run test:safe-area
 */
import { insetIsDoubled } from '../src/lib/safeArea.ts';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

/**
 * Stands a browser up around the numbers the rule reads.
 *
 * No DOM: `insetIsDoubled` takes the inset as an argument precisely so the
 * measuring and the deciding can be tested apart, and the deciding is the half
 * with the judgement in it.
 */
function browser({ screenHeight, outerHeight, innerHeight }) {
  globalThis.window = {
    outerHeight,
    innerHeight,
    screen: { height: screenHeight },
  };
}

// --- the bug this exists for -----------------------------------------------------

{
  // A Pixel on Firefox for Android, measured. The window stops 106px short of
  // the screen and the inset claims 48.3 of them, so the navigation bar is
  // already outside our pixels: padding for it pads a second time.
  browser({ screenHeight: 929, outerHeight: 823, innerHeight: 758 });
  check('drops an inset the browser already withheld', insetIsDoubled(48.3) === true,
    '929 - 823 = 106 outside the window');
}

// --- everything that must keep its padding ---------------------------------------

{
  // A window filling the screen but for the status bar: the navigation bar is
  // over our content and the inset is doing real work.
  browser({ screenHeight: 929, outerHeight: 895, innerHeight: 830 });
  check('keeps the inset when the window runs the full height', insetIsDoubled(48.3) === false,
    '929 - 895 = 34, a status bar and nothing more');
}

{
  // iOS Safari, and every other browser that reports outerHeight === innerHeight.
  // The subtraction would say 86px are outside a window that has nothing
  // outside it — evidence for exactly the wrong answer — so an outerHeight that
  // cannot be taller than its own content area is treated as no evidence.
  browser({ screenHeight: 844, outerHeight: 758, innerHeight: 758 });
  check('keeps the inset when outerHeight says nothing', insetIsDoubled(34) === false,
    'outerHeight === innerHeight');
}

{
  // The home indicator is 34px and the browser chrome above it can be tall.
  // Without the margin this would be a coin toss; with it the gap has to be
  // half again the inset before the inset is called a lie.
  browser({ screenHeight: 844, outerHeight: 800, innerHeight: 750 });
  check('keeps the inset when the gap is barely bigger than it',
    insetIsDoubled(34) === false, '844 - 800 = 44, under 34 x 1.5');
}

{
  browser({ screenHeight: 929, outerHeight: 823, innerHeight: 758 });
  check('does nothing when there is no inset to begin with', insetIsDoubled(0) === false);
  check('does nothing for a negative inset', insetIsDoubled(-5) === false);
}

{
  // A desktop window, small on a large screen. outerHeight is meaningful and
  // the gap is enormous, but the inset is zero, so there is nothing to drop.
  browser({ screenHeight: 1440, outerHeight: 900, innerHeight: 800 });
  check('a small window on a big screen changes nothing', insetIsDoubled(0) === false);
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
