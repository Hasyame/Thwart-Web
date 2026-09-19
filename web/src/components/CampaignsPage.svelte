<script lang="ts">
  import { liveQuery } from 'dexie';
  import type { CampaignEvent, CampaignRun, Play } from '../lib/records';
  import type { CardSet, Locale } from '../lib/types';
  import type { Strings } from '../lib/i18n';
  import { db } from '../lib/db';
  import { session } from '../lib/sync/session.svelte';
  import { storedOnServer } from '../lib/sync/stored.svelte';
  import { foldCampaign, type CampaignProgress } from '../lib/campaigns';
  import { fieldHue, parseEventRows, tileOf, type CampaignStatus, type CampaignTile } from '../lib/campaignTile';
  import { templateOf } from '../lib/campaign/store';
  import { fetchCard } from '../lib/cardViewer.svelte';
  import { cardImageUrl } from '../lib/data';
  import { formatElapsed } from '../lib/session.svelte';
  import type { IndexRow } from '../lib/types';
  import type { SavedDeck } from '../lib/records';
  import StartCampaign from './StartCampaign.svelte';
  import CampaignRunView from './CampaignRun.svelte';
  import PlayRow from './PlayRow.svelte';

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

  /** Nothing, the start form, or one run being played. */
  let view = $state<{ kind: 'list' } | { kind: 'start' } | { kind: 'run'; id: string }>({
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
    return current.kind === 'run'
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
    const codes = [...new Set([...tiles.values()].map((tile) => tile.faceCode).filter((c): c is string => c !== null))];
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

  let openId = $state<string | null>(null);
  /** The run whose delete has been asked for but not yet confirmed. */
  let deleting = $state<string | null>(null);
  let busy = $state(false);

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
    busy = true;
    try {
      await db.transaction('rw', db.campaignRuns, db.campaignEvents, db.plays, async () => {
        await db.campaignEvents.where('runId').equals(runId).delete();
        await db.plays.where('campaignRunId').equals(runId).delete();
        await db.campaignRuns.delete(runId);
      });
      if (openId === runId) {
        openId = null;
      }
    } finally {
      busy = false;
      deleting = null;
    }
  }
</script>

<section>
  {#if view.kind !== 'run'}
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
      onBack={() => (view = { kind: 'list' })}
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
        {@const open = openId === campaign.run.id}
        {@const plays = playsFor(campaign.run.id)}
        {@const tile = tiles.get(campaign.run.id)}
        {@const face = tile?.faceCode === null || tile?.faceCode === undefined ? undefined : faces.get(tile.faceCode)}
        {@const art = tile?.boxArt ?? face}
        {@const status = tile?.status ?? 'not-started'}
        {@const live = status === 'not-started' || status === 'in-progress'}
        <!--
          A tile per campaign, as on the shelf of decks: the final villain's
          art across the top, and everything written on the opaque band under
          it. Nothing but the status badge sits on the art: text over a
          picture is the contrast trap this page is meant to avoid. Fear No
          Evil shows its bundled key art, already landscape, so it is not
          cropped the way a card is. With no art -- offline -- the top is a
          colour field with the campaign's initial, and the tile looks
          finished all the same.
        -->
        <li class="tile" class:open>
          <button
            type="button"
            class="tile-head"
            style:--field-hue={fieldHue(campaign.run.templateId)}
            onclick={() => (view = { kind: 'run', id: campaign.run.id })}
          >
            {#if art !== undefined}
              <img class="art" class:box={tile?.boxArt !== null && tile?.boxArt !== undefined} src={art} alt="" loading="lazy" />
            {:else}
              <span class="field" aria-hidden="true">{(campaign.run.templateName || campaign.title).slice(0, 1)}</span>
            {/if}
            <span class="scrim" aria-hidden="true"></span>
            <span class="badge" data-status={status}>
              <span class="glyph" aria-hidden="true">{statusGlyph(status)}</span>
              {statusLabel(status)}
            </span>
            <span class="visually-hidden">{t.campaignOpen}</span>
          </button>

          <div class="band">
            <span class="run-name">{campaign.title}</span>
            <span class="muted run-sub">
              <!-- A campaign's difficulty is its own word -- `standard` or
                   `expert` -- so it reads through the campaign's own labels. -->
              {campaign.run.templateName} · {t.campaignDifficulty(campaign.run.difficulty)}
              {#if signedIn}
                · {storedOnServer.campaigns.has(campaign.run.id) ? t.savedOnServer : t.savedLocalOnly}
              {/if}
            </span>

            <!--
              How far: scenarios beaten out of those the box holds, the bar,
              and every game's result in the order it was played, so a
              campaign that lost twice on the way reads as one that did.
            -->
            <span class="score">
              <span class="score-text">{t.campaignProgress(tile?.beaten ?? campaign.completed, tile?.total ?? campaign.scenarios.length)}</span>
              {#if (tile?.results.length ?? 0) > 0}
                <span class="results" role="img" aria-label={t.campaignResultsLabel(tile?.results.filter(Boolean).length ?? 0, tile?.results.length ?? 0)}>
                  {#each tile?.results ?? [] as won, i (i)}
                    <span class="result" class:won class:lost={!won} aria-hidden="true">{won ? '✓' : '✗'}</span>
                  {/each}
                </span>
              {/if}
            </span>
            <span class="progress" aria-hidden="true">
              <span
                class="fill"
                data-status={status}
                style:width={`${(tile?.total ?? 0) === 0 ? 0 : Math.round(((tile?.beaten ?? 0) / (tile?.total ?? 1)) * 100)}%`}
              ></span>
            </span>

            <span class="tile-actions">
              {#if live}
                <button class="btn btn--primary small" type="button" onclick={() => (view = { kind: 'run', id: campaign.run.id })}>
                  {t.campaignContinue}
                </button>
              {/if}
              <button
                class="btn btn--quiet small"
                type="button"
                aria-expanded={open}
                onclick={() => (openId = open ? null : campaign.run.id)}
              >
                {open ? t.campaignHideDetails : t.campaignDetails}
              </button>
            </span>
          </div>
        </li>

        {#if open}
          <!-- The detail spans the row under its tile: the scenarios, the
               games, the clock, and the way to delete the lot. -->
          <li class="detail surface">
            {#if campaign.notice !== ''}
              <p class="muted note">{campaign.notice}</p>
            {/if}

            <ol class="scenarios">
              {#each campaign.scenarios as scenario (scenario.id)}
                <li class:won={scenario.won} class:attempted={scenario.attempts > 0}>
                  <span class="mark" aria-hidden="true">
                    {scenario.won ? '✓' : scenario.attempts > 0 ? '✗' : '·'}
                  </span>
                  <span class="scenario-name">{scenario.name}</span>
                  {#if scenario.attempts > 1}
                    <span class="muted attempts">{t.attempts(scenario.attempts)}</span>
                  {/if}
                </li>
              {/each}
            </ol>

            {#if campaign.run.timerAccumulatedMillis > 0}
              <p class="muted">
                {t.timePlayed(formatElapsed(campaign.run.timerAccumulatedMillis))}
              </p>
            {/if}

            {#if plays.length > 0}
              <h3 class="games-title">{t.campaignGames}</h3>
              <ul class="games">
                {#each plays as play (play.id)}
                  <PlayRow {t} {uiLocale} {play} />
                {/each}
              </ul>
            {/if}

            {#if deleting === campaign.run.id}
              <div class="confirm">
                <p class="note">
                  {t.campaignDeleteConfirm(
                    plays.length,
                    (eventsByRun.get(campaign.run.id) ?? []).length,
                  )}
                </p>
                <div class="confirm-actions">
                  <button
                    class="btn btn--quiet danger"
                    type="button"
                    disabled={busy}
                    onclick={() => void removeCampaign(campaign.run.id)}
                  >
                    {t.campaignDeleteYes}
                  </button>
                  <button
                    class="btn btn--quiet"
                    type="button"
                    disabled={busy}
                    onclick={() => (deleting = null)}
                  >
                    {t.cancel}
                  </button>
                </div>
              </div>
            {:else}
              <button
                class="btn btn--quiet danger delete-run"
                type="button"
                onclick={() => (deleting = campaign.run.id)}
              >
                {t.campaignDelete}
              </button>
            {/if}

            {#if campaign.unreadEvents > 0}
              <!-- Counted rather than hidden: the log holds more than this
                   page folds, and pretending otherwise would be a lie about
                   how complete the view is. -->
              <p class="muted note">{t.campaignUnread(campaign.unreadEvents)}</p>
            {/if}
          </li>
        {/if}
      {/each}
    </ul>
{/snippet}

<style>
  .section-title {
    font-size: var(--text-lg);
    font-weight: var(--weight-bold);
    margin: var(--space-5) 0 var(--space-2);
  }

  .games-title {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--text-muted);
    margin: var(--space-3) 0 0;
  }

  .games {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .confirm {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border-inline-start: 3px solid var(--danger);
  }

  .confirm .note {
    font-size: var(--text-sm);
    margin: 0;
  }

  .confirm-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .danger {
    color: var(--danger);
  }

  .delete-run {
    justify-self: start;
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

  .note {
    font-size: var(--text-sm);
    max-width: var(--prose-max);
  }

  .runs {
    list-style: none;
    padding: 0;
    margin: var(--space-3) 0 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(17rem, 100%), 1fr));
    gap: var(--space-3);
  }

  /*
   * The tile, held apart from the page by a hairline and a step of surface
   * rather than a shadow, as the reference does it; it lifts a little under
   * the pointer and nothing else moves.
   */
  .tile {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--surface-1);
    border: 1px solid var(--hairline);
    transition: border-color var(--motion-fast) var(--ease-out), transform var(--motion-fast) var(--ease-out);
  }

  .tile:hover,
  .tile.open {
    border-color: var(--accent);
  }

  .tile-head {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    padding: 0;
    border: 0;
    background: var(--surface-2);
    text-align: start;
    cursor: pointer;
    overflow: hidden;
  }

  /*
   * A villain card is a portrait frame with the art in its upper half and the
   * scheme and attack boxes down its left edge. Drawn wider than the tile and
   * pushed left so those boxes fall outside it, and placed so the face sits
   * where the eye lands.
   */
  .art {
    position: absolute;
    left: -26%;
    top: -12%;
    width: 152%;
    height: 124%;
    object-fit: cover;
    object-position: 50% 18%;
    transition: transform var(--motion-base) var(--ease-out);
  }

  /* Key art is drawn for a wide frame; show it whole, the villain and the
     heroes both, rather than the crop that lifts a face out of a card. */
  .art.box {
    inset: 0;
    width: 100%;
    height: 100%;
    object-position: 50% 50%;
  }

  .tile-head:hover .art {
    transform: scale(1.03);
  }

  /* No art: the campaign's own colour, and its initial, large and quiet. */
  .field {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: hsl(var(--field-hue) 32% 24%);
    color: hsl(var(--field-hue) 40% 60% / 55%);
    font-size: 4.5rem;
    font-weight: var(--weight-bold);
    letter-spacing: -0.04em;
  }

  /* Darkens the art's foot so the badge and the band's edge sit on something
     even, whatever the picture does there. */
  .scrim {
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, rgb(0 0 0 / 55%) 0%, rgb(0 0 0 / 0%) 45%);
  }

  /*
   * The status, on the art's corner: a glyph and a word, then a colour --
   * never the colour alone. Opaque, so it reads over any picture.
   */
  .badge {
    position: absolute;
    top: var(--space-2);
    left: var(--space-2);
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 2px var(--space-2) 2px var(--space-1);
    border-radius: var(--radius-pill);
    background: var(--surface-1);
    color: var(--text);
    border: 1px solid var(--hairline);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    line-height: 1.5;
  }

  .badge .glyph {
    display: inline-grid;
    place-items: center;
    width: 1.1rem;
    height: 1.1rem;
    border-radius: 50%;
    font-size: 0.7rem;
    color: var(--surface-1);
    background: var(--text-muted);
  }

  .badge[data-status='won'] .glyph { background: var(--ok); }
  .badge[data-status='lost'] .glyph,
  .badge[data-status='conceded'] .glyph { background: var(--danger); }
  .badge[data-status='in-progress'] .glyph { background: var(--accent); color: var(--accent-ink); }

  .band {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-3);
  }

  .run-name {
    font-weight: var(--weight-bold);
    font-size: var(--text-lg);
    line-height: var(--leading-snug);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .run-sub {
    font-size: var(--text-sm);
  }

  .score {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1) var(--space-2);
    margin-top: var(--space-1);
    font-size: var(--text-sm);
  }

  /* Every game in order, a tick or a cross each; a defeat on the way to a
     won campaign stays visible, because it happened. */
  .results {
    display: inline-flex;
    gap: 2px;
  }

  .result {
    display: inline-grid;
    place-items: center;
    width: 1.1rem;
    height: 1.1rem;
    border-radius: var(--radius-xs);
    font-size: 0.7rem;
    font-weight: var(--weight-bold);
    color: var(--surface-1);
  }

  .result.won { background: var(--ok); }
  .result.lost { background: var(--danger); }

  .progress {
    display: block;
    height: 0.375rem;
    border-radius: var(--radius-pill);
    background: var(--surface-2);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .fill[data-status='won'] { background: var(--ok); }
  .fill[data-status='lost'],
  .fill[data-status='conceded'] { background: var(--danger); }

  .tile-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .small {
    min-height: 2.25rem;
    padding-block: var(--space-1);
    font-size: var(--text-sm);
  }

  /* The opened tile's detail, across the whole row beneath it. */
  .detail {
    grid-column: 1 / -1;
    padding: var(--space-3) var(--space-4);
  }

  .scenarios {
    list-style: none;
    padding: 0;
    margin: 0 0 var(--space-3);
    display: grid;
    gap: var(--space-1);
  }

  .scenarios li {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  .mark {
    width: 1rem;
    color: var(--text-muted);
  }

  .scenarios li.won .mark {
    color: var(--accent);
  }

  .scenarios li.attempted:not(.won) .mark {
    color: var(--danger);
  }

  .scenarios li:not(.attempted) .scenario-name {
    color: var(--text-muted);
  }

  .attempts {
    font-size: var(--text-sm);
  }
</style>
