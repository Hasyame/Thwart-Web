import type { Card } from './types';

/**
 * Whether a deck is legal, checked against the rules that are knowable.
 *
 * A port of the Android validator, which is the reference. Pure, so every rule
 * is testable without a card database or a browser — and these rules are worth
 * testing, because a validator that is wrong in the permissive direction is
 * useless and one that is wrong in the strict direction rejects decks people
 * have actually built.
 *
 * Deliberately silent about anything MarvelCDB does not encode. It would rather
 * say nothing than invent a rule.
 */

const BASIC_FACTION = 'basic';
const HERO_FACTION = 'hero';

/** The printed limit on an ordinary card, when the data does not say. */
const MAXIMUM_COPIES = 3;

/**
 * The one rule that is not in the card data anywhere.
 *
 * Copy limits, uniqueness, factions and the per-hero exceptions are all
 * encoded; the deck size is not. Named constants, so it is obvious this is
 * configured rather than derived.
 */
export const MINIMUM_DECK_SIZE = 40;
export const MAXIMUM_DECK_SIZE = 50;

/**
 * Heroes whose deck size departs from 40–50.
 *
 * Empty on purpose: no such hero is known, and inventing one would be worse
 * than having none. It exists so that adding one is a data change here rather
 * than a change to the validator.
 */
export const HERO_DECK_SIZE_OVERRIDES: Readonly<Record<string, readonly [number, number]>> = {};

/**
 * An entry of a hero's `deck_options`, which *permits* cards that would
 * otherwise be off-aspect. Five heroes have one; without it the builder rejects
 * their legal decks.
 */
export interface DeckOption {
  readonly traits: readonly string[];
  readonly types: readonly string[];
  readonly resources: readonly string[];
  /** How many cards this allowance admits. Null is unlimited. */
  readonly limit: number | null;
}

export interface HeroDeckRules {
  readonly heroCode: string;
  readonly heroSetCode: string | null;
  /** How many aspects this hero picks. One for nearly every hero. */
  readonly aspectCount: number;
  /**
   * A copy limit the identity imposes on every card that is not its own.
   *
   * Adam Warlock is the only hero with one. It overrides each card's printed
   * limit rather than adding to it, and it is a limit on *copies of a card* —
   * read as a cap on cards per aspect it makes every legal Adam Warlock deck
   * illegal, since one card from each of four aspects is a four-card deck.
   */
  readonly copyLimitOverride: number | null;
  /** True when the chosen aspects must contribute equally. Follows from the count. */
  readonly aspectsMustBalance: boolean;
  /** The identity's own cards and their printed quantities. Not adjustable. */
  readonly requiredCards: Readonly<Record<string, number>>;
  readonly identityTitle: string | null;
  /**
   * The alter-ego's name, standing in for the identity's subtitle.
   *
   * The identity card has none of its own, so without this the ally
   * "Spider-Man (Peter Parker)" looks like a different card and is allowed into
   * Peter Parker's deck. It is also why Miles Morales may be an ally there and
   * Peter may not.
   */
  readonly identityAlterEgo: string | null;
  readonly options: readonly DeckOption[];
  readonly minDeckSize: number | null;
  readonly maxDeckSize: number | null;
}

export const minimumFor = (rules: HeroDeckRules): number =>
  rules.minDeckSize ?? MINIMUM_DECK_SIZE;
export const maximumFor = (rules: HeroDeckRules): number =>
  rules.maxDeckSize ?? MAXIMUM_DECK_SIZE;

/** The part of a card the rules need. */
export interface DeckCardInfo {
  readonly code: string;
  readonly name: string;
  /**
   * The subtitle, which is what lets two unique cards of one name coexist:
   * Spider-Man (Miles Morales) and Spider-Man (Peter Parker) are two people.
   */
  readonly subtitle: string | null;
  readonly factionCode: string;
  readonly typeCode: string;
  readonly cardSetCode: string | null;
  readonly traits: string | null;
  readonly deckLimit: number | null;
  readonly isUnique: boolean;
  readonly resourcePhysical: number;
  readonly resourceMental: number;
  readonly resourceEnergy: number;
  readonly resourceWild: number;
}

export type DeckProblem =
  | { readonly kind: 'tooFewCards'; readonly actual: number; readonly required: number }
  | { readonly kind: 'tooManyCards'; readonly actual: number; readonly allowed: number }
  | { readonly kind: 'wrongAspectCount'; readonly actual: number; readonly required: number }
  | {
      readonly kind: 'offAspect';
      readonly cardCode: string;
      readonly cardName: string;
      readonly factionCode: string;
    }
  | {
      readonly kind: 'overCopyLimit';
      readonly cardCode: string;
      readonly cardName: string;
      readonly quantity: number;
      readonly limit: number;
    }
  | {
      readonly kind: 'duplicateUnique';
      readonly cardCode: string;
      readonly cardName: string;
      readonly quantity: number;
    }
  | {
      readonly kind: 'missingRequired';
      readonly cardCode: string;
      readonly cardName: string;
      readonly required: number;
      readonly actual: number;
    }
  | { readonly kind: 'unbalancedAspects'; readonly counts: Readonly<Record<string, number>> };

export interface DeckValidation {
  readonly problems: readonly DeckProblem[];
  readonly totalCards: number;
  readonly isLegal: boolean;
}

const hasTrait = (card: DeckCardInfo, trait: string): boolean =>
  (card.traits ?? '')
    .split('.')
    .some((entry) => entry.trim().toLowerCase() === trait.trim().toLowerCase());

const hasResource = (card: DeckCardInfo, resource: string): boolean => {
  switch (resource.toLowerCase()) {
    case 'physical':
      return card.resourcePhysical > 0;
    case 'mental':
      return card.resourceMental > 0;
    case 'energy':
      return card.resourceEnergy > 0;
    case 'wild':
      return card.resourceWild > 0;
    default:
      return false;
  }
};

const optionMatches = (option: DeckOption, card: DeckCardInfo): boolean => {
  if (option.types.length > 0 && !option.types.includes(card.typeCode)) {
    return false;
  }
  if (option.traits.length > 0 && !option.traits.some((trait) => hasTrait(card, trait))) {
    return false;
  }
  if (
    option.resources.length > 0 &&
    !option.resources.some((resource) => hasResource(card, resource))
  ) {
    return false;
  }
  // An allowance with no criteria would admit everything, which is never what
  // the data means.
  return option.types.length > 0 || option.traits.length > 0 || option.resources.length > 0;
};

/** Consumes capacity from the first allowance that fits. */
function admitByOption(
  rules: HeroDeckRules,
  card: DeckCardInfo,
  quantity: number,
  usage: number[],
): boolean {
  for (const [index, option] of rules.options.entries()) {
    if (!optionMatches(option, card)) {
      continue;
    }
    if (option.limit === null) {
      return true;
    }
    if ((usage[index] ?? 0) + quantity <= option.limit) {
      usage[index] = (usage[index] ?? 0) + quantity;
      return true;
    }
  }
  return false;
}

/**
 * Copy limits, counted by **title** rather than by card code.
 *
 * "No more than three copies" is about the card, not the printing: many titles
 * exist under more than one code, and counting by code lets three of one
 * printing and three of another through as six copies of the same card.
 *
 * The identity's signature cards are exempt — their printed quantity is the
 * rule for them, and it is checked on its own.
 */
function copyLimitProblems(
  rules: HeroDeckRules,
  slots: Readonly<Record<string, number>>,
  cards: ReadonlyMap<string, DeckCardInfo>,
): DeckProblem[] {
  const byTitle = new Map<string, { card: DeckCardInfo; quantity: number }[]>();

  for (const [code, quantity] of Object.entries(slots)) {
    if (quantity <= 0 || code in rules.requiredCards) {
      continue;
    }
    const card = cards.get(code);
    // A unique card is limited to one by its own rule, which counts the
    // identity too. Leaving it here as well would report the same card twice.
    if (card === undefined || card.isUnique) {
      continue;
    }
    const bucket = byTitle.get(card.name);
    if (bucket === undefined) {
      byTitle.set(card.name, [{ card, quantity }]);
    } else {
      bucket.push({ card, quantity });
    }
  }

  const problems: DeckProblem[] = [];
  for (const [title, entries] of byTitle) {
    const total = entries.reduce((sum, entry) => sum + entry.quantity, 0);
    // The identity's own limit wins where it has one.
    const limit =
      rules.copyLimitOverride ??
      Math.min(...entries.map((entry) => entry.card.deckLimit ?? MAXIMUM_COPIES));
    if (total > limit) {
      problems.push({
        kind: 'overCopyLimit',
        cardCode: entries[0]?.card.code ?? '',
        cardName: title,
        quantity: total,
        limit,
      });
    }
  }
  return problems;
}

/**
 * One copy of each unique card, counting the identity as one of them.
 *
 * Grouped by title, then told apart by subtitle — but only where every copy has
 * one. Spider-Man (Miles Morales) and Spider-Man (Peter Parker) are two people
 * and may share a deck; a Captain America upgrade carrying no subtitle is the
 * same Captain America the deck is built around. Reading a missing subtitle as
 * "somebody else" would let a good number of illegal cards through.
 */
function uniqueProblems(
  rules: HeroDeckRules,
  slots: Readonly<Record<string, number>>,
  cards: ReadonlyMap<string, DeckCardInfo>,
): DeckProblem[] {
  const byTitle = new Map<string, { code: string; subtitle: string; quantity: number }[]>();
  const add = (title: string, entry: { code: string; subtitle: string; quantity: number }) => {
    const bucket = byTitle.get(title);
    if (bucket === undefined) {
      byTitle.set(title, [entry]);
    } else {
      bucket.push(entry);
    }
  };

  if (rules.identityTitle !== null) {
    add(rules.identityTitle, {
      code: rules.heroCode,
      subtitle: rules.identityAlterEgo ?? '',
      quantity: 1,
    });
  }

  for (const [code, quantity] of Object.entries(slots)) {
    const card = cards.get(code);
    if (card === undefined || quantity < 1 || !card.isUnique) {
      continue;
    }
    add(card.name, { code, subtitle: card.subtitle ?? '', quantity });
  }

  const problems: DeckProblem[] = [];
  for (const [title, copies] of byTitle) {
    let groups: { code: string; subtitle: string; quantity: number }[][];
    if (copies.some((copy) => copy.subtitle.trim() === '')) {
      // One of them is the character plainly, so all of them are.
      groups = [copies];
    } else {
      const bySubtitle = new Map<string, { code: string; subtitle: string; quantity: number }[]>();
      for (const copy of copies) {
        const bucket = bySubtitle.get(copy.subtitle);
        if (bucket === undefined) {
          bySubtitle.set(copy.subtitle, [copy]);
        } else {
          bucket.push(copy);
        }
      }
      groups = [...bySubtitle.values()];
    }

    for (const group of groups) {
      const total = group.reduce((sum, copy) => sum + copy.quantity, 0);
      if (total > 1) {
        // Named after a card in the deck rather than the identity, which is
        // not something the reader can remove.
        const offender = group.find((copy) => copy.code !== rules.heroCode) ?? group[0];
        problems.push({
          kind: 'duplicateUnique',
          cardCode: offender?.code ?? '',
          cardName: title,
          quantity: total,
        });
      }
    }
  }
  return problems;
}

export function validateDeck(
  rules: HeroDeckRules,
  chosenAspects: readonly string[],
  /** Card code to quantity, the identity excluded. */
  slots: Readonly<Record<string, number>>,
  cards: ReadonlyMap<string, DeckCardInfo>,
): DeckValidation {
  const problems: DeckProblem[] = [];
  const totalCards = Object.values(slots).reduce((sum, quantity) => sum + quantity, 0);

  if (chosenAspects.length !== rules.aspectCount) {
    problems.push({
      kind: 'wrongAspectCount',
      actual: chosenAspects.length,
      required: rules.aspectCount,
    });
  }
  if (totalCards < minimumFor(rules)) {
    problems.push({ kind: 'tooFewCards', actual: totalCards, required: minimumFor(rules) });
  }
  if (totalCards > maximumFor(rules)) {
    problems.push({ kind: 'tooManyCards', actual: totalCards, allowed: maximumFor(rules) });
  }

  for (const [code, required] of Object.entries(rules.requiredCards)) {
    const actual = slots[code] ?? 0;
    if (actual !== required) {
      problems.push({
        kind: 'missingRequired',
        cardCode: code,
        cardName: cards.get(code)?.name ?? code,
        required,
        actual,
      });
    }
  }

  problems.push(...copyLimitProblems(rules, slots, cards));
  problems.push(...uniqueProblems(rules, slots, cards));

  const optionUsage = rules.options.map(() => 0);
  const aspectUsage: Record<string, number> = {};

  for (const [code, quantity] of Object.entries(slots)) {
    const card = cards.get(code);
    if (card === undefined || quantity < 1) {
      continue;
    }

    if (rules.heroSetCode !== null && card.cardSetCode === rules.heroSetCode) {
      /*
       * The identity's own cards, whatever faction they carry, and never
       * counted towards a chosen aspect. Spider-Woman's set holds one event of
       * each aspect: they are hers in every deck, and reading them as aspect
       * cards makes two of them illegal and throws off the balance between her
       * two chosen aspects.
       */
      continue;
    }
    if (card.factionCode === HERO_FACTION) {
      // Somebody else's hero card, which is never legal.
      problems.push({
        kind: 'offAspect',
        cardCode: code,
        cardName: card.name,
        factionCode: card.factionCode,
      });
      continue;
    }
    if (card.factionCode === BASIC_FACTION) {
      continue;
    }
    if (chosenAspects.includes(card.factionCode)) {
      aspectUsage[card.factionCode] = (aspectUsage[card.factionCode] ?? 0) + quantity;
      continue;
    }
    if (!admitByOption(rules, card, quantity, optionUsage)) {
      problems.push({
        kind: 'offAspect',
        cardCode: code,
        cardName: card.name,
        factionCode: card.factionCode,
      });
    }
  }

  /*
   * A hero who picks more than one aspect takes the same number from each.
   * Only checked once the right number has been chosen: complaining that one
   * aspect and no other are unequal helps nobody.
   */
  if (rules.aspectsMustBalance && chosenAspects.length === rules.aspectCount) {
    const counts: Record<string, number> = {};
    for (const aspect of chosenAspects) {
      counts[aspect] = aspectUsage[aspect] ?? 0;
    }
    if (new Set(Object.values(counts)).size > 1) {
      problems.push({ kind: 'unbalancedAspects', counts });
    }
  }

  return { problems, totalCards, isLegal: problems.length === 0 };
}

// --- reading the rules off a card ----------------------------------------------

const numberOf = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/**
 * A hero's deck-building rules, read off the identity card.
 *
 * Two heroes carry requirements and five carry options, so almost every hero
 * comes out of this with the defaults — which is why the data leaves the fields
 * empty rather than spelling out the ordinary case.
 */
export function heroDeckRules(
  hero: Card,
  requiredCards: Readonly<Record<string, number>> = {},
  alterEgoName: string | null = null,
): HeroDeckRules {
  const requirement = Array.isArray(hero.deck_requirements)
    ? (hero.deck_requirements[0] as Record<string, unknown> | undefined)
    : undefined;

  const aspectCount = numberOf(requirement?.aspects) ?? 1;
  const options = (Array.isArray(hero.deck_options) ? hero.deck_options : [])
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => ({
      traits: stringList(entry.trait),
      types: stringList(entry.type),
      resources: stringList(entry.resource),
      limit: numberOf(entry.limit),
    }));

  const override = HERO_DECK_SIZE_OVERRIDES[hero.code];

  return {
    heroCode: hero.code,
    heroSetCode: hero.card_set_code ?? null,
    aspectCount,
    copyLimitOverride: numberOf(requirement?.limit),
    // Picking more than one aspect always means picking them in equal number;
    // no hero picks several and is free to weight them.
    aspectsMustBalance: aspectCount > 1,
    requiredCards,
    identityTitle: hero.name,
    identityAlterEgo: alterEgoName,
    options,
    minDeckSize: override?.[0] ?? null,
    maxDeckSize: override?.[1] ?? null,
  };
}

export const deckCardInfo = (card: Card): DeckCardInfo => ({
  code: card.code,
  name: card.name,
  subtitle: card.subname ?? null,
  factionCode: card.faction_code,
  typeCode: card.type_code,
  cardSetCode: card.card_set_code ?? null,
  traits: card.traits ?? null,
  deckLimit: card.deck_limit ?? null,
  isUnique: card.is_unique === true,
  resourcePhysical: card.resource_physical ?? 0,
  resourceMental: card.resource_mental ?? 0,
  resourceEnergy: card.resource_energy ?? 0,
  resourceWild: card.resource_wild ?? 0,
});
