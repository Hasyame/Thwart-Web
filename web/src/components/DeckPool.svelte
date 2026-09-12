<script lang="ts">
  import { untrack } from 'svelte';
  import type { IndexRow } from '../lib/types';
  import type { Strings } from '../lib/i18n';
  import { COST_CAP, factionOrder, poolRows, startingFactions, type PoolFilter } from '../lib/deckPool';

  interface Props {
    t: Strings;
    /** Every card that can go in this deck, before any filter. */
    pool: readonly IndexRow[];
    /** The deck's chosen aspects, which are the factions on at first. */
    deckAspects: readonly string[];
    /** Copies of each card in the deck, for the steppers. */
    slots: Readonly<Record<string, number>>;
    ownedPackCodes: ReadonlySet<string>;
    ownedOnly: boolean;
    onOwnedOnly: (next: boolean) => void;
    onAdd: (code: string) => void;
    onRemove: (code: string) => void;
    /** Opens the card, for reading it before deciding. */
    onOpen: (code: string) => void;
  }

  const { t, pool, deckAspects, slots, ownedPackCodes, ownedOnly, onOwnedOnly, onAdd, onRemove, onOpen }: Props = $props();

  /*
   * The filters, as state of this screen only.
   *
   * The deck's aspects and basic are on when the editor opens, because that is
   * the deck being built; the other aspects are one tap away for a hero whose
   * rules allow some. Nothing here is kept between decks -- a filter is a
   * question about this deck, not a preference -- except the collection tick,
   * which the parent owns.
   */
  // Read once, deliberately: the chips are this screen's state from here on,
  // and the editor is keyed on the deck, so a new deck mounts a new pool.
  let factions = $state<Set<string>>(untrack(() => startingFactions(deckAspects)));
  let types = $state<Set<string>>(new Set());
  let query = $state('');
  let cost = $state<number | null>(null);
  let sort = $state<'name' | 'cost'>('name');

  const filter = $derived<PoolFilter>({ factions, types, query, cost, ownedOnly, sort });
  const rows = $derived(poolRows(pool, filter, { ownedPacks: ownedPackCodes, favourites: new Set() }));

  const factionChips = $derived(factionOrder(pool, deckAspects));
  const typeChips = $derived.by(() => {
    const names = new Map<string, string>();
    for (const row of pool) {
      if (!names.has(row.typeCode)) {
        names.set(row.typeCode, row.typeName);
      }
    }
    return [...names.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
  });

  function toggle(set: Set<string>, code: string): Set<string> {
    const next = new Set(set);
    if (next.has(code)) {
      next.delete(code);
    } else {
      next.add(code);
    }
    return next;
  }

  const COSTS = [0, 1, 2, 3, 4, COST_CAP];
</script>

<!--
  The pool a deck is built from, all of it, on the page.

  A search box that shows nothing until something is typed makes the person
  guess at names; a list that is there from the start lets them read. The
  filters take away from the whole rather than adding to nothing, and the
  count under them says how much is left.
-->
<div class="pool">
  <label class="field-group">
    <span class="visually-hidden">{t.searchLabel}</span>
    <input
      class="field"
      type="search"
      placeholder={t.searchPlaceholder}
      value={query}
      oninput={(e) => (query = e.currentTarget.value)}
    />
  </label>

  <div class="chip-row" role="group" aria-label={t.factionLabel}>
    {#each factionChips as chip (chip.code)}
      <button
        type="button"
        class="chip faction-chip"
        data-faction={chip.code}
        aria-pressed={factions.has(chip.code)}
        onclick={() => (factions = toggle(factions, chip.code))}
      >
        <span class="dot" aria-hidden="true"></span>{chip.name}
      </button>
    {/each}
  </div>

  <div class="chip-row" role="group" aria-label={t.typeLabel}>
    {#each typeChips as chip (chip.code)}
      <button type="button" class="chip" aria-pressed={types.has(chip.code)} onclick={() => (types = toggle(types, chip.code))}>
        {chip.name}
      </button>
    {/each}
  </div>

  <div class="chip-row" role="group" aria-label={t.cost}>
    <span class="muted small label">{t.cost}</span>
    {#each COSTS as c (c)}
      <button type="button" class="chip chip--tight" aria-pressed={cost === c} onclick={() => (cost = cost === c ? null : c)}>
        {c === COST_CAP ? `${c}+` : c}
      </button>
    {/each}
  </div>

  <div class="settings">
    <label class="tick">
      <input type="checkbox" checked={ownedOnly} onchange={(e) => onOwnedOnly(e.currentTarget.checked)} />
      <span>{t.ownedOnly}</span>
    </label>
    <label class="sort">
      <span class="muted small">{t.sortLabel}</span>
      <select class="field field--inline" value={sort} onchange={(e) => (sort = e.currentTarget.value === 'cost' ? 'cost' : 'name')}>
        <option value="name">{t.sortByName}</option>
        <option value="cost">{t.sortByCost}</option>
      </select>
    </label>
  </div>

  <p class="muted small count">{t.resultCount(rows.length, pool.length)}</p>

  {#if rows.length === 0}
    <p class="muted">{t.noResults} {t.noResultsHint}</p>
  {:else}
    <ul class="cards">
      {#each rows as row (row.code)}
        {@const n = slots[row.code] ?? 0}
        <li data-faction={row.factionCode} class:held={n > 0}>
          <span class="bar" aria-hidden="true"></span>
          <span class="body">
            <button type="button" class="name" onclick={() => onOpen(row.code)}>
              {row.name}
              {#if row.isUnique}<span class="unique" title={t.unique}>◆</span>{/if}
            </button>
            <span class="meta muted small">
              {row.typeName}{#if row.cost !== null}{' · '}{t.cost} {row.cost}{/if}
              {#if !ownedPackCodes.has(row.packCode)}
                <span class="tag">{t.notOwned}</span>
              {/if}
            </span>
          </span>
          <span class="steppers">
            <button class="btn btn--quiet step" type="button" disabled={n === 0} aria-label={`− ${row.name}`} onclick={() => onRemove(row.code)}>−</button>
            <span class="qty" class:zero={n === 0}>{n}</span>
            <button class="btn btn--quiet step" type="button" aria-label={`+ ${row.name}`} onclick={() => onAdd(row.code)}>+</button>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .pool {
    display: grid;
    gap: var(--space-3);
  }

  .label {
    align-self: center;
  }

  .chip--tight {
    min-width: 2.5rem;
    justify-content: center;
    padding-inline: var(--space-2);
  }

  /* A faction chip carries its colour as a dot, the same colour as the bar on
     its cards, so the chip and the rows it controls read as one thing. */
  .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--faction-basic);
  }

  [data-faction='leadership'] .dot,
  li[data-faction='leadership'] .bar {
    background: var(--faction-leadership);
  }
  [data-faction='justice'] .dot,
  li[data-faction='justice'] .bar {
    background: var(--faction-justice);
  }
  [data-faction='aggression'] .dot,
  li[data-faction='aggression'] .bar {
    background: var(--faction-aggression);
  }
  [data-faction='protection'] .dot,
  li[data-faction='protection'] .bar {
    background: var(--faction-protection);
  }
  [data-faction='pool'] .dot,
  li[data-faction='pool'] .bar {
    background: var(--faction-pool);
  }
  [data-faction='hero'] .dot,
  li[data-faction='hero'] .bar {
    background: var(--faction-hero);
  }

  .settings {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-4);
  }

  .sort {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .field--inline {
    width: auto;
    display: inline-block;
  }

  .count {
    margin: 0;
  }

  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .cards li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--hairline);
    /* Several hundred rows: let the browser skip laying out the ones off screen. */
    content-visibility: auto;
    contain-intrinsic-size: auto 3.25rem;
  }

  .cards li.held {
    background: var(--accent-soft);
    margin-inline: calc(var(--space-2) * -1);
    padding-inline: var(--space-2);
    border-radius: var(--radius-sm);
  }

  .bar {
    flex: 0 0 auto;
    width: 4px;
    align-self: stretch;
    border-radius: 2px;
    background: var(--faction-basic);
  }

  .body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .name {
    border: 0;
    background: none;
    padding: 0;
    margin: 0;
    color: inherit;
    font: inherit;
    font-weight: var(--weight-semibold);
    text-align: start;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name:hover,
  .name:focus-visible {
    color: var(--accent);
  }

  .unique {
    font-size: 0.8em;
    margin-inline-start: 0.2em;
  }

  .tag {
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--danger);
    border: 1px solid currentColor;
    border-radius: var(--radius-sm);
    padding: 0 var(--space-1);
    margin-inline-start: var(--space-1);
  }

  .steppers {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  .step {
    min-width: var(--tap-min);
    padding-inline: 0;
  }

  .qty {
    min-width: 1.4rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-semibold);
  }

  .qty.zero {
    color: var(--text-faint);
    font-weight: normal;
  }
</style>
