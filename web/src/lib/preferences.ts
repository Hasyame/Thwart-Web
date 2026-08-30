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
