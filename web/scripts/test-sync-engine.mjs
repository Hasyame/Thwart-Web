/**
 * The engine that moves records, exercised on the cases that lose data.
 *
 * These are the three the Android client hit for real, plus the ones the brief
 * says to write before the code:
 *
 *   - a batch that fails, and the ones behind it that must not be sent;
 *   - a push whose own revisions must not be read straight back down, and the
 *     gap in them that means another device wrote and must not be stepped over;
 *   - a body that does not survive a round trip through its collection, which
 *     makes a row look permanently edited and ping-pong for ever.
 *
 * The engine takes its world as an argument precisely so these can be built
 * here without a browser.
 *
 *   npm run test:engine-sync
 */
import {
  batchesOf,
  cursorAfterPush,
  digestForPulled,
  isUnknown,
  pendingChanges,
  syncOnce,
} from '../src/lib/sync/engine.ts';
import { digestOf } from '../src/lib/sync/state.ts';
import { COLLECTIONS } from '../src/lib/sync/collections.ts';

let failures = 0;
function check(label, ok, detail = '') {
  if (ok) {
    console.log(`ok    ${label}${detail ? `  (${detail})` : ''}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? `  (${detail})` : ''}`);
  }
}

const LIMITS = { batchRecords: 500, batchBytes: 2097152, recordBytes: 262144, pageSize: 1000 };
const NOW = '2026-09-05T06:00:00.000Z';

const row = (collection, id, body, updatedAt = NOW) => ({ collection, id, body, updatedAt });
const state = (collection, id, revision, body) => ({
  collection,
  id,
  revision,
  digest: digestOf(body),
});

// --- what is owed ---------------------------------------------------------------

{
  const local = [
    row('plays', 'a', { hero: 'thor' }),
    row('plays', 'b', { hero: 'hulk' }),
    row('plays', 'c', { hero: 'silk' }),
  ];
  const states = [
    state('plays', 'a', 10, { hero: 'thor' }), // unchanged
    state('plays', 'b', 11, { hero: 'loki' }), // edited since
    state('plays', 'gone', 12, { hero: 'drax' }), // deleted here
  ];

  const owed = pendingChanges(local, states, NOW);
  const byId = Object.fromEntries(owed.map((record) => [record.id, record]));

  check('an unchanged row is not sent', byId.a === undefined);
  check('an edited row is sent with what was last confirmed', byId.b?.baseRevision === 11);
  check('a row the server has never seen is sent with no baseRevision', 'baseRevision' in (byId.c ?? {}) === false);
  check('a confirmed row with nothing beside it is a deletion', byId.gone?.deleted === true);
  check('and the deletion says what it is replacing', byId.gone?.baseRevision === 12);
  check('a deletion carries no body', byId.gone?.body === null);
}

{
  /*
   * The one collection where a false tombstone is unrecoverable.
   *
   * campaign_events is append-only: the app never deletes one, undo appends a
   * revocation instead. So a missing row is a local accident, not an
   * instruction, and treating it as a deletion would erase a play history on
   * every device the account has.
   */
  const owed = pendingChanges([], [state('campaign_events', 'e1', 5, { op: 'x' })], NOW);
  check('a missing append-only row is never turned into a deletion', owed.length === 0, `${owed.length} sent`);

  const others = pendingChanges([], [state('plays', 'p1', 5, { hero: 'x' })], NOW);
  check('while an ordinary missing row still is', others.length === 1 && others[0].deleted === true);
}

// --- batching --------------------------------------------------------------------

{
  const many = Array.from({ length: 12 }, (_, i) => row('plays', `p${i}`, { n: i }));
  const owed = pendingChanges(many, [], NOW);
  const batches = batchesOf(owed, { ...LIMITS, batchRecords: 5 });
  check(
    'batches respect the record count',
    batches.length === 3 && batches[0].length === 5 && batches[2].length === 2,
    batches.map((b) => b.length).join('+'),
  );

  const byBytes = batchesOf(owed, { ...LIMITS, batchBytes: 120 });
  check('and the byte budget', byBytes.length > 1, `${byBytes.length} batches`);
  check(
    'no record is lost or duplicated by batching',
    byBytes.flat().length === owed.length &&
      new Set(byBytes.flat().map((r) => r.id)).size === owed.length,
  );

  const one = batchesOf([row('plays', 'huge', { blob: 'x'.repeat(500) })], { ...LIMITS, batchBytes: 10 });
  check(
    'a record larger than the whole budget still goes, to be refused out loud',
    one.length === 1 && one[0].length === 1,
  );
}

// --- the cursor after a push -------------------------------------------------------

{
  check(
    'the cursor steps past this browser own writes',
    cursorAfterPush(40, [{ revision: 41 }, { revision: 42 }, { revision: 43 }]) === 43,
  );
  check(
    'out of order is still contiguous',
    cursorAfterPush(40, [{ revision: 43 }, { revision: 41 }, { revision: 42 }]) === 43,
  );
  check(
    'a gap stops the walk, because somebody else wrote there',
    cursorAfterPush(40, [{ revision: 41 }, { revision: 43 }]) === 41,
    'stops at 41, so 42 is read rather than skipped',
  );
  check('nothing pushed moves nothing', cursorAfterPush(40, []) === 40);
}

// --- a body that survives its own round trip -----------------------------------------

{
  /*
   * The digest recorded for a pulled record has to be of the body **after** it
   * has been through the collection, not of the body as it came off the wire.
   *
   * The two differ the moment the other client is newer than this one, for any
   * collection whose `rowOf` rebuilds the row field by field rather than
   * spreading the body. owned_packs is one: it reconstructs a pack code and a
   * quantity and drops everything else, so a field Android adds does not
   * survive, and the row on disk hashes differently from the body that arrived.
   * (plays spreads the body, so an unknown field rides along there — the two
   * styles are both present, which is exactly why this is asserted rather than
   * assumed.) Take
   * the digest from the wire and that row looks edited on the very next scan:
   * it is pushed back, stripped of the field, over the server's richer copy —
   * silently, for every device on the account. Take it after the round trip and
   * the row is simply left alone.
   *
   * Asserted both ways round, so the test fails if the round trip is ever
   * removed rather than passing because it happens to be there.
   */
  const fromNewerClient = {
    collection: 'owned_packs',
    id: 'core',
    revision: 7,
    updatedAt: NOW,
    deleted: false,
    body: { packCode: 'core', quantity: 2, aFieldThisBuildHasNeverHeardOf: 42 },
  };
  const mapping = COLLECTIONS.find((collection) => collection.name === 'owned_packs');
  const onDisk = mapping.bodyOf(mapping.rowOf(fromNewerClient.id, fromNewerClient.body));

  check(
    'a body from a newer client does not survive this build unchanged',
    digestOf(onDisk) !== digestOf(fromNewerClient.body),
    'which is what makes the next two assertions mean something',
  );
  check(
    'the digest taken after the round trip leaves the row alone',
    pendingChanges(
      [row('owned_packs', 'core', onDisk)],
      [{ collection: 'owned_packs', id: 'core', revision: 7, digest: digestForPulled(fromNewerClient) }],
      NOW,
    ).length === 0,
  );
  check(
    'while the digest taken off the wire would push it straight back, stripped',
    pendingChanges(
      [row('owned_packs', 'core', onDisk)],
      [{ collection: 'owned_packs', id: 'core', revision: 7, digest: digestOf(fromNewerClient.body) }],
      NOW,
    ).length === 1,
  );

  /*
   * And the ordinary case, for every collection: a record this build wrote
   * itself, pulled back down, must not be sent up again. Cheap, and it is the
   * loop nobody notices — no error, just two devices talking for ever.
   */
  const samples = {
    settings: {
      id: 'app',
      cardLocale: 'fr',
      themeChoice: 'dark',
      playLocation: 'kitchen table',
      trackEncounter: true,
      dismissedPacks: ['core'],
    },
    owned_packs: { packCode: 'core', quantity: 2 },
    excluded_modular_sets: { setCode: 'bomb_scare' },
    excluded_scenarios: { scenarioCode: 'rhino' },
    favourite_cards: { cardCode: '01001', addedAt: 1700000000000 },
    favourite_plays: { playId: 'p1', addedAt: 1700000000000 },
    ratings: {
      subject: 'modular:bomb_scare@rhino', score: 3, ratedAt: 1700000000000,
      evidence: { playId: 'p1' },
      context: { players: 1, heroes: [{ code: 'spiderman', aspect: 'justice' }], mode: 'standard_i', standardSet: '', scenario: 'rhino' },
    },
    saved_decks: { id: 'd1', name: 'Thor', heroCode: '01001', cards: { '01002': 3 }, updatedAt: 1700000000000 },
    campaign_runs: { id: 'r1', campaignId: 'fne', createdAt: 1700000000000, updatedAt: 1700000000000 },
    campaign_events: { id: 'e1', runId: 'r1', at: 1700000000000, op: 'setCounter' },
    plays: { id: 'p1', at: 1700000000000, scenarioCode: 'rhino' },
    randomizer_history: { id: 'h1', at: 1700000000000 },
  };

  for (const collection of COLLECTIONS) {
    const sample = samples[collection.name];
    if (sample === undefined) {
      check(`a sample exists for ${collection.name}`, false, 'add one to this test');
      continue;
    }
    const id = collection.idOf(sample);
    const body = collection.bodyOf(sample);
    const record = { collection: collection.name, id, revision: 1, updatedAt: NOW, deleted: false, body };
    const owed = pendingChanges(
      [row(collection.name, id, collection.bodyOf(collection.rowOf(id, body)))],
      [{ collection: collection.name, id, revision: 1, digest: digestForPulled(record) }],
      NOW,
    );
    check(`${collection.name} does not ping-pong`, owed.length === 0, `${owed.length} would be resent`);
  }
}

{
  check(
    'a collection this build does not know is skipped rather than guessed at',
    isUnknown({ collection: 'something_newer', id: 'x', revision: 1, updatedAt: NOW, deleted: false, body: {} }),
  );
  check(
    'and a known one is not',
    !isUnknown({ collection: 'plays', id: 'x', revision: 1, updatedAt: NOW, deleted: false, body: {} }),
  );
}

// --- a whole run, against a fake server ------------------------------------------------

function fakePorts({ local = [], states = [], cursor = 0, pages = [], pushFails = -1 } = {}) {
  const sent = [];
  const applied = [];
  const confirmed = [];
  let written = cursor;
  let batchNumber = 0;
  let pushCount = 0;

  return {
    sent,
    applied,
    confirmed,
    get cursor() {
      return written;
    },
    ports: {
      readLocal: async () => local,
      readStates: async () => states,
      applyPulled: async (changes) => {
        applied.push(...changes);
      },
      confirmPushed: async (records, results) => {
        confirmed.push({ records, results });
      },
      readCursor: async () => written,
      writeCursor: async (next) => {
        written = next;
      },
      pull: async (since, limit, resync) => {
        const page = pages.shift() ?? { changes: [], cursor: since, hasMore: false, minCursor: 0 };
        sent.push({ kind: 'pull', since, resync });
        return page;
      },
      push: async (batchId, records) => {
        pushCount += 1;
        sent.push({ kind: 'push', batchId, ids: records.map((r) => r.id) });
        if (pushCount === pushFails) {
          throw new Error('the network went away');
        }
        return {
          cursor: written + records.length,
          results: records.map((record, index) => ({
            id: record.id,
            collection: record.collection,
            revision: written + index + 1,
            outcome: 'applied',
          })),
        };
      },
      limits: async () => LIMITS,
      newBatchId: () => `batch-${(batchNumber += 1)}`,
      now: () => NOW,
    },
  };
}

{
  const world = fakePorts({
    cursor: 0,
    pages: [
      {
        changes: [{ collection: 'plays', id: 'srv', revision: 4, updatedAt: NOW, deleted: false, body: { at: 1, scenarioCode: 'rhino' } }],
        cursor: 4,
        hasMore: false,
        minCursor: 0,
      },
    ],
    local: [row('plays', 'mine', { id: 'mine', at: 2, scenarioCode: 'klaw' })],
  });
  const outcome = await syncOnce(world.ports);

  check('a run pulls before it pushes', world.sent[0].kind === 'pull');
  check('a run from zero says it is resyncing', world.sent[0].resync === true);
  check('what the server had is applied', world.applied.length === 1 && world.applied[0].id === 'srv');
  check('what this browser had is sent', outcome.pushed === 1);
  check('and the cursor ends past both', outcome.cursor === 5, `cursor ${outcome.cursor}`);
}

{
  // Three batches, the second of which fails. The third must not be sent, and
  // what did land must be recorded so it is not sent twice.
  const many = Array.from({ length: 6 }, (_, i) => row('plays', `p${i}`, { id: `p${i}`, at: i }));
  const world = fakePorts({ local: many, cursor: 10, pushFails: 2 });
  const outcome = await syncOnce({
    ...world.ports,
    limits: async () => ({ ...LIMITS, batchRecords: 2 }),
  });

  const pushes = world.sent.filter((call) => call.kind === 'push');
  check('a failed batch stops the run', pushes.length === 2, `${pushes.length} batches attempted`);
  check('the run says why it stopped', outcome.stoppedBecause === 'push_failed');
  check('the batch before it was confirmed', world.confirmed.length === 1);
  check(
    'every batch has its own id, so a retry can replay rather than reapply',
    new Set(pushes.map((call) => call.batchId)).size === pushes.length,
  );
}

{
  // A resync that pages: every page carries the flag, not only the first.
  const world = fakePorts({
    cursor: 0,
    pages: [
      { changes: [{ collection: 'plays', id: 'a', revision: 1, updatedAt: NOW, deleted: false, body: { at: 1 } }], cursor: 1, hasMore: true, minCursor: 0 },
      { changes: [{ collection: 'plays', id: 'b', revision: 2, updatedAt: NOW, deleted: false, body: { at: 2 } }], cursor: 2, hasMore: false, minCursor: 0 },
    ],
  });
  await syncOnce(world.ports);
  const pulls = world.sent.filter((call) => call.kind === 'pull');
  check(
    'every page of a resync carries the flag, which is where this failed before',
    pulls.length === 2 && pulls.every((call) => call.resync === true),
    `${pulls.length} pages`,
  );
}

process.exit(failures === 0 ? 0 : 1);
