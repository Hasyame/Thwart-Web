<script lang="ts">
  import { liveQuery } from 'dexie';
  import type { Strings } from '../lib/i18n';
  import type { Rating } from '../lib/records';
  import { db } from '../lib/db';
  import { rate, unrate, type RatingSubject } from '../lib/ratings';
  import { forgetSummaries, summariesFor, type RatingSummary } from '../lib/ratingsApi';
  import RatingRow from './RatingRow.svelte';

  interface Props {
    t: Strings;
    title: string;
    /** What can be rated here, in the order to show it. */
    subjects: readonly RatingSubject[];
    /** The name to show for a subject: a set's, a campaign's. */
    labelOf: (subject: RatingSubject) => string;
    /** A line under the name, when there is one worth saying. */
    subOf?: (subject: RatingSubject) => string | undefined;
    /** Builds the record to store for a score. The caller knows the evidence. */
    build: (subject: RatingSubject, score: number) => Rating;
    /** False when storage is unavailable, so nothing can be kept. */
    storageOk: boolean;
  }

  const { t, title, subjects, labelOf, subOf, build, storageOk }: Props = $props();

  const keys = $derived(subjects.map((s) => s.key));

  /* The player's own ratings, live: a rating given on the phone appears here
     when the sync brings it, and one given here appears in every other row
     that shows the subject. */
  let own = $state.raw<ReadonlyMap<string, Rating>>(new Map());
  $effect(() => {
    if (!storageOk || keys.length === 0) {
      own = new Map();
      return;
    }
    const wanted = keys;
    const sub = liveQuery(() => db.ratings.bulkGet(wanted)).subscribe((rows) => {
      own = new Map(rows.flatMap((row, i) => (row === undefined ? [] : [[wanted[i] as string, row] as const])));
    });
    return () => sub.unsubscribe();
  });

  /* The community's, fetched once per set of subjects and again after the
     player rates — their own rating changes the average they are looking at. */
  let summaries = $state.raw<ReadonlyMap<string, RatingSummary>>(new Map());
  let refreshToken = $state(0);
  $effect(() => {
    void refreshToken;
    const wanted = keys;
    if (wanted.length === 0) {
      return;
    }
    let cancelled = false;
    void summariesFor(wanted).then((found) => {
      if (!cancelled) {
        summaries = found;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  async function onRate(subject: RatingSubject, score: number | null): Promise<void> {
    if (score === null) {
      await unrate(subject.key);
    } else {
      await rate(build(subject, score));
    }
    // The average this person is looking at has just moved by their own vote;
    // asking again is one cached request and the honest number.
    forgetSummaries([subject.key]);
    refreshToken += 1;
  }
</script>

{#if subjects.length > 0}
  <section class="ratings surface">
    <h2>{title}</h2>
    <p class="muted note">{t.ratingOptional}</p>
    {#each subjects as subject (subject.key)}
      <RatingRow
        {t}
        label={labelOf(subject)}
        sub={subOf?.(subject)}
        own={own.get(subject.key)?.score ?? null}
        summary={summaries.get(subject.key)}
        onRate={(score) => void onRate(subject, score)}
      />
    {/each}
  </section>
{/if}

<style>
  .ratings {
    padding: var(--space-4);
    margin-top: var(--space-4);
  }

  h2 {
    margin: 0 0 var(--space-1);
    font-size: var(--text-lg);
  }

  .note {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
  }
</style>
