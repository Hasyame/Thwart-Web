<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Locale } from '../lib/types';
  import { ApiError, type DeviceInfo, type Registration } from '../lib/sync/api';
  import * as api from '../lib/sync/api';
  import { session, signOut } from '../lib/sync/session.svelte';
  import SignInForm, { type FormMode } from './SignInForm.svelte';
  import SyncPanel from './SyncPanel.svelte';

  interface Props {
    t: Strings;
    uiLocale: Locale;
    storageOk: boolean;
    /** Which tab to open on, so the top-bar menu can land where it promised. */
    initialMode?: FormMode;
  }

  const { t, uiLocale, storageOk, initialMode = 'signin' }: Props = $props();

  let form = $state<FormMode>('signin');

  // Follows the prop rather than only its first value, so asking for the
  // create tab from the top-bar menu works the second time as well as the
  // first. A tab the reader picks here does not change the prop, so this does
  // not fight them for it.
  $effect(() => {
    form = initialMode;
  });
  let error = $state<string | null>(null);

  /**
   * The recovery code, shown exactly once.
   *
   * The server keeps only its Argon2id hash, so this is the only time it will
   * ever exist in readable form. Until this instance can send email, it is also
   * the only way back into an account whose password has been forgotten, which
   * is why this screen refuses to move on until somebody has said they kept it.
   */
  let issued = $state.raw<Registration | null>(null);
  let saved = $state(false);

  let devices = $state.raw<readonly DeviceInfo[]>([]);

  /*
   * Whether this account is still waiting on its address to be confirmed.
   *
   * Learned by asking, not by remembering. The registration response says so
   * too, but that answer is gone after a reload and the account is disabled
   * until somebody opens a link in a mailbox — which may be days later, on
   * another machine. The device list is already fetched here and is already an
   * authenticated request, so its refusal is the answer.
   */
  let unconfirmed = $state(false);
  let resendPassword = $state('');
  let resent = $state<'sent' | 'already' | null>(null);

  async function resend(): Promise<void> {
    const account = session.account;
    if (account === null) {
      return;
    }
    error = null;
    try {
      const identifier = account.email !== undefined && account.email !== ''
        ? account.email
        : account.handle;
      const result = await api.resendVerification(identifier, resendPassword, uiLocale);
      resent = result.alreadyVerified === true ? 'already' : 'sent';
      resendPassword = '';
    } catch (cause) {
      error = say(cause);
    }
  }

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
          unconfirmed = false;
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          devices = [];
          unconfirmed = cause instanceof ApiError && cause.code === 'email_not_verified';
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
</script>

<section>
  <h1>{t.accountTitle}</h1>

  {#if !storageOk}
    <div class="panel"><p>{t.storageUnavailable}</p></div>
  {:else if issued !== null}
    <!--
      The one screen in the app that refuses to be dismissed.

      This code exists in readable form exactly once, and until this instance
      can send email it is the only way back into the account. Moving on before
      it is saved is the one mistake nobody can undo for you.
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

      <button
        class="btn btn--primary"
        type="button"
        disabled={!saved}
        onclick={() => (issued = null)}
      >
        {t.recoveryDone}
      </button>
    </div>
  {:else if session.status === 'signed-in' && session.account !== null}
    {@const account = session.account}
    <div class="panel">
      <p class="eyebrow">{t.accountSignedInAs}</p>
      <p class="who">{account.handle}</p>
      {#if account.email !== undefined && account.email !== ''}
        <p class="muted note">{account.email}</p>
      {/if}
      <p class="muted note">{t.accountDeviceIs(account.deviceName)}</p>

    </div>

    {#if unconfirmed}
      <!--
        The account exists and does nothing until this is done, so it is said
        here rather than left to the sync panel's failure to explain itself.
        The password is asked for because the resend endpoint is behind it: an
        endpoint that mails anybody who knows an address is a way to use this
        server to send mail to strangers.
      -->
      <div class="panel unconfirmed">
        <h2>{t.verifyPendingTitle}</h2>
        <p class="note">{t.verifyPendingBody(account.email ?? account.handle)}</p>
        {#if resent === 'sent'}
          <p class="notice">{t.verifyResent}</p>
        {:else if resent === 'already'}
          <p class="notice">{t.verifyAlready}</p>
        {:else}
          <form
            class="stack-4"
            onsubmit={(event) => {
              event.preventDefault();
              void resend();
            }}
          >
            <label class="field-group">
              <span class="field-label">{t.accountPassword}</span>
              <input
                class="field"
                type="password"
                autocomplete="current-password"
                bind:value={resendPassword}
              />
            </label>
            <button class="btn" type="submit" disabled={resendPassword === '' || session.busy}>
              {t.verifyResend}
            </button>
          </form>
        {/if}
      </div>
    {/if}

    <SyncPanel {t} {uiLocale} />

    {#if devices.length > 0}
      <div class="panel">
        <h2>{t.accountDevices}</h2>
        <ul class="devices">
          {#each devices as device (device.id)}
            <li>
              <span class="name">{device.name}</span>
              {#if device.current}<span class="chip is-on">{t.accountThisDevice}</span>{/if}
              <span class="muted when"
                >{new Date(device.lastSeen).toLocaleDateString(uiLocale)}</span
              >
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <div class="panel">
      <h2>{t.accountLeaving}</h2>
      <p class="muted note">{t.accountSignOutKeeps}</p>
      {#if error !== null}
        <p class="warning" role="alert">{error}</p>
      {/if}
      <div class="btn-row">
        <button class="btn" type="button" disabled={session.busy} onclick={leave}>
          {t.accountSignOut}
        </button>
      </div>
    </div>
  {:else}
    <!--
      The same component the top-bar menu uses, rather than a second copy of
      the same fields. Two copies is how one of them ends up asking for a
      pseudonym after the other has moved to an address.
    -->
    <div class="panel">
      <SignInForm
        {t}
        {uiLocale}
        mode={form}
        {registrationOpen}
        onMode={(next) => (form = next)}
        onIssued={(registration) => {
          issued = registration;
          saved = false;
        }}
        onSignedIn={() => undefined}
      />
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
