<script lang="ts">
  import type { Snippet } from 'svelte';
  const { title, closeLabel, onClose, children }: { title: string; closeLabel: string; onClose: () => void; children: Snippet } = $props();
  let dialog = $state.raw<HTMLDialogElement | null>(null);
  $effect(() => { dialog?.showModal(); });
</script>

<dialog bind:this={dialog} onclose={onClose} aria-label={title}>
  <header>
    <h2>{title}</h2>
    <button class="btn btn--quiet" type="button" onclick={() => dialog?.close()}>{closeLabel}</button>
  </header>
  <div class="body">{@render children()}</div>
</dialog>

<style>
  dialog { width: min(36rem, calc(100% - 2rem)); max-height: calc(100dvh - 2rem - var(--safe-bottom)); margin: auto; padding: 0; color: var(--text); background: var(--surface-1); border: 1px solid var(--hairline); border-radius: var(--radius-lg); box-shadow: var(--shadow-2); overflow: auto; overscroll-behavior: contain; }
  dialog::backdrop { background: var(--scrim); }
  header { position: sticky; top: 0; display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-4); background: var(--surface-1); border-bottom: 1px solid var(--hairline); z-index: 1; }
  h2 { font-size: var(--text-lg); margin: 0; }
  button { flex: none; }
  .body { padding: var(--space-4); }
</style>
