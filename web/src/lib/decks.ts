import type { Card, IndexRow } from './types';
import type { SavedDeck } from './records';
import { heroRules } from './deckRules';

/**
 * Importing and reading MarvelCDB decks.
 *
 * Ported from `DeckRepository`, `MarvelCdbDeckUrl` and `DeckDto`, and it has to
 * be faithful in one specific way: the stored row must be byte-identical to
 * what the app would have written, id included. Both clients key a deck by
 * `decklist-12345`, so importing the same deck on a phone and in a browser
 * produces one deck rather than two — which is the property that makes the
 * eventual sync merge idempotent instead of duplicating.
 */

export type DeckKind = 'DECKLIST' | 'DECK';

export interface DeckReference {
  readonly id: number;
  readonly kind: DeckKind;
}

/*
 * Optional scheme, optional subdomain (www, or a locale such as fr), then
 * /decklist/view/<id> or /deck/view/<id>.
 *
 * The leading lookbehind is what stops a lookalike domain being accepted:
 * without it "notmarvelcdb.com/deck/view/1" matches, because the pattern is
 * searched for anywhere in the input rather than anchored.
 */
const URL_PATTERN =
  /(?<![A-Za-z0-9.-])(?:https?:\/\/)?(?:[A-Za-z0-9-]+\.)*marvelcdb\.com\/(decklist|deck)\/view\/(\d+)/i;

const BARE_ID_PATTERN = /^\s*(\d+)\s*$/;

/**
 * Extracts a deck reference from anything a person can paste.
 *
 * Share sheets rarely hand over a bare URL — they send "Look at this
 * https://marvelcdb.com/decklist/view/123/x #marvelchampions" — so this scans
 * for a URL inside free text rather than requiring the whole string to be one.
 */
export function parseDeckReference(input: string): DeckReference | null {
  if (input.trim() === '') {
    return null;
  }

  const match = URL_PATTERN.exec(input);
  if (match !== null && match[1] !== undefined && match[2] !== undefined) {
    const id = Number.parseInt(match[2], 10);
    if (!Number.isFinite(id)) {
      return null;
    }
    return { id, kind: match[1].toLowerCase() === 'decklist' ? 'DECKLIST' : 'DECK' };
  }

  // A bare number is ambiguous between the two id spaces. Published decklists
  // are what somebody is overwhelmingly likely to have in hand, and they are
  // the ones that always resolve.
  const bare = BARE_ID_PATTERN.exec(input);
  if (bare !== null && bare[1] !== undefined) {
    const id = Number.parseInt(bare[1], 10);
    return Number.isFinite(id) ? { id, kind: 'DECKLIST' } : null;
  }

  return null;
}

/** MarvelCDB keeps two id spaces: decklist 30000 and deck 30000 differ. */
export function deckApiUrl(reference: DeckReference): string {
  const path = reference.kind === 'DECKLIST' ? 'decklist' : 'deck';
  return `https://marvelcdb.com/api/public/${path}/${reference.id}`;
}

/** Namespaced for the same reason. Matches `DeckRepository.localId`. */
export function deckLocalId(reference: DeckReference): string {
  return `${reference.kind.toLowerCase()}-${reference.id}`;
}

export function deckViewUrl(deck: SavedDeck): string {
  const path = deck.kind === 'DECKLIST' ? 'decklist' : 'deck';
  return `https://marvelcdb.com/${path}/view/${deck.marvelCdbId}`;
}

/** A deck as MarvelCDB returns it. Both endpoints share this shape. */
interface DeckDto {
  readonly id: number;
  readonly name: string;
  readonly hero_code: string;
  readonly hero_name: string;
  readonly slots?: Record<string, number>;
  readonly ignoreDeckLimitSlots?: Record<string, number> | null;
  readonly description_md?: string | null;
  readonly version?: string | null;
  /** A JSON *string*, not an object — `"{\"aspect\":\"leadership\"}"`. */
  readonly meta?: string | null;
  readonly tags?: string | null;
}

export class DeckImportError extends Error {}

function joinSlots(slots: Record<string, number> | null | undefined): string {
  return Object.entries(slots ?? {})
    .map(([code, quantity]) => `${code}=${quantity}`)
    .join(',');
}

/** `code=qty` pairs back into a map. Mirrors `DeckRepository.parseSlots`. */
export function parseSlots(slots: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const entry of slots.split(',')) {
    if (entry.trim() === '') {
      continue;
    }
    const [code, quantity] = entry.split('=');
    const parsed = Number.parseInt(quantity ?? '', 10);
    if (code !== undefined && code !== '' && Number.isFinite(parsed)) {
      out.set(code, parsed);
    }
  }
  return out;
}

/** A deck can carry two aspects, in a JSON string that needs a second parse. */
function aspectsFrom(meta: string | null | undefined): string[] {
  if (meta === null || meta === undefined || meta.trim() === '') {
    return [];
  }
  try {
    const parsed = JSON.parse(meta) as { aspect?: string; aspect2?: string };
    return [parsed.aspect, parsed.aspect2].filter(
      (value): value is string => typeof value === 'string' && value !== '',
    );
  } catch {
    // A deck whose meta will not parse is still a deck. Losing the aspect is
    // better than refusing the import.
    return [];
  }
}

/**
 * Fetches a deck and maps it into the app's stored shape.
 *
 * `rawJson` keeps the untouched response, exactly as the app does, so the
 * original import is always recoverable no matter what is derived from it.
 */
export async function importDeck(reference: DeckReference): Promise<SavedDeck> {
  const url = deckApiUrl(reference);

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new DeckImportError('network');
  }
  if (!response.ok) {
    throw new DeckImportError('not-found');
  }

  const raw = await response.text();
  // A decklist that does not exist answers 200 with an empty body, which is
  // the app's finding rather than a guess.
  if (raw.trim() === '') {
    throw new DeckImportError('not-found');
  }

  let dto: DeckDto;
  try {
    dto = JSON.parse(raw) as DeckDto;
  } catch {
    throw new DeckImportError('not-found');
  }
  if (typeof dto.hero_code !== 'string' || typeof dto.name !== 'string') {
    throw new DeckImportError('not-found');
  }

  return {
    id: deckLocalId(reference),
    marvelCdbId: dto.id,
    kind: reference.kind,
    url,
    name: dto.name,
    heroCode: dto.hero_code,
    heroName: dto.hero_name,
    aspects: aspectsFrom(dto.meta).join(','),
    slots: joinSlots(dto.slots),
    ignoreDeckLimitSlots: joinSlots(dto.ignoreDeckLimitSlots),
    descriptionMd: dto.description_md ?? null,
    version: dto.version ?? null,
    tags: dto.tags ?? null,
    rawJson: raw,
    lastSyncedAt: Date.now(),
    locallyEdited: false,
  };
}

/** A hero somebody can build a deck for, as the build form lists them. */
export interface HeroIdentity {
  /** The hero card's code — what a deck is built around. */
  readonly code: string;
  /** The name, with the alter ego added when two heroes share it. */
  readonly label: string;
}

/**
 * Every hero in the pool, once each, told apart when they need to be.
 *
 * The index holds more hero *cards* than there are heroes. Ant-Man and Wasp
 * have a Giant form printed as a second hero card, and Ironheart levels up
 * through three; those are forms of one identity, not three decks to build.
 * A hero's cards share its set, so one identity per hero set, and the
 * first-printed card is the one a deck is keyed on — it is the code MarvelCDB
 * puts on every decklist, which is what an import arrives with.
 *
 * And then two heroes really can share a name: there are two Spider-Men and
 * two Black Panthers. Those get their alter ego in brackets, read from the
 * alter-ego card of the same set, so the list says Spider-Man (Peter Parker)
 * and Spider-Man (Miles Morales) rather than Spider-Man twice.
 */
export function heroIdentities(index: readonly IndexRow[]): readonly HeroIdentity[] {
  const firstOfSet = new Map<string, IndexRow>();
  for (const row of index) {
    if (row.typeCode !== 'hero') {
      continue;
    }
    const key = row.setCode ?? row.code;
    const held = firstOfSet.get(key);
    if (held === undefined || row.code < held.code) {
      firstOfSet.set(key, row);
    }
  }

  const alterEgoOfSet = new Map<string, string>();
  for (const row of index) {
    if (row.typeCode === 'alter_ego' && row.setCode !== null && !alterEgoOfSet.has(row.setCode)) {
      alterEgoOfSet.set(row.setCode, row.name);
    }
  }

  const heroes = [...firstOfSet.values()];
  const sharingName = new Map<string, number>();
  for (const hero of heroes) {
    sharingName.set(hero.name, (sharingName.get(hero.name) ?? 0) + 1);
  }

  return heroes
    .map((hero) => {
      const alterEgo = hero.setCode === null ? undefined : alterEgoOfSet.get(hero.setCode);
      const ambiguous = (sharingName.get(hero.name) ?? 0) > 1;
      return {
        code: hero.code,
        label: ambiguous && alterEgo !== undefined ? `${hero.name} (${alterEgo})` : hero.name,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The slots a deck for this hero starts with: the signature cards, at their
 * printed quantity.
 *
 * What the phone does on "new deck" and what a MarvelCDB decklist carries --
 * a published Phoenix list holds her twelve signature cards among its
 * forty-two -- so a deck built here starts where one built anywhere else
 * does, and the validator has nothing to say about it from the first
 * second. The rule for which cards those are lives in `heroRules`.
 */
export function signatureSlots(hero: Card, packCards: readonly Card[]): Record<string, number> {
  return Object.fromEntries(heroRules(hero, packCards).requiredCards);
}

/**
 * The aspects a deck plays, read off its cards.
 *
 * Nobody declares an aspect at a card table: the deck is built and the
 * aspect is whatever the cards say. So the editor asks for a hero only, and
 * the aspects are the distinct aspect factions among the cards chosen --
 * basic cards belong to nobody, and the hero's own cards carry factions of
 * their own (Spider-Woman's four events are one of each) that say nothing
 * about the deck. In the order first met, so a deck's first aspect stays
 * first; MarvelCDB's `aspects` field is a comma list in the same shape.
 */
export function inferAspects(
  slots: ReadonlyMap<string, number>,
  rowOf: (code: string) => IndexRow | undefined,
  heroSetCode: string | null,
): string[] {
  const seen: string[] = [];
  for (const [code, quantity] of slots) {
    if (quantity < 1) {
      continue;
    }
    const row = rowOf(code);
    if (row === undefined || row.factionCode === 'basic' || row.factionCode === 'hero' || row.factionCode === 'encounter') {
      continue;
    }
    if (row.setCode !== null && row.setCode === heroSetCode) {
      continue;
    }
    if (!seen.includes(row.factionCode)) {
      seen.push(row.factionCode);
    }
  }
  return seen;
}

/** The card types a player deck can hold. */
const PLAYER_TYPES: ReadonlySet<string> = new Set(['ally', 'event', 'upgrade', 'support', 'resource']);

/**
 * Whether a card can be offered to a deck being built for a hero.
 *
 * Two cuts. The first is by type: treacheries, minions and main schemes are
 * the encounter deck's and can never go in a player's deck; the first editor
 * offered them, and the validator had nothing to say about it — off-aspect is
 * the wrong complaint for a card that is not a player card at all.
 *
 * The second is by set. Aspect and basic cards belong to nobody and are the
 * pool a deck is built from. A card that belongs to a set belongs to
 * something: a hero's signature cards go only in that hero's deck, and the
 * rest — invocations and weather decks, campaign upgrades, an ally a
 * scenario hands out — are put on the table by a rule, never chosen. So a
 * card with a set is offered only when the set is the hero's own. Hulk Smash
 * stops appearing in a Spider-Man deck, and Spider-Woman's four aspect events
 * appear in hers alone.
 */
export function buildableFor(row: IndexRow, heroSetCode: string | null): boolean {
  if (!PLAYER_TYPES.has(row.typeCode) || row.factionCode === 'encounter') {
    return false;
  }
  return row.setCode === null || row.setCode === heroSetCode;
}

export interface DeckCard {
  readonly card: IndexRow;
  readonly quantity: number;
  /** True when no owned pack contains this card. */
  readonly missingFromCollection: boolean;
}

export interface DeckContents {
  readonly hero: IndexRow | null;
  readonly byType: readonly { readonly type: string; readonly cards: readonly DeckCard[] }[];
  readonly totalCards: number;
  readonly missing: readonly DeckCard[];
  /** Codes the card database has never heard of. */
  readonly unknownCodes: readonly string[];
}

/**
 * Resolves a deck's slots against the card database and the collection.
 *
 * The collection check is the reason this is worth having on the web at all:
 * MarvelCDB will show anybody the deck, but only this knows whether *you* can
 * build it. Grouped and sorted as `DeckContents` does it — by type name, then
 * card name — so the two clients list a deck the same way.
 */
export function resolveDeck(
  deck: SavedDeck,
  index: readonly IndexRow[],
  ownedPackCodes: ReadonlySet<string>,
): DeckContents {
  const byCode = new Map(index.map((row) => [row.code, row] as const));
  const slots = parseSlots(deck.slots);

  const resolved: DeckCard[] = [];
  const unknownCodes: string[] = [];

  for (const [code, quantity] of slots) {
    const card = byCode.get(code);
    if (card === undefined) {
      unknownCodes.push(code);
      continue;
    }
    resolved.push({
      card,
      quantity,
      missingFromCollection: !ownedPackCodes.has(card.packCode),
    });
  }

  resolved.sort(
    (a, b) =>
      a.card.typeName.localeCompare(b.card.typeName) ||
      a.card.name.localeCompare(b.card.name),
  );

  const groups = new Map<string, DeckCard[]>();
  for (const entry of resolved) {
    const bucket = groups.get(entry.card.typeName);
    if (bucket === undefined) {
      groups.set(entry.card.typeName, [entry]);
    } else {
      bucket.push(entry);
    }
  }

  return {
    hero: byCode.get(deck.heroCode) ?? null,
    byType: [...groups.entries()].map(([type, cards]) => ({ type, cards })),
    totalCards: [...slots.values()].reduce((sum, n) => sum + n, 0),
    missing: resolved.filter((entry) => entry.missingFromCollection),
    unknownCodes,
  };
}
