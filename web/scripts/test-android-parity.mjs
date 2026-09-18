/**
 * The same dataset, the same numbers, on both clients.
 *
 * Every case here is a port of `PlayStatsTest.kt` from the Android repository —
 * same fixtures, same expectations, translated to the web's record shape. That
 * is what makes it evidence rather than an opinion: these are the phone's own
 * tests, run against the browser's implementation. If a case here fails, the
 * two apps show different numbers for the same games and a user is about to
 * file a bug that takes two codebases to answer.
 *
 * The definitions they encode live in `docs/spec/statistics.md`, which is the
 * source of truth for both. Change the spec first.
 *
 *   npm run test:parity
 */
import { computeStatistics } from '../src/lib/plays.ts';
import { completePlay, playWire } from '../src/lib/playShape.ts';
import { readFileSync } from 'node:fs';

let failures = 0;
function check(label, ok, detail = '') {
  if (ok) {
    console.log(`ok    ${label}${detail ? `  (${detail})` : ''}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? `  (${detail})` : ''}`);
  }
}

/** Labels that pass codes straight through, so the assertions read as Android's. */
const LABELS = {
  aspect: (code) => code,
  difficulty: (code) => code,
  players: (bucket) => bucket,
};

let clock = 1_700_000_000_000;

/**
 * A modern play, mirroring PlayStatsTest.row: seats are (hero, aspect) pairs,
 * and the flat fields are filled the way the app fills them.
 */
const row = (seats, { won = true, millis = 0 } = {}) => ({
  id: `row-${clock}`,
  // Descending, so the fixtures keep the order Android's newest-first list has.
  playedAt: clock--,
  scenarioCode: 'sc',
  scenarioName: 'Scenario',
  difficulty: 'standard',
  standardSet: '',
  heroCode: seats[0]?.[0] ?? '',
  heroName: seats[0]?.[0] ?? '',
  aspects: [...new Set(seats.map((s) => s[1]))].join(', '),
  otherHeroes: seats.slice(1).map((s) => s[0]).join(', '),
  roster: seats.map(([code, aspect]) => ({ code, name: code, aspect })),
  players: seats.length,
  won,
  elapsedMillis: millis,
  notes: '',
  location: '',
  victoryPoints: 0,
  campaignRunId: null,
  reportedToBgg: false,
  photos: '',
  updatedAt: clock,
  deletedAt: null,
});

/** An old row: the roster column is empty, as for every play before it existed. */
const legacyRow = (first, { others = [], aspects = '', won = true, code = first } = {}) => ({
  ...row([[first, '']], { won }),
  heroCode: code,
  heroName: first,
  aspects,
  otherHeroes: others.join(', '),
  roster: [],
  players: 1 + others.length,
});

const stats = (plays) => computeStatistics(plays, LABELS);
const keys = (table) => table.map((r) => r.key);
const labels = (table) => table.map((r) => r.label);
const sorted = (values) => [...values].sort();

// --- every hero at the table is counted, not only the first -------------------
{
  const s = stats([
    row([
      ['Spider-Man', 'Justice'],
      ['Thor', 'Aggression'],
      ['Ms Marvel', 'Protection'],
      ['Captain Marvel', 'Leadership'],
    ]),
  ]);
  check('four seats make four hero rows', s.byHero.length === 4, `${s.byHero.length}`);
  check(
    'and they are the four who played',
    sorted(labels(s.byHero)).join(',') === 'Captain Marvel,Ms Marvel,Spider-Man,Thor',
    labels(s.byHero).join(','),
  );
  check('each played once', s.byHero.every((r) => r.played === 1));
  check('each won once', s.byHero.every((r) => r.won === 1));
  check('and the game is still one game', s.total === 1 && s.won === 1);
}

// --- a pairing uses that hero's own aspect, not the whole table's -------------
{
  const s = stats([
    row([['Spider-Man', 'Justice'], ['Thor', 'Aggression']]),
    row([['Spider-Man', 'Justice'], ['Thor', 'Aggression']]),
  ]);
  check(
    'pairings are the ones actually played',
    sorted(labels(s.byHeroAspect)).join(',') === 'Spider-Man · Justice,Thor · Aggression',
    labels(s.byHeroAspect).join(','),
  );
  check(
    'and no combination is invented',
    !labels(s.byHeroAspect).includes('Spider-Man · Aggression'),
  );
}

// --- one game counts once per aspect even when two seats share one ------------
{
  const s = stats([row([['Spider-Man', 'Justice'], ['Ms Marvel', 'Justice']])]);
  check('two seats on one aspect is one row', s.byAspect.length === 1, keys(s.byAspect).join(','));
  check('and one game, not two', s.byAspect[0]?.played === 1, `${s.byAspect[0]?.played}`);
}

// --- a loss counts against every hero who was there ---------------------------
{
  const s = stats([row([['Spider-Man', 'Justice'], ['Thor', 'Aggression']], { won: false })]);
  check('both heroes carry the loss', s.byHero.length === 2 && s.byHero.every((r) => r.won === 0));
  check('and both were there', s.byHero.every((r) => r.played === 1));
}

// --- an old solo play still pairs its hero with its aspects -------------------
{
  const s = stats([
    legacyRow('Spider-Man', { aspects: 'Justice' }),
    legacyRow('Spider-Man', { aspects: 'Justice' }),
  ]);
  check(
    'solo is the one old row that can be paired safely',
    labels(s.byHeroAspect).join(',') === 'Spider-Man · Justice',
    labels(s.byHeroAspect).join(','),
  );
  check('twice', s.byHeroAspect[0]?.played === 2, `${s.byHeroAspect[0]?.played}`);
}

// --- an old group play counts its heroes but invents no pairings --------------
{
  const old = [
    legacyRow('Spider-Man', { others: ['Thor'], aspects: 'Justice, Aggression' }),
    legacyRow('Spider-Man', { others: ['Thor'], aspects: 'Justice, Aggression' }),
  ];
  const s = stats(old);
  check(
    'the names are known, so both heroes are counted',
    sorted(labels(s.byHero)).join(',') === 'Spider-Man,Thor',
    labels(s.byHero).join(','),
  );
  check(
    'the aspects are known, so both are counted',
    sorted(labels(s.byAspect)).join(',') === 'Aggression,Justice',
    labels(s.byAspect).join(','),
  );
  check(
    'who played which is not known, so nothing is guessed',
    s.byHeroAspect.length === 0,
    labels(s.byHeroAspect).join(','),
  );
}

// --- a pairing played only once is left out -----------------------------------
{
  const s = stats([row([['Spider-Man', 'Justice']])]);
  check('one game is an anecdote, not a row', s.byHeroAspect.length === 0);
}

// --- one hero recorded two ways is one row, not two ---------------------------
{
  // Grouped by name before the roster column and by card code after it, and
  // both come out labelled the same. Two rows with one label split the record
  // and, on Android, took the screen down with a duplicate key.
  const legacy = { ...legacyRow('Magneto', { aspects: 'Leadership', code: '' }) };
  const modern = row([['Magneto', 'Leadership']], { won: false });
  const s = stats([legacy, modern]);

  check('one hero is one row', s.byHero.length === 1, labels(s.byHero).join(','));
  check('labelled once', s.byHero[0]?.label === 'Magneto');
  check('played twice', s.byHero[0]?.played === 2, `${s.byHero[0]?.played}`);
  check('won once', s.byHero[0]?.won === 1, `${s.byHero[0]?.won}`);
}

// --- every row of a table has a distinct key ----------------------------------
{
  const rows = [
    row([['Magneto', 'Leadership']]),
    legacyRow('Magneto', { aspects: 'Justice', code: '' }),
    row([['Thor', 'Aggression']]),
  ];
  const s = stats(rows);
  for (const [name, table] of [
    ['byHero', s.byHero],
    ['byAspect', s.byAspect],
    ['byHeroAspect', s.byHeroAspect],
    ['byScenario', s.byScenario],
    ['byDifficulty', s.byDifficulty],
    ['byPlayerCount', s.byPlayerCount],
  ]) {
    const ks = keys(table);
    check(`${name} keys are distinct`, new Set(ks).size === ks.length, ks.join(','));
    const ls = labels(table);
    check(`${name} labels are distinct`, new Set(ls).size === ls.length, ls.join(','));
  }
}

// --- the headline figures, from PlaysViewModel.summarise ----------------------
{
  /*
   * Android sums total time over every play and averages over the timed ones
   * only, so `average x games` deliberately does not equal `total`. See
   * docs/spec/statistics.md section 2.4.
   */
  const s = stats([
    row([['A', 'Justice']], { millis: 3_600_000 }),
    row([['B', 'Justice']], { millis: 1_800_000 }),
    row([['C', 'Justice']], { millis: 0 }),
  ]);
  check('total time counts every game', s.totalMillis === 5_400_000, `${s.totalMillis}`);
  check('the average counts only the timed ones', s.averageMillis === 2_700_000, `${s.averageMillis}`);
  check('the longest is the longest', s.longestMillis === 3_600_000);
  check(
    'no timed game averages to nothing rather than dividing by zero',
    stats([row([['A', 'Justice']], { millis: 0 })]).averageMillis === 0,
  );
}

// --- table size buckets --------------------------------------------------------
{
  const s = stats([
    row([['A', 'Justice']]),
    row([['A', 'Justice'], ['B', 'Leadership']]),
    { ...row([['A', 'Justice']]), players: 7 },
  ]);
  check(
    'sizes are bucketed, never raw',
    keys(s.byPlayerCount).join(',') === 'players_1,players_2,players_5plus',
    keys(s.byPlayerCount).join(','),
  );
  check(
    'and a game recorded wrongly stays visible rather than joining the fours',
    keys(s.byPlayerCount).includes('players_5plus'),
  );
}

// --- difficulty, by difficulty alone -------------------------------------------
{
  const s = stats([
    { ...row([['A', 'Justice']]), difficulty: 'standard', standardSet: 'standard' },
    { ...row([['A', 'Justice']]), difficulty: 'standard', standardSet: 'expert' },
  ]);
  check(
    'the standard set does not split the difficulty table',
    s.byDifficulty.length === 1 && s.byDifficulty[0]?.played === 2,
    keys(s.byDifficulty).join(','),
  );
}

// --- a campaign game is one with a run id, empty string included ---------------
{
  const s = stats([
    { ...row([['A', 'Justice']]), campaignRunId: 'run-1' },
    { ...row([['A', 'Justice']]), campaignRunId: '' },
    { ...row([['A', 'Justice']]), campaignRunId: null },
  ]);
  check('not null, and nothing else', s.campaignGames === 2, `${s.campaignGames}`);
}

{
  /*
   * The key that is not there at all.
   *
   * Android serialises with `explicitNulls = false`, so a play with no campaign
   * crosses the wire with no `campaignRunId` key — missing, not null. Testing
   * `!== null` calls that a campaign game, which put an "in a campaign" badge
   * on every standalone game anybody had ever synced from their phone. Reported
   * from production against a history full of randomiser games.
   */
  const fromAndroid = row([['A', 'Justice']]);
  delete fromAndroid.campaignRunId;

  const s = stats([fromAndroid, { ...row([['B', 'Justice']]), campaignRunId: 'run-1' }]);
  check(
    'a play whose campaign key never arrived is not a campaign game',
    s.campaignGames === 1,
    `${s.campaignGames}`,
  );
}

// --- deleted plays count for nothing -------------------------------------------
{
  const s = stats([
    row([['A', 'Justice']]),
    { ...row([['B', 'Justice']]), deletedAt: Date.now() },
  ]);
  check('a deleted play is not a played game', s.total === 1, `${s.total}`);
  check('and it is in no table', s.byHero.length === 1, labels(s.byHero).join(','));
}

// --- an empty history ----------------------------------------------------------
{
  const s = stats([]);
  check('an empty history totals nothing', s.total === 0 && s.won === 0);
  check('every table is empty', [s.byHero, s.byAspect, s.byHeroAspect, s.byScenario, s.byDifficulty, s.byPlayerCount].every((t) => t.length === 0));
  check('and every figure is zero rather than undefined', s.totalMillis === 0 && s.averageMillis === 0 && s.longestMillis === 0 && s.currentStreak === 0 && s.bestStreak === 0 && s.campaignGames === 0);
}

// --- a single game -------------------------------------------------------------
{
  const s = stats([row([['A', 'Justice']], { won: true, millis: 60_000 })]);
  check('one game is one game', s.total === 1 && s.won === 1);
  check('its streak is one', s.currentStreak === 1 && s.bestStreak === 1);
  check('and its pairing is still below the floor', s.byHeroAspect.length === 0);
}

// --- a body exactly as Android sends one ---------------------------------------

{
  /*
   * The shape that blanked the statistics page for a real account.
   *
   * kotlinx omits every property equal to its declared default as well as
   * every explicit null, so PlayEntity crosses the wire missing most of its
   * optional fields. The web spread that body onto a row whose type claimed
   * every field was present. `roster` was absent, iterating it threw inside the
   * aggregate, the render aborted, and the page kept showing its loading line.
   */
  const wire = {
    id: 'sync-1',
    playedAt: 1_700_000_000_000,
    scenarioCode: '01097',
    scenarioName: 'Rhino',
    difficulty: 'standard',
    heroCode: '01001a',
    heroName: 'Spider-Man',
    aspects: 'justice',
    won: true,
  };

  const filled = completePlay(wire, wire.id);
  check('a missing roster becomes an empty one', Array.isArray(filled.roster) && filled.roster.length === 0);
  check('a missing player count is one, not nought', filled.players === 1, String(filled.players));
  check('a missing campaign id is null, not undefined', filled.campaignRunId === null);
  check('a missing deletedAt is null, so the play is live', filled.deletedAt === null);
  check('a missing updatedAt falls back to when it was played', filled.updatedAt === wire.playedAt);
  check('missing text fields are empty strings', filled.notes === '' && filled.location === '' && filled.standardSet === '');
  check('and a missing victoryPoints is nought', filled.victoryPoints === 0);

  let threw = null;
  let computed = null;
  try {
    computed = stats([filled]);
  } catch (error) {
    threw = String(error);
  }
  check('the statistics compute over it rather than throwing', threw === null, threw ?? '');
  check(
    'and count it as one solo game outside a campaign',
    computed !== null && computed.total === 1 && computed.campaignGames === 0 &&
      computed.byPlayerCount[0] !== undefined && computed.byPlayerCount[0].key === 'players_1',
  );
  check('crediting the hero it names', computed?.byHero[0]?.label === 'Spider-Man', computed?.byHero[0]?.label);

  const again = completePlay(filled, filled.id);
  check('completing a complete row changes nothing', JSON.stringify(again) === JSON.stringify(filled));
}

{
  // Backup format 2 round trip: a phone's export, with the achievements'
  // fields and two fields this build has never heard of, comes through
  // completePlay and back out of playWire whole. docs/spec/achievements/sync.md §2.
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/backup-android-v2.json', import.meta.url), 'utf8'));
  const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v !== null && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
  const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
  const [full, sparse] = fixture.plays;
  const filledFull = completePlay(full, full.id);
  check('a v2 play keeps the owner seat', filledFull.roster[0].isOwner === true && filledFull.roster[1].isOwner === undefined);
  check('and its mode', filledFull.mode === 'draft');
  check('an unknown play field is kept aside, not read', filledFull.extra?.weather === 'rain' && !('weather' in filledFull));
  check('an unknown seat field too', filledFull.roster[1].extra?.seatColour === 'blue');
  check('and the record goes back on the wire field for field', same(playWire(filledFull), full), JSON.stringify(playWire(filledFull)));
  const filledSparse = completePlay(sparse, sparse.id);
  check('a reserved mode is kept as it is', filledSparse.mode === 'sealed');
  check('a sparse v2 play fills in and writes back its own fields plus the defaults', (() => {
    const wire = playWire(filledSparse);
    return wire.mode === 'sealed' && wire.roster.length === 0 && wire.players === 1 && wire.difficulty === 'expert';
  })());
  check('completing twice is the same as once', same(completePlay(filledFull, full.id), filledFull));
  const v1 = { id: 'v1', playedAt: 1, scenarioCode: 'rhino', roster: [{ code: '01001a', name: 'Spider-Man', aspect: 'justice' }], won: true };
  const filledV1 = completePlay(v1, v1.id);
  check('a v1 play carries no owner flag and no mode: the readings supply them', filledV1.roster[0].isOwner === undefined && filledV1.mode === undefined && !('extra' in filledV1));
}

console.log(failures === 0 ? '\nthe two clients agree' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
