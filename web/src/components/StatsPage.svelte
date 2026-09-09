<script lang="ts">
  import { liveQuery } from 'dexie';
  import type { Play } from '../lib/records';
  import type { IndexRow, Locale } from '../lib/types';
  import type { Strings } from '../lib/i18n';
  import { db } from '../lib/db';
  import { computeStatistics, type Tally } from '../lib/plays';
  import PlayRow from './PlayRow.svelte';
  import { formatElapsed } from '../lib/session.svelte';
  import { normalizeForSearch } from '../lib/normalize.js';

  interface Props {
    t: Strings;
    /** Dates on the game list read in the interface's language, not the cards'. */
    uiLocale: Locale;
    index: readonly IndexRow[];
    storageOk: boolean;
  }

  const { t, uiLocale, index, storageOk }: Props = $props();

  /**
   * Hero set code to hero card code.
   *
   * Older plays recorded the set code where newer ones record the card code,
   * so without this one hero is counted as two.
   */
  const heroBySetCode = $derived.by(() => {
    const map = new Map<string, string>();
    for (const row of index) {
      if (row.typeCode === 'hero' && row.setCode !== null && !map.has(row.setCode)) {
        map.set(row.setCode, row.code);
      }
    }
    return map;
  });

  const store = $state<{ plays: readonly Play[] }>({ plays: [] });

  $effect(() => {
    if (!storageOk) {
      return;
    }
    const sub = liveQuery(() =>
      db.plays.orderBy('playedAt').reverse().toArray(),
    ).subscribe((rows) => {
      store.plays = rows;
    });
    return () => sub.unsubscribe();
  });

  /**
   * Names a stored difficulty code.
   *
   * Plays hold the enum name lowercased, so `expert_i` is looked up as
   * `EXPERT_I`. Anything the map does not know is returned **as written**
   * rather than upper-cased: PlayEntity allows `standard`, `expert`, or a
   * campaign's own difficulty, and those are free text a campaign author
   * chose. Shouting an unrecognised one back at the reader helps nobody.
   */
  function difficultyLabel(code: string): string {
    const key = code.toUpperCase();
    const named = t.difficulty(key);
    return named === key ? code : named;
  }

  const stats = $derived(
    computeStatistics(store.plays, {
      aspect: (code) => t.aspect(code),
      difficulty: difficultyLabel,
      players: (bucket) => t.playerBucket(bucket),
      canonicalHero: (code) => heroBySetCode.get(code) ?? code,
    }),
  );

  const winRate = $derived(
    stats.total === 0 ? 0 : Math.round((stats.won / stats.total) * 100),
  );

  function percent(entry: Tally): number {
    return entry.played === 0 ? 0 : Math.round((entry.won / entry.played) * 100);
  }

  /*
   * How the rows are ordered, and what the bar measures.
   *
   * Two separate questions, and the master keeps them separate: a rate is a
   * proportion of that row's own games, a share is a proportion of every row
   * together. Sorting by win rate with the bar showing share is a perfectly
   * reasonable thing to want, so neither control implies the other.
   */
  type Sort = 'alpha' | 'played' | 'best' | 'worst';
  type Measure = 'win' | 'loss' | 'share';

  let sort = $state<Sort>('played');
  let measure = $state<Measure>('win');
  /** One field filters every table, as the master does it. */
  let filter = $state('');
  /** Tables open to a few rows; the rest are one press away. */
  const PREVIEW_ROWS = 5;
  const expanded = $state<Record<string, boolean>>({});

  const matches = (row: Tally): boolean =>
    filter.trim() === '' || normalizeForSearch(row.label).includes(normalizeForSearch(filter));

  function ordered(rows: readonly Tally[]): Tally[] {
    const kept = rows.filter(matches);
    const byRate = (row: Tally) => (row.played === 0 ? 0 : row.won / row.played);
    switch (sort) {
      case 'alpha':
        return [...kept].sort((a, b) => a.label.localeCompare(b.label));
      case 'best':
        return [...kept].sort((a, b) => byRate(b) - byRate(a) || b.played - a.played);
      case 'worst':
        return [...kept].sort((a, b) => byRate(a) - byRate(b) || b.played - a.played);
      default:
        return [...kept].sort((a, b) => b.played - a.played || a.label.localeCompare(b.label));
    }
  }

  /**
   * The length of a row's bar, as a percentage.
   *
   * A rate fills against that row's own games. A share fills against the
   * largest row in the same table, because a share of two per cent drawn
   * against the full width would say the opposite of what it means.
   */
  function bar(row: Tally, rows: readonly Tally[]): number {
    if (measure === 'win') {
      return percent(row);
    }
    if (measure === 'loss') {
      return 100 - percent(row);
    }
    const largest = rows.reduce((most, entry) => Math.max(most, entry.played), 0);
    return largest === 0 ? 0 : Math.round((row.played / largest) * 100);
  }

  function figure(row: Tally): string {
    if (measure === 'win') {
      return `${percent(row)}%`;
    }
    if (measure === 'loss') {
      return `${100 - percent(row)}%`;
    }
    return `${row.played}`;
  }

  /**
   * Which tables are worth drawing.
   *
   * A table with one row says nothing a headline number has not already said,
   * so it is left out rather than padded — the point of this page is the
   * comparison, and there is no comparison in a single row.
   */
  const tables = $derived(
    (
      [
        [t.byHero, stats.byHero],
        [t.byAspect, stats.byAspect],
        [t.byHeroAspect, stats.byHeroAspect],
        [t.byScenario, stats.byScenario],
        [t.byDifficulty, stats.byDifficulty],
        [t.byPlayerCount, stats.byPlayerCount],
      ] as ReadonlyArray<readonly [string, readonly Tally[]]>
    ).filter(([, rows]) => rows.length > 1),
  );

  /*
   * How many games to list before asking.
   *
   * Somebody with two hundred plays does not want two hundred rows between them
   * and the bottom of the page, and the reason to come here is almost always a
   * recent game. The rest are one button away.
   */
  const PAGE = 10;
  let shown = $state(PAGE);
  const listed = $derived(store.plays.slice(0, shown));
  const remaining = $derived(Math.max(0, store.plays.length - shown));
</script>

<section>
  <h1>{t.statsTitle}</h1>

  {#if !storageOk}
    <div class="notice surface"><p>{t.storageUnavailable}</p></div>
  {:else if stats.total === 0}
    <div class="notice surface">
      <p>{t.statsEmpty}</p>
      <p class="muted">{t.statsEmptyHint}</p>
    </div>
  {:else}
    <!-- The win rate leads, because nine equal numbers in a row is a table
         nobody reads. Everything else is a breakdown of this one. -->
    <div class="headline surface">
      <p class="rate">{winRate}<span class="pc">%</span></p>
      <div class="headline-detail">
        <p class="muted">{t.winRateOf(stats.won, stats.total)}</p>
        <!-- The share, drawn. A rate is easier to read against a bar than as a
             number on its own, and it is the one figure this page leads on. -->
        <span class="share" aria-hidden="true">
          <span class="share-fill" style:width={`${winRate}%`}></span>
        </span>
        <p class="muted">{t.timePlayed(formatElapsed(stats.totalMillis))}</p>
      </div>
    </div>

    <!--
      The rest of the headline, as figures rather than prose.

      Streaks are counted per game: a four-player win is one win in a run,
      however many heroes were at the table.
    -->
    <ul class="figures">
      <li>
        <span class="fig">{formatElapsed(stats.averageMillis)}</span>
        <span class="muted lbl">{t.statAverageGame}</span>
      </li>
      <li>
        <span class="fig">{formatElapsed(stats.longestMillis)}</span>
        <span class="muted lbl">{t.statLongestGame}</span>
      </li>
      <li>
        <span class="fig">{stats.currentStreak}</span>
        <span class="muted lbl">{t.statCurrentStreak}</span>
      </li>
      <li>
        <span class="fig">{stats.bestStreak}</span>
        <span class="muted lbl">{t.statBestStreak}</span>
      </li>
      <li>
        <span class="fig">{stats.campaignGames}</span>
        <span class="muted lbl">{t.statCampaignGames}</span>
      </li>
      <li>
        <span class="fig">{stats.solo} / {stats.group}</span>
        <span class="muted lbl">{t.statSoloGroup}</span>
      </li>
    </ul>

    <!--
      The games themselves, under the numbers they add up to.

      This page is where somebody notices a total that looks wrong, so it is
      where the row causing it should be reachable. Setting one aside keeps it
      and takes it out of the tables above; deleting it does not come back.
    -->
    <section class="table games-section">
      <h2>{t.statsGames} <span class="muted count-of">{store.plays.length}</span></h2>
      <p class="muted note">{t.statsGamesNote}</p>
      <ul class="games">
        {#each listed as play (play.id)}
          <PlayRow {t} {uiLocale} {play} />
        {/each}
      </ul>
      {#if remaining > 0}
        <button class="btn btn--quiet" type="button" onclick={() => (shown += PAGE)}>
          {t.statsShowMore(remaining)}
        </button>
      {/if}
    </section>

    <!--
      One filter and two controls for every table at once.

      Sorting and measuring are separate questions: a rate is a proportion of a
      row's own games, a share is a proportion of all of them together, and
      wanting to sort by one while looking at the other is perfectly ordinary.
    -->
    <div class="table-controls">
      <label class="grow">
        <span class="visually-hidden">{t.statsFilter}</span>
        <input
          class="field"
          type="search"
          placeholder={t.statsFilter}
          value={filter}
          oninput={(e) => (filter = e.currentTarget.value)}
        />
      </label>
      <label class="control">
        <span class="visually-hidden">{t.statsSort}</span>
        <select class="field" value={sort} onchange={(e) => (sort = e.currentTarget.value as typeof sort)}>
          <option value="played">{t.sortMostPlayed}</option>
          <option value="alpha">{t.sortAlphabetical}</option>
          <option value="best">{t.sortBestRate}</option>
          <option value="worst">{t.sortWorstRate}</option>
        </select>
      </label>
      <label class="control">
        <span class="visually-hidden">{t.statsMeasure}</span>
        <select
          class="field"
          value={measure}
          onchange={(e) => (measure = e.currentTarget.value as typeof measure)}
        >
          <option value="win">{t.measureWinRate}</option>
          <option value="loss">{t.measureLossRate}</option>
          <option value="share">{t.measureShare}</option>
        </select>
      </label>
    </div>

    {#each tables as [title, rows] (title)}
      {@const sorted = ordered(rows)}
      {@const open = expanded[title] === true}
      {@const shownRows = open ? sorted : sorted.slice(0, PREVIEW_ROWS)}
      {#if sorted.length > 0}
        <section class="table">
          <h2>{title} <span class="muted count-of">{sorted.length}</span></h2>
          <ul>
            {#each shownRows as row (row.key)}
              <li>
                <span class="label">{row.label}</span>
                <span class="bar" aria-hidden="true">
                  <span class="fill" style:width={`${bar(row, sorted)}%`}></span>
                </span>
                <span class="numbers muted">
                  {figure(row)} · {t.wonOf(row.won, row.played)}
                </span>
              </li>
            {/each}
          </ul>
          {#if sorted.length > PREVIEW_ROWS}
            <button
              class="btn btn--quiet"
              type="button"
              onclick={() => (expanded[title] = !open)}
            >
              {open ? t.statsShowFewer : t.statsShowMore(sorted.length - PREVIEW_ROWS)}
            </button>
          {/if}
        </section>
      {/if}
    {/each}

    <p class="muted note">{t.statsNote}</p>
  {/if}
</section>

<style>
  .share {
    display: block;
    height: 6px;
    border-radius: 999px;
    background: var(--surface-3, var(--surface-2));
    overflow: hidden;
    margin: var(--space-1) 0;
    max-width: 16rem;
  }

  .share-fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .figures {
    list-style: none;
    margin: var(--space-3) 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
    gap: var(--space-2);
  }

  .figures li {
    display: flex;
    flex-direction: column;
    padding: var(--space-3);
    background: var(--surface-1);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
  }

  .fig {
    font-size: var(--text-xl);
    font-weight: var(--weight-bold);
    font-variant-numeric: tabular-nums;
  }

  .lbl {
    font-size: var(--text-xs);
  }

  .table-controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-4) 0 var(--space-2);
  }

  .table-controls .grow {
    flex: 1 1 12rem;
  }

  .count-of {
    font-size: var(--text-sm);
    font-weight: var(--weight-regular, 400);
  }

  .games-section .note {
    font-size: var(--text-sm);
    margin: 0 0 var(--space-2);
  }

  .games {
    list-style: none;
    margin: 0 0 var(--space-3);
    padding: 0;
  }

  h1 {
    font-size: var(--text-2xl);
    margin: var(--space-5) 0 var(--space-3);
  }

  h2 {
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin: 0 0 var(--space-2);
  }

  .notice {
    padding: var(--space-4);
    margin: var(--space-3) 0;
    max-width: var(--prose-max);
  }

  .headline {
    display: flex;
    align-items: center;
    gap: var(--space-5);
    padding: var(--space-5);
    margin: var(--space-3) 0 var(--space-5);
  }

  .rate {
    font-size: var(--text-4xl);
    font-weight: 700;
    line-height: 1;
    margin: 0;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }

  .pc {
    font-size: var(--text-xl);
    margin-inline-start: var(--space-0-5);
  }

  .headline-detail p {
    margin: 0;
  }

  .table {
    margin-bottom: var(--space-5);
  }

  .table ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: var(--space-1);
  }

  .table li {
    display: grid;
    grid-template-columns: minmax(8rem, 14rem) 1fr minmax(7rem, auto);
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-1) 0;
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar {
    display: block;
    height: 0.7rem;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .numbers {
    font-size: var(--text-sm);
    text-align: end;
    font-variant-numeric: tabular-nums;
  }

  .note {
    font-size: var(--text-sm);
    max-width: var(--prose-max);
  }

  @media (max-width: 40rem) {
    .table li {
      grid-template-columns: 1fr auto;
    }

    .bar {
      grid-column: 1 / -1;
    }
  }
</style>
