<script lang="ts">
  import { liveQuery } from 'dexie';
  import type { Play } from '../lib/records';
  import type { Strings } from '../lib/i18n';
  import { db } from '../lib/db';
  import { computeStatistics, type Tally } from '../lib/plays';
  import { formatElapsed } from '../lib/session.svelte';

  interface Props {
    t: Strings;
    storageOk: boolean;
  }

  const { t, storageOk }: Props = $props();

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
    }),
  );

  const winRate = $derived(
    stats.total === 0 ? 0 : Math.round((stats.won / stats.total) * 100),
  );

  function percent(entry: Tally): number {
    return entry.played === 0 ? 0 : Math.round((entry.won / entry.played) * 100);
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
        <p class="muted">{t.timePlayed(formatElapsed(stats.totalMillis))}</p>
      </div>
    </div>

    {#each tables as [title, rows] (title)}
      <section class="table">
        <h2>{title}</h2>
        <ul>
          {#each rows as row (row.key)}
            <li>
              <span class="label">{row.label}</span>
              <span class="bar" aria-hidden="true">
                <span class="fill" style:width={`${percent(row)}%`}></span>
              </span>
              <span class="numbers muted">
                {percent(row)}% · {t.wonOf(row.won, row.played)}
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/each}

    <p class="muted note">{t.statsNote}</p>
  {/if}
</section>

<style>
  h1 {
    font-size: 1.6rem;
    margin: var(--space-5) 0 var(--space-3);
  }

  h2 {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--md-on-surface-variant);
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
    font-size: 3.4rem;
    font-weight: 700;
    line-height: 1;
    margin: 0;
    color: var(--md-primary);
    font-variant-numeric: tabular-nums;
  }

  .pc {
    font-size: 1.4rem;
    margin-inline-start: 2px;
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
    background: var(--md-surface-container-high);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--md-primary);
  }

  .numbers {
    font-size: 0.85rem;
    text-align: end;
    font-variant-numeric: tabular-nums;
  }

  .note {
    font-size: 0.85rem;
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
