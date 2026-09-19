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
   * Where somebody lands after registering, when the address is not confirmed.
   *
   * Registering no longer signs anybody in: the server refuses every request
   * made with that token until the link is opened, so a signed-in screen would
   * be the app telling a lie it cannot back up. This is what it says instead.
   */
  let awaiting = $state.raw<{ handle: string; email: string } | null>(null);

  /*
   * Leaving, in both senses the law means.
   *
   * Taking the data out (portability) and destroying it (erasure). The server
   * has had both endpoints since sync existed and neither had a control, which
   * meant the only way out of this account was to ask me.
   */
  let exporting = $state(false);
  let deleting = $state(false);
  let confirmingDelete = $state(false);
  let deletePassword = $state('');

  async function exportData(): Promise<void> {
    const account = session.account;
    if (account === null) {
      return;
    }
    error = null;
    exporting = true;
    try {
      const data = await api.exportAccount(account.token, uiLocale);
      // The same shape the backup file uses, so it can be read straight back
      // into the app or into the Android one.
      const text = JSON.stringify(data, null, 2);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `thwart-${account.handle}-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      error = say(cause);
    } finally {
      exporting = false;
    }
  }

  async function destroyAccount(): Promise<void> {
    const account = session.account;
    if (account === null) {
      return;
    }
    error = null;
    deleting = true;
    try {
      await api.deleteAccount(account.token, deletePassword, uiLocale);
      deletePassword = '';
      confirmingDelete = false;
      /*
       * Signed out locally afterwards, not before.
       *
       * The account is gone on the server, so the token is worthless, but this
       * browser's own decks and games are untouched — deleting an account is
       * leaving the sync service, not throwing away what you play with. The
       * collection screen is where erasing local data lives.
       */
      await signOut(uiLocale).catch(() => undefined);
    } catch (cause) {
      error = say(cause);
    } finally {
      deleting = false;
    }
  }

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
  <h1 class="comic-title">{t.accountTitle}</h1>

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
        onclick={() => {
          // Only an unconfirmed registration has somewhere else to go. A
          // recovery code issued by `recover` belongs to an account that is
          // already signed in, and that must land back on the account screen.
          if (code.emailVerified === false) {
            awaiting = { handle: code.handle, email: code.email ?? '' };
          }
          issued = null;
        }}
      >
        {t.recoveryDone}
      </button>
    </div>
  {:else if awaiting !== null}
    {@const pending = awaiting}
    <!--
      Registered, and deliberately not signed in.

      The account exists and does nothing until the link is opened. Saying so
      here is the whole fix for "I was logged in without confirming": the app
      used to store the session and show a signed-in screen while the server
      refused every request made with it.
    -->
    <div class="panel">
      <h2>{t.verifyPendingTitle}</h2>
      <p class="note">{t.registeredCheckMail(pending.email)}</p>
      <p class="muted note">{t.registeredThenSignIn}</p>
      <button
        class="btn btn--primary"
        type="button"
        onclick={() => {
          awaiting = null;
          form = 'signin';
        }}
      >
        {t.accountSignIn}
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

    <!--
      Taking the data out, and destroying it.

      Both endpoints have existed on the server since sync did, and neither had
      a control on this screen — so the only way to leave this account was to
      ask the person running the server, which is not what "you may leave"
      means.
    -->
    <div class="panel">
      <h2>{t.accountYourData}</h2>
      <p class="muted note">{t.accountExportNote}</p>
      <div class="btn-row">
        <button class="btn" type="button" disabled={exporting} onclick={() => void exportData()}>
          {exporting ? t.accountExporting : t.accountExport}
        </button>
      </div>

      <h3 class="eyebrow danger-text">{t.accountDeleteTitle}</h3>
      <p class="muted note">{t.accountDeleteNote}</p>
      {#if confirmingDelete}
        <!-- The password again, because the token alone is whatever is on this
             machine, and this is the one action nothing undoes. -->
        <form
          class="stack-4"
          onsubmit={(event) => {
            event.preventDefault();
            void destroyAccount();
          }}
        >
          <p class="warning" role="alert">{t.accountDeleteConfirm}</p>
          <label class="field-group">
            <span class="field-label">{t.accountPassword}</span>
            <input
              class="field"
              type="password"
              autocomplete="current-password"
              bind:value={deletePassword}
            />
          </label>
          <div class="btn-row">
            <button
              class="btn danger"
              type="submit"
              disabled={deleting || deletePassword === ''}
            >
              {t.accountDeleteYes}
            </button>
            <button
              class="btn"
              type="button"
              disabled={deleting}
              onclick={() => {
                confirmingDelete = false;
                deletePassword = '';
              }}
            >
              {t.cancel}
            </button>
          </div>
        </form>
      {:else}
        <div class="btn-row">
          <button class="btn danger" type="button" onclick={() => (confirmingDelete = true)}>
            {t.accountDelete}
          </button>
        </div>
      {/if}
    </div>

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
  .danger {
    color: var(--danger);
    border-color: var(--danger);
  }

  .danger-text {
    color: var(--danger);
  }

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
