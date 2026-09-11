/**
 * A game played again is the game that was played.
 *
 * `replayOf` is the inverse of `buildPlay` as far as the record allows, and the
 * way it fails is quiet: a seat that comes back with the wrong aspect, a
 * difficulty that silently drops to Standard, a modular set matched to the
 * wrong code. None of those throw. They put a different game on the table
 * than the one somebody asked for, and they would be noticed one scenario
 * later, if at all.
 *
 *   npm run test:replay
 */
import { buildPlay } from '../src/lib/plays.ts';
import { replayOf } from '../src/lib/replay.ts';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

// `crypto.randomUUID` is what buildPlay uses for the id.
globalThis.crypto ??= (await import('node:crypto')).webcrypto;

const SETS = [
  { code: 'rhino', name: 'Rhino', type: 'villain', packCode: 'core' },
  { code: 'masters_of_evil', name: 'Masters of Evil', type: 'modular', packCode: 'core' },
  { code: 'bomb_scare', name: 'Bomb Scare', type: 'modular', packCode: 'core' },
  { code: 'legions_of_hydra', name: 'Legions of Hydra', type: 'modular', packCode: 'core' },
];

const DECKS = [
  { id: 'd-spidey', name: 'Web Warriors', heroCode: 'spiderman', heroName: 'Spider-Man', aspects: 'justice' },
  { id: 'd-cap', name: 'Shield Wall', heroCode: 'captain_america', heroName: 'Captain America', aspects: 'leadership,protection' },
];

function session(over = {}) {
  return {
    scenarioCode: 'rhino',
    scenarioName: 'Rhino',
    difficulty: 'EXPERT_I',
    standardSet: 'STANDARD_II',
    seats: [
      { deckId: 'd-spidey', deckName: 'Web Warriors', heroCode: 'spiderman', heroName: 'Spider-Man', aspect: 'justice' },
      { deckId: 'd-cap', deckName: 'Shield Wall', heroCode: 'captain_america', heroName: 'Captain America', aspect: 'leadership, protection' },
    ],
    modularSetCodes: ['masters_of_evil', 'bomb_scare'],
    accumulatedMillis: 0,
    runningSince: null,
    phase: 'playing',
    encounter: null,
    ...over,
  };
}

function record(s, over = {}) {
  return buildPlay({
    session: s,
    elapsedMillis: 3_600_000,
    won: true,
    notes: '',
    location: '',
    victoryPoints: 0,
    modularSetNames: ['Masters of Evil', 'Bomb Scare'],
    ...over,
  });
}

// --- the round trip --------------------------------------------------------------

{
  const original = session();
  const back = replayOf(record(original), DECKS, SETS).session;

  check('scenario comes back', back.scenarioCode === 'rhino' && back.scenarioName === 'Rhino');
  check('difficulty survives being lowercased on the way out', back.difficulty === 'EXPERT_I',
    `stored ${record(original).difficulty}, got ${back.difficulty}`);
  check('the standard set an expert game is played with comes back', back.standardSet === 'STANDARD_II');
  check('every seat comes back', back.seats.length === 2);
  check('and each seat is the deck it was', back.seats.map((s) => s.deckId).join(',') === 'd-spidey,d-cap');
  check('with its aspects', back.seats[1].aspect === 'leadership, protection');
  check('modular sets come back by code, in the order they were chosen',
    back.modularSetCodes.join(',') === 'masters_of_evil,bomb_scare', back.modularSetCodes.join(','));
  check('and are not reported as unknown', replayOf(record(original), DECKS, SETS).modularSetsUnknown === false);
  check('the codes are on the play itself, not only in the notes',
    record(original).modularSets === 'masters_of_evil,bomb_scare', record(original).modularSets);
}

// --- modular sets, on a play older than the field ---------------------------------

// Everything below blanks `modularSets`, because the point is what happens to
// a play recorded before either client kept the codes: the notes line is all
// there is.
const older = (over) => ({ ...record(session()), modularSets: '', ...over });

{
  const back = replayOf(older({}), DECKS, SETS).session;
  // As a set: buildPlay sorts the names when it writes the line, and the order
  // modular sets are listed in means nothing at setup.
  check('modular sets come back from the notes line',
    [...back.modularSetCodes].sort().join(',') === 'bomb_scare,masters_of_evil', back.modularSetCodes.join(','));
  check('the field wins over the notes when both are there',
    replayOf({ ...record(session()), notes: 'Modular sets: Legions of Hydra' }, DECKS, SETS)
      .session.modularSetCodes.join(',') === 'masters_of_evil,bomb_scare');
}

// --- what lands on the setup screen, and what must not ---------------------------

{
  const back = replayOf(record(session()), DECKS, SETS).session;
  check('nothing about the clock is carried', back.accumulatedMillis === undefined && back.runningSince === undefined);
  check('nor the phase: prepareSession decides that', back.phase === undefined);
}

// --- difficulty edge cases -------------------------------------------------------

{
  const standard = replayOf(record(session({ difficulty: 'STANDARD_I', standardSet: null })), DECKS, SETS).session;
  check('a standard game has no standard-set pairing', standard.standardSet === null);

  // An expert game whose row somehow lost its pairing must still be playable.
  const play = { ...record(session()), standardSet: '' };
  check('expert with no recorded pairing leaves it to be chosen', replayOf(play, DECKS, SETS).session.standardSet === null);

  const odd = { ...record(session()), difficulty: 'nightmare' };
  check('an unrecognised difficulty falls back rather than failing',
    replayOf(odd, DECKS, SETS).session.difficulty === 'STANDARD_I');
}

// --- seats without their decks ---------------------------------------------------

{
  // The deck was deleted since, or never existed on this device.
  const back = replayOf(record(session()), [], SETS).session;
  check('a seat whose deck is gone keeps its hero', back.seats[0].heroCode === 'spiderman' && back.seats[0].heroName === 'Spider-Man');
  check('and stands the hero in for the deck, as a paused game does', back.seats[0].deckId === 'spiderman');
  check('and keeps its aspect', back.seats[1].aspect === 'leadership, protection');
}

{
  // Same hero, different aspect: not the same deck, and must not be matched.
  const other = [{ id: 'd-spidey-agg', name: 'Punch', heroCode: 'spiderman', heroName: 'Spider-Man', aspects: 'aggression' }];
  const back = replayOf(record(session()), other, SETS).session;
  check('a deck with the same hero but another aspect is not taken', back.seats[0].deckId === 'spiderman');
}

{
  // Aspect order and case differ between a deck and a seat, and mean the same.
  const swapped = [{ id: 'd-cap2', name: 'Cap Again', heroCode: 'captain_america', heroName: 'Captain America', aspects: 'Protection,Leadership' }];
  const back = replayOf(record(session()), swapped, SETS).session;
  check('aspects are matched as a set, not a string', back.seats[1].deckId === 'd-cap2');
}

// --- modular sets ------------------------------------------------------------------

{
  const noLine = older({ notes: 'Great game.' });
  const r = replayOf(noLine, DECKS, SETS);
  check('a play with no modular line starts with none', r.session.modularSetCodes.length === 0);
  check('and says so, for the setup screen', r.modularSetsUnknown === true);

  const unknown = older({ notes: 'Modular sets: Masters of Evil, Something Made Up' });
  check('a name the database does not know is dropped, not guessed',
    replayOf(unknown, DECKS, SETS).session.modularSetCodes.join(',') === 'masters_of_evil');

  const mixed = older({ notes: 'Tough one.\nModular sets: Legions of Hydra\nRematch soon.' });
  check('the line is found among other notes',
    replayOf(mixed, DECKS, SETS).session.modularSetCodes.join(',') === 'legions_of_hydra');
}

{
  // Recorded with French cards, replayed after switching to English — or the
  // other way round. The caller passes both languages' lists, and a name in
  // either must resolve to the one code, once.
  const both = [
    ...SETS,
    { code: 'masters_of_evil', name: 'Maîtres du Mal', type: 'modular', packCode: 'core' },
    { code: 'bomb_scare', name: 'Alerte à la Bombe', type: 'modular', packCode: 'core' },
  ];
  const french = older({ notes: 'Modular sets: Alerte à la Bombe, Maîtres du Mal' });
  const back = replayOf(french, DECKS, both).session;
  check('a note written in the other card language still resolves',
    [...back.modularSetCodes].sort().join(',') === 'bomb_scare,masters_of_evil', back.modularSetCodes.join(','));
  const english = older({ notes: 'Modular sets: Masters of Evil' });
  check('and a code never comes back twice when both languages name it',
    replayOf(english, DECKS, both).session.modularSetCodes.length === 1);
}

// --- a play from the phone ----------------------------------------------------------

{
  // Android-shaped: no roster, the seats implied by heroCode and otherHeroes.
  const phone = {
    ...record(session()),
    roster: [],
    heroCode: 'spiderman', heroName: 'Spider-Man', aspects: 'justice',
    otherHeroes: 'Captain America',
    notes: '',
  };
  const back = replayOf(phone, DECKS, SETS).session;
  check('a phone-recorded play still yields its seats', back.seats.length === 2, `${back.seats.length} seats`);
  check('with the first hero named', back.seats[0].heroName === 'Spider-Man');
}


console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
