/**
 * Campaign prose, as something a screen can render rather than a string.
 *
 * A template writes card references as `{card:CODE}` and draw references as
 * `{drawId}`, because neither is knowable when the campaign is written: the
 * card's name depends on the reader's language, and the draw's depends on what
 * the app dealt. Printing the placeholder put a five-digit code in the middle
 * of a French sentence.
 *
 * Ported from `ui/campaign/CampaignText.kt`. The result is a list of segments
 * rather than a filled-in string so a card reference can be a thing to point
 * at — hovered for the picture, opened for the card — instead of quoted text.
 */

/** One piece of a rendered campaign sentence. */
export type TextSegment =
  | { readonly kind: 'text'; readonly text: string }
  /** A word the campaign gives its own meaning to, set apart as it is in print. */
  | { readonly kind: 'keyword'; readonly text: string }
  | { readonly kind: 'card'; readonly code: string; readonly name: string };

export interface TextContext {
  /** A card's name in the reader's card language, or the code if unknown. */
  readonly cardName: (code: string) => string;
  /** What a draw came up with, by draw id. Empty when nothing was dealt. */
  readonly drawnFor: (drawId: string) => readonly string[];
}

/**
 * Words a campaign gives a specific meaning to.
 *
 * MISSION and OVERSEER are not descriptions in Age of Apocalypse: a MISSION
 * side scheme cannot be thwarted and an OVERSEER minion sits outside any
 * player's control. Reading them as ordinary words loses that, so they are set
 * apart the way the printed material sets them.
 */
const KEYWORDS = [
  'MISSION',
  'OVERSEER',
  'PRELATE',
  // The two faces of a Fear No Evil environment: which card, and which way up.
  'ACHEVÉ',
  'ÉCHOUÉ',
  'ACHIEVED',
  'FAILED',
] as const;

/**
 * Bounded by letter lookarounds rather than `\b`.
 *
 * `\b` is defined against ASCII word characters, so it would break ACHEVÉ in
 * the middle and match inside a longer French word.
 */
const KEYWORD_PATTERN = new RegExp(
  KEYWORDS.map((word) => `(?<!\\p{L})${word}(?!\\p{L})`).join('|'),
  'gu',
);

const TOKEN_PATTERN = /\{(card:)?([A-Za-z0-9_]+)\}/g;

/** Collapses the gaps a dropped placeholder leaves behind. */
const tidy = (text: string): string => text.replace(/[ \t]{2,}/g, ' ');

function keywordSegments(text: string): TextSegment[] {
  if (text === '') {
    return [];
  }
  const out: TextSegment[] = [];
  let index = 0;
  KEYWORD_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(KEYWORD_PATTERN)) {
    const at = match.index;
    if (at > index) {
      out.push({ kind: 'text', text: text.slice(index, at) });
    }
    out.push({ kind: 'keyword', text: match[0] });
    index = at + match[0].length;
  }
  if (index < text.length) {
    out.push({ kind: 'text', text: text.slice(index) });
  }
  return out;
}

/**
 * Parses one campaign string into what a screen should draw.
 *
 * A `{card:CODE}` becomes a card segment. A bare `{drawId}` becomes the cards
 * that draw actually came up with — several, comma separated, when it dealt
 * several — and disappears entirely when nothing was dealt, rather than
 * printing braces at a player.
 */
export function parseCampaignText(
  text: string | null | undefined,
  context: TextContext,
): readonly TextSegment[] {
  if (text === null || text === undefined || text === '') {
    return [];
  }

  const out: TextSegment[] = [];
  const pushText = (raw: string): void => {
    for (const segment of keywordSegments(tidy(raw))) {
      out.push(segment);
    }
  };

  let index = 0;
  TOKEN_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const at = match.index;
    if (at > index) {
      pushText(text.slice(index, at));
    }
    index = at + match[0].length;

    const isCard = match[1] !== undefined;
    const id = match[2] ?? '';
    const codes = isCard ? [id] : context.drawnFor(id);
    codes.forEach((code, position) => {
      if (position > 0) {
        out.push({ kind: 'text', text: ', ' });
      }
      out.push({ kind: 'card', code, name: context.cardName(code) });
    });
  }
  if (index < text.length) {
    pushText(text.slice(index));
  }

  return finish(out);
}

/**
 * Closes the gaps a dropped placeholder leaves.
 *
 * A `{drawId}` that came up with nothing leaves the text either side of it
 * adjacent, and the two spaces that used to sit around the placeholder now sit
 * together. Merging the neighbours is what lets them be collapsed at all: each
 * piece on its own carries only one of the two spaces.
 */
function finish(segments: readonly TextSegment[]): readonly TextSegment[] {
  const merged: TextSegment[] = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (segment.kind === 'text' && previous?.kind === 'text') {
      merged[merged.length - 1] = { kind: 'text', text: tidy(previous.text + segment.text) };
      continue;
    }
    merged.push(segment);
  }

  const out = merged;
  const first = out[0];
  if (first !== undefined && first.kind === 'text') {
    out[0] = { kind: 'text', text: first.text.replace(/^\s+/, '') };
  }
  const last = out.at(-1);
  if (last !== undefined && last.kind === 'text') {
    out[out.length - 1] = { kind: 'text', text: last.text.replace(/\s+$/, '') };
  }
  return out.filter((segment) => segment.kind !== 'text' || segment.text !== '');
}

/**
 * The same thing as a plain string, for somewhere that cannot hold a chip.
 *
 * Card names are quoted, as the app quotes them: a setup step is read while
 * hunting through a pile of cards, and a title running into the prose around
 * it is genuinely hard to pick out — worse for the ones that are ordinary
 * words, like an attachment called Passe-Partout.
 */
export function campaignPlainText(
  text: string | null | undefined,
  context: TextContext,
): string {
  return parseCampaignText(text, context)
    .map((segment) => (segment.kind === 'card' ? `"${segment.name}"` : segment.text))
    .join('');
}
