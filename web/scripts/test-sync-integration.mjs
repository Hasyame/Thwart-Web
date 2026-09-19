// Exercise the real Dexie ports and Svelte state together. No network or account.
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { db } from '../src/lib/db.ts';
import { dexiePorts, applyAdoption } from '../src/lib/sync/ports.ts';
import { collectionByName } from '../src/lib/sync/collections.ts';
import { digestOf, hasAdopted, SYNC_STATE_KEY } from '../src/lib/sync/state.ts';
import { pendingChanges, batchesOf } from '../src/lib/sync/engine.ts';
import { FALLBACK_LIMITS } from '../src/lib/sync/api.ts';
import { loadSyncState, sync, turnOff, turnOn, runSync, acceptAdoption } from '../src/lib/sync/sync.svelte.ts';
import { forgetLocally } from '../src/lib/sync/session.svelte.ts';
import { watchLive, live } from '../src/lib/sync/live.svelte.ts';

const ports = dexiePorts('local-test-token', 'en');
const now = '2026-09-19T00:00:00Z';
const stored = { id: SYNC_STATE_KEY, token: 'local-test-token', accountId: 'test', handle: 'test', cursor: 0, lastSyncedAt: null, recoveryCodeIssuedAt: now, deviceName: 'test' };
const record = (collection, id, body, revision = 1) => ({ collection, id, body, revision, updatedAt: now, deleted: false });
async function put(collection, id, body) {
  const mapping = collectionByName(collection);
  await mapping.table().put(mapping.rowOf(id, body));
}
const owed = async () => pendingChanges(await ports.readLocal(), await ports.readStates(), now);
const ok = name => console.log(`ok   ${name}`);

try {
  await db.delete();
  await db.open();
  await loadSyncState();
  assert.equal(sync.adopted, false);
  assert.equal(hasAdopted(undefined), false);
  assert.equal(hasAdopted({ cursor: 0 }), false);
  await db.syncState.put(stored);
  await loadSyncState();
  assert.equal(sync.adopted, false);
  ok('missing and fresh sessions require adoption');

  await put('plays', 'p', { reportedToBgg: true, notes: 'local' });
  await ports.applyPulled([record('plays', 'p', { reportedToBgg: false, notes: 'remote', futureField: 42 })]);
  assert.equal((await db.plays.get('p')).reportedToBgg, true);
  assert.equal((await db.plays.get('p')).notes, 'remote');
  const pendingPlay = (await owed()).find(r => r.id === 'p');
  assert.equal(pendingPlay.body.reportedToBgg, true);
  assert.equal(pendingPlay.body.futureField, 42);
  ok('ordinary pull preserves BGG reporting and unknown play fields, then uploads the merge');

  await put('saved_decks', 'd', { name: 'Deck', slots: '{"a":1}', locallyEdited: true });
  await ports.applyPulled([record('saved_decks', 'd', { name: 'Remote', slots: '{"b":1}', locallyEdited: true })]);
  const decks = await db.decks.toArray();
  assert.equal(decks.length, 2);
  assert.equal(decks.find(d => d.id === 'd').name, 'Remote');
  assert.equal(decks.find(d => d.id !== 'd').slots, '{"a":1}');
  assert.ok((await owed()).some(r => r.collection === 'saved_decks' && r.id !== 'd'));
  await ports.applyPulled([record('saved_decks', 'd', { name: 'Remote again', slots: '{"c":1}', locallyEdited: true }, 2)]);
  assert.equal(await db.decks.count(), 2);
  ok('dirty deck conflicts fork once; clean remote updates do not fork');

  await put('campaign_runs', 'r', { campaignId: 'test', createdAt: 0 });
  await db.campaignRuns.update('r', { timerAccumulatedMillis: 123, timerRunningSince: 42, timerScenarioId: 'one' });
  await ports.applyPulled([record('campaign_runs', 'r', { campaignId: 'test', name: 'Remote' })]);
  assert.equal((await db.campaignRuns.get('r')).timerAccumulatedMillis, 123);
  assert.equal((await db.campaignRuns.get('r')).timerRunningSince, 42);
  await ports.applyPulled([{ ...record('campaign_runs', 'r', null), deleted: true }]);
  assert.ok(await db.campaignRuns.get('r'));
  ok('campaign timers survive remote changes; stale tombstones cannot delete newer records');

  await put('settings', 'app', { dismissedPacks: ['core'] });
  await ports.applyPulled([record('settings', 'app', { dismissedPacks: ['other'] })]);
  assert.deepEqual((await db.appSettings.get('app')).dismissedPacks, ['core', 'other']);
  ok('settings are part of the transaction and merge dismissals');

  const large = Array.from({ length: 12 }, (_, i) => ({ collection: 'plays', id: `${i}`, body: { notes: '界😀'.repeat(20000) }, updatedAt: now, deleted: false }));
  const batches = batchesOf(large, { ...FALLBACK_LIMITS, batchBytes: 300000 });
  assert.ok(batches.length > 1);
  assert.ok(batches.every(batch => batch.reduce((bytes, r) => bytes + Buffer.byteLength(JSON.stringify(r)), 0) <= 300000));
  ok('non-ASCII records respect the UTF-8 batch budget');

  await db.delete();
  await db.open();
  await db.syncState.put(stored);
  await applyAdoption({ writes: [] }, 0);
  await loadSyncState();
  assert.equal(sync.adopted, true);
  await turnOff();
  await loadSyncState();
  assert.equal(sync.enabled, false);
  const teardown = watchLive();
  assert.equal(live.state, 'off');
  teardown();
  ok('empty account adoption persists; switching off survives reload and prevents a live stream');

  const calls = [];
  let failPush = true;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (String(url).includes('/version')) return Response.json({ limits: FALLBACK_LIMITS });
    if (options.method === 'POST') {
      if (failPush) throw new Error('offline');
      const body = JSON.parse(options.body);
      return Response.json({ cursor: body.records.length, results: body.records.map((r, i) => ({ collection: r.collection, id: r.id, revision: i + 1, outcome: 'applied' })) });
    }
    return Response.json({ changes: [], cursor: 0, hasMore: false, minCursor: 0 });
  };
  await runSync(stored.token, 'en');
  assert.equal(calls.length, 0);
  await db.ownedPacks.put({ packCode: 'core', quantity: 1 });
  const last = (await db.syncState.get(SYNC_STATE_KEY)).lastSyncedAt;
  await turnOn(stored.token, 'en');
  assert.equal(sync.phase.kind, 'failed');
  assert.equal(sync.phase.code, 'push_failed');
  assert.equal((await db.syncState.get(SYNC_STATE_KEY)).lastSyncedAt, last);
  assert.ok((await owed()).length > 0);
  failPush = false;
  await Promise.all([runSync(stored.token, 'en'), runSync(stored.token, 'en')]);
  assert.equal(sync.phase.kind, 'on');
  assert.equal(calls.filter(c => c.options.method === 'POST').length, 2);
  assert.equal((await owed()).length, 0);
  ok('failed pushes stay dirty and visible; simultaneous retries share one run');

  await forgetLocally();
  assert.equal(sync.adopted, false);
  assert.equal(sync.enabled, false);
  await db.syncState.put({ ...stored, token: 'second-account' });
  await loadSyncState();
  await turnOn('second-account', 'en');
  assert.equal(sync.phase.kind, 'asking');
  await acceptAdoption('second-account', 'en');
  assert.equal(sync.phase.kind, 'on');
  ok('sign-out resets adoption; another account must confirm before syncing');
} finally {
  await db.delete();
}
