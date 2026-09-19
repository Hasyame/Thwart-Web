<script lang="ts">
  import NavIcon from './NavIcon.svelte';
  import type { Strings } from '../lib/i18n';
  import { tabFor, tabsFor, type ActiveTarget, type NavTarget } from '../lib/nav';

  interface Props {
    t: Strings;
    active: ActiveTarget;
    onNavigate: (name: NavTarget) => void;
    hrefFor: (name: NavTarget) => string;
    onMore: () => void;
    /** True while the More sheet is open, so the tab can say so. */
    moreOpen: boolean;
    /** Whether the ways of playing share one tab. See `groupedPlay`. */
    grouped: boolean;
  }

  const { t, active, onNavigate, hrefFor, onMore, moreOpen, grouped }: Props = $props();

  const tabs = $derived(tabsFor(grouped));

  function go(event: MouseEvent, name: NavTarget): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onNavigate(name);
  }

  /*
    Which tab is lit.

    Worked out by `tabFor`, because with the play screens grouped there is no
    Campaigns tab to light when somebody is on /campaigns and the hub has to
    take it — the same rule the More sheet needs, so it lives in one place.
  */
  const current = $derived(tabFor(active, grouped));
  const isCurrent = (id: NavTarget): boolean => current === id;
</script>

<!--
  A tab bar rather than a menu, on phones only.

  Eight destinations in a wrapping strip at the top cost 268px — a third of an
  iPhone X viewport — before a single card was visible, and each of its links
  rendered 30px tall against a 44pt floor. Four tabs and a More is the
  arrangement where every destination is both reachable and hittable.
-->
<nav class="tabs" aria-label={t.navMoreTitle}>
  {#each tabs as tab (tab.id)}
    <a
      href={hrefFor(tab.id)}
      class:current={isCurrent(tab.id)}
      class:play={tab.id === 'hub' || tab.id === 'play'}
      aria-current={isCurrent(tab.id) ? 'page' : undefined}
      onclick={(event) => go(event, tab.id)}
    >
      <span class="glyph"><NavIcon name={tab.id} /></span>
      <span class="label">{tab.tab(t)}</span>
    </a>
  {/each}

  <button type="button" class:current={moreOpen || !tabs.some((tab) => tab.id === current)} aria-expanded={moreOpen} aria-haspopup="dialog" onclick={onMore}>
    <span class="glyph"><NavIcon name="more" /></span>
    <span class="label">{t.navMore}</span>
  </button>
</nav>

<style>
  .tabs {
    position: fixed;
    inset-inline: 0;
    bottom: 0;
    z-index: 30;
    display: flex;
    background: var(--surface-1);
    border-top: 1px solid var(--hairline);
    box-shadow: 0 -4px 24px rgb(0 0 0 / 12%);

    /*
     * The home indicator sits over the bottom of the screen, so the bar is
     * padded out from under it rather than being hidden by it. Zero everywhere
     * that has no such thing.
     */
    padding-bottom: var(--safe-bottom);
    padding-inline: max(0px, env(safe-area-inset-left)) max(0px, env(safe-area-inset-right));
  }

  .tabs a,
  .tabs button {
    flex: 1 1 0;
    /* Without this a long label widens its own tab and squeezes the others
       below the tap floor; French needs it. */
    min-width: 0;

    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-0-5);

    min-height: 4rem;
    padding: var(--space-2) var(--space-1);
    border: 0;
    background: none;
    cursor: pointer;

    color: var(--text-muted);
    font: inherit;
    font-size: var(--text-2xs);
    font-weight: var(--weight-medium);
    line-height: 1.15;
    text-align: center;
    text-decoration: none;
  }

  .tabs a.current,
  .tabs button.current {
    color: var(--accent);
    font-weight: var(--weight-semibold);
  }

  .glyph {
    display: grid;
    place-items: center;
    line-height: 1;
    padding: 3px var(--space-3);
    border-radius: var(--radius-pill);
  }

  .tabs a.play .glyph {
    background: var(--accent);
    color: var(--accent-ink);
    border-radius: 12px 4px 12px 4px;
    box-shadow: 2px 2px 0 var(--text);
  }

  .tabs a:focus-visible, .tabs button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -4px;
  }

  /* The active tab is marked by a filled pill behind its glyph as well as by
     colour, so it is not colour alone doing the work (WCAG 1.4.1). */
  .tabs a.current .glyph,
  .tabs button.current .glyph {
    background: var(--accent-soft);
  }

  /*
   * The band between a phone and a full top bar: 56rem to 85rem.
   *
   * Tablets and half-width desktop windows land here, and they keep the tab
   * bar — that is what tablets do, and it is the only arrangement where every
   * destination stays both reachable and hittable. What changes is the width:
   * five tabs stretched across 1200px puts each label a hand's width from the
   * next and leaves the bar looking like a mistake. Centred and capped, it
   * reads as one control rather than as a stretched phone layout, while the
   * bar's own background still spans the window so nothing floats.
   *
   * The two dialogs already switch to a centred treatment at 56rem, so the
   * band gets tablet dialogs with tablet navigation, which is the pairing that
   * was missing.
   */
  @media (min-width: 56rem) {
    .tabs {
      justify-content: center;
    }

    .tabs a,
    .tabs button {
      flex: 0 1 9rem;
    }
  }

  /* Tabs are a phone arrangement. Above this the top bar carries everything.
     85rem is where ten labels fit on one line; see the note in TopBar. */
  @media (min-width: 85rem) {
    .tabs {
      display: none;
    }
  }
</style>
