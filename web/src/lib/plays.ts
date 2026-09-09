import type { Play, PlayHero } from './records';
import { isLive } from './playQuery';
import type { Session } from './session.svelte';

/**
 * Turning a finished game into a play record.
 *
 * The formats here are not arbitrary and are not mine: they are what
 * `GameSessionViewModel` writes, down to the separators. `aspects` and
 * `otherHeroes` are joined with a comma *and a space*; `difficulty` is the
 * enum name lowercased, so `expert_i` rather than `EXPERT_I`; and `notes`
 * carries the modular sets, sorted and prefixed, because which modulars were
 * in play changes a scenario enough that a win rate without them is only half
 * the story.
 *
 * Getting these wrong would not fail loudly. It would quietly produce a second
 * dialect of the same data, and the statistics on the two clients would
 * disagree about the same games.
 */

export interface RecordInput {
  readonly session: Session;
  readonly elapsedMillis: number;
  readonly won: boolean;
  readonly notes: string;
  readonly location: string;
  readonly victoryPoints: number;
  /** Modular set names, already localised, for the notes line. */
  readonly modularSetNames: readonly string[];
}

export function buildPlay(input: RecordInput): Play {
  const { session, modularSetNames } = input;

  const roster: PlayHero[] = session.seats.map((seat) => ({
    code: seat.heroCode,
    name: seat.heroName,
    aspect: seat.aspect,
  }));

  const first = roster[0];

  const modularNote =
    modularSetNames.length === 0
      ? ''
      : `Modular sets: ${[...modularSetNames].sort().join(', ')}`;

  const notes = [input.notes.trim(), modularNote].filter((s) => s !== '').join('\n');

  return {
    id: crypto.randomUUID(),
    // Same instant as the game for a new row; an edit moves it and playedAt
    // stays put. See the note on Play.updatedAt.
    updatedAt: Date.now(),
    deletedAt: null,
    playedAt: Date.now(),
    scenarioCode: session.scenarioCode,
    scenarioName: session.scenarioName,
    // The enum name lowercased, as the app records it.
    difficulty: session.difficulty.toLowerCase(),
    standardSet: session.standardSet?.toLowerCase() ?? '',
    heroCode: first?.code ?? '',
    heroName: first?.name ?? '',
    aspects: [...new Set(roster.map((seat) => seat.aspect))].join(', '),
    otherHeroes: roster
      .slice(1)
      .map((seat) => seat.name)
      .join(', '),
    roster,
    players: roster.length,
    won: input.won,
    elapsedMillis: input.elapsedMillis,
    notes,
    location: input.location.trim(),
    victoryPoints: input.victoryPoints,
    campaignRunId: null,
    reportedToBgg: false,
    photos: '',
  };
}

// --- statistics ------------------------------------------------------------

export interface Tally {
  readonly key: string;
  readonly label: string;
  readonly played: number;
  readonly won: number;
}

function rate(t: Tally): number {
  return t.played === 0 ? 0 : t.won / t.played;
}

export function sortTallies(tallies: readonly Tally[]): Tally[] {
  // Most played first, then by win rate, so a 1-of-1 hero does not top a table
  // above somebody with twenty games.
  return [...tallies].sort(
    (a, b) => b.played - a.played || rate(b) - rate(a) || a.label.localeCompare(b.label),
  );
}

function tally(
  plays: readonly Play[],
  keysOf: (play: Play) => readonly { key: string; label: string }[],
): Tally[] {
  const out = new Map<string, { label: string; played: number; won: number }>();
  for (const play of plays) {
    for (const { key, label } of keysOf(play)) {
      const entry = out.get(key) ?? { label, played: 0, won: 0 };
      entry.played += 1;
      if (play.won) {
        entry.won += 1;
      }
      out.set(key, entry);
    }
  }
  /*
    Merged by label, because two keys can share one.

    A hero played before the roster column existed is grouped by name; the same
    hero after it is grouped by card code. Both come out labelled "Magneto",
    which splits one hero's record across two rows — and on Android, where the
    list keys on the label, crashed the screen outright with a duplicate key.
  */
  const byLabel = new Map<string, Tally>();
  for (const [key, value] of out) {
    const existing = byLabel.get(value.label);
    if (existing === undefined) {
      byLabel.set(value.label, { key, ...value });
    } else {
      byLabel.set(value.label, {
        ...existing,
        played: existing.played + value.played,
        won: existing.won + value.won,
      });
    }
  }
  return [...byLabel.values()];
}

/**
 * The seats at a table, falling back to the flat fields.
 *
 * `roster` is empty on plays recorded before it existed. Those still carry the
 * older `heroCode`/`heroName`/`aspects` fields, which say less — one hero for a
 * four-handed game — and the counting falls back to them rather than inventing
 * what is missing. The app's own comment on the field says as much.
 */
function seatsOf(play: Play): readonly PlayHero[] {
  if (play.roster.length > 0) {
    return play.roster;
  }

  const others = splitList(play.otherHeroes);

  /*
    Solo, and only solo, can be paired with confidence.

    One hero means the aspects listed on the play are necessarily that hero's,
    so they are attached. See docs/spec/statistics.md section 3.0.
  */
  if (others.length === 0) {
    if (play.heroCode === '' && play.heroName === '') {
      return [];
    }
    return [
      {
        code: play.heroCode,
        name: play.heroName === '' ? play.heroCode : play.heroName,
        aspect: splitList(play.aspects).join(', '),
      },
    ];
  }

  /*
    A group game recorded before the roster column existed.

    Enough to say who was there, not enough to say who played what: the aspects
    were kept as one flat list for the whole table. So the aspect is left blank
    and byHeroAspect skips these rather than inventing pairings nobody played.
    Only names survived for the other seats; there were never codes for them.

    This browser used to ignore `otherHeroes` altogether — crediting the first
    hero only, and pairing them with whichever aspect happened to be listed
    first. Three players vanished from the hero table and a fictional pairing
    appeared in another.
  */
  return [
    {
      code: play.heroCode,
      name: play.heroName === '' ? play.heroCode : play.heroName,
      aspect: '',
    },
    ...others.map((name) => ({ code: '', name, aspect: '' })),
  ];
}

/** Comma-separated, trimmed, with the empties dropped. */
const splitList = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');

/** Code where there is one, name otherwise: old seats have no code. */
const groupKey = (seat: PlayHero): string => (seat.code === '' ? seat.name : seat.code);

export interface Statistics {
  readonly total: number;
  readonly won: number;
  readonly byHero: readonly Tally[];
  readonly byAspect: readonly Tally[];
  readonly byHeroAspect: readonly Tally[];
  readonly byScenario: readonly Tally[];
  readonly byDifficulty: readonly Tally[];
  readonly byPlayerCount: readonly Tally[];
  readonly totalMillis: number;
  /** Mean length of the games that were timed. Zero when none were. */
  readonly averageMillis: number;
  readonly longestMillis: number;
  /**
   * Wins in a row ending at the most recent game, and the best run ever.
   *
   * Counted per game rather than per seat: a four-player win is one win in a
   * streak, however many heroes were at the table.
   */
  readonly currentStreak: number;
  readonly bestStreak: number;
  /** Games recorded against a campaign, which is a different kind of evening. */
  readonly campaignGames: number;
  readonly solo: number;
  readonly group: number;
}

/**
 * How to render the codes stored on a play.
 *
 * Passed in rather than resolved here: `aggression` and `expert_i` are what the
 * database holds in both clients, and turning them into "Agressivité" is the
 * interface's job, in the reader's language. Keeping the codes in the tallies
 * also means the keys stay stable when the language changes.
 */
/** The bucket a table size falls in. See docs/spec/statistics.md section 3.6. */
export function playerBucket(players: number): string {
  if (players <= 1) {
    return 'players_1';
  }
  if (players >= 5) {
    return 'players_5plus';
  }
  return `players_${players}`;
}

export interface StatLabels {
  readonly aspect: (code: string) => string;
  readonly difficulty: (code: string) => string;
  /** Names a table-size bucket: `players_1` through `players_5plus`. */
  readonly players: (bucket: string) => string;
  /**
   * Resolves a hero identifier recorded by an older version of the app.
   *
   * Plays used to store the hero's **set** code (`daredevil`) where they now
   * store its **card** code (`60001a`). Counting them apart splits one hero
   * into two rows: a real backup showed Daredevil as 6/9 and 0/1 at once.
   *
   * Merging by name instead would be wrong, because two different heroes can
   * share one: Spider-Man is both Peter Parker and Miles Morales.
   */
  readonly canonicalHero?: (code: string) => string;
}

/**
 * Whether a play counts.
 *
 * Exported so the two places that show a number of games agree with each
 * other: a play the reader has set aside should not be in the statistics and
 * should not be in the count beside their campaign either.
 */
export const counts = (play: Play): boolean => isLive(play);

/**
 * The statistics, over the plays that count.
 *
 * Filtered here rather than by the caller, deliberately. There are two screens
 * that ask for this and there will be more, and a filter every caller has to
 * remember is a filter one of them will forget — at which point the number the
 * reader set out to change is the one that did not move.
 */
/**
 * Wins in a row, most recent first, and the longest run in the history.
 *
 * Ordered by when the games were played rather than by the order they were
 * entered: somebody recording last week's game today has not broken this
 * week's streak, and reading the list as stored would say they had.
 *
 * A game that was set aside is already gone by the time this runs, which is
 * the intended reading — it did not count, so it neither makes nor breaks a
 * run.
 */
function streaks(plays: readonly Play[]): { current: number; best: number } {
  const byWhen = [...plays].sort((a, b) => a.playedAt - b.playedAt);
  let best = 0;
  let running = 0;
  for (const play of byWhen) {
    running = play.won ? running + 1 : 0;
    best = Math.max(best, running);
  }
  // `running` ends on the most recent game, which is exactly the current run.
  return { current: running, best };
}

export function computeStatistics(
  all: readonly Play[],
  labels: StatLabels,
): Statistics {
  /*
    Newest first, and sorted here rather than trusted to the caller.

    Load-bearing: `tally` keeps the first label it sees for a group, so this
    ordering is what makes a hero's row carry the name it was most recently
    recorded under — the name the reader currently sees it by. The scenario
    table depends on it for the same reason. A caller handing rows over in a
    different order would quietly change the labels.
  */
  const plays = [...all].filter(counts).sort((a, b) => b.playedAt - a.playedAt);
  const timed = plays.filter((play) => play.elapsedMillis > 0);
  const run = streaks(plays);
  return {
    total: plays.length,
    won: plays.filter((p) => p.won).length,
    totalMillis: plays.reduce((sum, p) => sum + p.elapsedMillis, 0),

    /*
     * Averaged over the games that were actually timed.
     *
     * A game recorded after the fact has no clock on it, and folding those in
     * as zero drags the average towards a length nobody played. The same
     * reasoning as the deck cost curve leaving out a starred cost.
     */
    averageMillis:
      timed.length === 0
        ? 0
        : Math.round(timed.reduce((sum, p) => sum + p.elapsedMillis, 0) / timed.length),
    longestMillis: plays.reduce((longest, p) => Math.max(longest, p.elapsedMillis), 0),

    currentStreak: run.current,
    bestStreak: run.best,

    /*
      Not null, and nothing else. An empty string is a campaign game.

      Neither client should ever write `''`, but when one does the two have to
      agree about what it means, and Android's test is `IS NOT NULL`.
      docs/spec/statistics.md section 2.7.
    */
    campaignGames: plays.filter((p) => p.campaignRunId !== null).length,
    /*
     * Solo against everything else, counted per game.
     *
     * One player is a different game from four, and the split is the first
     * thing anybody asks of a play history that mixes them.
     */
    solo: plays.filter((p) => p.players <= 1).length,
    group: plays.filter((p) => p.players > 1).length,

    // Counted per seat, so a four-player game credits four heroes. Counting
    // from heroCode alone credited the first player and ignored three.
    byHero: sortTallies(
      tally(plays, (play) =>
        seatsOf(play)
          // A seat with no name has nothing to show, so it is not a row.
          .filter((seat) => seat.name !== '')
          .map((seat) => ({
            key: labels.canonicalHero?.(groupKey(seat)) ?? groupKey(seat),
            label: seat.name,
          })),
      ),
    ),
    /*
      Per game, not per seat: two players both on Justice is one Justice game.

      Split on commas, because a seat may hold two. Keying on the whole string
      invented a phantom aspect called "justice, leadership" — and
      buildCampaignPlay writes exactly that shape for a dual-aspect deck, so it
      was not hypothetical.

      The fallback to the play's own list is for group games recorded before the
      roster column: their seats carry no aspect (see seatsOf) but the play
      still lists what was at the table.
    */
    byAspect: sortTallies(
      tally(plays, (play) => {
        const fromSeats = seatsOf(play).flatMap((seat) => splitList(seat.aspect));
        const aspects = fromSeats.length > 0 ? fromSeats : splitList(play.aspects);
        return [...new Set(aspects)].map((aspect) => ({
          key: aspect,
          label: labels.aspect(aspect),
        }));
      }),
    ),
    // The pairing, which is the question the flat fields could not answer:
    // they paired the first hero against every aspect at the table and so
    // invented combinations nobody played.
    /*
     * A pairing earns a row once it has been played twice.
     *
     * One game is not a record of how a hero does in an aspect, it is a
     * anecdote, and a table of them buries the pairings somebody actually
     * plays under every combination they tried once. The master applies the
     * same floor.
     */
    byHeroAspect: sortTallies(
      tally(plays, (play) =>
        seatsOf(play)
          .filter((seat) => seat.name !== '')
          // Split, so a dual-aspect seat is two pairings rather than one
          // pairing with a two-word name. Old group seats have no aspect and
          // so contribute nothing here, which is the intended behaviour.
          .flatMap((seat) =>
            splitList(seat.aspect).map((aspect) => ({
              key: `${labels.canonicalHero?.(groupKey(seat)) ?? groupKey(seat)}|${aspect}`,
              label: `${seat.name} · ${labels.aspect(aspect)}`,
            })),
          ),
      ),
    ).filter((row) => row.played >= 2),
    byScenario: sortTallies(
      tally(plays, (play) => [
        { key: play.scenarioCode, label: play.scenarioName || play.scenarioCode },
      ]),
    ),
    /*
      By difficulty alone.

      This used to fold in `standardSet` as well, producing rows labelled
      "Standard + standard". More information, but not what the phone shows, and
      not the question the table answers. docs/spec/statistics.md section 3.5.
    */
    byDifficulty: sortTallies(
      tally(plays, (play) => [
        { key: play.difficulty, label: labels.difficulty(play.difficulty) },
      ]),
    ),
    /*
      Five fixed buckets, never the raw count.

      `players_5plus` should never appear: this is a one to four player game, so
      a row there is a game recorded wrongly, and a visible row saying so is
      more use than folding it silently into the fours. Keying on the raw number
      gave a corrupt 7 its own quiet row.

      Ordered by key rather than by count, because the buckets have an order of
      their own. docs/spec/statistics.md section 3.6.
    */
    byPlayerCount: tally(plays, (play) => [
      { key: playerBucket(play.players), label: labels.players(playerBucket(play.players)) },
    ]).sort((a, b) => a.key.localeCompare(b.key)),
  };
}
