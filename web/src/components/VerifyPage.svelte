<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Locale } from '../lib/types';
  import { ApiError, verifyEmail } from '../lib/sync/api';

  /**
   * Where the link in a confirmation message lands.
   *
   * It confirms on arrival rather than behind a button. The reader has already
   * acted — they clicked a link in their own mail — and asking them to click
   * again to confirm that they clicked is the kind of politeness that reads as
   * a broken page.
   *
   * The one thing this page does not do is sign anybody in. Whoever opens the
   * link has proved they can read the mailbox, which is not the same as knowing
   * the password, and the two should not be quietly conflated.
   */

  interface Props {
    t: Strings;
    uiLocale: Locale;
    token: string;
    onDone: () => void;
  }

  const { t, uiLocale, token, onDone }: Props = $props();

  type State =
    | { kind: 'working' }
    | { kind: 'done'; handle: string }
    | { kind: 'failed'; code: string };

  let state = $state<State>({ kind: 'working' });

  $effect(() => {
    if (token.trim() === '') {
      state = { kind: 'failed', code: 'invalid_verification' };
      return;
    }
    let live = true;
    void verifyEmail(token, uiLocale)
      .then((result) => {
        if (live) {
          state = { kind: 'done', handle: result.handle };
        }
      })
      .catch((cause: unknown) => {
        if (live) {
          state = {
            kind: 'failed',
            code: cause instanceof ApiError ? cause.code : 'server_error',
          };
        }
      });
    return () => {
      live = false;
    };
  });
</script>

<section>
  <h1 class="comic-title">{t.verifyTitle}</h1>

  {#if state.kind === 'working'}
    <div class="notice surface"><p>{t.verifyWorking}</p></div>
  {:else if state.kind === 'done'}
    <div class="notice surface">
      <p>{t.verifyDone(state.handle)}</p>
      <p class="muted">{t.verifyDoneHint}</p>
      <button class="btn btn--primary" type="button" onclick={onDone}>
        {t.verifyGoToAccount}
      </button>
    </div>
  {:else}
    <div class="notice surface">
      <p role="alert">{t.accountError(state.code)}</p>
      <!-- The way out is on the account screen, where the resend lives beside
           the password it needs. Repeating it here would be a second form
           asking for the same password on a page reached from an email. -->
      <p class="muted">{t.verifyFailedHint}</p>
      <button class="btn" type="button" onclick={onDone}>{t.verifyGoToAccount}</button>
    </div>
  {/if}
</section>

<style>
  h1 {
    font-size: var(--text-2xl);
    margin: var(--space-5) 0 var(--space-3);
  }

  .notice {
    padding: var(--space-4);
    margin: var(--space-3) 0;
    max-width: var(--prose-max);
    display: grid;
    gap: var(--space-3);
    justify-items: start;
  }

  .notice p {
    margin: 0;
  }
</style>
