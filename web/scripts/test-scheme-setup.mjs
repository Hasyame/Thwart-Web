/**
 * The setup text, read off the cards.
 *
 * A port of the app's SchemeSetup, tested against the real card database in
 * both languages, because every quirk it works around is a quirk of the data:
 * three spellings of the heading, initials that are not sentence ends, and two
 * scenarios that genuinely print no setup at all.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setupSteps, briefingFor } from '../src/lib/schemeSetup.ts';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

const root = join(import.meta.dirname, '..', 'public', 'data', 'cards');
if (!existsSync(root)) {
  console.error('No card data. Run `npm run data` first.');
  process.exit(1);
}

const load = (locale) =>
  readdirSync(join(root, locale)).flatMap((file) =>
    JSON.parse(readFileSync(join(root, locale, file), 'utf8')),
  );

// --- the three spellings of the heading --------------------------------------

check(
  'plain heading',
  setupSteps('<b>Setup</b>: Put Ultron into play. Shuffle the deck.').length === 2,
);
check(
  'colon inside the tag, with spaces',
  setupSteps('<b> Setup: </b> Put Hela into play. Shuffle.').length === 2,
);
check(
  'French, with the space before the colon',
  setupSteps('<b>Mise en place</b> : Mettez Ultron en jeu. Mélangez.').length === 2,
);
check('no heading means no steps', setupSteps('Some other text entirely.').length === 0);
check('no text means no steps', setupSteps(null).length === 0);

// --- the full stops that are not sentence ends -------------------------------

{
  const steps = setupSteps('<b>Setup</b>: Gather Agents of S.H.I.E.L.D. and shuffle them.');
  check('an initial does not split a step', steps.length === 1, `${steps.length} steps`);

  // Mysterio's "(Shuffle.)" belongs to the sentence it follows. The full stop
  // before the bracket is not followed by a capital, and the one inside it is
  // not followed by whitespace, so neither splits and the aside cannot become
  // a step of its own.
  const aside = setupSteps('<b>Setup</b>: Put the deck into play. (Shuffle.) Draw six cards.');
  check('an aside does not become a step', aside.length === 1, `${aside.length} steps`);
  check('and nothing is lost with it', aside[0]?.includes('Shuffle') && aside[0]?.includes('Draw'));
}

// --- the markup ---------------------------------------------------------------

{
  const [step] = setupSteps('<b>Setup</b>: Search for an [[Avenger]] ally.');
  check('a trait becomes capitals', step?.includes('AVENGER') === true, step);

  const [perPlayer] = setupSteps('<b>Setup</b>: Discard 2[per_hero] cards.');
  // The rules reference calls the icon PER PLAYER, so the site does too.
  check('per_hero reads as per player', perPlayer?.includes('per player') === true, perPlayer);
  check('no space is left before the full stop', perPlayer?.includes(' .') === false, perPlayer);

  const [icon] = setupSteps('<b>Setup</b>: Place 1[mental] resource on it.');
  check('other icons are named', icon?.includes('MENTAL') === true, icon);
}

// --- against every scenario in both languages --------------------------------

for (const locale of ['en', 'fr']) {
  if (!existsSync(join(root, locale))) {
    continue;
  }
  const cards = load(locale);
  const sets = new Set(
    cards.filter((c) => c.card_set_type_name_code === 'villain').map((c) => c.card_set_code),
  );

  let withSteps = 0;
  let without = [];
  let leftoverMarkup = [];
  for (const setCode of sets) {
    const briefing = briefingFor(cards.filter((c) => c.card_set_code === setCode));
    if (briefing.steps.length > 0) {
      withSteps += 1;
    } else {
      without.push(setCode);
    }
    // Nothing should reach a reader with a tag or a bracket still in it.
    for (const step of briefing.steps) {
      if (/<[^>]+>|\[\[|\]\]/.test(step)) {
        leftoverMarkup.push(`${setCode}: ${step.slice(0, 40)}`);
      }
    }
  }

  console.log(`      ${locale}: ${withSteps}/${sets.size} scenarios print a setup`);
  check(`${locale}: no markup reaches the reader`, leftoverMarkup.length === 0, leftoverMarkup.slice(0, 2).join(' / '));
  // Ebony Maw and Thanos put theirs in the rules insert, and a handful of
  // older scenarios leave it to the campaign book, so some are expected.
  check(`${locale}: most scenarios print one`, withSteps > sets.size * 0.6, `${withSteps}/${sets.size}, without: ${without.slice(0, 6).join(', ')}`);
}

// --- the scheme is named even when there is no setup -------------------------

{
  const named = briefingFor([
    { name: 'The Power Cosmic', type_code: 'main_scheme', stage: '1A', text: 'No heading here.' },
    { name: 'The Power Cosmic', type_code: 'main_scheme', stage: '2A', text: null },
  ]);
  check('a scheme with no setup is still named', named.schemeName === 'The Power Cosmic', String(named.schemeName));
  check('and carries no steps', named.steps.length === 0);

  check('no scheme at all is answered honestly', briefingFor([]).schemeName === null);
}

process.exit(failures === 0 ? 0 : 1);
