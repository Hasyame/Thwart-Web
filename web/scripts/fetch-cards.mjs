/**
 * Builds the card data the web app serves, from MarvelCDB.
 *
 * Nothing this writes is ever committed. Card text and card images belong to
 * Fantasy Flight Games and to Marvel; the Android repository already refuses to
 * commit its own copy for exactly this reason, and `.gitignore` here keeps
 * `web/public/data/` out for the same one. The site references MarvelCDB's
 * images at their canonical URLs rather than re-hosting them.
 *
 * Localisation is by host — `fr.marvelcdb.com` serves French card text, and the
 * `_locale` query parameter and `Accept-Language` header are both ignored. That
 * is the app's finding, recorded in MarvelCdbUrls.kt, not a guess.
 *
 * What comes out, per locale:
 *
 *   index.<locale>.json         one trimmed row per card, loaded up front
 *   packs.<locale>.json         pack names and positions
 *   cards/<locale>/<pack>.json  full records, one file per pack
 *
 * plus a single meta.json.
 *
 * The shape is dictated by the sizes. All 4456 cards in one file is about
 * 7.4 MB per language, which is not something to hand a phone before it can
 * show a search box — and not something to hand it on the first card view
 * either. Per pack is the natural seam: around 120 KB, it is the unit the data
 * actually arrives in, and opening a card only ever needs the pack it is from.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { normalizeForSearch } from '../src/lib/normalize.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'public', 'data');

const LOCALES = [
  { code: 'en', host: 'marvelcdb.com' },
  { code: 'fr', host: 'fr.marvelcdb.com' },
];

/**
 * A floor, not an estimate.
 *
 * The point of this is to refuse to publish a broken dataset. MarvelCDB being
 * briefly unwell and returning a short list is the failure this catches: a
 * nightly job that quietly replaces the card database with forty cards is worse
 * than a nightly job that does not run.
 */
const MINIMUM_CARDS = 1500;

/** Tags MarvelCDB genuinely uses in card text. Everything else is stripped. */
const ALLOWED_TAGS = new Set(['b', 'i', 'em', 'strong', 'br', 'p', 'u']);

const USER_AGENT =
  'Thwart-Web/0.1 (+https://github.com/Hasyame/Thwart-Web) card data build';

/**
 * Strips markup down to the handful of tags that carry meaning.
 *
 * Done here, at build time, rather than in the browser: the card text is
 * third-party HTML and the detail view renders it as markup, so sanitising it
 * once on the way in is a great deal safer than trusting every future
 * component to remember.
 */
function sanitizeHtml(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return value ?? null;
  }
  return value.replace(/<(\/?)([a-zA-Z0-9]+)(?:\s[^>]*?)?\/?>/g, (_match, slash, tag) => {
    const name = String(tag).toLowerCase();
    return ALLOWED_TAGS.has(name) ? `<${slash}${name}>` : '';
  });
}

const HTML_FIELDS = ['text', 'flavor', 'back_text', 'back_flavor', 'errata'];

/**
 * MarvelCDB writes game icons into card text as `[star]`, `[energy]` and so on.
 *
 * These are the ones with a symbol worth showing. The Android app has the real
 * thing — Fantasy Flight's icon font, shipped as a TTF with a glyph map — and
 * matching it properly here means carrying that font, which is a job for the
 * shared data package rather than for this first pass.
 *
 * Everything not listed falls through to its own word, because most of the long
 * tail is not an icon at all: `[guardian]`, `[symbiote]`, `[asgard]` and their
 * like are traits that happened to be typed in brackets. Rendering those as the
 * word is correct; rendering them as a missing-glyph box would not be.
 */
const ICON_SYMBOLS = {
  star: '★',
  unique: '◆',
  energy: '⚡',
  mental: '🧠',
  physical: '✊',
  wild: '✶',
  crisis: '⚠',
  hazard: '☠',
  attack: '⚔',
  boost: '↗',
};

/**
 * Turns the bracket tokens into markup.
 *
 * Runs *after* sanitising, deliberately: the sanitiser strips every attribute
 * from every tag, so anything with a `data-icon` on it can only have been put
 * there here, by us, and never by MarvelCDB.
 */
function renderIcons(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return value ?? null;
  }
  return value.replace(/\[([a-z_]+)\]/g, (_match, token) => {
    const symbol = Object.prototype.hasOwnProperty.call(ICON_SYMBOLS, token)
      ? ICON_SYMBOLS[token]
      : null;
    if (symbol === null) {
      return String(token).replace(/_/g, ' ');
    }
    return `<span data-icon="${token}">${symbol}</span>`;
  });
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`${url} responded ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/** The row the results list needs, and nothing more. */
function toIndexRow(card) {
  return {
    code: card.code,
    name: card.name,
    subname: card.subname ?? null,
    packCode: card.pack_code,
    typeCode: card.type_code,
    typeName: card.type_name,
    factionCode: card.faction_code,
    factionName: card.faction_name,
    cost: card.cost ?? null,
    isUnique: Boolean(card.is_unique),
    // Folded exactly as SearchNormalizer folds it, so the browser compares
    // like with like and never has to normalise 4000 cards at startup.
    s: normalizeForSearch(
      [card.name, card.real_name !== card.name ? card.real_name : null, card.subname, card.traits]
        .filter(Boolean)
        .join(' '),
    ),
  };
}

function sanitizeCard(card) {
  const out = { ...card };
  for (const field of HTML_FIELDS) {
    if (field in out) {
      out[field] = renderIcons(sanitizeHtml(out[field]));
    }
  }
  return out;
}

async function buildLocale(locale) {
  const cardsUrl = `https://${locale.host}/api/public/cards/?encounter=1`;
  const packsUrl = `https://${locale.host}/api/public/packs/`;

  process.stdout.write(`  ${locale.code}: fetching cards… `);
  const rawCards = await getJson(cardsUrl);
  if (!Array.isArray(rawCards)) {
    throw new Error(`${cardsUrl} did not return an array`);
  }
  if (rawCards.length < MINIMUM_CARDS) {
    throw new Error(
      `${cardsUrl} returned only ${rawCards.length} cards, below the ${MINIMUM_CARDS} floor. ` +
        'Refusing to write a dataset this small; MarvelCDB is probably unwell.',
    );
  }
  process.stdout.write(`${rawCards.length} cards, packs… `);
  const rawPacks = await getJson(packsUrl);
  process.stdout.write(`${rawPacks.length} packs\n`);

  const cards = rawCards.map(sanitizeCard);
  const index = rawCards.map(toIndexRow);
  const packs = rawPacks.map((pack) => ({
    code: pack.code,
    name: pack.name,
    position: pack.position,
    cyclePosition: pack.cycle_position ?? null,
    available: pack.available ?? null,
    known: pack.known ?? null,
    total: pack.total ?? null,
  }));

  // One file per pack. A card whose pack_code is missing from the pack list
  // still has to land somewhere findable, so it is grouped under its own code
  // rather than dropped — MarvelCDB has carried cards ahead of their pack
  // before, and a card that cannot be opened is worse than an odd file name.
  const byPack = new Map();
  for (const card of cards) {
    const key = card.pack_code ?? 'unknown';
    const bucket = byPack.get(key);
    if (bucket === undefined) {
      byPack.set(key, [card]);
    } else {
      bucket.push(card);
    }
  }

  const cardsDir = join(OUT_DIR, 'cards', locale.code);
  mkdirSync(cardsDir, { recursive: true });
  for (const [packCode, packCards] of byPack) {
    writeFileSync(
      join(cardsDir, `${encodeURIComponent(packCode)}.json`),
      JSON.stringify(packCards),
      'utf8',
    );
  }

  writeFileSync(join(OUT_DIR, `index.${locale.code}.json`), JSON.stringify(index), 'utf8');
  writeFileSync(join(OUT_DIR, `packs.${locale.code}.json`), JSON.stringify(packs), 'utf8');

  return {
    locale: locale.code,
    cards: cards.length,
    packs: packs.length,
    packFiles: byPack.size,
    // Digest of the whole payload, not just codes and names.
    //
    // The CI job compares this to decide whether a rebuild is worth deploying,
    // so it has to cover everything a reader would notice — an errata rewriting
    // one card's text is exactly the change that must not be skipped. It must
    // also contain nothing that varies per run, which is why `fetchedAt` is
    // outside it.
    digest: createHash('sha256').update(JSON.stringify(cards)).digest('hex'),
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const metaPath = join(OUT_DIR, 'meta.json');
  const previous = existsSync(metaPath)
    ? JSON.parse(readFileSync(metaPath, 'utf8'))
    : null;

  console.log('Fetching card data from MarvelCDB');
  const locales = [];
  for (const locale of LOCALES) {
    locales.push(await buildLocale(locale));
  }

  const digest = createHash('sha256')
    .update(locales.map((l) => `${l.locale}:${l.digest}`).join('\n'))
    .digest('hex');

  const meta = {
    fetchedAt: new Date().toISOString(),
    source: 'https://marvelcdb.com',
    locales,
    digest,
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  const changed = !previous || previous.digest !== digest;
  console.log(
    changed
      ? `\nCard data changed. digest=${digest.slice(0, 12)}`
      : `\nCard data unchanged since the last run. digest=${digest.slice(0, 12)}`,
  );

  // Consumed by the scheduled workflow to skip a pointless deploy.
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      `changed=${changed}\ndigest=${digest}\n`,
      { flag: 'a' },
    );
  }
}

main().catch((error) => {
  console.error(`\nCard data build failed: ${error.message}`);
  process.exitCode = 1;
});
