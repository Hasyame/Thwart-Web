<script lang="ts">
  import TopBar from './components/TopBar.svelte';
  import SearchControls from './components/SearchControls.svelte';
  import CardRow from './components/CardRow.svelte';
  import CardDetail from './components/CardDetail.svelte';
  import CollectionPage from './components/CollectionPage.svelte';
  import RandomizerPage from './components/RandomizerPage.svelte';
  import DecksPage from './components/DecksPage.svelte';
  import PlayPage from './components/PlayPage.svelte';
  import StatsPage from './components/StatsPage.svelte';
  import CampaignsPage from './components/CampaignsPage.svelte';
  import CardWindow from './components/CardWindow.svelte';
  import AccountPage from './components/AccountPage.svelte';
  import type { FormMode } from './components/SignInForm.svelte';
  import AccountMenu from './components/AccountMenu.svelte';
  import BottomNav from './components/BottomNav.svelte';
  import MoreSheet from './components/MoreSheet.svelte';
  import RulesPage from './components/RulesPage.svelte';

  import type { Card, CardSet, DataMeta, IndexRow, Locale, Pack } from './lib/types';
  import { strings } from './lib/i18n';
  import { loadCard, loadIndex, loadMeta, loadPacks, loadSets } from './lib/data';
  import { db, storageAvailable, toggleFavourite } from './lib/db';
  import { liveQuery } from 'dexie';
  import { NO_FILTERS, searchCards, type Filters } from './lib/search';
  import { pathForRoute, routeFromPath, type Route } from './lib/router';
  import { configureCardViewer } from './lib/cardViewer.svelte';
  import { loadSession, session } from './lib/sync/session.svelte';
  import {
    applyTheme,
    loadCardLocale,
    loadTheme,
    loadUiLocale,
    saveCardLocale,
    saveTheme,
    saveUiLocale,
    type ThemeChoice,
  } from './lib/preferences';

  /** How many results to draw. Four thousand rows in the DOM helps nobody. */
  const RESULT_LIMIT = 200;

  const BASE = import.meta.env.BASE_URL;

  let uiLocale = $state<Locale>(loadUiLocale());
  let cardLocale = $state<Locale>(loadCardLocale(loadUiLocale()));
  let theme = $state<ThemeChoice>(loadTheme());

  let route = $state<Route>(routeFromPath(window.location.pathname, BASE));
  let query = $state('');
  let filters = $state<Filters>(NO_FILTERS);

  let index = $state<readonly IndexRow[]>([]);
  let packs = $state<readonly Pack[]>([]);
  let sets = $state<readonly CardSet[]>([]);
  let meta = $state<DataMeta | null>(null);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  let card = $state<Card | null>(null);
  let cardLoading = $state(false);

  /**
   * Whether the browser will let us store anything.
   *
   * Asked once. The card browser needs no storage at all, so a private window
   * with IndexedDB blocked still gets a working site — it just cannot keep a
   * collection, and the collection screen says so rather than failing.
   */
  let storageOk = $state(false);
  const favourites = $state<{ value: Set<string> }>({ value: new Set() });

  $effect(() => {
    let cancelled = false;
    storageAvailable().then((ok) => {
      if (!cancelled) {
        storageOk = ok;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    if (!storageOk) {
      return;
    }
    const subscription = liveQuery(() => db.favouriteCards.toArray()).subscribe(
      (rows) => {
        favourites.value = new Set(rows.map((row) => row.cardCode));
      },
    );
    return () => subscription.unsubscribe();
  });

  const t = $derived(strings(uiLocale));

  const packNames = $derived(
    new Map(packs.map((pack) => [pack.code, pack.name] as const)),
  );

  const results = $derived(
    searchCards(index, { query, filters, limit: RESULT_LIMIT }),
  );

  /**
   * The More sheet, which holds the settings and — on a phone — the
   * destinations the tab bar has no room for.
   *
   * One sheet with two ways in: the tab bar's More, and the top bar's gear.
   * Two sheets saying nearly the same thing would be two things to keep in
   * step for no reader benefit.
   */
  let sheetOpen = $state(false);

  /** The account menu, which drops out of the button in the top bar. */
  let accountOpen = $state(false);
  /**
   * Which tab the account page opens on.
   *
   * Set by the top-bar menu, whose "create an account" and "lost your
   * password" links would otherwise land on the sign-in tab and make somebody
   * click the same words twice.
   */
  let accountMode = $state<FormMode>('signin');

  /**
   * Whether the sheet needs to list destinations as well as settings.
   *
   * Matched to the breakpoint the tab bar and the top bar use, because it is
   * the same question: below it the tab bar is showing four of eight, above it
   * the top bar is showing all eight.
   */
  let narrow = $state(false);

  $effect(() => {
    const query = window.matchMedia('(max-width: 55.999rem)');
    const sync = (): void => {
      narrow = query.matches;
    };
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  });

  // Who is signed in, read once. Nothing syncs yet; this only decides what the
  // account screen and the settings sheet show.
  $effect(() => {
    void loadSession();
  });

  /** Keeps the document attribute in step with the choice, including at startup. */
  $effect(() => {
    applyTheme(theme);
  });

  /*
   * The document's language, which index.html can only guess at.
   *
   * WCAG 2.2 SC 3.1.1 asks for it, and a screen reader honours it: left at the
   * static "en" a French interface was read aloud with an English voice, which
   * makes it close to unusable rather than merely wrong.
   */
  $effect(() => {
    document.documentElement.lang = uiLocale;
  });

  /**
   * Loads the index and pack list for the current card language.
   *
   * Re-runs whenever the card language changes, which is what makes the
   * language switch a real switch rather than a relabelling: French cards come
   * from a different host and are a different dataset.
   */
  $effect(() => {
    const locale = cardLocale;
    let cancelled = false;

    loading = true;
    loadError = null;

    Promise.all([loadIndex(locale), loadPacks(locale), loadSets(locale), loadMeta()])
      .then(([loadedIndex, loadedPacks, loadedSets, loadedMeta]) => {
        if (cancelled) {
          return;
        }
        index = loadedIndex;
        packs = loadedPacks;
        sets = loadedSets;
        meta = loadedMeta;
        loading = false;
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        loadError = error instanceof Error ? error.message : String(error);
        loading = false;
      });

    return () => {
      cancelled = true;
    };
  });

  /** Fetches the open card's full record, once the index can locate its pack. */
  $effect(() => {
    const current = route;
    const locale = cardLocale;
    const rows = index;

    if (current.name !== 'card' || rows.length === 0) {
      card = null;
      cardLoading = false;
      return;
    }

    let cancelled = false;
    cardLoading = true;

    loadCard(locale, current.code, rows)
      .then((loaded) => {
        if (!cancelled) {
          card = loaded;
          cardLoading = false;
        }
      })
      .catch(() => {
        if (!cancelled) {
          card = null;
          cardLoading = false;
        }
      });

    return () => {
      cancelled = true;
    };
  });

  function navigate(next: Route): void {
    route = next;
    window.history.pushState({}, '', pathForRoute(next, BASE));
    window.scrollTo({ top: 0 });
  }

  function onPopState(): void {
    route = routeFromPath(window.location.pathname, BASE);
  }

  function setUiLocale(locale: Locale): void {
    uiLocale = locale;
    saveUiLocale(locale);
  }

  $effect(() => {
    configureCardViewer(index, cardLocale);
  });

  function setCardLocale(locale: Locale): void {
    cardLocale = locale;
    saveCardLocale(locale);
  }

  function setTheme(next: ThemeChoice): void {
    theme = next;
    saveTheme(next);
  }

  function retry(): void {
    // Reassigning to the same value would not restart the effect, so nudge
    // through the other language and back. Cheap, and avoids a reload.
    const current = cardLocale;
    cardLocale = current === 'en' ? 'fr' : 'en';
    cardLocale = current;
  }
</script>

<svelte:window onpopstate={onPopState} />

<!--
  A card opened over the page you are on, rather than navigated to.

  A campaign setup step names a dozen cards; following one by leaving the page
  means losing your place in a list somebody is reading with cards in their
  other hand.
-->
<CardWindow
  {t}
  {cardLocale}
  canFavourite={storageOk}
  isFavourite={(code) => favourites.value.has(code)}
  onToggleFavourite={(code) => void toggleFavourite(code)}
/>

<TopBar
  {t}
  onHome={() => navigate({ name: 'search' })}
  onNavigate={(name) => navigate({ name })}
  hrefFor={(name) => pathForRoute({ name }, BASE)}
  active={route.name}
  onSettings={() => (sheetOpen = true)}
  onAccount={() => (accountOpen = true)}
  accountHandle={session.account?.handle ?? null}
/>

<AccountMenu
  {t}
  {uiLocale}
  open={accountOpen}
  onClose={() => (accountOpen = false)}
  onAccount={(mode) => {
    accountMode = mode ?? 'signin';
    navigate({ name: 'account' });
  }}
/>

<main class="page">
  {#if loading}
    <p class="notice muted">{t.loading}</p>
  {:else if loadError !== null}
    <div class="notice surface">
      <p>{t.loadError}</p>
      <p class="muted detail-text">{loadError}</p>
      <button type="button" onclick={retry}>{t.retry}</button>
    </div>
  {:else if route.name === 'card'}
    <p class="back-link">
      <a
        href={pathForRoute({ name: 'search' }, BASE)}
        onclick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return;
          }
          event.preventDefault();
          navigate({ name: 'search' });
        }}
      >
        ← {t.back}
      </a>
    </p>

    {#if cardLoading}
      <p class="notice muted">{t.loading}</p>
    {:else if card === null}
      <p class="notice muted">{t.cardNotFound}</p>
    {:else}
      <!-- Bound to a const so the callback keeps the narrowing: `card` is
           reassignable state, so a closure over it is not known to be non-null
           even where the branch has just proved it is. -->
      {@const openCard = card}
      <CardDetail
        card={openCard}
        {cardLocale}
        {t}
        canFavourite={storageOk}
        isFavourite={favourites.value.has(openCard.code)}
        onToggleFavourite={() => void toggleFavourite(openCard.code)}
      />
    {/if}
  {:else if route.name === 'collection'}
    <CollectionPage {t} {packs} {sets} {storageOk} />
  {:else if route.name === 'randomizer'}
    <RandomizerPage {t} {sets} {index} {storageOk} />
  {:else if route.name === 'play'}
    <PlayPage {t} {sets} {index} {cardLocale} {storageOk} />
  {:else if route.name === 'stats'}
    <StatsPage {t} {uiLocale} {index} {storageOk} />
  {:else if route.name === 'campaigns'}
    <CampaignsPage {t} {uiLocale} {cardLocale} {index} {sets} {storageOk} />
  {:else if route.name === 'account'}
    <AccountPage {t} {uiLocale} {storageOk} initialMode={accountMode} />
  {:else if route.name === 'rules'}
    <RulesPage {t} {cardLocale} />
  {:else if route.name === 'decks'}
    <DecksPage
      {t}
      {index}
      {packs}
      {cardLocale}
      {storageOk}
      openCard={(code) => navigate({ name: 'card', code })}
      cardHref={(code) => pathForRoute({ name: 'card', code }, BASE)}
    />
  {:else}
    <SearchControls
      {t}
      {query}
      {filters}
      {index}
      {packs}
      onQuery={(next) => (query = next)}
      onFilters={(next) => (filters = next)}
    />

    <p class="count muted" aria-live="polite">
      {t.resultCount(results.rows.length, results.total)}
    </p>

    {#if results.total === 0}
      <div class="notice surface">
        <p>{t.noResults}</p>
        <p class="muted">{t.noResultsHint}</p>
      </div>
    {:else}
      <ul class="results">
        {#each results.rows as row (row.code)}
          <CardRow
            {row}
            {t}
            packName={packNames.get(row.packCode)}
            href={pathForRoute({ name: 'card', code: row.code }, BASE)}
            onOpen={(code) => navigate({ name: 'card', code })}
          />
        {/each}
      </ul>
    {/if}
  {/if}
</main>

<BottomNav
  {t}
  active={route.name}
  onNavigate={(name) => navigate({ name })}
  hrefFor={(name) => pathForRoute({ name }, BASE)}
  onMore={() => (sheetOpen = true)}
  moreOpen={sheetOpen}
/>

<MoreSheet
  {t}
  {uiLocale}
  {cardLocale}
  {theme}
  open={sheetOpen}
  active={route.name}
  showDestinations={narrow}
  onUiLocale={setUiLocale}
  onCardLocale={setCardLocale}
  onTheme={setTheme}
  onNavigate={(name) => navigate({ name })}
  hrefFor={(name) => pathForRoute({ name }, BASE)}
  onAccount={() => navigate({ name: 'account' })}
  accountHandle={session.account?.handle ?? null}
  onClose={() => (sheetOpen = false)}
/>

<footer class="page">
  <p class="muted">
    {t.dataFrom}
    <a href="https://marvelcdb.com" target="_blank" rel="noopener">MarvelCDB</a>
    {#if meta !== null}
      <!-- The separator carries its own spaces: putting them in the markup
           lets the block boundary swallow them. -->
      {' · '}{t.dataUpdated}
      {new Date(meta.fetchedAt).toLocaleDateString(uiLocale)}
    {/if}
  </p>
  <p class="muted legal">{t.legal}</p>
</footer>

<style>
  main {
    min-height: 60vh;
  }

  .notice {
    padding: var(--space-4);
    margin: var(--space-5) 0;
  }

  .notice button {
    margin-top: var(--space-3);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-lg);
    border: 0;
    background: var(--accent);
    color: var(--accent-ink);
    cursor: pointer;
  }

  .detail-text {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: var(--text-sm);
    word-break: break-word;
  }

  .count {
    font-size: var(--text-sm);
    margin: 0 0 var(--space-3);
  }

  /*
   * Columns as the window allows: one on a phone, more on a desktop. The
   * minimum is set by the longest thing a row must show without truncating
   * awkwardly — a card name over its type, faction and pack.
   */
  .results {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(26rem, 100%), 1fr));
    gap: var(--space-2);
    padding: 0;
    margin: 0;
  }

  .back-link {
    margin: var(--space-4) 0;
  }

  footer {
    border-top: 1px solid var(--hairline);
    padding-top: var(--space-4);
    margin-top: var(--space-6);
    font-size: var(--text-sm);
  }

  .legal {
    max-width: var(--prose-max);
  }
</style>
