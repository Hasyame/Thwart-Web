<script lang="ts">
  import { liveQuery } from 'dexie';
  import type { IndexRow, Locale } from '../lib/types';
  import type { SavedDeck } from '../lib/records';
  import type { Strings } from '../lib/i18n';
  import { db } from '../lib/db';
  import { cardImageUrl, loadCardsByCode, loadPackCards } from '../lib/data';
  import { fetchCard } from '../lib/cardViewer.svelte';
  import type { Card } from '../lib/types';
  import {
    DeckImportError,
    heroIdentities,
    importDeck,
    parseDeckReference,
    parseSlots,
    signatureSlots,
  } from '../lib/decks';
  import { heroRules, validateDeck } from '../lib/deckRules';
  import { syncAfter } from '../lib/sync/auto.svelte';
  import { session } from '../lib/sync/session.svelte';
  import type { DeckFolder } from '../lib/records';
  import { createFolder, deleteFolder, folderOf, inShelfOrder, moveDeck, renameFolder } from '../lib/folders';
  import { loadFoldedFolders, saveFoldedFolders } from '../lib/preferences';

  interface Props {
    t: Strings;
    index: readonly IndexRow[];
    cardLocale: Locale;
    storageOk: boolean;
    /** Opens a deck's page, and its editor. */
    onOpen: (id: string) => void;
    onEdit: (id: string) => void;
    /** Opens the draft, set to draft or to sealed; it offers a game once the deck is saved. */
    onDraft: (sealed: boolean) => void;
  }

  const { t, index, cardLocale, storageOk, onOpen, onEdit, onDraft }: Props = $props();

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
  /** The hero and aspect chosen for a deck that does not exist yet. */
  let building = $state<{ heroCode: string } | null>(null);

  /*
   * Every hero in the pool, for the build form.
   *
   * From the index rather than a list, so a hero from a future pack appears on
   * its own. One entry per hero, not per hero card — the Giant forms and
   * Ironheart's versions are folded in `heroIdentities`, which is also where
   * the two Spider-Men get their alter egos so they can be told apart.
   */
  const heroes = $derived(heroIdentities(index));

  /**
   * Creates an empty deck and opens the editor on it.
   *
   * `local-<uuid>` is the id shape the sync contract reserves for a deck built
   * on a device rather than imported, so two devices that both build one never
   * collide and neither is mistaken for a MarvelCDB import.
   */
  /*
   * A hero, and nothing else. The aspect is not asked for: it is whatever
   * the cards say once they are chosen, which is how a deck is built at a
   * table and what lets the editor say "these two cards disagree" instead
   * of "this card is off-aspect" for a choice made before any card was.
   */
  async function createDeck(heroCode: string): Promise<void> {
    const hero = index.find((row) => row.code === heroCode);
    const id = `local-${crypto.randomUUID()}`;
    /*
     * The hero's own cards from the first second, as the phone does and as a
     * MarvelCDB decklist arrives. A deck that starts empty starts with a dozen
     * complaints about cards the person never chose to leave out.
     */
    let slots = '';
    if (hero !== undefined) {
      const packCards = await loadPackCards(cardLocale, hero.packCode).catch((): readonly Card[] => []);
      const heroCard = packCards.find((card) => card.code === heroCode);
      if (heroCard !== undefined) {
        slots = Object.entries(signatureSlots(heroCard, packCards))
          .map(([code, quantity]) => `${code}=${quantity}`)
          .join(',');
      }
    }
    await db.decks.put({
      id,
      marvelCdbId: 0,
      kind: 'LOCAL',
      url: '',
      name: hero?.name ?? heroCode,
      heroCode,
      heroName: hero?.name ?? heroCode,
      aspects: '',
      slots,
      ignoreDeckLimitSlots: '',
      descriptionMd: null,
      version: null,
      tags: null,
      rawJson: '',
      lastSyncedAt: Date.now(),
      locallyEdited: true,
    });
    building = null;
    onEdit(id);
    /*
     * A new deck, however it arrived.
     *
     * Built here or imported below: both are a deck the account did not have a
     * moment ago, and both are worth having on the phone before the next game.
     * Editing one is not on this list — see the note on the settings toggle.
     */
    syncAfter('deck-added');
  }

  /*
   * Each deck's hero, pictured. The shelf reads by face rather than by name,
   * which is how a shelf of real decks reads. Fetched through the card cache,
   * so ten decks of one hero cost one pack file; referenced from MarvelCDB,
   * never copied.
   */
  let heroImages = $state.raw<ReadonlyMap<string, string>>(new Map());
  $effect(() => {
    const codes = [...new Set(saved.decks.map((deck) => deck.heroCode))];
    let cancelled = false;
    void Promise.all(codes.map((code) => fetchCard(code).then((card) => [code, cardImageUrl(card?.imagesrc)] as const))).then((pairs) => {
      if (!cancelled) {
        heroImages = new Map(pairs.flatMap(([code, url]) => (url === null ? [] : [[code, url] as const])));
      }
    });
    return () => {
      cancelled = true;
    };
  });

  const sizeOf = (deck: SavedDeck): number => [...parseSlots(deck.slots).values()].reduce((a, b) => a + b, 0);

  /*
   * The folders, live, and the shelf sorted into them: each folder's decks
   * under its name, then everything else under no name at all.
   */
  let folders = $state.raw<readonly DeckFolder[]>([]);
  $effect(() => {
    if (!storageOk) {
      return;
    }
    const sub = liveQuery(() => db.deckFolders.toArray()).subscribe((rows) => {
      folders = rows;
    });
    return () => sub.unsubscribe();
  });
  const shelves = $derived.by(() => {
    const byId = new Map(saved.decks.map((deck) => [deck.id, deck] as const));
    const placed = new Set<string>();
    const named = inShelfOrder(folders).map((folder) => {
      const decks = folder.deckIds.flatMap((id) => {
        const deck = byId.get(id);
        if (deck === undefined || placed.has(id)) {
          return [];
        }
        placed.add(id);
        return [deck];
      });
      return { folder, decks };
    });
    const loose = saved.decks.filter((deck) => !placed.has(deck.id));
    return { named, loose };
  });

  /*
   * Folded folders: the heading stays, with its count, and the tiles go. A
   * shelf of forty decks in six folders reads as six lines this way. The
   * decks in no folder fold under their own key, which no folder id can be.
   */
  const LOOSE = '(none)';
  let folded = $state.raw<ReadonlySet<string>>(loadFoldedFolders());
  function toggleFolded(id: string): void {
    const next = new Set(folded);
    if (!next.delete(id)) {
      next.add(id);
    }
    folded = next;
    saveFoldedFolders(next);
  }
  const foldable = $derived([...folders.map((folder) => folder.id), ...(shelves.loose.length > 0 ? [LOOSE] : [])]);
  const allFolded = $derived(foldable.length > 0 && foldable.every((id) => folded.has(id)));
  function foldAll(fold: boolean): void {
    const next = new Set(fold ? [...folded, ...foldable] : [...folded].filter((id) => !foldable.includes(id)));
    folded = next;
    saveFoldedFolders(next);
  }

  let newFolderName = $state('');
  let renaming = $state<{ id: string; name: string } | null>(null);
  let removingFolder = $state<string | null>(null);

  async function addFolder(): Promise<void> {
    if (newFolderName.trim() === '') {
      return;
    }
    await createFolder(newFolderName);
    newFolderName = '';
  }

  /* The shelf's head: whose it is, and how much is on it. */
  const handle = $derived(session.account?.handle ?? null);
  const cardsHeld = $derived(saved.decks.reduce((n, deck) => n + sizeOf(deck), 0));

  const reference = $derived(parseDeckReference(input));

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
      onOpen(deck.id);
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

  /*
   * Asked once, on the tile, before a deck goes.
   *
   * A deck is an hour's work and the button sits next to Edit; the first
   * version deleted on the click and the only way back was a backup. Inline
   * rather than a dialog, as a game's deletion is on the history page: the
   * question replaces the buttons, and Cancel puts them back.
   */
  let removing = $state<string | null>(null);

  async function remove(id: string): Promise<void> {
    await db.decks.delete(id);
    removing = null;
  }
</script>

<section>
  <!--
    Whose shelf this is, the way the deck sites open theirs: a letter for a
    face, the handle, and the numbers. Signed out the shelf is the browser's
    own, and says so instead of pretending to a name.
  -->
  <header class="shelf-head">
    <span class="avatar" aria-hidden="true">{(handle ?? '?').slice(0, 1).toUpperCase()}</span>
    <div class="who">
      {#if handle !== null}<p class="muted small handle">@{handle}</p>{/if}
      <h1 class="comic-title">{handle === null ? t.decksOfThisBrowser : t.decksOf(handle)}</h1>
      <p class="muted small stats">
        <span>{t.decksCount(saved.decks.length)}</span>
        <span>{t.foldersCount(folders.length)}</span>
        <span>{t.cardsInDecks(cardsHeld)}</span>
      </p>
    </div>
  </header>

  {#if !storageOk}
    <div class="notice surface"><p>{t.storageUnavailable}</p></div>
  {:else}
    <div class="import surface">
      <h2>{t.deckNew}</h2>
      {#if building === null}
        <div class="new-ways">
          <button class="btn" type="button" onclick={() => (building = { heroCode: '' })}>
            {t.deckNew}
          </button>
          <button class="btn" type="button" onclick={() => onDraft(false)}>{t.deckDraft}</button>
          <button class="btn" type="button" onclick={() => onDraft(true)}>{t.deckSealed}</button>
        </div>
        <p class="muted note">{t.deckLimitedNote}</p>
      {:else}
        <div class="build-row">
          <label class="field-group grow">
            <span class="field-label">{t.deckPickHero}</span>
            <select
              class="field"
              value={building.heroCode}
              onchange={(e) => building !== null && (building.heroCode = e.currentTarget.value)}
            >
              <option value="">·</option>
              {#each heroes as hero (hero.code)}
                <option value={hero.code}>{hero.label}</option>
              {/each}
            </select>
          </label>
          <button
            class="btn btn--primary"
            type="button"
            disabled={building.heroCode === ''}
            onclick={() => building !== null && void createDeck(building.heroCode)}
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

    <div class="folder-bar">
      <form class="new-folder" onsubmit={(e) => { e.preventDefault(); void addFolder(); }}>
        <input class="field" type="text" placeholder={t.folderNamePlaceholder} aria-label={t.folderNew} value={newFolderName} oninput={(e) => (newFolderName = e.currentTarget.value)} />
        <button type="submit" class="btn" disabled={newFolderName.trim() === ''}>{t.folderNew}</button>
      </form>
      {#if folders.length > 0}
        <button type="button" class="btn btn--quiet small" onclick={() => foldAll(!allFolded)}>
          {allFolded ? t.foldersExpandAll : t.foldersCollapseAll}
        </button>
      {/if}
    </div>

    {#if saved.decks.length === 0 && folders.length === 0}
      <p class="muted empty">{t.noDecks}</p>
    {:else}
      {#snippet tile(deck: SavedDeck)}
          {@const verdict = verdicts.get(deck.id) ?? null}
          {@const aspects = aspectsOf(deck)}
          {@const art = heroImages.get(deck.heroCode)}
          <!--
            A tile per deck, the hero's art across the top and the name over
            it. Two clicks matter here -- open, and edit -- so the whole tile
            opens and the edit and remove buttons sit apart at the foot.
          -->
          <li class="tile">
            <button type="button" class="tile-head" onclick={() => onOpen(deck.id)}>
              {#if art !== undefined}
                <img class="art" src={art} alt="" loading="lazy" />
              {/if}
              <span class="shade" aria-hidden="true"></span>
              <span class="title">
                <span class="deck-name">{deck.name}</span>
                <span class="deck-sub">{deck.heroName}</span>
              </span>
            </button>
            <div class="foot">
              <span class="chips">
                {#each aspects as aspect (aspect)}
                  <span class="chip chip--aspect" data-faction={aspect}><span class="dot" aria-hidden="true"></span>{t.aspect(aspect)}</span>
                {/each}
                <span class="muted small">{t.cardCount(sizeOf(deck))}</span>
                {#if verdict !== null}
                  <span class="verdict" class:illegal={!verdict}>{verdict ? t.deckLegalShort : t.deckIllegalShort}</span>
                {:else if cardsLoading}
                  <span class="verdict muted">…</span>
                {/if}
              </span>
              <label class="folder-pick">
                <span class="visually-hidden">{t.folderLabel}</span>
                <select
                  class="field field--inline small"
                  value={folderOf(folders, deck.id)?.id ?? ''}
                  onchange={(e) => void moveDeck(deck.id, e.currentTarget.value === '' ? null : e.currentTarget.value)}
                >
                  <option value="">{t.folderNone}</option>
                  {#each inShelfOrder(folders) as folder (folder.id)}
                    <option value={folder.id}>{folder.name}</option>
                  {/each}
                </select>
              </label>
              {#if removing === deck.id}
                <span class="confirm">
                  <span class="muted small">{t.deckDeleteConfirm(deck.name)}</span>
                  <button type="button" class="btn btn--quiet danger" onclick={() => void remove(deck.id)}>{t.deckDeleteYes}</button>
                  <button type="button" class="btn btn--quiet" onclick={() => (removing = null)}>{t.cancel}</button>
                </span>
              {:else}
                <span class="tile-actions">
                  <button type="button" class="btn btn--quiet" onclick={() => onEdit(deck.id)}>{t.deckEdit}</button>
                  <button type="button" class="btn btn--quiet remove" onclick={() => (removing = deck.id)}>{t.removeDeck}</button>
                </span>
              {/if}
            </div>
          </li>
      {/snippet}

      <!--
        Folders first, each a heading with its decks under it, then the decks
        in none under no heading. A folder is renamed in place and deleted
        behind a question; its decks stay on the shelf either way.
      -->
      {#each shelves.named as { folder, decks } (folder.id)}
        <section class="folder">
          <header class="folder-head">
            {#if renaming?.id === folder.id}
              <form class="rename" onsubmit={(e) => { e.preventDefault(); if (renaming !== null) { void renameFolder(renaming.id, renaming.name); renaming = null; } }}>
                <input class="field" type="text" value={renaming.name} oninput={(e) => renaming !== null && (renaming.name = e.currentTarget.value)} aria-label={t.folderNamePlaceholder} />
                <button type="submit" class="btn btn--primary">{t.folderRename}</button>
                <button type="button" class="btn btn--quiet" onclick={() => (renaming = null)}>{t.cancel}</button>
              </form>
            {:else}
              <h2>
                <button type="button" class="fold" aria-expanded={!folded.has(folder.id)} onclick={() => toggleFolded(folder.id)}>
                  <span class="chevron" aria-hidden="true">▸</span>{folder.name} <span class="muted count">{decks.length}</span>
                </button>
              </h2>
              <span class="folder-actions">
                <button type="button" class="btn btn--quiet small" onclick={() => (renaming = { id: folder.id, name: folder.name })}>{t.folderRename}</button>
                {#if removingFolder === folder.id}
                  <span class="muted small">{t.folderDeleteConfirm(folder.name)}</span>
                  <button type="button" class="btn btn--quiet danger small" onclick={() => { void deleteFolder(folder.id); removingFolder = null; }}>{t.deckDeleteYes}</button>
                  <button type="button" class="btn btn--quiet small" onclick={() => (removingFolder = null)}>{t.cancel}</button>
                {:else}
                  <button type="button" class="btn btn--quiet danger small" onclick={() => (removingFolder = folder.id)}>{t.folderDelete}</button>
                {/if}
              </span>
            {/if}
          </header>
          {#if folded.has(folder.id)}
            <!-- Folded: the heading above is the whole folder. -->
          {:else if decks.length === 0}
            <p class="muted small empty">{t.noDecks}</p>
          {:else}
            <ul class="decks">
              {#each decks as deck (deck.id)}
                {@render tile(deck)}
              {/each}
            </ul>
          {/if}
        </section>
      {/each}

      {#if shelves.loose.length > 0}
        {#if shelves.named.length > 0}
          <h2 class="loose-head muted">
            <button type="button" class="fold" aria-expanded={!folded.has(LOOSE)} onclick={() => toggleFolded(LOOSE)}>
              <span class="chevron" aria-hidden="true">▸</span>{t.folderNone} <span class="count">{shelves.loose.length}</span>
            </button>
          </h2>
        {/if}
        {#if shelves.named.length === 0 || !folded.has(LOOSE)}
          <ul class="decks">
            {#each shelves.loose as deck (deck.id)}
              {@render tile(deck)}
            {/each}
          </ul>
        {/if}
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

  .shelf-head {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin: var(--space-2) 0 var(--space-5);
  }

  .avatar {
    flex: 0 0 auto;
    width: 3.5rem;
    height: 3.5rem;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: var(--text-xl);
    font-weight: var(--weight-bold);
  }

  .who {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .who h1 {
    margin: 0;
  }

  .handle,
  .stats {
    margin: 0;
  }

  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
  }

  .stats span + span::before {
    content: '·';
    margin-inline-end: var(--space-3);
  }

  .new-ways {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .folder-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin: var(--space-3) 0;
  }

  .new-folder {
    display: flex;
    gap: var(--space-2);
    flex: 1 1 18rem;
    max-width: 28rem;
  }

  /* The folder's name is the switch: the whole heading folds it. */
  .fold {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
    min-height: var(--tap-min);
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .chevron {
    display: inline-block;
    color: var(--text-muted);
    transition: transform var(--motion-fast) var(--ease-out);
  }

  .fold[aria-expanded='true'] .chevron {
    transform: rotate(90deg);
  }

  @media (prefers-reduced-motion: reduce) {
    .chevron {
      transition: none;
    }
  }

  .folder {
    margin: var(--space-4) 0;
  }

  .folder-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin-bottom: var(--space-2);
  }

  .folder-head h2,
  .loose-head {
    margin: 0;
    font-size: var(--text-lg);
  }

  .loose-head {
    margin: var(--space-4) 0 var(--space-2);
    font-weight: var(--weight-semibold);
  }

  .count {
    font-size: var(--text-sm);
    font-weight: normal;
  }

  .folder-actions {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }

  .rename {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }

  .rename .field {
    width: auto;
    flex: 1 1 12rem;
  }

  .folder-pick .field--inline {
    width: auto;
    display: inline-block;
    min-height: 2rem;
    padding-block: 0;
    font-size: var(--text-sm);
  }

  .danger {
    color: var(--danger);
  }

  .decks {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(18rem, 100%), 1fr));
    gap: var(--space-3);
  }

  .tile {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--surface-1);
    border: 1px solid var(--hairline);
    box-shadow: 0 1px 2px rgb(0 0 0 / 6%);
    transition: box-shadow 120ms ease, transform 120ms ease;
  }

  .tile:hover {
    box-shadow: 0 8px 20px rgb(0 0 0 / 14%);
  }

  /* The art as a banner, the name written over its darker foot. */
  .tile-head {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 16 / 7;
    padding: 0;
    border: 0;
    background: var(--surface-2);
    color: #fff;
    text-align: start;
    cursor: pointer;
    overflow: hidden;
  }

  /*
   * A portrait card, not a banner: the art is its upper half, framed by a
   * border and, on a hero, stat boxes down the left. Drawn larger than the
   * tile and placed so the frame falls outside it and the face sits in the
   * upper third, which is where the eye lands.
   */
  .art {
    position: absolute;
    left: -14%;
    top: -16%;
    width: 128%;
    height: 132%;
    object-fit: cover;
    object-position: 50% 16%;
    transition: transform 300ms ease;
  }

  .tile-head:hover .art {
    transform: scale(1.03);
  }

  .shade {
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, rgb(0 0 0 / 78%) 0%, rgb(0 0 0 / 30%) 55%, rgb(0 0 0 / 0%) 100%);
  }

  .title {
    position: absolute;
    inset-inline: var(--space-3);
    bottom: var(--space-3);
    display: grid;
    gap: 2px;
    text-shadow: 0 1px 2px rgb(0 0 0 / 60%);
  }

  .deck-name {
    font-size: var(--text-lg);
    font-weight: var(--weight-bold);
    line-height: var(--leading-snug);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deck-sub {
    font-size: var(--text-sm);
    opacity: 0.9;
  }

  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }

  .chips {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .chip--aspect {
    min-height: 1.6rem;
    padding-block: 0;
    font-size: var(--text-xs);
  }

  .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--faction-basic);
  }

  [data-faction='leadership'] .dot { background: var(--faction-leadership); }
  [data-faction='justice'] .dot { background: var(--faction-justice); }
  [data-faction='aggression'] .dot { background: var(--faction-aggression); }
  [data-faction='protection'] .dot { background: var(--faction-protection); }
  [data-faction='pool'] .dot { background: var(--faction-pool); }

  .tile-actions {
    display: inline-flex;
    gap: var(--space-1);
  }

  .confirm {
    flex: 1 0 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .danger {
    color: var(--danger);
  }

  .remove {
    font-size: var(--text-xs);
  }

  .empty {
    margin: var(--space-4) 0;
  }

  .error {
    color: var(--danger);
    font-weight: 600;
    margin-bottom: 0;
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
