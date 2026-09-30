// Regression tests for two sync bugs from the bug hunt of 2026-09-30
// (docs/security/2026-09-30-bug-hunt.md): a refused cursor is recovered from,
// and a rating the server only deferred is kept and sent again.
// Real Dexie ports and Svelte state, fetch stubbed. No network or account.
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { db } from '../src/lib/db.ts';
import { collectionByName } from '../src/lib/sync/collections.ts';
import { KNOWN_COLLECTIONS, cursorAfterPush } from '../src/lib/sync/engine.ts';
import { FALLBACK_LIMITS } from '../src/lib/sync/api.ts';
import { SYNC_STATE_KEY, digestOf } from '../src/lib/sync/state.ts';
import { loadSyncState, sync, runSync } from '../src/lib/sync/sync.svelte.ts';
import { en } from '../src/lib/strings/en.ts';
import { fr } from '../src/lib/strings/fr.ts';

const DECLARED = [...KNOWN_COLLECTIONS].sort().join(',');
const token = 'qa-token';
const adopted = (cursor) => ({
  id: SYNC_STATE_KEY, token, accountId: 'qa', handle: 'qa', cursor, collections: DECLARED,
  lastSyncedAt: 1, syncEnabled: true, recoveryCodeIssuedAt: '2026-01-01T00:00:00Z', deviceName: 'qa',
});
const put = async (collection, id, body) => {
  const m = collectionByName(collection);
  await m.table().put(m.rowOf(id, body));
};
// A row the server once confirmed: it has a state at a revision.
const confirmed = async (collection, id, body, revision) => {
  await put(collection, id, body);
  const m = collectionByName(collection);
  const row = await m.table().get(id);
  await db.syncRecords.put({ collection, id, revision, digest: digestOf(m.bodyOf(row)) });
};
const serverRecord = (collection, id, body, revision) =>
  ({ collection, id, body, revision, updatedAt: '2026-09-30T00:00:00Z', deleted: false });
const ok = (name) => console.log(`ok   ${name}`);
const fresh = async (cursor) => {
  await db.delete();
  await db.open();
  await db.syncState.put(adopted(cursor));
};

try {
  // --- cursor_too_old ------------------------------------------------------------------
  await fresh(402);
  // Confirmed long ago and since deleted on another device (tombstone swept).
  await confirmed('owned_packs', 'gone', { packCode: 'gone', quantity: 1 }, 7);
  // Confirmed, and still on the server.
  await confirmed('owned_packs', 'kept', { packCode: 'kept', quantity: 1 }, 8);
  // A local edit never sent, owed to the server.
  await put('owned_packs', 'core', { packCode: 'core', quantity: 2 });
  await loadSyncState();

  const pulls = [];
  const pushed = [];
  let failMidway = true;
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(String(url), 'http://x');
    if (u.pathname.includes('/version')) return Response.json({ limits: { ...FALLBACK_LIMITS, pageSize: 1 } });
    if ((options.method ?? 'GET') === 'POST') {
      const body = JSON.parse(options.body);
      pushed.push(...body.records.map((r) => r.id));
      return Response.json({ cursor: 1301, results: body.records.map((r, i) => ({ collection: r.collection, id: r.id, revision: 1301 + i, outcome: 'applied' })) });
    }
    const since = Number(u.searchParams.get('since'));
    const resync = u.searchParams.get('resync') === '1';
    pulls.push(`${since}${resync ? 'r' : ''}`);
    if (since > 0 && !resync && since < 1204) {
      return Response.json({ error: { code: 'cursor_too_old', message: 'too old', details: { minCursor: 1204 } } }, { status: 409 });
    }
    if (since === 0) {
      return Response.json({ changes: [serverRecord('owned_packs', 'kept', { packCode: 'kept', quantity: 1 }, 1250)], cursor: 1250, hasMore: true, minCursor: 1204 });
    }
    if (since === 1250 && resync && failMidway) {
      failMidway = false;
      return new Response('gateway', { status: 502 });
    }
    return Response.json({ changes: [serverRecord('owned_packs', 'remote', { packCode: 'remote', quantity: 1 }, 1300)], cursor: 1300, hasMore: false, minCursor: 1204 });
  };

  // First run: the recovery is interrupted after its first page.
  await runSync(token, 'en');
  assert.equal(sync.phase.kind, 'failed');
  assert.equal((await db.syncState.get(SYNC_STATE_KEY)).cursor, 402, 'an interrupted recovery keeps the refused cursor');
  assert.ok(await db.ownedPacks.get('gone'), 'nothing is dropped before the full pull has finished');
  ok('an interrupted recovery keeps the refused cursor, so the next run starts it over');

  // Second run: the recovery goes through.
  await runSync(token, 'en');
  assert.deepEqual(pulls, ['402', '0r', '1250r', '402', '0r', '1250r'], 'every page of the recovery carries resync=1');
  assert.equal(sync.phase.kind, 'on', JSON.stringify(sync.phase));
  assert.equal(sync.phase.last.resynced, true);
  assert.equal(await db.ownedPacks.get('gone'), undefined, 'a record deleted elsewhere, its tombstone swept, is gone here too');
  assert.equal(await db.syncRecords.get(['owned_packs', 'gone']), undefined);
  assert.ok(await db.ownedPacks.get('kept'), 'a record still on the server stays');
  assert.ok(await db.ownedPacks.get('remote'), 'a record new on the server arrives');
  assert.ok(pushed.includes('core'), 'the local edit is sent at last');
  assert.ok(!pushed.includes('gone'), 'the dropped record is not pushed back');
  assert.equal((await db.syncState.get(SYNC_STATE_KEY)).cursor, 1301, 'the cursor moves past the recovery and the push');
  ok('cursor_too_old: a full resync, deletions from elsewhere applied, local work pushed');

  pulls.length = 0;
  await runSync(token, 'en');
  assert.deepEqual(pulls, ['1301'], 'the next run is an ordinary pull');
  assert.equal(sync.phase.last.resynced, false);
  ok('after the recovery, syncing is back to normal');

  // --- ratings the server only deferred ---------------------------------------------------
  for (const answer of [
    { outcome: 'deferred', reason: 'rate_limited' },
    // A server from before `deferred` answered the cap like this.
    { outcome: 'rejected', reason: 'rate_limited' },
  ]) {
    await fresh(10);
    const subject = 'scenario:rhino';
    await confirmed('plays', 'p1', { id: 'p1', scenarioCode: 'rhino', won: true }, 5);
    await put('ratings', subject, { subject, score: 4, ratedAt: 1789100000000, evidence: { playId: 'p1' }, context: {} });
    await loadSyncState();

    let capped = true;
    const sent = [];
    globalThis.fetch = async (url, options = {}) => {
      const u = String(url);
      if (u.includes('/version')) return Response.json({ limits: FALLBACK_LIMITS });
      if ((options.method ?? 'GET') === 'POST') {
        const body = JSON.parse(options.body);
        sent.push(...body.records.map((r) => r.id));
        return Response.json({
          cursor: 11,
          results: body.records.map((r) => (r.collection === 'ratings' && capped
            ? { collection: r.collection, id: r.id, revision: 0, ...answer }
            : { collection: r.collection, id: r.id, revision: 11, outcome: 'applied' })),
        });
      }
      return Response.json({ changes: [], cursor: 10, hasMore: false, minCursor: 0 });
    };

    await runSync(token, 'en');
    assert.ok(await db.ratings.get(subject), `${answer.outcome}/${answer.reason}: the rating is kept`);
    assert.equal(await db.syncRecords.get(['ratings', subject]), undefined, 'and not marked as synced');
    assert.deepEqual(sync.rejected, [], 'and not reported as refused');
    assert.equal(sync.phase.last.deferred, 1);

    capped = false;
    sent.length = 0;
    await runSync(token, 'en');
    assert.deepEqual(sent, [subject], 'the next run sends it again');
    assert.equal((await db.syncRecords.get(['ratings', subject]))?.revision, 11, 'and it is confirmed once accepted');
    ok(`${answer.outcome}/rate_limited: the rating is kept and sent again`);
  }

  // A rating refused on its merits still goes, and is still reported.
  await fresh(10);
  await put('ratings', 'scenario:klaw', { subject: 'scenario:klaw', score: 4, ratedAt: 1789100000000, evidence: { playId: 'nope' }, context: {} });
  await loadSyncState();
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/version')) return Response.json({ limits: FALLBACK_LIMITS });
    if ((options.method ?? 'GET') === 'POST') {
      const body = JSON.parse(options.body);
      return Response.json({ cursor: 10, results: body.records.map((r) => ({ collection: r.collection, id: r.id, revision: 0, outcome: 'rejected', reason: 'not_played' })) });
    }
    return Response.json({ changes: [], cursor: 10, hasMore: false, minCursor: 0 });
  };
  await runSync(token, 'en');
  assert.equal(await db.ratings.get('scenario:klaw'), undefined);
  assert.deepEqual(sync.rejected.map((r) => r.reason), ['not_played']);
  ok('rejected/not_played: the rating is dropped and reported, as before');

  // A deferred result spends no revision and does not stop the cursor walk.
  assert.equal(cursorAfterPush(10, [
    { collection: 'plays', id: 'a', revision: 11, outcome: 'applied' },
    { collection: 'ratings', id: 'b', revision: 0, outcome: 'deferred', reason: 'rate_limited' },
    { collection: 'plays', id: 'c', revision: 12, outcome: 'applied' },
  ]), 12);
  ok('a deferred result does not stop the cursor walk');

  // --- the messages ---------------------------------------------------------------------------
  const generic = { en: en.accountError('no_such_code'), fr: fr.accountError('no_such_code') };
  for (const code of ['cursor_too_old', 'invalid_verification', 'verification_expired', 'record_too_large', 'batch_too_large']) {
    assert.notEqual(en.accountError(code), generic.en, `en has a message for ${code}`);
    assert.notEqual(fr.accountError(code), generic.fr, `fr has a message for ${code}`);
  }
  assert.doesNotMatch(en.ratingRejected(1), /does not have/, 'the refusal message no longer blames a missing game for every reason');
  ok('the codes the bug hunt found without a message have one');
} finally {
  await db.delete();
}
process.exit(0);
