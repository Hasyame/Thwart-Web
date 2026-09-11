<script lang="ts">
  import { liveQuery } from 'dexie';
  import type { IndexRow, Locale, Pack } from '../lib/types';
  import type { SavedDeck } from '../lib/records';
  import type { Strings } from '../lib/i18n';
  import { db } from '../lib/db';
  import { loadCardsByCode } from '../lib/data';
  import type { Card } from '../lib/types';
  import DeckContents from './DeckContents.svelte';
  import DeckEditor from './DeckEditor.svelte';
  import {
    DeckImportError,
    importDeck,
    parseDeckReference,
    parseSlots,
  } from '../lib/decks';
  import { heroRules, validateDeck } from '../lib/deckRules';
  import { syncAfter } from '../lib/sync/auto.svelte';

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
  /** The deck being edited, if any. Editing replaces the list rather than sitting under it. */
  let editingId = $state<string | null>(null);
  /** The hero and aspect chosen for a deck that does not exist yet. */
  let building = $state<{ heroCode: string; aspect: string } | null>(null);

  /*
   * Every hero in the pool, for the build form.
   *
   * From the index rather than a list, so a hero from a future pack appears on
   * its own. The identity's own code is what a deck is built around, and the
   * alter-ego side is a different card that never goes in the deck.
   */
  const heroes = $derived(
    index
      .filter((row) => row.typeCode === 'hero')
      .map((row) => ({ code: row.code, name: row.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  const ASPECTS = ['aggression', 'justice', 'leadership', 'protection'] as const;

  /**
   * Creates an empty deck and opens the editor on it.
   *
   * `local-<uuid>` is the id shape the sync contract reserves for a deck built
   * on a device rather than imported, so two devices that both build one never
   * collide and neither is mistaken for a MarvelCDB import.
   */
  async function createDeck(heroCode: string, aspect: string): Promise<void> {
    const hero = index.find((row) => row.code === heroCode);
    const id = `local-${crypto.randomUUID()}`;
    await db.decks.put({
      id,
      marvelCdbId: 0,
      kind: 'LOCAL',
      url: '',
      name: hero?.name ?? heroCode,
      heroCode,
      heroName: hero?.name ?? heroCode,
      aspects: aspect,
      slots: '',
      ignoreDeckLimitSlots: '',
      descriptionMd: null,
      version: null,
      tags: null,
      rawJson: '',
      lastSyncedAt: Date.now(),
      locallyEdited: true,
    });
    building = null;
    editingId = id;
    /*
     * A new deck, however it arrived.
     *
     * Built here or imported below: both are a deck the account did not have a
     * moment ago, and both are worth having on the phone before the next game.
     * Editing one is not on this list — see the note on the settings toggle.
     */
    syncAfter('deck-added');
  }

  const editing = $derived(saved.decks.find((deck) => deck.id === editingId) ?? null);

  const reference = $derived(parseDeckReference(input));

  const openDeck = $derived(
    saved.decks.find((deck) => deck.id === openDeckId) ?? null,
  );

  /**
   * Full records for every pack any saved deck draws on.
   *
   * Loaded for all decks rather than only the open one, because each box shows
   * its own verdict and a verdict needs the cards. Pack files are cached, and
   * decks overwhelmingly share boxes, so the union is far smaller than the sum.
   */
  let deckCards = $state.raw<ReadonlyMap<string, Card>>(new Map());
  let cardsLoading = $state(false);

  const rowByCode = $derived(new Map(index.map((row) => [row.code, row] as const)));

  $effect(() => {
    const decks = saved.decks;
    const byCode = rowByCode;
    if (decks.length === 0 || byCode.size === 0) {
      deckCards = new Map();
      return;
    }

    const packCodes = new Set<string>();
    for (const deck of decks) {
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
    }

    let cancelled = false;
    cardsLoading = true;
    loadCardsByCode(cardLocale, packCodes).then((loaded) => {
      if (!cancelled) {
        deckCards = loaded;
        cardsLoading = false;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  /**
   * Legality per deck, once the cards are in.
   *
   * Null while loading or where the hero card is unknown, which the box shows
   * as nothing rather than as a guess.
   */
  const verdicts = $derived.by((): ReadonlyMap<string, boolean | null> => {
    const out = new Map<string, boolean | null>();
    for (const deck of saved.decks) {
      const hero = deckCards.get(deck.heroCode);
      if (hero === undefined) {
        out.set(deck.id, null);
        continue;
      }
      const heroPack = [...deckCards.values()].filter(
        (c) => c.pack_code === hero.pack_code,
      );
      const rules = heroRules(hero, heroPack);
      const aspects = deck.aspects === '' ? [] : deck.aspects.split(',');
      out.set(
        deck.id,
        validateDeck(rules, aspects, parseSlots(deck.slots), deckCards).legal,
      );
    }
    return out;
  });

  /** The aspects a deck names, for the colour down its edge. */
  function aspectsOf(deck: SavedDeck): string[] {
    return deck.aspects === '' ? [] : deck.aspects.split(',');
  }

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
      syncAfter('deck-added');
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
{#if editing !== null}
  <!-- Keyed on the deck, so opening another one mounts a fresh editor with its
       own working copy rather than reusing the previous deck's. -->
  {#key editing.id}
    <DeckEditor {t} {cardLocale} {index} deck={editing} ownedPackCodes={saved.owned} onDone={() => (editingId = null)} />
  {/key}
{:else}
  <h1>{t.decksTitle}</h1>

  {#if !storageOk}
    <div class="notice surface"><p>{t.storageUnavailable}</p></div>
  {:else}
    <div class="import surface">
      <h2>{t.deckNew}</h2>
      {#if building === null}
        <button class="btn" type="button" onclick={() => (building = { heroCode: '', aspect: 'justice' })}>
          {t.deckNew}
        </button>
      {:else}
        <div class="build-row">
          <label class="field-group grow">
            <span class="field-label">{t.deckPickHero}</span>
            <select
              class="field"
              value={building.heroCode}
              onchange={(e) => building !== null && (building.heroCode = e.currentTarget.value)}
            >
              <option value="">—</option>
              {#each heroes as hero (hero.code)}
                <option value={hero.code}>{hero.name}</option>
              {/each}
            </select>
          </label>
          <label class="field-group">
            <span class="field-label">{t.deckPickAspect}</span>
            <select
              class="field"
              value={building.aspect}
              onchange={(e) => building !== null && (building.aspect = e.currentTarget.value)}
            >
              {#each ASPECTS as aspect (aspect)}
                <option value={aspect}>{aspect}</option>
              {/each}
            </select>
          </label>
          <button
            class="btn btn--primary"
            type="button"
            disabled={building.heroCode === ''}
            onclick={() => building !== null && void createDeck(building.heroCode, building.aspect)}
          >
            {t.deckCreate}
          </button>
          <button class="btn" type="button" onclick={() => (building = null)}>{t.cancel}</button>
        </div>
      {/if}
    </div>

    <div class="import surface">
      <h2>{t.importDeck}</h2>
      <p class="muted note">{t.importDeckNote}</p>
      <div class="import-row">
        <label class="grow">
          <span class="visually-hidden">{t.importDeck}</span>
          <input class="field"
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
        <button class="btn" type="button" onclick={doImport} disabled={reference === null || busy}>
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
          {@const verdict = verdicts.get(deck.id) ?? null}
          {@const aspects = aspectsOf(deck)}
          <li
            class="surface deck"
            class:open={deck.id === openDeckId}
            style:--deck-aspect-1={`var(--faction-${aspects[0] ?? 'basic'})`}
            style:--deck-aspect-2={aspects.length > 1
              ? `var(--faction-${aspects[1]})`
              : `var(--faction-${aspects[0] ?? 'basic'})`}
            class:two-aspects={aspects.length > 1}
          >
            <button
              type="button"
              class="btn deck-head"
              aria-expanded={deck.id === openDeckId}
              onclick={() => (openDeckId = openDeckId === deck.id ? null : deck.id)}
            >
              <span class="deck-name">{deck.name}</span>
              <span class="muted deck-sub">
                {deck.heroName}{aspects.length === 0
                  ? ''
                  : ` · ${aspects.map((a) => t.aspect(a)).join(' / ')}`}
              </span>
              {#if verdict !== null}
                <span class="verdict" class:illegal={!verdict}>
                  {verdict ? t.deckLegalShort : t.deckIllegalShort}
                </span>
              {:else if cardsLoading}
                <span class="verdict muted">…</span>
              {/if}
            </button>
            <button type="button" class="btn" onclick={() => (editingId = deck.id)}>
              {t.deckEdit}
            </button>
            <button type="button" class="btn remove" onclick={() => remove(deck.id)}>
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
{/if}
</section>

<style>
  .build-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-2);
  }

  h1 {
    font-size: var(--text-2xl);
    margin: var(--space-5) 0 var(--space-4);
  }

  h2 {
    font-size: var(--text-lg);
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
    font-size: var(--text-sm);
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
    border: 1px solid var(--border);
    background: var(--surface-1);
    color: var(--text);
  }

  .decks {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(22rem, 100%), 1fr));
    gap: var(--space-2);
  }

  .deck {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }

  .deck.open {
    border-color: var(--accent);
  }

  .deck-head {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-0-5);
    border: 0;
    background: none;
    text-align: start;
    padding: var(--space-2) 0;
  }

  .deck-name {
    font-weight: 600;
  }

  .deck-sub {
    font-size: var(--text-sm);
  }

  .remove {
    flex: 0 0 auto;
    font-size: var(--text-xs);
    padding: var(--space-1) var(--space-2);
  }

  .empty {
    margin: var(--space-4) 0;
  }

  .error {
    color: var(--danger);
    font-weight: 600;
    margin-bottom: 0;
  }

  /*
   * The aspect down the edge of the box, so a shelf of decks reads at a
   * glance. Two-aspect heroes get both, split down the same strip rather than
   * blended: Spider-Woman plays two aspects, she does not play an average of
   * them.
   */
  .deck {
    border-inline-start: 5px solid var(--deck-aspect-1, var(--faction-basic));
  }

  .deck.two-aspects {
    border-inline-start-color: transparent;
    border-image: linear-gradient(
        to bottom,
        var(--deck-aspect-1) 0 50%,
        var(--deck-aspect-2) 50% 100%
      )
      1;
  }

  .verdict {
    align-self: flex-start;
    margin-top: var(--space-1);
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
    border: 1px solid currentColor;
    border-radius: var(--radius-sm);
    padding: 0 var(--space-1);
  }

  .verdict.illegal {
    color: var(--danger);
  }
</style>
