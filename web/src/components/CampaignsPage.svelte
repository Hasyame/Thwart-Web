<script lang="ts">
  import { liveQuery } from 'dexie';
  import type { CampaignEvent, CampaignRun, Play } from '../lib/records';
  import type { CardSet, Locale } from '../lib/types';
  import type { Strings } from '../lib/i18n';
  import { db } from '../lib/db';
  import { session } from '../lib/sync/session.svelte';
  import { storedOnServer } from '../lib/sync/stored.svelte';
  import { foldCampaign, type CampaignProgress } from '../lib/campaigns';
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
  }

  const { t, uiLocale, cardLocale, index, sets, storageOk }: Props = $props();

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
  const inProgress = $derived(
    campaigns.filter((campaign) => !campaign.run.finished && !campaign.conceded),
  );
  const finished = $derived(
    campaigns.filter((campaign) => campaign.run.finished || campaign.conceded),
  );

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
    <h1>{t.campaignsTitle}</h1>
  {/if}

  {#if storageOk && view.kind === 'list'}
    <button class="start-button" type="button" onclick={() => (view = { kind: 'start' })}>
      {t.startCampaign}
    </button>
  {/if}

  {#if view.kind === 'start'}
    <StartCampaign
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
        <li class="surface run" class:open>
          <button
            type="button"
            class="run-head"
            aria-expanded={open}
            onclick={() => (openId = open ? null : campaign.run.id)}
          >
            <span class="run-name">{campaign.title}</span>
            <span class="muted run-sub">
              <!-- A campaign's difficulty is its own word — `standard` or
                   `expert` — not one of the play page's set names, so it reads
                   through the campaign's own labels rather than falling back to
                   printing the raw token. -->
              {campaign.run.templateName} · {t.campaignDifficulty(campaign.run.difficulty)}
              · {t.campaignProgress(campaign.completed, campaign.scenarios.length)}
              {#if campaign.conceded}· {t.campaignConceded}{/if}
              {#if campaign.run.finished}· {t.campaignFinished}{/if}
              <!--
                Where the campaign is kept. Signing out takes the account's
                campaigns and leaves the ones this browser made before signing
                in, and the two are otherwise indistinguishable in this list.
              -->
              {#if signedIn}
                · {storedOnServer.campaigns.has(campaign.run.id)
                  ? t.savedOnServer
                  : t.savedLocalOnly}
              {/if}
            </span>
            <span class="progress" aria-hidden="true">
              <span
                class="fill"
                style:width={`${
                  campaign.scenarios.length === 0
                    ? 0
                    : Math.round((campaign.completed / campaign.scenarios.length) * 100)
                }%`}
              ></span>
            </span>
          </button>

          {#if open}
            <div class="detail">
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

              {#if !campaign.run.finished && !campaign.conceded}
                <button
                  class="open-run"
                  type="button"
                  onclick={() => (view = { kind: 'run', id: campaign.run.id })}
                >
                  {t.campaignOpen}
                </button>
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
            </div>
          {/if}
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
    margin: var(--space-4) 0 0;
    display: grid;
    gap: var(--space-2);
  }

  .run {
    padding: var(--space-3) var(--space-4);
  }

  .run.open {
    border-color: var(--accent);
  }

  .run-head {
    display: grid;
    gap: var(--space-1);
    width: 100%;
    border: 0;
    background: none;
    color: inherit;
    text-align: start;
    padding: var(--space-1) 0;
    cursor: pointer;
  }

  .run-name {
    font-weight: 600;
    font-size: var(--text-lg);
  }

  .run-sub {
    font-size: var(--text-sm);
  }

  .progress {
    display: block;
    height: 0.5rem;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    overflow: hidden;
    margin-top: var(--space-1);
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .detail {
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--hairline);
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

  .open-run {
    display: block;
    margin: var(--space-3) 0 var(--space-2);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-lg);
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 700;
    cursor: pointer;
  }
</style>
