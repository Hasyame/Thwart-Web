<script lang="ts">
  import type { ActiveTarget } from '../lib/nav';
  const { name }: { name: ActiveTarget | 'more' } = $props();
</script>

<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === 'hub' || name === 'play'}
    <path d="M12 2 21 6v6c0 5-9 10-9 10S3 17 3 12V6Z" />
    <path d="m13 5-6 8h5l-1 6 6-9h-5Z" fill="currentColor" stroke="none" />
  {:else if name === 'search' || name === 'card'}
    <rect x="3" y="3" width="12" height="17" rx="2" /><path d="m7 8 2-2 2 2-2 3Z" /><circle cx="16" cy="15" r="4" /><path d="m19 18 3 3" />
  {:else if name === 'decks' || name === 'deck'}
    <path d="m5 17-3-1 3-13 12 3" /><rect x="8" y="7" width="12" height="15" rx="2" /><path d="m14 10 1.2 3 3.3.2-2.5 2.1.8 3.2-2.8-1.7-2.8 1.7.8-3.2-2.5-2.1 3.3-.2Z" stroke-width="1.2" />
  {:else if name === 'stats'}
    <path d="M3 3v18h18M7 17v-4m5 4V9m5 8V5m-11 2 5-3 4 1 5-3" />
  {:else if name === 'achievements'}
    <path d="M7 3h10v5a5 5 0 0 1-10 0ZM7 5H3v3a4 4 0 0 0 5 4m9-7h4v3a4 4 0 0 1-5 4M12 13v5m-5 3h10m-8-3h6" />
  {:else if name === 'collection'}
    <path d="m3 7 9-4 9 4-9 4Zm0 0v12l9 3 9-3V7M12 11v11m-5-7h2m6 0h2" />
  {:else if name === 'history'}
    <path d="M3 10a9 9 0 1 1 1 7M3 4v6h6m3-4v6l4 3" />
  {:else if name === 'home'}
    <path d="m2 11 10-9 10 9M5 9v12h5v-7h4v7h5V9" />
  {:else if name === 'campaigns'}
    <path d="m3 5 6-2 6 3 6-2v16l-6 2-6-3-6 2Zm6-2v16m6-13v16" />
  {:else if name === 'rules'}
    <path d="M12 5C8 2 4 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-2-1-6-2-10 1Zm0 0v16" />
  {:else if name === 'more'}
    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 17.5h7m-3.5-3.5v7" />
  {:else}
    <path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" />
  {/if}
</svg>
