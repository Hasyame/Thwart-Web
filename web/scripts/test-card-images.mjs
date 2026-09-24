/**
 * Card picture addresses, lib/cardImages.ts: which site, in which order.
 *
 * No network and no card data: the MC4DB paths are set by hand, as the build
 * would write them into data/card-images.json.
 */
import {
  cardImageCandidates,
  cgbuilderUrl,
  codeOfImage,
  localisedCardImage,
  nextCardImage,
  setMc4dbPaths,
} from '../src/lib/cardImages.ts';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  (${detail})`}`);
  if (!ok) failures += 1;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

check('code from a MarvelCDB path', codeOfImage('/bundles/cards/01001a.png') === '01001a');
check('code from an MC4DB address', codeOfImage('https://mc4db.merlindumesnil.net/bundles/cards/EN/core/01088.webp') === '01088');
check('no code from anything else', codeOfImage('/art/campaigns/fne.jpg') === null);

check('cgbuilder: pack and card, zeros dropped, letter upper case',
  cgbuilderUrl('01001a') === 'https://mc-src.cgbuilder.fr/images/carte/1/1A.jpg', cgbuilderUrl('01001a'));
check('cgbuilder: a two-digit pack', cgbuilderUrl('60037a') === 'https://mc-src.cgbuilder.fr/images/carte/60/37A.jpg');
check('cgbuilder: no letter', cgbuilderUrl('21112') === 'https://mc-src.cgbuilder.fr/images/carte/21/112.jpg');

// A reprint lives in the box it was first printed in, not its own pack.
setMc4dbPaths({ '01001a': 'core/01001a', '12015': 'core/01088', '60037a': 'fear_no_evil_by_ffg/60037a' });

check('English: MarvelCDB first, MC4DB English after',
  same(cardImageCandidates('/bundles/cards/01001a.png', 'en'), [
    'https://marvelcdb.com/bundles/cards/01001a.png',
    'https://mc4db.merlindumesnil.net/bundles/cards/EN/core/01001a.webp',
  ]), JSON.stringify(cardImageCandidates('/bundles/cards/01001a.png', 'en')));

check('French: MC4DB French, cgbuilder, MarvelCDB, MC4DB English',
  same(cardImageCandidates('/bundles/cards/01001a.png', 'fr'), [
    'https://mc4db.merlindumesnil.net/bundles/cards/FR/core/01001a.webp',
    'https://mc-src.cgbuilder.fr/images/carte/1/1A.jpg',
    'https://marvelcdb.com/bundles/cards/01001a.png',
    'https://mc4db.merlindumesnil.net/bundles/cards/EN/core/01001a.webp',
  ]));

check('a reprint takes its first box from the MC4DB list',
  cardImageCandidates('/bundles/cards/12015.png', 'fr')[0] === 'https://mc4db.merlindumesnil.net/bundles/cards/FR/core/01088.webp');

// A card MarvelCDB has no picture for arrives with MC4DB's English one.
const borrowed = 'https://mc4db.merlindumesnil.net/bundles/cards/EN/fear_no_evil_by_ffg/60037a.webp';
check('English: a borrowed MC4DB picture is used as it is, once',
  same(cardImageCandidates(borrowed, 'en'), [borrowed]));
check('French: a borrowed picture still goes to its French scan first',
  cardImageCandidates(borrowed, 'fr')[0] === 'https://mc4db.merlindumesnil.net/bundles/cards/FR/fear_no_evil_by_ffg/60037a.webp');

check('something that is not a card picture is left alone',
  same(cardImageCandidates('/art/campaigns/fne.jpg', 'fr'), ['https://marvelcdb.com/art/campaigns/fne.jpg']));

// The chain the page's error listener walks.
const first = localisedCardImage('/bundles/cards/01001a.png');
check('the first address is English until a language is configured', first === 'https://marvelcdb.com/bundles/cards/01001a.png', first);
check('after it fails, MC4DB English', nextCardImage(first) === 'https://mc4db.merlindumesnil.net/bundles/cards/EN/core/01001a.webp');
check('and then nothing', nextCardImage('https://mc4db.merlindumesnil.net/bundles/cards/EN/core/01001a.webp') === null);

if (failures > 0) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log('\nPASS');
