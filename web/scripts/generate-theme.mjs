/**
 * Emits the Material 3 token set as CSS custom properties.
 *
 * This is a **transcription of the Android app's colour schemes**, not a
 * generation from seed colours. That distinction was got wrong first time and
 * is worth stating plainly, because the algorithmic version looked wrong in a
 * way that took a person to notice.
 *
 * `Theme.kt` does not hand Material a seed and accept what comes out. It names
 * every role, and several of those choices are deliberate refusals of what an
 * algorithm would produce:
 *
 *   - **Secondary is neutral graphite, not gold.** Gold is the colour the game
 *     prints Justice in, so a gold selection chip sat in the same list as cards
 *     where gold already meant something else. Deriving secondary from a gold
 *     seed reintroduces exactly the collision the app removed.
 *   - **The dark surfaces climb in five steps**, each warmed towards red, so a
 *     dialog sits above a card sits above the page. Two tones read flat.
 *   - **Headings do not use primary.** In the dark scheme `primary` is a bright
 *     coral that Material pairs with dark maroon, which is one hue twice with
 *     nothing between — fine on a contrast table, mud on a phone. Headings take
 *     `HeadingFill`/`HeadingInk` instead, which is the same pair in both themes
 *     so a heading does not change character when the lights go out.
 *
 * Source of truth: `core/designsystem/theme/Color.kt` and `Theme.kt` in the
 * Android repository. Keep this file in step with them; it is the one place the
 * two clients genuinely share a design decision, and doc 04 has it moving into
 * Thwart-Data when that is extracted.
 *
 * Output is `src/theme.generated.css`, which is gitignored: a build product.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'src', 'theme.generated.css');

/** Every named colour in Color.kt, verbatim. */
const C = {
  ironRed: '#E30022',
  ironRedDeep: '#CC0000',
  ironRedTint: '#FFD9D5',
  ironRedBright: '#FF5A49',
  ironRedInk: '#480007',

  brassGold: '#D3AF37',
  arcGold: '#FCC200',

  panelInk: '#1A1113',
  panelInkSoft: '#534342',
  panelShadow: '#120C0B',

  paperWarm: '#FFF8F6',
  paperShade: '#F3DDDB',

  // Night pages, as five steps rather than two.
  nightBase: '#0D0809',
  nightLacquer: '#120C0D',
  nightRaised: '#1A1213',
  nightRaisedHigh: '#241A1A',
  nightRaisedHighest: '#2F2221',
  nightOutline: '#B9A6A3',
  nightOutlineSoft: '#5A4A48',

  // Neutral ink, for everything interactive.
  inkGraphite: '#2B2422',
  inkGraphiteSoft: '#E4DAD6',
  boneCream: '#F2E7E2',
  boneCreamDeep: '#554A47',
};

/**
 * Aspect colours, as the game prints them.
 *
 * Not ours to restyle: they carry meaning a player already knows. Taken from
 * Color.kt rather than guessed, which the first version of this file did — the
 * guesses were close enough to look right and wrong enough to be wrong.
 *
 * `pool` is Deadpool's own aspect, the only one the game prints outside the
 * four, kept clear of Aggression's red. `hero`, `encounter` and `campaign` are
 * not aspects at all; they take neutrals so they cannot be mistaken for one.
 */
const FACTIONS = {
  aggression: '#C0392B',
  justice: '#D4A017',
  leadership: '#2E6DA4',
  protection: '#3E8E5A',
  pool: '#8E44AD',
  basic: '#7A7A7A',
  hero: C.panelInkSoft,
  encounter: C.boneCreamDeep,
  campaign: C.nightOutlineSoft,
};

/**
 * The light scheme, exactly as `lightColorScheme(...)` declares it.
 *
 * The surface container ladder is the one thing added here. Compose leaves it
 * to Material's defaults, which the browser has no equivalent of, so it is
 * stepped between the two paper tones the app does name.
 */
const LIGHT = {
  primary: C.ironRed,
  onPrimary: C.paperWarm,
  primaryContainer: C.ironRedTint,
  onPrimaryContainer: C.ironRedInk,
  inversePrimary: C.ironRedBright,

  secondary: C.inkGraphite,
  onSecondary: C.boneCream,
  secondaryContainer: C.inkGraphiteSoft,
  onSecondaryContainer: C.inkGraphite,

  tertiary: C.inkGraphite,
  onTertiary: C.boneCream,
  tertiaryContainer: C.inkGraphiteSoft,
  onTertiaryContainer: C.inkGraphite,

  background: C.paperWarm,
  onBackground: C.panelInk,
  surface: C.paperWarm,
  onSurface: C.panelInk,
  surfaceVariant: C.paperShade,
  onSurfaceVariant: C.panelInkSoft,

  surfaceContainerLowest: '#FFFFFF',
  surfaceContainerLow: '#FFFCFB',
  surfaceContainer: '#FBF1EF',
  surfaceContainerHigh: '#F7E7E5',
  surfaceContainerHighest: C.paperShade,

  // A heavy outline is most of what makes a panel read as drawn, not as a box.
  outline: C.panelInk,
  outlineVariant: C.panelInkSoft,

  error: C.ironRedDeep,
  onError: C.paperWarm,
  errorContainer: C.ironRedTint,
  onErrorContainer: C.ironRedInk,

  scrim: C.panelShadow,
};

/** The dark scheme, exactly as `darkColorScheme(...)` declares it. */
const DARK = {
  primary: C.ironRedBright,
  onPrimary: C.ironRedInk,
  primaryContainer: C.ironRedDeep,
  onPrimaryContainer: C.ironRedTint,
  inversePrimary: C.ironRed,

  secondary: C.boneCream,
  onSecondary: C.inkGraphite,
  secondaryContainer: C.boneCreamDeep,
  onSecondaryContainer: C.boneCream,

  tertiary: C.boneCream,
  onTertiary: C.inkGraphite,
  tertiaryContainer: C.boneCreamDeep,
  onTertiaryContainer: C.boneCream,

  background: C.nightBase,
  onBackground: C.paperWarm,
  surface: C.nightLacquer,
  onSurface: C.paperWarm,
  surfaceVariant: C.nightRaised,
  onSurfaceVariant: C.paperShade,

  surfaceContainerLowest: C.nightBase,
  surfaceContainerLow: C.nightLacquer,
  surfaceContainer: C.nightRaised,
  surfaceContainerHigh: C.nightRaisedHigh,
  surfaceContainerHighest: C.nightRaisedHighest,

  outline: C.nightOutline,
  outlineVariant: C.nightOutlineSoft,

  error: C.ironRedBright,
  onError: C.ironRedInk,
  errorContainer: C.ironRedDeep,
  onErrorContainer: C.ironRedTint,

  scrim: C.panelShadow,
};

/**
 * The filled heading strip, and the only text colour that belongs on it.
 *
 * Identical in both themes, on purpose. See the file header.
 */
const HEADING = {
  headingFill: C.ironRed,
  headingInk: C.paperWarm,

  // The two golds, for the few places that want the brand accent directly
  // rather than a Material role — the rule under the app bar, chiefly. Not
  // wired into secondary, deliberately: see the file header.
  arcGold: C.arcGold,
  brassGold: C.brassGold,
};

function cssVarName(token) {
  return '--md-' + token.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

function declarations(tokens, indent) {
  return Object.entries(tokens)
    .map(([name, value]) => `${indent}${cssVarName(name)}: ${value};`)
    .join('\n');
}

function factionDeclarations(indent) {
  return Object.entries(FACTIONS)
    .map(([code, value]) => `${indent}--faction-${code}: ${value};`)
    .join('\n');
}

/*
 * Three blocks, so the theme survives all three states the viewer can be in:
 * an explicit light choice, an explicit dark choice, and the default of
 * following the system. Light is the bare `:root`, so no colour has its only
 * definition inside a media query.
 */
const css = `/*
 * GENERATED FILE — do not edit.
 *
 * Written by scripts/generate-theme.mjs, which transcribes the colour schemes
 * in the Android app's Color.kt and Theme.kt. Run \`npm run theme\`.
 */

:root {
${declarations(LIGHT, '  ')}

${declarations(HEADING, '  ')}

${factionDeclarations('  ')}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${declarations(DARK, '    ')}
  }
}

:root[data-theme='dark'] {
${declarations(DARK, '  ')}
}
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, css, 'utf8');

console.log(
  `theme: wrote ${Object.keys(LIGHT).length} roles per scheme plus ` +
    `${Object.keys(FACTIONS).length} faction colours to src/theme.generated.css`,
);
