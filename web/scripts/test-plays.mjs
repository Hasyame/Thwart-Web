/**
 * Plays that count, and plays that do not.
 *
 * A play can be set aside: a demo taught to somebody, a duplicate recorded
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
  check('a play recorded before this existed counts', counts(play('b', { ignored: undefined })));
  check('a play explicitly not ignored counts', counts(play('c', { ignored: false })));
  check('an ignored play does not', !counts(play('d', { ignored: true })));
}

{
  const all = [
    play('a', { won: true }),
    play('b', { won: false }),
    play('c', { won: false, ignored: true }),
  ];
  const stats = computeStatistics(all, LABELS);

  check('the total leaves out what was set aside', stats.total === 2, `total ${stats.total}`);
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
    play('c', { heroCode: '01002', heroName: 'Captain Marvel', won: false, ignored: true }),
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
  const stats = computeStatistics([play('a', { ignored: true })], LABELS);
  check('setting every play aside empties the statistics', stats.total === 0);
  check('and leaves no rows behind it', stats.byHero.length === 0);
}

process.exit(failures === 0 ? 0 : 1);
