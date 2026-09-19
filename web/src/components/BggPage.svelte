<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Locale } from '../lib/types';
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import { session } from '../lib/sync/session.svelte';
  import { ApiError, version as serverVersion } from '../lib/sync/api';
  import {
    BGG_MODES,
    bgg,
    bggProfileUrl,
    bggRelayReady,
    connectBgg,
    disconnectBgg,
    setBggMode,
    setBggUsername,
    verifyBgg,
    type BggMode,
  } from '../lib/bgg.svelte';

  /**
   * BoardGameGeek, as a page of its own under Settings.
   *
   * Laid out the way the phone lays it out: what BGG is and what goes there,
   * who this browser is connected as, the sign-in, when games are sent, and
   * the way out. The warning on the form is not boilerplate — BGG has no token
   * or OAuth flow, so this is the one place the site asks for a password that
   * is not its own, and the person deserves to know where it goes before
   * typing it rather than after.
   */

  interface Props {
    t: Strings;
    uiLocale: Locale;
    storageOk: boolean;
    onBack: () => void;
  }

  const { t, uiLocale, storageOk, onBack }: Props = $props();

  let username = $state(bgg.username);
  let password = $state('');
  let verifying = $state(false);
  let error = $state<string | null>(null);
  let confirmingDisconnect = $state(false);

  const signedIn = $derived(session.status === 'signed-in' && session.account !== null);
  const connected = $derived(bggRelayReady());

  /*
   * Whether this instance relays at all, asked once. Absent on an older
   * server, and then the form is offered and the refusal explains itself.
   */
  let relayOff = $state(false);
  $effect(() => {
    void serverVersion(uiLocale)
      .then((v) => {
        relayOff = v.bggRelay === false;
      })
      .catch(() => undefined);
  });

  /** How many of this browser's games are on BGG, for the sync line. */
  let synced = $state(0);
  $effect(() => {
    if (!storageOk) {
      return;
    }
    const sub = liveQuery(() =>
      db.plays.filter((play) => play.reportedToBgg === true && (play.deletedAt ?? null) === null).count(),
    ).subscribe((n) => {
      synced = n;
    });
    return () => sub.unsubscribe();
  });

  async function connect(): Promise<void> {
    if (verifying || username.trim() === '' || password === '') {
      return;
    }
    error = null;
    verifying = true;
    try {
      // Checked against BGG before anything is stored, so a typo is caught
      // while the person is still looking at the form.
      await verifyBgg(username, password, uiLocale);
      connectBgg(username, password);
      password = '';
      // Connecting is for sending; off would leave the connection idle until
      // somebody found the chips. Ask, not always: sending stays a choice.
      if (bgg.mode === 'off') {
        setBggMode('ask');
      }
    } catch (cause) {
      error = cause instanceof ApiError ? t.bggError(cause.code) : t.bggError('server_error');
    } finally {
      verifying = false;
    }
  }

  function disconnect(): void {
    disconnectBgg();
    username = '';
    password = '';
    confirmingDisconnect = false;
    error = null;
  }

  const modeLabel = (mode: BggMode): string =>
    ({ off: t.bggModeOff, ask: t.bggModeAsk, always: t.bggModeAlways })[mode];
  const modeDetail = (mode: BggMode): string =>
    ({ off: t.bggModeOffDetail, ask: t.bggModeAskDetail, always: t.bggModeAlwaysDetail })[mode];
</script>

<section>
  <button class="back" type="button" onclick={onBack}>← {t.settingsTitle}</button>
  <h1>{t.bggTitle}</h1>

  <div class="panel">
    <h2>{t.bggAboutTitle}</h2>
    <p class="muted note">{t.bggAbout}</p>
  </div>

  <div class="panel">
    <!-- Who this browser is on BGG, said first, as the phone says it. -->
    <p class="who" class:muted={!connected}>
      {connected ? t.bggConnectedAs(bgg.username) : t.bggNotConnected}
    </p>
    {#if bgg.username !== ''}
      <p class="muted note">
        <a href={bggProfileUrl(bgg.username)} target="_blank" rel="noreferrer noopener">
          {t.bggOpenProfile}
        </a>
      </p>
    {/if}
  </div>

  <div class="panel">
    <h2>{t.bggSignInTitle}</h2>
    {#if connected}
      <p class="status ok"><span class="mark" aria-hidden="true">✓</span> {t.bggLoginOk}</p>
    {:else}
      {#if relayOff}
        <p class="muted note">{t.bggRelayOff}</p>
      {:else if !signedIn}
        <p class="muted note">{t.bggNeedsAccount}</p>
      {/if}
      <form
        onsubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <label class="field-group">
          <span class="field-label">{t.bggUsername}</span>
          <input
            class="field"
            type="text"
            autocomplete="username"
            bind:value={username}
            onchange={() => setBggUsername(username)}
            disabled={verifying}
          />
          <span class="muted note">{t.bggNote}</span>
        </label>
        {#if signedIn && !relayOff}
          <label class="field-group">
            <span class="field-label">{t.bggPassword}</span>
            <input
              class="field"
              type="password"
              autocomplete="current-password"
              bind:value={password}
              disabled={verifying}
            />
          </label>
          <p class="warning note">{t.bggPasswordWarning}</p>
          {#if error !== null}
            <p class="status danger-text" role="alert">{error}</p>
          {/if}
          <div class="btn-row">
            <button
              class="btn btn--primary"
              type="submit"
              disabled={verifying || username.trim() === '' || password === ''}
            >
              {verifying ? t.bggVerifying : t.bggConnect}
            </button>
          </div>
        {/if}
      </form>
    {/if}
  </div>

  {#if connected}
    <div class="panel">
      <h2>{t.bggSyncTitle}</h2>
      <p class="status" class:ok={synced > 0}>
        {#if synced > 0}<span class="mark" aria-hidden="true">✓</span>{/if}
        {t.bggSynced(synced)}
      </p>
      <div class="chip-row">
        {#each BGG_MODES as mode (mode)}
          <button
            type="button"
            class="chip"
            aria-pressed={bgg.mode === mode}
            onclick={() => setBggMode(mode)}
          >
            {modeLabel(mode)}
          </button>
        {/each}
      </div>
      <p class="muted note">{modeDetail(bgg.mode)}</p>
      {#if !signedIn}
        <p class="muted note">{t.bggNeedsAccount}</p>
      {/if}
    </div>

    <div class="panel">
      {#if confirmingDisconnect}
        <p class="note">{t.bggDisconnectConfirm}</p>
        <div class="btn-row">
          <button class="btn danger" type="button" onclick={disconnect}>{t.bggDisconnect}</button>
          <button class="btn btn--quiet" type="button" onclick={() => (confirmingDisconnect = false)}>
            {t.cancel}
          </button>
        </div>
      {:else}
        <div class="btn-row">
          <button class="btn" type="button" onclick={() => (confirmingDisconnect = true)}>
            {t.bggDisconnect}
          </button>
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  h1 {
    font-size: var(--text-2xl);
    margin: var(--space-2) 0 var(--space-3);
  }

  h2 {
    font-size: var(--text-lg);
    font-weight: var(--weight-bold);
    margin-bottom: var(--space-2);
  }

  .back {
    border: 0;
    background: none;
    padding: var(--space-2) 0;
    color: var(--accent);
    font: inherit;
    font-weight: var(--weight-semibold);
    cursor: pointer;
  }

  .panel {
    margin: var(--space-3) 0;
    max-width: var(--prose-max);
    display: grid;
    gap: var(--space-3);
  }

  .note {
    font-size: var(--text-sm);
  }

  .who {
    font-size: var(--text-xl);
    font-weight: var(--weight-bold);
    margin: 0;
  }

  .status {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
  }

  /* The green tick beside a line that is good news, as on the phone. */
  .mark {
    display: inline-grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 50%;
    background: var(--ok);
    color: var(--surface-1);
    font-weight: var(--weight-bold);
    flex: none;
  }

  .warning {
    color: var(--danger);
    font-weight: var(--weight-semibold);
    margin: 0;
  }

  .danger {
    color: var(--danger);
    border-color: var(--danger);
  }

  .danger-text {
    color: var(--danger);
  }
</style>
