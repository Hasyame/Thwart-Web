<script lang="ts">
  import { onMount, type Snippet } from 'svelte';

  const { label, count = 0, children }: { label: string; count?: number; children: Snippet } = $props();
  let wide = $state(false);
  let expanded = $state(false);
  const id = $props.id();

  onMount(() => {
    const media = window.matchMedia('(min-width: 48rem)');
    const update = (): void => { wide = media.matches; };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  });
</script>

<div class="responsive-filters">
  <button class="btn" type="button" aria-expanded={expanded} aria-controls={id} onclick={() => (expanded = !expanded)}>
    {label}{count > 0 ? ` (${count})` : ''} <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
  </button>
  <div {id} class="fields" hidden={!wide && !expanded}>
    {@render children()}
  </div>
</div>

<style>
  .fields:not([hidden]) { display: grid; gap: var(--space-3); }
  button { width: 100%; justify-content: space-between; }
  .fields { margin-top: var(--space-3); }
  @media (min-width: 48rem) {
    button { display: none; }
    .fields { margin-top: 0; }
  }
</style>
