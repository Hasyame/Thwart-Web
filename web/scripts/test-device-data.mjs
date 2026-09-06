/**
 * Whose data signing out takes, and whose it leaves.
 *
 * The rule is one line — remove a row only if the server holds a copy identical
 * to it — and every case the operator described falls out of it. These are
 * those cases, written as the story they came from.
 *
 * The decision is tested rather than the deleting: `partition` is the whole of
 * the policy, and the code around it reads tables and calls bulkDelete. There is
 * no fake IndexedDB in this project, so the Dexie half is not covered here.
 *
 *   npm run test:device
 */
import { partition, key } from '../src/lib/sync/device.ts';
import { PLAYS, CAMPAIGN_RUNS } from '../src/lib/sync/collections.ts';
import { digestOf } from '../src/lib/sync/state.ts';

let failures = 0;
function check(label, ok, detail = '') {
  if (ok) {
    console.log(`ok    ${label}${detail ? `  (${detail})` : ''}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? `  (${detail})` : ''}`);
  }
}

/** A recorded game, as the app stores one. */
const play = (id, extra = {}) => ({
  id,
  playedAt: 1_700_000_000_000,
  scenarioCode: '01097',
  scenarioName: 'Rhino',
  difficulty: 'standard',
  standardSet: 'standard',
  heroCode: '01001',
  heroName: 'Spider-Man',
  aspects: 'justice',
  otherHeroes: '',
  roster: [],
  players: 1,
  won: true,
  elapsedMillis: 0,
  notes: '',
  location: '',
  victoryPoints: 0,
  campaignRunId: null,
  reportedToBgg: false,
  photos: '',
  ...extra,
});

/** Says the server holds these rows, exactly as they are here. */
const serverHolds = (collection, rows) =>
  new Map(rows.map((row) => [key(collection.name, collection.idOf(row)), digestOf(collection.bodyOf(row))]));

// --- John's evening ----------------------------------------------------------

const A = play('a');
const B = play('b');
const C = play('c');
const D = play('d');

{
  /*
   * A and B were recorded before John had an account and were never uploaded.
   * C and D were recorded while signed in and have been synced.
   */
  const onServer = serverHolds(PLAYS, [C, D]);
  const { release, keep } = partition(PLAYS, [A, B, C, D], onServer);

  check("the account's games are released", release.join(',') === 'c,d', release.join(','));
  check("the machine's games are kept", keep.join(',') === 'a,b', keep.join(','));
}

{
  /*
   * The case that would have destroyed somebody's evening.
   *
   * Signing in and turning sync on are separate acts, so a game recorded while
   * signed in but never uploaded is ordinary rather than exotic. The server has
   * no copy of it, and nothing else does either.
   */
  const onServer = serverHolds(PLAYS, [C]);
  const { release, keep } = partition(PLAYS, [A, C, D], onServer);

  check('a game the server never got is kept', keep.includes('d'), keep.join(','));
  check('and the synced one still goes', release.join(',') === 'c', release.join(','));
}

{
  /*
   * John chose to sync A and B. They are the account's now, so signing out
   * takes them too — which is the operator's own refinement of the rule.
   */
  const onServer = serverHolds(PLAYS, [A, B, C, D]);
  const { release, keep } = partition(PLAYS, [A, B, C, D], onServer);

  check('everything uploaded is released', release.length === 4, release.join(','));
  check('nothing is left behind for the next person', keep.length === 0, keep.join(','));
}

{
  /*
   * A row edited since it was last pushed. The copy on the server is not this
   * row, so signing back in would not return what is here: the edit stays.
   */
  const edited = play('c', { notes: 'we nearly lost this one' });
  const onServer = serverHolds(PLAYS, [C]);
  const { release, keep } = partition(PLAYS, [edited], onServer);

  check('a locally edited row is kept', keep.join(',') === 'c', keep.join(','));
  check('and is not released', release.length === 0, release.join(','));
}

{
  // A browser that never synced has no bookkeeping, so nothing is the
  // account's and nothing may be taken.
  const { release, keep } = partition(PLAYS, [A, B], new Map());
  check('with no sync bookkeeping, nothing is released', release.length === 0);
  check('and everything is kept', keep.length === 2);
}

{
  // The same rule, on a different collection, to be sure nothing is keyed by
  // id alone: two collections may hold the same id without colliding.
  const run = { id: 'a', templateId: 'fear', createdAt: 1, difficulty: 'standard' };
  const onServerPlays = serverHolds(PLAYS, [A]);
  const { release } = partition(CAMPAIGN_RUNS, [run], onServerPlays);
  check(
    'a campaign is not released because a game shares its id',
    release.length === 0,
    release.join(','),
  );
}

console.log(failures === 0 ? '\nall rules hold' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
