/**
 * The draft, against the real card index.
 *
 * The identities, the shelf, the copy limits and the names are the Android
 * app's DraftEngineTest, DraftNamingTest and DraftStockBuilderTest, so a
 * rule read on one side is the rule on the other. The packs are the web's:
 * built before the first pick, one physical copy in one pack at most, a
 * card that holds once placed once across all of them, and the shelf
 * shuffled into new packs when a player opens their last.
 *
 *   npm run test:draft
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildContext, ownedHeroes, rulesFor } from '../src/lib/draft/context.ts';
import { buildStock } from '../src/lib/draft/stock.ts';
import { cardFromRow } from '../src/lib/draft/cards.ts';
import {
  aspectChoices, availableHeroes, buildPacks, canTake, imposedAspects, legalOffers, nextTurn, openPack, pick,
  playerPool, randomAspects, randomHero, randomHeroChoices, shortfalls, skipCurrent, start,
} from '../src/lib/draft/engine.ts';
import { aspectPart, defaultName, fold } from '../src/lib/draft/naming.ts';
import { seeded, shuffled } from '../src/lib/draft/random.ts';
import { DEFAULT_SETTINGS, DRAFT_RULES, EMPTY_PLAYER, cardCount, isFull, slotsOf } from '../src/lib/draft/types.ts';
import { validateDeck } from '../src/lib/deckRules.ts';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

const INDEX = join(import.meta.dirname, '..', 'public', 'data', 'index.en.json');
if (!existsSync(INDEX)) {
  console.error('No card data. Run `npm run data` first.');
  process.exit(1);
}
const index = JSON.parse(readFileSync(INDEX, 'utf8'));
if (index.find((row) => row.code === '21031a')?.deckRules === undefined) {
  console.error('The index predates the deck fields. Run `npm run data`.');
  process.exit(1);
}
const rowOf = (code) => index.find((row) => row.code === code);

// A modest collection: two Core Sets, the first cycle, Warlock's, Magik's and Deadpool's packs.
const OWNED = new Map([['core', 2], ['cap', 1], ['msm', 1], ['thor', 1], ['bkw', 1], ['drs', 1], ['hlk', 1],
  ['mts', 1], ['aoa', 1], ['deadpool', 1], ['gmw', 1], ['rocket', 1], ['trors', 1]]);

const SPIDER = '01001a';
const WARLOCK = '21031a';
const MAGIK = '45030a';
const SPIDERWOMAN = '04031a';

function fresh(players, over = {}) {
  return {
    settings: { ...DEFAULT_SETTINGS, players: players.length, ...over.settings },
    players,
    phase: 'identity',
    current: 0,
    stock: {},
    packs: [],
    builds: 0,
    pickCount: 0,
    offer: [],
    seed: over.seed ?? 12345,
    rolls: 0,
  };
}

function player(index, heroCode, aspects, deckSize = 40) {
  const rules = rulesFor(index_, heroCode);
  const hero = rowOf(heroCode);
  return {
    ...EMPTY_PLAYER(index),
    heroCode, heroName: hero.name, heroSetCode: hero.setCode,
    aspects, deckSize,
    signature: Object.fromEntries(rules.requiredCards),
  };
}
const index_ = index;

function ready(players, over = {}) {
  const heroes = players.map((p) => p.heroCode);
  const context = buildContext(index, OWNED, heroes);
  const state = start({ ...fresh(players, over), stock: Object.fromEntries(context.initialStock) }, context);
  return { state, context };
}

/** Plays a whole draft, always taking the first card offered. */
function playThrough(state, context) {
  let s = state;
  let guard = 0;
  while (s.phase === 'pick' && guard++ < 600) {
    s = s.offer.length === 0 ? skipCurrent(s, context) : pick(s, s.offer[0], context);
  }
  return s;
}

function validate(playerState, context) {
  const cards = new Map();
  for (const [code, row] of context.pool) cards.set(code, cardFromRow(row));
  for (const sig of context.signatureCards.values()) for (const [code, row] of sig) cards.set(code, cardFromRow(row));
  return validateDeck(context.rules.get(playerState.heroCode), playerState.aspects, slotsOf(playerState), cards);
}

// --- the shelf --------------------------------------------------------------------

{
  const { pool, stock } = buildStock(index, OWNED);
  const swarm = index.filter((row) => row.name === 'Swarm Tactics' || row.duplicateOf === undefined && row.name === 'Swarm Tactics');
  const coreBasic = [...pool.values()].find((row) => row.packCode === 'core' && row.duplicateOf === undefined);
  check(`copies are counted per owned pack: two Core Sets double the Core cards (${coreBasic.name})`,
    stock.get(coreBasic.code) >= 2 * (coreBasic.quantity ?? 1), String(stock.get(coreBasic.code)));
  const reprint = index.find((row) => row.duplicateOf !== undefined && OWNED.has(row.packCode) && OWNED.has(rowOf(row.duplicateOf)?.packCode ?? ''));
  if (reprint !== undefined) {
    const original = rowOf(reprint.duplicateOf);
    const expected = (OWNED.get(original.packCode) ?? 0) * (original.quantity ?? 1) + (OWNED.get(reprint.packCode) ?? 0) * (reprint.quantity ?? 1);
    check(`a reprint is folded onto the original (${original.name})`, stock.get(original.code) === expected && !pool.has(reprint.code),
      `${stock.get(original.code)} vs ${expected}`);
  }
  check('no signature card is on the shelf', [...pool.values()].every((row) => row.setCode === null));
  check('no encounter card is on the shelf', [...pool.values()].every((row) => row.factionCode !== 'encounter'));
  check('an unowned pack puts nothing on the shelf', ![...pool.values()].some((row) => row.packCode === 'next'));
  // A card owned only as a reprint is shown as that printing, never as the
  // original from a pack the collection does not have.
  const onlyMsm = buildStock(index, new Map([['msm', 1]]));
  check('every card on the shelf is a printing the collection holds', [...onlyMsm.pool.values()].every((row) => row.packCode === 'msm'),
    [...onlyMsm.pool.values()].filter((row) => row.packCode !== 'msm').map((r) => `${r.code} ${r.name}`).join(','));
  check("so Energy from Ms. Marvel's pack alone is her printing, once", onlyMsm.pool.has('05019') && onlyMsm.stock.get('05019') === 1 && !onlyMsm.pool.has('01088'));
  const withCore = buildStock(index, new Map([['msm', 1], ['core', 1]]));
  check('and with the Core Set owned, the original names it and the copies add up', withCore.pool.has('01088') && !withCore.pool.has('05019') && withCore.stock.get('01088') === 5, String(withCore.stock.get('01088')));
  void swarm;
}

// --- identities and aspects ----------------------------------------------------------

{
  const owned = ownedHeroes(index, OWNED);
  check('the collection\'s identities are on offer', owned.includes(SPIDER) && owned.includes(WARLOCK) && owned.includes(MAGIK));
  check('and not an unowned one', !owned.includes('40001a'));
  const s = fresh([{ ...EMPTY_PLAYER(0), heroCode: SPIDER }, EMPTY_PLAYER(1)]);
  check('a taken identity is not offered to the next player', !availableHeroes({ ...s, current: 1 }, owned).includes(SPIDER));
  const drawn = randomHero({ ...s, current: 1 }, owned);
  check('a random identity is one of the collection\'s, not the taken one', drawn !== SPIDER && owned.includes(drawn));
  check('and the same seed draws the same', randomHero({ ...s, current: 1 }, owned) === drawn);
  check('another roll draws again', randomHero({ ...s, current: 1, rolls: 1 }, owned) !== drawn || owned.length < 3);
  check('five choices, distinct', new Set(randomHeroChoices(s, owned)).size === 5);

  const warlock = rulesFor(index, WARLOCK);
  const spiderwoman = rulesFor(index, SPIDERWOMAN);
  const spider = rulesFor(index, SPIDER);
  check('the four aspects, and Pool with the Deadpool pack', aspectChoices(spider, true).join(',') === 'aggression,justice,leadership,protection,pool');
  check('and without it, the four', aspectChoices(spider, false).length === 4);
  check('Adam Warlock\'s rule imposes all four', imposedAspects(warlock)?.length === 4 && aspectChoices(warlock, true).length === 0);
  check('Spider-Woman picks two', spiderwoman.aspectCount === 2 && randomAspects(s, spiderwoman, false).length === 2);
  check('a random aspect for Spider-Man is one', randomAspects(s, spider, true).length === 1);
}

// --- offers and picks ----------------------------------------------------------------

{
  const { state, context } = ready([player(0, SPIDER, ['justice'])]);
  check('an open pack has the size asked for', state.offer.length === DRAFT_RULES.DEFAULT_OFFER_SIZE, String(state.offer.length));
  check('from the player\'s aspect and basic', state.offer.every((code) => ['justice', 'basic'].includes(context.pool.get(code).factionCode)));
  const again = start({ ...fresh([player(0, SPIDER, ['justice'])]), stock: Object.fromEntries(context.initialStock) }, context);
  check('the same seed builds the same packs', JSON.stringify(again.packs) === JSON.stringify(state.packs) && again.offer.join(',') === state.offer.join(','));
  const other = ready([player(0, SPIDER, ['justice'])], { seed: 999 }).state;
  check('another seed builds others', other.offer.join(',') !== state.offer.join(','));

  const taken = state.offer[0];
  const shelfBefore = Object.values(state.stock).reduce((n, c) => n + c, 0);
  const after = pick(state, taken, context);
  check('a pick joins the deck', after.players[0].picks.includes(taken));
  check('the rest of the pack goes back on the shelf, and the next pack comes off it',
    Object.values(after.stock).reduce((n, c) => n + c, 0) === shelfBefore + state.offer.length - 1 && after.packs[0].length === state.packs[0].length - 1);
  check('and a new pack is on the table', after.offer.length > 0 && after.pickCount === 1);
  let threw = false;
  try { pick(state, 'no-such', context); } catch { threw = true; }
  check('a card off the table cannot be picked', threw);
  check('the shelf still offers what a pack would', legalOffers(state, context).length > 0);
}

// --- the packs ---------------------------------------------------------------------------

{
  const { state, context } = ready([player(0, SPIDER, ['justice'], 40)]);
  const me = state.players[0];
  const needed = 40 - cardCount(me);
  // The open pack counts: it was the first of the queue.
  check(`the packs are built before the first pick: one per card needed (${needed})`, state.packs[0].length === needed - 1 && state.offer.length > 0, String(state.packs[0].length));
  check('every pack holds distinct cards, no more than asked for', state.packs[0].every((pack) => new Set(pack).size === pack.length && pack.length <= DRAFT_RULES.DEFAULT_OFFER_SIZE));
  const inPacks = new Map();
  for (const pack of [state.offer, ...state.packs[0]]) for (const code of pack) inPacks.set(code, (inPacks.get(code) ?? 0) + 1);
  check('a physical copy is in one pack at most', [...inPacks].every(([code, n]) => n + (state.stock[code] ?? 0) === context.initialStock.get(code)));
  check('and no card is in more packs than the deck may hold copies', [...inPacks].every(([code, n]) => {
    const row = context.pool.get(code);
    return n <= (row.isUnique ? 1 : (row.deckLimit ?? 3));
  }));
  const strength = [...context.pool.values()].find((row) => row.name === 'Strength');
  check(`a "max 1 per deck" card is placed once across all the packs, whatever the shelf holds (${strength.name}: ${context.initialStock.get(strength.code)} owned)`,
    context.initialStock.get(strength.code) > 1 && (inPacks.get(strength.code) ?? 0) <= 1);
  const uniques = [...inPacks].filter(([code]) => context.pool.get(code).isUnique);
  check('as is a unique', uniques.every(([, n]) => n === 1));

  // Four players: one copy in one pack across everybody, and the packs shared round by round.
  const four = ready([player(0, SPIDER, ['justice']), player(1, WARLOCK, [...DRAFT_RULES.CLASSIC_ASPECTS]), player(2, MAGIK, ['protection']), player(3, SPIDERWOMAN, ['aggression', 'leadership'])], { seed: 5 });
  const all = new Map();
  for (const [i, queue] of four.state.packs.entries()) for (const pack of [...(i === four.state.current ? [four.state.offer] : []), ...queue]) for (const code of pack) all.set(code, (all.get(code) ?? 0) + 1);
  check('with four players a physical copy is still in one pack at most', [...all].every(([code, n]) => n + (four.state.stock[code] ?? 0) === four.context.initialStock.get(code)));
  check('and a card that holds once is in one pack across all four', [...all].filter(([code]) => { const r = four.context.pool.get(code); return r.isUnique || r.deckLimit === 1; }).every(([, n]) => n === 1));
  check('everybody gets packs', four.state.packs.every((queue, i) => queue.length + (i === four.state.current ? 1 : 0) >= 1));

  // A shelf too small for all the packs: what it can fill is built, and the rest comes when the packs run out.
  const tiny = new Map([['core', 1]]);
  const tctx = buildContext(index, tiny, [SPIDER]);
  const tstate = start({ ...fresh([player(0, SPIDER, ['justice'], 50)], { settings: { offerSize: 10 } }), stock: Object.fromEntries(tctx.initialStock) }, tctx);
  const tneeded = 50 - cardCount(tstate.players[0]);
  check('a shelf too small builds what it can, not what was asked', tstate.packs[0].length + 1 < tneeded, `${tstate.packs[0].length + 1} of ${tneeded}`);
  let t = tstate;
  let opened = 0;
  while (t.phase === 'pick' && t.packs[0].length > 0) { t = pick(t, t.offer[0], tctx); opened += 1; }
  const buildsBefore = t.builds;
  t = pick(t, t.offer[0], tctx);
  check('when the last pack is opened, the shelf is shuffled into new ones and the draft carries on', t.builds === buildsBefore + 1 && t.phase === 'pick' && t.offer.length > 0, `builds ${buildsBefore} then ${t.builds}, phase ${t.phase}`);
  const tend = playThrough(t, tctx);
  const tv = validate(tend.players[0], tctx);
  check('and it ends in a legal deck of fifty from one Core Set', tend.phase === 'finish' && tv.legal && cardCount(tend.players[0]) === 50, tv.problems.map((p) => p.kind).join(',') || String(cardCount(tend.players[0])));
  check('with three picks of nothing twice over', new Set(tend.players[0].picks).size < tend.players[0].picks.length);
  void opened;
  void buildPacks;
  void openPack;
}

{
  // Copy limits, uniques, Warlock.
  const { state, context } = ready([player(0, SPIDER, ['justice'])]);
  const me = state.players[0];
  // A plain basic card, three to a deck, and enough on the shelf to try.
  const helicarrier = [...context.pool.values()].find((row) => row.factionCode === 'basic' && !row.isUnique && row.deckLimit === undefined && context.initialStock.get(row.code) >= 3);
  const h = helicarrier.code;
  const three = { ...me, picks: [h, h, h] };
  check(`a title is never offered past its copy limit (${helicarrier.name})`, !canTake({ ...three, deckSize: 50 }, helicarrier, context));
  check('but a third copy is fine', canTake({ ...me, picks: [h, h], deckSize: 50 }, helicarrier, context));
  const unique = [...context.pool.values()].find((row) => row.isUnique && row.factionCode === 'basic');
  check('a unique card is refused once', canTake(me, unique, context) && !canTake({ ...me, picks: [unique.code] }, unique, context), unique?.name);

  const w = ready([player(0, WARLOCK, [...DRAFT_RULES.CLASSIC_ASPECTS], 40)]);
  const wme = w.state.players[0];
  check('Adam Warlock takes a single copy of anything', canTake(wme, helicarrier, w.context) && !canTake({ ...wme, picks: [h] }, helicarrier, w.context));
  const wPool = playerPool(w.state, wme, w.context);
  check('and his pool spans all four aspects', new Set(wPool.map((r) => r.factionCode)).size === 5);
}

{
  // Synergy option.
  const on = ready([player(0, MAGIK, ['justice'])], { settings: { synergyOnly: true } });
  const off = ready([player(0, MAGIK, ['justice'])]);
  // Read off the whole shelf: once the packs are built, what they hold is off it.
  const pooled = (s, c) => playerPool({ ...s, stock: Object.fromEntries(c.initialStock) }, s.players[0], c).map((r) => r.code);
  check('the synergy option keeps out what the identity cannot play (Rocket Raccoon, Magik)', !pooled(on.state, on.context).includes('16019') && pooled(off.state, off.context).includes('16019'));
  const wl = ready([player(0, WARLOCK, [...DRAFT_RULES.CLASSIC_ASPECTS])], { settings: { synergyOnly: true } });
  check('and leaves in what it can (Rocket Raccoon, Warlock)', pooled(wl.state, wl.context).includes('16019'));
}

// --- whole drafts ----------------------------------------------------------------------

{
  for (const [size, seed] of [[40, 1], [45, 2], [50, 3]]) {
    const { state, context } = ready([player(0, SPIDER, ['aggression'], size)], { seed });
    const end = playThrough(state, context);
    const v = validate(end.players[0], context);
    check(`a whole draft ends in a legal deck of ${size} (seed ${seed})`, end.phase === 'finish' && v.legal && cardCount(end.players[0]) === size,
      v.problems.map((p) => p.kind).join(',') || String(cardCount(end.players[0])));
  }
  const w = ready([player(0, WARLOCK, [...DRAFT_RULES.CLASSIC_ASPECTS], 44)], { seed: 7 });
  const wend = playThrough(w.state, w.context);
  const wv = validate(wend.players[0], w.context);
  check('Adam Warlock ends legal across four aspects, one copy of each card', wv.legal && new Set(wend.players[0].picks).size === wend.players[0].picks.length,
    wv.problems.map((p) => p.kind).join(','));
  const sw = ready([player(0, SPIDERWOMAN, ['justice', 'protection'], 42)], { seed: 11 });
  const swend = playThrough(sw.state, sw.context);
  const swv = validate(swend.players[0], sw.context);
  check('Spider-Woman ends balanced across her two aspects', swv.legal, swv.problems.map((p) => p.kind).join(','));

  const four = ready([player(0, SPIDER, ['justice']), player(1, WARLOCK, [...DRAFT_RULES.CLASSIC_ASPECTS]), player(2, MAGIK, ['protection']), player(3, SPIDERWOMAN, ['aggression', 'leadership'])], { seed: 5 });
  check('with four players the table passes to the next', pick(four.state, four.state.offer[0], four.context).current === 1);
  const fend = playThrough(four.state, four.context);
  check('four players share one shelf and all end legal', fend.phase === 'finish' && fend.players.every((p) => validate(p, four.context).legal && isFull(p)),
    fend.players.map((p) => validate(p, four.context).problems.map((x) => x.kind).join('/')).join(' | '));
  const totalPicked = fend.players.reduce((n, p) => n + p.picks.length, 0);
  const totalLeft = Object.values(fend.stock).reduce((n, c) => n + c, 0);
  check('one physical copy is drafted once, whoever takes it', totalPicked + totalLeft === [...four.context.initialStock.values()].reduce((n, c) => n + c, 0));
}

{
  // A shelf too small, and a player with nothing left.
  const tiny = new Map([['core', 1]]);
  const context = buildContext(index, tiny, [SPIDER, '01010a', '01019a', '01029a']);
  const players = [player(0, SPIDER, ['justice'], 50), player(1, '01010a', ['justice'], 50), player(2, '01019a', ['justice'], 50), player(3, '01029a', ['justice'], 50)];
  const state = { ...fresh(players), stock: Object.fromEntries(context.initialStock) };
  const short = shortfalls(state, context);
  check('a shelf too small for the decks asked is reported before anyone draws', short.length > 0, JSON.stringify(short));
  const one = shortfalls({ ...state, players: [player(0, SPIDER, ['justice'], 40)], settings: { ...state.settings, players: 1 } }, context);
  check('one Core Set fills one deck of forty', one.length === 0, JSON.stringify(one));
  const started = start(state, context);
  const end = playThrough(started, context);
  check('a player with nothing legal left is skipped, short, and the draft still ends', end.phase === 'finish' && end.players.some((p) => p.deckSize < 50));
  check('the full players are legal, the short one is not', end.players.filter((p) => p.deckSize === 50).every((p) => validate(p, context).legal));
  const skipped = skipCurrent(started, context);
  check('stopping here freezes the deck at its size', skipped.players[0].deckSize === cardCount(started.players[0]));
  void nextTurn;
}

// --- the names ---------------------------------------------------------------------------

{
  const spider = rulesFor(index, SPIDER);
  const warlock = rulesFor(index, WARLOCK);
  const spiderwoman = rulesFor(index, SPIDERWOMAN);
  check('the name is the identity folded, the aspect code, a two-digit suffix', defaultName('Spider-Man', ['aggression'], spider, []) === 'DRAFT-SPIDERMAN-AGGRESSION-01');
  check('Ms. Marvel', defaultName('Ms. Marvel', ['pool'], spider, []) === 'DRAFT-MSMARVEL-POOL-01');
  check('accents fold', defaultName('Nébula', ['justice'], spider, []) === 'DRAFT-NEBULA-JUSTICE-01');
  check('punctuation folds', defaultName('SP//dr', ['protection'], spider, []) === 'DRAFT-SPDR-PROTECTION-01');
  check('the suffix steps past names already taken, whatever their case',
    defaultName('Spider-Man', ['justice'], spider, ['draft-spiderman-justice-01', 'DRAFT-SPIDERMAN-JUSTICE-02']) === 'DRAFT-SPIDERMAN-JUSTICE-03');
  check('imposed aspects read MULTI', defaultName('Adam Warlock', [...DRAFT_RULES.CLASSIC_ASPECTS], warlock, []) === 'DRAFT-ADAMWARLOCK-MULTI-01');
  check('chosen pairs read both, alphabetically', defaultName('Spider-Woman', ['protection', 'justice'], spiderwoman, []) === 'DRAFT-SPIDERWOMAN-JUSTICE-PROTECTION-01');
  check('fold and aspectPart on their own', fold('Ms. Marvel') === 'MSMARVEL' && aspectPart(['justice'], spider) === 'JUSTICE');
}

// --- the generator ------------------------------------------------------------------------

{
  const a = seeded(42); const b = seeded(42);
  check('a seed repeats', [a(), a(), a()].join() === [b(), b(), b()].join());
  check('and shuffles the same', shuffled([1, 2, 3, 4, 5], seeded(9)).join() === shuffled([1, 2, 3, 4, 5], seeded(9)).join());
  check('without touching the input', (() => { const x = [1, 2, 3]; shuffled(x, seeded(1)); return x.join() === '1,2,3'; })());
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
