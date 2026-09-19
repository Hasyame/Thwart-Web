import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { db } from '../src/lib/db.ts';
import { limitedGame } from '../src/lib/limitedGame.ts';
import { buildCampaignPlay } from '../src/lib/campaign/play.ts';
import { saveDraft, loadDraft, clearDraft } from '../src/lib/draft/store.ts';
import { DEFAULT_SETTINGS, EMPTY_PLAYER } from '../src/lib/draft/types.ts';

try {
  const decks = [
    { id: 'sealed-one', name: 'My sealed deck', heroCode: 'hero-one', heroName: 'Hero One', aspects: 'justice,protection', tags: 'sealed' },
    { id: 'draft-two', name: 'My draft deck', heroCode: 'hero-two', heroName: 'Hero Two', aspects: 'leadership', tags: 'draft' },
  ];
  await db.decks.bulkPut(decks);
  const setup = await limitedGame(['sealed-one', 'draft-two'], false, [], []);
  assert.deepEqual(setup.seats.map((s) => [s.deckId, s.deckName, s.aspect]), [
    ['sealed-one', 'My sealed deck', 'justice,protection'], ['draft-two', 'My draft deck', 'leadership'],
  ]);
  await assert.rejects(limitedGame(['missing-deck'], false, [], []));
  for (const deck of decks) {
    const play = buildCampaignPlay({
      runId: 'run', scenarioId: 'rhino', scenario: null,
      campaign: { difficulty: 'standard', heroes: [{ deckId: deck.id, heroCardCode: deck.heroCode, name: deck.heroName }] },
      decks, locale: 'en', won: true, elapsedMillis: 0, victoryPoints: 0,
    });
    assert.equal(play.mode, deck.tags);
    assert.equal(play.roster[0].aspect.replaceAll(' ', ''), deck.aspects);
  }
  await db.ownedPacks.put({ packCode: 'core', quantity: 1 });
  const session = {
    settings: { ...DEFAULT_SETTINGS, format: 'sealed' }, players: [EMPTY_PLAYER(0)], phase: 'pick', current: 0,
    stock: {}, packs: [], builds: 0, pickCount: 0, offer: [], seed: 42, rolls: 0,
    collection: { core: 3 }, sealedPools: [Array(60).fill('card')], sealedOpened: [2], sealedBuilding: [false],
  };
  await saveDraft(session);
  assert.deepEqual(await loadDraft(), session);
  assert.equal((await db.ownedPacks.get('core')).quantity, 1);
  await clearDraft();
  const { collection, sealedPools, sealedOpened, sealedBuilding, ...legacy } = session;
  await saveDraft({ ...legacy, settings: DEFAULT_SETTINGS });
  assert.equal((await loadDraft()).settings.format, undefined);
  console.log('PASS: deck IDs and aspects, campaign modes, temporary collection, booster resume and legacy draft storage');
} finally {
  await db.delete();
}
