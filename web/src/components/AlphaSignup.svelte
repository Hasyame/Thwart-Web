<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import { ApiError, joinAndroidAlpha } from '../lib/sync/api';

  /**
   * Asking to test the Android app before it is released.
   *
   * A name and an address, relayed by the server to the owner's mailbox and
   * stored nowhere (server/alpha.go). The page says so before anything is
   * sent, because an address typed into a hobby project deserves to know
   * where it goes.
   */
  const { t }: { t: Strings } = $props();

  let name = $state('');
  let email = $state('');
  /** The honeypot: hidden from people, so only a bot fills it. */
  let website = $state('');
  let status = $state<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  let failure = $state<string | null>(null);

  const ready = $derived(name.trim() !== '' && email.trim() !== '' && status !== 'sending');

  async function send(): Promise<void> {
    if (!ready) {
      return;
    }
    status = 'sending';
    failure = null;
    try {
      await joinAndroidAlpha(name.trim(), email.trim(), website, document.documentElement.lang === 'fr' ? 'fr' : 'en');
      status = 'sent';
    } catch (cause) {
      status = 'failed';
      failure =
        cause instanceof ApiError && cause.code !== 'offline' && cause.code !== 'server_error' && cause.message !== ''
          ? cause.message
          : t.alpha.failed;
    }
  }
</script>

<details class="alpha">
  <summary>{t.alpha.title}</summary>
  <p>{t.alpha.intro}</p>
  {#if status === 'sent'}
    <p class="ok" role="status">{t.alpha.sent}</p>
  {:else}
    <form onsubmit={(e) => { e.preventDefault(); void send(); }}>
      <label class="field-group">
        <span class="field-label">{t.alpha.name}</span>
        <input class="field" type="text" autocomplete="name" maxlength="80" required bind:value={name} />
      </label>
      <label class="field-group">
        <span class="field-label">{t.alpha.email}</span>
        <input class="field" type="email" autocomplete="email" inputmode="email" maxlength="254" required bind:value={email} />
      </label>
      <label class="trap" aria-hidden="true">
        Website
        <input type="text" tabindex="-1" autocomplete="off" bind:value={website} />
      </label>
      <p class="muted small">{t.alpha.privacy}</p>
      {#if failure !== null}<p class="danger-text" role="alert">{failure}</p>{/if}
      <button type="submit" class="btn btn--primary" disabled={!ready}>
        {status === 'sending' ? t.alpha.sending : t.alpha.submit}
      </button>
    </form>
  {/if}
</details>

<style>
  .alpha { max-width: var(--prose-max); margin-block: var(--space-3); }
  summary { cursor: pointer; color: var(--accent); font-weight: var(--weight-semibold); min-height: var(--tap-min); align-content: center; }
  p { margin-block: var(--space-2); }
  form { display: grid; gap: var(--space-3); max-width: 28rem; }
  form .btn { justify-self: start; }
  /* Off screen rather than display:none, which some bots know to skip. */
  .trap { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
</style>
