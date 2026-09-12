<script lang="ts">
  import type { Card } from '../lib/types';
  import type { Strings } from '../lib/i18n';
  import { cardImageUrl } from '../lib/data';
  import { fetchCard } from '../lib/cardViewer.svelte';
  import { cardHtml } from '../lib/cardText';
  import { peek } from '../lib/cardPeek.svelte';

  interface Props {
    t: Strings;
  }

  const { t }: Props = $props();

  /*
   * Fetched when the code changes, and shown only while it is still the code
   * asked for: a slow pack file arriving after the pointer has moved on must
   * not paint the wrong card under the new name.
   */
  let card = $state.raw<Card | null>(null);
  $effect(() => {
    const code = peek.code;
    card = null;
    if (code === null) {
      return;
    }
    let cancelled = false;
    void fetchCard(code).then((loaded) => {
      if (!cancelled && peek.code === code) {
        card = loaded;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  const image = $derived(card === null ? null : cardImageUrl(card.imagesrc));

  /* The same rows the card page shows, in the same order, so the two never disagree. */
  const stats = $derived(
    card === null
      ? []
      : (
          [
            [t.statHealth, card.health ?? null],
            [t.statHandSize, card.hand_size ?? null],
            [t.statAttack, card.attack ?? null],
            [t.statThwart, card.thwart ?? null],
            [t.statDefense, card.defense ?? null],
            [t.statRecover, card.recover ?? null],
            [t.statScheme, card.scheme ?? null],
            [t.statBoost, card.boost ?? null],
            [t.statThreat, card.threat ?? null],
          ] as ReadonlyArray<readonly [string, number | null]>
        ).filter((entry): entry is readonly [string, number] => entry[1] !== null),
  );

  const resources = $derived(
    card === null
      ? []
      : (
          [
            ['🔵', card.resource_mental ?? 0],
            ['🟠', card.resource_physical ?? 0],
            ['⚡', card.resource_energy ?? 0],
            ['✳️', card.resource_wild ?? 0],
          ] as ReadonlyArray<readonly [string, number]>
        ).filter(([, count]) => count > 0),
  );

  /*
   * Where to put it: beside the name when there is room to its right, else
   * below it, else above -- and never off the edge. Computed from the anchor
   * the row reported and the viewport as it is now, in CSS pixels.
   */
  const WIDTH = 30 * 16;
  const HEIGHT = 22 * 16;
  const GAP = 10;
  const place = $derived.by(() => {
    const a = peek.anchor;
    if (a === null) {
      return null;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (a.right + GAP + WIDTH <= vw) {
      return { left: a.right + GAP, top: Math.max(GAP, Math.min(a.top - 8, vh - HEIGHT - GAP)) };
    }
    if (a.left - GAP - WIDTH >= 0) {
      return { left: a.left - GAP - WIDTH, top: Math.max(GAP, Math.min(a.top - 8, vh - HEIGHT - GAP)) };
    }
    const left = Math.max(GAP, Math.min(a.left, vw - WIDTH - GAP));
    return a.bottom + GAP + HEIGHT <= vh
      ? { left, top: a.bottom + GAP }
      : { left, top: Math.max(GAP, a.top - GAP - HEIGHT) };
  });
</script>

<!--
  Purely a hint, and never in the way: the pointer cannot reach it, so it can
  sit beside the cursor without stealing the hover it came from. Hidden from
  assistive technology, which has the name it is hovering and the window a
  click away.
-->
{#if card !== null && place !== null && peek.docked === 0}
  <div class="peek" style:left={`${place.left}px`} style:top={`${place.top}px`} aria-hidden="true">
    {#if image !== null}
      <img src={image} alt="" />
    {/if}
    <div class="text">
      <p class="name">
        {card.name}{#if card.is_unique === true}<span class="unique"> ◆</span>{/if}
      </p>
      {#if card.subname !== null && card.subname !== undefined && card.subname !== ''}
        <p class="muted small">{card.subname}</p>
      {/if}
      <p class="muted small">{card.type_name} · {card.faction_name}</p>
      {#if card.traits !== null && card.traits !== undefined && card.traits !== ''}
        <p class="traits">{card.traits}</p>
      {/if}
      <p class="numbers small">
        {#if card.cost !== null && card.cost !== undefined}<span><b>{t.cost}</b> {card.cost}</span>{/if}
        {#each stats as [label, value] (label)}<span><b>{label}</b> {value}</span>{/each}
        {#each resources as [icon, count] (icon)}<span class="resource">{icon.repeat(count)}</span>{/each}
      </p>
      {#if card.text !== null && card.text !== undefined && card.text !== ''}
        <!-- Sanitised at build time, as on the card page; see CardDetail. -->
        <div class="card-text small">{@html cardHtml(card.text)}</div>
      {/if}
      <p class="muted small pack">{card.pack_name}</p>
    </div>
  </div>
{/if}

<style>
  .peek {
    position: fixed;
    z-index: 60;
    width: 30rem;
    max-width: calc(100vw - 1.25rem);
    max-height: 22rem;
    display: flex;
    gap: var(--space-3);
    padding: var(--space-3);
    pointer-events: none;
    border-radius: var(--radius-md);
    border: 1px solid var(--hairline);
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 12px 32px rgb(0 0 0 / 35%);
    overflow: hidden;
  }

  img {
    flex: 0 0 auto;
    width: 10.5rem;
    height: auto;
    align-self: flex-start;
    border-radius: 6px;
  }

  .text {
    flex: 1 1 auto;
    min-width: 0;
    display: grid;
    gap: var(--space-1);
    align-content: start;
    overflow: hidden;
  }

  .text p {
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

  .traits {
    font-style: italic;
    font-weight: var(--weight-semibold);
  }

  .numbers {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
  }

  .card-text {
    line-height: 1.45;
  }

  .card-text :global(p) {
    margin: 0 0 var(--space-1);
  }

  .card-text :global([data-icon]) {
    display: inline-block;
    font-size: 0.95em;
    line-height: 1;
  }

  .pack {
    margin-top: var(--space-1);
  }
</style>
