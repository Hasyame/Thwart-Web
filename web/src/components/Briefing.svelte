<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { IndexRow, Locale } from '../lib/types';
  import { loadPackCards } from '../lib/data';
  import { briefingFor, type SchemeBriefing } from '../lib/schemeSetup';
  import { session } from '../lib/session.svelte';

  interface Props {
    t: Strings;
    cardLocale: Locale;
    index: readonly IndexRow[];
    /** Modular set and difficulty set names, already localised. */
    setNames: ReadonlyMap<string, string>;
  }

  const { t, cardLocale, index, setNames }: Props = $props();

  const scenarioCode = $derived(session.current.scenarioCode);

  const packOf = $derived.by(() => {
    for (const row of index) {
      if (row.setCode === scenarioCode) {
        return row.packCode;
      }
    }
    return null;
  });

  let briefing = $state.raw<SchemeBriefing | null>(null);
  let loading = $state(false);

  /*
   * Read from the cards, not from a file in this repository.
   *
   * The setup a scenario prints is Fantasy Flight's text. Fetching it with the
   * rest of the card data means it arrives in the player's own language and no
   * copy of it is ever committed here.
   */
  $effect(() => {
    const pack = packOf;
    if (pack === null) {
      briefing = null;
      return;
    }
    let cancelled = false;
    loading = true;
    loadPackCards(cardLocale, pack)
      .then((cards) => {
        if (!cancelled) {
          briefing = briefingFor(cards.filter((card) => card.card_set_code === scenarioCode));
        }
      })
      .catch(() => {
        if (!cancelled) {
          briefing = null;
        }
      })
      .finally(() => {
        if (!cancelled) {
          loading = false;
        }
      });
    return () => {
      cancelled = true;
    };
  });

  const difficultySets = $derived(
    session.current.standardSet === null
      ? [session.current.difficulty]
      : [session.current.difficulty, session.current.standardSet],
  );
</script>

<div class="briefing surface">
  <h2>{t.briefingTitle}</h2>
  <p class="muted note">{t.briefingIntro}</p>

  <h3>{t.briefingGather}</h3>
  <ul class="gather">
    <li>
      <span class="muted">{t.scenario}</span>
      <strong>{session.current.scenarioName}</strong>
    </li>
    <li>
      <span class="muted">{t.difficultyLabel}</span>
      <strong>{difficultySets.map((id) => t.difficulty(id)).join(' + ')}</strong>
    </li>
    <li>
      <span class="muted">{t.modularSets}</span>
      <strong>
        {#if session.current.modularSetCodes.length === 0}
          {t.noModularSets}
        {:else}
          {session.current.modularSetCodes.map((code) => setNames.get(code) ?? code).join(', ')}
        {/if}
      </strong>
    </li>
    <li>
      <span class="muted">{t.seats}</span>
      <strong>
        {session.current.seats.map((seat) => `${seat.heroName} (${seat.deckName})`).join(', ')}
      </strong>
    </li>
  </ul>

  {#if loading}
    <p class="muted note">{t.trackerLoading}</p>
  {:else if briefing !== null && briefing.schemeName !== null}
    <h3>{briefing.schemeName}</h3>
    {#if briefing.steps.length > 0}
      <ol class="steps">
        {#each briefing.steps as step, i (i)}
          <li>{step}</li>
        {/each}
      </ol>
    {:else}
      <!-- Ebony Maw and Thanos put theirs in the rules insert, and the older
           campaign scenarios leave it to the book. Saying so beats an empty
           list that reads as a bug. -->
      <p class="muted note">{t.briefingNoSetup}</p>
    {/if}
  {/if}
</div>

<style>
  .briefing {
    padding: var(--space-4);
    margin: var(--space-4) 0;
  }

  h2 {
    font-size: 1.05rem;
    margin-bottom: var(--space-1);
  }

  h3 {
    font-size: 0.95rem;
    margin-top: var(--space-4);
    margin-bottom: var(--space-2);
  }

  .gather {
    list-style: none;
    display: grid;
    gap: var(--space-2);
  }

  .gather li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
  }

  .gather .muted {
    flex: 0 0 9rem;
    font-size: 0.85rem;
  }

  .steps {
    padding-inline-start: var(--space-5);
    display: grid;
    gap: var(--space-2);
    max-width: var(--prose-max);
  }

  .note {
    font-size: 0.85rem;
    max-width: var(--prose-max);
  }

  @media (max-width: 34rem) {
    .gather .muted {
      flex-basis: 100%;
    }
  }
</style>
