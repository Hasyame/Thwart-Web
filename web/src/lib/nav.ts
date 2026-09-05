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
  | 'versus'
  | 'play'
  | 'campaigns'
  | 'stats'
  | 'rules';

/**
 * What the bars highlight.
 *
 * Wider than the destinations themselves: a card is read from the card list, the
 * account is reached from the settings sheet, and the confirmation page is
 * reached from a link in somebody's mail. All three are places the app can be
 * without being a tab, and none of them should light one up.
 */
export type ActiveTarget = NavTarget | 'card' | 'account' | 'verify';

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

/*
 * The order the bar reads in, which is the reader's and not the code's.
 *
 * Browsing, then the things you build, then the ways you play, then what you
 * own and what you have done. The account and the settings sit after all of
 * them, in the top bar rather than in this list, because neither is a place to
 * go and look at cards.
 */
export const DESTINATIONS: readonly Destination[] = [
  { id: 'search', label: (t) => t.navCards, tab: (t) => t.navCards, glyph: '▤' },
  { id: 'decks', label: (t) => t.navDecks, tab: (t) => t.navDecks, glyph: '❐' },
  { id: 'campaigns', label: (t) => t.navCampaigns, tab: (t) => t.navCampaigns, glyph: '◈' },
  { id: 'play', label: (t) => t.navPlay, tab: (t) => t.navPlayShort, glyph: '▶' },
  { id: 'randomizer', label: (t) => t.navRandomizer, tab: (t) => t.navRandomizer, glyph: '✦' },
  { id: 'versus', label: (t) => t.navVersus, tab: (t) => t.navVersus, glyph: '⚔' },
  { id: 'collection', label: (t) => t.navCollection, tab: (t) => t.navCollection, glyph: '▣' },
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
export const TAB_IDS: readonly NavTarget[] = ['search', 'decks', 'campaigns', 'play'];

export const TABS: readonly Destination[] = TAB_IDS.map(
  (id) => DESTINATIONS.find((d) => d.id === id) as Destination,
);

/** Everything the tab bar does not carry, which is what the More sheet holds. */
export const OVERFLOW: readonly Destination[] = DESTINATIONS.filter(
  (d) => !TAB_IDS.includes(d.id),
);

/**
 * Everything except the destinations a build has nothing to show for.
 *
 * Versus is the only one so far: the mode belongs to two boxes, and offering it
 * to somebody who owns neither is a menu entry that leads to an apology. The
 * master app hides it on the same rule.
 */
export const visible = (
  destinations: readonly Destination[],
  hidden: ReadonlySet<NavTarget>,
): readonly Destination[] => destinations.filter((d) => !hidden.has(d.id));

export const destinationOf = (id: NavTarget): Destination | undefined =>
  DESTINATIONS.find((d) => d.id === id);
