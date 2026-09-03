<script lang="ts">
  import type { Locale } from '../lib/types';
  import type { Strings } from '../lib/i18n';
  import type { ThemeChoice } from '../lib/preferences';
  import { LANGUAGE_NAMES } from '../lib/i18n';
  import { OVERFLOW, type NavTarget } from '../lib/nav';

  interface Props {
    t: Strings;
    uiLocale: Locale;
    cardLocale: Locale;
    theme: ThemeChoice;
    open: boolean;
    active: NavTarget | 'card';
    /** True on a phone, where the sheet also carries the destinations. */
    showDestinations: boolean;
    onUiLocale: (locale: Locale) => void;
    onCardLocale: (locale: Locale) => void;
    onTheme: (theme: ThemeChoice) => void;
    onNavigate: (name: NavTarget) => void;
    hrefFor: (name: NavTarget) => string;
    onClose: () => void;
  }

  const {
    t,
    uiLocale,
    cardLocale,
    theme,
    open,
    active,
    showDestinations,
    onUiLocale,
    onCardLocale,
    onTheme,
    onNavigate,
    hrefFor,
    onClose,
  }: Props = $props();

  let dialog = $state.raw<HTMLDialogElement | null>(null);

  /*
   * A real <dialog>, opened modally.
   *
   * Escape closing it, the focus trap and the inertness of the page behind are
   * the platform's; hand-rolling them is how a sheet ends up unreachable from
   * a keyboard.
   */
  $effect(() => {
    const element = dialog;
    if (element === null) {
      return;
    }
    if (open && !element.open) {
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  });

  function go(event: MouseEvent, name: NavTarget): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onNavigate(name);
    onClose();
  }
</script>

<dialog bind:this={dialog} onclose={onClose} aria-label={t.navMoreTitle}>
  <div class="sheet">
    <header>
      <h2>{showDestinations ? t.navMoreTitle : t.settingsTitle}</h2>
      <button class="btn btn--text" type="button" onclick={onClose}>{t.close}</button>
    </header>

    {#if showDestinations}
      <!-- The destinations the tab bar has no room for. Full width rows rather
           than a grid: a row can hold "Partie aléatoire" without shrinking its
           own hit area to fit. -->
      <nav>
        {#each OVERFLOW as destination (destination.id)}
          <a
            href={hrefFor(destination.id)}
            class:current={active === destination.id}
            aria-current={active === destination.id ? 'page' : undefined}
            onclick={(event) => go(event, destination.id)}
          >
            <span class="glyph" aria-hidden="true">{destination.glyph}</span>
            <span>{destination.label(t)}</span>
          </a>
        {/each}
      </nav>
    {/if}

    <!--
      The three settings that used to sit in the header on every screen.

      They are answered once and then never again, and they were costing a
      third of a phone viewport on every page to stay reachable.
    -->
    <section>
      <h3 class="eyebrow">{t.settingsTitle}</h3>

      <label class="field-group">
        <span class="field-label">{t.interfaceLanguage}</span>
        <select
          class="field"
          value={uiLocale}
          onchange={(event) => onUiLocale(event.currentTarget.value as Locale)}
        >
          {#each Object.entries(LANGUAGE_NAMES) as [code, name] (code)}
            <option value={code}>{name}</option>
          {/each}
        </select>
      </label>

      <label class="field-group">
        <span class="field-label">{t.cardLanguage}</span>
        <select
          class="field"
          value={cardLocale}
          onchange={(event) => onCardLocale(event.currentTarget.value as Locale)}
        >
          {#each Object.entries(LANGUAGE_NAMES) as [code, name] (code)}
            <option value={code}>{name}</option>
          {/each}
        </select>
      </label>

      <label class="field-group">
        <span class="field-label">{t.theme}</span>
        <select
          class="field"
          value={theme}
          onchange={(event) => onTheme(event.currentTarget.value as ThemeChoice)}
        >
          <option value="system">{t.themeSystem}</option>
          <option value="light">{t.themeLight}</option>
          <option value="dark">{t.themeDark}</option>
        </select>
      </label>
    </section>
  </div>
</dialog>

<style>
  /*
   * A sheet from the bottom on a phone, a centred dialog on a desktop.
   *
   * Anchored to the bottom because that is where the thumb is and where the
   * control that opened it lives.
   */
  dialog {
    margin: 0;
    margin-block-start: auto;
    width: 100%;
    max-width: 100%;
    max-height: 88dvh;
    padding: 0;
    border: 0;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--surface-1);
    color: var(--text);
    box-shadow: var(--shadow-2);
    overflow: auto;
    overscroll-behavior: contain;
  }

  dialog::backdrop {
    background: var(--scrim);
  }

  /*
   * The same inset as every panel in the app, not less.
   *
   * This was `--space-4` where a panel is `--space-4 --space-5`, so the sheet
   * ran its text and its fields nearer the edge of the phone than anything
   * else on screen — and being full-bleed, there was no card edge to soften it.
   *
   * The insets matter on both sides here. A phone held in landscape puts the
   * notch over one of them, and the sheet is the full width of the screen.
   * `max()` rather than addition, because the inset is zero in portrait and
   * adding it would leave the ordinary case with nothing.
   */
  .sheet {
    display: grid;
    gap: var(--space-5);
    padding-block: var(--space-5)
      /* Clear of the home indicator, which sits over the bottom of the sheet. */
      calc(var(--space-6) + env(safe-area-inset-bottom));
    padding-inline: max(var(--space-5), env(safe-area-inset-left))
      max(var(--space-5), env(safe-area-inset-right));
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  h2 {
    font-size: var(--text-xl);
    font-weight: var(--weight-bold);
  }

  nav {
    display: grid;
    gap: var(--space-1);
  }

  /*
   * Pulled back out to the sheet's own inset.
   *
   * A row needs padding for its hover and selected states to have somewhere to
   * sit, but that padding would otherwise indent the label past the headings
   * above and below it. The negative margin cancels it, so the text lines up
   * with everything else in the sheet and only the highlight extends.
   */
  nav a {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--tap-min);
    padding: var(--space-2);
    margin-inline: calc(var(--space-2) * -1);
    border-radius: var(--radius-sm);
    color: inherit;
    text-decoration: none;
    font-weight: var(--weight-medium);
  }

  nav a:hover {
    background: var(--surface-2);
  }

  nav a.current {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: var(--weight-semibold);
  }

  .glyph {
    width: 1.5rem;
    text-align: center;
    font-size: var(--text-lg);
    line-height: 1;
  }

  section {
    display: grid;
    gap: var(--space-3);
  }

  @media (min-width: 56rem) {
    dialog {
      margin: auto;
      width: min(28rem, calc(100vw - 2rem));
      border-radius: var(--radius-md);
    }
  }
</style>
