<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { NavTarget } from '../lib/nav';
  import { loadPausedGame } from '../lib/pausedGame';
  import { achievements } from '../lib/achievements/store.svelte';

  interface Props {
    t: Strings;
    onNavigate: (name: NavTarget) => void;
    hrefFor: (name: NavTarget) => string;
    /** Destinations this build has nothing to show for, Versus being the one. */
    hidden: ReadonlySet<NavTarget>;
    /** False when storage is unavailable, so nothing can have been paused. */
    storageOk: boolean;
  }

  const { t, onNavigate, hrefFor, hidden, storageOk }: Props = $props();

  /*
    Whether a game was left running.

    The one piece of state this screen carries, and it earns its place: the
    phone's Play screen leads with it, and a game somebody paused mid-scenario
    is the single most likely reason they opened this page at all. Everything
    else here is a link.
  */
  let paused = $state(false);

  $effect(() => {
    if (!storageOk) {
      return;
    }
    let cancelled = false;
    void loadPausedGame().then((game) => {
      if (!cancelled) {
        paused = game !== undefined;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  interface Entry {
    readonly id: NavTarget;
    readonly title: string;
    readonly detail: string;
    readonly glyph: string;
  }

  /*
    The same five, in the same order, with the same words as the phone.

    Order is the phone's and not alphabetical: the random draw first because it
    is the one that needs no decisions, then your own setup, then the draft,
    which builds the deck you will play with, then the longer commitments.
  */
  const entries = $derived(
    [
      {
        id: 'randomizer' as const,
        title: t.navRandomizer,
        detail: t.hubRandomDetail,
        glyph: '✦',
      },
      {
        id: 'play' as const,
        title: t.navPlay,
        detail: t.hubOwnDetail,
        glyph: '▶',
      },
      {
        id: 'draft' as const,
        title: t.navDraft,
        detail: t.hubDraftDetail,
        glyph: '⇶',
      },
      {
        id: 'campaigns' as const,
        title: t.navCampaigns,
        detail: t.hubCampaignDetail,
        glyph: '◈',
      },
      {
        id: 'versus' as const,
        title: t.navVersus,
        detail: t.versusIntro,
        glyph: '⚔',
      },
    ].filter((entry: Entry) => !hidden.has(entry.id)),
  );

  function go(event: MouseEvent, name: NavTarget): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onNavigate(name);
  }
</script>

<!--
  One screen holding every way of starting a game, as the phone has it.

  Reached only when somebody has asked for the grouped navigation; the five
  screens it gathers keep their own URLs and their own pages either way, so
  this adds a way in rather than a layer to get through.
-->
<section class="page hub">
  <h1>{t.hubStart}</h1>

  {#if achievements.state !== null}
    {@const owned = achievements.state.completion.owned}
    <!-- The achievements, as progress rather than a word: a number and a
         bar are what somebody taps; the word "Achievements" is not. -->
    <a class="surface progress" href={hrefFor('achievements')} onclick={(event) => go(event, 'achievements')}>
      <span class="glyph" aria-hidden="true">★</span>
      <span class="words">
        <span class="title">{t.achievements.hubProgress(owned.won, owned.cells)} <span class="muted small">{t.achievements.hubLabel}</span></span>
        <span class="bar" aria-hidden="true"><span class="fill" style:width={`${owned.cells === 0 ? 0 : Math.round((owned.won / owned.cells) * 100)}%`}></span></span>
      </span>
    </a>
  {/if}

  <ul>
    {#each entries as entry (entry.id)}
      <li>
        <a
          class="surface entry"
          href={hrefFor(entry.id)}
          onclick={(event) => go(event, entry.id)}
        >
          <span class="glyph" aria-hidden="true">{entry.glyph}</span>
          <span class="words">
            <span class="title">
              {entry.title}
              {#if entry.id === 'play' && paused}
                <!-- Said here rather than only on the page it belongs to: the
                     point of a hub is that you can see what is waiting without
                     opening anything. -->
                <span class="waiting">{t.hubPaused}</span>
              {/if}
            </span>
            <span class="detail">{entry.detail}</span>
          </span>
        </a>
      </li>
    {/each}
  </ul>
</section>

<style>
  .hub {
    padding-top: var(--space-5);
  }

  h1 {
    margin: 0 0 var(--space-4);
    font-size: var(--text-xl);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-tight);
  }

  ul {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* Wide enough for two columns and the cards stop being a stack of banners.
     Matched to the measure the rest of the app uses, not chosen by eye. */
  @media (min-width: 48rem) {
    ul {
      grid-template-columns: 1fr 1fr;
    }
  }

  .entry {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    min-height: var(--tap-min);
    padding: var(--space-4);
    color: inherit;
    text-decoration: none;
  }

  .entry:hover {
    border-color: var(--accent);
  }

  .progress {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    margin-bottom: var(--space-3);
    padding: var(--space-3) var(--space-4);
    color: inherit;
    text-decoration: none;
  }

  .progress:hover {
    border-color: var(--accent);
  }

  .progress .words {
    flex: 1;
    display: grid;
    gap: var(--space-1);
  }

  .small {
    font-size: var(--text-sm);
    font-weight: var(--weight-normal);
  }

  .bar {
    display: block;
    height: 5px;
    border-radius: var(--radius-pill);
    background: var(--surface-2);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .glyph {
    flex: none;
    font-size: var(--text-xl);
    line-height: 1.1;
    color: var(--accent);
  }

  .words {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }

  .title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
  }

  .detail {
    color: var(--text-muted);
  }

  /* The one thing on this screen that is news rather than a label. */
  .waiting {
    padding: 2px var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
  }
</style>
