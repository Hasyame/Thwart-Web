/**
 * Synergy between a card and an identity, derived once from the card text.
 *
 * Some aspect and basic cards say "Play only if your identity has the
 * [[Guardian]] trait." A deck may hold such a card whatever its identity — it
 * is a warning, never a legality rule — but a builder deserves to be told.
 *
 * The condition is read here, at data-fetch time, and written on the card as
 * `synergy: { anyOfTraits: ["guardian"] }` or `null`, so nothing has to run a
 * regular expression over four thousand cards in the browser. It reads the
 * **English** text (`real_text`, which both card languages carry) because that
 * is where traits are reliably written `[[Trait]]`; the French text also
 * exists, but is translated by hand and less regular.
 *
 * **This module is the contract with the Android app.** The phone ports these
 * same rules, and `scripts/fixtures/synergy.json` is the fixture both sides
 * test against. Dependency-free and pure on purpose, so it can be read as a
 * specification: a trait key is `traitKey()`, a condition is `synergyOf()`,
 * compatibility is `compatible()`.
 *
 * What is recognised, by design, is the trait condition only:
 *
 *   Play only if your identity has the [[X]] trait.
 *   Play only if you have the [[X]] trait.
 *   Play only if your identity has the [[X]] or [[Y]] trait.
 *
 * Everything else that begins "Play only if" — a hero form, a controlled
 * character, a printed hit-point total, the victory display — is reported by
 * `unrecognised()` and left out until the spec says otherwise. Including
 * "your hero has the [[X]] trait", which is a trait condition on one face
 * only and needs a decision before it can be encoded.
 */

/**
 * A trait as a language-independent key.
 *
 * Lowercase, the dots taken out (`S.H.I.E.L.D.` and `[[S.H.I.E.L.D.]]` are
 * both `shield`), hyphens kept (`x-men`), spaces collapsed. The same function
 * is applied to a card's traits and to a condition's, which is what makes them
 * comparable; the display name stays the localised one on the card.
 */
export function traitKey(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A MarvelCDB traits string as keys: "Avenger. S.H.I.E.L.D. Spy." → ["avenger",
 * "shield", "spy"]. Traits are separated by a dot and a space and the string
 * ends with a dot; the dots inside S.H.I.E.L.D. are neither.
 */
export function traitKeys(traitsString) {
  return String(traitsString ?? '')
    .split(/\.\s+|\.$/)
    .map(traitKey)
    .filter((key) => key !== '');
}

/** The trait condition, in the forms the cards actually use. */
const TRAIT_CONDITION =
  /play only if (?:your identity has|you have) the ((?:\[\[[^\]]+\]\](?:,? (?:or|and) )?)+) traits?\./i;

const TRAIT_TOKEN = /\[\[([^\]]+)\]\]/g;

/**
 * The condition a card carries, or null when it carries none.
 *
 * Reads the English text. A card whose text mentions "Play only if" in a
 * form this does not understand also yields null: it is not a synergy card
 * as far as the app can tell, and `unrecognised()` is where it is reported.
 */
export function synergyOf(card) {
  const text = card.real_text ?? card.text ?? '';
  const match = TRAIT_CONDITION.exec(text);
  if (match === null) {
    return null;
  }
  const traits = [...match[1].matchAll(TRAIT_TOKEN)].map((m) => traitKey(m[1]));
  const unique = [...new Set(traits)];
  return unique.length === 0 ? null : { anyOfTraits: unique };
}

/**
 * Whether an identity can play the card.
 *
 * `identityTraits` is the union of every face's trait keys — hero, alter ego,
 * and every further hero form — because the condition is met when any face
 * has the trait. A card with no condition is compatible with everyone.
 */
export function compatible(synergy, identityTraits) {
  if (synergy === null || synergy === undefined) {
    return true;
  }
  const have = new Set(identityTraits.map(traitKey));
  return synergy.anyOfTraits.some((trait) => have.has(trait));
}

/**
 * The player cards whose "Play only if" the derivation did not read.
 *
 * One line each: code, name, and the sentence. Printed by the fetch so a new
 * wording is noticed the day it appears, and asserted by the test so the
 * list only ever changes on purpose.
 */
export function unrecognised(cards) {
  const out = [];
  for (const card of cards) {
    if (!isPlayerCard(card)) {
      continue;
    }
    const text = card.real_text ?? card.text ?? '';
    // The rest of the line, not the sentence: a full stop inside
    // [[S.H.I.E.L.D.]] is not the end of one.
    for (const line of text.matchAll(/play only if[^\n]*/gi)) {
      if (!TRAIT_CONDITION.test(line[0])) {
        out.push({ code: card.code, name: card.name, condition: line[0].trim() });
      }
    }
  }
  return out;
}

const PLAYER_FACTIONS = new Set(['hero', 'basic', 'justice', 'protection', 'aggression', 'leadership', 'pool']);

/** A card that goes in a deck -- signature, aspect or basic -- not an identity, not encounter. */
export function isPlayerCard(card) {
  return PLAYER_FACTIONS.has(card.faction_code) && card.type_code !== 'hero' && card.type_code !== 'alter_ego';
}
