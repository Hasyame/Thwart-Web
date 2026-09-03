/**
 * Change detection, which is the part with no second chance.
 *
 * There is no dirty flag anywhere in this app: a record counts as changed when
 * the digest of its body differs from the one the server last confirmed. That
 * buys immunity from the commonest sync bug — a write somewhere in the app that
 * forgets to mark a row — and it costs correctness in the digest instead.
 *
 * Two ways it can be wrong, and both are silent:
 *
 *   too eager  — every record looks dirty forever, so every sync re-uploads
 *                the whole account;
 *   too shy    — a real edit hashes the same as what came before and is never
 *                uploaded at all. That one loses somebody's data.
 *
 *   npm run test:sync
 */
import { digestOf } from '../src/lib/sync/state.ts';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

// --- the same record is the same digest ------------------------------------------

{
  const play = { id: 'a', won: true, elapsedMillis: 1000, roster: [{ code: '01001a' }] };
  check('a record hashes to itself', digestOf(play) === digestOf({ ...play }));

  // JSON.stringify keeps insertion order, so without canonicalising, a row read
  // back from IndexedDB in a different field order would look edited and every
  // sync would re-upload everything.
  const reordered = { roster: [{ code: '01001a' }], elapsedMillis: 1000, won: true, id: 'a' };
  check('field order does not change the digest', digestOf(play) === digestOf(reordered));

  // Adding an optional field the app has not set must not mark every existing
  // record dirty.
  check(
    'an absent field hashes like a field that was never there',
    digestOf({ ...play, notes: undefined }) === digestOf(play),
  );
}

// --- a real edit changes it -------------------------------------------------------

{
  const play = { id: 'a', won: true, victoryPoints: 7, notes: '' };
  check('a changed value changes the digest', digestOf(play) !== digestOf({ ...play, won: false }));
  check(
    'a changed number changes the digest',
    digestOf(play) !== digestOf({ ...play, victoryPoints: 8 }),
  );
  check('a new field changes the digest', digestOf(play) !== digestOf({ ...play, location: 'x' }));
  check(
    'a removed field changes the digest',
    digestOf(play) !== digestOf({ id: 'a', won: true, victoryPoints: 7 }),
  );

  // null and "" and 0 are different answers, and the app stores all three.
  check('null is not empty string', digestOf({ a: null }) !== digestOf({ a: '' }));
  check('zero is not false', digestOf({ a: 0 }) !== digestOf({ a: false }));
  check('a string number is not a number', digestOf({ a: '1' }) !== digestOf({ a: 1 }));
}

// --- nested, because half these records are ----------------------------------------

{
  const deck = { id: 'd', slots: { '01001a': 1, '01002': 2 }, tags: ['a', 'b'] };
  check(
    'a nested change is seen',
    digestOf(deck) !== digestOf({ ...deck, slots: { '01001a': 1, '01002': 3 } }),
  );
  check(
    'a nested key order does not matter',
    digestOf(deck) === digestOf({ ...deck, slots: { '01002': 2, '01001a': 1 } }),
  );
  // Order in an array is meaning: a campaign event log and a deck's roster are
  // both sequences.
  check(
    'array order does matter',
    digestOf(deck) !== digestOf({ ...deck, tags: ['b', 'a'] }),
  );
}

// --- tombstones ---------------------------------------------------------------------

check('a deleted record has a digest of its own', digestOf(null) === digestOf(null));
check('and it is not the digest of an empty body', digestOf(null) !== digestOf({}));

// --- it stays a 32-bit unsigned number ----------------------------------------------

{
  // The FNV prime is applied as a sum of shifts because a plain multiply
  // overflows into a float and stops being the same function above 2^31.
  const many = Array.from({ length: 400 }, (_, i) => digestOf({ i, pad: 'x'.repeat(i) }));
  check('every digest is eight hex characters', many.every((d) => /^[0-9a-f]{8}$/.test(d)));
  check(
    'and they are not all the same',
    new Set(many).size > many.length * 0.9,
    `${new Set(many).size} distinct of ${many.length}`,
  );
}

process.exit(failures === 0 ? 0 : 1);
