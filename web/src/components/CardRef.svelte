<script lang="ts">
  import { cardImageUrl } from '../lib/data';
  import { fetchCard, isKnownCard, showCard } from '../lib/cardViewer.svelte';
  import type { Card } from '../lib/types';

  interface Props {
    /** MarvelCDB card code, or a campaign's own id for a card it invented. */
    code: string;
    /** The name already resolved, so this never has to wait to draw text. */
    name: string;
  }

  const { code, name }: Props = $props();

  const known = $derived(isKnownCard(code));

  let card = $state.raw<Card | null>(null);
  let hovering = $state(false);
  /** Where to hang the preview, in viewport coordinates. */
  let anchor = $state.raw<{ top: number; left: number; below: boolean } | null>(null);

  const image = $derived(card === null ? null : cardImageUrl(card.imagesrc));

  /*
   * Fetched on hover rather than up front.
   *
   * A setup step can name a dozen cards and each lives in a pack file of its
   * own; loading them all to show a picture nobody asked for would cost more
   * than the page itself.
   */
  function peek(event: MouseEvent | FocusEvent): void {
    if (!known) {
      return;
    }
    const target = event.currentTarget as HTMLElement;
    const box = target.getBoundingClientRect();
    // Flipped above when there is no room below, which on a phone in landscape
    // is most of the time.
    const below = box.bottom + 340 < window.innerHeight;
    anchor = {
      top: below ? box.bottom + 8 : box.top - 8,
      left: Math.min(box.left, window.innerWidth - 260),
      below,
    };
    hovering = true;
    void fetchCard(code).then((loaded) => {
      card = loaded;
    });
  }

  const away = (): void => {
    hovering = false;
  };
</script>

{#if known}
  <button
    type="button"
    class="ref"
    onmouseenter={peek}
    onmouseleave={away}
    onfocus={peek}
    onblur={away}
    onclick={() => showCard(code)}
  >"{name}"</button>

  {#if hovering && anchor !== null && image !== null}
    <!-- Purely a hint, and never in the way: the pointer cannot reach it, so
         it can sit under the cursor without stealing the hover it came from. -->
    <div
      class="peek"
      class:above={!anchor.below}
      style:top={`${anchor.top}px`}
      style:left={`${anchor.left}px`}
      aria-hidden="true"
    >
      <img src={image} alt="" />
    </div>
  {/if}
{:else}
  <!-- A campaign's own card, which no database can show. Named, not linked:
       a reference that opens nothing is worse than plain text. -->
  <span class="plain">"{name}"</span>
{/if}

<style>
  .ref {
    display: inline;
    border: 0;
    background: none;
    padding: 0;
    margin: 0;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
    /* Dotted rather than a link's solid line: a paragraph naming six cards
       reads as prose with things to point at, not as a list of links. */
    text-decoration: underline dotted;
    text-underline-offset: 3px;
    text-decoration-color: var(--md-primary);
  }

  .ref:hover,
  .ref:focus-visible {
    color: var(--md-primary);
  }

  .plain {
    font-weight: 600;
  }

  .peek {
    position: fixed;
    z-index: 60;
    width: 15rem;
    pointer-events: none;
    border-radius: var(--radius-md);
    overflow: hidden;
    box-shadow: 0 12px 32px rgb(0 0 0 / 45%);
    background: var(--md-surface-container-high);
  }

  .peek.above {
    transform: translateY(-100%);
  }

  .peek img {
    display: block;
    width: 100%;
  }
</style>
