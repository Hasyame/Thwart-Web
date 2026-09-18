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
 * The draft, pack by pack.
 *
 * Pure: every function takes the state and gives the next one, and every
 * draw comes from the seed, so a draft written down and reopened opens the
 * same packs, and a test gets the same draft twice. The identities and the
 * shelf are the Android app's `DraftEngine.kt`; the packs are the web's
 * reading of the table's own way of drafting, decided on 2026-09-18:
 *
 * - The packs are built **before** the first pick, once every identity is
 *   settled: one pack of `offerSize` distinct cards per card a player still
 *   needs, from what that player may take.
 * - A physical copy is in one pack at most, across every player: the shelf
 *   is decremented as the packs are built, and comes back up as they are
 *   opened and left.
 * - A card a deck may hold once — a unique, or "max 1 per deck" like the
 *   basic resources — is in one pack at most across all the packs built
 *   together, however many copies the shelf holds.
 * - When the shelf cannot fill every pack, the packs it can fill are built,
 *   and once a player has opened the last of theirs the cards left are
 *   shuffled into new packs so the draft carries on.
 */

const BASIC_FACTION = 'basic';
const DEFAULT_COPY_LIMIT = 3;
const BUILD_STRIDE = 1_000;
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

// --- packs ----------------------------------------------------------------------

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

/** The cards the current player may be offered right now, from the shelf. */
export function legalOffers(state: DraftState, context: DraftContext): IndexRow[] {
  const player = state.players[state.current];
  if (player === undefined) {
    return [];
  }
  return playerPool(state, player, context).filter((row) => canTake(player, row, context));
}

/**
 * A card a deck holds once: a unique, or one printed "max 1 per deck", as
 * the basic resources are. Whatever the shelf holds, one copy is all a
 * building of packs may place, since one is all any deck could take.
 */
const holdsOnce = (row: IndexRow): boolean => row.isUnique || row.deckLimit === 1;

/** Copies of the card this deck may still take, beyond what it holds. */
function copiesLeftFor(player: DraftPlayer, row: IndexRow, context: DraftContext): number {
  const rules = player.heroCode === null ? undefined : context.rules.get(player.heroCode);
  if (rules === undefined) {
    return 0;
  }
  const limit = row.isUnique ? 1 : (rules.copyLimitOverride ?? row.deckLimit ?? DEFAULT_COPY_LIMIT);
  return Math.max(0, limit - (slotsOf(player).get(row.code) ?? 0));
}

/**
 * Builds packs for the players named, from the shelf as it stands.
 *
 * Round by round — a pack for each player in turn, then another — so a
 * shelf that cannot fill everybody's is shared rather than emptied into the
 * first player's. Only cards the deck could take as it stands go in, and
 * only full packs are built: a player's packs together never hold more
 * copies of a card than their deck may still take, and a card that holds
 * once is placed once in the whole building. A player whose shelf cannot
 * fill another pack stops getting them; the draft rebuilds from what is
 * left, the opened packs' cards included, when they open their last.
 */
export function buildPacks(state: DraftState, context: DraftContext, forPlayers?: readonly number[]): DraftState {
  const stock: Record<string, number> = { ...state.stock };
  const packs = state.players.map((_, i) => [...(state.packs[i] ?? [])]);
  const wanted = new Set(forPlayers ?? state.players.map((p) => p.index));
  const random = seeded(state.seed + BUILD_STRIDE * (state.builds + 1));
  const placedOnce = new Set<string>();
  const placed = state.players.map(() => new Map<string, number>());
  const needed = state.players.map((player, i) =>
    wanted.has(i) ? Math.max(0, remaining(player) - (packs[i]?.length ?? 0)) : 0,
  );
  // What each player may take as their deck stands, judged once per
  // building: the picks do not move while the packs are made. Read off the
  // whole shelf, and narrowed to what is still on it pack by pack.
  const legal = state.players.map((player, i) =>
    (needed[i] ?? 0) > 0
      ? playerPool({ ...state, stock: Object.fromEntries(context.initialStock) }, player, context).filter((row) =>
          canTake(player, row, context),
        )
      : [],
  );
  const rounds = Math.max(0, ...needed);
  for (let round = 0; round < rounds; round += 1) {
    for (const [i, player] of state.players.entries()) {
      if ((needed[i] ?? 0) <= round) {
        continue;
      }
      const mine = placed[i] as Map<string, number>;
      const pool = (legal[i] ?? []).filter((row) => {
        if ((stock[row.code] ?? 0) <= 0 || (holdsOnce(row) && placedOnce.has(row.code))) {
          return false;
        }
        return (mine.get(row.code) ?? 0) < copiesLeftFor(player, row, context);
      });
      const pack = shuffled(pool, random)
        .slice(0, state.settings.offerSize)
        .map((row) => row.code);
      // Only a full pack is built. The shelf's distinct cards run out long
      // before its copies do — a copy is in one pack at most — and a short
      // pack built now would be opened later, when the cards left in the
      // packs before it are back on the shelf and could have filled it. The
      // draft rebuilds from that fuller shelf instead.
      if (pack.length < state.settings.offerSize) {
        needed[i] = 0;
        continue;
      }
      for (const code of pack) {
        stock[code] = (stock[code] ?? 1) - 1;
        mine.set(code, (mine.get(code) ?? 0) + 1);
        const row = context.pool.get(code);
        if (row !== undefined && holdsOnce(row)) {
          placedOnce.add(code);
        }
      }
      (packs[i] as string[][]).push(pack);
    }
  }
  return { ...state, stock, packs, builds: state.builds + 1 };
}

/** The shelf with these cards put back on it. */
function returned(stock: Readonly<Record<string, number>>, codes: readonly string[]): Record<string, number> {
  const out: Record<string, number> = { ...stock };
  for (const code of codes) {
    out[code] = (out[code] ?? 0) + 1;
  }
  return out;
}

/**
 * Opens the current player's next pack and puts it on the table.
 *
 * A card the deck can no longer take — the packs were built before the picks
 * that came between — goes back on the shelf unseen; a pack with nothing
 * left in it is passed over. When the player's packs are all opened and
 * their deck is not yet full, the shelf is shuffled into new full packs
 * once; when even one full pack cannot be made, what is left that the deck
 * can take goes on the table as a last, shorter pack, and an empty table
 * means nothing legal is left for them.
 */
export function openPack(state: DraftState, context: DraftContext): DraftState {
  const player = state.players[state.current];
  if (player === undefined || isFull(player)) {
    return { ...state, offer: [] };
  }
  let next = state;
  let rebuilt = false;
  for (;;) {
    const queue = next.packs[next.current] ?? [];
    const pack = queue[0];
    if (pack === undefined) {
      if (rebuilt) {
        const random = seeded(next.seed + BUILD_STRIDE * next.builds + next.pickCount);
        const last = shuffled(legalOffers(next, context), random)
          .slice(0, next.settings.offerSize)
          .map((row) => row.code);
        const stock = { ...next.stock };
        for (const code of last) {
          stock[code] = (stock[code] ?? 1) - 1;
        }
        return { ...next, stock, offer: last };
      }
      rebuilt = true;
      next = buildPacks(next, context, [next.current]);
      continue;
    }
    const rest = queue.slice(1);
    const packs = next.packs.map((q, i) => (i === next.current ? rest : q));
    const legal: string[] = [];
    const back: string[] = [];
    for (const code of pack) {
      const row = context.pool.get(code);
      (row !== undefined && canTake(player, row, context) ? legal : back).push(code);
    }
    next = { ...next, packs, stock: returned(next.stock, back) };
    if (legal.length > 0) {
      return { ...next, offer: legal };
    }
  }
}

/**
 * The current player takes the card. The rest of the pack goes back on the
 * shelf, and the turn passes to the next player who still has room; when
 * nobody has room the draft is over.
 */
export function pick(state: DraftState, canonicalCode: string, context: DraftContext): DraftState {
  if (!state.offer.includes(canonicalCode)) {
    throw new Error(`not on the table: ${canonicalCode}`);
  }
  const players = state.players.map((player, i) =>
    i === state.current ? { ...player, picks: [...player.picks, canonicalCode] } : player,
  );
  const stock = returned(state.stock, state.offer.filter((code) => code !== canonicalCode));
  return nextTurn({ ...state, players, stock, pickCount: state.pickCount + 1, offer: [] }, context);
}

/** The next player with room opens a pack, or the draft ends. */
export function nextTurn(state: DraftState, context: DraftContext): DraftState {
  if (everyoneFull(state)) {
    return { ...state, phase: 'finish', current: 0, offer: [] };
  }
  let next = state.current;
  do {
    next = (next + 1) % state.players.length;
  } while (isFull(state.players[next] as DraftPlayer));
  return { ...openPack({ ...state, current: next }, context), phase: 'pick' };
}

/**
 * The first turn, once every identity is settled: every player's packs are
 * built from the shelf, and the first player opens one.
 */
export function start(state: DraftState, context: DraftContext): DraftState {
  const first = state.players.findIndex((player) => !isFull(player));
  if (first < 0) {
    return { ...state, phase: 'finish', current: 0 };
  }
  const built = buildPacks({ ...state, packs: state.players.map(() => []) }, context);
  return { ...openPack({ ...built, current: first }, context), phase: 'pick' };
}

/**
 * A player whose table came up empty: nothing legal is left for them, even
 * after the shelf was shuffled into new packs. Their deck stops where it is,
 * short, their sealed packs go back on the shelf for the others, and the
 * draft goes on without them; the finish page then refuses to save it, by
 * design.
 */
export function skipCurrent(state: DraftState, context: DraftContext): DraftState {
  const players = state.players.map((player, i) =>
    i === state.current ? { ...player, deckSize: cardCount(player) } : player,
  );
  const sealed = (state.packs[state.current] ?? []).flat();
  const packs = state.packs.map((q, i) => (i === state.current ? [] : q));
  const stock = returned(state.stock, [...sealed, ...state.offer]);
  return nextTurn({ ...state, players, packs, stock, offer: [] }, context);
}
