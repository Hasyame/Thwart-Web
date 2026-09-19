import type { HeroDeckRules } from '../deckRules';
import type { IndexRow } from '../types';

/**
 * A draft, as it is written down between two taps.
 *
 * Everything here is what survives the page being closed: the settings, each
 * player's identity and picks, the packs built ahead and the stock left on
 * the shelf beside them, and the seed. The card data behind it is not
 * written down; a `DraftContext` is rebuilt from the index each time. The
 * shape is the Android app's `DraftModels.kt` with the packs added, so the
 * two engines can be read side by side.
 * docs/spec/synergie-et-draft.md, phase 2 and the packs decision.
 */

export type IdentityMode = 'random' | 'random_of_five' | 'choice';

export type DraftPhase =
  | 'setup'
  /** Identity, aspects and deck size, one player at a time. */
  | 'identity'
  /** At the table. With several players the page simply changes hands. */
  | 'pick'
  /** Names, then everything is saved at once. */
  | 'finish';

export interface DraftSettings {
  readonly format?: 'draft' | 'sealed';
  readonly players: number;
  /** Leave out cards the identity cannot play: the phase 1 rule. */
  readonly synergyOnly: boolean;
  readonly identityMode: IdentityMode;
  /** Cards offered at each pick, 2 to 10. */
  readonly offerSize: number;
}

export interface DraftPlayer {
  readonly index: number;
  readonly heroCode: string | null;
  readonly heroName: string;
  readonly heroSetCode: string | null;
  /** Five identities to pick from, in the "random among five" mode. */
  readonly heroChoices: readonly string[];
  readonly aspects: readonly string[];
  readonly deckSize: number;
  /** The identity's own cards, by code and printed quantity, in from the start. */
  readonly signature: Readonly<Record<string, number>>;
  /** Canonical codes, in the order they were taken. */
  readonly picks: readonly string[];
  /** The deck's name, once the player has settled it; the default until then. */
  readonly deckName: string | null;
}

export interface DraftState {
  /** Session-only collection snapshot; never changes ownedPacks. */
  readonly collection?: Readonly<Record<string, number>>;
  readonly sealedPools?: readonly (readonly string[])[];
  /** Opened boosters per seat; absent on older sessions whose pool was already visible. */
  readonly sealedOpened?: readonly number[];
  readonly sealedBuilding?: readonly boolean[];
  readonly settings: DraftSettings;
  readonly players: readonly DraftPlayer[];
  readonly phase: DraftPhase;
  /** Whose turn it is, on the identity pages and at the table. */
  readonly current: number;
  /**
   * Copies of each card on the shelf, by canonical code, shared by every
   * player: what is in no unopened pack and in no deck. A card leaves the
   * shelf when a pack is built around it and comes back when the pack is
   * opened and it is not the one taken.
   */
  readonly stock: Readonly<Record<string, number>>;
  /**
   * Each player's packs, built ahead and still sealed, in the order they
   * will be opened. One pack is one pick: a player opens the front one,
   * takes a card, and the rest go back on the shelf.
   */
  readonly packs: readonly (readonly (readonly string[])[])[];
  /** How many times packs have been built, which seeds each building. */
  readonly builds: number;
  /** How many picks have been made in all. */
  readonly pickCount: number;
  /** The open pack in front of the current player, by canonical code. */
  readonly offer: readonly string[];
  readonly seed: number;
  /** Identity and aspect draws made so far, so "draw again" draws again. */
  readonly rolls: number;
}

/** The table's constants. The deck bounds are the game's, restated for the draft. */
export const DRAFT_RULES = {
  MIN_PLAYERS: 1,
  MAX_PLAYERS: 4,
  MIN_OFFER_SIZE: 2,
  MAX_OFFER_SIZE: 10,
  /** As the Android app has it: five, so a pick is a choice and not a coin. */
  DEFAULT_OFFER_SIZE: 5,
  MIN_DECK_SIZE: 40,
  MAX_DECK_SIZE: 50,
  RANDOM_CHOICES: 5,
  /** The four aspects every identity may pick from, in the order printed. */
  CLASSIC_ASPECTS: ['aggression', 'justice', 'leadership', 'protection'] as readonly string[],
  POOL_ASPECT: 'pool',
  /** The pack that brought the 'Pool aspect; without it there is nothing to draft. */
  POOL_PACK: 'deadpool',
} as const;

export const DEFAULT_SETTINGS: DraftSettings = {
  players: 1,
  synergyOnly: false,
  identityMode: 'random',
  offerSize: DRAFT_RULES.DEFAULT_OFFER_SIZE,
};

export const EMPTY_PLAYER = (index: number): DraftPlayer => ({
  index,
  heroCode: null,
  heroName: '',
  heroSetCode: null,
  heroChoices: [],
  aspects: [],
  deckSize: DRAFT_RULES.MIN_DECK_SIZE,
  signature: {},
  picks: [],
  deckName: null,
});

export const signatureCount = (player: DraftPlayer): number =>
  Object.values(player.signature).reduce((sum, n) => sum + n, 0);
export const cardCount = (player: DraftPlayer): number => signatureCount(player) + player.picks.length;
export const remaining = (player: DraftPlayer): number => Math.max(0, player.deckSize - cardCount(player));
export const isFull = (player: DraftPlayer): boolean => cardCount(player) >= player.deckSize;
export const isReady = (player: DraftPlayer): boolean => player.heroCode !== null && player.aspects.length > 0;

/** The deck as slots: the signature cards and every pick so far. */
export function slotsOf(player: DraftPlayer): Map<string, number> {
  const slots = new Map(Object.entries(player.signature));
  for (const code of player.picks) {
    slots.set(code, (slots.get(code) ?? 0) + 1);
  }
  return slots;
}

export const everyoneFull = (state: DraftState): boolean => state.players.every(isFull);

/**
 * What the engine needs of the card data, rebuilt from the index whenever
 * the draft is opened. Nothing here is written down with the state.
 */
export interface DraftContext {
  /** Every player card the collection holds, by canonical code. */
  readonly pool: ReadonlyMap<string, IndexRow>;
  /** Copies of each on the shelf before anyone draws. */
  readonly initialStock: ReadonlyMap<string, number>;
  /** The rules of each identity in the draft, by hero code. */
  readonly rules: ReadonlyMap<string, HeroDeckRules>;
  /** The traits of each identity in the draft, by hero code. */
  readonly identities: ReadonlyMap<string, ReadonlySet<string>>;
  /** Each identity's signature cards, by hero code and card code. */
  readonly signatureCards: ReadonlyMap<string, ReadonlyMap<string, IndexRow>>;
  /** True when the Deadpool pack is owned, which is what brings the 'Pool aspect. */
  readonly poolAspectAvailable: boolean;
}
