<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import { DESTINATIONS, type ActiveTarget, type NavTarget } from '../lib/nav';
  import Logo from './Logo.svelte';

  interface Props {
    t: Strings;
    onHome: () => void;
    onNavigate: (name: NavTarget) => void;
    hrefFor: (name: NavTarget) => string;
    active: ActiveTarget;
    onSettings: () => void;
  }

  const { t, onHome, onNavigate, hrefFor, active, onSettings }: Props = $props();

  function go(event: MouseEvent, name: NavTarget): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onNavigate(name);
  }

</script>

<!--
  A surface, not a filled red strip.

  The old bar was #E30022 across the full width of every screen. Red at that
  size is not an accent: it was 268px of a 812px viewport, it dragged every
  contrast pairing on the page down with it, and long sessions with it are
  tiring. The red is spent on actions now, where it means something.
-->
<header>
  <div class="page bar">
    <button class="brand" onclick={onHome} type="button">
      <Logo size={28} />
      <span class="wordmark">{t.appName}</span>
    </button>

    <nav aria-label={t.appName}>
      {#each DESTINATIONS as destination (destination.id)}
        <a
          href={hrefFor(destination.id)}
          class:current={active === destination.id ||
            (destination.id === 'search' && active === 'card')}
          aria-current={active === destination.id ? 'page' : undefined}
          onclick={(event) => go(event, destination.id)}
        >
          {destination.label(t)}
        </a>
      {/each}
    </nav>

    <span class="spacer"></span>

    <button class="settings" type="button" onclick={onSettings} aria-label={t.settingsTitle}>
      <span aria-hidden="true">⚙</span>
    </button>
  </div>
</header>

<style>
  header {
    position: sticky;
    top: 0;
    z-index: 20;
    background: var(--surface-1);
    border-bottom: 1px solid var(--hairline);
    /* The status bar sits over this on an installed iOS app, which declares
       `black-translucent` precisely so the bar can extend under it. */
    padding-top: env(safe-area-inset-top);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 56px;
    padding-bottom: 0;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--tap-min);
    padding-inline: var(--space-1);
    margin-inline-start: calc(var(--space-1) * -1);
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    color: inherit;
    cursor: pointer;
  }

  .wordmark {
    font-size: var(--text-lg);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-tight);
  }

  /*
   * Nothing between the brand and the settings on a phone.
   *
   * The bar carried the page name for a while, which put it on screen twice:
   * every page already opens with its own heading, and that one is allowed to
   * wrap where a bar is not.
   */
  nav {
    display: none;
  }

  .spacer {
    flex: 1;
  }

  .settings {
    display: grid;
    place-items: center;
    min-width: var(--tap-min);
    min-height: var(--tap-min);
    border: 0;
    border-radius: var(--radius-pill);
    background: none;
    color: var(--text-muted);
    font-size: var(--text-lg);
    cursor: pointer;
  }

  .settings:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  /*
   * Wide enough for the destinations to sit on the bar itself, which is where
   * a pointer expects them. Below this the tab bar has them.
   *
   * 56rem, not 48: the breakpoint is where the eight labels fit on one line
   * beside the brand and the settings button, measured rather than guessed.
   * The French ones come to about 660px, which with everything else on the bar
   * needs roughly 880px. At 48rem they wrapped to two rows and the header grew
   * from 57px to 93px.
   */
  @media (min-width: 56rem) {
    .spacer {
      display: none;
    }

    nav {
      display: flex;
      flex: 1;
      flex-wrap: wrap;
      gap: var(--space-1);
      justify-content: flex-end;
      min-width: 0;
    }

    nav a {
      display: flex;
      align-items: center;
      min-height: var(--tap-min);
      padding-inline: var(--space-3);
      border-radius: var(--radius-pill);
      color: var(--text-muted);
      text-decoration: none;
      font-weight: var(--weight-medium);
      white-space: nowrap;
    }

    nav a:hover {
      background: var(--surface-2);
      color: var(--text);
    }

    nav a.current {
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: var(--weight-semibold);
    }
  }
</style>
