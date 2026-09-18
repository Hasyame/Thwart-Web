import type { Card, IndexRow } from '../types';

/**
 * A card as the deck rules read it, from an index row.
 *
 * The validator and the hero rules were written against MarvelCDB's full
 * card record. The draft runs off the index alone — offline, without loading
 * sixty pack files — so the index carries the handful of fields the rules
 * read (types.ts, `IndexRow`) and this turns a row back into that shape.
 * Every rule the editor applies is then the same function applied here;
 * nothing about legality is written twice.
 */
export function cardFromRow(row: IndexRow): Card {
  const res = row.res ?? '';
  const count = (letter: string): number => res.split(letter).length - 1;
  return {
    code: row.code,
    name: row.name,
    subname: row.subname,
    type_code: row.typeCode,
    type_name: row.typeName,
    faction_code: row.factionCode,
    faction_name: row.factionName,
    pack_code: row.packCode,
    pack_name: '',
    card_set_code: row.setCode,
    cost: row.cost,
    is_unique: row.isUnique,
    quantity: row.quantity ?? 1,
    deck_limit: row.deckLimit ?? 3,
    hidden: row.hidden === true,
    // The rules split on the dot, as MarvelCDB writes them.
    traits: (row.traits ?? []).join('. ') + ((row.traits ?? []).length > 0 ? '.' : ''),
    resource_physical: count('P'),
    resource_mental: count('M'),
    resource_energy: count('E'),
    resource_wild: count('W'),
    deck_requirements: row.deckRules?.requirements ?? undefined,
    deck_options: row.deckRules?.options ?? undefined,
  } as Card;
}
