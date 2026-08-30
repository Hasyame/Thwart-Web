/**
 * The web port of the app's `SearchNormalizer`.
 *
 * This is deliberately plain JavaScript with JSDoc types rather than
 * TypeScript, so that the Node build script and the browser bundle import the
 * *same file*. There must be exactly one implementation of this function in
 * the project: if the build folds text one way and the query folds it another,
 * search silently stops finding things, and it stops finding them in a way no
 * test written against either half alone would catch.
 *
 * Kotlin source of truth:
 * `domain/search/SearchNormalizer.kt` in the Android repository.
 *
 * Lowercases, strips diacritics, removes the HTML markup MarvelCDB embeds in
 * card text, and collapses everything that is not a letter or a digit to a
 * single space. Applying it to both the indexed text and the query is what
 * makes `strategie` match `Stratégie` and `spider man` match `Spider-Man`.
 */

const HTML_TAG = /<[^>]*>/g;
const COMBINING_MARKS = /\p{Mn}+/gu;
const NON_SEARCHABLE = /[^\p{L}\p{N}]+/gu;

/**
 * Folds text into the form the index stores and queries are compared against.
 *
 * @param {string | null | undefined} input
 * @returns {string} the folded text, or an empty string for empty input
 */
export function normalizeForSearch(input) {
  if (input === null || input === undefined || input === '') {
    return '';
  }
  const withoutMarkup = String(input).replace(HTML_TAG, ' ');
  // NFD splits `é` into `e` plus a combining acute, which the next line drops.
  const decomposed = withoutMarkup.normalize('NFD');
  const withoutAccents = decomposed.replace(COMBINING_MARKS, '');
  return withoutAccents.replace(NON_SEARCHABLE, ' ').trim().toLowerCase();
}

/**
 * Splits a raw query into folded tokens.
 *
 * The app builds an FTS4 `MATCH` expression that prefix-matches every token,
 * so `spid ma` finds Spider-Man while you are still typing. There is no FTS
 * engine in the browser, so the caller does the prefix matching itself — but
 * the tokenisation has to agree with the app's, which is why it lives here
 * beside the folding rather than in the search component.
 *
 * An empty result means "no filter", not "no results".
 *
 * @param {string} rawQuery
 * @returns {string[]}
 */
export function queryTokens(rawQuery) {
  const folded = normalizeForSearch(rawQuery);
  if (folded === '') {
    return [];
  }
  return folded.split(' ').filter((token) => token.length > 0);
}
