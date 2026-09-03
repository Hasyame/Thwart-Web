<script lang="ts">
  import { liveQuery } from 'dexie';
  import type { CampaignEvent, CampaignRun, Play } from '../lib/records';
  import type { CardSet, Locale } from '../lib/types';
  import type { Strings } from '../lib/i18n';
  import { db } from '../lib/db';
  import { foldCampaign, type CampaignProgress } from '../lib/campaigns';
  import { formatElapsed } from '../lib/session.svelte';
  import type { IndexRow } from '../lib/types';
  import type { SavedDeck } from '../lib/records';
  import StartCampaign from './StartCampaign.svelte';
  import CampaignRunView from './CampaignRun.svelte';

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

  let openId = $state<string | null>(null);
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
    <ul class="runs">
      {#each campaigns as campaign (campaign.run.id)}
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
                <p class="muted">{t.campaignPlays(plays.length)}</p>
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
  {/if}
  {/if}
</section>

<style>
  .start-button {
    display: block;
    margin: var(--space-4) 0;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-lg);
    border: 1px solid var(--md-primary);
    background: var(--md-primary);
    color: var(--md-on-primary);
    font-weight: 700;
    cursor: pointer;
  }

  h1 {
    font-size: 1.6rem;
    margin: var(--space-5) 0 var(--space-3);
  }

  .notice {
    padding: var(--space-4);
    margin: var(--space-3) 0;
    max-width: var(--prose-max);
  }

  .note {
    font-size: 0.85rem;
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
    border-color: var(--md-primary);
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
    font-size: 1.05rem;
  }

  .run-sub {
    font-size: 0.85rem;
  }

  .progress {
    display: block;
    height: 0.5rem;
    border-radius: var(--radius-sm);
    background: var(--md-surface-container-high);
    overflow: hidden;
    margin-top: var(--space-1);
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--md-primary);
  }

  .detail {
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--md-outline-variant);
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
    color: var(--md-on-surface-variant);
  }

  .scenarios li.won .mark {
    color: var(--md-primary);
  }

  .scenarios li.attempted:not(.won) .mark {
    color: var(--md-error);
  }

  .scenarios li:not(.attempted) .scenario-name {
    color: var(--md-on-surface-variant);
  }

  .attempts {
    font-size: 0.85rem;
  }

  .open-run {
    display: block;
    margin: var(--space-3) 0 var(--space-2);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-lg);
    border: 1px solid var(--md-primary);
    background: var(--md-primary);
    color: var(--md-on-primary);
    font-weight: 700;
    cursor: pointer;
  }
</style>
