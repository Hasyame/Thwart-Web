import type { Card } from './types';

/**
 * Deck building rules, and what a deck is made of.
 *
 * Ported from `DeckRules`, `HeroDeckRulesParser`, `DeckValidator` and
 * `DeckStatistics`. The validator's governing principle is carried over with
 * it: **anything MarvelCDB does not encode is not checked.** It would rather
 * stay silent than invent a rule and call a legal deck illegal.
 */

/** The printed limit on an ordinary card, when the data does not say. */
const MAXIMUM_COPIES = 3;

/**
 * Deck size is not in the card data at all.
 *
 * Forty to fifty is the rule for every hero in the game so far; the app keeps
 * an override map for the day one departs from it, and that map is empty.
 */
const MINIMUM_DECK_SIZE = 40;
const MAXIMUM_DECK_SIZE = 50;

const BASIC_FACTION = 'basic';
const HERO_FACTION = 'hero';

/** An allowance that *permits* cards which would otherwise be off-aspect. */
interface DeckOption {
  readonly traits: readonly string[];
  readonly types: readonly string[];
  readonly resources: readonly string[];
  readonly limit: number | null;
}

export interface HeroDeckRules {
  readonly heroCode: string;
  readonly heroSetCode: string | null;
  readonly aspectCount: number;
  /** Adam Warlock's "no more than 1 copy of any non-Adam Warlock card". */
  readonly copyLimitOverride: number | null;
  readonly aspectsMustBalance: boolean;
  /** The hero's signature cards, by code and printed quantity. */
  readonly requiredCards: ReadonlyMap<string, number>;
  readonly identityTitle: string | null;
  readonly identityAlterEgo: string | null;
  readonly options: readonly DeckOption[];
  readonly minimum: number;
  readonly maximum: number;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  return typeof value === 'string' ? [value] : [];
}

/**
 * Builds a hero's rules from the raw fields on its card.
 *
 * `deck_requirements` and `deck_options` are carried by seven cards in the
 * entire pool — two with requirements, five with options — which is why the
 * app parses them lazily rather than modelling them. Without them the builder
 * would wrongly reject those seven heroes' legal decks.
 */
export function heroRules(hero: Card, packCards: readonly Card[]): HeroDeckRules {
  const raw = hero as unknown as Record<string, unknown>;

  const requirement = Array.isArray(raw['deck_requirements'])
    ? ((raw['deck_requirements'] as unknown[])[0] as Record<string, unknown> | undefined)
    : undefined;

  const aspectCount = Number(requirement?.['aspects'] ?? 1) || 1;

  // Adam Warlock's `{"aspects": 4, "limit": 1}`. The limit is on copies of a
  // card, not on cards per aspect: read the other way it made a legal
  // forty-card deck illegal, because one card from each of four aspects is a
  // four-card deck.
  const rawLimit = requirement?.['limit'];
  const copyLimitOverride =
    rawLimit === undefined || rawLimit === null ? null : Number(rawLimit) || null;

  const options: DeckOption[] = Array.isArray(raw['deck_options'])
    ? (raw['deck_options'] as unknown[]).map((entry) => {
        const obj = (entry ?? {}) as Record<string, unknown>;
        const limit = obj['limit'];
        return {
          traits: stringList(obj['trait']),
          types: stringList(obj['type']),
          resources: stringList(obj['resource']),
          limit: limit === undefined || limit === null ? null : Number(limit) || null,
        };
      })
    : [];

  const setCode = hero.card_set_code ?? null;

  /*
   * The identity's own cards, at the quantity printed on each. They are not
   * optional and not adjustable.
   *
   * Everything in the hero's set except the three things that are not deck
   * cards: the identity, the alter-ego, and the **obligation**, which is
   * shuffled into the encounter deck instead. That last one matters — Cyclops's
   * Lost Visor and Adam Warlock's Regeneration Cycle are obligations, and
   * requiring them makes those decks permanently illegal.
   *
   * Faction is deliberately not the filter. Spider-Woman's set holds one event
   * of each aspect, and those are her cards in every deck she builds, whichever
   * two aspects she picks.
   */
  const NOT_DECK_CARDS = new Set(['hero', 'alter_ego', 'obligation']);
  const requiredCards = new Map<string, number>();
  for (const card of packCards) {
    if (card.card_set_code !== setCode || card.code === hero.code) {
      continue;
    }
    if (NOT_DECK_CARDS.has(card.type_code)) {
      continue;
    }
    requiredCards.set(card.code, card.quantity ?? 1);
  }

  const alterEgo = packCards.find(
    (card) => card.type_code === 'alter_ego' && card.card_set_code === setCode,
  );

  return {
    heroCode: hero.code,
    heroSetCode: setCode,
    aspectCount,
    copyLimitOverride,
    // Every hero who picks more than one aspect has to balance them, so this
    // follows from the aspect count rather than being stated separately.
    aspectsMustBalance: aspectCount > 1,
    requiredCards,
    identityTitle: hero.name,
    identityAlterEgo: alterEgo?.name ?? null,
    options,
    minimum: MINIMUM_DECK_SIZE,
    maximum: MAXIMUM_DECK_SIZE,
  };
}

// --- validation ------------------------------------------------------------

export type DeckProblem =
  | { readonly kind: 'wrongAspectCount'; readonly chosen: number; readonly expected: number }
  | { readonly kind: 'tooFewCards'; readonly actual: number; readonly minimum: number }
  | { readonly kind: 'tooManyCards'; readonly actual: number; readonly maximum: number }
  | {
      readonly kind: 'missingRequired';
      readonly cardName: string;
      readonly required: number;
      readonly actual: number;
    }
  | { readonly kind: 'offAspect'; readonly cardName: string; readonly faction: string }
  | {
      readonly kind: 'overCopyLimit';
      readonly title: string;
      readonly total: number;
      readonly limit: number;
    }
  | { readonly kind: 'duplicateUnique'; readonly title: string; readonly total: number }
  | { readonly kind: 'unbalancedAspects'; readonly counts: ReadonlyMap<string, number> };

export interface DeckValidation {
  readonly problems: readonly DeckProblem[];
  readonly totalCards: number;
  readonly legal: boolean;
}

function hasTrait(card: Card, trait: string): boolean {
  const traits = card.traits ?? '';
  return traits
    .split('.')
    .map((t) => t.trim().toLowerCase())
    .includes(trait.trim().toLowerCase());
}

function hasResource(card: Card, resource: string): boolean {
  const key = `resource_${resource.toLowerCase()}` as keyof Card;
  return Number(card[key] ?? 0) > 0;
}

function optionMatches(option: DeckOption, card: Card): boolean {
  if (option.types.length > 0 && !option.types.includes(card.type_code)) {
    return false;
  }
  if (option.traits.length > 0 && !option.traits.some((t) => hasTrait(card, t))) {
    return false;
  }
  if (option.resources.length > 0 && !option.resources.some((r) => hasResource(card, r))) {
    return false;
  }
  // An allowance with no criteria at all would admit everything, which is
  // never what the data means.
  return (
    option.types.length > 0 || option.traits.length > 0 || option.resources.length > 0
  );
}

export function validateDeck(
  rules: HeroDeckRules,
  chosenAspects: readonly string[],
  slots: ReadonlyMap<string, number>,
  cards: ReadonlyMap<string, Card>,
): DeckValidation {
  const problems: DeckProblem[] = [];
  let totalCards = 0;
  for (const quantity of slots.values()) {
    totalCards += quantity;
  }

  if (chosenAspects.length !== rules.aspectCount) {
    problems.push({
      kind: 'wrongAspectCount',
      chosen: chosenAspects.length,
      expected: rules.aspectCount,
    });
  }
  if (totalCards < rules.minimum) {
    problems.push({ kind: 'tooFewCards', actual: totalCards, minimum: rules.minimum });
  }
  if (totalCards > rules.maximum) {
    problems.push({ kind: 'tooManyCards', actual: totalCards, maximum: rules.maximum });
  }

  for (const [code, required] of rules.requiredCards) {
    const actual = slots.get(code) ?? 0;
    if (actual !== required) {
      problems.push({
        kind: 'missingRequired',
        cardName: cards.get(code)?.name ?? code,
        required,
        actual,
      });
    }
  }

  // Copy limits by *title*, not by code: many titles are printed under more
  // than one code, so three of one printing and three of another is six copies
  // of the same card.
  const byTitle = new Map<string, { total: number; limit: number }>();
  for (const [code, quantity] of slots) {
    const card = cards.get(code);
    if (card === undefined || quantity < 1 || rules.requiredCards.has(code)) {
      continue;
    }
    // A unique card is limited to one by its own rule, checked below. Leaving
    // it here as well would report it twice.
    if (card.is_unique === true) {
      continue;
    }
    const limit = rules.copyLimitOverride ?? card.deck_limit ?? MAXIMUM_COPIES;
    const entry = byTitle.get(card.name) ?? { total: 0, limit };
    entry.total += quantity;
    entry.limit = Math.min(entry.limit, limit);
    byTitle.set(card.name, entry);
  }
  for (const [title, entry] of byTitle) {
    if (entry.total > entry.limit) {
      problems.push({ kind: 'overCopyLimit', title, total: entry.total, limit: entry.limit });
    }
  }

  // One copy of each unique card, counting the identity as one of them.
  // Grouped by title, then told apart by subtitle — but only where both have
  // one. Spider-Man (Miles Morales) and Spider-Man (Peter Parker) are two
  // people; a Captain America upgrade with no subtitle is the same Captain
  // America the deck is built around.
  const uniques = new Map<string, { subtitle: string; quantity: number }[]>();
  if (rules.identityTitle !== null) {
    uniques.set(rules.identityTitle, [
      { subtitle: rules.identityAlterEgo ?? '', quantity: 1 },
    ]);
  }
  for (const [code, quantity] of slots) {
    const card = cards.get(code);
    if (card === undefined || quantity < 1 || card.is_unique !== true) {
      continue;
    }
    const list = uniques.get(card.name) ?? [];
    list.push({ subtitle: card.subname ?? '', quantity });
    uniques.set(card.name, list);
  }
  for (const [title, copies] of uniques) {
    let groups: { subtitle: string; quantity: number }[][];
    if (copies.some((c) => c.subtitle.trim() === '')) {
      // One of them is the character plainly, so all of them are.
      groups = [copies];
    } else {
      const bySubtitle = new Map<string, { subtitle: string; quantity: number }[]>();
      for (const copy of copies) {
        const list = bySubtitle.get(copy.subtitle) ?? [];
        list.push(copy);
        bySubtitle.set(copy.subtitle, list);
      }
      groups = [...bySubtitle.values()];
    }
    for (const group of groups) {
      const total = group.reduce((sum, c) => sum + c.quantity, 0);
      if (total > 1) {
        problems.push({ kind: 'duplicateUnique', title, total });
      }
    }
  }

  // Aspect legality, and how much each chosen aspect contributes.
  const optionUsage = rules.options.map(() => 0);
  const aspectUsage = new Map<string, number>();

  for (const [code, quantity] of slots) {
    const card = cards.get(code);
    if (card === undefined || quantity < 1) {
      continue;
    }
    // The hero's own cards, whatever faction they carry, are never counted
    // towards a chosen aspect. Spider-Woman's set holds one event of each
    // aspect: they are hers in every deck.
    if (rules.heroSetCode !== null && card.card_set_code === rules.heroSetCode) {
      continue;
    }
    if (card.faction_code === HERO_FACTION) {
      // A hero-faction card from somebody else's set is never legal.
      problems.push({ kind: 'offAspect', cardName: card.name, faction: card.faction_code });
      continue;
    }
    if (card.faction_code === BASIC_FACTION) {
      continue;
    }
    if (chosenAspects.includes(card.faction_code)) {
      aspectUsage.set(
        card.faction_code,
        (aspectUsage.get(card.faction_code) ?? 0) + quantity,
      );
      continue;
    }

    // Off-aspect: admit it through one of the hero's allowances if one fits,
    // consuming capacity from the first that does.
    let admitted = false;
    for (let i = 0; i < rules.options.length; i += 1) {
      const option = rules.options[i];
      if (option === undefined || !optionMatches(option, card)) {
        continue;
      }
      if (option.limit === null) {
        admitted = true;
        break;
      }
      if ((optionUsage[i] ?? 0) + quantity <= option.limit) {
        optionUsage[i] = (optionUsage[i] ?? 0) + quantity;
        admitted = true;
        break;
      }
    }
    if (!admitted) {
      problems.push({ kind: 'offAspect', cardName: card.name, faction: card.faction_code });
    }
  }

  // Only checked once the right number of aspects has been chosen, because
  // complaining that one aspect and no other are unequal helps nobody.
  if (rules.aspectsMustBalance && chosenAspects.length === rules.aspectCount) {
    const counts = new Map(chosenAspects.map((a) => [a, aspectUsage.get(a) ?? 0]));
    if (new Set(counts.values()).size > 1) {
      problems.push({ kind: 'unbalancedAspects', counts });
    }
  }

  return { problems, totalCards, legal: problems.length === 0 };
}

// --- composition -----------------------------------------------------------

export interface ResourceCounts {
  readonly physical: number;
  readonly mental: number;
  readonly energy: number;
  readonly wild: number;
  readonly total: number;
}

export interface DeckStatistics {
  /** Cost to copies at that cost. Cards with no printed cost are excluded. */
  readonly costCurve: ReadonlyMap<number, number>;
  readonly resources: ResourceCounts;
  readonly byType: readonly (readonly [string, number])[];
  readonly byAspect: readonly (readonly [string, number])[];
  readonly costedCards: number;
  readonly averageCost: number;
  readonly tallestCostColumn: number;
}

/**
 * Counts a deck.
 *
 * Everything counts **copies**, not distinct cards: the question a deckbuilder
 * asks — how often will I draw something cheap — is about copies, and counting
 * rows would flatter every deck equally and answer nothing.
 *
 * The hero card is not included and must not be: it is not part of the deck,
 * has no cost, and would distort both the curve and the aspect split.
 */
export function deckStatistics(
  slots: ReadonlyMap<string, number>,
  cards: ReadonlyMap<string, Card>,
): DeckStatistics {
  const costCurve = new Map<number, number>();
  const types = new Map<string, number>();
  const aspects = new Map<string, number>();
  let physical = 0;
  let mental = 0;
  let energy = 0;
  let wild = 0;
  let costedCards = 0;
  let costTotal = 0;

  for (const [code, quantity] of slots) {
    const card = cards.get(code);
    if (card === undefined || quantity < 1) {
      continue;
    }

    if (card.cost !== null && card.cost !== undefined) {
      costCurve.set(card.cost, (costCurve.get(card.cost) ?? 0) + quantity);
      costedCards += quantity;
      costTotal += card.cost * quantity;
    }

    types.set(card.type_name, (types.get(card.type_name) ?? 0) + quantity);
    aspects.set(card.faction_name, (aspects.get(card.faction_name) ?? 0) + quantity);

    physical += (card.resource_physical ?? 0) * quantity;
    mental += (card.resource_mental ?? 0) * quantity;
    energy += (card.resource_energy ?? 0) * quantity;
    wild += (card.resource_wild ?? 0) * quantity;
  }

  const descending = (
    a: readonly [string, number],
    b: readonly [string, number],
  ): number => b[1] - a[1] || a[0].localeCompare(b[0]);

  return {
    costCurve,
    resources: { physical, mental, energy, wild, total: physical + mental + energy + wild },
    byType: [...types.entries()].sort(descending),
    byAspect: [...aspects.entries()].sort(descending),
    costedCards,
    averageCost: costedCards === 0 ? 0 : costTotal / costedCards,
    tallestCostColumn: Math.max(0, ...costCurve.values()),
  };
}
