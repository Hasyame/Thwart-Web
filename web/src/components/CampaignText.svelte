<script lang="ts">
  import type { TextSegment } from '../lib/campaign/text';
  import CardRef from './CardRef.svelte';

  interface Props {
    segments: readonly TextSegment[];
  }

  const { segments }: Props = $props();
</script><!--
  One campaign sentence, with its card references made touchable and its own
  keywords set apart. No wrapper element: this is inline text and belongs
  inside whatever paragraph or list item asked for it.
-->{#each segments as segment, i (i)}{#if segment.kind === 'card'}<CardRef
      code={segment.code}
      name={segment.name}
    />{:else if segment.kind === 'keyword'}<em class="keyword">{segment.text}</em
    >{:else}{segment.text}{/if}{/each}

<style>
  /*
   * Bold italic, as the printed material sets them.
   *
   * MISSION and OVERSEER are not descriptions: a MISSION side scheme cannot be
   * thwarted and an OVERSEER minion sits outside any player's control. Reading
   * them as ordinary words loses that.
   */
  .keyword {
    font-weight: 700;
    font-style: italic;
  }
</style>
