import type { HeroDeckRules } from '../deckRules';
import { imposedAspects } from './engine';

/**
 * The name a drafted deck gets unless the player changes it:
 * `DRAFT-SPIDERMAN-AGGRESSION-01`. The same on both clients, whatever the
 * language, so the aspect is its English code and the identity is folded to
 * capitals without accents, spaces or punctuation. The Android app's
 * `DraftNaming.kt`.
 */

const PREFIX = 'DRAFT';
/** What stands for the aspect when the identity's rule imposes them all. */
const IMPOSED = 'MULTI';

/** `Ms. Marvel` becomes `MSMARVEL`, `Nébula` becomes `NEBULA`, `SP//dr` becomes `SPDR`. */
export const fold = (name: string): string =>
  name
    .normalize('NFD')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/**
 * `MULTI` when the rule imposes the aspects (Adam Warlock); otherwise the
 * codes chosen, alphabetically, so a two-aspect identity reads the same
 * whichever order the player tapped them in.
 */
export const aspectPart = (aspects: readonly string[], rules: HeroDeckRules | null | undefined): string =>
  imposedAspects(rules) !== null
    ? IMPOSED
    : [...aspects]
        .sort()
        .map((aspect) => aspect.toUpperCase())
        .join('-');

/**
 * The next free name for the identity and aspects, given the names already
 * in use: the other decks on the device, and the ones of the same draft that
 * were named before this one. Case does not tell two names apart.
 */
export function defaultName(
  heroName: string,
  aspects: readonly string[],
  rules: HeroDeckRules | null | undefined,
  taken: Iterable<string>,
): string {
  const base = `${PREFIX}-${fold(heroName)}-${aspectPart(aspects, rules)}`;
  const used = new Set([...taken].map((name) => name.toUpperCase()));
  let suffix = 1;
  const candidate = (): string => `${base}-${String(suffix).padStart(2, '0')}`;
  while (used.has(candidate())) {
    suffix += 1;
  }
  return candidate();
}
