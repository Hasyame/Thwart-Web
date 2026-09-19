<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { IndexRow, Locale, Pack } from '../lib/types';
  import type { Route } from '../lib/router';
  import { achievements } from '../lib/achievements/store.svelte';
  import { achievementArt } from '../lib/achievements/art';
  import type { AchievementDefinition, AchievementStatus } from '../lib/achievements/types';

  /**
   * The achievements at a glance, the way a store shows them: how many are
   * unlocked with a bar, the latest one with its words, a row of unlocked
   * badges and a row of locked ones, each badge telling what it is under
   * the pointer, and the way to the whole page. Everything comes from the
   * derived state; the badges are card art on MarvelCDB.
   */

  interface Props {
    t: Strings;
    uiLocale: Locale;
    index: readonly IndexRow[];
    packs: readonly Pack[];
    hrefFor: (route: Route) => string;
    onNavigate: (route: Route) => void;
  }

  const { t, uiLocale, index, packs, hrefFor, onNavigate }: Props = $props();

  const SHOWN = 7;

  const current = $derived(achievements.state);
  const definitions = $derived(new Map((achievements.definitions?.achievements ?? []).map((d) => [d.id, d] as const)));
  const packName = $derived(new Map(packs.map((p) => [p.code, p.name] as const)));

  const shown = $derived((current?.achievements ?? []).filter((a) => definitions.get(a.id)?.hidden !== true));
  const unlockedCount = $derived(shown.filter((a) => a.status === 'unlocked').length);
  const percent = $derived(shown.length === 0 ? 0 : Math.round((unlockedCount / shown.length) * 100));

  /** Unlocked newest first, the undated ones last; locked in the file's order. */
  const unlocked = $derived(
    [...shown.filter((a) => a.status === 'unlocked')].sort(
      (a, b) => (b.unlockedAt ?? -1) - (a.unlockedAt ?? -1) || (a.id < b.id ? -1 : 1),
    ),
  );
  const locked = $derived(shown.filter((a) => a.status !== 'unlocked'));
  const latest = $derived(unlocked[0] ?? null);

  const wordsOf = (definition: AchievementDefinition): { title: string; description: string } => {
    const words = t.achievement[definition.id] ?? { title: definition.id, description: '' };
    const p = definition.predicate;
    const pack = 'pack' in p && p.pack !== '*' ? (packName.get(p.pack) ?? p.pack) : '';
    const top = definition.tiers?.[definition.tiers.length - 1]?.n;
    return { title: words.title, description: words.description.replace('{pack}', pack).replace('{n}', top === undefined ? '' : String(top)) };
  };
  const tipOf = (status: AchievementStatus): string => {
    const definition = definitions.get(status.id);
    if (definition === undefined) {
      return status.id;
    }
    const words = wordsOf(definition);
    const state =
      status.status === 'unlocked' && status.unlockedAt !== null
        ? t.achievements.unlockedOn(new Date(status.unlockedAt).toLocaleDateString(uiLocale, { year: 'numeric', month: 'long', day: 'numeric' }))
        : status.status === 'unavailable'
          ? t.achievements.unavailable
          : t.achievements.progress(status.progress.current, status.progress.target);
    return `${words.title} — ${words.description} (${state})`;
  };
  const artOf = (status: AchievementStatus): string | null => {
    const definition = definitions.get(status.id);
    return definition === undefined ? null : achievementArt(definition, index, achievements.catalogue);
  };

  /*
   * What the badge under the pointer is, said in one line under the rows
   * rather than in a box beside the badge: a box positioned next to the
   * last badge of a row ran past the right edge of a phone, widened the
   * page, and the fixed tab bar went with the layout viewport. A line in
   * the flow cannot overflow anything.
   */
  let hint = $state('');

  function go(event: MouseEvent): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    onNavigate({ name: 'achievements' });
  }
</script>

{#snippet badge(status: AchievementStatus, dim: boolean)}
  {@const art = artOf(status)}
  <li class="badge" class:dim>
    <a
      href={hrefFor({ name: 'achievements' })}
      onclick={go}
      aria-label={tipOf(status)}
      onmouseenter={() => (hint = tipOf(status))}
      onmouseleave={() => (hint = '')}
      onfocus={() => (hint = tipOf(status))}
      onblur={() => (hint = '')}
    >
      {#if art !== null}
        <img src={art} alt="" loading="lazy" />
      {:else}
        <span class="blank" aria-hidden="true">★</span>
      {/if}
    </a>
  </li>
{/snippet}

{#if current !== null && shown.length > 0}
  <section class="surface strip" aria-label={t.achievements.title}>
    <p class="count"><strong>{t.achievements.stripCount(unlockedCount, shown.length)}</strong> <span class="muted">({t.achievements.rate(percent)})</span></p>
    <span class="bar" aria-hidden="true"><span class="fill" style:width={`${percent}%`}></span></span>

    {#if latest !== null}
      {@const definition = definitions.get(latest.id)}
      {#if definition !== undefined}
        {@const words = wordsOf(definition)}
        {@const art = artOf(latest)}
        <!-- The latest unlock, with its words: the one thing here worth a sentence. -->
        <a class="latest" href={hrefFor({ name: 'achievements' })} onclick={go}>
          {#if art !== null}<img class="latest-art" src={art} alt="" loading="lazy" />{/if}
          <span class="latest-words">
            <span class="latest-title">{words.title}</span>
            <span class="muted small">{words.description}</span>
          </span>
        </a>
      {/if}
    {/if}

    {#if unlocked.length > 0}
      <ul class="row">
        {#each unlocked.slice(0, SHOWN) as status (status.id)}
          {@render badge(status, false)}
        {/each}
        {#if unlocked.length > SHOWN}
          <li class="more"><a href={hrefFor({ name: 'achievements' })} onclick={go}>+{unlocked.length - SHOWN}</a></li>
        {/if}
      </ul>
    {/if}

    {#if locked.length > 0}
      <p class="muted small lockedTitle">{t.achievements.lockedTitle}</p>
      <ul class="row">
        {#each locked.slice(0, SHOWN) as status (status.id)}
          {@render badge(status, true)}
        {/each}
        {#if locked.length > SHOWN}
          <li class="more"><a href={hrefFor({ name: 'achievements' })} onclick={go}>+{locked.length - SHOWN}</a></li>
        {/if}
      </ul>
    {/if}

    <p class="hint muted small" aria-live="polite">{hint}</p>
    <p class="see"><a href={hrefFor({ name: 'achievements' })} onclick={go}>{t.achievements.seeMine}</a></p>
  </section>
{/if}

<style>
  .strip {
    margin-top: var(--space-3);
    padding: var(--space-3) var(--space-4);
    display: grid;
    gap: var(--space-2);
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .count {
    margin: 0;
  }

  .small {
    font-size: var(--text-sm);
  }

  .bar {
    display: block;
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--surface-2);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .latest {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-2) 0;
    color: inherit;
    text-decoration: none;
  }

  .latest-art {
    flex: none;
    width: 3.5rem;
    height: 3.5rem;
    border-radius: 50%;
    object-fit: cover;
    object-position: 50% 15%;
    border: 2px solid var(--gold);
  }

  .latest-words {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .latest-title {
    font-weight: var(--weight-semibold);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .badge a {
    display: block;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 50%;
    overflow: hidden;
    border: 2px solid var(--accent);
    background: var(--surface-2);
  }

  .badge img,
  .blank {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
    object-position: 50% 15%;
  }

  .blank {
    display: grid;
    place-items: center;
    color: var(--accent);
  }

  .badge.dim a {
    border-color: var(--hairline);
    opacity: 0.45;
    filter: grayscale(1);
  }

  /* What the badge under the pointer is; the space is kept so nothing jumps. */
  .hint {
    margin: 0;
    min-height: 1.4em;
  }

  .more a {
    display: grid;
    place-items: center;
    min-width: 2.75rem;
    height: 2.75rem;
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--surface-2);
    font-weight: var(--weight-semibold);
    text-decoration: none;
  }

  .lockedTitle {
    margin: var(--space-1) 0 0;
    padding-top: var(--space-2);
    border-top: 1px solid var(--hairline);
  }

  .see {
    margin: 0;
    text-align: end;
    font-size: var(--text-sm);
  }
</style>
