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
  /**
   * The Play hub, which exists only when the play screens are grouped.
   *
   * Its own route rather than a second meaning for `/play`, so no URL ever
   * changes what it points at: `/play` is your own setup whichever way the
   * navigation is arranged, and a link somebody saved still lands where they
   * expect. See `groupedPlay` in preferences.
   */
  | 'hub'
  | 'collection'
  | 'decks'
  | 'randomizer'
  | 'versus'
  | 'play'
  | 'campaigns'
  | 'history'
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
  { id: 'hub', label: (t) => t.navPlayShort, tab: (t) => t.navPlayShort, glyph: '▶' },
  { id: 'decks', label: (t) => t.navDecks, tab: (t) => t.navDecks, glyph: '❐' },
  { id: 'campaigns', label: (t) => t.navCampaigns, tab: (t) => t.navCampaigns, glyph: '◈' },
  { id: 'play', label: (t) => t.navPlay, tab: (t) => t.navPlayShort, glyph: '▶' },
  { id: 'randomizer', label: (t) => t.navRandomizer, tab: (t) => t.navRandomizer, glyph: '✦' },
  { id: 'versus', label: (t) => t.navVersus, tab: (t) => t.navVersus, glyph: '⚔' },
  { id: 'collection', label: (t) => t.navCollection, tab: (t) => t.navCollection, glyph: '▣' },
  { id: 'history', label: (t) => t.navHistory, tab: (t) => t.navHistory, glyph: '⏱' },
  { id: 'stats', label: (t) => t.navStats, tab: (t) => t.navStats, glyph: '▥' },
  { id: 'rules', label: (t) => t.navRules, tab: (t) => t.navRules, glyph: '❔' },
];

/**
 * The four that get a tab, plus More.
 *
 * Four rather than ten because a tab bar is only usable while every tab is
 * wide enough to hit: ten of them on a 375px screen is 37px each, under the
 * 44pt floor before the label has any padding at all.
 *
 * Two arrangements, because the phone app and the browser have earned
 * different ones and there is no answer that suits both.
 *
 *   separate  what the browser has always had. Campaigns and your own setup
 *             are tabs; the random draw and versus are in the More sheet.
 *
 *   grouped   what the phone does. One Play tab opens a hub holding all four
 *             ways of playing, which frees a slot, and the statistics take it
 *             -- the phone has a Stats tab too, and a bar that dropped to
 *             three tabs would read as something having gone missing.
 *
 * Everything stays reachable in both: the four play screens keep their URLs
 * and are one tap from the hub, so grouping moves things without hiding any.
 */
const SEPARATE_TABS: readonly NavTarget[] = ['search', 'decks', 'campaigns', 'play'];
const GROUPED_TABS: readonly NavTarget[] = ['search', 'decks', 'hub', 'stats'];

/** What the hub gathers, and therefore what the More sheet must not repeat. */
export const PLAY_TARGETS: readonly NavTarget[] = ['play', 'randomizer', 'campaigns', 'versus'];

const byId = (id: NavTarget): Destination =>
  DESTINATIONS.find((d) => d.id === id) as Destination;

/** The tabs, for the arrangement in force. */
export const tabsFor = (grouped: boolean): readonly Destination[] =>
  (grouped ? GROUPED_TABS : SEPARATE_TABS).map(byId);

/**
 * Everything the tab bar does not carry, which is what the More sheet holds.
 *
 * When the play screens are grouped they are left out entirely: the hub is
 * where they live, and listing them here as well would put the same four
 * destinations in two places and undo the grouping the setting asked for.
 */
export const overflowFor = (grouped: boolean): readonly Destination[] => {
  const tabs = grouped ? GROUPED_TABS : SEPARATE_TABS;
  return DESTINATIONS.filter((d) => {
    if (d.id === 'hub') {
      // Never in the sheet: it is a tab or it is nothing.
      return false;
    }
    if (tabs.includes(d.id)) {
      return false;
    }
    return !(grouped && PLAY_TARGETS.includes(d.id));
  });
};

/**
 * What the wide header shows, which is every destination and not the hub.
 *
 * Above the breakpoint there is room for all ten on one row, so there is
 * nothing for a hub to solve -- and offering both it and the four screens it
 * gathers would be the same places twice.
 */
export const TOP_BAR: readonly Destination[] = DESTINATIONS.filter((d) => d.id !== 'hub');

/**
 * Which tab a destination lights up.
 *
 * A card is read from the card list, so Cards stays lit. With the play screens
 * grouped there is no Campaigns tab to light when somebody is on `/campaigns`,
 * and leaving nothing lit reads as having fallen out of the app: the hub tab
 * takes it, which is also the tab that would take you back.
 */
export const tabFor = (active: ActiveTarget, grouped: boolean): ActiveTarget => {
  if (active === 'card') {
    return 'search';
  }
  if (grouped && PLAY_TARGETS.includes(active as NavTarget)) {
    return 'hub';
  }
  return active;
};

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
