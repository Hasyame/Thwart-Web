/**
 * Card text as MarvelCDB writes it, made readable.
 *
 * The text arrives sanitised (scripts/fetch-cards.mjs keeps a short allow-list
 * of tags) but still carries MarvelCDB's own trait markup, `[[AERIAL]]`, which
 * the site renders in bold italics and which 2,021 cards use. Wrapping it here,
 * after sanitising and before painting, adds two tags the allow-list already
 * permits and nothing else: the brackets can hold no markup of their own.
 */
export function cardHtml(text: string): string {
  return text.replace(/\[\[([^\]]+)\]\]/g, '<b><i>$1</i></b>');
}
