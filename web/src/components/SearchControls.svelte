<script lang="ts">
  import ResponsiveFilters from './ResponsiveFilters.svelte';
  import type { IndexRow, Pack } from '../lib/types';
  import type { Strings } from '../lib/i18n';
  import { activeFilterCount, NO_FILTERS, type Filters } from '../lib/search';

  interface Props {
    t: Strings;
    query: string;
    filters: Filters;
    index: readonly IndexRow[];
    packs: readonly Pack[];
    onQuery: (query: string) => void;
    onFilters: (filters: Filters) => void;
  }

  const { t, query, filters, index, packs, onQuery, onFilters }: Props = $props();

  interface Option {
    readonly code: string;
    readonly name: string;
  }

  /**
   * Filter options come from the index rather than a fixed list.
   *
   * A new card type or faction appearing in a future pack then shows up on its
   * own, instead of being invisible until somebody remembers to add it here.
   */
  function distinct(
    rows: readonly IndexRow[],
    code: (row: IndexRow) => string,
    name: (row: IndexRow) => string,
  ): Option[] {
    const seen = new Map<string, string>();
    for (const row of rows) {
      const key = code(row);
      if (!seen.has(key)) {
        seen.set(key, name(row));
      }
    }
    return [...seen.entries()]
      .map(([c, n]) => ({ code: c, name: n }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const types = $derived(
    distinct(
      index,
      (row) => row.typeCode,
      (row) => row.typeName,
    ),
  );

  const factions = $derived(
    distinct(
      index,
      (row) => row.factionCode,
      (row) => row.factionName,
    ),
  );

  /*
   * Every trait in the index, which is a long list and a useful one.
   *
   * Built from the data rather than a fixed list, like the types and factions
   * above: a trait introduced by a future pack appears on its own. An index
   * built before traits were carried yields nothing, and the control hides
   * itself rather than offering an empty menu.
   */
  const traits = $derived.by(() => {
    const seen = new Set<string>();
    for (const row of index) {
      for (const trait of row.traits ?? []) {
        seen.add(trait);
      }
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  });

  const active = $derived(activeFilterCount(filters));

  function cost(value: string): number | null {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  const packOptions = $derived(
    [...packs]
      .sort((a, b) => a.position - b.position)
      .map((pack) => ({ code: pack.code, name: pack.name })),
  );

  function pick(value: string): string | null {
    return value === '' ? null : value;
  }
</script>

<div class="controls">
  <label class="search">
    <span class="visually-hidden">{t.searchLabel}</span>
    <input class="field"
      type="search"
      value={query}
      placeholder={t.searchPlaceholder}
      autocomplete="off"
      autocapitalize="none"
      spellcheck="false"
      oninput={(event) => onQuery(event.currentTarget.value)}
    />
  </label>

  <ResponsiveFilters label={t.filters} count={active}>
    <div class="filters">
      <select class="field"
        aria-label={t.allTypes}
        value={filters.typeCode ?? ''}
        onchange={(event) =>
          onFilters({ ...filters, typeCode: pick(event.currentTarget.value) })}
      >
        <option value="">{t.allTypes}</option>
        {#each types as option (option.code)}
          <option value={option.code}>{option.name}</option>
        {/each}
      </select>

      <select class="field"
        aria-label={t.allFactions}
        value={filters.factionCode ?? ''}
        onchange={(event) =>
          onFilters({ ...filters, factionCode: pick(event.currentTarget.value) })}
      >
        <option value="">{t.allFactions}</option>
        {#each factions as option (option.code)}
          <option value={option.code}>{option.name}</option>
        {/each}
      </select>

      <select class="field"
        aria-label={t.allPacks}
        value={filters.packCode ?? ''}
        onchange={(event) =>
          onFilters({ ...filters, packCode: pick(event.currentTarget.value) })}
      >
        <option value="">{t.allPacks}</option>
        {#each packOptions as option (option.code)}
          <option value={option.code}>{option.name}</option>
        {/each}
      </select>

      {#if traits.length > 0}
        <select
          class="field"
          aria-label={t.allTraits}
          value={filters.trait ?? ''}
          onchange={(event) => onFilters({ ...filters, trait: pick(event.currentTarget.value) })}
        >
          <option value="">{t.allTraits}</option>
          {#each traits as trait (trait)}
            <option value={trait}>{trait}</option>
          {/each}
        </select>
      {/if}
    </div>

    <div class="filters second">
      <!--
        Cost as two numbers rather than a slider. A slider needs a maximum
        nobody agrees on and cannot be typed into; two boxes say exactly what
        they are and work with a keyboard.
      -->
      <label class="cost">
        <span class="lbl">{t.costFrom}</span>
        <input
          class="field"
          type="number"
          min="0"
          inputmode="numeric"
          value={filters.minCost ?? ''}
          onchange={(event) => onFilters({ ...filters, minCost: cost(event.currentTarget.value) })}
        />
      </label>
      <label class="cost">
        <span class="lbl">{t.costTo}</span>
        <input
          class="field"
          type="number"
          min="0"
          inputmode="numeric"
          value={filters.maxCost ?? ''}
          onchange={(event) => onFilters({ ...filters, maxCost: cost(event.currentTarget.value) })}
        />
      </label>

      <label class="tick">
        <input
          type="checkbox"
          checked={filters.ownedOnly}
          onchange={(event) => onFilters({ ...filters, ownedOnly: event.currentTarget.checked })}
        />
        <span>{t.ownedOnly}</span>
      </label>

      <label class="tick">
        <input
          type="checkbox"
          checked={filters.favouritesOnly}
          onchange={(event) =>
            onFilters({ ...filters, favouritesOnly: event.currentTarget.checked })}
        />
        <span>{t.favouritesOnly}</span>
      </label>

      <!--
        Shown only when something is on, because a permanent Clear button reads
        as a thing you have to press before you can search.
      -->
      {#if active > 0}
        <button class="btn btn--quiet" type="button" onclick={() => onFilters(NO_FILTERS)}>
          {t.clearFilters(active)}
        </button>
      {/if}
    </div>
  </ResponsiveFilters>
</div>

<style>
  .second {
    align-items: center;
  }

  .cost {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .cost .lbl {
    font-size: var(--text-sm);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .cost .field {
    width: 5.5rem;
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: var(--space-5) 0 var(--space-4);
  }

  .search input {
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: var(--surface-1);
    color: var(--text);
    font-size: var(--text-lg);
  }

  .search input:focus-visible {
    border-color: var(--accent);
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  select {
    flex: 1 1 12rem;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface-1);
    color: var(--text);
  }
</style>
