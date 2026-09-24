<script lang="ts">
  import { isKnownCard, showCard } from '../lib/cardViewer.svelte';
  import CardHover from './CardHover.svelte';

  interface Props {
    /** MarvelCDB card code, or a campaign's own id for a card it invented. */
    code: string;
    /** The name already resolved, so this never has to wait to draw text. */
    name: string;
  }

  const { code, name }: Props = $props();

  const known = $derived(isKnownCard(code));
</script>

{#if known}
  <CardHover {code}>
    <button type="button" class="ref" onclick={() => showCard(code)}>"{name}"</button>
  </CardHover>
{:else}
  <!-- A campaign's own card, which no database can show. Named, not linked:
       a reference that opens nothing is worse than plain text. -->
  <span class="plain">"{name}"</span>
{/if}

<style>
  /* A word in a sentence, not a control on its own: the global button
     height (the 44px touch target) would make its line taller and push the
     text below the step's marker. Inline targets are exempt (WCAG 2.5.8). */
  .ref {
    display: inline;
    min-height: 0;
    line-height: inherit;
    vertical-align: baseline;
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
    text-decoration-color: var(--accent);
  }

  .ref:hover,
  .ref:focus-visible {
    color: var(--accent);
  }

  .plain {
    font-weight: 600;
  }

</style>
