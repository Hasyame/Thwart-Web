<script lang="ts">
  import { untrack } from 'svelte';
  import type { Card } from '../lib/types';
  import type { Strings } from '../lib/i18n';
  import { cardImageUrl } from '../lib/data';
  import { fetchCard, showCard } from '../lib/cardViewer.svelte';
  import { cardHtml } from '../lib/cardText';
  import { dockPanel, peek } from '../lib/cardPeek.svelte';

  interface Props {
    t: Strings;
    /** What to show before anything has been pointed at: the deck's hero. */
    initial: string | null;
    /** The width from which there is room for a third column. */
    from?: string;
  }

  const { t, initial, from = '(min-width: 78rem)' }: Props = $props();

  /*
   * Rendered only where it fits. The parent's grid gives it a column from the
   * same width; below that the floating preview does the job, so this must
   * not register as docked while it is not on screen.
   */
  let wide = $state(false);
  $effect(() => {
    const query = window.matchMedia(from);
    const update = (): void => {
      wide = query.matches;
    };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  });
  // untrack: registering reads the count it increments, and an effect that
  // depends on what it writes runs until Svelte stops it.
  $effect(() => {
    if (wide) {
      return untrack(() => dockPanel());
    }
    return undefined;
  });

  const code = $derived(peek.last ?? initial);

  let card = $state.raw<Card | null>(null);
  $effect(() => {
    const wanted = code;
    if (wanted === null) {
      card = null;
      return;
    }
    let cancelled = false;
    void fetchCard(wanted).then((loaded) => {
      if (!cancelled) {
        card = loaded;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  const image = $derived(card === null ? null : cardImageUrl(card.imagesrc));
  const stats = $derived(
    card === null
      ? []
      : (
          [
            [t.cost, card.cost ?? null],
            [t.statHealth, card.health ?? null],
            [t.statHandSize, card.hand_size ?? null],
            [t.statAttack, card.attack ?? null],
            [t.statThwart, card.thwart ?? null],
            [t.statDefense, card.defense ?? null],
            [t.statRecover, card.recover ?? null],
          ] as ReadonlyArray<readonly [string, number | null]>
        ).filter((entry): entry is readonly [string, number] => entry[1] !== null),
  );
</script>

<!--
  The card left face-up beside the deck.

  What the reference sites do: a column on the right holding the picture of
  whatever the pointer last rested on, with the rules under it, so a deck can
  be read card by card without opening anything. Sticky, so it stays in view
  while the list scrolls. The hero to begin with, since a deck is theirs.
-->
{#if wide && card !== null}
  <aside class="panel">
    {#if image !== null}
      <button type="button" class="picture" onclick={() => card !== null && showCard(card.code)} aria-label={card.name}>
        <img src={image} alt="" />
      </button>
    {/if}
    <div class="about">
      <p class="name">
        {card.name}{#if card.is_unique === true}<span class="unique"> ◆</span>{/if}
      </p>
      <p class="muted small">
        {card.type_name} · {card.faction_name}{#if card.traits}{' · '}<i>{card.traits}</i>{/if}
      </p>
      {#if stats.length > 0}
        <p class="numbers small">
          {#each stats as [label, value] (label)}<span><b>{label}</b> {value}</span>{/each}
        </p>
      {/if}
      {#if card.text}
        <div class="card-text small">{@html cardHtml(card.text)}</div>
      {/if}
      <p class="muted small">{card.pack_name}</p>
    </div>
  </aside>
{/if}

<style>
  .panel {
    position: sticky;
    /* Under the app bar and the editor's own; see DeckEditor's .bar. */
    top: calc(57px + env(safe-area-inset-top) + 4.5rem);
    display: grid;
    gap: var(--space-3);
    max-height: calc(100vh - 57px - 4.5rem - var(--space-4));
    overflow: auto;
  }

  .picture {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
    border-radius: 4.5% / 3.2%;
    overflow: hidden;
    box-shadow: 0 10px 28px rgb(0 0 0 / 30%);
  }

  .picture img {
    display: block;
    width: 100%;
    height: auto;
  }

  .about {
    display: grid;
    gap: var(--space-1);
  }

  .about p {
    margin: 0;
  }

  .name {
    font-weight: var(--weight-bold);
    font-size: var(--text-lg);
    line-height: var(--leading-snug);
  }

  .unique {
    font-size: 0.8em;
  }

  .numbers {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
  }

  .card-text {
    line-height: 1.5;
  }

  .card-text :global(p) {
    margin: 0 0 var(--space-1);
  }

  .card-text :global([data-icon]) {
    display: inline-block;
    font-size: 0.95em;
    line-height: 1;
  }
</style>
