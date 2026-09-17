/**
 * Synergy between a card and an identity.
 *
 * Three things, in order of what they protect:
 *
 *  1. The shared fixture (`fixtures/synergy.json`), which the Android app
 *     tests against too. The derivation in scripts/lib/synergy.mjs and the
 *     browser's reading of it in src/lib/synergy.ts must both agree with it.
 *  2. The real card data, so the fixture's claims hold on what actually
 *     ships: Rocket Raccoon's condition, Adam Warlock's and Magik's faces.
 *  3. The list of "Play only if" the derivation does not read. Asserted
 *     exactly, so a new wording in a new pack fails here rather than quietly
 *     never warning anybody.
 *
 *   npm run test:synergy
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { compatible as compatibleMjs, synergyOf, traitKeys, unrecognised } from './lib/synergy.mjs';
import { compatible, identityTraitKeys, synergyProblems, traitKey } from '../src/lib/synergy.ts';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

const fixture = JSON.parse(readFileSync(new URL('./fixtures/synergy.json', import.meta.url), 'utf8'));

// --- the fixture: keys, conditions, compatibility -------------------------------------

for (const { traits, keys } of fixture.traitKeys) {
  check(`keys of "${traits}"`, traitKeys(traits).join(',') === keys.join(','), traitKeys(traits).join(','));
}

const cardsByCode = new Map(fixture.cards.map((card) => [card.code, card]));
for (const card of fixture.cards) {
  const derived = synergyOf(card);
  check(`${card.name}: condition ${JSON.stringify(card.synergy)}`,
    JSON.stringify(derived) === JSON.stringify(card.synergy), JSON.stringify(derived));
}

const identityKeys = (identity) => new Set(identity.faces.flatMap((face) => traitKeys(face)));
const identities = new Map(fixture.identities.map((identity) => [identity.id, identity]));
for (const { card, identity, compatible: expected } of fixture.compatibility) {
  const synergy = cardsByCode.get(card).synergy;
  const keys = identityKeys(identities.get(identity));
  check(`${cardsByCode.get(card).name} + ${identity}: ${expected ? 'compatible' : 'incompatible'} (derivation)`,
    compatibleMjs(synergy, [...keys]) === expected);
  check(`${cardsByCode.get(card).name} + ${identity}: ${expected ? 'compatible' : 'incompatible'} (browser)`,
    compatible(synergy, keys) === expected);
}
check('the browser keys a trait as the derivation does', traitKey('S.H.I.E.L.D.') === traitKeys('S.H.I.E.L.D.')[0]);

// --- the real data --------------------------------------------------------------------

const CARDS = join(import.meta.dirname, '..', 'public', 'data', 'cards', 'en');
const INDEX = join(import.meta.dirname, '..', 'public', 'data', 'index.en.json');
if (!existsSync(CARDS) || !existsSync(INDEX)) {
  console.error('No card data. Run `npm run data` first.');
  process.exit(1);
}
const cards = readdirSync(CARDS).flatMap((file) => JSON.parse(readFileSync(join(CARDS, file), 'utf8')));
const byCode = new Map(cards.map((card) => [card.code, card]));

{
  check('Rocket Raccoon (16019) needs a Guardian',
    JSON.stringify(synergyOf(byCode.get('16019'))) === '{"anyOfTraits":["guardian"]}');
  check('Adam Warlock\'s hero face is a Guardian and a Mystic',
    traitKeys(byCode.get('21031a').real_traits).join(',') === 'guardian,mystic');
  check('and his alter ego a Mystic only', traitKeys(byCode.get('21031b').real_traits).join(',') === 'mystic');
  check('Magik is a Mystic X-Men, Illyana a Mutant Mystic',
    traitKeys(byCode.get('45030a').real_traits).join(',') === 'mystic,x-men' &&
      traitKeys(byCode.get('45030b').real_traits).join(',') === 'mutant,mystic');
  check('the French text of Rocket Raccoon derives the same condition',
    JSON.stringify(synergyOf(JSON.parse(readFileSync(join(CARDS, '..', 'fr', 'gmw.json'), 'utf8')).find((c) => c.code === '16019'))) ===
      '{"anyOfTraits":["guardian"]}');

  const recognised = cards.filter((card) => synergyOf(card) !== null);
  check('a good number of cards carry a trait condition', recognised.length >= 80, String(recognised.length));
  const traits = new Set(recognised.flatMap((card) => synergyOf(card).anyOfTraits));
  check('every derived trait is a trait some identity face actually has',
    [...traits].every((trait) => cards.some((card) =>
      (card.type_code === 'hero' || card.type_code === 'alter_ego') && traitKeys(card.real_traits).includes(trait))),
    [...traits].filter((trait) => !cards.some((card) =>
      (card.type_code === 'hero' || card.type_code === 'alter_ego') && traitKeys(card.real_traits).includes(trait))).join(','));
}

// --- what the index carries, as the browser reads it -------------------------------------

{
  const index = JSON.parse(readFileSync(INDEX, 'utf8'));
  const rows = Array.isArray(index) ? index : (index.cards ?? index.rows);
  const rowOf = (code) => rows.find((row) => row.code === code);
  if (rowOf('16019')?.synergy === undefined) {
    console.log('note  the index predates the synergy field; run `npm run data` to check the browser side');
  } else {
    const warlock = identityTraitKeys(rows, '21031a');
    const magik = identityTraitKeys(rows, '45030a');
    check('Adam Warlock\'s faces, as the index has them', [...warlock].sort().join(',') === 'guardian,mystic', [...warlock].join(','));
    check('Magik\'s faces, both of them', [...magik].sort().join(',') === 'mutant,mystic,x-men', [...magik].join(','));
    const slots = new Map([['16019', 1], ['01050', 2], ['37021', 1]]);
    check('Warlock\'s deck: Rocket Raccoon fine, Mutant Education not',
      synergyProblems(slots, rowOf, warlock).map((row) => row.code).join(',') === '37021');
    check('Magik\'s deck: Rocket Raccoon is the problem',
      synergyProblems(slots, rowOf, magik).map((row) => row.code).join(',') === '16019');
    check('a zero slot is no problem', synergyProblems(new Map([['16019', 0]]), rowOf, magik).length === 0);
  }
}

// --- the conditions not read, exactly ---------------------------------------------------

{
  const EXPECTED = [
    '08018', '08033', '12003', '12004', '17005', '26009', '26010', '26011', '26012', '27017', '27048',
    '30020', '30021', '31021', '31022', '31023', '31024', '40017', '40058', '41030', '41032', '41033',
    '43016', '43038', '43040', '53023', '59027', '62037',
  ];
  const missed = unrecognised(cards).map((miss) => miss.code).sort();
  check('the "Play only if" not read are exactly the known ones', missed.join(',') === EXPECTED.join(','),
    `new: ${missed.filter((c) => !EXPECTED.includes(c)).join(',') || 'none'}; gone: ${EXPECTED.filter((c) => !missed.includes(c)).join(',') || 'none'}`);
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
