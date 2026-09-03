<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Locale } from '../lib/types';
  import { ApiError, type DeviceInfo, type Registration } from '../lib/sync/api';
  import * as api from '../lib/sync/api';
  import {
    recover,
    register,
    session,
    signIn,
    signOut,
    suggestDeviceName,
  } from '../lib/sync/session.svelte';

  interface Props {
    t: Strings;
    uiLocale: Locale;
    storageOk: boolean;
  }

  const { t, uiLocale, storageOk }: Props = $props();

  type Form = 'signin' | 'register' | 'recover';

  let form = $state<Form>('signin');
  let handle = $state('');
  let password = $state('');
  let recoveryCode = $state('');
  let deviceName = $state(suggestDeviceName());
  let error = $state<string | null>(null);

  /**
   * The recovery code, shown exactly once.
   *
   * The server keeps only its Argon2id hash, so this is the only time it will
   * ever exist in readable form. That is the whole reason an account here needs
   * no email address, and the reason this screen refuses to move on until
   * somebody has said they have kept it.
   */
  let issued = $state.raw<Registration | null>(null);
  let saved = $state(false);

  let devices = $state.raw<readonly DeviceInfo[]>([]);

  /*
   * Whether this instance takes new accounts.
   *
   * Asked rather than assumed, and undefined until the answer arrives, so a
   * slow network shows neither a form that will be refused nor a refusal that
   * is not true. An older server says nothing and the form is offered.
   */
  let registrationOpen = $state<boolean | null>(null);

  $effect(() => {
    let cancelled = false;
    void api
      .version(uiLocale)
      .then((info) => {
        if (!cancelled) {
          registrationOpen = info.registrationOpen ?? true;
        }
      })
      .catch(() => {
        if (!cancelled) {
          registrationOpen = true;
        }
      });
    return () => {
      cancelled = true;
    };
  });

  // A closed instance cannot show the register tab, so it must not be the
  // selected one either — a deep link or a stale state would otherwise leave
  // somebody on a form that cannot succeed.
  $effect(() => {
    if (registrationOpen === false && form === 'register') {
      form = 'signin';
    }
  });

  $effect(() => {
    const account = session.account;
    if (account === null) {
      devices = [];
      return;
    }
    let cancelled = false;
    void api
      .listDevices(account.token, uiLocale)
      .then((list) => {
        if (!cancelled) {
          devices = list;
        }
      })
      .catch(() => {
        if (!cancelled) {
          devices = [];
        }
      });
    return () => {
      cancelled = true;
    };
  });

  /** The server's code, said in the reader's language. Its message is for curl. */
  function say(cause: unknown): string {
    if (cause instanceof ApiError) {
      return t.accountError(cause.code);
    }
    return t.accountError('server_error');
  }

  async function submit(): Promise<void> {
    error = null;
    const name = deviceName.trim() === '' ? suggestDeviceName() : deviceName.trim();
    try {
      if (form === 'register') {
        issued = await register(handle.trim(), password, name, uiLocale);
      } else if (form === 'recover') {
        issued = await recover(handle.trim(), recoveryCode.trim(), password, name, uiLocale);
      } else {
        await signIn(handle.trim(), password, name, uiLocale);
      }
      password = '';
      recoveryCode = '';
    } catch (cause) {
      error = say(cause);
    }
  }

  function downloadCode(): void {
    const code = issued;
    if (code === null) {
      return;
    }
    const text = t.recoveryFileBody(code.handle, code.recoveryCode);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `thwart-recovery-${code.handle}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    saved = true;
  }

  async function leave(): Promise<void> {
    error = null;
    try {
      await signOut(uiLocale);
    } catch (cause) {
      error = say(cause);
    }
  }

  const canSubmit = $derived(
    handle.trim() !== '' &&
      password !== '' &&
      (form !== 'recover' || recoveryCode.trim() !== '') &&
      !session.busy,
  );
</script>

<section>
  <h1>{t.accountTitle}</h1>

  {#if !storageOk}
    <div class="panel"><p>{t.storageUnavailable}</p></div>
  {:else if issued !== null}
    <!--
      The one screen in the app that refuses to be dismissed.

      This code is the only way back into the account, it exists in readable
      form exactly once, and there is no email address to fall back on. Moving
      on before it is saved is the one mistake nobody can undo for you.
    -->
    {@const code = issued}
    <div class="panel recovery">
      <h2>{t.recoveryTitle}</h2>
      <p class="note">{t.recoveryIntro}</p>

      <p class="code">{code.recoveryCode}</p>

      <div class="btn-row">
        <button class="btn btn--primary" type="button" onclick={downloadCode}>
          {t.recoveryDownload}
        </button>
        <button
          class="btn"
          type="button"
          onclick={() => {
            void navigator.clipboard?.writeText(code.recoveryCode);
            saved = true;
          }}
        >
          {t.recoveryCopy}
        </button>
      </div>

      <label class="tick">
        <input type="checkbox" checked={saved} onchange={(e) => (saved = e.currentTarget.checked)} />
        <span>{t.recoverySaved}</span>
      </label>

      <button class="btn btn--primary" type="button" disabled={!saved} onclick={() => (issued = null)}>
        {t.recoveryDone}
      </button>
    </div>
  {:else if session.status === 'signed-in' && session.account !== null}
    {@const account = session.account}
    <div class="panel">
      <p class="eyebrow">{t.accountSignedInAs}</p>
      <p class="who">{account.handle}</p>
      <p class="muted note">{t.accountDeviceIs(account.deviceName)}</p>

      <!--
        Said plainly rather than implied by an idle spinner. Nothing moves yet:
        the transport exists and the engine that would use it does not, and a
        screen that looked like it was syncing would be lying.
      -->
      <p class="notice">{t.accountSyncNotYet}</p>
    </div>

    {#if devices.length > 0}
      <div class="panel">
        <h2>{t.accountDevices}</h2>
        <ul class="devices">
          {#each devices as device (device.id)}
            <li>
              <span class="name">{device.name}</span>
              {#if device.current}<span class="chip is-on">{t.accountThisDevice}</span>{/if}
              <span class="muted when">{new Date(device.lastSeen).toLocaleDateString(uiLocale)}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <div class="panel">
      <h2>{t.accountLeaving}</h2>
      <p class="muted note">{t.accountSignOutKeeps}</p>
      <div class="btn-row">
        <button class="btn" type="button" disabled={session.busy} onclick={leave}>
          {t.accountSignOut}
        </button>
      </div>
    </div>
  {:else}
    <div class="panel">
      <div class="chip-row tabs">
        <button
          class="chip"
          type="button"
          aria-pressed={form === 'signin'}
          onclick={() => ((form = 'signin'), (error = null))}
        >
          {t.accountSignIn}
        </button>
        {#if registrationOpen !== false}
          <button
            class="chip"
            type="button"
            aria-pressed={form === 'register'}
            onclick={() => ((form = 'register'), (error = null))}
          >
            {t.accountCreate}
          </button>
        {/if}
        <button
          class="chip"
          type="button"
          aria-pressed={form === 'recover'}
          onclick={() => ((form = 'recover'), (error = null))}
        >
          {t.accountForgot}
        </button>
      </div>

      {#if registrationOpen === false}
        <p class="notice">{t.accountClosed}</p>
      {:else if form === 'register'}
        <p class="muted note">{t.accountNoEmail}</p>
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

        {#if form === 'recover'}
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
            {form === 'signin' ? t.accountPassword : t.accountNewPassword}
          </span>
          <input
            class="field"
            type="password"
            autocomplete={form === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            oninput={(e) => (password = e.currentTarget.value)}
          />
        </label>

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

        {#if error !== null}
          <p class="warning">{error}</p>
        {/if}

        <button class="btn btn--primary btn--block" type="submit" disabled={!canSubmit}>
          {form === 'signin'
            ? t.accountSignIn
            : form === 'register'
              ? t.accountCreate
              : t.accountRecoverAction}
        </button>
      </form>
    </div>

    <div class="panel">
      <h2>{t.accountWhy}</h2>
      <p class="note">{t.accountWhyBody}</p>
      <p class="muted note">{t.accountPrivacy}</p>
    </div>
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
    margin-bottom: var(--space-2);
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

  .tabs {
    margin-bottom: var(--space-2);
  }

  .who {
    font-size: var(--text-xl);
    font-weight: var(--weight-bold);
  }

  /*
   * Monospaced and spaced out, because this is copied by hand off a screen.
   * The alphabet already excludes look-alike characters; the type should not
   * put them back.
   */
  .code {
    font-family: var(--font-mono);
    font-size: var(--text-xl);
    font-weight: var(--weight-bold);
    letter-spacing: 0.08em;
    padding: var(--space-4);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border: 1px dashed var(--border);
    word-break: break-all;
    text-align: center;
  }

  .recovery {
    border-color: var(--accent);
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

  .devices {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: var(--space-2);
  }

  .devices li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding-block: var(--space-1);
  }

  .devices .name {
    font-weight: var(--weight-semibold);
    flex: 1 1 8rem;
  }

  .when {
    font-size: var(--text-sm);
  }
</style>
