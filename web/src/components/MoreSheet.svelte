<script lang="ts">
  import type { Locale } from '../lib/types';
  import type { Strings } from '../lib/i18n';
  import type { ThemeChoice } from '../lib/preferences';
  import { LANGUAGE_NAMES } from '../lib/i18n';
  import { overflowFor, visible, type ActiveTarget, type NavTarget } from '../lib/nav';
  import { appSettings, setAppSettings } from '../lib/appsettings.svelte';
  import { bgg, bggRelayReady } from '../lib/bgg.svelte';

  interface Props {
    t: Strings;
    uiLocale: Locale;
    cardLocale: Locale;
    theme: ThemeChoice;
    open: boolean;
    active: ActiveTarget;
    /** True on a phone, where the sheet also carries the destinations. */
    showDestinations: boolean;
    onUiLocale: (locale: Locale) => void;
    onCardLocale: (locale: Locale) => void;
    onTheme: (theme: ThemeChoice) => void;
    onNavigate: (name: NavTarget) => void;
    hrefFor: (name: NavTarget) => string;
    /** The account is not a tab, so the sheet is how it is reached. */
    onAccount: () => void;
    /** BoardGameGeek has a page of its own under Settings; this opens it. */
    onBgg: () => void;
    /** The handle when somebody is signed in, so the row says who. */
    accountHandle: string | null;
    /** Destinations this build has nothing to show for. */
    hidden?: ReadonlySet<NavTarget>;
    /** Whether the ways of playing share one tab. See `groupedPlay`. */
    grouped: boolean;
    onGrouped: (grouped: boolean) => void;
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
    grouped,
    onGrouped,
    onAccount,
    onBgg,
    accountHandle,
    hidden = new Set<NavTarget>(),
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
        {#each visible(overflowFor(grouped), hidden) as destination (destination.id)}
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
      <h3 class="eyebrow">{t.accountTitle}</h3>
      <button
        class="account"
        type="button"
        onclick={() => {
          onAccount();
          onClose();
        }}
      >
        <span class="glyph" aria-hidden="true">◉</span>
        <span class="who">
          {accountHandle ?? t.accountSignIn}
          {#if accountHandle !== null}
            <span class="muted sub">{t.accountSignedInAs}</span>
          {/if}
        </span>
        <span class="muted" aria-hidden="true">›</span>
      </button>
    </section>

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

      <!--
        One Play tab, or four separate destinations.

        A setting rather than something detected: telling an installed app from
        a browser tab means `display-mode`, and Firefox for Android reports
        `browser` either way because it has never supported installing a
        manifest at all. This also lets somebody have the grouped arrangement
        in an ordinary tab, which detection would never have offered.
      -->
      <label class="tick">
        <input
          type="checkbox"
          checked={grouped}
          onchange={(event) => onGrouped(event.currentTarget.checked)}
        />
        <span>{t.settingsGroupedPlay}</span>
      </label>
      <p class="muted note">{t.settingsGroupedPlayHint}</p>

      <!--
        The two preferences the account carries that had nowhere to be set.
        They arrived here from a phone and sat unread; these are the controls.
      -->
      <label class="tick">
        <input
          type="checkbox"
          checked={appSettings.value.trackEncounter === true}
          onchange={(event) =>
            void setAppSettings({ trackEncounter: event.currentTarget.checked })}
        />
        <span>{t.trackEncounter}</span>
      </label>
      <p class="muted note">{t.trackEncounterNote}</p>

      <label class="field-group">
        <span class="field-label">{t.playLocation}</span>
        <input
          class="field"
          type="text"
          value={appSettings.value.playLocation}
          onchange={(event) => void setAppSettings({ playLocation: event.currentTarget.value })}
        />
        <span class="muted note">{t.playLocationNote}</span>
      </label>

      <!--
        BoardGameGeek, a page of its own, as on the phone.

        Connected on this device and nowhere else: the connection lives in
        this browser's own storage, is never synced and never written to a
        backup. The row says who this browser is there, when it is anyone.
      -->
      <button
        class="account"
        type="button"
        onclick={() => {
          onBgg();
          onClose();
        }}
      >
        <span class="glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
            <!-- A meeple, which is what BGG puts beside everything. -->
            <path d="M12 2.5c-1.9 0-3.3 1.5-3.3 3.4 0 1.1.5 2 1.2 2.7-.3.4-.9.8-2.2 1.3C5 10.9 2.5 12.3 2.5 14c0 1.2.9 1.9 2 1.9.9 0 1.9-.4 3-1.2l-1.4 5.6c-.2.7.3 1.2 1 1.2h2.4c.5 0 .8-.3 1-.7L12 17.6l1.5 3.2c.2.4.5.7 1 .7h2.4c.7 0 1.2-.5 1-1.2l-1.4-5.6c1.1.8 2.1 1.2 3 1.2 1.1 0 2-.7 2-1.9 0-1.7-2.5-3.1-5.2-4.1-1.3-.5-1.9-.9-2.2-1.3.7-.7 1.2-1.6 1.2-2.7 0-1.9-1.4-3.4-3.3-3.4z" />
          </svg>
        </span>
        <span class="who">
          {t.bggTitle}
          <span class="muted sub">
            {bggRelayReady() ? t.bggConnectedAs(bgg.username) : t.bggMenuSubtitle}
          </span>
        </span>
        <span class="muted" aria-hidden="true">›</span>
      </button>
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
      calc(var(--space-6) + var(--safe-bottom));
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
    display: inline-grid;
    place-items: center;
  }

  section {
    display: grid;
    gap: var(--space-3);
  }

  /* The same row as a destination, because that is what it is. */
  .account {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--tap-min);
    padding: var(--space-2);
    margin-inline: calc(var(--space-2) * -1);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    font-weight: var(--weight-medium);
    text-align: start;
    cursor: pointer;
  }

  .account:hover {
    background: var(--surface-2);
  }

  .account .who {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .sub {
    font-size: var(--text-2xs);
    font-weight: var(--weight-normal);
  }

  @media (min-width: 56rem) {
    dialog {
      margin: auto;
      width: min(28rem, calc(100vw - 2rem));
      border-radius: var(--radius-md);
    }
  }
</style>
