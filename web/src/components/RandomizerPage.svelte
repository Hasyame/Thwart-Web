<script lang="ts">
  import { liveQuery } from 'dexie';
  import type { CardSet, IndexRow } from '../lib/types';
  import type { Strings } from '../lib/i18n';
  import { db } from '../lib/db';
  import { loadScenarioRules } from '../lib/data';
  import {
    buildPools,
    EMPTY_DRAW,
    roll,
    type Draw,
    type DrawField,
    type Pools,
    type ScenarioRulesFile,
  } from '../lib/randomizer';

  interface Props {
    t: Strings;
    sets: readonly CardSet[];
    index: readonly IndexRow[];
    storageOk: boolean;
  }

  const { t, sets, index, storageOk }: Props = $props();

  const collection = $state<{
    owned: Set<string>;
    excludedSets: Set<string>;
    excludedScenarios: Set<string>;
    ready: boolean;
  }>({
    owned: new Set(),
    excludedSets: new Set(),
    excludedScenarios: new Set(),
    ready: false,
  });

  /**
   * Follows the collection rather than reading it once.
   *
   * The app had a bug in exactly this shape: `RandomizerViewModel` loaded its
   * pools in `init`, so changing the collection and coming back left the old
   * pools in place and the draw offered packs the player did not own. Since
   * liveQuery re-runs on any write, that failure mode does not exist here.
   */
  $effect(() => {
    if (!storageOk) {
      collection.ready = true;
      return;
    }
    const subs = [
      liveQuery(() => db.ownedPacks.toArray()).subscribe((rows) => {
        collection.owned = new Set(rows.map((r) => r.packCode));
        collection.ready = true;
      }),
      liveQuery(() => db.excludedModularSets.toArray()).subscribe((rows) => {
        collection.excludedSets = new Set(rows.map((r) => r.setCode));
      }),
      liveQuery(() => db.excludedScenarios.toArray()).subscribe((rows) => {
        collection.excludedScenarios = new Set(rows.map((r) => r.scenarioCode));
      }),
    ];
    return () => subs.forEach((s) => s.unsubscribe());
  });

  let rules = $state<ScenarioRulesFile | null>(null);
  $effect(() => {
    let cancelled = false;
    loadScenarioRules().then((loaded) => {
      if (!cancelled) {
        rules = loaded;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  let playerCount = $state(1);
  let draw = $state.raw<Draw>(EMPTY_DRAW);
  let locked = $state.raw<ReadonlySet<DrawField>>(new Set());
  let saved = $state(false);

  const pools = $derived.by((): Pools | null => {
    if (rules === null) {
      return null;
    }
    return buildPools({
      rules,
      sets,
      index,
      ownedPackCodes: collection.owned,
      excludedModularSets: collection.excludedSets,
      excludedScenarios: collection.excludedScenarios,
    });
  });

  /** Names come from the card database, already in the reader's language. */
  const setNames = $derived(new Map(sets.map((s) => [s.code, s.name] as const)));

  const canRoll = $derived(
    pools !== null && pools.scenarios.length > 0 && pools.heroes.length >= playerCount,
  );

  function doRoll(): void {
    if (pools === null) {
      return;
    }
    draw = roll({ pools, previous: draw, locked, playerCount });
    saved = false;
  }

  function toggleLock(field: DrawField): void {
    const next = new Set(locked);
    if (next.has(field)) {
      next.delete(field);
    } else {
      next.add(field);
    }
    locked = next;
  }

  async function save(): Promise<void> {
    if (draw.scenarioCode === null || !storageOk) {
      return;
    }
    // Written in the app's RandomizerHistoryEntity shape, down to the
    // comma-separated code lists, so this row means the same thing in both.
    await db.randomizerHistory.put({
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      scenarioCode: draw.scenarioCode,
      difficulty: draw.difficulty ?? '',
      playerCount: draw.playerCount,
      heroes: draw.heroes.map((h) => `${h.code}:${h.aspect}`).join(','),
      modularSetCodes: [...draw.mandatoryModularCodes, ...draw.modularSetCodes].join(','),
      beaten: false,
    });
    saved = true;
  }

  const difficultyLabel = $derived((): string => {
    if (draw.difficulty === null) {
      return '—';
    }
    const main = t.difficulty(draw.difficulty);
    return draw.standardSet === null
      ? main
      : `${main} + ${t.difficulty(draw.standardSet)}`;
  });
</script>

<section>
  <h1>{t.randomizerTitle}</h1>

  {#if !collection.ready || pools === null}
    <p class="notice muted">{t.loading}</p>
  {:else if collection.owned.size === 0}
    <div class="notice surface">
      <p>{t.randomizerNoCollection}</p>
    </div>
  {:else}
    <div class="controls surface">
      <label class="players">
        <span class="muted">{t.players}</span>
        <select
          value={playerCount}
          onchange={(e) => (playerCount = Number.parseInt(e.currentTarget.value, 10))}
        >
          {#each [1, 2, 3, 4] as n (n)}
            <option value={n}>{n}</option>
          {/each}
        </select>
      </label>

      <button class="roll" type="button" onclick={doRoll} disabled={!canRoll}>
        {draw.scenarioCode === null ? t.roll : t.reroll}
      </button>

      <p class="muted pool-note">
        {t.poolNote(pools.scenarios.length, pools.heroes.length, pools.modularSets.length)}
      </p>
    </div>

    {#if !canRoll}
      <div class="notice surface">
        <p>{t.randomizerNotEnough(playerCount)}</p>
      </div>
    {/if}

    {#if draw.scenarioCode !== null}
      <div class="draw">
        <div class="field surface">
          <div class="field-head">
            <h2>{t.scenario}</h2>
            <button
              type="button"
              class="lock"
              class:on={locked.has('scenario')}
              aria-pressed={locked.has('scenario')}
              onclick={() => toggleLock('scenario')}
            >
              {locked.has('scenario') ? '🔒' : '🔓'}
              <span class="visually-hidden">{t.lockField}</span>
            </button>
          </div>
          <p class="value">{setNames.get(draw.scenarioCode) ?? draw.scenarioCode}</p>
        </div>

        <div class="field surface">
          <div class="field-head">
            <h2>{t.difficultyLabel}</h2>
            <button
              type="button"
              class="lock"
              class:on={locked.has('difficulty')}
              aria-pressed={locked.has('difficulty')}
              onclick={() => toggleLock('difficulty')}
            >
              {locked.has('difficulty') ? '🔒' : '🔓'}
              <span class="visually-hidden">{t.lockField}</span>
            </button>
          </div>
          <p class="value">{difficultyLabel()}</p>
        </div>

        <div class="field surface wide">
          <div class="field-head">
            <h2>{t.heroes}</h2>
            <button
              type="button"
              class="lock"
              class:on={locked.has('heroes')}
              aria-pressed={locked.has('heroes')}
              onclick={() => toggleLock('heroes')}
            >
              {locked.has('heroes') ? '🔒' : '🔓'}
              <span class="visually-hidden">{t.lockField}</span>
            </button>
          </div>
          <ul class="chips">
            {#each draw.heroes as hero (hero.code)}
              <li class="chip" data-faction={hero.aspect}>
                <strong>{hero.name}</strong>
                <span>{t.aspect(hero.aspect)}</span>
              </li>
            {/each}
          </ul>
        </div>

        <div class="field surface wide">
          <div class="field-head">
            <h2>{t.modularSets}</h2>
            <button
              type="button"
              class="lock"
              class:on={locked.has('modularSets')}
              aria-pressed={locked.has('modularSets')}
              onclick={() => toggleLock('modularSets')}
            >
              {locked.has('modularSets') ? '🔒' : '🔓'}
              <span class="visually-hidden">{t.lockField}</span>
            </button>
          </div>

          {#if draw.mandatoryModularCodes.length === 0 && draw.modularSetCodes.length === 0}
            <p class="value muted">{t.noModularSets}</p>
          {:else}
            <ul class="chips">
              {#each draw.mandatoryModularCodes as code (code)}
                <!-- Marked because it was not drawn: the scenario requires it,
                     and rerolling will never replace it. -->
                <li class="chip required">
                  {setNames.get(code) ?? code}
                  <span class="muted">{t.required}</span>
                </li>
              {/each}
              {#each draw.modularSetCodes as code (code)}
                <li class="chip">{setNames.get(code) ?? code}</li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>

      {#if storageOk}
        <div class="actions">
          <button type="button" onclick={save} disabled={saved}>
            {saved ? t.savedToHistory : t.saveToHistory}
          </button>
        </div>
      {/if}
    {/if}
  {/if}
</section>

<style>
  h1 {
    font-size: 1.6rem;
    margin: var(--space-5) 0 var(--space-4);
  }

  h2 {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--md-on-surface-variant);
    margin: 0;
  }

  .notice {
    padding: var(--space-4);
    margin: var(--space-4) 0;
    max-width: var(--prose-max);
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4);
  }

  .players {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  select {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    border: 1px solid var(--md-outline);
    background: var(--md-surface);
    color: var(--md-on-surface);
  }

  .roll {
    padding: var(--space-3) var(--space-6);
    border-radius: var(--radius-lg);
    border: 0;
    background: var(--md-primary);
    color: var(--md-on-primary);
    font-size: 1.05rem;
    font-weight: 700;
    cursor: pointer;
  }

  .roll:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .pool-note {
    font-size: 0.85rem;
    margin: 0;
  }

  .draw {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    gap: var(--space-3);
    margin-top: var(--space-4);
  }

  .field {
    padding: var(--space-4);
  }

  .field.wide {
    grid-column: 1 / -1;
  }

  .field-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-2);
  }

  .lock {
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
    padding: var(--space-1) var(--space-2);
    opacity: 0.55;
  }

  .lock.on {
    opacity: 1;
    border-color: var(--md-primary);
  }

  .value {
    margin: 0;
    font-size: 1.2rem;
    font-weight: 600;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .chip {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--md-surface-container-high);
    border-inline-start: 4px solid var(--md-outline-variant);
    font-size: 0.95rem;
  }

  .chip.required {
    border-inline-start-color: var(--md-primary);
  }

  .chip[data-faction='aggression'] {
    border-inline-start-color: var(--faction-aggression);
  }
  .chip[data-faction='justice'] {
    border-inline-start-color: var(--faction-justice);
  }
  .chip[data-faction='leadership'] {
    border-inline-start-color: var(--faction-leadership);
  }
  .chip[data-faction='protection'] {
    border-inline-start-color: var(--faction-protection);
  }
  .chip[data-faction='pool'] {
    border-inline-start-color: var(--faction-pool);
  }

  .actions {
    margin-top: var(--space-4);
  }

  .actions button {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-lg);
    border: 1px solid var(--md-outline);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .actions button:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
