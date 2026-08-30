/**
 * Generates the Material 3 token set from Thwart's own seed colours.
 *
 * The Android app picks its colours by hand in
 * `core/designsystem/theme/Color.kt` and lets Material derive every container
 * and disabled state from them, so that the palette "stays in the same family
 * rather than drifting to stock purple". This does the same thing for the web,
 * with the same algorithm Compose uses, so the two clients match by
 * construction rather than by somebody eyeballing hex codes.
 *
 * See docs/design/03-stack-decision.md, ADR-204: Material Web has been in
 * maintenance mode since June 2024, so we take the colour library — which is
 * maintained — and write the components ourselves.
 *
 * Output is `src/theme.generated.css`, which is gitignored: it is a build
 * product, and the seed colours below are the source of truth.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  argbFromHex,
  hexFromArgb,
  themeFromSourceColor,
  TonalPalette,
} from '@material/material-color-utilities';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'src', 'theme.generated.css');

/**
 * Straight from Color.kt. Keep these in step with the app: they are the one
 * piece of the design system the two clients genuinely share, and doc 04 has
 * them moving into Thwart-Data when that is extracted.
 */
const SEED = {
  ironRed: '#E30022',
  brassGold: '#D3AF37',
  arcGold: '#FCC200',
  panelInk: '#1A1113',
  paperWarm: '#FFF8F6',
};

/**
 * Material 3's standard tone mapping for an accent role.
 *
 * Light themes take the accent at tone 40 on a tone 90 container; dark themes
 * invert to 80 on 30. Hard-coding these is what lets us pin secondary and
 * tertiary to the actual brand golds instead of accepting whatever the
 * algorithm derives from a red seed — a gold that is computed from red is not
 * gold.
 */
const ACCENT_TONES = {
  light: { base: 40, on: 100, container: 90, onContainer: 10 },
  dark: { base: 80, on: 20, container: 30, onContainer: 90 },
};

/** camelCase token name to the CSS custom property the components use. */
function cssVarName(token) {
  return '--md-' + token.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

function accentRoles(hex, mode, prefix) {
  const palette = TonalPalette.fromInt(argbFromHex(hex));
  const tones = ACCENT_TONES[mode];
  const capital = prefix.charAt(0).toUpperCase() + prefix.slice(1);
  return {
    [prefix]: hexFromArgb(palette.tone(tones.base)),
    [`on${capital}`]: hexFromArgb(palette.tone(tones.on)),
    [`${prefix}Container`]: hexFromArgb(palette.tone(tones.container)),
    [`on${capital}Container`]: hexFromArgb(palette.tone(tones.onContainer)),
  };
}

function tokensFor(mode) {
  const theme = themeFromSourceColor(argbFromHex(SEED.ironRed));
  const scheme = theme.schemes[mode].toJSON();

  const tokens = {};
  for (const [name, argb] of Object.entries(scheme)) {
    tokens[name] = hexFromArgb(argb);
  }

  // Pin the two golds rather than letting them be derived from the red.
  Object.assign(tokens, accentRoles(SEED.brassGold, mode, 'secondary'));
  Object.assign(tokens, accentRoles(SEED.arcGold, mode, 'tertiary'));

  return tokens;
}

function declarations(tokens, indent) {
  return Object.entries(tokens)
    .map(([name, value]) => `${indent}${cssVarName(name)}: ${value};`)
    .join('\n');
}

function block(selector, tokens) {
  return `${selector} {\n${declarations(tokens, '  ')}\n}`;
}

const light = tokensFor('light');
const dark = tokensFor('dark');

// The brand colours themselves, for the few places a component wants the ink
// outline or the warm paper directly rather than a Material role.
const brand = {
  brandIronRed: SEED.ironRed,
  brandBrassGold: SEED.brassGold,
  brandArcGold: SEED.arcGold,
  brandPanelInk: SEED.panelInk,
  brandPaperWarm: SEED.paperWarm,
};

/*
 * Three blocks, in this order, so the theme survives all three states the
 * viewer can be in: an explicit light choice, an explicit dark choice, and the
 * default of following the system. The light palette is the bare `:root` so
 * that no colour has its only definition inside a media query; the media block
 * is guarded against an explicit light choice; the attribute block comes last
 * so a manual toggle wins in both directions.
 */
const css = `/*
 * GENERATED FILE — do not edit.
 *
 * Written by scripts/generate-theme.mjs from the seed colours in Color.kt.
 * Run \`npm run theme\` to regenerate. This file is gitignored on purpose.
 */

${block(':root', { ...light, ...brand })}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${declarations(dark, '    ')}
  }
}

${block(":root[data-theme='dark']", dark)}
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, css, 'utf8');

console.log(
  `theme: wrote ${Object.keys(light).length} tokens per scheme to src/theme.generated.css`,
);
