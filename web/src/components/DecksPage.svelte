<script lang="ts">
  import { liveQuery } from 'dexie';
  import type { IndexRow, Locale } from '../lib/types';
  import type { SavedDeck } from '../lib/records';
  import type { Strings } from '../lib/i18n';
  import { db } from '../lib/db';
  import {
    DeckImportError,
    deckViewUrl,
    importDeck,
    parseDeckReference,
    resolveDeck,
  } from '../lib/decks';

  interface Props {
    t: Strings;
    index: readonly IndexRow[];
    cardLocale: Locale;
    storageOk: boolean;
    openCard: (code: string) => void;
    cardHref: (code: string) => string;
  }

  const { t, index, cardLocale, storageOk, openCard, cardHref }: Props = $props();

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

  const contents = $derived(
    openDeck === null ? null : resolveDeck(openDeck, index, saved.owned),
  );

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

    {#if openDeck !== null && contents !== null}
      <div class="contents surface">
        <header class="contents-head">
          <div>
            <h2>{openDeck.name}</h2>
            <p class="muted">
              {openDeck.heroName} · {t.cardCount(contents.totalCards)}
            </p>
          </div>
          <a href={deckViewUrl(openDeck)} target="_blank" rel="noopener">
            {t.viewOnMarvelCdb} ↗
          </a>
        </header>

        <!--
          The reason this page beats looking the deck up on MarvelCDB: it knows
          what is in your boxes. A deck you cannot build is worth being told
          about before you sit down, not while shuffling.
        -->
        {#if contents.missing.length > 0}
          <p class="warn">
            {t.deckMissing(
              contents.missing.reduce((n, c) => n + c.quantity, 0),
              new Set(contents.missing.map((c) => c.card.packCode)).size,
            )}
          </p>
        {:else}
          <p class="ok">{t.deckBuildable}</p>
        {/if}

        {#if contents.unknownCodes.length > 0}
          <p class="muted note">{t.deckUnknownCards(contents.unknownCodes.length)}</p>
        {/if}

        {#each contents.byType as group (group.type)}
          <h3>{group.type}</h3>
          <ul class="cards">
            {#each group.cards as entry (entry.card.code)}
              <li class:missing={entry.missingFromCollection}>
                <span class="qty">{entry.quantity}×</span>
                <a
                  href={cardHref(entry.card.code)}
                  data-faction={entry.card.factionCode}
                  onclick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
                      return;
                    }
                    e.preventDefault();
                    openCard(entry.card.code);
                  }}
                >
                  {entry.card.name}
                </a>
                {#if entry.card.cost !== null}
                  <span class="muted cost">{entry.card.cost}</span>
                {/if}
                {#if entry.missingFromCollection}
                  <span class="tag">{t.notOwned}</span>
                {/if}
              </li>
            {/each}
          </ul>
        {/each}

        <p class="muted note locale-note">{t.deckLocaleNote(cardLocale)}</p>
      </div>
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

  h3 {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--md-on-surface-variant);
    margin: var(--space-4) 0 var(--space-2);
  }

  .notice,
  .import,
  .contents {
    padding: var(--space-4);
    margin: var(--space-4) 0;
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

  .contents-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-3);
  }

  .warn {
    color: var(--md-error);
    font-weight: 600;
  }

  .ok {
    color: var(--md-primary);
    font-weight: 600;
  }

  .cards {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
    gap: var(--space-1) var(--space-4);
  }

  .cards li {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: 2px 0;
  }

  .cards li.missing a {
    opacity: 0.65;
  }

  .qty {
    min-width: 1.8rem;
    font-variant-numeric: tabular-nums;
    color: var(--md-on-surface-variant);
  }

  .cards a {
    color: inherit;
    text-decoration: none;
    border-inline-start: 3px solid transparent;
    padding-inline-start: var(--space-2);
  }

  .cards a:hover {
    text-decoration: underline;
  }

  .cards a[data-faction='aggression'] {
    border-inline-start-color: var(--faction-aggression);
  }
  .cards a[data-faction='justice'] {
    border-inline-start-color: var(--faction-justice);
  }
  .cards a[data-faction='leadership'] {
    border-inline-start-color: var(--faction-leadership);
  }
  .cards a[data-faction='protection'] {
    border-inline-start-color: var(--faction-protection);
  }
  .cards a[data-faction='pool'] {
    border-inline-start-color: var(--faction-pool);
  }
  .cards a[data-faction='basic'] {
    border-inline-start-color: var(--faction-basic);
  }
  .cards a[data-faction='hero'] {
    border-inline-start-color: var(--faction-hero);
  }

  .cost {
    font-size: 0.85rem;
  }

  .tag {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--md-error);
    border: 1px solid currentColor;
    border-radius: var(--radius-sm);
    padding: 0 var(--space-1);
  }

  .empty {
    margin: var(--space-4) 0;
  }

  .error {
    color: var(--md-error);
    font-weight: 600;
    margin-bottom: 0;
  }

  .locale-note {
    margin-top: var(--space-5);
    padding-top: var(--space-3);
    border-top: 1px solid var(--md-outline-variant);
  }
</style>
