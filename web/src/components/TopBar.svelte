<script lang="ts">
  import type { Locale } from '../lib/types';
  import type { ThemeChoice } from '../lib/preferences';
  import { LANGUAGE_NAMES, type Strings } from '../lib/i18n';
  import Logo from './Logo.svelte';

  type NavTarget =
    | 'search'
    | 'collection'
    | 'decks'
    | 'randomizer'
    | 'play'
    | 'campaigns'
    | 'stats';

  interface Props {
    t: Strings;
    uiLocale: Locale;
    cardLocale: Locale;
    theme: ThemeChoice;
    onUiLocale: (locale: Locale) => void;
    onCardLocale: (locale: Locale) => void;
    onTheme: (theme: ThemeChoice) => void;
    onHome: () => void;
    onNavigate: (name: NavTarget) => void;
    hrefFor: (name: NavTarget) => string;
    active: NavTarget | 'card';
  }

  const {
    t,
    uiLocale,
    cardLocale,
    theme,
    onUiLocale,
    onCardLocale,
    onTheme,
    onHome,
    onNavigate,
    hrefFor,
    active,
  }: Props = $props();

  /** Plain clicks route in-app; modified clicks stay the browser's business. */
  function go(event: MouseEvent, name: NavTarget): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onNavigate(name);
  }
</script>

<header>
  <div class="page bar">
    <button class="brand" onclick={onHome} type="button">
      <Logo size={40} />
      <span class="names">
        <span class="title">{t.appName}</span>
        <span class="tagline muted">{t.tagline}</span>
      </span>
    </button>

    <nav>
      <a
        href={hrefFor('search')}
        class:current={active === 'search' || active === 'card'}
        onclick={(event) => go(event, 'search')}
      >
        {t.navCards}
      </a>
      <a
        href={hrefFor('collection')}
        class:current={active === 'collection'}
        onclick={(event) => go(event, 'collection')}
      >
        {t.navCollection}
      </a>
      <a
        href={hrefFor('decks')}
        class:current={active === 'decks'}
        onclick={(event) => go(event, 'decks')}
      >
        {t.navDecks}
      </a>
      <a
        href={hrefFor('randomizer')}
        class:current={active === 'randomizer'}
        onclick={(event) => go(event, 'randomizer')}
      >
        {t.navRandomizer}
      </a>
      <a
        href={hrefFor('play')}
        class:current={active === 'play'}
        onclick={(event) => go(event, 'play')}
      >
        {t.navPlay}
      </a>
      <a
        href={hrefFor('campaigns')}
        class:current={active === 'campaigns'}
        onclick={(event) => go(event, 'campaigns')}
      >
        {t.navCampaigns}
      </a>
      <a
        href={hrefFor('stats')}
        class:current={active === 'stats'}
        onclick={(event) => go(event, 'stats')}
      >
        {t.navStats}
      </a>
    </nav>

    <div class="controls">
      <label class="control">
        <span class="label muted">{t.interfaceLanguage}</span>
        <select
          value={uiLocale}
          onchange={(event) => onUiLocale(event.currentTarget.value as Locale)}
        >
          {#each Object.entries(LANGUAGE_NAMES) as [code, name] (code)}
            <option value={code}>{name}</option>
          {/each}
        </select>
      </label>

      <label class="control">
        <span class="label muted">{t.cardLanguage}</span>
        <select
          value={cardLocale}
          onchange={(event) => onCardLocale(event.currentTarget.value as Locale)}
        >
          {#each Object.entries(LANGUAGE_NAMES) as [code, name] (code)}
            <option value={code}>{name}</option>
          {/each}
        </select>
      </label>

      <label class="control">
        <span class="label muted">{t.theme}</span>
        <select
          value={theme}
          onchange={(event) => onTheme(event.currentTarget.value as ThemeChoice)}
        >
          <option value="system">{t.themeSystem}</option>
          <option value="light">{t.themeLight}</option>
          <option value="dark">{t.themeDark}</option>
        </select>
      </label>
    </div>
  </div>
</header>

<style>
  /*
   * The heading pair, not primary/on-primary.
   *
   * In the dark scheme `primary` is the bright coral and Material pairs it with
   * dark maroon — one hue twice with nothing between, which Color.kt describes
   * as legible on a contrast table and mud on a phone. `HeadingFill` on
   * `HeadingInk` separates in luminance *and* hue, and is the same pair in both
   * themes, so the bar does not change character when the lights go out.
   */
  header {
    background: var(--md-heading-fill);
    color: var(--md-heading-ink);
    border-bottom: 3px solid var(--md-arc-gold);
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding-block: var(--space-3);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    background: none;
    border: 0;
    padding: var(--space-1) var(--space-2);
    margin-inline-start: calc(var(--space-2) * -1);
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: inherit;
    text-align: start;
  }

  .brand:hover .title {
    text-decoration: underline;
  }

  .names {
    display: flex;
    flex-direction: column;
  }

  .title {
    font-size: 1.35rem;
    font-weight: 700;
    letter-spacing: 0.01em;
  }

  /* The muted class is defined globally against surface text, which is the
     wrong contrast on the heading strip, so it is overridden here. */
  .tagline,
  .label {
    color: color-mix(in srgb, var(--md-heading-ink) 78%, transparent);
  }

  .tagline {
    font-size: 0.82rem;
  }

  nav {
    display: flex;
    gap: var(--space-1);
  }

  nav a {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-lg);
    color: inherit;
    text-decoration: none;
    font-weight: 600;
    font-size: 0.95rem;
  }

  nav a:hover {
    background: color-mix(in srgb, var(--md-heading-ink) 14%, transparent);
  }

  nav a.current {
    background: color-mix(in srgb, var(--md-heading-ink) 22%, transparent);
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .control {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  select {
    background: var(--md-surface);
    color: var(--md-on-surface);
    border: 1px solid var(--md-outline);
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-2);
  }

  @media (max-width: 40rem) {
    .tagline {
      display: none;
    }
  }
</style>
