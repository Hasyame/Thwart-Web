<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Locale } from '../lib/types';
  import { ApiError, type Registration } from '../lib/sync/api';
  import { recover, register, session, signIn, suggestDeviceName } from '../lib/sync/session.svelte';

  /**
   * Signing in, wherever it is asked for.
   *
   * The same fields appear on the account page and in the menu that drops out
   * of the top bar, and they must behave identically: one of them is where
   * somebody signs in every day and the other is where they first arrive.
   * Written once so the two cannot drift into disagreeing about what a
   * password field autocompletes as.
   */

  export type FormMode = 'signin' | 'register' | 'recover';

  interface Props {
    t: Strings;
    uiLocale: Locale;
    mode: FormMode;
    /** Whether this instance takes new accounts. Null while it is being asked. */
    registrationOpen: boolean | null;
    onMode: (mode: FormMode) => void;
    /**
     * Called with the recovery code when one has just been issued.
     *
     * The caller decides where it is shown, because it needs room and must not
     * be dismissable by accident: the menu hands it to the account page rather
     * than trying to fit it into a drop-down.
     */
    onIssued: (registration: Registration) => void;
    /** Called on a plain sign-in, which produces nothing to show. */
    onSignedIn: () => void;
    /** Hides the create and recover tabs where there is no room for them. */
    compact?: boolean;
  }

  const {
    t,
    uiLocale,
    mode,
    registrationOpen,
    onMode,
    onIssued,
    onSignedIn,
    compact = false,
  }: Props = $props();

  let handle = $state('');
  let password = $state('');
  let recoveryCode = $state('');
  let deviceName = $state(suggestDeviceName());
  let error = $state<string | null>(null);

  /** The server's code, said in the reader's language. Its message is for curl. */
  const say = (cause: unknown): string =>
    t.accountError(cause instanceof ApiError ? cause.code : 'server_error');

  async function submit(): Promise<void> {
    error = null;
    const name = deviceName.trim() === '' ? suggestDeviceName() : deviceName.trim();
    try {
      if (mode === 'register') {
        onIssued(await register(handle.trim(), password, name, uiLocale));
      } else if (mode === 'recover') {
        onIssued(await recover(handle.trim(), recoveryCode.trim(), password, name, uiLocale));
      } else {
        await signIn(handle.trim(), password, name, uiLocale);
        onSignedIn();
      }
      password = '';
      recoveryCode = '';
    } catch (cause) {
      error = say(cause);
    }
  }

  const canSubmit = $derived(
    handle.trim() !== '' &&
      password !== '' &&
      (mode !== 'recover' || recoveryCode.trim() !== '') &&
      !session.busy,
  );
</script>

{#if !compact}
  <div class="chip-row">
    <button
      class="chip"
      type="button"
      aria-pressed={mode === 'signin'}
      onclick={() => (onMode('signin'), (error = null))}
    >
      {t.accountSignIn}
    </button>
    {#if registrationOpen !== false}
      <button
        class="chip"
        type="button"
        aria-pressed={mode === 'register'}
        onclick={() => (onMode('register'), (error = null))}
      >
        {t.accountCreate}
      </button>
    {/if}
    <button
      class="chip"
      type="button"
      aria-pressed={mode === 'recover'}
      onclick={() => (onMode('recover'), (error = null))}
    >
      {t.accountForgot}
    </button>
  </div>

  {#if registrationOpen === false}
    <p class="notice">{t.accountClosed}</p>
  {:else if mode === 'register'}
    <p class="muted note">{t.accountNoEmail}</p>
  {/if}
{/if}

<form
  class="stack-4"
  onsubmit={(event) => {
    event.preventDefault();
    void submit();
  }}
>
  <label class="field-group">
    <span class="field-label">{t.accountHandle}</span>
    <input
      class="field"
      type="text"
      autocomplete="username"
      autocapitalize="none"
      spellcheck="false"
      value={handle}
      oninput={(e) => (handle = e.currentTarget.value)}
    />
  </label>

  {#if mode === 'recover'}
    <label class="field-group">
      <span class="field-label">{t.accountRecoveryCode}</span>
      <input
        class="field"
        type="text"
        autocapitalize="characters"
        spellcheck="false"
        value={recoveryCode}
        oninput={(e) => (recoveryCode = e.currentTarget.value)}
      />
    </label>
  {/if}

  <label class="field-group">
    <span class="field-label">
      {mode === 'signin' ? t.accountPassword : t.accountNewPassword}
    </span>
    <input
      class="field"
      type="password"
      autocomplete={mode === 'signin' ? 'current-password' : 'new-password'}
      value={password}
      oninput={(e) => (password = e.currentTarget.value)}
    />
  </label>

  {#if !compact}
    <label class="field-group">
      <span class="field-label">{t.accountDeviceName}</span>
      <input
        class="field"
        type="text"
        value={deviceName}
        oninput={(e) => (deviceName = e.currentTarget.value)}
      />
      <span class="muted note">{t.accountDeviceNameNote}</span>
    </label>
  {/if}

  {#if error !== null}
    <p class="warning" role="alert">{error}</p>
  {/if}

  <button class="btn btn--primary btn--block" type="submit" disabled={!canSubmit}>
    {mode === 'signin'
      ? t.accountSignIn
      : mode === 'register'
        ? t.accountCreate
        : t.accountRecoverAction}
  </button>
</form>

<style>
  .note {
    font-size: var(--text-sm);
  }

  .notice {
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border-inline-start: 3px solid var(--accent);
    font-size: var(--text-sm);
  }

  .warning {
    color: var(--danger);
    font-weight: var(--weight-semibold);
  }
</style>
