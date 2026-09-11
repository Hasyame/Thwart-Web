<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { RatingSummary } from '../lib/ratingsApi';

  interface Props {
    t: Strings;
    /** The community's, when the server had one to serve. */
    summary?: RatingSummary;
    /** The player's own, shown regardless of the threshold. */
    own?: number | null;
  }

  const { t, summary, own = null }: Props = $props();

  const shown = $derived(summary !== undefined && summary.mean !== undefined);
  /* Below the threshold the server sends the count and withholds the mean.
     Say the count: a badge that stays blank until five people have rated
     reads as broken, and "2 ratings so far" is both true and an invitation. */
  const countOnly = $derived(summary !== undefined && summary.mean === undefined && summary.count > 0);
  const tallest = $derived(Math.max(1, ...(summary?.histogram ?? [1])));
</script>

<!--
  The average beside a decision, not beside the question.

  Shown where somebody is choosing — a drawn scenario, a set in the picker, a
  campaign to start — and never on the rating row itself, where it would
  anchor the answer. No mean below the threshold — a mean from two opinions
  is not a mean — but the count, so it is clear that rating is a thing.
-->
{#if shown || countOnly || own !== null}
  <span class="badge" title={summary?.histogram?.join(' / ')}>
    {#if own !== null}
      <span class="own" aria-label={t.ratingYours}>★ {own}</span>
    {/if}
    {#if shown && summary?.mean !== undefined}
      <span class="mean">{t.ratingCommunity(summary.mean, summary.count)}</span>
      <span class="bars" aria-hidden="true">
        {#each summary.histogram ?? [] as n, i (i)}
          <span class="bar" style:height={`${Math.max(2, (n / tallest) * 100)}%`}></span>
        {/each}
      </span>
    {:else if countOnly && summary !== undefined}
      <span class="count">{t.ratingCountOnly(summary.count)}</span>
    {/if}
  </span>
{/if}

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .own {
    color: var(--accent);
    font-weight: var(--weight-semibold);
  }

  .bars {
    display: inline-flex;
    align-items: flex-end;
    gap: 1px;
    width: 2rem;
    height: 0.8rem;
  }

  .bar {
    flex: 1;
    background: var(--accent);
    opacity: 0.75;
    border-radius: 1px;
  }
</style>
