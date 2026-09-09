/**
 * Plays that count, and plays that do not.
 *
 * A play can be deleted: a demo taught to somebody, a duplicate recorded
 * twice, a run abandoned halfway. The row stays — it is still in the backup and
 * still on the other devices — but it must leave the numbers, and it must leave
 * *every* number rather than the one screen somebody remembered to filter.
 *
 * That is the failure worth a test. Nothing errors when a filter is forgotten:
 * the reader sets a play aside, the total does not move, and the only way to
 * find out is to count by hand.
 *
 *   npm run test:plays
 */
import { computeStatistics, counts } from '../src/lib/plays.ts';

let failures = 0;
function check(label, ok, detail = '') {
  if (ok) {
    console.log(`ok    ${label}${detail ? `  (${detail})` : ''}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? `  (${detail})` : ''}`);
  }
}

const LABELS = {
  aspect: (code) => code,
  difficulty: (code) => code,
  players: (bucket) => bucket,
};

const play = (id, extra = {}) => ({
  id,
  playedAt: 1700000000000,
  scenarioCode: 'rhino',
  scenarioName: 'Rhino',
  difficulty: 'standard',
  standardSet: '',
  heroCode: '01001',
  heroName: 'Spider-Man',
  aspects: 'justice',
  otherHeroes: '',
  roster: [],
  players: 1,
  won: true,
  elapsedMillis: 60000,
  notes: '',
  location: '',
  victoryPoints: 0,
  campaignRunId: null,
  reportedToBgg: false,
  photos: '',
  ...extra,
});

{
  check('a play with no opinion counts', counts(play('a')));
  check('a play recorded before tombstones existed counts', counts(play('b', { deletedAt: undefined })));
  check('a live play counts', counts(play('c', { deletedAt: null })));
  check('a deleted one does not', !counts(play('d', { deletedAt: Date.now() })));
}

{
  const all = [
    play('a', { won: true }),
    play('b', { won: false }),
    play('c', { won: false, deletedAt: 1_700_000_100_000 }),
  ];
  const stats = computeStatistics(all, LABELS);

  check('the total leaves out what was deleted', stats.total === 2, `total ${stats.total}`);
  check('and so does the win count', stats.won === 1, `won ${stats.won}`);
  check(
    'so the rate is of the games that count',
    stats.total > 0 && Math.round((stats.won / stats.total) * 100) === 50,
  );
  check(
    'time played leaves it out too',
    stats.totalMillis === 120000,
    `${stats.totalMillis}ms`,
  );
}

{
  /*
   * The breakdowns, not only the headline.
   *
   * This is the half that rots quietly: a filter applied to the total and not
   * to the tables gives a page whose rows do not add up to their own heading,
   * and nobody reads it closely enough to notice for months.
   */
  const all = [
    play('a', { heroCode: '01001', heroName: 'Spider-Man', won: true }),
    play('b', { heroCode: '01002', heroName: 'Captain Marvel', won: true }),
    play('c', { heroCode: '01002', heroName: 'Captain Marvel', won: false, deletedAt: 1_700_000_100_000 }),
  ];
  const stats = computeStatistics(all, LABELS);
  const marvel = stats.byHero.find((row) => row.label.includes('Captain Marvel'));

  check('a hero row counts only the games that count', marvel?.played === 1, `played ${marvel?.played}`);
  check('and its wins agree with its plays', marvel?.won === 1, `won ${marvel?.won}`);
  check(
    'the rows add up to the total',
    stats.byHero.reduce((sum, row) => sum + row.played, 0) === stats.total,
  );
}

{
  // Everything ignored is an empty page, not a division by zero.
  const stats = computeStatistics([play('a', { deletedAt: 1_700_000_100_000 })], LABELS);
  check('deleting every play empties the statistics', stats.total === 0);
  check('and leaves no rows behind it', stats.byHero.length === 0);
}

// --- the headline figures ------------------------------------------------------

{
  /*
   * Streaks read by when the games were played, not by the order they were
   * entered. Somebody recording last week's loss today has not broken this
   * week's run, and reading the list as stored would say they had.
   */
  const day = 86_400_000;
  const at = (n) => 1_700_000_000_000 + n * day;

  const stats = computeStatistics(
    [
      // Entered out of order on purpose.
      play('c', { playedAt: at(3), won: true }),
      play('a', { playedAt: at(1), won: true }),
      play('d', { playedAt: at(4), won: true }),
      play('b', { playedAt: at(2), won: false }),
    ],
    LABELS,
  );

  check('the current streak ends at the most recent game', stats.currentStreak === 2, `${stats.currentStreak}`);
  check('the best streak is the longest run anywhere', stats.bestStreak === 2, `${stats.bestStreak}`);
}

{
  const day = 86_400_000;
  const at = (n) => 1_700_000_000_000 + n * day;
  const broken = computeStatistics(
    [
      play('a', { playedAt: at(1), won: true }),
      play('b', { playedAt: at(2), won: true }),
      play('c', { playedAt: at(3), won: true }),
      play('d', { playedAt: at(4), won: false }),
    ],
    LABELS,
  );
  check('a loss on the last game ends the current run', broken.currentStreak === 0);
  check('but the best run is remembered', broken.bestStreak === 3);
}

{
  /*
   * A game recorded after the fact carries no clock. Folding those in as zero
   * drags the average towards a length nobody played, so the average is over
   * the games that were timed while the longest is over all of them.
   */
  const stats = computeStatistics(
    [
      play('timed-1', { elapsedMillis: 60 * 60 * 1000 }),
      play('timed-2', { elapsedMillis: 30 * 60 * 1000 }),
      play('untimed', { elapsedMillis: 0 }),
    ],
    LABELS,
  );
  check('the average is over the games that were timed', stats.averageMillis === 45 * 60 * 1000, `${stats.averageMillis}`);
  check('the longest is the longest', stats.longestMillis === 60 * 60 * 1000);
  check('and the total still counts everything', stats.totalMillis === 90 * 60 * 1000);
  check(
    'no timed game is an average of nothing rather than a division by zero',
    computeStatistics([play('x', { elapsedMillis: 0 })], LABELS).averageMillis === 0,
  );
}

{
  const stats = computeStatistics(
    [
      play('solo', { players: 1 }),
      play('duo', { players: 2 }),
      play('four', { players: 4 }),
      play('campaign', { players: 1, campaignRunId: 'run-1' }),
    ],
    LABELS,
  );
  check('solo and group are split per game', stats.solo === 2 && stats.group === 2, `${stats.solo} solo, ${stats.group} group`);
  check('campaign games are counted', stats.campaignGames === 1);
  check(
    'a play with no campaign is not one',
    computeStatistics([play('x', { campaignRunId: null })], LABELS).campaignGames === 0,
  );
  check(
    'and an empty campaign id is one, because the phone counts it as one',
    computeStatistics([play('x', { campaignRunId: '' })], LABELS).campaignGames === 1,
    'docs/spec/statistics.md section 2.7',
  );
}

{
  /*
   * A hero-and-aspect pairing earns its row on the second game. One is an
   * anecdote, and a table of them buries the pairings somebody actually plays.
   */
  const once = computeStatistics(
    [play('a', { heroCode: '01001', heroName: 'Spider-Man', aspects: 'justice' })],
    LABELS,
  );
  check('a pairing played once earns no row', once.byHeroAspect.length === 0);

  const twice = computeStatistics(
    [
      play('a', { heroCode: '01001', heroName: 'Spider-Man', aspects: 'justice' }),
      play('b', { heroCode: '01001', heroName: 'Spider-Man', aspects: 'justice' }),
    ],
    LABELS,
  );
  check('played twice, it does', twice.byHeroAspect.length === 1, twice.byHeroAspect[0]?.label);
  check(
    'and the hero table still counts the single game',
    once.byHero.length === 1,
    'the floor is on the pairing, not on the hero',
  );
}

{
  // A deleted game neither makes nor breaks a run: it did not count.
  const day = 86_400_000;
  const at = (n) => 1_700_000_000_000 + n * day;
  const stats = computeStatistics(
    [
      play('a', { playedAt: at(1), won: true }),
      play('b', { playedAt: at(2), won: false, deletedAt: 1_700_000_100_000 }),
      play('c', { playedAt: at(3), won: true }),
    ],
    LABELS,
  );
  check('a deleted loss does not break a streak', stats.currentStreak === 2, `${stats.currentStreak}`);
}

// --- the cache, which must never answer a question it was not asked -----------

{
  /*
   * Statistics are memoised, because the page is one tab from the history and
   * recomputing thousands of rows on every visit is a round trip somebody makes
   * often. A stale answer is far worse than a slow one, so these are the four
   * ways the history can change.
   */
  const a = play('a', { won: true, playedAt: 1_000, updatedAt: 1_000 });
  const b = play('b', { won: false, playedAt: 2_000, updatedAt: 2_000 });

  const first = computeStatistics([a], LABELS);
  check('the cache returns the same answer for the same history', computeStatistics([a], LABELS) === first);

  const added = computeStatistics([a, b], LABELS);
  check('a new game is a new answer', added.total === 2, `${added.total}`);

  const edited = computeStatistics([{ ...a, won: false, updatedAt: 9_000 }], LABELS);
  check('an edit is a new answer', edited.won === 0, `${edited.won}`);

  const deleted = computeStatistics([{ ...a, deletedAt: 10_000 }], LABELS);
  check('a delete is a new answer', deleted.total === 0, `${deleted.total}`);

  const other = computeStatistics([a], { ...LABELS, aspect: () => 'Justicia' });
  check('a change of language is a new answer', other !== first);
}

{
  /*
   * Collisions, which is how a cache lies.
   *
   * Three keys were tried before one was right, and every failure had the same
   * shape: two different histories hashing the same, the second answered with
   * the first one's numbers. These are the near-misses that caught each one.
   */
  const base = { playedAt: 1_000, updatedAt: 0, deletedAt: null };

  const spider = computeStatistics([play('x', { ...base, heroCode: '01001', heroName: 'Spider-Man' })], LABELS);
  const marvel = computeStatistics([play('x', { ...base, heroCode: '01002', heroName: 'Captain Marvel' })], LABELS);
  check(
    'same id, same stamps, different hero: a different answer',
    marvel.byHero[0]?.label === 'Captain Marvel',
    marvel.byHero[0]?.label,
  );
  check('and the first answer was not the second', spider.byHero[0]?.label === 'Spider-Man');

  const outside = computeStatistics([play('y', { ...base, campaignRunId: null })], LABELS);
  const inside = computeStatistics([play('y', { ...base, campaignRunId: '' })], LABELS);
  check(
    'null and an empty campaign id are told apart',
    outside.campaignGames === 0 && inside.campaignGames === 1,
    `${outside.campaignGames} then ${inside.campaignGames}`,
  );

  const lost = computeStatistics([play('z', { ...base, won: false })], LABELS);
  const beat = computeStatistics([play('z', { ...base, won: true })], LABELS);
  check('and a result flipped is a different answer', lost.won === 0 && beat.won === 1);

  const solo = computeStatistics([play('w', { ...base, players: 1 })], LABELS);
  const four = computeStatistics([play('w', { ...base, players: 4 })], LABELS);
  check(
    'as is a table size',
    solo.byPlayerCount[0]?.key === 'players_1' && four.byPlayerCount[0]?.key === 'players_4',
    `${solo.byPlayerCount[0]?.key} then ${four.byPlayerCount[0]?.key}`,
  );
}

process.exit(failures === 0 ? 0 : 1);
