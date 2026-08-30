import { normalizeForSearch } from './normalize.js';
import type { Locale } from './types';

/**
 * The Rules Reference glossary, searchable and offline.
 *
 * The data is deejimy's [mc-reference](https://github.com/deejimy/mc-reference)
 * under CC0-1.0, which is why this is the one dataset in the project that is
 * committed rather than fetched: it is a community-written reference, not
 * Fantasy Flight's card text. Every entry carries its French beside the English
 * it was translated from, so the two languages come from one source and cannot
 * drift apart.
 */

export interface RuleEntry {
  readonly term: string;
  readonly termFr: string;
  readonly en: string;
  readonly fr: string;
}

export interface RulesFile {
  readonly source: string;
  readonly sourceLicence: string;
  readonly sourceCredit: string;
  readonly entries: readonly RuleEntry[];
}

/**
 * A rule with an identity of its own.
 *
 * The term is **not unique**: the reference has three entries headed PLAY AREA
 * and two headed TEAMWORK (TRAIT), which are separate rules that happen to
 * share a heading. Keying a list on the term therefore both breaks the list
 * and, in an accordion, opens all three at once. Position in the file is what
 * distinguishes them, so it is carried alongside.
 */
export interface IdentifiedRule extends RuleEntry {
  readonly id: string;
}

export function identify(entries: readonly RuleEntry[]): IdentifiedRule[] {
  return entries.map((entry, index) => ({ ...entry, id: `${entry.term}#${index}` }));
}

export function ruleTerm(entry: RuleEntry, locale: Locale): string {
  return locale === 'fr' ? entry.termFr : entry.term;
}

export function ruleBody(entry: RuleEntry, locale: Locale): string {
  return locale === 'fr' ? entry.fr : entry.en;
}

/**
 * One line of a rule, with its depth.
 *
 * The source marks structure with `•` for a point and `»` for a point about
 * that point. Rendering it as one paragraph would throw that away, and these
 * are rules — the difference between a rule and its exception is the whole
 * value of the indent.
 */
export interface RuleLine {
  readonly depth: 0 | 1 | 2;
  readonly text: string;
}

export function ruleLines(body: string): RuleLine[] {
  const out: RuleLine[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      continue;
    }
    if (line.startsWith('»')) {
      out.push({ depth: 2, text: line.slice(1).trim() });
    } else if (line.startsWith('•')) {
      out.push({ depth: 1, text: line.slice(1).trim() });
    } else {
      out.push({ depth: 0, text: line });
    }
  }
  return out;
}

/**
 * Searches terms before bodies.
 *
 * Straight from the app's `RulesViewModel`, comment and all: searching "stun"
 * should put STUNNED at the top rather than the eleven other rules that
 * mention it. Both halves are folded through the same normaliser the card
 * search uses, so an accent or a capital never hides a rule.
 */
export function searchRules(
  entries: readonly IdentifiedRule[],
  query: string,
  locale: Locale,
): readonly IdentifiedRule[] {
  const needle = normalizeForSearch(query);
  if (needle === '') {
    return entries;
  }

  const matchesTerm = (entry: RuleEntry): boolean =>
    normalizeForSearch(ruleTerm(entry, locale)).includes(needle) ||
    // The other language's term too: somebody reading in French may well
    // search for the English word they saw printed on a card.
    normalizeForSearch(entry.term).includes(needle);

  const byTerm = entries.filter(matchesTerm);
  // Held apart by id, not term: two rules can share a heading, and excluding
  // by heading would drop the sibling that only matched in its body.
  const seen = new Set(byTerm.map((entry) => entry.id));
  const byBody = entries.filter(
    (entry) =>
      !seen.has(entry.id) &&
      normalizeForSearch(ruleBody(entry, locale)).includes(needle),
  );

  return [...byTerm, ...byBody];
}
