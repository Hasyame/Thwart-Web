import type { Locale } from './types';
import { detectLocale } from './i18n';

/**
 * Small per-browser preferences.
 *
 * `localStorage` is the right home for exactly this kind of thing — a
 * remembered toggle, private to one browser, harmless if it comes back empty.
 * It is emphatically *not* where the collection and play history will live
 * when W2 arrives; that is IndexedDB, per doc 03.
 *
 * Every access is wrapped, because a private window, cleared site data or a
 * browser configured to block storage all throw rather than returning null.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY_UI_LOCALE = 'thwart.uiLocale';
const KEY_CARD_LOCALE = 'thwart.cardLocale';
const KEY_THEME = 'thwart.theme';
const KEY_GROUPED_PLAY = 'thwart.groupedPlay';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A browser that will not store a preference still has to render a page.
  }
}

function asLocale(value: string | null, fallback: Locale): Locale {
  return value === 'en' || value === 'fr' ? value : fallback;
}

export function loadUiLocale(): Locale {
  return asLocale(read(KEY_UI_LOCALE), detectLocale());
}

/**
 * The card language, which defaults to the interface language but is stored
 * separately and can differ. The app treats these as independent settings and
 * says why: reading a card in English while the interface is in French is a
 * stated requirement.
 */
export function loadCardLocale(uiLocale: Locale): Locale {
  return asLocale(read(KEY_CARD_LOCALE), uiLocale);
}

export function loadTheme(): ThemeChoice {
  const stored = read(KEY_THEME);
  return stored === 'light' || stored === 'dark' || stored === 'system'
    ? stored
    : 'system';
}

export function saveUiLocale(locale: Locale): void {
  write(KEY_UI_LOCALE, locale);
}

export function saveCardLocale(locale: Locale): void {
  write(KEY_CARD_LOCALE, locale);
}

export function saveTheme(theme: ThemeChoice): void {
  write(KEY_THEME, theme);
}

/**
 * Whether the ways of playing share one tab.
 *
 * The phone app puts the random draw, your own setup, the campaigns and versus
 * behind a single Play screen, and this is how the browser can do the same.
 *
 * A setting rather than something worked out from `display-mode`, which would
 * have been the obvious way to tell an installed app from a tab. Firefox for
 * Android reports `browser` even when the site was opened from the home
 * screen -- it has never supported installing a manifest, so there is no
 * standalone mode there to detect -- and a feature that silently never appears
 * on one of the two browsers people actually use is not a feature.
 *
 * Device-local, like the other three here, and never synced: the `settings`
 * record is fixed at five keys by the contract with the phone, so a sixth would
 * be dropped on its next write and the toggle would turn itself off.
 *
 * Off by default. Somebody who has used the web app already knows where things
 * are, and moving them without being asked is not an improvement.
 */
export function loadGroupedPlay(): boolean {
  return read(KEY_GROUPED_PLAY) === 'on';
}

export function saveGroupedPlay(grouped: boolean): void {
  write(KEY_GROUPED_PLAY, grouped ? 'on' : 'off');
}

/**
 * Applies the theme to the document root.
 *
 * "system" removes the attribute rather than setting it, so the CSS falls
 * through to the `prefers-color-scheme` block. The generated stylesheet is
 * built around that three-state arrangement.
 */
export function applyTheme(theme: ThemeChoice): void {
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
}
