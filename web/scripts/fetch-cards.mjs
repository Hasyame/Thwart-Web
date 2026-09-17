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
import {
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
  copyFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { synergyOf, traitKeys, unrecognised } from './lib/synergy.mjs';
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

/**
 * Curated pack type and wave, copied from the Android app's
 * `assets/pack_metadata.json`.
 *
 * MarvelCDB's `/api/public/packs/` exposes neither, so this cannot be derived
 * from the API — it is hand-maintained, and the collection screen groups by
 * wave exactly as the app's does.
 *
 * This is the first real instance of the shared-data problem doc 04 predicted:
 * one curated file, now with two consumers, kept in step by hand. When
 * Thwart-Data is extracted this is the first thing that should move into it.
 */
const PACK_METADATA = JSON.parse(
  readFileSync(join(HERE, '..', 'data', 'pack-metadata.json'), 'utf8'),
);

/**
 * The wave given to a pack the curated file does not mention.
 *
 * Matches `CardDataRepository.UNCURATED_WAVE` in the app, so both clients place
 * an unknown pack the same way rather than each inventing an answer. It happens:
 * MarvelCDB adds a pack before the metadata catches up.
 */
const UNCURATED_WAVE = 0;

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

/**
 * The fields a deck's rules read, on the rows that have them. `res` is the
 * resources as letters -- "PP" for two physical, "W" for a wild -- since the
 * rules only ask whether a card gives a kind, not how many.
 */
function deckFields(card) {
  const out = {};
  if (card.quantity != null && card.quantity !== 1) {
    out.quantity = card.quantity;
  }
  if (card.deck_limit != null && card.deck_limit !== 3) {
    out.deckLimit = card.deck_limit;
  }
  if (card.duplicate_of_code) {
    out.duplicateOf = card.duplicate_of_code;
  }
  if (card.hidden === true) {
    out.hidden = true;
  }
  const res =
    'P'.repeat(card.resource_physical ?? 0) +
    'M'.repeat(card.resource_mental ?? 0) +
    'E'.repeat(card.resource_energy ?? 0) +
    'W'.repeat(card.resource_wild ?? 0);
  if (res !== '') {
    out.res = res;
  }
  if (card.deck_requirements || card.deck_options) {
    out.deckRules = { requirements: card.deck_requirements ?? null, options: card.deck_options ?? null };
  }
  return out;
}

/** The row the results list needs, and nothing more. */
function toIndexRow(card) {
  return {
    code: card.code,
    name: card.name,
    subname: card.subname ?? null,
    packCode: card.pack_code,
    // The hero's own set, which is what identifies a hero rather than a card:
    // several cards can be the same hero, and the randomiser must not put one
    // hero into the bag twice.
    setCode: card.card_set_code ?? null,
    typeCode: card.type_code,
    typeName: card.type_name,
    factionCode: card.faction_code,
    factionName: card.faction_name,
    cost: card.cost ?? null,
    isUnique: Boolean(card.is_unique),
    // Split out as their own field as well as folded into `s`.
    //
    // Searchable text finds a trait, but it cannot tell one apart from a card
    // whose *name* contains the same word, and it cannot offer the reader a
    // list of the traits that exist. MarvelCDB writes them as one string,
    // "Avenger. Spy.", so this is the one place that shape is understood.
    traits: String(card.traits ?? '')
      .split(/\.\s+|\.$/)
      .map((trait) => trait.trim())
      .filter((trait) => trait !== ''),
    // The same traits as language-independent keys, read off the English
    // traits both languages carry, so an identity's faces can be matched
    // against a card's condition without loading the full card.
    traitKeys: traitKeys(card.real_traits ?? card.traits),
    // "Play only if your identity has the [[X]] trait", read once here. See
    // scripts/lib/synergy.mjs; null on every card without such a condition.
    synergy: synergyOf(card),
    // What a deck's rules need of a card, so the draft can run off the index
    // alone and offline: copies printed in the pack, the copy limit, the
    // original printing a reprint repeats, the resources it gives, and for
    // the seven identities that carry one, the deck-building rule itself.
    // Kept short: this file is read on every start.
    ...deckFields(card),
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

  const cards = rawCards.map((card) => ({ ...sanitizeCard(card), synergy: synergyOf(card) }));
  const index = rawCards.map(toIndexRow);

  // Every "Play only if" the derivation did not read, so a new wording is
  // noticed the day it appears rather than silently never warning anybody.
  if (locale.code === LOCALES[0].code) {
    const missed = unrecognised(rawCards);
    console.log(`  synergy: ${index.filter((row) => row.synergy !== null).length} cards carry a trait condition; ${missed.length} "Play only if" not read:`);
    for (const miss of missed) {
      console.log(`    ${miss.code} ${miss.name}: ${miss.condition}`);
    }
  }
  const metaByCode = new Map(PACK_METADATA.packs.map((entry) => [entry.code, entry]));
  const packs = rawPacks.map((pack) => {
    const meta = metaByCode.get(pack.code);
    return {
      code: pack.code,
      name: pack.name,
      position: pack.position,
      cyclePosition: pack.cycle_position ?? null,
      available: pack.available ?? null,
      known: pack.known ?? null,
      total: pack.total ?? null,
      wave: meta?.wave ?? UNCURATED_WAVE,
      type: meta?.type ?? null,
      // True when the wave was derived from release-date adjacency rather than
      // read off the cards, and true by default for a pack we know nothing
      // about — which is the honest answer in both cases.
      waveInferred: meta?.waveInferred ?? true,
    };
  });

  const uncurated = packs.filter((pack) => pack.wave === UNCURATED_WAVE);
  if (uncurated.length > 0 && locale.code === LOCALES[0].code) {
    console.log(
      `  note: ${uncurated.length} packs are not in pack-metadata.json and have no wave: ` +
        uncurated.map((pack) => pack.code).join(', '),
    );
  }

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

  // Card sets — modular sets, villains, heroes, nemeses and the rest.
  //
  // Derived here rather than in the browser: the collection screen needs to
  // list the modular sets and scenarios in a pack, and working that out at
  // runtime would mean downloading all 63 pack files to draw one page.
  const sets = new Map();
  for (const card of cards) {
    const code = card.card_set_code;
    if (code === null || code === undefined || sets.has(code)) {
      continue;
    }
    sets.set(code, {
      code,
      name: card.card_set_name ?? code,
      type: card.card_set_type_name_code ?? null,
      packCode: card.pack_code,
    });
  }

  writeFileSync(join(OUT_DIR, `index.${locale.code}.json`), JSON.stringify(index), 'utf8');
  writeFileSync(join(OUT_DIR, `packs.${locale.code}.json`), JSON.stringify(packs), 'utf8');
  writeFileSync(
    join(OUT_DIR, `sets.${locale.code}.json`),
    JSON.stringify([...sets.values()]),
    'utf8',
  );

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

/** A digest of this script and its helpers, for meta.json. */
function scriptDigest() {
  const here = dirname(fileURLToPath(import.meta.url));
  const hash = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url)));
  const lib = join(here, 'lib');
  for (const name of readdirSync(lib).sort()) {
    hash.update(readFileSync(join(lib, name)));
  }
  return hash.digest('hex');
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  // Scenario rules travel with the card data because they are keyed to it:
  // modular counts and mandatory sets, per scenario, with no names in them —
  // those come from the card database at runtime, already localised. Copied
  // from the app's assets; the second file, after pack metadata, that wants
  // Thwart-Data to exist.
  copyFileSync(
    join(HERE, '..', 'data', 'scenario-rules.json'),
    join(OUT_DIR, 'scenario-rules.json'),
  );

  // The Rules Reference glossary. Unlike the card data this one *is* committed:
  // it comes from deejimy's mc-reference under CC0-1.0, carries its French
  // beside the English it was translated from, and is nobody's copyrighted card
  // text. Copied here so it is served from the same place as everything else.
  copyFileSync(
    join(HERE, '..', 'data', 'rules-reference.json'),
    join(OUT_DIR, 'rules-reference.json'),
  );

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
    // What wrote this. The host keeps data under a day old rather than
    // refetching for every release; a release that changes what the fetch
    // derives (a new index field) must not be served old data, so the
    // deploy compares this against the scripts it is about to run.
    scriptDigest: scriptDigest(),
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
