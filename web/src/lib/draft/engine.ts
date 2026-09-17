import type { Card, IndexRow } from '../types';
import { validateDeck, type HeroDeckRules } from '../deckRules';
import { rowCompatible } from '../synergy';
import { cardFromRow } from './cards';
import { seeded, shuffled } from './random';
import {
  DRAFT_RULES,
  cardCount,
  everyoneFull,
  isFull,
  remaining,
  slotsOf,
  type DraftContext,
  type DraftPlayer,
  type DraftState,
} from './types';

/**
 * The draft, turn by turn.
 *
 * Pure: every function takes the state and gives the next one, and every
 * draw comes from the seed, so a draft written down and reopened offers the
 * same cards, and a test gets the same draft twice. The Android app's
 * `DraftEngine.kt`, function for function, so a rule read on one side is
 * the rule on the other.
 */

const BASIC_FACTION = 'basic';
const DEFAULT_COPY_LIMIT = 3;
const PICK_STRIDE = 1_000;
const IDENTITY_STRIDE = 7_919;

/** What stands between the table and a deck of the size asked for. */
export interface Shortfall {
  readonly playerIndex: number;
  readonly needed: number;
  readonly available: number;
}

const identityRandom = (state: DraftState) =>
  seeded(state.seed + IDENTITY_STRIDE * (state.current + 1) + state.rolls);

// --- identities -----------------------------------------------------------------

/**
 * The identities a player may still take: the collection's, minus those
 * other players already hold. Two players never share a hero.
 */
export function availableHeroes(state: DraftState, owned: readonly string[]): string[] {
  const taken = new Set(state.players.map((p) => p.heroCode).filter((c): c is string => c !== null));
  return owned.filter((code) => !taken.has(code));
}

/** A random identity for the player about to choose. */
export function randomHero(state: DraftState, owned: readonly string[]): string | null {
  const available = availableHeroes(state, owned);
  if (available.length === 0) {
    return null;
  }
  return shuffled(available, identityRandom(state))[0] ?? null;
}

/** Five random identities, or fewer when the collection is smaller. */
export function randomHeroChoices(state: DraftState, owned: readonly string[]): string[] {
  return shuffled(availableHeroes(state, owned), identityRandom(state)).slice(0, DRAFT_RULES.RANDOM_CHOICES);
}

/** The aspects an identity's rule imposes, when it does; null otherwise. */
export function imposedAspects(rules: HeroDeckRules | null | undefined): readonly string[] | null {
  return rules !== null && rules !== undefined && rules.aspectCount >= DRAFT_RULES.CLASSIC_ASPECTS.length
    ? DRAFT_RULES.CLASSIC_ASPECTS
    : null;
}

/**
 * The aspects an identity may choose from: the four, and 'Pool when the
 * Deadpool pack is on the shelf. Empty when the identity's own rule settles
 * the question, as Adam Warlock's does.
 */
export function aspectChoices(rules: HeroDeckRules | null | undefined, poolAvailable: boolean): readonly string[] {
  if (imposedAspects(rules) !== null) {
    return [];
  }
  return poolAvailable ? [...DRAFT_RULES.CLASSIC_ASPECTS, DRAFT_RULES.POOL_ASPECT] : DRAFT_RULES.CLASSIC_ASPECTS;
}

/** A random legal choice of aspects for the identity. */
export function randomAspects(
  state: DraftState,
  rules: HeroDeckRules | null | undefined,
  poolAvailable: boolean,
): readonly string[] {
  const imposed = imposedAspects(rules);
  if (imposed !== null) {
    return imposed;
  }
  const count = rules?.aspectCount ?? 1;
  return shuffled(aspectChoices(rules, poolAvailable), identityRandom(state)).slice(0, count);
}

// --- the shelf ------------------------------------------------------------------

/** Every card the validator may be asked about, as it reads them. Built once per context. */
const cardInfoCache = new WeakMap<DraftContext, Map<string, Card>>();
function cardInfo(context: DraftContext): Map<string, Card> {
  let cards = cardInfoCache.get(context);
  if (cards === undefined) {
    cards = new Map<string, Card>();
    for (const [code, row] of context.pool) {
      cards.set(code, cardFromRow(row));
    }
    for (const signature of context.signatureCards.values()) {
      for (const [code, row] of signature) {
        cards.set(code, cardFromRow(row));
      }
    }
    cardInfoCache.set(context, cards);
  }
  return cards;
}

function optionAdmits(rules: HeroDeckRules, card: Card): boolean {
  return rules.options.some((option) => {
    const traits = (card.traits ?? '').split('.').map((t) => t.trim().toLowerCase()).filter((t) => t !== '');
    const typeOk = option.types.length === 0 || option.types.includes(card.type_code);
    const traitOk = option.traits.length === 0 || option.traits.some((t) => traits.includes(t.toLowerCase()));
    const resourceOk =
      option.resources.length === 0 ||
      option.resources.some((r) => Number((card as unknown as Record<string, unknown>)[`resource_${r.toLowerCase()}`] ?? 0) > 0);
    return (option.types.length > 0 || option.traits.length > 0 || option.resources.length > 0) && typeOk && traitOk && resourceOk;
  });
}

/**
 * The cards a player may be offered from what is left on the shelf: the
 * chosen aspects and basic, plus whatever the identity's own allowances
 * admit; never another identity's cards; and, when asked, nothing the
 * identity cannot play.
 */
export function playerPool(state: DraftState, player: DraftPlayer, context: DraftContext): IndexRow[] {
  const rules = player.heroCode === null ? undefined : context.rules.get(player.heroCode);
  if (rules === undefined) {
    return [];
  }
  const identity = player.heroCode === null ? undefined : context.identities.get(player.heroCode);
  const factions = new Set([...player.aspects, BASIC_FACTION]);
  const cards = cardInfo(context);
  const out: IndexRow[] = [];
  for (const [code, row] of context.pool) {
    if ((state.stock[code] ?? 0) <= 0) {
      continue;
    }
    const card = cards.get(code);
    if (!factions.has(row.factionCode) && (card === undefined || !optionAdmits(rules, card))) {
      continue;
    }
    if (state.settings.synergyOnly && identity !== undefined && !rowCompatible(row, identity)) {
      continue;
    }
    out.push(row);
  }
  return out;
}

/**
 * Copies of the card one deck can hold: the shelf's, capped by the copy
 * limit that applies to this identity.
 */
export function usableCopies(
  player: DraftPlayer,
  row: IndexRow,
  stock: Readonly<Record<string, number>>,
  context: DraftContext,
): number {
  const rules = player.heroCode === null ? undefined : context.rules.get(player.heroCode);
  if (rules === undefined) {
    return 0;
  }
  const limit = row.isUnique ? 1 : (rules.copyLimitOverride ?? row.deckLimit ?? DEFAULT_COPY_LIMIT);
  return Math.min(stock[row.code] ?? 0, limit);
}

/**
 * Whether the shelf can fill every deck: each player's own pool, counted as
 * copies their deck may hold, against what they still need; then everybody's
 * needs against the shelf as a whole, since one copy drafted by one player is
 * one copy fewer for the rest. An estimate on the safe side of "enough", not
 * a proof; the pick itself never offers an illegal card, whatever this says.
 */
export function shortfalls(state: DraftState, context: DraftContext): Shortfall[] {
  const out: Shortfall[] = [];
  const sharedCapacity = new Map<string, number>();
  let totalNeeded = 0;
  for (const player of state.players) {
    let available = 0;
    for (const row of playerPool(state, player, context)) {
      const usable = usableCopies(player, row, state.stock, context);
      available += usable;
      sharedCapacity.set(row.code, (sharedCapacity.get(row.code) ?? 0) + usable);
    }
    const needed = remaining(player);
    totalNeeded += needed;
    if (available < needed) {
      out.push({ playerIndex: player.index, needed, available });
    }
  }
  if (out.length === 0) {
    let shared = 0;
    for (const [code, capacity] of sharedCapacity) {
      shared += Math.min(capacity, state.stock[code] ?? 0);
    }
    if (shared < totalNeeded) {
      // Not one player's fault: said against the last, whose deck is the one
      // the shelf runs out on.
      const last = state.players[state.players.length - 1];
      if (last !== undefined) {
        out.push({ playerIndex: last.index, needed: totalNeeded, available: shared });
      }
    }
  }
  return out;
}

// --- picks ----------------------------------------------------------------------

/**
 * Whether the deck can still be finished legally with the card in it.
 *
 * The validator judges the deck as it would stand, and anything it reports
 * beyond the size and the balance rules out the card: a fourth copy, a
 * second unique, Adam Warlock's second copy of anything. Size is the point
 * of drafting, and balance is judged by whether the picks left can still
 * even the aspects out: a card is refused when taking it would leave more
 * deficit than picks.
 */
export function canTake(player: DraftPlayer, row: IndexRow, context: DraftContext): boolean {
  const rules = player.heroCode === null ? undefined : context.rules.get(player.heroCode);
  if (rules === undefined) {
    return false;
  }
  const slots = slotsOf(player);
  slots.set(row.code, (slots.get(row.code) ?? 0) + 1);
  const cards = cardInfo(context);
  const validation = validateDeck(rules, player.aspects, slots, cards);
  const blocking = validation.problems.filter(
    (problem) => problem.kind !== 'tooFewCards' && problem.kind !== 'unbalancedAspects',
  );
  if (blocking.length > 0) {
    return false;
  }
  if (!rules.aspectsMustBalance) {
    return true;
  }
  const counts = player.aspects.map((aspect) => {
    let n = 0;
    for (const [code, quantity] of slots) {
      if (context.pool.get(code)?.factionCode === aspect) {
        n += quantity;
      }
    }
    return n;
  });
  const most = Math.max(...counts);
  const deficit = counts.reduce((sum, n) => sum + (most - n), 0);
  const remainingAfter = player.deckSize - cardCount(player) - 1;
  return remainingAfter >= deficit;
}

/** The cards the current player may be offered right now. */
export function legalOffers(state: DraftState, context: DraftContext): IndexRow[] {
  const player = state.players[state.current];
  if (player === undefined) {
    return [];
  }
  return playerPool(state, player, context).filter((row) => canTake(player, row, context));
}

/**
 * Puts the current player's offer on the table: `offerSize` cards drawn at
 * random from what they may take, or what is left when that is fewer.
 * Seeded by the pick count, so reopening the draft finds the same cards.
 */
export function deal(state: DraftState, context: DraftContext): DraftState {
  const legal = legalOffers(state, context);
  const random = seeded(state.seed + state.pickCount * PICK_STRIDE + state.current);
  const offer = shuffled(legal, random)
    .slice(0, state.settings.offerSize)
    .map((row) => row.code);
  return { ...state, offer };
}

/**
 * The current player takes the card. The copy leaves the shelf, and the
 * turn passes to the next player who still has room; when nobody has room
 * the draft is over.
 */
export function pick(state: DraftState, canonicalCode: string, context: DraftContext): DraftState {
  if (!state.offer.includes(canonicalCode)) {
    throw new Error(`not on the table: ${canonicalCode}`);
  }
  const players = state.players.map((player, i) =>
    i === state.current ? { ...player, picks: [...player.picks, canonicalCode] } : player,
  );
  const stock = { ...state.stock, [canonicalCode]: (state.stock[canonicalCode] ?? 1) - 1 };
  return nextTurn({ ...state, players, stock, pickCount: state.pickCount + 1, offer: [] }, context);
}

/** The next player with room takes the table, or the draft ends. */
export function nextTurn(state: DraftState, context: DraftContext): DraftState {
  if (everyoneFull(state)) {
    return { ...state, phase: 'finish', current: 0, offer: [] };
  }
  let next = state.current;
  do {
    next = (next + 1) % state.players.length;
  } while (isFull(state.players[next] as DraftPlayer));
  return { ...deal({ ...state, current: next }, context), phase: 'pick' };
}

/** The first turn, once every identity is settled. */
export function start(state: DraftState, context: DraftContext): DraftState {
  const first = state.players.findIndex((player) => !isFull(player));
  if (first < 0) {
    return { ...state, phase: 'finish', current: 0 };
  }
  return { ...deal({ ...state, current: first }, context), phase: 'pick' };
}

/**
 * A player whose offer came up empty: nothing legal is left for them, which
 * the stock check makes rare but not impossible once the others have
 * drafted. Their deck stops where it is, short, and the draft goes on
 * without them; the finish page then refuses to save it, by design.
 */
export function skipCurrent(state: DraftState, context: DraftContext): DraftState {
  const players = state.players.map((player, i) =>
    i === state.current ? { ...player, deckSize: cardCount(player) } : player,
  );
  return nextTurn({ ...state, players }, context);
}
