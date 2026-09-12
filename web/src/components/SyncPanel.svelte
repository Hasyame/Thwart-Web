<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Locale } from '../lib/types';
  import { session } from '../lib/sync/session.svelte';
  import {
    acceptAdoption,
    cancelAdoption,
    runSync,
    sync,
    turnOff,
    turnOn,
    dismissRejected,
  } from '../lib/sync/sync.svelte';
  import { autoSync, setAutoSync } from '../lib/sync/auto.svelte';
  import { live } from '../lib/sync/live.svelte';

  /**
   * The switch, and the conversation behind it.
   *
   * Signing in recorded a token. This is where somebody decides whether this
   * browser keeps in step, and the first time they do, it stops and shows them
   * exactly what merging would move before it moves anything. That step is not
   * politeness: it is the difference between a feature people trust and one
   * that eats a stranger's campaign log the first time they try it.
   */

  interface Props {
    t: Strings;
    uiLocale: Locale;
  }

  const { t, uiLocale }: Props = $props();

  const token = $derived(session.account?.token ?? null);
  const busy = $derived(sync.phase.kind === 'staging' || sync.phase.kind === 'working');
  const on = $derived(sync.phase.kind === 'on');

  async function toggle(): Promise<void> {
    if (token === null) {
      return;
    }
    if (on) {
      turnOff();
      return;
    }
    await turnOn(token, uiLocale);
  }
</script>

<div class="panel">
  <h2>{t.syncTitle}</h2>

  <label class="tick">
    <input
      type="checkbox"
      checked={on}
      disabled={busy || token === null}
      onchange={() => void toggle()}
    />
    <span>{t.syncSwitch}</span>
  </label>
  <p class="muted note">{t.syncSwitchNote}</p>

  <!--
    The connection, said quietly or not at all.

    Offline is a normal state for this app — somebody is on a train, or at a
    table with bad wifi — so it is never an error and never red. Connected says
    nothing, because the absence of a problem is not news. The only thing worth
    a line is that changes are waiting, which is information the reader can act
    on by finding a signal.
  -->
  {#if live.state === 'offline'}
    <p class="muted note" aria-live="polite">{t.liveOffline}</p>
  {:else if live.state === 'live'}
    <p class="muted note quiet" aria-live="polite">{t.liveOn}</p>
  {/if}

  <!--
    Automatic syncing, which is a second question and not a stronger version of
    the first.

    Offered only once this browser is actually in step, because a switch that
    can do nothing is worse than one that is not there. The choice is kept on
    this device and never travels: the settings record is fixed at five keys by
    the contract with the Android app, and it is a per-device answer in any
    case — a browser on a shared machine should not start reaching for the
    account because a phone was told to.
  -->
  <label class="tick" class:unavailable={!sync.adopted}>
    <input
      type="checkbox"
      checked={autoSync.enabled}
      disabled={!sync.adopted}
      onchange={(event) => setAutoSync(event.currentTarget.checked)}
    />
    <span>{t.autoSyncSwitch}</span>
  </label>
  <p class="muted note">{t.autoSyncNote}</p>

  {#if sync.phase.kind === 'staging'}
    <p class="notice">{t.syncStaging}</p>
  {:else if sync.phase.kind === 'working'}
    <p class="notice">{t.syncWorking}</p>
  {:else if sync.phase.kind === 'failed'}
    <p class="warning" role="alert">{t.accountError(sync.phase.code)}</p>
  {:else if sync.phase.kind === 'asking'}
    {@const plan = sync.phase.summary}
    <!--
      Counted before anything is written, and phrased as what will happen rather
      than as a number of records: "128 plays" is a thing somebody recognises,
      "128 records" is not.
    -->
    <div class="ask">
      <h3>{t.syncAdoptTitle}</h3>

      {#if plan.incoming + plan.local + plan.merged === 0}
        <p class="note">{t.syncAdoptNothing}</p>
      {:else}
        <ul class="tallies">
          {#each plan.tallies as tally (tally.collection)}
            <li>
              <span class="what">{t.collectionName(tally.collection)}</span>
              <span class="muted counts">
                {#if tally.incoming > 0}<span>{t.syncArriving(tally.incoming)}</span>{/if}
                {#if tally.local > 0}<span>{t.syncUploading(tally.local)}</span>{/if}
                {#if tally.merged > 0}<span>{t.syncMerging(tally.merged)}</span>{/if}
              </span>
            </li>
          {/each}
        </ul>

        {#if plan.forks > 0}
          <!--
            Named on its own, because it is the one outcome that produces
            something the reader did not have before and has to understand.

            Without the second line somebody sees a deck they did not make and
            concludes that syncing duplicated it. It did not: the same deck was
            edited in two places and neither edit is safe to throw away.
          -->
          <p class="note">{t.syncForkNote(plan.forks)}</p>
          <p class="muted note">{t.syncForkExplain}</p>
        {/if}
      {/if}

      <p class="muted note">{t.syncAdoptKeeps}</p>

      <div class="btn-row">
        <button
          class="btn btn--primary"
          type="button"
          disabled={busy}
          onclick={() => void acceptAdoption(token ?? '', uiLocale)}
        >
          {t.syncAdoptGo}
        </button>
        <button class="btn" type="button" disabled={busy} onclick={cancelAdoption}>
          {t.cancel}
        </button>
      </div>
    </div>
  {:else if sync.phase.kind === 'on'}
    {@const last = sync.phase.last}
    <p class="notice">
      {#if last === null}
        {t.syncOn}
      {:else}
        {t.syncDone(last.pulled, last.pushed)}
      {/if}
    </p>
    {#if last?.stoppedBecause === 'push_failed'}
      <p class="warning" role="alert">{t.syncStopped}</p>
    {/if}
    {#if sync.rejected.length > 0}
      <!-- Kept until dismissed, not until the next sync, which is often
           seconds later. The records are already gone from this browser; this
           is what happened to them. -->
      <p class="warning" role="status">
        {t.ratingRejected(sync.rejected.length)}
        <button class="btn btn--quiet small" type="button" onclick={dismissRejected}>{t.close}</button>
      </p>
    {/if}
    <div class="btn-row">
      <button
        class="btn"
        type="button"
        disabled={busy}
        onclick={() => void runSync(token ?? '', uiLocale)}
      >
        {t.syncNow}
      </button>
    </div>
  {/if}
</div>

<style>
  .panel {
    margin: var(--space-3) 0;
    max-width: var(--prose-max);
    display: grid;
    gap: var(--space-3);
  }

  h2 {
    font-size: var(--text-lg);
    font-weight: var(--weight-bold);
    margin-bottom: var(--space-2);
  }

  h3 {
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
  }


  .unavailable {
    opacity: 0.6;
  }

  /* Present for anyone who looks for it, and not competing for attention. */
  .quiet {
    opacity: 0.7;
  }

  .note {
    font-size: var(--text-sm);
    margin: 0;
  }

  .notice {
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border-inline-start: 3px solid var(--accent);
    font-size: var(--text-sm);
    margin: 0;
  }

  .warning {
    color: var(--danger);
    font-weight: var(--weight-semibold);
    margin: 0;
  }

  .ask {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border: 1px solid var(--border);
  }

  .tallies {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }

  .tallies li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--hairline);
  }

  .what {
    font-weight: var(--weight-semibold);
  }

  .counts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
  }
</style>
