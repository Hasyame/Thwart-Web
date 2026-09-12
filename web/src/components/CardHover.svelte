<script lang="ts">
  import type { Snippet } from 'svelte';
  import { hidePeek, showPeek } from '../lib/cardPeek.svelte';

  interface Props {
    /** The card to show while the pointer rests here. */
    code: string;
    children: Snippet;
  }

  const { code, children }: Props = $props();
</script>

<!--
  Wraps a card's name wherever one is listed, and shows the card while the
  pointer rests on it. An inline span rather than a button: what is inside
  keeps its own behaviour -- a name that opens the window on click, a link
  that follows on middle-click -- and this only adds the hover.
-->
<span
  class="hover"
  role="presentation"
  onmouseenter={(e) => showPeek(code, e.currentTarget)}
  onmouseleave={hidePeek}
  onfocusin={(e) => showPeek(code, e.currentTarget)}
  onfocusout={hidePeek}
>
  {@render children()}
</span>

<style>
  .hover {
    display: inline;
  }
</style>
