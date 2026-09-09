<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Card, Locale } from '../lib/types';
  import { fetchCard, hideCard, viewer } from '../lib/cardViewer.svelte';
  import CardDetail from './CardDetail.svelte';

  interface Props {
    t: Strings;
    cardLocale: Locale;
    canFavourite: boolean;
    isFavourite: (code: string) => boolean;
    onToggleFavourite: (code: string) => void;
  }

  const { t, cardLocale, canFavourite, isFavourite, onToggleFavourite }: Props = $props();

  let dialog = $state.raw<HTMLDialogElement | null>(null);
  let card = $state.raw<Card | null>(null);
  let loading = $state(false);

  /*
   * A real <dialog>, opened modally.
   *
   * Escape closing it, the focus trap and the inertness of the page behind are
   * all the platform's, and hand-rolling them is how a modal ends up
   * unreachable from a keyboard.
   */
  $effect(() => {
    const code = viewer.code;
    const element = dialog;
    if (element === null) {
      return;
    }
    if (code === null) {
      if (element.open) {
        element.close();
      }
      card = null;
      return;
    }
    if (!element.open) {
      element.showModal();
    }
    let cancelled = false;
    loading = true;
    card = null;
    void fetchCard(code)
      .then((loaded) => {
        if (!cancelled) {
          card = loaded;
        }
      })
      .finally(() => {
        if (!cancelled) {
          loading = false;
        }
      });
    return () => {
      cancelled = true;
    };
  });
</script>

<dialog bind:this={dialog} onclose={hideCard}>
  <div class="frame">
    <button class="close" type="button" onclick={hideCard} aria-label={t.back}>×</button>

    {#if loading}
      <p class="muted pad">{t.loading}</p>
    {:else if card === null}
      <p class="muted pad">{t.cardNotFound}</p>
    {:else}
      {@const open = card}
      <CardDetail
        card={open}
        {cardLocale}
        {t}
        {canFavourite}
        isFavourite={isFavourite(open.code)}
        onToggleFavourite={() => onToggleFavourite(open.code)}
      />
    {/if}
  </div>
</dialog>

<style>
  dialog {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    background: var(--surface-1);
    color: var(--text);
    padding: 0;
    width: min(60rem, calc(100vw - 2rem));
    /*
      `dvh`, not `vh`.

      On iOS Safari `100vh` is the height with the toolbars *retracted*, which
      is taller than the window actually is while they are showing: a dialog
      sized to it runs off the bottom of the screen and its last line cannot be
      reached. `dvh` is the viewport as it currently stands. The fallback line
      is for anything old enough not to know `dvh`, where the previous
      behaviour is what it gets.
    */
    max-height: calc(100vh - 2rem);
    max-height: calc(100dvh - 2rem);
    overflow: auto;
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 60%);
  }

  .frame {
    padding: var(--space-5);
    position: relative;
  }

  .pad {
    padding: var(--space-4) 0;
  }

  .close {
    position: absolute;
    top: var(--space-2);
    inset-inline-end: var(--space-2);
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--surface-1);
    color: inherit;
    font-size: var(--text-xl);
    line-height: 1;
    cursor: pointer;
    z-index: 1;
  }
</style>
