<script lang="ts">
  import { untrack } from 'svelte';
  import type { Card, IndexRow, Locale } from '../lib/types';
  import type { Strings } from '../lib/i18n';
  import type { SavedDeck } from '../lib/records';
  import { db } from '../lib/db';
  import { cardImageUrl, loadCardsByCode } from '../lib/data';
  import { inferAspects, parseSlots } from '../lib/decks';
  import { poolFor } from '../lib/deckPool';
  import { showCard } from '../lib/cardViewer.svelte';
  import DeckPool from './DeckPool.svelte';
  import CardHover from './CardHover.svelte';
  import CardPanel from './CardPanel.svelte';
  import DeckBanner from './DeckBanner.svelte';
  import {
    deckAsText,
    deckStatistics,
    heroRules,
    validateDeck,
    type DeckProblem,
  } from '../lib/deckRules';
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
   * Which half a phone shows.
   *
   * Two columns do not fit on a phone, and stacking them puts a thousand
   * cards under the deck, out of reach. So below the two-column width the
   * editor shows one at a time behind two tabs, with the count in the bar
   * whichever is open. On a wide screen the tabs are not rendered and both
   * columns are, whatever this says.
   */
  let view = $state<'deck' | 'pool'>('deck');

  // Opened from a list that may be scrolled a long way down; the banner and
  // the bar are at the top, and that is where an editor opens.
  $effect(() => {
    window.scrollTo({ top: 0 });
  });

  /*
   * Whether the bar has stuck: the banner above it holds the name large, and
   * the bar repeats it only once the banner is off the top. A sentinel just
   * above the bar tells which, with no scroll listener.
   */
  let stuck = $state(false);
  let sentinel = $state.raw<HTMLElement | null>(null);
  $effect(() => {
    const el = sentinel;
    if (el === null) {
      return;
    }
    const watch = new IntersectionObserver(([entry]) => {
      stuck = entry !== undefined && !entry.isIntersecting;
    });
    watch.observe(el);
    return () => watch.disconnect();
  });

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
  /** The hero's picture, for the bar. From MarvelCDB, referenced and never copied. */
  const heroImage = $derived(hero === null ? null : cardImageUrl(hero.imagesrc));

  /*
   * Read off the cards, not off the deck: see `inferAspects`. A deck opened
   * with an `aspects` field but no aspect card yet -- an import, a deck from
   * the phone -- keeps what it said until a card says otherwise.
   */
  const rowByCode = $derived(new Map(index.map((row) => [row.code, row] as const)));
  const declared = $derived(
    deck.aspects
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ''),
  );
  const aspects = $derived.by(() => {
    const inferred = inferAspects(slotMap, (code) => rowByCode.get(code), heroSetCode);
    return inferred.length > 0 ? inferred : declared;
  });

  /*
   * The hero's rules, derived from its own pack.
   *
   * `heroRules` needs the pack's cards to work out which of them are the
   * identity's own signature cards — they are not optional and not adjustable,
   * and nothing on the identity card lists them.
   */
  const rules = $derived(hero === null ? null : heroRules(hero, [...records.values()]));

  const slotMap = $derived(new Map(Object.entries(slots)));

  const validation = $derived.by(() => {
    if (rules === null) {
      return null;
    }
    const raw = validateDeck(rules, aspects, slotMap, records);
    // Fewer aspects than the hero takes is not a fault while the deck is
    // still short: nothing has been chosen yet, and "too few cards" already
    // says so. Too many is a fault from the first card that mixes them.
    const problems = raw.problems.filter(
      (p) => !(p.kind === 'wrongAspectCount' && p.chosen < p.expected && total < rules.minimum),
    );
    return { ...raw, problems, legal: problems.length === 0 };
  });

  const stats = $derived(deckStatistics(slotMap, records));

  const total = $derived(Object.values(slots).reduce((sum, quantity) => sum + quantity, 0));

  /* The hero's own set, from the index: what decides which set-bound cards
     the pool may hold. See `buildableFor`. */
  const heroSetCode = $derived(index.find((row) => row.code === deck.heroCode)?.setCode ?? null);

  /** Every card that can go in *this* deck. The pool narrows it; nothing widens it. */
  const pool = $derived(poolFor(index, heroSetCode));

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

  /*
   * The hero's own cards, apart from the rest.
   *
   * Not optional and not adjustable -- the rule is the printed count -- so
   * they are listed under their own heading with no steppers, and the person
   * is never offered a minus that the validator would only complain about.
   */
  const heroCards = $derived.by(() => {
    if (rules === null) {
      return [];
    }
    return [...rules.requiredCards.entries()]
      .map(([code, quantity]) => {
        const row = index.find((r) => r.code === code);
        return { code, name: records.get(code)?.name ?? row?.name ?? code, quantity, cost: row?.cost ?? null };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  /** Whether any of the hero's cards is missing or miscounted: an older deck, or an edit gone wrong. */
  const heroCardsMissing = $derived(validation?.problems.some((p) => p.kind === 'missingRequired') ?? false);

  function addHeroCards(): void {
    if (rules === null) {
      return;
    }
    for (const [code, quantity] of rules.requiredCards) {
      slots[code] = quantity;
    }
  }

  /** The deck's chosen cards, grouped the way a decklist is written. The hero's own are listed apart. */
  const grouped = $derived.by(() => {
    const byType = new Map<string, { code: string; name: string; quantity: number; cost: number | null }[]>();
    for (const [code, quantity] of Object.entries(slots)) {
      if (rules?.requiredCards.has(code) === true) {
        continue;
      }
      const row = index.find((entry) => entry.code === code);
      const typeName = row?.typeName ?? '—';
      const entry = { code, name: row?.name ?? code, quantity, cost: row?.cost ?? null };
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
        // What the cards say, so the shelf, the phone and MarvelCDB agree.
        aspects: aspects.join(','),
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

<section class="editor">
  <DeckBanner
    {t}
    art={heroImage}
    {name}
    onName={(next) => (name = next)}
    heroName={hero?.name ?? deck.heroName}
    {aspects}
    cards={total}
  />

  <!--
    Everything that has to be seen while building, in one bar that stays put:
    who the deck is for, how many cards it holds against the range, whether it
    is legal, and the way out. The problems themselves fold under it -- a wall
    of red above the deck was the first thing on the old screen, and most of
    it said "this deck is not finished yet", which the count already says.
  -->
  <div class="sentinel" bind:this={sentinel} aria-hidden="true"></div>
  <header class="bar" class:stuck>
    {#if heroImage !== null}
      <img class="portrait" src={heroImage} alt="" />
    {/if}
    <div class="who">
      <p class="bar-name">{name}</p>
      <p class="muted small line">
        {hero?.name ?? deck.heroName}{#if aspects.length > 0}{' · '}{aspects.map((a) => t.aspect(a)).join(' · ')}{/if}
      </p>
    </div>
    {#if validation !== null && rules !== null}
      <div class="status" class:ok={validation.legal} class:bad={!validation.legal}>
        <span class="pill">
          <b>{total}</b>
          <span class="range">/ {rules.minimum}–{rules.maximum}</span>
        </span>
        <span class="verdict">
          {validation.legal ? t.deckLegalShort : t.deckProblems(validation.problems.length)}
        </span>
      </div>
    {/if}
    <div class="actions">
      <button class="btn btn--primary" type="button" disabled={saving} onclick={() => void save()}>
        {t.deckSave}
      </button>
      <button class="btn" type="button" onclick={onDone}>{t.cancel}</button>
    </div>
    <!-- In the bar so they stay reachable: a tab that scrolls away with the
         list is a tab somebody has to scroll back up for. -->
    <div class="segments" role="tablist">
      <button type="button" role="tab" class="segment" aria-selected={view === 'deck'} onclick={() => (view = 'deck')}>
        {t.deckTabDeck} <span class="muted">{total}</span>
      </button>
      <button type="button" role="tab" class="segment" aria-selected={view === 'pool'} onclick={() => (view = 'pool')}>
        {t.deckTabPool} <span class="muted">{pool.length}</span>
      </button>
    </div>
  </header>

  {#if validation !== null && !validation.legal}
    <details class="problems-box">
      <summary>{t.deckIllegal(validation.problems.length)}</summary>
      <ul class="problems">
        {#each validation.problems as problem, i (i)}
          <li>{describe(problem)}</li>
        {/each}
      </ul>
    </details>
  {/if}

  <div class="columns" data-view={view}>
    <div class="column column--deck">
      <h2>{t.deckContents}</h2>
      {#if heroCards.length > 0}
        <h3>{t.deckHeroCards} <span class="muted">{heroCards.reduce((n, c) => n + c.quantity, 0)}</span></h3>
        <p class="muted small">{t.deckHeroCardsFixed}</p>
        {#if heroCardsMissing}
          <button type="button" class="btn" onclick={addHeroCards}>{t.deckAddHeroCards}</button>
        {/if}
        <ul class="cards">
          {#each heroCards as card (card.code)}
            <li class:missing={(slots[card.code] ?? 0) !== card.quantity}>
              <span class="qty">{card.quantity}</span>
              <CardHover code={card.code}>
                <button type="button" class="name link" onclick={() => showCard(card.code)}>{card.name}</button>
              </CardHover>
              {#if card.cost !== null}<span class="cost">{card.cost}</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}
      {#each grouped as group (group.type)}
        <h3>{group.type} <span class="muted">{group.cards.reduce((n, c) => n + c.quantity, 0)}</span></h3>
        <ul class="cards">
          {#each group.cards as card (card.code)}
            <li>
              <span class="qty">{card.quantity}</span>
              <CardHover code={card.code}>
                <button type="button" class="name link" onclick={() => showCard(card.code)}>{card.name}</button>
              </CardHover>
              {#if card.cost !== null}<span class="cost">{card.cost}</span>{/if}
              <span class="steppers">
                <button class="btn btn--quiet step" type="button" aria-label={`− ${card.name}`} onclick={() => remove(card.code)}>−</button>
                <button class="btn btn--quiet step" type="button" aria-label={`+ ${card.name}`} onclick={() => add(card.code)}>+</button>
              </span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted">{t.deckEmpty}</p>
      {/each}
    </div>

    <div class="column column--pool">
      <h2>{t.deckAddCards}</h2>
      <DeckPool
        {t}
        {pool}
        deckAspects={aspects}
        {slots}
        {ownedPackCodes}
        {ownedOnly}
        onOwnedOnly={setOwnedOnly}
        onAdd={add}
        onRemove={remove}
        onOpen={(code) => showCard(code)}
      />
    </div>
    <div class="column column--card">
      <CardPanel {t} initial={deck.heroCode} />
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
  /*
   * Under the app's own bar, which is 56px and a hairline (TopBar.svelte) plus
   * whatever the status bar takes on an installed phone app. Not a token
   * because nothing else sticks under it yet; the day something does, the two
   * numbers become one.
   */
  .bar {
    position: sticky;
    top: calc(57px + env(safe-area-inset-top));
    z-index: 10;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin: 0 calc(var(--space-4) * -1) var(--space-3);
    padding: var(--space-2) var(--space-4);
    background: var(--surface-1);
    border-bottom: 1px solid var(--hairline);
  }

  /* Hidden until the banner has scrolled away, so the name is not written
     twice on one screen: the bar's copy is for the reader who has scrolled. */
  .bar .who {
    visibility: hidden;
  }

  .bar.stuck .who {
    visibility: visible;
  }

  .sentinel {
    height: 1px;
    margin-top: -1px;
  }

  .portrait {
    flex: 0 0 auto;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 50%;
    object-fit: cover;
    /* The picture is a portrait card: the face is in the top third. */
    object-position: 50% 18%;
    background: var(--surface-2);
  }

  .who {
    flex: 1 1 12rem;
    min-width: 0;
    display: grid;
    gap: 2px;
  }

  .bar-name {
    margin: 0;
    font-weight: var(--weight-semibold);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .line {
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-variant-numeric: tabular-nums;
  }

  .pill {
    display: inline-flex;
    align-items: baseline;
    gap: 0.3em;
    padding: 0.15em 0.6em;
    border-radius: 999px;
    background: var(--surface-2);
    border: 1px solid var(--hairline);
    font-size: var(--text-lg);
  }

  .range {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .verdict {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
  }

  .status.ok .pill {
    border-color: var(--ok);
  }
  .status.ok .verdict {
    color: var(--ok);
  }
  .status.bad .pill {
    border-color: var(--danger);
  }
  .status.bad .verdict {
    color: var(--danger);
  }

  .actions {
    display: flex;
    gap: var(--space-2);
    margin-inline-start: auto;
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

  .problems-box {
    margin-bottom: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border-inline-start: 3px solid var(--danger);
  }

  .problems-box summary {
    cursor: pointer;
    font-weight: var(--weight-semibold);
    font-size: var(--text-sm);
  }

  .problems {
    margin: var(--space-2) 0 0;
    padding-left: var(--space-5);
    display: grid;
    gap: var(--space-1);
    font-size: var(--text-sm);
  }

  /* The two tabs, phone only; see `view` in the script. */
  .segments {
    flex: 1 0 100%;
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }

  .segment {
    flex: 1 1 0;
    min-height: var(--tap-min);
    border: 0;
    border-radius: calc(var(--radius-sm) - 2px);
    background: none;
    color: var(--text);
    font: inherit;
    font-weight: var(--weight-semibold);
    cursor: pointer;
  }

  .segment[aria-selected='true'] {
    background: var(--surface-1);
    box-shadow: 0 1px 2px rgb(0 0 0 / 12%);
  }

  @media (max-width: 55.99rem) {
    .columns[data-view='deck'] .column--pool,
    .columns[data-view='pool'] .column--deck {
      display: none;
    }
  }

  @media (min-width: 56rem) {
    .segments {
      display: none;
    }
  }

  .columns {
    display: grid;
    gap: var(--space-5);
  }

  .column {
    min-width: 0;
  }

  @media (min-width: 56rem) {
    .columns {
      grid-template-columns: minmax(18rem, 2fr) minmax(22rem, 3fr);
      align-items: start;
    }
    .column--card {
      display: none;
    }
  }

  /* Room for the card beside the deck: the panel gets a column of its own. */
  @media (min-width: 78rem) {
    .columns {
      grid-template-columns: minmax(18rem, 2fr) minmax(22rem, 3fr) 15rem;
    }
    .column--card {
      display: block;
    }
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
    min-height: 2.25rem;
    padding: 2px 0;
    border-bottom: 1px solid var(--hairline);
  }

  /* The count as a small square, the way decklists print it. */
  .qty {
    flex: 0 0 auto;
    min-width: 1.5rem;
    height: 1.5rem;
    display: inline-grid;
    place-items: center;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border: 1px solid var(--hairline);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    font-variant-numeric: tabular-nums;
  }

  /* The printed cost, a small circle at the end of the line. */
  .cost {
    flex: 0 0 auto;
    width: 1.4rem;
    height: 1.4rem;
    display: inline-grid;
    place-items: center;
    border-radius: 50%;
    background: var(--surface-2);
    border: 1px solid var(--border);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    font-variant-numeric: tabular-nums;
  }

  .step {
    min-width: var(--tap-min);
    padding-inline: 0;
  }

  /* A hero card the deck does not hold at the printed count. */
  .cards li.missing {
    color: var(--danger);
  }

  /* A name is a button that opens the card, drawn as text. */
  .link {
    border: 0;
    background: none;
    padding: 0;
    margin: 0;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .link:hover,
  .link:focus-visible {
    color: var(--accent);
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
