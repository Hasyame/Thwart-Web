/**
 * WCAG 2.2 AA over the token file.
 *
 * The palette is the one part of the interface where "it looks fine to me" is
 * not evidence: contrast is arithmetic, and the scheme this replaced failed
 * seven pairs while looking perfectly reasonable to everyone who shipped it.
 * So the thresholds are asserted rather than trusted, in both schemes, over
 * every pairing the components actually produce.
 *
 * Thresholds, from WCAG 2.2:
 *   1.4.3 Contrast (Minimum)  — 4.5:1 for body text, 3:1 for large text
 *   1.4.11 Non-text Contrast  — 3:1 for the boundary of an interactive
 *                               component and for meaningful graphics
 *
 * A hairline between two surfaces is decorative, carries no information a
 * reader needs, and is deliberately *not* held to 3:1. It is reported for
 * information because it is what stops the page reading flat.
 *
 *   npm run test:contrast
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = join(import.meta.dirname, '..', 'src', 'tokens.css');
const css = readFileSync(FILE, 'utf8');

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

/** The declarations inside one selector block, by token name. */
function blockAfter(marker) {
  const at = css.indexOf(marker);
  if (at === -1) {
    throw new Error(`tokens.css no longer contains ${marker}`);
  }
  const open = css.indexOf('{', at);
  let depth = 0;
  let i = open;
  for (; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = css.slice(open, i);
  const out = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

const light = blockAfter(':root {');
const dark = blockAfter(":root[data-theme='dark'] {");

// The media-query copy has to agree with the explicit one, or the scheme
// changes character depending on how the reader asked for it.
const media = blockAfter("@media (prefers-color-scheme: dark)");
for (const key of Object.keys(dark)) {
  if (media[key] !== dark[key]) {
    check(`dark scheme agrees between the media query and the attribute: ${key}`, false,
      `${media[key] ?? 'missing'} vs ${dark[key]}`);
  }
}
check('the two dark blocks are identical', Object.keys(dark).every((k) => media[k] === dark[k]));

const srgb = (hex) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
};
const luminance = (hex) => {
  const [r, g, b] = srgb(hex).map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

for (const [scheme, tokens] of [['light', light], ['dark', dark]]) {
  for (const ground of ['heading-fill', 'heading-hover']) {
    const contrast = ratio(tokens['heading-ink'], tokens[ground]);
    check(`${scheme}: shared heading text and controls on ${ground}`, contrast >= 4.5, contrast.toFixed(2));
  }
}

/** [what it is, foreground token, background token, threshold]. */
const PAIRS = [
  ['body text on the page', 'text', 'bg', 4.5],
  ['body text on a panel', 'text', 'surface-1', 4.5],
  ['body text on a raised panel', 'text', 'surface-2', 4.5],
  ['body text on the highest panel', 'text', 'surface-3', 4.5],
  ['muted text on the page', 'text-muted', 'bg', 4.5],
  ['muted text on a panel', 'text-muted', 'surface-1', 4.5],
  ['muted text on a raised panel', 'text-muted', 'surface-2', 4.5],
  ['muted text on the highest panel', 'text-muted', 'surface-3', 4.5],
  ['faint text, large only', 'text-faint', 'surface-1', 3],

  ['accent as text on the page', 'accent', 'bg', 4.5],
  ['accent as text on a panel', 'accent', 'surface-1', 4.5],
  ['accent as text on a raised panel', 'accent', 'surface-2', 4.5],
  ['label on a filled accent button', 'accent-ink', 'accent', 4.5],
  ['accent as text on its own container', 'accent', 'accent-soft', 4.5],
  ['danger as text on a panel', 'danger', 'surface-1', 4.5],
  ['ok as text on a panel', 'ok', 'surface-1', 4.5],
  ['gold as text on a panel', 'gold', 'surface-1', 4.5],

  ['control border on the page', 'border', 'bg', 3],
  ['control border on a panel', 'border', 'surface-1', 3],
  ['control border on a raised panel', 'border', 'surface-2', 3],
  ['focus ring on the page', 'accent', 'bg', 3],
  ['focus ring on a panel', 'accent', 'surface-1', 3],
  ['focus ring on a raised panel', 'accent', 'surface-2', 3],
];

const FACTIONS = [
  'aggression', 'justice', 'leadership', 'protection', 'pool', 'basic',
  'hero', 'encounter', 'campaign',
];

/** Surfaces a faction name is ever drawn on. */
const FACTION_GROUNDS = ['bg', 'surface-1', 'surface-2'];

const SEPARATION = [
  ['panel against the page', 'surface-1', 'bg'],
  ['raised against a panel', 'surface-2', 'surface-1'],
  ['highest against raised', 'surface-3', 'surface-2'],
  ['hairline against a panel', 'hairline', 'surface-1'],
];

for (const [scheme, tokens] of [['light', light], ['dark', dark]]) {
  console.log(`\n--- ${scheme} ---`);

  for (const [label, fg, bg, need] of PAIRS) {
    const a = tokens[fg];
    const b = tokens[bg];
    if (a === undefined || b === undefined) {
      check(`${scheme}: ${label}`, false, `missing --${a === undefined ? fg : bg}`);
      continue;
    }
    const r = ratio(a, b);
    check(`${scheme}: ${label}`, r >= need, `${r.toFixed(2)}:1, need ${need}`);
  }

  // A faction name is a card's affinity written in its own colour, so it is
  // body text and has to clear 4.5 wherever it is drawn.
  for (const faction of FACTIONS) {
    for (const ground of FACTION_GROUNDS) {
      const r = ratio(tokens[`faction-${faction}`], tokens[ground]);
      check(`${scheme}: ${faction} as text on ${ground}`, r >= 4.5, `${r.toFixed(2)}:1`);
    }
  }

  // Informational. A step of about 1.1 is what dark interfaces use; a bigger
  // one reads as a stripe. The hairline is what a reader actually sees.
  for (const [label, a, b] of SEPARATION) {
    console.log(`      ${ratio(tokens[a], tokens[b]).toFixed(2)}:1  ${label}`);
  }
}

// The type scale has a floor, and inputs have a stricter one: below 16px
// Safari zooms the page when a field takes focus, which on a phone throws the
// reader out of whatever they were doing.
const base = /--text-base:\s*([\d.]+)rem/.exec(css);
check('--text-base is 16px, so iOS does not zoom inputs', base !== null && Number(base[1]) === 1,
  base === null ? 'not found' : `${Number(base[1]) * 16}px`);

const smallest = /--text-2xs:\s*([\d.]+)rem/.exec(css);
check('the smallest step is at least 12px', smallest !== null && Number(smallest[1]) * 16 >= 12,
  smallest === null ? 'not found' : `${Number(smallest[1]) * 16}px`);

const tap = /--tap-min:\s*(\d+)px/.exec(css);
check('--tap-min is at least 44px', tap !== null && Number(tap[1]) >= 44,
  tap === null ? 'not found' : `${tap[1]}px`);

process.exit(failures === 0 ? 0 : 1);
