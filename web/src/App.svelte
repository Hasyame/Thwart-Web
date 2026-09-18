<script lang="ts">
  import TopBar from './components/TopBar.svelte';
  import SearchControls from './components/SearchControls.svelte';
  import CardRow from './components/CardRow.svelte';
  import CardDetail from './components/CardDetail.svelte';
  import CardWindow from './components/CardWindow.svelte';
  import CardPeek from './components/CardPeek.svelte';
  import type { FormMode } from './components/SignInForm.svelte';
  import AccountMenu from './components/AccountMenu.svelte';
  import BottomNav from './components/BottomNav.svelte';
  import MoreSheet from './components/MoreSheet.svelte';
  import { lazy, warm } from './lib/lazy';

  /*
   * Every page but the card search is its own chunk, fetched when first
   * opened: the shell and the search are what a first visit needs, and the
   * campaign engine or the deck editor should not stand between a visitor
   * and the first card. lib/lazy has the reasons and the offline story.
   */
  const CollectionPage = lazy(() => import('./components/CollectionPage.svelte'));
  const RandomizerPage = lazy(() => import('./components/RandomizerPage.svelte'));
  const VersusPage = lazy(() => import('./components/VersusPage.svelte'));
  const DecksPage = lazy(() => import('./components/DecksPage.svelte'));
  const DraftPage = lazy(() => import('./components/DraftPage.svelte'));
  const DeckPage = lazy(() => import('./components/DeckPage.svelte'));
  const AchievementsPage = lazy(() => import('./components/AchievementsPage.svelte'));
  const PlayPage = lazy(() => import('./components/PlayPage.svelte'));
  const StatsPage = lazy(() => import('./components/StatsPage.svelte'));
  const CampaignsPage = lazy(() => import('./components/CampaignsPage.svelte'));
  const AccountPage = lazy(() => import('./components/AccountPage.svelte'));
  const BggPage = lazy(() => import('./components/BggPage.svelte'));
  const VerifyPage = lazy(() => import('./components/VerifyPage.svelte'));
  const HistoryPage = lazy(() => import('./components/HistoryPage.svelte'));
  const RulesPage = lazy(() => import('./components/RulesPage.svelte'));

  import type { Card, CardSet, DataMeta, IndexRow, Locale, Pack } from './lib/types';
  import { loadStrings, warmStrings, type Strings } from './lib/i18n';
  import { loadCard, loadIndex, loadMeta, loadPacks, loadSets } from './lib/data';
  import { db, storageAvailable, toggleFavourite as writeFavourite } from './lib/db';
  import { liveQuery } from 'dexie';
  import { activeFilterCount, NO_FILTERS, searchCards, type Filters } from './lib/search';
  import { pathForRoute, routeFromPath, type Route } from './lib/router';
  import { applyHead, headFor } from './lib/head';
  import { configureCardViewer } from './lib/cardViewer.svelte';
  import HomePage from './components/HomePage.svelte';
  import { watchOwnedPacks } from './lib/ownedCopies.svelte';
  import { watchAchievements } from './lib/achievements/store.svelte';
  import { loadSession, session } from './lib/sync/session.svelte';
  import { loadSyncState } from './lib/sync/sync.svelte';
  import { syncAfter, watchAutoSync, watchWrites } from './lib/sync/auto.svelte';
  import { SYNCED_TABLES } from './lib/sync/ports';
  import { watchLive } from './lib/sync/live.svelte';
  import { watchSafeArea } from './lib/safeArea';
  import PlayHub from './components/PlayHub.svelte';
  import { replayOf } from './lib/replay';
  import type { Draw } from './lib/randomizer';
  import { campaignLayoutOf, subjectsOfPlay, type CampaignLayout, type RatingSubject } from './lib/ratings';
  import { eventsOf } from './lib/campaign/store';
  import { inCampaign, runOf } from './lib/playQuery';
  import { prepareSession, setupNotice } from './lib/session.svelte';
  import type { Play } from './lib/records';
  import { watchStoredOnServer } from './lib/sync/stored.svelte';
  import { watchAppSettings } from './lib/appsettings.svelte';
  import type { NavTarget } from './lib/nav';
  import {
    applyTheme,
    loadCardLocale,
    loadGroupedPlay,
    loadTheme,
    loadUiLocale,
    saveCardLocale,
    saveGroupedPlay,
    saveTheme,
    saveUiLocale,
    type ThemeChoice,
  } from './lib/preferences';

  /** How many results to draw. Four thousand rows in the DOM helps nobody. */
  /*
   * Rows shown at once. Sixty, then sixty more on request: two hundred rows
   * of cards was the largest single piece of work between a phone and its
   * first paint, and nobody reads two hundred rows before typing. The count
   * goes back to the first page whenever the search changes.
   */
  const RESULT_PAGE = 60;
  let resultLimit = $state(RESULT_PAGE);

  const BASE = import.meta.env.BASE_URL;

  /**
   * The strings for the interface language, handed in by main.ts, which
   * fetched them before mounting so the first frame is already in the right
   * language. Switching fetches the other language's chunk and swaps.
   */
  interface Props {
    initialStrings: Strings;
  }

  const { initialStrings }: Props = $props();

  let uiLocale = $state<Locale>(loadUiLocale());
  // Deliberately the initial value: the prop is the words at mount, and from
  // then on `t` is swapped by setUiLocale rather than re-read from the prop.
  // svelte-ignore state_referenced_locally
  let t = $state.raw<Strings>(initialStrings);
  let cardLocale = $state<Locale>(loadCardLocale(loadUiLocale()));
  let theme = $state<ThemeChoice>(loadTheme());
  let grouped = $state<boolean>(loadGroupedPlay());

  let route = $state<Route>(
    routeFromPath(window.location.pathname, BASE, window.location.search),
  );
  let query = $state('');
  let filters = $state<Filters>(NO_FILTERS);

  let index = $state<readonly IndexRow[]>([]);
  let packs = $state<readonly Pack[]>([]);
  let sets = $state<readonly CardSet[]>([]);
  /** Set names by code, in the card language, for anything that shows a set. */
  const setNames = $derived(new Map(sets.map((s) => [s.code, s.name] as const)));
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

  /*
   * The packs the collection says are owned, for the owned-only filter.
   *
   * A quantity of zero is a pack somebody has recorded and does not have —
   * the collection stores a count rather than a tick precisely so a second
   * core set can be said — so it is not owned.
   */
  const ownedPacks = $state<{ value: ReadonlySet<string> }>({ value: new Set() });

  /*
   * Versus belongs to the boxes that print two main-scheme sets, and is hidden
   * for anybody who owns none of them — the master app hides it on the same
   * rule, and a menu entry that leads to an apology is worse than no entry.
   */
  const hiddenDestinations = $derived.by(() => {
    const versusPacks = new Set(
      sets.filter((set) => set.type === 'main_scheme').map((set) => set.packCode),
    );
    const anyOwned = [...versusPacks].some((code) => ownedPacks.value.has(code));
    return new Set<NavTarget>(anyOwned ? [] : ['versus']);
  });

  // The preferences the account carries, watched for the life of the app so a
  // sync that brings new ones in is reflected without a reload.
  $effect(() => (storageOk ? watchAppSettings() : undefined));
  $effect(() => (storageOk ? watchOwnedPacks() : undefined));
  // The achievements follow the history live, once the card index is here.
  $effect(() => (storageOk && index.length > 0 ? watchAchievements(index) : undefined));

  $effect(() => {
    if (!storageOk) {
      return;
    }
    const subscription = liveQuery(() => db.ownedPacks.toArray()).subscribe((rows) => {
      ownedPacks.value = new Set(
        rows.filter((row) => row.quantity > 0).map((row) => row.packCode),
      );
    });
    return () => subscription.unsubscribe();
  });

  const packNames = $derived(
    new Map(packs.map((pack) => [pack.code, pack.name] as const)),
  );

  const results = $derived(
    searchCards(index, {
      query,
      filters,
      limit: resultLimit,
      collection: { ownedPacks: ownedPacks.value, favourites: favourites.value },
    }),
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

  // Who is signed in, and whether this browser has adopted the account, read
  // once. The second was not read at all until 12 September 2026: auto-sync
  // asks it before every push, so after any reload the browser believed it
  // had never adopted and stayed silent until somebody opened the account
  // page. Every "the sync only works when I press the button" was this.
  $effect(() => {
    void loadSession();
    void loadSyncState();
  });

  /*
   * Auto-sync, if this browser has been asked to.
   *
   * The listener here is only the one that notices the network coming back: a
   * game recorded on a train stays owed until then. Everything else fires from
   * the moment it belongs to.
   */
  $effect(() => watchAutoSync());
  // Every write to a synced table asks for a sync; see auto.svelte.ts.
  $effect(() => watchWrites(SYNCED_TABLES()));

  /*
   * How much room the system bar at the bottom really needs.
   *
   * Android reports a bottom inset for a navigation bar it has already kept
   * outside the page, so padding for it pads twice. This measures whether that
   * is happening and, only when it is, sets --safe-bottom to zero.
   */
  $effect(() => watchSafeArea());

  /*
   * The live channel, re-opened whenever the account changes.
   *
   * Reading `session.account` inside the effect is what makes signing in open a
   * connection and signing out close one, without either path having to know
   * this exists.
   */
  $effect(() => {
    void session.account?.token;
    return watchLive();
  });

  /*
   * Which rows the server has, for the badges on games and campaigns.
   *
   * Only meaningful while signed in, but the subscription is cheap and always
   * on so the answer is already there when somebody signs in rather than a
   * frame later.
   */
  $effect(() => (storageOk ? watchStoredOnServer() : undefined));

  /**
   * Favourites, with a sync asked for after.
   *
   * Wrapped here rather than in `toggleFavourite` itself, because the same
   * helper is what a backup import writes through, and a restore of two hundred
   * favourites should be one sync at the end rather than two hundred triggers.
   */
  async function toggleFavourite(code: string): Promise<void> {
    await writeFavourite(code);
    syncAfter('favourite-changed');
  }

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
    route = routeFromPath(window.location.pathname, BASE, window.location.search);
  }

  /*
   * A search link that carries its words — /cards?q=rhino, which is what a
   * search engine's sitelinks box sends — opens the search on them. Only on
   * arrival: typing afterwards does not rewrite the address on every key.
   */
  $effect(() => {
    if (route.name === 'search' && route.query !== undefined) {
      query = route.query;
      resultLimit = RESULT_PAGE;
    }
  });

  function setUiLocale(locale: Locale): void {
    saveUiLocale(locale);
    // The words first, then the language: a frame in the new language with
    // the old words would read as a mistake.
    void loadStrings(locale).then((next) => {
      t = next;
      uiLocale = locale;
    });
  }

  $effect(() => {
    warmStrings(uiLocale);
  });

  /*
   * The document's title, description and canonical, per page and in the
   * interface language — set on every navigation, since a single page has
   * one index.html and a search engine files each address under what the
   * DOM says once rendered. lib/head has the mapping and the reasons.
   */
  $effect(() => {
    applyHead(
      headFor(route, t, (r) => pathForRoute(r, BASE), route.name === 'card' ? (card?.name ?? null) : null),
      uiLocale,
    );
  });

  $effect(() => {
    configureCardViewer(index, cardLocale, packs);
  });

  // Once the shell is up, the rest in idle time, so a tap a few seconds in
  // finds its page already here.
  $effect(() => {
    if (loading) {
      return;
    }
    warm([PlayPage, CampaignsPage, DecksPage, DeckPage, DraftPage, CollectionPage, RandomizerPage,
      HistoryPage, StatsPage, VersusPage, RulesPage, AccountPage, BggPage, VerifyPage]);
  });

  function setCardLocale(locale: Locale): void {
    cardLocale = locale;
    saveCardLocale(locale);
  }

  function setTheme(next: ThemeChoice): void {
    theme = next;
    saveTheme(next);
  }

  /*
   * Both languages' set lists, not just the current one: the modular sets of
   * an older game are read back out of the notes by *name*, in whatever card
   * language was current then.
   */
  const setsInBothLanguages = async (): Promise<readonly CardSet[]> =>
    (await Promise.all([loadSets('en'), loadSets('fr')])).flat();

  /**
   * What a game can be rated on.
   *
   * A campaign's scenario is recorded under the campaign's own id, not a card
   * set, so the run's template says what was on the table. Null layout when
   * the run is gone; the rating falls back to what the play itself says.
   */
  async function ratingSubjectsOf(play: Play): Promise<readonly RatingSubject[]> {
    const both = await setsInBothLanguages();
    let layout: CampaignLayout | null = null;
    if (inCampaign(play) && storageOk) {
      const runId = runOf(play);
      const run = runId === null || runId === '' ? undefined : await db.campaignRuns.get(runId);
      if (run !== undefined) {
        layout = campaignLayoutOf(play, run, await eventsOf(run.id), index, both);
      }
    }
    return subjectsOfPlay(play, both, layout);
  }

  /*
   * Playing a game again.
   *
   * Reads the saved decks here rather than in the history page, because it is
   * the one thing the conversion needs that the history has no other reason to
   * hold. The result lands on the setup screen, not in a running game: the
   * person may want to swap a seat, and the modular sets may need choosing.
   *
   * Never a campaign's scenario. The button is not offered on one — a
   * campaign's scenario is played again from its own campaign — and this
   * guard keeps the rule even if some path forgets.
   */
  async function replay(play: Play): Promise<void> {
    if (inCampaign(play)) {
      return;
    }
    const decks = storageOk ? await db.decks.toArray() : [];
    const prepared = replayOf(play, decks, await setsInBothLanguages());
    prepareSession(prepared.session);
    setupNotice.text = prepared.modularSetsUnknown ? t.playAgainModularNote : null;
    navigate({ name: 'play' });
  }

  /*
   * A draw, laid out on the setup screen.
   *
   * The phone's "play this game", and the same door a replayed game goes
   * through. Mandated and drawn sets go together into one list: what is on
   * the table is what gets recorded, and the play does not care why a set was
   * there. Seats carry the hero alone, as a paused game's do, since a draw
   * names heroes and not decks.
   */
  function playDraw(draw: Draw, scenarioName: string): void {
    if (draw.scenarioCode === null) {
      return;
    }
    prepareSession({
      scenarioCode: draw.scenarioCode,
      scenarioName: scenarioName === '' ? draw.scenarioCode : scenarioName,
      difficulty: draw.difficulty ?? 'STANDARD_I',
      standardSet: draw.standardSet,
      seats: draw.heroes.map((hero) => ({
        deckId: hero.code,
        deckName: hero.name,
        heroCode: hero.code,
        heroName: hero.name,
        aspect: hero.aspect,
      })),
      modularSetCodes: [...draw.mandatoryModularCodes, ...draw.modularSetCodes],
    });
    setupNotice.text = null;
    navigate({ name: 'play' });
  }

  /*
   * Grouping the ways of playing behind one tab.
   *
   * Turning it off while sitting on the hub would leave somebody on a page
   * with no tab and no way back to it, so that case walks them to the screen
   * the hub is mostly a door to.
   */
  function setGrouped(next: boolean): void {
    grouped = next;
    saveGroupedPlay(next);
    if (!next && route.name === 'hub') {
      navigate({ name: 'play' });
    }
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

<!-- The card under the pointer, on devices that have one. One layer for
     every list that names a card; see lib/cardPeek. -->
<CardPeek {t} />

<TopBar
  {t}
  onHome={() => navigate({ name: 'home' })}
  onNavigate={(name) => navigate({ name })}
  hrefFor={(name) => pathForRoute({ name }, BASE)}
  active={route.name}
  onSettings={() => (sheetOpen = true)}
  onAccount={() => (accountOpen = true)}
  accountHandle={session.account?.handle ?? null}
  hidden={hiddenDestinations}
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
    {#await CollectionPage()}
      <p class="notice muted">{t.loading}</p>
    {:then { default: Page }}
      <Page {t} {packs} {sets} {storageOk} />
    {:catch}
      <!-- The chunk did not arrive: a connection that dropped, or a tab
           open across a release whose files it was built against are
           gone. A reload fetches the current build. -->
      <div class="notice surface">
        <p>{t.pageLoadError}</p>
        <button type="button" class="btn" onclick={() => location.reload()}>{t.retry}</button>
      </div>
    {/await}
  {:else if route.name === 'randomizer'}
    {#await RandomizerPage()}
      <p class="notice muted">{t.loading}</p>
    {:then { default: Page }}
      <Page {t} {sets} {index} {cardLocale} {storageOk} onPlay={playDraw} />
    {:catch}
      <!-- The chunk did not arrive: a connection that dropped, or a tab
           open across a release whose files it was built against are
           gone. A reload fetches the current build. -->
      <div class="notice surface">
        <p>{t.pageLoadError}</p>
        <button type="button" class="btn" onclick={() => location.reload()}>{t.retry}</button>
      </div>
    {/await}
  {:else if route.name === 'versus'}
    {#await VersusPage()}
      <p class="notice muted">{t.loading}</p>
    {:then { default: Page }}
      <Page {t} {cardLocale} {sets} {packs} {index} ownedPacks={ownedPacks.value} />
    {:catch}
      <!-- The chunk did not arrive: a connection that dropped, or a tab
           open across a release whose files it was built against are
           gone. A reload fetches the current build. -->
      <div class="notice surface">
        <p>{t.pageLoadError}</p>
        <button type="button" class="btn" onclick={() => location.reload()}>{t.retry}</button>
      </div>
    {/await}
  {:else if route.name === 'play'}
    {#await PlayPage()}
      <p class="notice muted">{t.loading}</p>
    {:then { default: Page }}
      <Page {t} {sets} {index} {uiLocale} {cardLocale} {storageOk} onReplay={(play) => void replay(play)} />
    {:catch}
      <!-- The chunk did not arrive: a connection that dropped, or a tab
           open across a release whose files it was built against are
           gone. A reload fetches the current build. -->
      <div class="notice surface">
        <p>{t.pageLoadError}</p>
        <button type="button" class="btn" onclick={() => location.reload()}>{t.retry}</button>
      </div>
    {/await}
  {:else if route.name === 'hub'}
    <PlayHub
      {t}
      {storageOk}
      onNavigate={(name) => navigate({ name })}
      hrefFor={(name) => pathForRoute({ name }, BASE)}
      hidden={hiddenDestinations}
    />
  {:else if route.name === 'history'}
    {#await HistoryPage()}
      <p class="notice muted">{t.loading}</p>
    {:then { default: Page }}
      <Page
        {t}
        {uiLocale}
        {index}
        {storageOk}
        filter={route.filter ?? {}}
        onFilter={(filter) => navigate({ name: 'history', filter })}
        onReplay={(play) => void replay(play)}
        subjectsOf={ratingSubjectsOf}
        setNames={setNames}
      />
    {:catch}
      <!-- The chunk did not arrive: a connection that dropped, or a tab
           open across a release whose files it was built against are
           gone. A reload fetches the current build. -->
      <div class="notice surface">
        <p>{t.pageLoadError}</p>
        <button type="button" class="btn" onclick={() => location.reload()}>{t.retry}</button>
      </div>
    {/await}
  {:else if route.name === 'achievements'}
    {#await AchievementsPage()}
      <p class="notice muted">{t.loading}</p>
    {:then { default: Page }}
      <Page {t} {uiLocale} {cardLocale} {index} {sets} {packs} {storageOk} />
    {:catch}
      <div class="notice surface">
        <p>{t.pageLoadError}</p>
        <button type="button" class="btn" onclick={() => location.reload()}>{t.retry}</button>
      </div>
    {/await}
  {:else if route.name === 'stats'}
    {#await StatsPage()}
      <p class="notice muted">{t.loading}</p>
    {:then { default: Page }}
      <Page {t} {index} {storageOk} base={BASE} />
    {:catch}
      <!-- The chunk did not arrive: a connection that dropped, or a tab
           open across a release whose files it was built against are
           gone. A reload fetches the current build. -->
      <div class="notice surface">
        <p>{t.pageLoadError}</p>
        <button type="button" class="btn" onclick={() => location.reload()}>{t.retry}</button>
      </div>
    {/await}
  {:else if route.name === 'campaigns'}
    {#await CampaignsPage()}
      <p class="notice muted">{t.loading}</p>
    {:then { default: Page }}
      <Page {t} {uiLocale} {cardLocale} {index} {sets} {storageOk} />
    {:catch}
      <!-- The chunk did not arrive: a connection that dropped, or a tab
           open across a release whose files it was built against are
           gone. A reload fetches the current build. -->
      <div class="notice surface">
        <p>{t.pageLoadError}</p>
        <button type="button" class="btn" onclick={() => location.reload()}>{t.retry}</button>
      </div>
    {/await}
  {:else if route.name === 'account'}
    {#await AccountPage()}
      <p class="notice muted">{t.loading}</p>
    {:then { default: Page }}
      <Page {t} {uiLocale} {storageOk} initialMode={accountMode} />
    {:catch}
      <!-- The chunk did not arrive: a connection that dropped, or a tab
           open across a release whose files it was built against are
           gone. A reload fetches the current build. -->
      <div class="notice surface">
        <p>{t.pageLoadError}</p>
        <button type="button" class="btn" onclick={() => location.reload()}>{t.retry}</button>
      </div>
    {/await}
  {:else if route.name === 'bgg'}
    {#await BggPage()}
      <p class="notice muted">{t.loading}</p>
    {:then { default: Page }}
      <Page {t} {uiLocale} {storageOk} onBack={() => (sheetOpen = true)} />
    {:catch}
      <!-- The chunk did not arrive: a connection that dropped, or a tab
           open across a release whose files it was built against are
           gone. A reload fetches the current build. -->
      <div class="notice surface">
        <p>{t.pageLoadError}</p>
        <button type="button" class="btn" onclick={() => location.reload()}>{t.retry}</button>
      </div>
    {/await}
  {:else if route.name === 'home'}
    <HomePage
      {t}
      {uiLocale}
      {index}
      {packs}
      hrefFor={(r) => pathForRoute(r, BASE)}
      onNavigate={navigate}
    />
  {:else if route.name === 'notFound'}
    <!-- nginx already answered this address with a 404; this is what the
         status looks like. -->
    <section class="notice surface not-found">
      <h1>{t.notFoundTitle}</h1>
      <p class="muted">{t.notFoundBody}</p>
      <p>
        <a
          href={pathForRoute({ name: 'home' }, BASE)}
          onclick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
              return;
            }
            event.preventDefault();
            navigate({ name: 'home' });
          }}
        >
          {t.notFoundHome}
        </a>
      </p>
    </section>
  {:else if route.name === 'verify'}
    {#await VerifyPage()}
      <p class="notice muted">{t.loading}</p>
    {:then { default: Page }}
      <Page
        {t}
        {uiLocale}
        token={route.token}
        onDone={() => navigate({ name: 'account' })}
      />
    {:catch}
      <!-- The chunk did not arrive: a connection that dropped, or a tab
           open across a release whose files it was built against are
           gone. A reload fetches the current build. -->
      <div class="notice surface">
        <p>{t.pageLoadError}</p>
        <button type="button" class="btn" onclick={() => location.reload()}>{t.retry}</button>
      </div>
    {/await}
  {:else if route.name === 'rules'}
    {#await RulesPage()}
      <p class="notice muted">{t.loading}</p>
    {:then { default: Page }}
      <Page {t} {cardLocale} />
    {:catch}
      <!-- The chunk did not arrive: a connection that dropped, or a tab
           open across a release whose files it was built against are
           gone. A reload fetches the current build. -->
      <div class="notice surface">
        <p>{t.pageLoadError}</p>
        <button type="button" class="btn" onclick={() => location.reload()}>{t.retry}</button>
      </div>
    {/await}
  {:else if route.name === 'draft'}
    {#await DraftPage()}
      <p class="notice muted">{t.loading}</p>
    {:then { default: Page }}
      <Page {t} {uiLocale} {cardLocale} {index} {storageOk} onDone={() => navigate({ name: 'decks' })} />
    {:catch}
      <div class="notice surface">
        <p>{t.pageLoadError}</p>
        <button type="button" class="btn" onclick={() => location.reload()}>{t.retry}</button>
      </div>
    {/await}
  {:else if route.name === 'decks'}
    {#await DecksPage()}
      <p class="notice muted">{t.loading}</p>
    {:then { default: Page }}
      <Page
        {t}
        {index}
        {cardLocale}
        {storageOk}
        onOpen={(id) => navigate({ name: 'deck', id })}
        onEdit={(id) => navigate({ name: 'deck', id, edit: true })}
      />
    {:catch}
      <!-- The chunk did not arrive: a connection that dropped, or a tab
           open across a release whose files it was built against are
           gone. A reload fetches the current build. -->
      <div class="notice surface">
        <p>{t.pageLoadError}</p>
        <button type="button" class="btn" onclick={() => location.reload()}>{t.retry}</button>
      </div>
    {/await}
  {:else if route.name === 'deck'}
    {@const deckId = route.id}
    {#key deckId}
      {#await DeckPage()}
        <p class="notice muted">{t.loading}</p>
      {:then { default: Page }}
        <Page
          {t}
          {index}
          {packs}
          {cardLocale}
          {storageOk}
          id={deckId}
          edit={route.edit === true}
          onView={() => navigate({ name: 'deck', id: deckId })}
          onEdit={() => navigate({ name: 'deck', id: deckId, edit: true })}
          onShelf={() => navigate({ name: 'decks' })}
          cardHref={(code) => pathForRoute({ name: 'card', code }, BASE)}
        />
      {:catch}
        <!-- The chunk did not arrive: a connection that dropped, or a tab
             open across a release whose files it was built against are
             gone. A reload fetches the current build. -->
        <div class="notice surface">
          <p>{t.pageLoadError}</p>
          <button type="button" class="btn" onclick={() => location.reload()}>{t.retry}</button>
        </div>
      {/await}
    {/key}
  {:else}
    <SearchControls
      {t}
      {query}
      {filters}
      {index}
      {packs}
      onQuery={(next) => {
        query = next;
        resultLimit = RESULT_PAGE;
      }}
      onFilters={(next) => {
        filters = next;
        resultLimit = RESULT_PAGE;
      }}
    />

    {#if query.trim() === '' && activeFilterCount(filters) === 0}
      <!--
        The search page's own words, for whoever indexes it: what this is.
        The home page now carries the introduction; this is the card search
        and says so. Gone as soon as a search begins, because then the
        results are the page.
      -->
      <section class="intro">
        <h1>{t.homeIntroTitle}</h1>
        <p>{t.homeIntro}</p>
      </section>
    {/if}

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
      {#if results.total > results.rows.length}
        <p class="more">
          <button
            type="button"
            class="btn"
            onclick={() => (resultLimit += RESULT_PAGE)}
          >
            {t.showMore(Math.min(RESULT_PAGE, results.total - results.rows.length))}
          </button>
        </p>
      {/if}
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
  {grouped}
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
  onBgg={() => navigate({ name: 'bgg' })}
  accountHandle={session.account?.handle ?? null}
  hidden={hiddenDestinations}
  {grouped}
  onGrouped={setGrouped}
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
  <!--
    Where the project lives: the community funding it, the phone it started
    on, and its source. Each link carries its word beside the mark, so the
    marks are decorative and nothing depends on recognising one.
  -->
  <ul class="links">
    <li>
      <a href="https://www.patreon.com/cw/thwart" target="_blank" rel="noopener">
        <svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="15" cy="9" r="6.5" fill="currentColor" /><rect x="2" y="2.5" width="3.6" height="19" fill="currentColor" /></svg>
        {t.footerPatreon}
      </a>
    </li>
    <li>
      <a href="https://github.com/Hasyame/Thwart/releases/latest" target="_blank" rel="noopener">
        <svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.4 9.5h11.2v7.3a1.6 1.6 0 0 1-1.6 1.6h-.9v3.1a1.3 1.3 0 0 1-2.6 0v-3.1h-1v3.1a1.3 1.3 0 0 1-2.6 0v-3.1H8a1.6 1.6 0 0 1-1.6-1.6zM3.9 9.5a1.3 1.3 0 0 1 1.3 1.3v5.1a1.3 1.3 0 0 1-2.6 0v-5.1a1.3 1.3 0 0 1 1.3-1.3zm16.2 0a1.3 1.3 0 0 1 1.3 1.3v5.1a1.3 1.3 0 0 1-2.6 0v-5.1a1.3 1.3 0 0 1 1.3-1.3zM6.4 8.6a5.6 5.6 0 0 1 3-4.5L8.5 2.6a.4.4 0 0 1 .7-.4l.9 1.6a5.9 5.9 0 0 1 3.8 0l.9-1.6a.4.4 0 0 1 .7.4l-.9 1.5a5.6 5.6 0 0 1 3 4.5zm3.1-2.2a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6zm5 0a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z" /></svg>
        {t.footerAndroid}
      </a>
    </li>
    <li>
      <a href="https://github.com/Hasyame/Thwart-Web" target="_blank" rel="noopener">
        <svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.17c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" /></svg>
        {t.footerSource}
      </a>
    </li>
    <li>
      <a href="mailto:marvelchampcompanion@proton.me?subject=Thwart">
        <svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M3 6h18v12H3z M3 7l9 6 9-6" /></svg>
        {t.footerReport}
      </a>
    </li>
  </ul>
</footer>

<style>
  /*
   * A whole viewport, so the footer is never in the first screen. It was:
   * while the card index loaded, the page was a short notice with the footer
   * under it, and the footer then jumped a screen down when the cards came
   * -- a layout shift of 0.26 that Lighthouse scored as the page's worst
   * fault. Off-screen, nothing it does is a shift.
   */
  main {
    min-height: 100dvh;
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

  .more {
    display: flex;
    justify-content: center;
    margin: var(--space-4) 0 0;
  }

  /* Small and out of the way: a line of welcome, not a landing page. */
  .intro {
    max-width: var(--prose-max);
    margin: 0 0 var(--space-4);
  }

  .intro h1 {
    font-size: var(--text-lg);
    margin: 0 0 var(--space-1);
  }

  .intro p {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
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

  .links {
    list-style: none;
    margin: var(--space-3) 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
  }

  .links a {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--tap-min);
    color: var(--text-muted);
    text-decoration: none;
  }

  .links a:hover {
    color: var(--text);
    text-decoration: underline;
  }

  .mark {
    width: 1.25rem;
    height: 1.25rem;
    flex: none;
  }
</style>
