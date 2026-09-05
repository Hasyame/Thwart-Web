<script lang="ts">
  import { liveQuery } from 'dexie';
  import type { CardSet, Pack } from '../lib/types';
  import type { Strings } from '../lib/i18n';
  import {
    db,
    setModularSetExcluded as writeModularSetExcluded,
    setPackQuantity as writePackQuantity,
    setScenarioExcluded as writeScenarioExcluded,
  } from '../lib/db';
  import BackupPanel from './BackupPanel.svelte';
  import { syncAfter } from '../lib/sync/auto.svelte';

  /*
   * Every write on this screen, with a sync asked for after it.
   *
   * Wrapped here rather than inside the database helpers, because those are
   * also what a backup import and the sync engine itself write through, and a
   * sync that triggered on the rows a sync had just written would chase its own
   * tail.
   *
   * Ticking a box is not an event worth a request of its own — somebody
   * cataloguing a shelf ticks thirty in a row — so `syncAfter` waits for the
   * flurry to stop and sends once.
   */
  async function setPackQuantity(packCode: string, quantity: number): Promise<void> {
    await writePackQuantity(packCode, quantity);
    syncAfter('collection-changed');
  }

  async function setModularSetExcluded(setCode: string, excluded: boolean): Promise<void> {
    await writeModularSetExcluded(setCode, excluded);
    syncAfter('collection-changed');
  }

  async function setScenarioExcluded(scenarioCode: string, excluded: boolean): Promise<void> {
    await writeScenarioExcluded(scenarioCode, excluded);
    syncAfter('collection-changed');
  }

  interface Props {
    t: Strings;
    packs: readonly Pack[];
    sets: readonly CardSet[];
    storageOk: boolean;
  }

  const { t, packs, sets, storageOk }: Props = $props();

  /**
   * Dexie's liveQuery re-runs whenever the underlying tables change, so the
   * screen follows the database rather than the database being pushed into the
   * screen. That also means an import updates every tick box without anything
   * having to remember to tell it.
   */
  const owned = $state<{ value: Map<string, number> }>({ value: new Map() });
  const excludedSets = $state<{ value: Set<string> }>({ value: new Set() });
  const excludedScenarios = $state<{ value: Set<string> }>({ value: new Set() });

  $effect(() => {
    if (!storageOk) {
      return;
    }
    const subscriptions = [
      liveQuery(() => db.ownedPacks.toArray()).subscribe((rows) => {
        owned.value = new Map(rows.map((row) => [row.packCode, row.quantity]));
      }),
      liveQuery(() => db.excludedModularSets.toArray()).subscribe((rows) => {
        excludedSets.value = new Set(rows.map((row) => row.setCode));
      }),
      liveQuery(() => db.excludedScenarios.toArray()).subscribe((rows) => {
        excludedScenarios.value = new Set(rows.map((row) => row.scenarioCode));
      }),
    ];
    return () => subscriptions.forEach((s) => s.unsubscribe());
  });

  let expanded = $state<string | null>(null);

  const sortedPacks = $derived([...packs].sort((a, b) => a.position - b.position));

  interface WaveGroup {
    readonly wave: number;
    readonly packs: readonly Pack[];
  }

  /**
   * Packs grouped by release wave, which is how the app's collection screen
   * arranges them — `CollectionViewModel` groups by `pack.wave` and sorts each
   * group by `pack.position`. Same grouping, same order, so somebody who knows
   * one screen can read the other.
   *
   * Wave 0 means the curated metadata does not mention the pack. It sorts last
   * and is labelled for what it is rather than as "Wave 0", which would be a
   * number nobody could act on.
   */
  const waves = $derived.by((): readonly WaveGroup[] => {
    const byWave = new Map<number, Pack[]>();
    for (const pack of sortedPacks) {
      const bucket = byWave.get(pack.wave);
      if (bucket === undefined) {
        byWave.set(pack.wave, [pack]);
      } else {
        bucket.push(pack);
      }
    }
    return [...byWave.entries()]
      .map(([wave, group]) => ({ wave, packs: group }))
      .sort((a, b) => {
        if (a.wave === 0) {
          return 1;
        }
        if (b.wave === 0) {
          return -1;
        }
        return a.wave - b.wave;
      });
  });

  function ownedInWave(group: WaveGroup): number {
    return group.packs.filter((pack) => (owned.value.get(pack.code) ?? 0) > 0).length;
  }

  const setsByPack = $derived(
    sets.reduce<Map<string, CardSet[]>>((map, set) => {
      const bucket = map.get(set.packCode);
      if (bucket === undefined) {
        map.set(set.packCode, [set]);
      } else {
        bucket.push(set);
      }
      return map;
    }, new Map()),
  );

  /*
   * The bulk buttons, in the order the collection is entered.
   *
   * Everything first, then by type for somebody who owns the heroes and not the
   * scenarios. `null` is every pack; the rest match the curated pack type,
   * which MarvelCDB does not carry and the metadata file supplies.
   */
  const BULK_GROUPS = [
    { id: 'all', type: null, label: (s: Strings) => s.bulkAll },
    { id: 'core', type: 'CORE', label: (s: Strings) => s.bulkCore },
    { id: 'hero', type: 'HERO_PACK', label: (s: Strings) => s.bulkHeroes },
    { id: 'scenario', type: 'SCENARIO_PACK', label: (s: Strings) => s.bulkScenarios },
    { id: 'campaign', type: 'CAMPAIGN_BOX', label: (s: Strings) => s.bulkCampaigns },
  ] as const;

  let busy = $state(false);
  let clearing = $state(false);

  const packsOfType = (type: string | null): readonly Pack[] =>
    type === null ? sortedPacks : sortedPacks.filter((pack) => pack.type === type);

  /**
   * Marks a group as owned, one copy each.
   *
   * Packs already recorded are left exactly as they are: somebody who owns two
   * core sets and then presses "everything" should not be told they own one.
   */
  async function ownAll(packs: readonly Pack[]): Promise<void> {
    busy = true;
    try {
      for (const pack of packs) {
        if ((owned.value.get(pack.code) ?? 0) === 0) {
          await setPackQuantity(pack.code, 1);
        }
      }
    } finally {
      busy = false;
    }
  }

  async function clearAll(): Promise<void> {
    busy = true;
    try {
      for (const code of [...owned.value.keys()]) {
        await setPackQuantity(code, 0);
      }
    } finally {
      busy = false;
      clearing = false;
    }
  }

  function contentsOf(packCode: string, type: string): CardSet[] {
    return (setsByPack.get(packCode) ?? [])
      .filter((set) => set.type === type)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const ownedCount = $derived(owned.value.size);
</script>

<section>
  <h1>{t.collectionTitle}</h1>

  {#if !storageOk}
    <div class="notice surface">
      <p>{t.storageUnavailable}</p>
    </div>
  {:else}
    <p class="muted intro">{t.collectionIntro}</p>
    <p class="muted">{t.collectionOwned(ownedCount, sortedPacks.length)}</p>

    <!--
      Entering a real collection is a hundred taps otherwise.

      Each button says how many packs it would affect, because "select all core"
      means nothing until you know whether that is one box or six. Clearing asks
      first: it is the only one of these that throws away something somebody
      typed, including the quantities.
    -->
    <div class="bulk">
      <span class="bulk-label muted">{t.bulkLabel}</span>
      {#each BULK_GROUPS as group (group.id)}
        {@const packs = packsOfType(group.type)}
        {#if packs.length > 0}
          <button
            class="btn btn--quiet"
            type="button"
            disabled={busy || packs.every((pack) => (owned.value.get(pack.code) ?? 0) > 0)}
            onclick={() => void ownAll(packs)}
          >
            {group.label(t)}
            <span class="muted">{packs.length}</span>
          </button>
        {/if}
      {/each}

      {#if clearing}
        <span class="confirm">
          <span class="muted">{t.bulkClearConfirm(ownedCount)}</span>
          <button class="btn btn--quiet danger" type="button" disabled={busy} onclick={() => void clearAll()}>
            {t.bulkClearYes}
          </button>
          <button class="btn btn--quiet" type="button" disabled={busy} onclick={() => (clearing = false)}>
            {t.cancel}
          </button>
        </span>
      {:else if ownedCount > 0}
        <button class="btn btn--quiet danger" type="button" onclick={() => (clearing = true)}>
          {t.bulkClear}
        </button>
      {/if}
    </div>

    <BackupPanel {t} />

    {#each waves as group (group.wave)}
      <section class="wave">
        <h2 class="wave-heading">
          {group.wave === 0 ? t.waveUnknown : t.wave(group.wave)}
          <span class="wave-count muted">
            {ownedInWave(group)}/{group.packs.length}
          </span>
        </h2>

        <ul class="packs">
          {#each group.packs as pack (pack.code)}
            {@const quantity = owned.value.get(pack.code) ?? 0}
            {@const modular = contentsOf(pack.code, 'modular')}
            {@const villains = contentsOf(pack.code, 'villain')}
            {@const hasContents = modular.length > 0 || villains.length > 0}
            <li class="pack surface" class:owned={quantity > 0}>
              <div class="pack-row">
                <label class="tick">
                  <input
                    type="checkbox"
                    checked={quantity > 0}
                    onchange={(event) =>
                      setPackQuantity(pack.code, event.currentTarget.checked ? 1 : 0)}
                  />
                  <span class="pack-name">{pack.name}</span>
                </label>

                <div class="pack-actions">
                  {#if quantity > 0}
                    <label class="quantity">
                      <span class="visually-hidden">{t.copiesOwned}</span>
                      <input class="field"
                        type="number"
                        min="1"
                        max="9"
                        value={quantity}
                        onchange={(event) =>
                          setPackQuantity(
                            pack.code,
                            Number.parseInt(event.currentTarget.value, 10) || 1,
                          )}
                      />
                    </label>
                  {/if}

                  {#if quantity > 0 && hasContents}
                    <button
                      type="button"
                      class="expand"
                      aria-expanded={expanded === pack.code}
                      onclick={() =>
                        (expanded = expanded === pack.code ? null : pack.code)}
                    >
                      {expanded === pack.code ? t.hideContents : t.showContents}
                    </button>
                  {/if}
                </div>
              </div>

              {#if quantity > 0 && expanded === pack.code}
                <div class="contents">
                  <p class="muted contents-hint">{t.contentsHint}</p>

                  {#if villains.length > 0}
                    <h2>{t.scenarios}</h2>
                    <ul class="sets">
                      {#each villains as set (set.code)}
                        <li>
                          <label class="tick">
                            <input
                              type="checkbox"
                              checked={!excludedScenarios.value.has(set.code)}
                              onchange={(event) =>
                                setScenarioExcluded(
                                  set.code,
                                  !event.currentTarget.checked,
                                )}
                            />
                            <span>{set.name}</span>
                          </label>
                        </li>
                    {/each}
                  </ul>
                {/if}

                {#if modular.length > 0}
                  <h2>{t.modularSets}</h2>
                  <ul class="sets">
                    {#each modular as set (set.code)}
                      <li>
                        <label class="tick">
                          <input
                            type="checkbox"
                            checked={!excludedSets.value.has(set.code)}
                            onchange={(event) =>
                              setModularSetExcluded(
                                set.code,
                                !event.currentTarget.checked,
                              )}
                          />
                          <span>{set.name}</span>
                        </label>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            {/if}
          </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
</section>

<style>
  .bulk {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-3) 0;
  }

  .bulk-label {
    font-size: var(--text-sm);
  }

  .bulk .confirm {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  .danger {
    color: var(--danger);
  }

  h1 {
    font-size: var(--text-2xl);
    margin: var(--space-5) 0 var(--space-2);
  }

  .wave {
    margin-top: var(--space-5);
  }

  .wave-heading {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    font-size: var(--text-lg);
    text-transform: none;
    letter-spacing: 0;
    color: var(--text);
    border-bottom: 2px solid var(--hairline);
    padding-bottom: var(--space-2);
    margin: 0;
  }

  .wave-count {
    font-size: var(--text-sm);
    font-weight: 400;
  }

  h2 {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin: var(--space-4) 0 var(--space-2);
  }

  .intro {
    max-width: var(--prose-max);
  }

  .notice {
    padding: var(--space-4);
    margin: var(--space-4) 0;
  }

  .packs,
  .sets {
    list-style: none;
    padding: 0;
    margin: var(--space-3) 0 0;
    display: grid;
    gap: var(--space-2);
  }

  /* Two columns of packs once there is room; the contents panel that expands
     underneath one of them spans both, so it is not squeezed. */
  .packs {
    grid-template-columns: repeat(auto-fill, minmax(min(30rem, 100%), 1fr));
  }

  .sets {
    grid-template-columns: repeat(auto-fill, minmax(min(15rem, 100%), 1fr));
    margin-top: 0;
  }

  .pack {
    padding: var(--space-3);
  }

  .pack.owned {
    border-color: var(--accent);
  }

  .pack-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  /* The only thing the shared row does not know: these sit in a grid whose
     columns must be allowed to shrink, or a long pack name widens the track. */
  .tick {
    min-width: 0;
  }

  .pack-name {
    font-weight: 600;
  }

  .pack-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 0 0 auto;
  }

  .quantity input {
    width: 3.2rem;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface-1);
    color: var(--text);
  }

  .expand {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: var(--text-sm);
  }

  .expand:hover {
    background: var(--surface-2);
  }

  .contents {
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--hairline);
  }

  .contents-hint {
    font-size: var(--text-sm);
    margin: 0;
    max-width: var(--prose-max);
  }
</style>
