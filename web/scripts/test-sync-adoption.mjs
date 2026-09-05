/**
 * Signing in on a browser that already holds data.
 *
 * The flow it is unforgivable to get wrong: somebody's history either
 * duplicated or gone. The brief names three assertions to write before the
 * code, and they are here, plus the one that decides whether the whole thing
 * works at all — that a record present and identical on both sides is left
 * alone rather than uploaded straight back.
 *
 *   npm run test:adoption
 */
import { planAdoption } from '../src/lib/sync/adoption.ts';
import { digestForPulled } from '../src/lib/sync/engine.ts';

let failures = 0;
function check(label, ok, detail = '') {
  if (ok) {
    console.log(`ok    ${label}${detail ? `  (${detail})` : ''}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? `  (${detail})` : ''}`);
  }
}

const NOW = '2026-09-05T09:00:00.000Z';
const local = (collection, id, body) => ({ collection, id, body, updatedAt: NOW });
const server = (collection, id, body, revision = 1) => ({
  collection,
  id,
  revision,
  updatedAt: NOW,
  deleted: false,
  body,
});
const play = (id, extra = {}) => ({ id, playedAt: 1, scenarioCode: 'rhino', won: true, ...extra });

// --- nothing is written before the answer -------------------------------------------

{
  /*
   * The plan is a description, not an act. Everything the reader is shown comes
   * out of the same call that will do the work, so the dialogue cannot promise
   * one thing and the writer do another.
   */
  const plan = planAdoption(
    [local('plays', 'mine', play('mine'))],
    [server('plays', 'theirs', play('theirs'))],
  );
  check('a plan reports what would arrive', plan.incoming === 1);
  check('and what would upload', plan.local === 1);
  check('and writes only what the server sent', plan.writes.length === 1);
  check(
    'the local-only record is not in the writes, because nothing needs writing for it',
    plan.writes.every((write) => write.id !== 'mine'),
  );
  check('the account totals are reported per collection', plan.accountTotals.plays === 1);
}

// --- a record on both sides, identical ------------------------------------------------

{
  /*
   * The case that decides whether adoption is usable at all.
   *
   * Two devices holding the same record is the *common* case after a first
   * sync. Writing no state for it would leave every one of them looking like an
   * edit this browser owes, and the first sync after adoption would upload the
   * entire account back to itself.
   */
  const body = play('p1');
  const plan = planAdoption([local('plays', 'p1', body)], [server('plays', 'p1', body, 7)]);
  const write = plan.writes[0];

  check('an identical record counts as neither incoming nor local', plan.incoming === 0 && plan.local === 0);
  check('it is still written, so that a state exists for it', plan.writes.length === 1);
  check('with the revision the server gave it', write.revision === 7);
  check(
    'and a digest matching the row, so the next scan leaves it alone',
    write.digest === digestForPulled(server('plays', 'p1', body, 7)),
  );
}

// --- a record on both sides, differing ------------------------------------------------

{
  /*
   * The merge keeps `reportedToBgg: true`, so the merged row differs from what
   * the server holds — and the digest stored is the server's. The row therefore
   * hashes differently from its own state, which is exactly what marks it as
   * owed and uploads it, carrying the right baseRevision.
   */
  const here = play('p1', { reportedToBgg: true, notes: 'mine' });
  const there = play('p1', { reportedToBgg: false, notes: 'theirs' });
  const plan = planAdoption([local('plays', 'p1', here)], [server('plays', 'p1', there, 12)]);
  const write = plan.writes[0];

  check('a differing record is counted as a merge', plan.merged === 1);
  check('the merge keeps the report that already happened', write.row.reportedToBgg === true);
  check('and takes the rest from the account', write.row.notes === 'theirs');
  check(
    'the stored digest is the server body, so the merged row reads as owed',
    write.digest === digestForPulled(server('plays', 'p1', there, 12)),
  );
  check('and it carries the revision it is editing over', write.revision === 12);
}

// --- a deck both devices edited ---------------------------------------------------------

{
  const here = {
    id: 'decklist-1',
    name: 'Thor',
    slots: '01001=3',
    locallyEdited: true,
    lastSyncedAt: 1,
  };
  const there = { ...here, slots: '01002=2' };
  const plan = planAdoption([local('saved_decks', 'decklist-1', here)], [server('saved_decks', 'decklist-1', there, 3)], {
    newId: () => 'fixed',
    forkSuffix: ' (this browser)',
  });
  const write = plan.writes[0];

  check('a deck edited on both sides forks rather than picking a winner', plan.forks === 1);
  check('the account keeps the shared id', write.row.slots === '01002=2');
  check('and this browser keeps its own work under a new id', write.forked?.id === 'local-fixed');
  check('with its slots', write.forked?.row.slots === '01001=3');
  check('and a name telling them apart', write.forked?.row.name === 'Thor (this browser)');
}

// --- packs, which two devices name the same without ever meeting -------------------------

{
  const plan = planAdoption(
    [local('owned_packs', 'core', { packCode: 'core', quantity: 2 })],
    [server('owned_packs', 'core', { packCode: 'core', quantity: 1 })],
  );
  check(
    'a first merge keeps the larger count, because there is no history to judge by',
    plan.writes[0].row.quantity === 2,
    `got ${plan.writes[0].row.quantity}`,
  );
}

// --- a campaign that only this browser has -----------------------------------------------

{
  /*
   * The one the brief calls unforgivable. A run and its log exist here and
   * nowhere else; adoption must leave every one of them alone so the next scan
   * uploads them, and must not write a state that would make them look already
   * sent.
   */
  const events = Array.from({ length: 40 }, (_, i) =>
    local('campaign_events', `e${i}`, { id: `e${i}`, runId: 'r1', timestamp: i, payload: '{}' }),
  );
  const plan = planAdoption([local('campaign_runs', 'r1', { id: 'r1', name: 'Fear No Evil' }), ...events], []);

  check('a campaign the account has never seen is not written over', plan.writes.length === 0);
  check('every one of its events is counted as owed', plan.local === 41, `${plan.local} owed`);
  check(
    'and the tally names the collections it is in',
    plan.tallies.some((t) => t.collection === 'campaign_events' && t.local === 40),
  );
}

// --- tombstones, on a browser that has never synced ----------------------------------------

{
  const plan = planAdoption(
    [],
    [{ collection: 'plays', id: 'gone', revision: 4, updatedAt: NOW, deleted: true, body: null }],
  );
  check('a tombstone for a record this browser never had is nothing to do', plan.writes.length === 0);
  check('and is not counted as arriving', plan.incoming === 0);
  check('nor counted in what the account holds', plan.accountTotals.plays === undefined);
}

// --- a collection from a newer client --------------------------------------------------------

{
  const plan = planAdoption([], [server('something_newer', 'x', { a: 1 })]);
  check(
    'a collection this build does not know is skipped rather than guessed at',
    plan.writes.length === 0,
  );
  check('and no state is written, so a later build still picks it up', plan.incoming === 0);
}

process.exit(failures === 0 ? 0 : 1);
