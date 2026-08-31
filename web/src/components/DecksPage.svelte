<script lang="ts">
  import { liveQuery } from 'dexie';
  import type { IndexRow, Locale, Pack } from '../lib/types';
  import type { SavedDeck } from '../lib/records';
  import type { Strings } from '../lib/i18n';
  import { db } from '../lib/db';
  import { loadCardsByCode } from '../lib/data';
  import type { Card } from '../lib/types';
  import DeckContents from './DeckContents.svelte';
  import {
    DeckImportError,
    importDeck,
    parseDeckReference,
    parseSlots,
  } from '../lib/decks';

  interface Props {
    t: Strings;
    index: readonly IndexRow[];
    packs: readonly Pack[];
    cardLocale: Locale;
    storageOk: boolean;
    openCard: (code: string) => void;
    cardHref: (code: string) => string;
  }

  const { t, index, packs, cardLocale, storageOk, openCard, cardHref }: Props =
    $props();

  const packNames = $derived(new Map(packs.map((p) => [p.code, p.name] as const)));

  // Not named `state`: Svelte reads `$name` as a store subscription, so a
  // variable called `state` turns the `$state` rune into a reference to it.
  const saved = $state<{ decks: readonly SavedDeck[]; owned: Set<string> }>({
    decks: [],
    owned: new Set(),
  });

  $effect(() => {
    if (!storageOk) {
      return;
    }
    const subs = [
      liveQuery(() => db.decks.orderBy('id').toArray()).subscribe((rows) => {
        saved.decks = rows;
      }),
      liveQuery(() => db.ownedPacks.toArray()).subscribe((rows) => {
        saved.owned = new Set(rows.map((r) => r.packCode));
      }),
    ];
    return () => subs.forEach((s) => s.unsubscribe());
  });

  let input = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let openDeckId = $state<string | null>(null);

  const reference = $derived(parseDeckReference(input));

  const openDeck = $derived(
    saved.decks.find((deck) => deck.id === openDeckId) ?? null,
  );

  /**
   * Full records for the packs the open deck draws on.
   *
   * The search index is not enough here: previews need images, the composition
   * needs resource icons, and legality needs the deck-building fields. Loaded
   * per deck and cached, so a second deck from the same boxes is free.
   */
  let deckCards = $state.raw<ReadonlyMap<string, Card>>(new Map());

  $effect(() => {
    const deck = openDeck;
    if (deck === null) {
      deckCards = new Map();
      return;
    }
    const byCode = new Map(index.map((row) => [row.code, row] as const));
    const packCodes = new Set<string>();
    for (const code of parseSlots(deck.slots).keys()) {
      const row = byCode.get(code);
      if (row !== undefined) {
        packCodes.add(row.packCode);
      }
    }
    // The hero's own pack, which carries its signature cards and its rules.
    const heroRow = byCode.get(deck.heroCode);
    if (heroRow !== undefined) {
      packCodes.add(heroRow.packCode);
    }

    let cancelled = false;
    loadCardsByCode(cardLocale, packCodes).then((loaded) => {
      if (!cancelled) {
        deckCards = loaded;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  async function doImport(): Promise<void> {
    const ref = reference;
    if (ref === null || busy) {
      return;
    }
    busy = true;
    error = null;
    try {
      const deck = await importDeck(ref);
      // Keyed by the app's own id, so re-importing the same deck replaces it
      // rather than making a second copy.
      await db.decks.put(deck);
      input = '';
      openDeckId = deck.id;
    } catch (caught) {
      error =
        caught instanceof DeckImportError && caught.message === 'network'
          ? t.deckImportNetwork
          : t.deckImportNotFound;
    } finally {
      busy = false;
    }
  }

  async function remove(id: string): Promise<void> {
    await db.decks.delete(id);
    if (openDeckId === id) {
      openDeckId = null;
    }
  }
</script>

<section>
  <h1>{t.decksTitle}</h1>

  {#if !storageOk}
    <div class="notice surface"><p>{t.storageUnavailable}</p></div>
  {:else}
    <div class="import surface">
      <h2>{t.importDeck}</h2>
      <p class="muted note">{t.importDeckNote}</p>
      <div class="import-row">
        <label class="grow">
          <span class="visually-hidden">{t.importDeck}</span>
          <input
            type="text"
            placeholder="https://marvelcdb.com/decklist/view/12345"
            value={input}
            oninput={(e) => (input = e.currentTarget.value)}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                void doImport();
              }
            }}
          />
        </label>
        <button type="button" onclick={doImport} disabled={reference === null || busy}>
          {busy ? t.importing : t.importAction}
        </button>
      </div>
      {#if error !== null}
        <p class="error">{error}</p>
      {/if}
    </div>

    {#if saved.decks.length === 0}
      <p class="muted empty">{t.noDecks}</p>
    {:else}
      <ul class="decks">
        {#each saved.decks as deck (deck.id)}
          <li class="surface deck" class:open={deck.id === openDeckId}>
            <button
              type="button"
              class="deck-head"
              aria-expanded={deck.id === openDeckId}
              onclick={() => (openDeckId = openDeckId === deck.id ? null : deck.id)}
            >
              <span class="deck-name">{deck.name}</span>
              <span class="muted deck-sub">
                {deck.heroName}{deck.aspects === ''
                  ? ''
                  : ` · ${deck.aspects
                      .split(',')
                      .map((a) => t.aspect(a))
                      .join(' / ')}`}
              </span>
            </button>
            <button type="button" class="remove" onclick={() => remove(deck.id)}>
              {t.removeDeck}
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if openDeck !== null}
      <DeckContents
        {t}
        deck={openDeck}
        {cardLocale}
        cards={deckCards}
        ownedPackCodes={saved.owned}
        {packNames}
        {openCard}
        {cardHref}
      />
    {/if}

  {/if}
</section>

<style>
  h1 {
    font-size: 1.6rem;
    margin: var(--space-5) 0 var(--space-4);
  }

  h2 {
    font-size: 1.05rem;
    margin: 0 0 var(--space-1);
  }

  .notice,
  .import {
    padding: var(--space-4);
  }

  .notice {
    margin: var(--space-4) 0;
  }

  /*
   * Held to a readable measure rather than stretched across the page: the
   * panel is one paragraph and one field, and a paragraph set ninety
   * characters wide is hard to read however much room there is.
   */
  .import {
    max-width: 52rem;
    margin: var(--space-4) 0 var(--space-6);
  }

  .note {
    font-size: 0.85rem;
    max-width: var(--prose-max);
  }

  .import-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .grow {
    flex: 1 1 20rem;
  }

  input[type='text'] {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    border: 1px solid var(--md-outline);
    background: var(--md-surface);
    color: var(--md-on-surface);
  }

  button {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-lg);
    border: 1px solid var(--md-outline);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .decks {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(22rem, 1fr));
    gap: var(--space-2);
  }

  .deck {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }

  .deck.open {
    border-color: var(--md-primary);
  }

  .deck-head {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    border: 0;
    background: none;
    text-align: start;
    padding: var(--space-2) 0;
  }

  .deck-name {
    font-weight: 600;
  }

  .deck-sub {
    font-size: 0.85rem;
  }

  .remove {
    flex: 0 0 auto;
    font-size: 0.8rem;
    padding: var(--space-1) var(--space-2);
  }

  .empty {
    margin: var(--space-4) 0;
  }

  .error {
    color: var(--md-error);
    font-weight: 600;
    margin-bottom: 0;
  }

</style>
