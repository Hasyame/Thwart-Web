<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { IndexRow, Locale } from '../lib/types';
  import { loadPackCards } from '../lib/data';
  import {
    damaged,
    isFinalSchemeStage,
    isFinalVillainStage,
    isUsable,
    roundEnded,
    schemeAdvanced,
    schemeComplete,
    schemeLimit,
    schemeSideOf,
    schemeStageOf,
    setupFor,
    startOf,
    threatened,
    villainAdvanced,
    villainDefeated,
    villainHealth,
    villainSideOf,
    withManualSchemeLimit,
    withManualVillainHealth,
    withSchemeOption,
  } from '../lib/encounter';
  import { session, setEncounter, updateEncounter } from '../lib/session.svelte';

  interface Props {
    t: Strings;
    cardLocale: Locale;
    index: readonly IndexRow[];
    /** Standard plays the first two villain stages, Expert the last two. */
    expert: boolean;
  }

  const { t, cardLocale, index, expert }: Props = $props();

  const players = $derived(Math.max(1, session.current.seats.length));
  const scenarioCode = $derived(session.current.scenarioCode);

  /**
   * The pack a scenario lives in, from the search index.
   *
   * The card files are one per pack, so the tracker needs to know which one to
   * ask for before it can read a single number.
   */
  const packOf = $derived.by(() => {
    for (const row of index) {
      if (row.setCode === scenarioCode) {
        return row.packCode;
      }
    }
    return null;
  });

  let loading = $state(false);
  let failed = $state(false);

  /*
   * Built once per game, not per render.
   *
   * The setup depends on the scenario, the player count and the difficulty,
   * none of which change while a game runs; rebuilding it would throw away the
   * damage on the table. The guard is the encounter already being there.
   */
  $effect(() => {
    const pack = packOf;
    if (scenarioCode === '' || pack === null || session.current.encounter !== null) {
      return;
    }
    let cancelled = false;
    loading = true;
    failed = false;
    loadPackCards(cardLocale, pack)
      .then((cards) => {
        if (cancelled) {
          return;
        }
        const setup = setupFor(
          cards.filter((card) => card.card_set_code === scenarioCode),
          players,
          expert,
        );
        setEncounter(isUsable(setup) ? startOf(setup) : null);
        failed = !isUsable(setup);
      })
      .catch(() => {
        if (!cancelled) {
          failed = true;
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

  const encounter = $derived(session.current.encounter);
  const villain = $derived(encounter === null ? null : villainSideOf(encounter));
  const scheme = $derived(encounter === null ? null : schemeSideOf(encounter));
  const stage = $derived(encounter === null ? null : schemeStageOf(encounter));
  const health = $derived(encounter === null ? null : villainHealth(encounter));
  const limit = $derived(encounter === null ? null : schemeLimit(encounter));

  const STEPS = [1, 2, 3, 5] as const;
</script>

{#if loading}
  <p class="muted note">{t.trackerLoading}</p>
{:else if failed || encounter === null}
  <!-- Said rather than left blank: a panel that quietly does not appear reads
       as a bug, where "this scenario has no numbers to count" is an answer. -->
  <p class="muted note">{t.trackerUnavailable}</p>
{:else}
  <div class="tracker surface">
    <div class="head">
      <h2>{t.tracker}</h2>
      <div class="round">
        <span class="muted">{t.round(encounter.progress.round)}</span>
        <!-- The one piece of arithmetic worth automating: acceleration is per
             player, happens every round, and forgetting it is the commonest
             way a game ends up somewhere it should not be. -->
        <button type="button" onclick={() => updateEncounter(roundEnded)}>
          {t.endRound}
        </button>
      </div>
    </div>

    {#if villain !== null}
      <div class="counter">
        <div class="label">
          <strong>{villain.name}</strong>
          <span class="muted">{villain.stage}</span>
        </div>

        {#if health === null}
          <!-- Five cards print a star instead of a number, so the scenario
               decides it and nobody can look it up. -->
          <label class="starred">
            <span class="muted">{t.trackerStarred}</span>
            <input
              type="number"
              min="1"
              onchange={(e) => {
                const value = Number.parseInt(e.currentTarget.value, 10);
                updateEncounter((current) =>
                  withManualVillainHealth(current, Number.isFinite(value) ? value : null),
                );
              }}
            />
          </label>
        {:else}
          <p class="reading" class:done={villainDefeated(encounter)}>
            <span class="big">{encounter.progress.damage}</span>
            <span class="muted">/ {health}</span>
          </p>
          <div class="steps">
            {#each STEPS as step (step)}
              <button type="button" onclick={() => updateEncounter((c) => damaged(c, -step))}>
                −{step}
              </button>
            {/each}
            {#each STEPS as step (step)}
              <button type="button" onclick={() => updateEncounter((c) => damaged(c, step))}>
                +{step}
              </button>
            {/each}
          </div>
        {/if}

        {#if !isFinalVillainStage(encounter)}
          <!-- Never automatic on reaching the health: flipping a villain is
               something the table does, sometimes with a choice, and a counter
               that jumped ahead would describe a board that does not exist. -->
          <button
            class="advance"
            class:ready={villainDefeated(encounter)}
            type="button"
            onclick={() => updateEncounter(villainAdvanced)}
          >
            {t.advanceVillain}
          </button>
        {/if}
      </div>
    {/if}

    {#if scheme !== null && stage !== null}
      <div class="counter">
        <div class="label">
          <strong>{scheme.name}</strong>
          <span class="muted">{scheme.stage}</span>
        </div>

        {#if stage.options.length > 1}
          <!-- Mansion Attack draws a room out of four, Kang a realm out of
               four. Kang's realms share a threat limit but start on different
               threat, so this is not cosmetic. -->
          <label class="field">
            <span class="muted">{t.whichScheme}</span>
            <select
              value={encounter.progress.schemeOption}
              onchange={(e) => {
                const option = Number.parseInt(e.currentTarget.value, 10);
                updateEncounter((current) => withSchemeOption(current, option));
              }}
            >
              {#each stage.options as option, i (option.name)}
                <option value={i}>{option.name}</option>
              {/each}
            </select>
          </label>
        {/if}

        {#if limit === null}
          <label class="starred">
            <span class="muted">{t.trackerStarred}</span>
            <input
              type="number"
              min="1"
              onchange={(e) => {
                const value = Number.parseInt(e.currentTarget.value, 10);
                updateEncounter((current) =>
                  withManualSchemeLimit(current, Number.isFinite(value) ? value : null),
                );
              }}
            />
          </label>
        {:else}
          <p class="reading" class:done={schemeComplete(encounter)}>
            <span class="big">{encounter.progress.threat}</span>
            <span class="muted">/ {limit}</span>
          </p>
          <div class="steps">
            {#each STEPS as step (step)}
              <button type="button" onclick={() => updateEncounter((c) => threatened(c, -step))}>
                −{step}
              </button>
            {/each}
            {#each STEPS as step (step)}
              <button type="button" onclick={() => updateEncounter((c) => threatened(c, step))}>
                +{step}
              </button>
            {/each}
          </div>
        {/if}

        {#if !isFinalSchemeStage(encounter)}
          <button
            class="advance"
            class:ready={schemeComplete(encounter)}
            type="button"
            onclick={() => updateEncounter(schemeAdvanced)}
          >
            {t.advanceScheme}
          </button>
        {/if}
      </div>
    {/if}

    <p class="muted note">{t.trackerNote}</p>
  </div>
{/if}

<style>
  .tracker {
    padding: var(--space-4);
    margin: var(--space-4) 0;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }

  h2 {
    font-size: 1.05rem;
  }

  .round {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .counter {
    margin-top: var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--md-outline-variant);
  }

  .label {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
  }

  .reading {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin: var(--space-2) 0;
  }

  .big {
    font-size: 2rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  /* The counter having reached the number is the thing somebody glances for
     across a table, so it changes colour rather than only reading 17/17. */
  .reading.done .big {
    color: var(--md-primary);
  }

  .steps {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-1);
    max-width: 26rem;
  }

  .steps button {
    padding: var(--space-2);
    font-variant-numeric: tabular-nums;
  }

  button {
    border-radius: var(--radius-lg);
    border: 1px solid var(--md-outline);
    background: transparent;
    color: inherit;
    padding: var(--space-1) var(--space-3);
    cursor: pointer;
  }

  button:hover {
    background: var(--md-surface-container-high);
  }

  .advance {
    margin-top: var(--space-2);
  }

  .advance.ready {
    border-color: var(--md-primary);
    color: var(--md-primary);
    font-weight: 600;
  }

  .field,
  .starred {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: var(--space-2) 0;
    max-width: 20rem;
  }

  select,
  input {
    background: var(--md-surface);
    color: var(--md-on-surface);
    border: 1px solid var(--md-outline);
    border-radius: var(--radius-sm);
    padding: var(--space-2);
  }

  .note {
    font-size: 0.85rem;
    max-width: var(--prose-max);
    margin-top: var(--space-3);
  }

  @media (max-width: 30rem) {
    .steps {
      grid-template-columns: repeat(4, 1fr);
    }
  }
</style>
