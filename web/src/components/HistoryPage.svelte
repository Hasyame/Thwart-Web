<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { IndexRow, Locale } from '../lib/types';
  import type { CampaignRun, Play } from '../lib/records';
  import type { HistoryFilter } from '../lib/router';
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import type { RatingSubject } from '../lib/ratings';
  import { count, inCampaign, page, runOf, type PlayFilter } from '../lib/playQuery';
  import { playerBucket } from '../lib/plays';
  import { cardImageUrl } from '../lib/data';
  import { scenarioFaceOf } from '../lib/scenarioFace';
  import { boxArtOf } from '../lib/campaignTile';
  import { FNE_TEMPLATE_ID, isFne } from '../lib/fearNoEvil';
  import PlayDetail from './PlayDetail.svelte';

  /**
   * Everything already played, newest first.
   *
   * Reads through `lib/playQuery` like the statistics do — one query layer, so
   * the two screens cannot come to disagree about which games exist. The rule
   * that a deleted play is not a played game lives there and nowhere else.
   *
   * **Paged, never loaded whole.** A heavy history is thousands of games and
   * the screen shows a couple of dozen. Reading them all to render twenty is
   * the kind of thing that is invisible while testing and unusable in year
   * three, so the query takes an offset and a limit and this component keeps
   * only what it has shown.
   *
   * **The filters are the URL.** They arrive as a prop parsed from the query
   * string and every change navigates, so a filtered view can be bookmarked,
   * shared, and comes back the same after a reload.
   */

  interface Props {
    t: Strings;
    uiLocale: Locale;
    index: readonly IndexRow[];
    storageOk: boolean;
    filter: HistoryFilter;
    /** Replaces the URL, which is where the filter state lives. */
    onFilter: (filter: HistoryFilter) => void;
    /** Lays a game out again on the setup screen. */
    onReplay: (play: Play) => void;
    /** What a game can be rated on, resolved by App (a campaign's needs its template). */
    subjectsOf: (play: Play) => Promise<readonly RatingSubject[]>;
    setNames: ReadonlyMap<string, string>;
  }

  const { t, uiLocale, index, storageOk, filter, onFilter, onReplay, subjectsOf, setNames }: Props = $props();

  const PAGE = 25;

  /*
   * Which games are starred.

   * Small — a handful of ids — and read whole, because it is joined against
   * every row that renders and against the filter. `$state.raw`: a Set is not
   * something a deep proxy has anything useful to do with.
   */
  let favouriteIds = $state.raw<ReadonlySet<string>>(new Set());
  $effect(() => {
    if (!storageOk) {
      return;
    }
    const sub = liveQuery(() => db.favouritePlays.toArray()).subscribe((rows) => {
      favouriteIds = new Set(rows.map((row) => row.playId));
    });
    return () => sub.unsubscribe();
  });

  /** The URL's filter as the query layer wants it: days become instants. */
  const asQuery = $derived.by((): PlayFilter => {
    const out: PlayFilter = {};
    const from = filter.from === undefined ? undefined : Date.parse(`${filter.from}T00:00:00`);
    const to = filter.to === undefined ? undefined : Date.parse(`${filter.to}T23:59:59.999`);
    return {
      ...out,
      ...(Number.isFinite(from) ? { from } : {}),
      ...(Number.isFinite(to) ? { to } : {}),
      // Both spellings, so an old play recorded under the set code is found
      // by the same choice as a new one recorded under the card code.
      ...(filter.hero === undefined
        ? {}
        : { heroes: [filter.hero, ...(setCodesByHero.get(filter.hero) ?? [])] }),
      ...(filter.aspect === undefined ? {} : { aspect: filter.aspect }),
      ...(filter.scenario === undefined ? {} : { scenario: filter.scenario }),
      ...(filter.result === undefined ? {} : { result: filter.result }),
      ...(filter.campaign === undefined ? {} : { campaign: filter.campaign }),
      ...(filter.favourite === '1' ? { favouriteIds } : {}),
    };
  });

  /*
   * What has been loaded so far.
   *
   * `$state.raw` rather than `$state`: these rows go nowhere near IndexedDB
   * from here, and a deep proxy over thousands of objects is a cost with no
   * purchase — the list is replaced wholesale rather than mutated.
   */
  let rows = $state.raw<readonly Play[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let failed = $state(false);
  let shown = $state(PAGE);

  /** Reloads when the filter or the page size changes, and on every write. */
  $effect(() => {
    if (!storageOk) {
      loading = false;
      return;
    }
    const query = asQuery;
    const wanted = shown;
    let live = true;
    loading = true;
    failed = false;

    void Promise.all([page(query, 0, wanted), count(query)])
      .then(([found, howMany]) => {
        if (live) {
          rows = found;
          total = howMany;
          loading = false;
        }
      })
      .catch(() => {
        if (live) {
          failed = true;
          loading = false;
        }
      });

    return () => {
      live = false;
    };
  });

  /** Reset to the first page whenever the filter changes. */
  let lastQuery = $state('');
  $effect(() => {
    const signature = JSON.stringify(asQuery);
    if (signature !== lastQuery) {
      lastQuery = signature;
      shown = PAGE;
    }
  });

  const remaining = $derived(Math.max(0, total - rows.length));

  /*
   * The campaign runs, for the badge and for browsing a campaign as a unit.
   *
   * Loaded whole: a run is one row per campaign somebody has played, which is
   * a handful, not the thousands the plays can be.
   */
  let runList = $state.raw<readonly CampaignRun[]>([]);
  const runs = $derived(new Map(runList.map((run) => [run.id, run])));
  $effect(() => {
    if (!storageOk) {
      return;
    }
    let live = true;
    void db.campaignRuns
      .orderBy('createdAt')
      .reverse()
      .toArray()
      .then((all) => {
        if (live) {
          runList = all;
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  });

  /**
   * Card code to the set codes an older play may have used for that hero.
   *
   * Plays used to store the hero's set code where they now store the card
   * code. Without this, choosing a hero finds only the games recorded since
   * that changed.
   */
  const setCodesByHero = $derived.by(() => {
    const map = new Map<string, string[]>();
    for (const row of index) {
      if (row.typeCode === 'hero' && row.setCode !== null) {
        const existing = map.get(row.code) ?? [];
        if (!existing.includes(row.setCode)) {
          existing.push(row.setCode);
        }
        map.set(row.code, existing);
      }
    }
    return map;
  });

  /**
   * Every hero the control can offer.
   *
   * From the card index, plus whatever the URL names if the index does not
   * know it. A link can carry a hero this build has no card for — an older
   * code, a pack whose data has not been fetched — and a select with no
   * matching option renders blank, so the page silently claims to be showing
   * everything while the list is filtered. Better an unfamiliar code in the
   * box than a control that disagrees with the page under it.
   */
  const heroChoices = $derived.by(() => {
    const seen = new Map<string, string>();
    for (const row of index) {
      if (row.typeCode === 'hero') {
        seen.set(row.code, row.name);
      }
    }
    const chosen = filter.hero;
    if (chosen !== undefined && !seen.has(chosen)) {
      seen.set(chosen, chosen);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  });

  /*
   * The scenarios to choose from.
   *
   * Taken from the games on screen, which is a compromise worth naming: it
   * cannot list a scenario that no loaded page contains, so a very long history
   * offers only what has been paged in. Reading every distinct scenario would
   * mean scanning the whole table on each render, which is the thing the paging
   * exists to avoid. The chosen one is added the same way a hero is, so a
   * filtered link still shows what it is filtering by.
   */
  const scenarioChoices = $derived.by(() => {
    const seen = new Map<string, string>();
    for (const play of rows) {
      seen.set(play.scenarioCode, play.scenarioName || play.scenarioCode);
    }
    const chosen = filter.scenario;
    if (chosen !== undefined && !seen.has(chosen)) {
      seen.set(chosen, chosen);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  });

  const ASPECTS = ['aggression', 'justice', 'leadership', 'protection', 'pool'];

  /**
   * Narrows or widens one filter, leaving the rest of the URL alone.
   *
   * Changing a filter closes whatever detail was open: a game the list no
   * longer contains should not stay on screen underneath it.
   */
  function narrow(field: keyof HistoryFilter, value: string): void {
    const next: Record<string, string> = { ...filter } as Record<string, string>;
    if (value === '') {
      delete next[field];
    } else {
      next[field] = value;
    }
    delete next.play;
    delete next.run;
    onFilter(next as HistoryFilter);
  }

  /**
   * Opens or closes a detail, leaving the filters alone.
   *
   * Deliberately a different function from `narrow`. Folding the two together
   * meant opening a game set its id and then cleared it in the next line, so
   * every row was inert — the kind of thing a type checker cannot see.
   */
  function open(field: 'play' | 'run', id: string): void {
    const next: Record<string, string> = { ...filter } as Record<string, string>;
    delete next.play;
    delete next.run;
    if (id !== '') {
      next[field] = id;
    }
    onFilter(next as HistoryFilter);
  }

  const filtering = $derived(
    filter.from !== undefined ||
      filter.to !== undefined ||
      filter.hero !== undefined ||
      filter.aspect !== undefined ||
      filter.scenario !== undefined ||
      filter.result !== undefined ||
      filter.campaign !== undefined ||
      filter.favourite !== undefined,
  );

  const openPlay = $derived(rows.find((play) => play.id === filter.play) ?? null);

  /* Resolved when a game is opened, because a campaign's scenario needs its
     run's template read. Cleared with the game, so a stale list never shows
     under the next one. */
  let ratingSubjects = $state.raw<readonly RatingSubject[]>([]);
  $effect(() => {
    const play = openPlay;
    ratingSubjects = [];
    if (play === null) {
      return;
    }
    let cancelled = false;
    void subjectsOf(play).then((found) => {
      if (!cancelled) {
        ratingSubjects = found;
      }
    });
    return () => {
      cancelled = true;
    };
  });
  const openRun = $derived(filter.run === undefined ? null : (runs.get(filter.run) ?? null));

  /** The games of one run, in the order they were played. */
  let runPlays = $state.raw<readonly Play[]>([]);
  $effect(() => {
    const run = openRun;
    if (run === null) {
      runPlays = [];
      return;
    }
    let live = true;
    void db.plays
      .where('campaignRunId')
      .equals(run.id)
      .toArray()
      .then((all) => {
        if (live) {
          runPlays = all
            .filter((play) => play.deletedAt === null || play.deletedAt === undefined)
            .sort((a, b) => a.playedAt - b.playedAt);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  });

  /**
   * The villain of each scenario on screen, by scenario code.
   *
   * Looked up once per distinct scenario rather than per row: a long history
   * is the same few villains many times over. The picture is MarvelCDB's,
   * by the path the index carries; nothing is fetched to find it.
   */
  const faceCache = new Map<string, string | null>();
  function faceOf(scenarioCode: string): string | null {
    const cached = faceCache.get(scenarioCode);
    if (cached !== undefined) {
      return cached;
    }
    // Fear No Evil played on its own: the box's own art, as in its campaign.
    const url = isFne(scenarioCode)
      ? boxArtOf(FNE_TEMPLATE_ID)
      : cardImageUrl(scenarioFaceOf(index, scenarioCode)?.img);
    faceCache.set(scenarioCode, url);
    return url;
  }

  const dayOf = (millis: number): string =>
    new Date(millis).toLocaleDateString(uiLocale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

  /** Who was at the table, as one readable line. */
  function tableOf(play: Play): string {
    if (play.roster.length > 0) {
      return play.roster
        .map((seat) => (seat.aspect === '' ? seat.name : `${seat.name} · ${seat.aspect}`))
        .join(', ');
    }
    const others = play.otherHeroes === '' ? '' : `, ${play.otherHeroes}`;
    return `${play.heroName || play.heroCode}${others}`;
  }
</script>

<section class="history">
  <h1>{t.historyTitle}</h1>

  {#if !storageOk}
    <div class="notice surface"><p>{t.storageUnavailable}</p></div>
  {:else}
    <!--
      The filters, which are the URL.

      Rendered before the list loads so the controls do not jump into place,
      and so somebody arriving on a filtered link can see what is filtering.
    -->
    <div class="filters" role="group" aria-label={t.historyFilters}>
      <label>
        <span class="muted lbl">{t.historyFrom}</span>
        <input
          class="field"
          type="date"
          value={filter.from ?? ''}
          onchange={(e) => narrow('from', e.currentTarget.value)}
        />
      </label>
      <label>
        <span class="muted lbl">{t.historyTo}</span>
        <input
          class="field"
          type="date"
          value={filter.to ?? ''}
          onchange={(e) => narrow('to', e.currentTarget.value)}
        />
      </label>
      <label>
        <span class="muted lbl">{t.byHero}</span>
        <select class="field" value={filter.hero ?? ''} onchange={(e) => narrow('hero', e.currentTarget.value)}>
          <option value="">{t.historyAny}</option>
          {#each heroChoices as [code, name] (code)}
            <option value={code}>{name}</option>
          {/each}
        </select>
      </label>
      <label>
        <span class="muted lbl">{t.byAspect}</span>
        <select class="field" value={filter.aspect ?? ''} onchange={(e) => narrow('aspect', e.currentTarget.value)}>
          <option value="">{t.historyAny}</option>
          {#each ASPECTS as aspect (aspect)}
            <option value={aspect}>{t.aspect(aspect)}</option>
          {/each}
        </select>
      </label>
      <label>
        <span class="muted lbl">{t.byScenario}</span>
        <select
          class="field"
          value={filter.scenario ?? ''}
          onchange={(e) => narrow('scenario', e.currentTarget.value)}
        >
          <option value="">{t.historyAny}</option>
          {#each scenarioChoices as [code, name] (code)}
            <option value={code}>{name}</option>
          {/each}
        </select>
      </label>
      <label>
        <span class="muted lbl">{t.historyResult}</span>
        <select class="field" value={filter.result ?? ''} onchange={(e) => narrow('result', e.currentTarget.value)}>
          <option value="">{t.historyAny}</option>
          <option value="won">{t.playWon}</option>
          <option value="lost">{t.playLost}</option>
        </select>
      </label>
      <label>
        <span class="muted lbl">{t.navCampaigns}</span>
        <select
          class="field"
          value={filter.campaign ?? ''}
          onchange={(e) => narrow('campaign', e.currentTarget.value)}
        >
          <option value="">{t.historyAny}</option>
          <option value="any">{t.historyInACampaign}</option>
          <option value="none">{t.historyOutsideACampaign}</option>
          {#each runList as run (run.id)}
            <option value={run.id}>{run.name || run.templateName}</option>
          {/each}
        </select>
      </label>

      <label class="tick">
        <input
          type="checkbox"
          checked={filter.favourite === '1'}
          onchange={(e) => narrow('favourite', e.currentTarget.checked ? '1' : '')}
        />
        <span>{t.historyFavouritesOnly}</span>
      </label>

      {#if filtering}
        <button class="btn btn--quiet clear" type="button" onclick={() => onFilter({})}>
          {t.historyClear}
        </button>
      {/if}
    </div>

    {#if openRun !== null}
      {@const run = openRun}
      <!--
        A campaign as a unit: the run, its scenarios in the order they were
        played, and how each went.
      -->
      <div class="panel surface">
        <div class="panel-head">
          <h2>{run.name || run.templateName}</h2>
          <button class="btn btn--quiet" type="button" onclick={() => open('run', '')}>
            {t.close}
          </button>
        </div>
        <p class="muted note">
          <!--
            Scenarios played and how many were won, not "n of n beaten".
            `campaignProgress` takes completed against the template's total, and
            this view has the games rather than the template, so passing the
            same number twice claimed a clean sweep for every campaign.
          -->
          {t.campaignDifficulty(run.difficulty)} ·
          {t.wonOf(runPlays.filter((p) => p.won).length, runPlays.length)}
          {#if run.finished}· {t.campaignFinished}{/if}
        </p>
        <ol class="run-scenarios">
          {#each runPlays as play (play.id)}
            <li>
              <button class="link-row" type="button" onclick={() => open('play', play.id)}>
                <span class="scenario">{play.scenarioName || play.scenarioCode}</span>
                <span class="muted sub">{dayOf(play.playedAt)}</span>
                <span class="result" class:won={play.won}>
                  {play.won ? t.playWon : t.playLost}
                </span>
              </button>
            </li>
          {/each}
        </ol>
        {#if runPlays.length === 0}
          <p class="muted note">{t.historyRunEmpty}</p>
        {/if}
      </div>
    {/if}

    {#if openPlay !== null}
      <PlayDetail
        {t}
        {uiLocale}
        play={openPlay}
        run={runOf(openPlay) === null ? null : (runs.get(runOf(openPlay) ?? '') ?? null)}
        onClose={() => open('play', '')}
        onOpenRun={(id) => open('run', id)}
        {onReplay}
        starred={favouriteIds.has(openPlay.id)}
        {ratingSubjects}
        {setNames}
        {storageOk}
        art={faceOf(openPlay.scenarioCode)}
      />
    {/if}

    <p class="muted count" aria-live="polite">
      {#if loading && rows.length === 0}
        {t.loadingGames}
      {:else}
        {t.historyCount(rows.length, total)}
      {/if}
    </p>

    {#if failed}
      <div class="notice surface"><p role="alert">{t.storageUnavailable}</p></div>
    {:else if !loading && total === 0}
      <!-- An empty page explains itself rather than being blank. -->
      <div class="notice surface">
        <p>{filtering ? t.historyNoMatches : t.historyEmpty}</p>
        <p class="muted">{filtering ? t.historyNoMatchesHint : t.historyEmptyHint}</p>
        {#if filtering}
          <button class="btn" type="button" onclick={() => onFilter({})}>{t.historyClear}</button>
        {/if}
      </div>
    {:else}
      <ul class="games">
        {#each rows as play (play.id)}
          {@const run = runOf(play) === null ? null : runs.get(runOf(play) ?? '')}
          {@const face = faceOf(play.scenarioCode)}
          <li class="game">
            <!-- The villain on the left, the game beside it; the whole row
                 opens the detail. A scenario the index has no face for keeps
                 the row's shape with an empty frame. -->
            <button
              class="link-row"
              type="button"
              aria-expanded={filter.play === play.id}
              onclick={() => open('play', filter.play === play.id ? '' : play.id)}
            >
              {#if face !== null}
                <img class="face" src={face} alt="" loading="lazy" />
              {:else}
                <span class="face face-blank" aria-hidden="true">{(play.scenarioName || play.scenarioCode).slice(0, 1)}</span>
              {/if}
              <span class="words">
              <span class="top">
                <span class="scenario">
                  {#if favouriteIds.has(play.id)}
                    <!-- Said in the accessible name too: the star is the whole
                         reason this row is easy to find. -->
                    <span class="star" aria-label={t.favouriteGames}>★</span>
                  {/if}
                  {play.scenarioName || play.scenarioCode}
                </span>
                <span class="result" class:won={play.won}>
                  {play.won ? t.playWon : t.playLost}
                </span>
              </span>
              <span class="muted sub">
                {dayOf(play.playedAt)} · {tableOf(play)}
              </span>
              <span class="muted sub">
                {t.difficulty(play.difficulty.toUpperCase()) === play.difficulty.toUpperCase()
                  ? play.difficulty
                  : t.difficulty(play.difficulty.toUpperCase())}
                {#if play.standardSet !== ''}· {play.standardSet}{/if}
                · {t.playerBucket(playerBucket(play.players))}
                {#if inCampaign(play)}
                  <span class="chip">{run?.name || run?.templateName || t.historyInACampaign}</span>
                {/if}
              </span>
              </span>
            </button>
          </li>
        {/each}
      </ul>

      {#if remaining > 0}
        <button
          class="btn btn--quiet more"
          type="button"
          disabled={loading}
          onclick={() => (shown += PAGE)}
        >
          {loading ? t.loadingGames : t.statsShowMore(remaining)}
        </button>
      {/if}
    {/if}
  {/if}
</section>

<style>
  h1 {
    font-size: var(--text-2xl);
    margin: var(--space-5) 0 var(--space-3);
  }

  h2 {
    font-size: var(--text-lg);
    font-weight: var(--weight-bold);
    margin: 0;
  }

  .notice {
    padding: var(--space-4);
    margin: var(--space-3) 0;
    max-width: var(--prose-max);
    display: grid;
    gap: var(--space-2);
    justify-items: start;
  }

  .filters {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: var(--space-2);
    align-items: end;
    margin-bottom: var(--space-3);
  }

  .filters label {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .lbl {
    font-size: var(--text-xs);
  }

  .clear {
    align-self: end;
  }

  .count {
    font-size: var(--text-sm);
    margin: 0 0 var(--space-2);
  }

  .games,
  .run-scenarios {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .game {
    border-bottom: 1px solid var(--hairline);
  }

  /*
   * The whole row is the control.
   *
   * A row that opens a detail should be one target, not a small link inside a
   * large row: the floor is 44px and this is comfortably past it on a phone.
   */
  .link-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: var(--tap-min);
    padding: var(--space-3) var(--space-1);
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .link-row:hover {
    background: var(--surface-2);
  }

  /* The villain's portrait: the top of the card, where the art is. */
  .face {
    flex: none;
    width: 3.25rem;
    height: 3.25rem;
    border-radius: var(--radius-sm);
    object-fit: cover;
    object-position: 50% 12%;
    background: var(--surface-2);
  }

  .face-blank {
    display: grid;
    place-items: center;
    color: var(--text-muted);
    font-weight: var(--weight-bold);
  }

  .words {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .scenario {
    font-weight: var(--weight-semibold);
  }

  /* The accent, because a star is the one thing on a row that is there to be
     spotted from across the list. */
  .star {
    color: var(--accent);
    margin-inline-end: var(--space-1);
  }

  .sub {
    font-size: var(--text-sm);
  }

  .result {
    font-size: var(--text-sm);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .result.won {
    color: var(--accent);
    font-weight: var(--weight-semibold);
  }

  .chip {
    display: inline-block;
    margin-inline-start: var(--space-1);
    padding: 1px var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--text-2xs);
  }

  .panel {
    padding: var(--space-4);
    margin: var(--space-3) 0;
    display: grid;
    gap: var(--space-2);
  }

  .panel-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .note {
    font-size: var(--text-sm);
    margin: 0;
  }

  .more {
    margin-top: var(--space-3);
  }

  @media (max-width: 40rem) {
    .filters {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
