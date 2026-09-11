<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { RatingSummary } from '../lib/ratingsApi';
  import { SCORES } from '../lib/ratings';

  interface Props {
    t: Strings;
    /** What is being rated, as the person knows it: a set name, a campaign. */
    label: string;
    /** The player's own current score, or null when they have not rated it. */
    own: number | null;
    /** The community's, when the server had one to serve. */
    summary?: RatingSummary;
    onRate: (score: number | null) => void;
    /** Under the label, when there is something to say — "with Rhino". */
    sub?: string;
  }

  const { t, label, own, summary, onRate, sub }: Props = $props();

  const total = $derived(summary?.histogram?.reduce((a, b) => a + b, 0) ?? 0);
</script>

<!--
  One subject, six choices, nothing preselected.

  A radio group and not six buttons, so a screen reader hears one question
  with six answers and which is chosen. Optional by construction: there is no
  state in which this row has to be answered, and clearing is one more
  control beside the six rather than a dialog.
-->
<div class="row">
  <div class="what">
    <span class="label">{label}</span>
    {#if sub}<span class="muted sub">{sub}</span>{/if}
  </div>

  <div class="choices" role="radiogroup" aria-label={`${t.ratingTitle} ${label}`}>
    {#each SCORES as score (score)}
      <button
        type="button"
        role="radio"
        aria-checked={own === score}
        class="choice"
        class:chosen={own === score}
        onclick={() => onRate(own === score ? null : score)}
      >
        <span class="num">{score}</span>
        <span class="word">{t.difficultyWord(score)}</span>
      </button>
    {/each}
  </div>

  <div class="under">
    {#if own !== null}
      <span class="yours">{t.ratingYours}: {own} · {t.difficultyWord(own)}</span>
      <button type="button" class="btn btn--quiet small" onclick={() => onRate(null)}>{t.ratingClear}</button>
    {/if}
    {#if summary !== undefined && summary.mean !== undefined && summary.histogram !== undefined}
      <!--
        The distribution beside the mean, because difficulty opinions are
        bimodal more often than not and a 2.5 that is half 1s and half 4s
        is not a 2.5. Five bars, scaled to the tallest, drawn in text.
      -->
      <span class="community" title={summary.histogram.join(' / ')}>
        {t.ratingCommunity(summary.mean, summary.count)}
        <span class="bars" aria-hidden="true">
          {#each summary.histogram as n, score (score)}
            <span class="bar" style:height={`${total === 0 ? 0 : Math.max(2, (n / Math.max(...summary.histogram)) * 100)}%`}></span>
          {/each}
        </span>
      </span>
    {:else if summary !== undefined && summary.count > 0}
      <span class="muted community">{t.ratingCountOnly(summary.count)}</span>
    {/if}
  </div>
</div>

<style>
  .row {
    display: grid;
    gap: var(--space-2);
    padding-block: var(--space-3);
    border-top: 1px solid var(--hairline);
  }

  .what {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
  }

  .label {
    font-weight: var(--weight-semibold);
  }

  .sub {
    font-size: var(--text-sm);
  }

  /* Six equal cells on one line where the words fit whole, and two even rows
     of three on a phone rather than six cells breaking "Impossible" in half.
     26rem is where six French words stop fitting; measured at 375px. */
  .choices {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-1);
  }

  @media (min-width: 26rem) {
    .choices {
      grid-template-columns: repeat(6, minmax(0, 1fr));
    }
  }

  .choice {
    display: grid;
    place-items: center;
    gap: 2px;
    min-height: var(--tap-min);
    padding: var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    cursor: pointer;
  }

  .choice:hover {
    border-color: var(--accent);
  }

  .choice.chosen {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
  }

  .num {
    font-weight: var(--weight-bold);
    font-variant-numeric: tabular-nums;
  }

  .word {
    font-size: var(--text-xs, 0.75rem);
    line-height: 1.1;
    text-align: center;
  }

  .under {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    min-height: 1.5rem;
    font-size: var(--text-sm);
  }

  .yours {
    color: var(--accent);
    font-weight: var(--weight-semibold);
  }

  .community {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin-inline-start: auto;
    font-variant-numeric: tabular-nums;
  }

  .bars {
    display: inline-flex;
    align-items: flex-end;
    gap: 1px;
    width: 2.25rem;
    height: 0.9rem;
  }

  .bar {
    flex: 1;
    background: var(--accent);
    opacity: 0.8;
    border-radius: 1px;
  }
</style>
