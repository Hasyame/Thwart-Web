import type { IndexRow, Locale } from './types';

/**
 * Where a card's picture comes from, and what to try when it does not load.
 *
 * English pictures are MarvelCDB's, as they have always been. MarvelCDB has
 * no French scans (fr.marvelcdb.com serves the same English files) and no
 * picture at all for several hundred cards, so two community sites fill in:
 *
 *  - MC4DB (mc4db.merlindumesnil.net), a MarvelCDB fork: English and French
 *    pictures under `/bundles/cards/<EN|FR>/<box>/<code>.webp`. <box> is the
 *    box the picture was first printed in, per card, so it comes from MC4DB's
 *    own list, read at build time into `data/card-images.json`. The build
 *    also gives MC4DB's English picture to every card MarvelCDB has none for.
 *  - cgbuilder (mc-src.cgbuilder.fr): French only, `/images/carte/<n>/<m>.jpg`
 *    from the code alone (`01001a` is `1/1A`; lower case redirects).
 *
 * French: MC4DB French, then cgbuilder, then the English picture.
 * English: the card's picture (MarvelCDB, or MC4DB where MarvelCDB has
 * none), then MC4DB's English one if MarvelCDB fails.
 *
 * Measured on 2026-09-24: of 150 random cards, 149 had a French picture.
 * Referenced, never copied: nothing here stores or re-hosts a picture. The
 * hosts are allowed in the site's CSP img-src (deploy/nginx-thwart-security.conf).
 *
 * The chain is walked by one listener for the whole page (see
 * `installCardImageFallback`): any `<img>` whose address fails is moved to the
 * next one, so no component has to know about it.
 */

const MARVELCDB = 'https://marvelcdb.com';
const MC4DB = 'https://mc4db.merlindumesnil.net/bundles/cards';
const CGBUILDER = 'https://mc-src.cgbuilder.fr/images/carte';

let imageLocale: Locale = 'en';
/** Card code to MC4DB's `<box>/<code>`, once `card-images.json` has arrived. */
let mc4dbPath: ReadonlyMap<string, string> = new Map();
/** Card code to pack code: MC4DB's box for most cards, until the map arrives. */
let packOf: ReadonlyMap<string, string> = new Map();
let requested = false;
/** A failed address to the one to try next. */
const nextAfter = new Map<string, string>();

/** Called when the index or the card language changes. */
export function configureCardImages(index: readonly IndexRow[], locale: Locale): void {
  imageLocale = locale;
  packOf = new Map(index.map((row) => [row.code, row.packCode] as const));
  if (!requested) {
    requested = true;
    void fetch('/data/card-images.json')
      .then((response) => (response.ok ? (response.json() as Promise<Record<string, string>>) : {}))
      .then((paths) => {
        mc4dbPath = new Map(Object.entries(paths));
      })
      .catch(() => {
        // Offline or not built yet: the pack guess and cgbuilder still work.
        requested = false;
      });
  }
}

/** Only for tests: set the MC4DB paths without fetching them. */
export function setMc4dbPaths(paths: Readonly<Record<string, string>>): void {
  mc4dbPath = new Map(Object.entries(paths));
  requested = true;
}

/** `/bundles/cards/01001a.png`, or MC4DB's `…/EN/core/01001a.webp`, to `01001a`. */
export function codeOfImage(imageSrc: string): string | null {
  const match = /\/bundles\/cards\/(?:[^/]+\/)*([0-9]{4,6}[a-z]?)\.(?:png|jpe?g|webp)$/i.exec(imageSrc);
  return match?.[1]?.toLowerCase() ?? null;
}

/** cgbuilder's address: two digits of pack, the rest the card, zeros dropped. */
export function cgbuilderUrl(code: string): string | null {
  const match = /^(\d{2})(\d+)([a-z]?)$/.exec(code);
  if (match === null) {
    return null;
  }
  const pack = match[1]?.replace(/^0+/, '') || '0';
  const card = (match[2]?.replace(/^0+/, '') || '0') + (match[3] ?? '').toUpperCase();
  return `${CGBUILDER}/${pack}/${card}.jpg`;
}

/** MC4DB's `<box>/<code>` for a card: its own list, else the pack as a guess. */
function mc4dbFor(code: string): string | null {
  const known = mc4dbPath.get(code) ?? mc4dbPath.get(code.replace(/[a-z]$/, ''));
  if (known !== undefined) {
    return known;
  }
  const pack = packOf.get(code) ?? packOf.get(code.replace(/[a-z]$/, ''));
  return pack === undefined ? null : `${pack}/${code}`;
}

/** The addresses to try for a card, best first. */
export function cardImageCandidates(imageSrc: string, locale: Locale): string[] {
  const own = imageSrc.startsWith('http') ? imageSrc : `${MARVELCDB}/${imageSrc.replace(/^\/+/, '')}`;
  const code = codeOfImage(imageSrc);
  if (code === null) {
    return [own];
  }
  const path = mc4dbFor(code);
  const out: string[] = [];
  if (locale === 'fr') {
    if (path !== null) {
      out.push(`${MC4DB}/FR/${path}.webp`);
    }
    const cgb = cgbuilderUrl(code);
    if (cgb !== null) {
      out.push(cgb);
    }
  }
  out.push(own);
  const english = path === null ? null : `${MC4DB}/EN/${path}.webp`;
  if (english !== null && english !== own) {
    out.push(english);
  }
  return out;
}

/** The first address for a card's picture, in the configured language. */
export function localisedCardImage(imageSrc: string): string {
  const candidates = cardImageCandidates(imageSrc, imageLocale);
  for (let i = 0; i + 1 < candidates.length; i++) {
    nextAfter.set(candidates[i] as string, candidates[i + 1] as string);
  }
  return candidates[0] as string;
}

/** What to try once `url` has failed, or null at the end of the chain. */
export function nextCardImage(url: string): string | null {
  return nextAfter.get(url) ?? null;
}

/**
 * One listener for every card picture on the page.
 *
 * `error` does not bubble, but it is seen in the capture phase, so this
 * catches an `<img>` anywhere without each component wiring its own handler.
 */
export function installCardImageFallback(): void {
  document.addEventListener(
    'error',
    (event) => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement)) {
        return;
      }
      const next = nextCardImage(img.getAttribute('src') ?? '');
      if (next !== null) {
        img.src = next;
      }
    },
    true,
  );
}
