<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Locale } from '../lib/types';
  import NavIcon from './NavIcon.svelte';
  import RulesPage from './RulesPage.svelte';

  const { t, cardLocale }: { t: Strings; cardLocale: Locale } = $props();
  let dialog = $state.raw<HTMLDialogElement | null>(null);
  let opened = $state(false);

  function open(): void {
    opened = true;
    dialog?.showModal();
  }
</script>

<div class="game-rules">
  <button class="btn" type="button" onclick={open} aria-haspopup="dialog">
    <NavIcon name="rules" />
    {t.rulesTitle}
  </button>
</div>

<!-- Keep the game mounted: looking up a rule must not reset its tracker,
     campaign screen, clock or scroll position. Native dialog restores focus. -->
<dialog bind:this={dialog} aria-label={t.rulesTitle}>
  <header>
    <h2 class="comic-title">{t.rulesTitle}</h2>
    <button class="btn btn--primary" type="button" onclick={() => dialog?.close()}>
      {t.backToGame}
    </button>
  </header>
  <div class="body">
    {#if opened}
      <RulesPage {t} {cardLocale} embedded />
    {/if}
  </div>
</dialog>

<style>
  .game-rules { display: flex; justify-content: flex-end; margin-block: var(--space-3); }
  .game-rules .btn { display: inline-flex; align-items: center; gap: var(--space-2); }
  dialog {
    width: min(56rem, calc(100% - 2rem));
    max-height: calc(100dvh - 2rem - env(safe-area-inset-top, 0px) - var(--safe-bottom));
    margin: auto;
    padding: 0;
    color: var(--text);
    background: var(--surface-1);
    border: 2px solid var(--text);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-2);
    overflow: auto;
    overscroll-behavior: contain;
  }
  dialog::backdrop { background: var(--scrim); }
  header {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-1);
    border-bottom: 1px solid var(--hairline);
  }
  h2 {
    margin: 0;
    padding: 0.2em 0.65em 0.28em;
    background: var(--accent);
    color: var(--accent-ink);
    clip-path: polygon(0.35em 0, 100% 0, calc(100% - 0.35em) 100%, 0 100%);
    font-size: var(--text-lg);
    font-weight: 900;
    font-style: italic;
    text-transform: uppercase;
  }
  .body { padding: var(--space-4); }
</style>
