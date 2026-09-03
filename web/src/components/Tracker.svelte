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
    schemeCompleteOn,
    schemeCopies,
    schemeLimit,
    schemeSideOf,
    schemeStageOf,
    setupFor,
    startOf,
    threatenedOn,
    threatOn,
    villainAdvanced,
    villainDefeated,
    villainHealth,
    villainSideOf,
    withManualSchemeLimit,
    withManualVillainHealth,
    withSchemeOption,
  } from '../lib/encounter';
  import type { EncounterSetup } from '../lib/encounter';
  import { session, setEncounter, updateEncounter } from '../lib/session.svelte';

  interface Props {
    t: Strings;
    cardLocale: Locale;
    index: readonly IndexRow[];
    /** Standard plays the first two villain stages, Expert the last two. */
    expert: boolean;
    /**
     * Numbers the campaign carries itself, believed before the card database.
     *
     * Fear No Evil's subordinates are the campaign's own invention and are on
     * no database, so for that campaign this is the only source there is. Null
     * everywhere else, and then the cards are read as they always were.
     */
    setup?: EncounterSetup | null;
  }

  const { t, cardLocale, index, expert, setup = null }: Props = $props();

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
  /*
   * A campaign that brought its own numbers needs nothing fetched.
   *
   * Set before the card path runs, and guarded on the encounter already being
   * there so it is built once per game rather than once per render.
   */
  $effect(() => {
    if (setup === null || session.current.encounter !== null) {
      return;
    }
    loading = false;
    failed = !isUsable(setup);
    setEncounter(isUsable(setup) ? startOf(setup) : null);
  });

  $effect(() => {
    const pack = packOf;
    if (setup !== null || scenarioCode === '' || pack === null || session.current.encounter !== null) {
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
        // Cleared **before** the encounter is set, not after. Setting it makes
        // this effect re-run, which cancels this pass; a `finally` after that
        // sees `cancelled` and leaves the panel reading "loading the scenario"
        // for the rest of the game.
        loading = false;
        failed = !isUsable(setup);
        setEncounter(isUsable(setup) ? startOf(setup) : null);
      })
      .catch(() => {
        if (!cancelled) {
          loading = false;
          failed = true;
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

  /** One entry per copy of the main scheme on the table. Usually just the one. */
  const copies = $derived(
    encounter === null ? [0] : Array.from({ length: schemeCopies(encounter) }, (_, i) => i),
  );

  const STEPS = [-5, -1, 1, 5] as const;
</script>

{#if loading}
  <p class="muted note">{t.trackerLoading}</p>
{:else if failed || encounter === null}
  <!-- Said rather than left blank: a panel that quietly does not appear reads
       as a bug, where "this scenario has no numbers to count" is an answer. -->
  <p class="muted note">{t.trackerUnavailable}</p>
{:else}
  <div class="tracker surface">
    <h2>{t.round(encounter.progress.round)}</h2>

    {#if villain !== null}
      <div class="counter">
        <p class="name">{villain.name} {villain.stage}</p>

        {#if health === null}
          <!-- Five cards print a star instead of a number, so the scenario
               decides it and nobody can look it up. -->
          <label class="starred">
            <span class="muted">{t.trackerStarred}</span>
            <input class="field"
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
          <!-- A bar as well as the numbers: across a table, at arm's length,
               the shape says how far along the game is faster than reading
               two figures does. -->
          <div class="bar villain" role="presentation">
            <span style={`width: ${Math.min(100, (encounter.progress.damage / Math.max(1, health)) * 100)}%`}
            ></span>
          </div>
          <p class="muted what">{t.damageOnVillain}</p>
          <div class="steps">
            {#each STEPS as step (step)}
              <button class="btn" type="button" onclick={() => updateEncounter((c) => damaged(c, step))}>
                {step > 0 ? `+${step}` : `−${-step}`}
              </button>
            {/each}
          </div>
        {/if}

        {#if !isFinalVillainStage(encounter) && villainDefeated(encounter)}
          <!--
            Offered once the stage is down, and not before: until then there is
            nothing to flip and a permanent button is one more thing to read
            past.

            Never automatic, though. Flipping a villain is something the table
            does, sometimes with a choice in it, and a counter that jumped
            ahead on its own would be describing a board that does not exist
            yet. The app offers the step; the table takes it.
          -->
          <button class="btn advance ready" type="button" onclick={() => updateEncounter(villainAdvanced)}>
            {t.advanceVillain}
          </button>
        {/if}
      </div>
    {/if}

    {#if scheme !== null && stage !== null}
      <div class="counter">
        <p class="name">{scheme.name}</p>

        {#if stage.options.length > 1}
          <!-- Mansion Attack draws a room out of four, Kang a realm out of
               four. Kang's realms share a threat limit but start on different
               threat, so this is not cosmetic. -->
          <label class="field-group">
            <span class="field-label">{t.whichScheme}</span>
            <select class="field"
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
            <input class="field"
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
          <!--
            Usually one, and then this reads exactly as it always did. A
            scenario that deals a main scheme to each player gets one counter
            each, named for whose it is, because they are separate jobs of
            thwarting that finish at different times.
          -->
          {#each copies as copy (copy)}
            {@const threat = threatOn(encounter, copy)}
            {#if copies.length > 1}
              <p class="whose">{t.schemeForPlayer(copy + 1)}</p>
            {/if}
            <p class="reading" class:done={schemeCompleteOn(encounter, copy)}>
              <span class="big">{threat}</span>
              <span class="muted">/ {limit}</span>
            </p>
            <div class="bar scheme" role="presentation">
              <span style={`width: ${Math.min(100, (threat / Math.max(1, limit)) * 100)}%`}></span>
            </div>
            <p class="muted what">{t.threatOnScheme}</p>
            <div class="steps">
              {#each STEPS as step (step)}
                <button
                  class="btn"
                  type="button"
                  onclick={() => updateEncounter((c) => threatenedOn(c, copy, step))}
                >
                  {step > 0 ? `+${step}` : `−${-step}`}
                </button>
              {/each}
            </div>
          {/each}
        {/if}

        {#if !isFinalSchemeStage(encounter) && schemeComplete(encounter)}
          <button class="btn advance ready" type="button" onclick={() => updateEncounter(schemeAdvanced)}>
            {t.advanceScheme}
          </button>
        {/if}
      </div>
    {/if}

    <button class="btn btn--primary end-round" type="button" onclick={() => updateEncounter(roundEnded)}>
      {t.endRound}
    </button>

    <p class="muted note">{t.trackerNote}</p>
  </div>
{/if}

<style>
  .tracker {
    padding: var(--space-4);
    margin: var(--space-4) 0;
  }

  h2 {
    font-size: var(--text-lg);
  }

  .name {
    font-weight: 700;
    margin-bottom: var(--space-1);
  }

  .what {
    font-size: var(--text-sm);
    margin: var(--space-1) 0 var(--space-2);
  }

  /* Whose scheme this counter is, when there is one each. */
  .whose {
    margin-top: var(--space-3);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
  }

  .bar {
    height: 10px;
    border-radius: 999px;
    background: var(--surface-2);
    overflow: hidden;
  }

  .bar span {
    display: block;
    height: 100%;
    transition: width 120ms ease-out;
  }

  .bar.villain span {
    background: var(--danger);
  }

  .bar.scheme span {
    background: var(--accent);
  }

  .end-round {
    width: 100%;
    margin-top: var(--space-4);
    padding-block: var(--space-3);
    font-weight: 700;
    background: var(--accent);
    color: var(--accent-ink);
    border-color: var(--accent);
  }

  .counter {
    margin-top: var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--hairline);
  }

  .reading {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin: var(--space-2) 0;
  }

  .big {
    font-size: var(--text-2xl);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  /* The counter having reached the number is the thing somebody glances for
     across a table, so it changes colour rather than only reading 17/17. */
  .reading.done .big {
    color: var(--accent);
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

  .advance {
    margin-top: var(--space-2);
  }

  .advance.ready {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }

  .field-group,
  .starred {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    margin: var(--space-2) 0;
    max-width: 20rem;
  }

  .note {
    font-size: var(--text-sm);
    max-width: var(--prose-max);
    margin-top: var(--space-3);
  }

  @media (max-width: 30rem) {
    .steps {
      grid-template-columns: repeat(4, 1fr);
    }
  }
</style>
