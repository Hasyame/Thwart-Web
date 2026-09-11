<script lang="ts">
  import { untrack } from 'svelte';
  import type { Card, IndexRow, Locale } from '../lib/types';
  import type { Strings } from '../lib/i18n';
  import type { SavedDeck } from '../lib/records';
  import { db } from '../lib/db';
  import { loadCardsByCode } from '../lib/data';
  import { parseSlots } from '../lib/decks';
  import {
    deckAsText,
    deckStatistics,
    heroRules,
    validateDeck,
    type DeckProblem,
  } from '../lib/deckRules';
  import { searchCards, NO_FILTERS } from '../lib/search';
  import { loadDeckOwnedOnly, saveDeckOwnedOnly } from '../lib/preferences';

  /**
   * Building a deck, rather than looking at one.
   *
   * The rules live in `deckbuilder.ts` and are tested against the real card
   * pool; this is the screen that shows what they say while somebody is still
   * deciding. Legality is reported continuously rather than on a button,
   * because the useful moment for "that is a fourth copy" is when the fourth
   * copy goes in.
   */

  interface Props {
    t: Strings;
    cardLocale: Locale;
    index: readonly IndexRow[];
    deck: SavedDeck;
    /** Packs the collection says are owned; what the owned-only search keeps. */
    ownedPackCodes: ReadonlySet<string>;
    onDone: () => void;
  }

  const { t, cardLocale, index, deck, ownedPackCodes, onDone }: Props = $props();

  /*
   * Card code to copies. The identity is not in here; it is the deck's hero.
   *
   * Read from the deck once, deliberately: this is a working copy somebody is
   * editing, and it must not be pulled back to what is stored while they type.
   * The parent keys this component on the deck, so opening another one mounts a
   * fresh editor with a fresh copy.
   */
  const slots = $state<Record<string, number>>(
    untrack(() => Object.fromEntries(parseSlots(deck.slots).entries())),
  );
  let name = $state(untrack(() => deck.name));
  let query = $state('');
  /*
   * Whether the search offers the whole pool or only what is owned.
   *
   * A deck is usually built from one's own boxes, and a search that keeps
   * offering cards from packs you do not have is a list of things to buy
   * rather than a list of things to play. Remembered per browser.
   */
  let ownedOnly = $state(loadDeckOwnedOnly());
  let saving = $state(false);
  let copied = $state(false);

  /*
   * Full records for everything the deck touches.
   *
   * The index is enough to search with and not enough to judge with: legality
   * needs the printed copy limit, the faction, the traits and the resources.
   * So the index browses and this loads the records for the cards actually in
   * play, which keeps the whole pool off the wire.
   */
  let records = $state.raw<ReadonlyMap<string, Card>>(new Map());

  /*
   * The packs those cards come from, not the cards.
   *
   * `loadCardsByCode` fetches whole pack files and returns their cards keyed by
   * code — the index is what turns a card code into the pack to fetch, which is
   * the whole reason it carries one.
   */
  const wantedPacks = $derived.by(() => {
    const byCode = new Map(index.map((row) => [row.code, row.packCode] as const));
    const packs = new Set<string>();
    for (const code of [deck.heroCode, ...Object.keys(slots)]) {
      const pack = byCode.get(code);
      if (pack !== undefined) {
        packs.add(pack);
      }
    }
    return [...packs];
  });

  $effect(() => {
    const packs = wantedPacks;
    let cancelled = false;
    void loadCardsByCode(cardLocale, packs)
      .then((loaded) => {
        if (!cancelled) {
          records = loaded;
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  });

  const hero = $derived(records.get(deck.heroCode) ?? null);

  const aspects = $derived(
    deck.aspects
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ''),
  );

  /*
   * The hero's rules, derived from its own pack.
   *
   * `heroRules` needs the pack's cards to work out which of them are the
   * identity's own signature cards — they are not optional and not adjustable,
   * and nothing on the identity card lists them.
   */
  const rules = $derived(hero === null ? null : heroRules(hero, [...records.values()]));

  const slotMap = $derived(new Map(Object.entries(slots)));

  const validation = $derived(
    rules === null ? null : validateDeck(rules, aspects, slotMap, records),
  );

  const stats = $derived(deckStatistics(slotMap, records));

  const total = $derived(Object.values(slots).reduce((sum, quantity) => sum + quantity, 0));

/*
   * The card types a player deck can hold.
   *
   * Without this the search offers treacheries, minions and main schemes,
   * which are the encounter deck's and can never go in a deck somebody builds.
   * The first version did exactly that, and the validator had nothing to say
   * about it — off-aspect is the wrong complaint for a card that is not a
   * player card at all.
   */
  const PLAYER_TYPES = new Set(['ally', 'event', 'upgrade', 'support', 'resource']);

  /** What the search offers to add. */
  const results = $derived(
    query.trim() === ''
      ? []
      : searchCards(index, {
          query,
          filters: { ...NO_FILTERS, ownedOnly },
          collection: { ownedPacks: ownedPackCodes, favourites: new Set() },
          limit: 40,
        }).rows.filter((row) => PLAYER_TYPES.has(row.typeCode) && row.factionCode !== 'encounter'),
  );

  function setOwnedOnly(next: boolean): void {
    ownedOnly = next;
    saveDeckOwnedOnly(next);
  }

  function add(code: string): void {
    slots[code] = (slots[code] ?? 0) + 1;
  }

  function remove(code: string): void {
    const next = (slots[code] ?? 0) - 1;
    if (next <= 0) {
      delete slots[code];
    } else {
      slots[code] = next;
    }
  }

  /** The deck's cards, grouped the way a decklist is written. */
  const grouped = $derived.by(() => {
    const byType = new Map<string, { code: string; name: string; quantity: number }[]>();
    for (const [code, quantity] of Object.entries(slots)) {
      const row = index.find((entry) => entry.code === code);
      const typeName = row?.typeName ?? '—';
      const entry = { code, name: row?.name ?? code, quantity };
      const bucket = byType.get(typeName);
      if (bucket === undefined) {
        byType.set(typeName, [entry]);
      } else {
        bucket.push(entry);
      }
    }
    return [...byType.entries()]
      .map(([type, cards]) => ({
        type,
        cards: [...cards].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.type.localeCompare(b.type));
  });

  function describe(problem: DeckProblem): string {
    switch (problem.kind) {
      case 'tooFewCards':
        return t.deckTooFew(problem.actual, problem.minimum);
      case 'tooManyCards':
        return t.deckTooMany(problem.actual, problem.maximum);
      case 'wrongAspectCount':
        return t.deckWrongAspects(problem.chosen, problem.expected);
      case 'offAspect':
        return t.deckOffAspect(problem.cardName);
      case 'overCopyLimit':
        return t.deckOverLimit(problem.title, problem.total, problem.limit);
      case 'duplicateUnique':
        return t.deckDuplicateUnique(problem.title);
      case 'missingRequired':
        return t.deckMissingRequired(problem.cardName, problem.required, problem.actual);
      case 'unbalancedAspects':
        return t.deckUnbalanced(
          [...problem.counts.entries()]
            .map(([aspect, count]) => `${aspect} ${count}`)
            .join(', '),
        );
    }
  }

  async function save(): Promise<void> {
    saving = true;
    try {
      await db.decks.put({
        ...deck,
        name,
        slots: Object.entries(slots)
          .map(([code, quantity]) => `${code}=${quantity}`)
          .join(','),
        // Edited here, so a refresh from MarvelCDB knows it would discard work.
        locallyEdited: true,
      });
      onDone();
    } finally {
      saving = false;
    }
  }

  async function copyText(): Promise<void> {
    const byType = new Map(
      grouped.map((group) => [
        group.type,
        group.cards.map((card) => ({ quantity: card.quantity, name: card.name })),
      ]),
    );
    await navigator.clipboard?.writeText(
      deckAsText(name, hero?.name ?? deck.heroName, aspects, byType, deck.url || null),
    );
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<section>
  <div class="head">
    <label class="field-group grow">
      <span class="field-label">{t.deckName}</span>
      <input class="field" type="text" value={name} oninput={(e) => (name = e.currentTarget.value)} />
    </label>
    <button class="btn btn--primary" type="button" disabled={saving} onclick={() => void save()}>
      {t.deckSave}
    </button>
    <button class="btn" type="button" onclick={onDone}>{t.cancel}</button>
  </div>

  <!--
    Legality reported while the deck is being built, not on a button. The
    useful moment for "that is a fourth copy" is when the fourth copy goes in.
  -->
  {#if validation !== null && rules !== null}
    <div class="legality" class:ok={validation.legal}>
      <p class="count">
        {t.deckCardCount(total, rules.minimum, rules.maximum)}
        {#if validation.legal}<span class="ok-mark">{t.deckLegal}</span>{/if}
      </p>
      {#if !validation.legal}
        <ul class="problems">
          {#each validation.problems as problem, i (i)}
            <li>{describe(problem)}</li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  <div class="columns">
    <div class="column">
      <h2>{t.deckContents}</h2>
      {#each grouped as group (group.type)}
        <h3>{group.type} <span class="muted">{group.cards.reduce((n, c) => n + c.quantity, 0)}</span></h3>
        <ul class="cards">
          {#each group.cards as card (card.code)}
            <li>
              <span class="qty">{card.quantity}×</span>
              <span class="name">{card.name}</span>
              <span class="steppers">
                <button class="btn btn--quiet" type="button" onclick={() => remove(card.code)}>−</button>
                <button class="btn btn--quiet" type="button" onclick={() => add(card.code)}>+</button>
              </span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted">{t.deckEmpty}</p>
      {/each}
    </div>

    <div class="column">
      <h2>{t.deckAddCards}</h2>
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
      <label class="tick">
        <input
          type="checkbox"
          checked={ownedOnly}
          onchange={(e) => setOwnedOnly(e.currentTarget.checked)}
        />
        <span>{t.ownedOnly}</span>
      </label>
      {#if ownedOnly && ownedPackCodes.size === 0}
        <p class="muted small">{t.deckOwnedOnlyEmpty}</p>
      {/if}
      <ul class="cards">
        {#each results as row (row.code)}
          <li>
            <span class="qty muted">{slots[row.code] ?? 0}×</span>
            <span class="name">
              {row.name}
              <span class="muted small">
                {row.typeName} · {row.factionName}
                {#if !ownedPackCodes.has(row.packCode)}
                  <span class="tag">{t.notOwned}</span>
                {/if}
              </span>
            </span>
            <span class="steppers">
              {#if (slots[row.code] ?? 0) > 0}
                <button class="btn btn--quiet" type="button" onclick={() => remove(row.code)}>−</button>
              {/if}
              <button class="btn btn--quiet" type="button" onclick={() => add(row.code)}>+</button>
            </span>
          </li>
        {/each}
      </ul>
    </div>
  </div>

  {#if stats.costedCards > 0}
    <div class="stats">
      <h2>{t.deckStats}</h2>
      <p class="muted">{t.deckAverageCost(stats.averageCost.toFixed(1))}</p>
      <!-- The curve, drawn to the tallest column so the shape is readable
           whatever the deck's size. -->
      <ul class="curve">
        {#each stats.costCurve as [cost, count] (cost)}
          <li>
            <span class="bar" style:height={`${(count / stats.tallestCostColumn) * 100}%`}></span>
            <span class="cost">{cost}</span>
            <span class="muted small">{count}</span>
          </li>
        {/each}
      </ul>
      <p class="muted">
        {t.deckResources(
          stats.resources.physical,
          stats.resources.mental,
          stats.resources.energy,
          stats.resources.wild,
        )}
      </p>
      <button class="btn" type="button" onclick={() => void copyText()}>
        {copied ? t.deckCopied : t.deckCopy}
      </button>
    </div>
  {/if}
</section>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-2);
    margin: var(--space-4) 0;
  }

  .grow {
    flex: 1 1 14rem;
  }

  h2 {
    font-size: var(--text-lg);
    font-weight: var(--weight-bold);
    margin-bottom: var(--space-2);
  }

  h3 {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--text-muted);
    margin: var(--space-3) 0 var(--space-1);
  }

  .legality {
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border-inline-start: 3px solid var(--danger);
    margin-bottom: var(--space-4);
  }

  .legality.ok {
    border-inline-start-color: var(--accent);
  }

  .count {
    margin: 0;
    font-weight: var(--weight-semibold);
  }

  .ok-mark {
    color: var(--accent);
    margin-inline-start: var(--space-2);
  }

  .problems {
    margin: var(--space-2) 0 0;
    padding-left: var(--space-5);
    display: grid;
    gap: var(--space-1);
    font-size: var(--text-sm);
  }

  .columns {
    display: grid;
    gap: var(--space-4);
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
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
  }

  .qty {
    font-variant-numeric: tabular-nums;
    min-width: 2.2rem;
  }

  /* The same mark the deck's own list puts on a card from a pack not owned,
     so the search and the list say it the same way. */
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

  .name {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .small {
    font-size: var(--text-xs);
  }

  .steppers {
    display: flex;
    gap: var(--space-1);
  }

  .stats {
    margin-top: var(--space-5);
    display: grid;
    gap: var(--space-2);
    max-width: var(--prose-max);
  }

  /* A column per cost, tall enough to compare at a glance. Heights are a
     percentage of the tallest, so the shape survives any deck size. */
  .curve {
    list-style: none;
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    height: 7rem;
    margin: 0;
    padding: 0;
  }

  .curve li {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    flex: 1 1 0;
    height: 100%;
  }

  .curve .bar {
    display: block;
    width: 100%;
    background: var(--accent);
    border-radius: 2px 2px 0 0;
    min-height: 2px;
  }

  .cost {
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-semibold);
  }
</style>
