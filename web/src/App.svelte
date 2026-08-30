<script lang="ts">
  import TopBar from './components/TopBar.svelte';
  import SearchControls from './components/SearchControls.svelte';
  import CardRow from './components/CardRow.svelte';
  import CardDetail from './components/CardDetail.svelte';

  import type { Card, DataMeta, IndexRow, Locale, Pack } from './lib/types';
  import { strings } from './lib/i18n';
  import { loadCard, loadIndex, loadMeta, loadPacks } from './lib/data';
  import { NO_FILTERS, searchCards, type Filters } from './lib/search';
  import { pathForRoute, routeFromPath, type Route } from './lib/router';
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
  let meta = $state<DataMeta | null>(null);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  let card = $state<Card | null>(null);
  let cardLoading = $state(false);

  const t = $derived(strings(uiLocale));

  const packNames = $derived(
    new Map(packs.map((pack) => [pack.code, pack.name] as const)),
  );

  const results = $derived(
    searchCards(index, { query, filters, limit: RESULT_LIMIT }),
  );

  /** Keeps the document attribute in step with the choice, including at startup. */
  $effect(() => {
    applyTheme(theme);
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

    Promise.all([loadIndex(locale), loadPacks(locale), loadMeta()])
      .then(([loadedIndex, loadedPacks, loadedMeta]) => {
        if (cancelled) {
          return;
        }
        index = loadedIndex;
        packs = loadedPacks;
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

<TopBar
  {t}
  {uiLocale}
  {cardLocale}
  {theme}
  onUiLocale={setUiLocale}
  onCardLocale={setCardLocale}
  onTheme={setTheme}
  onHome={() => navigate({ name: 'search' })}
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
      <CardDetail {card} {cardLocale} {t} />
    {/if}
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

<footer class="page">
  <p class="muted">
    {t.dataFrom}
    <a href="https://marvelcdb.com" target="_blank" rel="noopener">MarvelCDB</a>{#if meta !== null}
      · {t.dataUpdated}
      {new Date(meta.fetchedAt).toLocaleDateString(uiLocale)}{/if}
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
    background: var(--md-primary);
    color: var(--md-on-primary);
    cursor: pointer;
  }

  .detail-text {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
    word-break: break-word;
  }

  .count {
    font-size: 0.85rem;
    margin: 0 0 var(--space-3);
  }

  .results {
    display: grid;
    gap: var(--space-2);
    padding: 0;
    margin: 0;
  }

  .back-link {
    margin: var(--space-4) 0;
  }

  footer {
    border-top: 1px solid var(--md-outline-variant, var(--md-outline));
    padding-top: var(--space-4);
    margin-top: var(--space-6);
    font-size: 0.85rem;
  }

  .legal {
    max-width: 46rem;
  }
</style>
