import type { Strings } from './i18n';

/**
 * Where the app can go, and which of those places get a tab.
 *
 * One list, read by the bottom bar, the top bar and the More sheet, so the
 * three cannot disagree about what exists. A destination missing from one of
 * them is a page nobody can reach, and there is no horizontal scroll anywhere
 * to find it with.
 */

export type NavTarget =
  | 'search'
  | 'collection'
  | 'decks'
  | 'randomizer'
  | 'play'
  | 'campaigns'
  | 'stats'
  | 'rules';

export interface Destination {
  readonly id: NavTarget;
  /** The full name, for the top bar and the More sheet. */
  readonly label: (t: Strings) => string;
  /**
   * The name on a tab, which has about six characters of room.
   *
   * Separate from `label` because French needs it to be: "Ma propre partie" is
   * sixteen characters and cannot be a tab in any layout.
   */
  readonly tab: (t: Strings) => string;
  /** Drawn as text rather than fetched: eight glyphs is not worth an icon font. */
  readonly glyph: string;
}

export const DESTINATIONS: readonly Destination[] = [
  { id: 'search', label: (t) => t.navCards, tab: (t) => t.navCards, glyph: '▤' },
  { id: 'decks', label: (t) => t.navDecks, tab: (t) => t.navDecks, glyph: '❐' },
  { id: 'play', label: (t) => t.navPlay, tab: (t) => t.navPlayShort, glyph: '▶' },
  { id: 'campaigns', label: (t) => t.navCampaigns, tab: (t) => t.navCampaigns, glyph: '◈' },
  { id: 'collection', label: (t) => t.navCollection, tab: (t) => t.navCollection, glyph: '▣' },
  { id: 'randomizer', label: (t) => t.navRandomizer, tab: (t) => t.navRandomizer, glyph: '✦' },
  { id: 'stats', label: (t) => t.navStats, tab: (t) => t.navStats, glyph: '▥' },
  { id: 'rules', label: (t) => t.navRules, tab: (t) => t.navRules, glyph: '❔' },
];

/**
 * The four that get a tab, plus More.
 *
 * Four rather than eight because a tab bar is only usable while every tab is
 * wide enough to hit: eight of them on a 375px screen is 47px each, under the
 * 44pt floor once the label has any padding at all. These four are the ones a
 * game is played out of; the rest are things you visit between games.
 */
export const TAB_IDS: readonly NavTarget[] = ['search', 'decks', 'play', 'campaigns'];

export const TABS: readonly Destination[] = TAB_IDS.map(
  (id) => DESTINATIONS.find((d) => d.id === id) as Destination,
);

/** Everything the tab bar does not carry, which is what the More sheet holds. */
export const OVERFLOW: readonly Destination[] = DESTINATIONS.filter(
  (d) => !TAB_IDS.includes(d.id),
);

export const destinationOf = (id: NavTarget): Destination | undefined =>
  DESTINATIONS.find((d) => d.id === id);
