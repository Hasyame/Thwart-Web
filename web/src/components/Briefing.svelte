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

<!--
  Two cards, as the app has them: what is on the table, then what the scenario
  says to do with it. The order of the rows is the app's too, because somebody
  reading it on a phone in one hand and holding cards in the other should find
  the same line in the same place.
-->
<div class="briefing surface">
  <h2>{t.briefingTitle}</h2>

  <dl class="gather">
    <dt>{t.scenario}</dt>
    <dd>{session.current.scenarioName}</dd>

    {#if briefing !== null && briefing.schemeName !== null}
      <dt>{t.mainSchemeDeck}</dt>
      <dd>{briefing.schemeName}</dd>
    {/if}

    <dt>{t.difficultyLabel}</dt>
    <dd>{difficultySets.map((id) => t.difficulty(id)).join(' + ')}</dd>

    <!-- The modular sets are what the encounter deck is made of, which is what
         the table is actually being asked to fetch. -->
    <dt>{t.encounterDeck}</dt>
    <dd>
      {#if session.current.modularSetCodes.length === 0}
        {t.noModularSets}
      {:else}
        {session.current.modularSetCodes.map((code) => setNames.get(code) ?? code).join(', ')}
      {/if}
    </dd>

    <dt>{t.heroes}</dt>
    <dd>
      {session.current.seats
        .map((seat) => (seat.aspect === '' ? seat.heroName : `${seat.heroName} · ${t.aspect(seat.aspect)}`))
        .join(', ')}
    </dd>
  </dl>
</div>

{#if loading}
  <p class="muted note">{t.trackerLoading}</p>
{:else if briefing !== null && briefing.steps.length > 0}
  <div class="briefing surface">
    <h2>{t.schemeSetupTitle}</h2>
    <ul class="steps">
      {#each briefing.steps as step, i (i)}
        <li>{step}</li>
      {/each}
    </ul>
  </div>
{:else if briefing !== null}
  <div class="briefing surface">
    <h2>{t.schemeSetupTitle}</h2>
    <!-- Ebony Maw and Thanos put theirs in the rules insert, and the older
         campaign scenarios leave it to the book. Saying so beats an empty list
         that reads as a bug. -->
    <p class="muted note">{t.briefingNoSetup}</p>
  </div>
{/if}

<style>
  .briefing {
    padding: var(--space-4);
    margin: var(--space-4) 0;
  }

  h2 {
    font-size: 1.05rem;
    margin-bottom: var(--space-1);
  }

  .gather {
    display: grid;
    gap: var(--space-1);
    margin-top: var(--space-3);
  }

  dt {
    font-weight: 700;
    font-size: 0.95rem;
  }

  dd {
    margin: 0 0 var(--space-3);
  }

  dd:last-child {
    margin-bottom: 0;
  }

  /* Bulleted, not numbered. The steps on a main scheme are a list of things to
     do, not an order to do them in, and numbering them would claim otherwise. */
  .steps {
    list-style: none;
    display: grid;
    gap: var(--space-3);
    max-width: var(--prose-max);
    margin-top: var(--space-3);
  }

  .steps li {
    padding-inline-start: var(--space-4);
    position: relative;
  }

  .steps li::before {
    content: "•";
    position: absolute;
    inset-inline-start: 0;
  }

  .note {
    font-size: 0.85rem;
    max-width: var(--prose-max);
  }

</style>
