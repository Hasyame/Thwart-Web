<script lang="ts">
  import { liveQuery } from 'dexie';
  import type { Card, IndexRow, Locale, Pack } from '../lib/types';
  import type { SavedDeck } from '../lib/records';
  import type { Strings } from '../lib/i18n';
  import { db } from '../lib/db';
  import { loadCardsByCode } from '../lib/data';
  import { parseSlots } from '../lib/decks';
  import { showCard } from '../lib/cardViewer.svelte';
  import DeckContents from './DeckContents.svelte';
  import DeckEditor from './DeckEditor.svelte';

  interface Props {
    t: Strings;
    index: readonly IndexRow[];
    packs: readonly Pack[];
    cardLocale: Locale;
    storageOk: boolean;
    /** The deck's id, from the URL. */
    id: string;
    /** Building rather than reading. */
    edit: boolean;
    onView: () => void;
    onEdit: () => void;
    /** Back to the shelf: after a deletion, or when the id is nobody's. */
    onShelf: () => void;
    cardHref: (code: string) => string;
  }

  const { t, index, packs, cardLocale, storageOk, id, edit, onView, onEdit, onShelf, cardHref }: Props = $props();

  /*
   * One deck, live: an edit saved on another device arrives while the page
   * is open. `undefined` until the first read, `null` when there is no such
   * deck -- a link from before a deletion, or from somebody else's browser,
   * since a deck's id is local to the device or the account that holds it.
   */
  let deck = $state.raw<SavedDeck | null | undefined>(undefined);
  let owned = $state.raw<ReadonlySet<string>>(new Set());
  $effect(() => {
    if (!storageOk) {
      deck = null;
      return;
    }
    const decks = liveQuery(() => db.decks.get(id)).subscribe((row) => {
      deck = row ?? null;
    });
    const packs = liveQuery(() => db.ownedPacks.toArray()).subscribe((rows) => {
      owned = new Set(rows.map((r) => r.packCode));
    });
    return () => {
      decks.unsubscribe();
      packs.unsubscribe();
    };
  });

  const packNames = $derived(new Map(packs.map((p) => [p.code, p.name] as const)));

  /*
   * Full records for the deck's cards and the hero's own pack -- which holds
   * the signature cards, the rules, and the nemesis set the page shows.
   */
  let cards = $state.raw<ReadonlyMap<string, Card>>(new Map());
  $effect(() => {
    const current = deck;
    if (current === null || current === undefined) {
      return;
    }
    const byCode = new Map(index.map((row) => [row.code, row.packCode] as const));
    const wanted = new Set<string>();
    for (const code of [current.heroCode, ...parseSlots(current.slots).keys()]) {
      const pack = byCode.get(code);
      if (pack !== undefined) {
        wanted.add(pack);
      }
    }
    let cancelled = false;
    void loadCardsByCode(cardLocale, wanted).then((loaded) => {
      if (!cancelled) {
        cards = loaded;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  async function remove(): Promise<void> {
    if (deck === null || deck === undefined) {
      return;
    }
    await db.decks.delete(deck.id);
    onShelf();
  }
</script>

{#if deck === undefined}
  <p class="muted">…</p>
{:else if deck === null}
  <section class="surface gone">
    <p>{t.deckNotFound}</p>
    <button type="button" class="btn" onclick={onShelf}>{t.deckBackToShelf}</button>
  </section>
{:else if edit}
  <DeckEditor {t} {cardLocale} {index} {deck} ownedPackCodes={owned} onDone={onView} />
{:else}
  <DeckContents
    {t}
    {deck}
    {cardLocale}
    {cards}
    ownedPackCodes={owned}
    {packNames}
    openCard={showCard}
    {cardHref}
    {onEdit}
    onDelete={() => void remove()}
    onBack={onShelf}
  />
{/if}

<style>
  .gone {
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
    justify-items: start;
  }
</style>
