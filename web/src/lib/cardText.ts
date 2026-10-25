/**
 * Card text as MarvelCDB writes it, made readable.
 *
 * Reapply the formatting allow-list for stale caches and linked cards, then
 * render MarvelCDB's trait markup, such as [[AERIAL]], in bold italics.
 */
import { safeCardMarkup } from './safeMarkup.js';

export function cardHtml(text: string): string {
  return safeCardMarkup(text).replace(/\[\[([^\]]+)\]\]/g, '<b><i>$1</i></b>');
}
