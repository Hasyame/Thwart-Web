<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import { DESTINATIONS, visible, type ActiveTarget, type NavTarget } from '../lib/nav';
  import Logo from './Logo.svelte';

  interface Props {
    t: Strings;
    onHome: () => void;
    onNavigate: (name: NavTarget) => void;
    hrefFor: (name: NavTarget) => string;
    active: ActiveTarget;
    onSettings: () => void;
    onAccount: () => void;
    /** The handle when somebody is signed in, so the button can show who. */
    accountHandle: string | null;
    /** Destinations this build has nothing to show for. */
    hidden?: ReadonlySet<NavTarget>;
  }

  const {
    t,
    onHome,
    onNavigate,
    hrefFor,
    active,
    onSettings,
    onAccount,
    accountHandle,
    hidden = new Set<NavTarget>(),
  }: Props =
    $props();

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
      {#each visible(DESTINATIONS, hidden) as destination (destination.id)}
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

    <!--
      The account, on every screen.

      Not in the overflow sheet with the settings: an account is the thing this
      app is about to be built around, and something reached by opening a menu
      and reading past four destinations is something most people never find.
      It shows who is signed in rather than only that somebody is, because
      "which account is this browser on" is the question it gets asked.
    -->
    <button
      class="account"
      class:on={accountHandle !== null}
      type="button"
      onclick={onAccount}
      aria-label={accountHandle === null ? t.accountSignIn : t.accountTitle}
    >
      {#if accountHandle === null}
        <!-- A word, not a glyph. A ring in the corner of a bar names nothing,
             and this is the control the app is about to be built around. -->
        <span class="label">{t.navSignIn}</span>
      {:else}
        <span class="initial" aria-hidden="true">{accountHandle.slice(0, 1).toUpperCase()}</span>
      {/if}
    </button>

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

  .account {
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

  /* Outlined, so the word reads as something to press rather than as a caption
     sitting next to the brand. */
  .account .label {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    color: var(--text);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    white-space: nowrap;
  }

  .account:hover .label {
    border-color: var(--accent);
    color: var(--accent);
  }

  .account:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  /* Signed in, and said with a filled mark rather than only a colour: this is
     the one control whose two states have to be told apart at a glance. */
  .account.on .initial {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-pill);
    background: var(--accent);
    color: var(--accent-ink);
    font-size: var(--text-sm);
    font-weight: var(--weight-bold);
  }

  /*
   * Wide enough for the destinations to sit on the bar itself, which is where
   * a pointer expects them. Below this the tab bar has them.
   *
   * Measured, never guessed: with `flex-wrap: nowrap` the bar reports the width
   * it actually needs. Nine French labels come to 912px, and with the brand,
   * the account button, the settings button and the page padding the whole bar
   * needs 1229px — 78.8rem. So 80rem, with a little room.
   *
   * It was 56rem when there were eight shorter destinations. Adding Versus and
   * lengthening Collection to "Ma collection" pushed it past what 56rem holds,
   * and the bar wrapped to two rows: the header grew from 57px to 93px, which
   * is the thing this breakpoint exists to prevent. Below it every destination
   * is still reachable — four on the tab bar and the rest in the More sheet.
   *
   * Kept in step with BottomNav and the body padding in app.css. The 56rem in
   * the two dialogs is a different question — sheet or centred dialog — and is
   * deliberately left where it is.
   */
  @media (min-width: 80rem) {
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
