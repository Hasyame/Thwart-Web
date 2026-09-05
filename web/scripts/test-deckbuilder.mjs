/**
 * Whether a deck is legal.
 *
 * A validator wrong in the permissive direction is useless; one wrong in the
 * strict direction rejects decks people have actually built. Both failures are
 * quiet, so the rules are asserted against the real card pool rather than a
 * fixture — the pool is where the awkward cases live, and every one below is a
 * real card.
 *
 *   npm run test:deckbuilder
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  deckAsText,
  deckStatistics,
  heroRules,
  validateDeck,
} from '../src/lib/deckRules.ts';

/*
 * The deck size, which is the one rule not in the card data anywhere. Named
 * here rather than imported because the module keeps it per-hero on the rules
 * object; these are the values every hero without an override gets.
 */
const MINIMUM_DECK_SIZE = 40;
const MAXIMUM_DECK_SIZE = 50;

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

const DATA = join(import.meta.dirname, '..', 'public', 'data', 'cards', 'en');
if (!existsSync(DATA)) {
  console.error('No card data. Run `npm run data` first.');
  process.exit(1);
}

/** Every card in the pool, by code. */
const pool = new Map();
for (const file of readdirSync(DATA).filter((name) => name.endsWith('.json'))) {
  const parsed = JSON.parse(readFileSync(join(DATA, file), 'utf8'));
  for (const card of Array.isArray(parsed) ? parsed : (parsed.cards ?? [])) {
    pool.set(card.code, card);
  }
}
const infos = pool;
const byName = (name) => [...pool.values()].filter((card) => card.name === name);

/** Every card printed in one hero's pack, which is where its own cards live. */
const packOf = (card) => [...pool.values()].filter((other) => other.pack_code === card.pack_code);

/** The module takes a Map of slots; the fixtures below build plain objects. */
const asMap = (slots) => new Map(Object.entries(slots));

/**
 * A legal pile of ordinary basic cards, to pad a deck out to a given size.
 *
 * One printing per title. The first version of this took cards by code, and the
 * validator promptly caught it: several basic titles are printed under more
 * than one code, so the padding itself held six copies of one card. That is the
 * rule working, and it is why the helper has to know about it too.
 */
function padding(count, exclude = new Set()) {
  const slots = {};
  const titlesUsed = new Set();
  let total = 0;
  for (const card of pool.values()) {
    if (total >= count) {
      break;
    }
    if (
      card.faction_code !== 'basic' ||
      card.is_unique === true ||
      exclude.has(card.code) ||
      titlesUsed.has(card.name) ||
      !['ally', 'event', 'upgrade', 'support', 'resource'].includes(card.type_code)
    ) {
      continue;
    }
    const take = Math.min(card.deck_limit ?? 3, count - total);
    slots[card.code] = take;
    titlesUsed.add(card.name);
    total += take;
  }
  return slots;
}

const spiderMan = pool.get('01001a');
const rules = heroRules(spiderMan, packOf(spiderMan));

// --- the size rule, which is the one not in the data ------------------------------

{
  const small = validateDeck(rules, ['justice'], asMap(padding(10)), infos);
  check(
    'a deck under forty is too few',
    small.problems.some((p) => p.kind === 'tooFewCards'),
    `${small.totalCards} cards`,
  );

  const right = validateDeck(rules, ['justice'], asMap(padding(MINIMUM_DECK_SIZE)), infos);
  check(
    'and exactly forty is not',
    !right.problems.some((p) => p.kind === 'tooFewCards'),
    `${right.totalCards} cards`,
  );

  const big = validateDeck(rules, ['justice'], asMap(padding(MAXIMUM_DECK_SIZE + 3)), infos);
  check('over fifty is too many', big.problems.some((p) => p.kind === 'tooManyCards'));
}

// --- aspects ------------------------------------------------------------------------

{
  const none = validateDeck(rules, [], asMap(padding(40)), infos);
  check(
    'a hero who picks one aspect must pick one',
    none.problems.some((p) => p.kind === 'wrongAspectCount'),
  );

  const two = validateDeck(rules, ['justice', 'aggression'], asMap(padding(40)), infos);
  check('and not two', two.problems.some((p) => p.kind === 'wrongAspectCount'));
}

{
  /*
   * Spider-Woman picks two aspects and must take the same number from each.
   * Her own set holds one event of each aspect, and those are hers in every
   * deck: counting them as aspect cards both makes two of them illegal and
   * throws the balance off.
   */
  const spiderWoman = pool.get('04031a');
  const swRules = heroRules(spiderWoman, packOf(spiderWoman));
  check('Spider-Woman takes two aspects', swRules.aspectCount === 2);
  check('and they must balance', swRules.aspectsMustBalance);

  const ownCards = [...pool.values()].filter(
    (card) => card.card_set_code === spiderWoman.card_set_code && card.type_code !== 'hero',
  );
  check('her set really does carry aspect cards', ownCards.some((c) => c.faction_code !== 'basic'));

  const slots = { ...padding(36) };
  for (const card of ownCards.slice(0, 4)) {
    slots[card.code] = 1;
  }
  const result = validateDeck(swRules, ['justice', 'protection'], asMap(slots), infos);
  check(
    'her own cards are never off-aspect, whatever faction they carry',
    !result.problems.some((p) => p.kind === 'offAspect'),
    result.problems.filter((p) => p.kind === 'offAspect').map((p) => p.cardName).join(',') || 'none',
  );
  check(
    'and they do not unbalance her aspects',
    !result.problems.some((p) => p.kind === 'unbalancedAspects'),
  );
}

// --- off-aspect ---------------------------------------------------------------------

{
  const aggressionCard = [...pool.values()].find(
    (card) => card.faction_code === 'aggression' && card.type_code === 'event' && !card.is_unique,
  );
  const slots = { ...padding(38), [aggressionCard.code]: 2 };
  const result = validateDeck(rules, ['justice'], asMap(slots), infos);
  check(
    'a card from an aspect the deck did not choose is off-aspect',
    result.problems.some((p) => p.kind === 'offAspect' && p.cardName === aggressionCard.name),
    aggressionCard.name,
  );

  // Somebody else's hero card is never legal, whichever aspects were chosen.
  const otherHeroCard = [...pool.values()].find(
    (card) => card.faction_code === 'hero' && card.card_set_code !== spiderMan.card_set_code,
  );
  const withStranger = validateDeck(rules, ['justice'], asMap({ ...padding(38), [otherHeroCard.code]: 1 }), infos);
  check(
    "another hero's own card is never legal",
    withStranger.problems.some((p) => p.kind === 'offAspect' && p.cardName === otherHeroCard.name),
    otherHeroCard.name,
  );
}

// --- the allowances that widen what is legal -------------------------------------------

{
  /*
   * Five heroes carry deck_options, which *permit* off-aspect cards. Without
   * them the builder rejects decks these heroes are printed to build.
   */
  const cyclops = pool.get('33001a');
  const cyclopsRules = heroRules(cyclops, packOf(cyclops));
  check('Cyclops carries an allowance', cyclopsRules.options.length > 0);
  check(
    'and it is for X-Men allies',
    cyclopsRules.options.some(
      (o) => o.types.includes('ally') && o.traits.some((t) => t.toLowerCase() === 'x-men'),
    ),
  );

  const xmenAlly = [...pool.values()].find(
    (card) =>
      card.type_code === 'ally' &&
      (card.traits ?? '').toLowerCase().includes('x-men') &&
      !['basic', 'hero'].includes(card.faction_code) &&
      card.faction_code !== 'justice',
  );
  if (xmenAlly === undefined) {
    check('an off-aspect X-Men ally exists to test with', false);
  } else {
    const allowed = validateDeck(cyclopsRules, ['justice'], asMap({ ...padding(39), [xmenAlly.code]: 1 }), infos);
    check(
      'an off-aspect X-Men ally is admitted for Cyclops',
      !allowed.problems.some((p) => p.kind === 'offAspect' && p.cardName === xmenAlly.name),
      `${xmenAlly.name} (${xmenAlly.faction_code})`,
    );
    const refused = validateDeck(rules, ['justice'], asMap({ ...padding(39), [xmenAlly.code]: 1 }), infos);
    check(
      'and refused for a hero without the allowance',
      refused.problems.some((p) => p.kind === 'offAspect' && p.cardName === xmenAlly.name),
    );
  }
}

// --- Adam Warlock, whose limit is about copies and not aspects ---------------------------

{
  const adam = pool.get('21031a');
  const adamRules = heroRules(adam, packOf(adam));
  check('Adam Warlock takes four aspects', adamRules.aspectCount === 4);
  check(
    'and his limit is one copy of anything that is not his',
    adamRules.copyLimitOverride === 1,
    'read as cards-per-aspect it would make every legal deck of his illegal',
  );

  const ordinary = [...pool.values()].find(
    (card) => card.faction_code === 'basic' && !card.is_unique && (card.deck_limit ?? 3) >= 2,
  );
  const result = validateDeck(adamRules, ['justice', 'aggression', 'protection', 'leadership'], asMap({ ...padding(38, new Set([ordinary.code])), [ordinary.code]: 2 }), infos);
  check(
    'so two copies of an ordinary card break his limit',
    result.problems.some((p) => p.kind === 'overCopyLimit' && p.limit === 1),
    ordinary.name,
  );
}

// --- copies, counted by title rather than by printing --------------------------------------

{
  /*
   * Many titles exist under more than one code. Counting by code lets three of
   * one printing and three of another through as six copies of one card.
   */
  const reprinted = [...pool.values()]
    .filter((card) => !card.is_unique && (card.deck_limit ?? 3) === 3 && card.faction_code === 'basic')
    .reduce((found, card) => {
      if (found !== null) {
        return found;
      }
      const twins = byName(card.name).filter((other) => other.code !== card.code && !other.is_unique);
      return twins.length > 0 ? [card, twins[0]] : null;
    }, null);

  if (reprinted === null) {
    check('a title with two printings exists to test with', false, 'none found in the pool');
  } else {
    const [first, second] = reprinted;
    const result = validateDeck(rules, ['justice'], asMap({ ...padding(34, new Set([first.code, second.code])), [first.code]: 3, [second.code]: 3 }), infos);
    check(
      'three of one printing and three of another is six copies of one card',
      result.problems.some((p) => p.kind === 'overCopyLimit' && p.total === 6),
      `${first.name}: ${first.code} and ${second.code}`,
    );
  }
}

// --- unique cards, and the identity that competes with them ----------------------------------

{
  const unique = [...pool.values()].find(
    (card) => card.is_unique === true && card.faction_code === 'basic' && card.type_code === 'ally',
  );
  const result = validateDeck(rules, ['justice'], asMap({ ...padding(38, new Set([unique.code])), [unique.code]: 2 }), infos);
  check(
    'two copies of a unique card is one too many',
    result.problems.some((p) => p.kind === 'duplicateUnique' && p.title === unique.name),
    unique.name,
  );
}

{
  /*
   * The identity counts as a copy of itself. A Spider-Man ally with no subtitle
   * is the same Spider-Man the deck is built around; one subtitled for another
   * person is somebody else and may share the deck.
   */
  const spiderAllies = [...pool.values()].filter(
    (card) => card.name === 'Spider-Man' && card.type_code === 'ally' && card.is_unique,
  );
  const sameMan = spiderAllies.find((card) => (card.subname ?? '') === 'Peter Parker');
  const otherMan = spiderAllies.find(
    (card) => (card.subname ?? '') !== '' && card.subname !== 'Peter Parker',
  );

  if (sameMan !== undefined) {
    const clash = validateDeck(rules, ['justice'], asMap({ ...padding(39), [sameMan.code]: 1 }), infos);
    check(
      'Peter Parker cannot take the Spider-Man who is also Peter Parker',
      clash.problems.some((p) => p.kind === 'duplicateUnique'),
      sameMan.code,
    );
  } else {
    check('a same-person ally exists to test with', true, 'none in the pool; rule untested here');
  }

  if (otherMan !== undefined) {
    const fine = validateDeck(rules, ['justice'], asMap({ ...padding(39), [otherMan.code]: 1 }), infos);
    check(
      'but he can take a Spider-Man who is somebody else',
      !fine.problems.some((p) => p.kind === 'duplicateUnique'),
      `${otherMan.name} (${otherMan.subname})`,
    );
  }
}

// --- a deck that is simply legal ----------------------------------------------------------

{
  /*
   * A hero's own signature cards are not optional. The rules derive them from
   * the identity's pack, so a legal deck has to hold every one of them in the
   * printed number — the first version of this test padded with basics alone
   * and was told so eight times over, which is the rule working.
   */
  const own = {};
  let ownTotal = 0;
  for (const card of packOf(spiderMan)) {
    if (card.card_set_code === spiderMan.card_set_code && card.type_code !== 'hero' && card.type_code !== 'alter_ego') {
      own[card.code] = card.quantity ?? 1;
      ownTotal += card.quantity ?? 1;
    }
  }
  const legal = validateDeck(
    rules,
    ['justice'],
    asMap({ ...own, ...padding(Math.max(0, 40 - ownTotal), new Set(Object.keys(own))) }),
    infos,
  );
  check(
    'a forty-card deck holding the hero’s own cards passes with nothing to say',
    legal.legal,
    legal.problems.map((p) => p.kind).join(',') || 'no problems',
  );
}

// --- what a deck is made of ---------------------------------------------------------

{
  /*
   * Everything counts copies, not distinct cards. Three copies of a one-cost
   * ally are three one-cost cards, and the question being asked — how often
   * will I draw something cheap — is about copies.
   */
  const oneCost = [...pool.values()].find(
    (c) => c.cost === 1 && c.type_code === 'ally' && !c.cost_star && !c.cost_per_hero,
  );
  const threeCost = [...pool.values()].find(
    (c) => c.cost === 3 && c.type_code === 'event' && !c.cost_star && !c.cost_per_hero,
  );
  const starred = [...pool.values()].find((c) => c.cost_star === true || c.cost_per_hero === true);

  const slots = new Map([
    [oneCost.code, 3],
    [threeCost.code, 1],
    ...(starred ? [[starred.code, 2]] : []),
  ]);
  const stats = deckStatistics(slots, pool);

  check('the curve counts copies rather than rows', stats.costCurve.get(1) === 3);
  check(
    'and every cost in it is one the deck really holds',
    [...stats.costCurve.keys()].sort((a, b) => a - b).join(',') === '1,3',
    [...stats.costCurve.keys()].join(','),
  );
  check('the average is over copies too', Math.abs(stats.averageCost - 1.5) < 0.001, `${stats.averageCost}`);
  check('the tallest column is what a chart scales to', Math.max(...stats.costCurve.values()) === 3);
  if (starred !== undefined) {
    check(
      'a card printed with a variable cost is left out rather than guessed at',
      stats.costedCards === 4,
      `${starred.name} contributes nothing to the curve`,
    );
  }
  check(
    'resources are totalled across copies',
    stats.resources.total ===
      (oneCost.resource_physical ?? 0) * 3 +
        (oneCost.resource_mental ?? 0) * 3 +
        (oneCost.resource_energy ?? 0) * 3 +
        (oneCost.resource_wild ?? 0) * 3 +
        (threeCost.resource_physical ?? 0) +
        (threeCost.resource_mental ?? 0) +
        (threeCost.resource_energy ?? 0) +
        (threeCost.resource_wild ?? 0) +
        (starred
          ? ((starred.resource_physical ?? 0) +
              (starred.resource_mental ?? 0) +
              (starred.resource_energy ?? 0) +
              (starred.resource_wild ?? 0)) * 2
          : 0),
  );
  check('an empty deck counts to nothing rather than dividing by zero', deckStatistics(new Map(), pool).averageCost === 0);
}

// --- sharing it ------------------------------------------------------------------------

{
  const text = deckAsText(
    'My Deck',
    'Spider-Man',
    ['Justice'],
    new Map([
      ['Ally', [{ quantity: 2, name: 'Spider-Woman' }, { quantity: 1, name: 'Ant-Man' }]],
      ['Event', [{ quantity: 3, name: 'Swinging Web Kick' }]],
    ]),
  );
  // Split without an escape sequence: this file is edited through tools that
  // eat backslashes, and a newline is worth naming plainly.
  const NEWLINE = String.fromCharCode(10);
  const lines = text.split(NEWLINE);

  check('the deck is named first', lines[0] === 'My Deck');
  check('then the hero and aspects', lines[1] === 'Spider-Man (Justice)');
  check('types come in a stable order', text.indexOf('Ally (3)') < text.indexOf('Event (3)'));
  check('and cards within a type are sorted', text.indexOf('Ant-Man') < text.indexOf('Spider-Woman'));
  check('the total counts copies', lines[lines.length - 1] === 'Total: 6 cards');
  check(
    'sharing the same deck twice reads the same both times',
    text ===
      deckAsText(
        'My Deck',
        'Spider-Man',
        ['Justice'],
        new Map([
          ['Event', [{ quantity: 3, name: 'Swinging Web Kick' }]],
          ['Ally', [{ quantity: 1, name: 'Ant-Man' }, { quantity: 2, name: 'Spider-Woman' }]],
        ]),
      ),
    'the map arrived in a different order and the text is identical',
  );

  const withUrl = deckAsText('D', 'H', [], new Map(), 'https://marvelcdb.com/decklist/view/1');
  check('a MarvelCDB link is appended when there is one', withUrl.endsWith('/decklist/view/1'));
}

process.exit(failures === 0 ? 0 : 1);
