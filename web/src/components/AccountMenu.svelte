<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Locale } from '../lib/types';
  import * as api from '../lib/sync/api';
  import { session, signOut } from '../lib/sync/session.svelte';
  import SignInForm, { type FormMode } from './SignInForm.svelte';

  interface Props {
    t: Strings;
    uiLocale: Locale;
    open: boolean;
    onClose: () => void;
    /**
     * Opens the full account screen, which has the room this does not.
     *
     * Takes the tab it should land on, so the links below arrive where they
     * say they will rather than on the sign-in form somebody just left.
     */
    onAccount: (mode?: FormMode) => void;
  }

  const { t, uiLocale, open, onClose, onAccount }: Props = $props();

  let dialog = $state.raw<HTMLDialogElement | null>(null);
  let registrationOpen = $state<boolean | null>(null);

  $effect(() => {
    const element = dialog;
    if (element === null) {
      return;
    }
    if (open && !element.open) {
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  });

  // Asked once the menu is first opened rather than on every page load: the
  // answer only decides whether to offer a link nobody has asked for yet.
  $effect(() => {
    if (!open || registrationOpen !== null) {
      return;
    }
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

  function toAccount(mode?: FormMode): void {
    onAccount(mode);
    onClose();
  }
</script>

<dialog bind:this={dialog} onclose={onClose} aria-label={t.accountTitle}>
  <div class="sheet">
    <header>
      <h2>{t.accountTitle}</h2>
      <button class="btn btn--text" type="button" onclick={onClose}>{t.close}</button>
    </header>

    {#if session.status === 'signed-in' && session.account !== null}
      {@const account = session.account}
      <div class="who">
        <span class="avatar" aria-hidden="true">{account.handle.slice(0, 1).toUpperCase()}</span>
        <span class="names">
          <span class="handle">{account.handle}</span>
          <span class="muted sub">{account.deviceName}</span>
        </span>
      </div>

      <div class="btn-row">
        <button class="btn btn--primary" type="button" onclick={() => toAccount()}>
          {t.accountManage}
        </button>
        <button
          class="btn"
          type="button"
          disabled={session.busy}
          onclick={() => void signOut(uiLocale).then(onClose)}
        >
          {t.accountSignOut}
        </button>
      </div>
    {:else}
      <!--
        Sign in here; everything rarer goes to the page.

        Creating an account issues a recovery code that must be read, saved and
        acknowledged, and a drop-down is the wrong place to put the one secret
        somebody cannot be given twice.
      -->
      <SignInForm
        {t}
        {uiLocale}
        mode="signin"
        {registrationOpen}
        compact
        onMode={() => undefined}
        onIssued={() => toAccount()}
        onSignedIn={onClose}
      />

      <p class="more">
        {#if registrationOpen !== false}
          <button class="link" type="button" onclick={() => toAccount('register')}>
            {t.accountCreate}
          </button>
          <span aria-hidden="true">·</span>
        {/if}
        <button class="link" type="button" onclick={() => toAccount('recover')}>
          {t.accountForgot}
        </button>
      </p>
    {/if}
  </div>
</dialog>

<style>
  /* The same sheet as the settings menu: from the bottom on a phone, a small
     dialog on a desktop. One arrangement to learn, not two. */
  dialog {
    margin: 0;
    margin-block-start: auto;
    width: 100%;
    max-width: 100%;
    max-height: 88dvh;
    padding: 0;
    border: 0;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--surface-1);
    color: var(--text);
    box-shadow: var(--shadow-2);
    overflow: auto;
    overscroll-behavior: contain;
  }

  dialog::backdrop {
    background: var(--scrim);
  }

  .sheet {
    display: grid;
    gap: var(--space-4);
    padding-block: var(--space-5) calc(var(--space-6) + env(safe-area-inset-bottom));
    padding-inline: max(var(--space-5), env(safe-area-inset-left))
      max(var(--space-5), env(safe-area-inset-right));
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  h2 {
    font-size: var(--text-xl);
    font-weight: var(--weight-bold);
  }

  .who {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .avatar {
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: var(--radius-pill);
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: var(--weight-bold);
    font-size: var(--text-lg);
  }

  .names {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .handle {
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
  }

  .sub {
    font-size: var(--text-xs);
  }

  .more {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--text-sm);
  }

  .link {
    border: 0;
    background: none;
    padding: 0;
    min-height: 0;
    font: inherit;
    color: var(--accent);
    font-weight: var(--weight-semibold);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }

  @media (min-width: 56rem) {
    dialog {
      margin: auto;
      width: min(24rem, calc(100vw - 2rem));
      border-radius: var(--radius-md);
    }
  }
</style>
