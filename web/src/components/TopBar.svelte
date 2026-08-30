<script lang="ts">
  import type { Locale } from '../lib/types';
  import type { ThemeChoice } from '../lib/preferences';
  import { LANGUAGE_NAMES, type Strings } from '../lib/i18n';

  interface Props {
    t: Strings;
    uiLocale: Locale;
    cardLocale: Locale;
    theme: ThemeChoice;
    onUiLocale: (locale: Locale) => void;
    onCardLocale: (locale: Locale) => void;
    onTheme: (theme: ThemeChoice) => void;
    onHome: () => void;
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
  }: Props = $props();
</script>

<header>
  <div class="page bar">
    <button class="brand" onclick={onHome} type="button">
      <span class="shield" aria-hidden="true">🛡️</span>
      <span class="names">
        <span class="title">{t.appName}</span>
        <span class="tagline muted">{t.tagline}</span>
      </span>
    </button>

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
  header {
    background: var(--md-primary);
    color: var(--md-on-primary);
    border-bottom: 3px solid var(--md-secondary);
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

  .shield {
    font-size: 1.6rem;
    line-height: 1;
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
     wrong contrast on the primary bar, so it is overridden here. */
  .tagline,
  .label {
    color: color-mix(in srgb, var(--md-on-primary) 78%, transparent);
  }

  .tagline {
    font-size: 0.82rem;
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
