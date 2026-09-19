<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import { safePhotoName } from '../lib/backupArchive';
  import type { Strings } from '../lib/i18n';
  const { names, t }: { names: string; t: Strings } = $props();
  const requested = $derived([...new Set(names.split(',').map(name => name.trim()).filter(safePhotoName))]);
  let images = $state<{ name: string; url: string; index: number }[]>([]);
  let loaded = $state(false);
  $effect(() => {
    const keys = requested;
    let urls: string[] = [];
    loaded = false;
    const subscription = liveQuery(() => db.photos.bulkGet(keys)).subscribe({
      next(rows) {
        urls.forEach(url => URL.revokeObjectURL(url));
        images = rows.flatMap((photo, index) => photo === undefined ? [] : [{
          name: photo.name, index: index + 1,
          url: URL.createObjectURL(new Blob([photo.data], { type: 'image/jpeg' })),
        }]);
        urls = images.map(image => image.url);
        loaded = true;
      },
      error() { images = []; loaded = true; },
    });
    return () => { subscription.unsubscribe(); urls.forEach(url => URL.revokeObjectURL(url)); };
  });
</script>

{#if requested.length > 0}
  <section aria-label={t.playPhotos}>
    <h3>{t.playPhotos}</h3>
    <div class="photos">
      {#each images as image (image.name)}
        <a href={image.url} target="_blank" rel="noopener noreferrer">
          <img src={image.url} alt={t.playPhoto(image.index)} loading="lazy" />
        </a>
      {/each}
    </div>
    {#if loaded && images.length < requested.length}
      <p class="muted">{t.playPhotosMissing}</p>
    {/if}
  </section>
{/if}

<style>
  section { margin-block: var(--space-4); }
  h3 { margin-bottom: var(--space-2); }
  .photos { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr)); gap: var(--space-2); }
  a { display: block; border: 2px solid var(--ink); border-radius: var(--radius-sm); overflow: hidden; }
  img { display: block; width: 100%; max-height: 280px; object-fit: contain; }
</style>
