<script lang="ts">
  import { liveQuery } from 'dexie';
  import type { Play } from '../lib/records';
  import type { IndexRow } from '../lib/types';
  import type { Strings } from '../lib/i18n';
  import { all as allPlays } from '../lib/playQuery';
  import { pathForRoute } from '../lib/router';
  import { computeStatistics, type Tally } from '../lib/plays';
  import { formatElapsed } from '../lib/session.svelte';
  import { normalizeForSearch } from '../lib/normalize.js';

  interface Props {
    t: Strings;
    /** The app's base path, for the link to the history. */
    base: string;
    index: readonly IndexRow[];
    storageOk: boolean;
  }

  const { t, index, storageOk, base }: Props = $props();

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

  const store = $state<{ plays: readonly Play[]; loaded: boolean }>({ plays: [], loaded: false });

  /*
   * Read through the shared query layer, not the table.
   *
   * The history page reads the same function, which is the point: the rule that
   * a deleted play is not a played game lives in one place, so the two screens
   * cannot come to disagree about which games exist. Reading the table directly
   * here counted the tombstones — the figures were right, because
   * computeStatistics filters again, but the count beside the link to the
   * history was not.
   *
   * Wrapped in a liveQuery so the page follows a write: recording a game on
   * another tab, or a sync arriving, updates this without a reload.
   */
  $effect(() => {
    if (!storageOk) {
      store.loaded = true;
      return;
    }
    const sub = liveQuery(() => allPlays()).subscribe(
      (rows) => {
        store.plays = rows;
        store.loaded = true;
      },
      () => {
        store.plays = [];
        store.loaded = true;
      },
    );
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

  /** What the measure control is currently showing, for the column header. */
  const measureLabel = $derived(
    measure === 'win' ? t.measureWinRate : measure === 'loss' ? t.measureLossRate : t.measureShare,
  );

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
  /** Where the individual games are, now that this screen is only aggregates. */
  const historyHref = $derived(pathForRoute({ name: 'history' }, base));
  const achievementsHref = $derived(pathForRoute({ name: 'achievements' }, base));
</script>

<section>
  <h1>{t.statsTitle}</h1>

  {#if !storageOk}
    <div class="notice surface"><p>{t.storageUnavailable}</p></div>
  {:else if !store.loaded}
    <!--
      Loading, said rather than implied.

      Without this branch a real history shows the "no games yet" panel for as
      long as the read takes, on every single visit — telling somebody with
      four hundred games that they have none. `aria-live` so a screen reader
      hears the page settle rather than being left on a stale announcement.
    -->
    <div class="notice surface" aria-live="polite">
      <p class="muted">{t.loadingGames}</p>
    </div>
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
    <dl class="figures">
      <div>
        <dt class="muted lbl">{t.statAverageGame}</dt>
        <dd class="fig">{formatElapsed(stats.averageMillis)}</dd>
      </div>
      <div>
        <dt class="muted lbl">{t.statLongestGame}</dt>
        <dd class="fig">{formatElapsed(stats.longestMillis)}</dd>
      </div>
      <div>
        <dt class="muted lbl">{t.statCurrentStreak}</dt>
        <dd class="fig">{stats.currentStreak}</dd>
      </div>
      <div>
        <dt class="muted lbl">{t.statBestStreak}</dt>
        <dd class="fig">{stats.bestStreak}</dd>
      </div>
      <div>
        <dt class="muted lbl">{t.statCampaignGames}</dt>
        <dd class="fig">{stats.campaignGames}</dd>
      </div>
      <div>
        <dt class="muted lbl">{t.statSoloGroup}</dt>
        <dd class="fig">{stats.solo} / {stats.group}</dd>
      </div>
    </dl>

    <!--
      The games themselves, under the numbers they add up to.

      This page is where somebody notices a total that looks wrong, so it is
      where the row causing it should be reachable. Setting one aside keeps it
      and takes it out of the tables above; deleting it does not come back.
    -->
    <!--
      The games themselves live on the history page now.

      This screen is aggregates; that one is the record, with filters, a detail
      view and the campaigns. Keeping a second list here would be two things to
      keep in step for no gain.
    -->
    <p class="muted note">
      <a href={historyHref}>{t.statsSeeHistory(stats.total)}</a>
      · <a href={achievementsHref}>{t.achievements.statsLink}</a>
    </p>

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

    <!--
      Two columns where there is room for two, rather than one long one.

      A single column capped for readability left half a wide screen empty,
      and the answer to that is not a wider table: a row whose name is at one
      end and its bar a thousand pixels away at the other is harder to read,
      not easier. Putting two tables side by side spends the width on more
      information at once and keeps every row short.
    -->
    <div class="tables">
      {#each tables as [title, rows] (title)}
      {@const sorted = ordered(rows)}
      {@const open = expanded[title] === true}
      {@const shownRows = open ? sorted : sorted.slice(0, PREVIEW_ROWS)}
      {#if sorted.length > 0}
        <section class="table">
          <h2 id={`h-${title}`}>{title} <span class="muted count-of">{sorted.length}</span></h2>
          <!--
            A real table, not a styled list.

            The bars are decoration and are hidden from assistive technology;
            everything they depict is in the cell beside them as text, and the
            column headers are what say which number is which. A screen reader
            reads "Spider-Man, 67%, 8 of 12" rather than three unrelated spans.
          -->
          <table aria-labelledby={`h-${title}`}>
            <caption class="visually-hidden">{title}</caption>
            <!--
              The columns, declared rather than inferred.

              `table-layout: fixed` takes its widths from the first row, and
              this table's first row is a `thead` that is visually hidden by
              being taken out of flow — so there is no first row to measure and
              the browser falls back to equal thirds, ignoring any width set on
              the cells. A `colgroup` is read directly by the fixed algorithm
              and does not care that the header is hidden.
            -->
            <colgroup>
              <col class="col-name" />
              <col />
              <col class="col-record" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">{title}</th>
                <th scope="col">{measureLabel}</th>
                <th scope="col">{t.statsRecord}</th>
              </tr>
            </thead>
            <tbody>
              {#each shownRows as row (row.key)}
                <tr>
                  <th scope="row" class="label" title={row.label}>{row.label}</th>
                  <td class="measure">
                    <!--
                      The flex row is this div and not the cell itself.

                      A `td` set to `display: flex` stops being a table cell:
                      the browser wraps it in an anonymous one, column sizing
                      stops being predictable, and the label column ended up
                      589px wide in one table and 778px in another — which is
                      why the bars did not line up between sections.
                    -->
                    <div class="measure-row">
                      <span class="bar" aria-hidden="true">
                        <span class="fill" style:width={`${bar(row, sorted)}%`}></span>
                      </span>
                      <span class="numbers">{figure(row)}</span>
                    </div>
                  </td>
                  <td class="numbers muted record">{t.wonOf(row.won, row.played)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
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
    </div>

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

  /*
   * The label is before the number in the markup, because that is what a
   * definition list means and it is what a screen reader announces; the number
   * reads first on screen because that is what an eye wants.
   */
  .figures > div {
    display: flex;
    flex-direction: column-reverse;
    justify-content: end;
    padding: var(--space-3);
    background: var(--surface-1);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
  }

  .figures dd {
    margin: 0;
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

  /*
   * The columns the sections sit in.
   *
   * A table fills whatever column it is given, and there is no width at which
   * the page leaves a band of nothing down one side. Below the breakpoint that
   * means one column using the full measure; above it, two.
   *
   * 78rem, worked out rather than picked: the name column is a fixed 18rem and
   * the record column 5rem, so a bar of about 200px — the least that is worth
   * drawing — needs a column near 600px. Two of those, plus the gap between
   * them and the page's own padding, is 1248px. Switching any earlier buys a
   * second column by making both of them too thin to read.
   *
   * `start`-aligned so a short table does not stretch to match a long one
   * beside it.
   */
  .tables {
    display: grid;
    gap: 0 var(--space-5);
    align-items: start;
  }

  @media (min-width: 78rem) {
    .tables {
      grid-template-columns: 1fr 1fr;
    }
  }

  .table {
    margin-bottom: var(--space-5);
  }

  /*
   * Fixed layout, so every section's columns are the same width.
   *
   * With `auto` the label column is sized by its own longest name, so "Par
   * héros" and "Par héros et aspect" each picked a different width and the
   * bars started at a different place in every section. Nothing lined up down
   * the page, and there was no way to compare two sections by eye.
   *
   * Fixed takes the widths below and applies them everywhere, so the bars all
   * begin on the same line whatever the names happen to be.
   */
  .table table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
  }

  /* The header row carries the meaning for a screen reader and is redundant
     to anyone reading the bars, so it is present and not shown. */
  .table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .table th,
  .table td {
    padding: var(--space-1) var(--space-2) var(--space-1) 0;
    text-align: start;
    font-weight: inherit;
    vertical-align: middle;
  }

  /*
   * The name column.
   *
   * This said `width: minmax(8rem, 14rem)`, which is not a width: `minmax()`
   * is a grid function and the declaration was dropped, leaving only a
   * `max-width` that a table cell in auto layout treats as a hint and ignored.
   * The column then took whatever it liked, differently in every section.
   *
   * **18rem because that is what the names measure.** Every hero, every main
   * scheme and every hero-and-aspect pairing in both card databases, rendered
   * at this cell's own font: 553 French labels and 540 English ones. The
   * widest is "La Sorcière Rouge · Commandement" at 258px, and French is what
   * decides it — the widest English label is 214px. With the cell's padding
   * that needs 274px, so 15rem clipped sixteen labels, 17rem clipped one, and
   * 18rem clips none.
   *
   * The ellipsis and the `title` stay for a name from some future pack that
   * outgrows this.
   */
  .table .col-name {
    width: 18rem;
  }

  /* Just enough for "10/12", and fixed so the bars all end on the same line
     too. */
  .table .col-record {
    width: 5rem;
  }

  /*
   * Banding, so a bar belongs to the name on its line.
   *
   * The other half of the same complaint: even lined up, a row is a name at
   * one end and a bar at the other with a gap between, and nothing said the
   * two were the same row. One surface step is enough — the ladder is
   * deliberately shallow, and a stronger stripe would read as a table of
   * boxes rather than as rows.
   */
  .table tbody tr:nth-child(even) th,
  .table tbody tr:nth-child(even) td {
    background: var(--surface-1);
  }

  .table tbody tr:hover th,
  .table tbody tr:hover td {
    background: var(--surface-2);
  }

  /* The banding needs the row to start somewhere, and the first cell had no
     leading padding at all. */
  .table th[scope='row'] {
    padding-inline-start: var(--space-2);
    border-start-start-radius: var(--radius-xs);
    border-end-start-radius: var(--radius-xs);
  }

  .table .record {
    padding-inline-end: var(--space-2);
    border-start-end-radius: var(--radius-xs);
    border-end-end-radius: var(--radius-xs);
  }

  .measure-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .measure-row .bar {
    flex: 1 1 auto;
    min-width: 3rem;
  }

  /* Enough room for "100%", so the bars are not one character shorter on the
     rows that reach it. */
  .measure-row .numbers {
    flex: none;
    min-width: 2.5rem;
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
    /* The bar is the first thing to go when there is no room: the numbers
       beside it say everything it does. */
    .measure-row .bar {
      display: none;
    }

    /* And the name gives up its fixed column, because at this width the
       alignment it buys is worth less than the room.

       62% rather than 55%: with the bar gone the rest of the row only has to
       hold "100%" and "12/18", and the room that frees is better spent on
       names that would otherwise be cut. */
    .table .col-name {
      width: 62%;
    }
  }
</style>
