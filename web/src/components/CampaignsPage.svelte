<script lang="ts">
  import { liveQuery } from 'dexie';
  import type { CampaignEvent, CampaignRun, Play } from '../lib/records';
  import type { CardSet, Locale } from '../lib/types';
  import type { Strings } from '../lib/i18n';
  import { db } from '../lib/db';
  import { session } from '../lib/sync/session.svelte';
  import { storedOnServer } from '../lib/sync/stored.svelte';
  import { foldCampaign, type CampaignProgress } from '../lib/campaigns';
  import { fieldHue, lastUpdatedOf, parseEventRows, tileOf, updatedWords, type CampaignStatus, type CampaignTile } from '../lib/campaignTile';
  import { templateOf } from '../lib/campaign/store';
  import { fetchCard } from '../lib/cardViewer.svelte';
  import { cardImageUrl } from '../lib/data';
  import type { IndexRow } from '../lib/types';
  import type { SavedDeck } from '../lib/records';
  import StartCampaign from './StartCampaign.svelte';
  import CampaignRunView from './CampaignRun.svelte';
  import CampaignHub from './CampaignHub.svelte';

  interface Props {
    t: Strings;
    uiLocale: Locale;
    /** Card names and images follow the card language, not the interface's. */
    cardLocale: Locale;
    /** For turning a template's card codes into card names. */
    index: readonly IndexRow[];
    sets: readonly CardSet[];
    storageOk: boolean;
    initialDeckIds?: readonly string[];
    initiallyExpert?: boolean;
    initialStart?: boolean;
    onConsumeDecks?: () => void;
  }

  const { t, uiLocale, cardLocale, index, sets, storageOk, initialDeckIds = [], initiallyExpert = false, initialStart = false, onConsumeDecks }: Props = $props();
  let preparedDeckIds = $state<readonly string[]>([]);
  let preparedExpert = $state(false);
  $effect(() => {
    if (initialDeckIds.length > 0 || initialStart) {
      preparedDeckIds = [...initialDeckIds];
      preparedExpert = initiallyExpert;
      view = { kind: 'start' };
      onConsumeDecks?.();
    }
  });

  /** Whether the badge means anything: signed out, everything is local. */
  const signedIn = $derived(session.status === 'signed-in' && storedOnServer.loaded);

  /**
   * The shelf, the start form, one campaign's page, or its scenario in play.
   *
   * A card on the shelf opens the campaign's page (CampaignHub); the page's
   * scenario card opens the play, and leaving the play comes back to the page.
   */
  let view = $state<{ kind: 'list' } | { kind: 'start' } | { kind: 'hub'; id: string } | { kind: 'run'; id: string }>({
    kind: 'list',
  });

  const decks = $state<{ saved: readonly SavedDeck[] }>({ saved: [] });

  const cardNames = $derived(new Map(index.map((row) => [row.code, row.name] as const)));
  const setNames = $derived(new Map(sets.map((set) => [set.code, set.name] as const)));

  const store = $state<{
    runs: readonly CampaignRun[];
    events: readonly CampaignEvent[];
    plays: readonly Play[];
  }>({ runs: [], events: [], plays: [] });

  $effect(() => {
    if (!storageOk) {
      return;
    }
    const subs = [
      liveQuery(() => db.campaignRuns.orderBy('createdAt').reverse().toArray()).subscribe(
        (rows) => (store.runs = rows),
      ),
      liveQuery(() => db.campaignEvents.toArray()).subscribe(
        (rows) => (store.events = rows),
      ),
      liveQuery(() => db.plays.toArray()).subscribe((rows) => (store.plays = rows)),
      liveQuery(() => db.decks.toArray()).subscribe((rows) => (decks.saved = rows)),
    ];
    return () => subs.forEach((s) => s.unsubscribe());
  });

  const openRun = $derived.by(() => {
    const current = view;
    return current.kind === 'run' || current.kind === 'hub'
      ? (store.runs.find((run) => run.id === current.id) ?? null)
      : null;
  });

  const eventsByRun = $derived.by(() => {
    const map = new Map<string, CampaignEvent[]>();
    for (const event of store.events) {
      const bucket = map.get(event.runId);
      if (bucket === undefined) {
        map.set(event.runId, [event]);
      } else {
        bucket.push(event);
      }
    }
    return map;
  });

  const campaigns = $derived(
    store.runs.map((run): CampaignProgress =>
      foldCampaign(run, eventsByRun.get(run.id) ?? [], uiLocale),
    ),
  );
  const openCampaign = $derived(openRun === null ? null : (campaigns.find((c) => c.run.id === openRun.id) ?? null));

  /*
   * What each tile shows, folded by the real engine: the status the log
   * says, the score, and the card that stands for the box. lib/campaignTile
   * has the rule for what "lost" means.
   */
  const tiles = $derived.by((): ReadonlyMap<string, CampaignTile> => {
    const out = new Map<string, CampaignTile>();
    for (const run of store.runs) {
      out.set(run.id, tileOf(run, templateOf(run), parseEventRows(eventsByRun.get(run.id) ?? [])));
    }
    return out;
  });

  /*
   * The faces, fetched once per card and kept: a run that is a second play
   * of the same box shares its villain. Read through the card viewer's
   * fetch, the same pipeline as every card view, so nothing is re-hosted.
   */
  let faces = $state.raw<ReadonlyMap<string, string>>(new Map());
  $effect(() => {
    const codes = [
      ...new Set([
        ...[...tiles.values()].map((tile) => tile.faceCode).filter((c): c is string => c !== null),
        ...[...tiles.values()].flatMap((tile) => tile.state?.heroes.map((hero) => hero.heroCardCode) ?? []),
      ]),
    ];
    if (codes.length === 0) {
      return;
    }
    let cancelled = false;
    void Promise.all(
      codes.map((code) => fetchCard(code).then((card) => [code, cardImageUrl(card?.imagesrc)] as const)),
    ).then((pairs) => {
      if (!cancelled) {
        faces = new Map(pairs.flatMap(([code, url]) => (url === null ? [] : [[code, url] as const])));
      }
    });
    return () => {
      cancelled = true;
    };
  });

  const statusLabel = (status: CampaignStatus): string =>
    ({
      'not-started': t.campaignStatusNotStarted,
      'in-progress': t.campaignStatusInProgress,
      won: t.campaignStatusWon,
      lost: t.campaignStatusLost,
      conceded: t.campaignStatusConceded,
    })[status];

  /* A glyph beside the word, so the state is never colour alone. */
  const statusGlyph = (status: CampaignStatus): string =>
    ({ 'not-started': '·', 'in-progress': '▶', won: '✓', lost: '✗', conceded: '✗' })[status];

  /** Plays recorded against a run, which is what campaignRunId is for. */
  function playsFor(runId: string): readonly Play[] {
    return store.plays.filter((play) => play.campaignRunId === runId);
  }

  /*
   * Two lists, not one sorted cleverly.
   *
   * A finished campaign is a different kind of thing from one being played: you
   * open the first to read it and the second to carry on. Mixed together, the
   * one you want is wherever its start date happens to put it, and a shelf of
   * finished campaigns pushes the live one off the screen.
   *
   * Conceded counts as finished. It is over either way, and the run that ended
   * badly is not one somebody is looking for under "in progress".
   */
  const isLive = (campaign: CampaignProgress): boolean => {
    const status = tiles.get(campaign.run.id)?.status;
    return status === undefined
      ? !campaign.run.finished && !campaign.conceded
      : status === 'not-started' || status === 'in-progress';
  };
  const inProgress = $derived(campaigns.filter(isLive));
  const finished = $derived(campaigns.filter((campaign) => !isLive(campaign)));

  /** What a card says it is waiting on: the scenario to play, or its status. */
  function nextWords(campaign: CampaignProgress, tile: CampaignTile | undefined): string {
    const status = tile?.status ?? 'not-started';
    if (status !== 'not-started' && status !== 'in-progress') {
      return statusLabel(status);
    }
    const id = tile?.state?.currentScenarioId ?? null;
    return campaign.scenarios.find((scenario) => scenario.id === id)?.name ?? statusLabel(status);
  }

  /**
   * Removes a campaign, its log, and the games recorded against it.
   *
   * The games go too, deliberately: this exists so a campaign somebody does not
   * want can stop counting, and leaving its plays behind would leave them in
   * the statistics — which is most of what was being asked for. The confirm
   * says so in the same breath, with the numbers.
   *
   * One transaction, so a browser closed halfway cannot leave a run with no log
   * or a log with no run.
   */
  async function removeCampaign(runId: string): Promise<void> {
    await db.transaction('rw', db.campaignRuns, db.campaignEvents, db.plays, async () => {
      await db.campaignEvents.where('runId').equals(runId).delete();
      await db.plays.where('campaignRunId').equals(runId).delete();
      await db.campaignRuns.delete(runId);
    });
    view = { kind: 'list' };
  }
</script>

<section>
  {#if view.kind !== 'run' && view.kind !== 'hub'}
    <h1 class="comic-title">{t.campaignsTitle}</h1>
  {/if}

  {#if storageOk && view.kind === 'list'}
    <button class="start-button" type="button" onclick={() => (view = { kind: 'start' })}>
      {t.startCampaign}
    </button>
  {/if}

  {#if view.kind === 'start'}
    <StartCampaign
      initiallyExpert={preparedExpert}
      initialDeckIds={preparedDeckIds}
      {t}
      {uiLocale}
      decks={decks.saved}
      onStarted={(id) => (view = { kind: 'run', id })}
      onCancel={() => (view = { kind: 'list' })}
    />
  {:else if view.kind === 'run' && openRun !== null}
    <CampaignRunView
      {t}
      {uiLocale}
      {cardLocale}
      {index}
      {cardNames}
      {setNames}
      {storageOk}
      run={openRun}
      decks={decks.saved}
      onBack={() => (view = { kind: 'hub', id: openRun.id })}
    />
  {:else if view.kind === 'hub' && openRun !== null && openCampaign !== null}
    {@const tile = tiles.get(openRun.id)}
    {@const face = tile?.faceCode === null || tile?.faceCode === undefined ? undefined : faces.get(tile.faceCode)}
    <CampaignHub
      {t}
      {uiLocale}
      {index}
      {storageOk}
      campaign={openCampaign}
      {tile}
      template={templateOf(openRun)}
      art={tile?.boxArt ?? face}
      boxArt={tile?.boxArt !== null && tile?.boxArt !== undefined}
      plays={playsFor(openRun.id)}
      eventCount={(eventsByRun.get(openRun.id) ?? []).length}
      storageNote={signedIn ? (storedOnServer.campaigns.has(openRun.id) ? t.savedOnServer : t.savedLocalOnly) : null}
      onContinue={() => (view = { kind: 'run', id: openRun.id })}
      onBack={() => (view = { kind: 'list' })}
      onDelete={() => removeCampaign(openRun.id)}
    />
  {:else}

  {#if !storageOk}
    <div class="notice surface"><p>{t.storageUnavailable}</p></div>
  {:else if campaigns.length === 0}
    <div class="notice surface">
      <p>{t.campaignsEmpty}</p>
      <p class="muted">{t.campaignsEmptyHint}</p>
    </div>
  {:else}
    {#if inProgress.length > 0}
      <h2 class="section-title">{t.campaignsInProgress}</h2>
      {@render runList(inProgress)}
    {/if}

    {#if finished.length > 0}
      <h2 class="section-title">{t.campaignsFinished}</h2>
      {@render runList(finished)}
    {/if}
  {/if}
  {/if}
</section>

{#snippet runList(list: readonly CampaignProgress[])}
    <ul class="runs">
      {#each list as campaign (campaign.run.id)}
        {@const tile = tiles.get(campaign.run.id)}
        {@const face = tile?.faceCode === null || tile?.faceCode === undefined ? undefined : faces.get(tile.faceCode)}
        {@const art = tile?.boxArt ?? face}
        {@const status = tile?.status ?? 'not-started'}
        {@const heroes = tile?.state?.heroes ?? []}
        <!--
          A card per campaign, after ArkhamCards' shelf: the box's picture
          behind its name, the heroes at the table, what is next and at what
          difficulty; underneath, how far it has gone and when it was last
          played. The whole card opens the campaign's page. Text on the art
          sits on a dark scrim, strongest where the words are. With no art
          (offline) the top is the campaign's colour field.
        -->
        <li class="card" data-status={status}>
          <button
            type="button"
            class="card-top"
            style:--field-hue={fieldHue(campaign.run.templateId)}
            onclick={() => (view = { kind: 'hub', id: campaign.run.id })}
          >
            {#if art !== undefined}
              <img class="art" class:box={tile?.boxArt !== null && tile?.boxArt !== undefined} src={art} alt="" loading="lazy" />
            {/if}
            <span class="scrim" aria-hidden="true"></span>
            <span class="card-title">{campaign.title}</span>
            {#if heroes.length > 0}
              <span class="faces" aria-hidden="true">
                {#each heroes.slice(0, 4) as hero (hero.id)}
                  {@const heroFace = faces.get(hero.heroCardCode)}
                  <span class="face">{#if heroFace !== undefined}<img src={heroFace} alt="" loading="lazy" />{:else}{hero.name.slice(0, 1)}{/if}</span>
                {/each}
              </span>
            {/if}
            <span class="card-next">
              <span class="next-name">{nextWords(campaign, tile)}</span>
              <span class="level">{t.campaignDifficulty(campaign.run.difficulty)}</span>
            </span>
            <span class="visually-hidden">{t.campaignOpen}</span>
          </button>

          <div class="card-foot">
            <span class="foot-line">
              <span class="badge" data-status={status}><span class="glyph" aria-hidden="true">{statusGlyph(status)}</span>{statusLabel(status)}</span>
              <span class="muted">{t.campaignProgress(tile?.beaten ?? campaign.completed, tile?.total ?? campaign.scenarios.length)}</span>
              {#if (tile?.results.length ?? 0) > 0}
                <span class="results" role="img" aria-label={t.campaignResultsLabel(tile?.results.filter(Boolean).length ?? 0, tile?.results.length ?? 0)}>
                  {#each tile?.results ?? [] as won, i (i)}
                    <span class="result" class:won class:lost={!won} aria-hidden="true">{won ? '✓' : '✗'}</span>
                  {/each}
                </span>
              {/if}
            </span>
            <span class="muted small updated">
              {t.campaignUpdated(updatedWords(lastUpdatedOf(campaign.run, eventsByRun.get(campaign.run.id) ?? []), uiLocale))}
              {#if signedIn}· {storedOnServer.campaigns.has(campaign.run.id) ? t.savedOnServer : t.savedLocalOnly}{/if}
            </span>
          </div>
        </li>
      {/each}
    </ul>
{/snippet}

<style>
  .section-title {
    font-size: var(--text-lg);
    font-weight: var(--weight-bold);
    margin: var(--space-5) 0 var(--space-2);
  }

  .start-button {
    display: block;
    margin: var(--space-4) 0;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-lg);
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 700;
    cursor: pointer;
  }

  h1 {
    font-size: var(--text-2xl);
    margin: var(--space-5) 0 var(--space-3);
  }

  .notice {
    padding: var(--space-4);
    margin: var(--space-3) 0;
    max-width: var(--prose-max);
  }

  .runs {
    list-style: none;
    padding: 0;
    margin: var(--space-3) 0 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(20rem, 100%), 1fr));
    gap: var(--space-3);
  }

  .card {
    display: grid;
    border: 2px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--surface-1);
    box-shadow: var(--shadow-1);
  }

  .card:hover {
    box-shadow: var(--shadow-2);
  }

  /* The top: the box's picture behind its name, the heroes, what is next. */
  .card-top {
    position: relative;
    display: grid;
    gap: var(--space-2);
    min-height: 10rem;
    padding: var(--space-3) var(--space-4);
    border: 0;
    background: hsl(var(--field-hue) 45% 28%);
    color: #fff;
    font: inherit;
    text-align: start;
    cursor: pointer;
    align-content: space-between;
    overflow: hidden;
  }

  .card-top > :not(.art, .scrim) {
    position: relative;
  }

  .art {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 20%;
    transition: transform var(--motion-base) var(--ease-out);
  }

  /* A card's art is on its right, its stats down the left: zoom to the art. */
  .art:not(.box) {
    object-position: 75% 22%;
    transform: scale(1.35);
    transform-origin: 75% 22%;
  }

  .art.box {
    object-position: 50% 50%;
  }

  .card-top:hover .art.box {
    transform: scale(1.03);
  }

  .scrim {
    position: absolute;
    inset: 0;
    background: linear-gradient(to bottom, rgb(0 0 0 / 70%) 0%, rgb(0 0 0 / 25%) 45%, rgb(0 0 0 / 80%) 100%);
  }

  .card-title {
    font-size: var(--text-xl);
    font-weight: 900;
    font-style: italic;
    text-transform: uppercase;
    letter-spacing: -0.01em;
    line-height: 1.1;
    text-shadow: 0 2px 3px rgb(0 0 0 / 70%);
  }

  .faces {
    display: flex;
    gap: var(--space-2);
  }

  .face {
    width: 2.6rem;
    height: 2.6rem;
    overflow: hidden;
    border-radius: var(--radius-sm);
    border: 2px solid rgb(255 255 255 / 85%);
    background: rgb(0 0 0 / 40%);
    display: grid;
    place-items: center;
    font-weight: var(--weight-bold);
  }

  .face img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 72% 22%;
    transform: scale(2);
    transform-origin: 72% 22%;
  }

  .card-next {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .next-name {
    font-size: var(--text-lg);
    font-weight: var(--weight-bold);
    text-shadow: 0 1px 2px rgb(0 0 0 / 70%);
  }

  .level {
    padding: var(--space-0-5) var(--space-2);
    background: rgb(0 0 0 / 75%);
    border: 1px solid rgb(255 255 255 / 45%);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
  }

  /* The foot: how far, and when it was last played. */
  .card-foot {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-4) var(--space-3);
    font-size: var(--text-sm);
  }

  .foot-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-weight: var(--weight-semibold);
  }

  .badge .glyph {
    display: inline-grid;
    place-items: center;
    width: 1.3rem;
    height: 1.3rem;
    border-radius: 50%;
    background: var(--surface-3);
    font-size: var(--text-xs);
  }

  .badge[data-status='won'] .glyph { background: var(--ok); color: #fff; }
  .badge[data-status='lost'] .glyph,
  .badge[data-status='conceded'] .glyph { background: var(--danger); color: #fff; }
  .badge[data-status='in-progress'] .glyph { background: var(--accent); color: var(--accent-ink); }

  .results {
    display: inline-flex;
    gap: 2px;
  }

  .result {
    display: inline-grid;
    place-items: center;
    width: 1.1rem;
    height: 1.1rem;
    border-radius: 3px;
    font-size: 0.7rem;
    color: #fff;
  }

  .result.won { background: var(--ok); }
  .result.lost { background: var(--danger); }

  .updated {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .small {
    font-size: var(--text-xs);
  }
</style>
