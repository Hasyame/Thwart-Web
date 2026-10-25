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
check('cgbuilder: no letter', cgbuilderUrl('21112') === 'https://mc-src.cgbuilder.fr/images/carte/18/112.jpg');

// A reprint lives in the box it was first printed in, not its own pack.
setMc4dbPaths({ '01001a': 'core/01001a', '12015': 'core/01088', '60037a': 'fear_no_evil_by_ffg/60037a' });

check('English uses the original scan, without the unavailable host',
  same(cardImageCandidates('/bundles/cards/01001a.png', 'en'), ['https://marvelcdb.com/bundles/cards/01001a.png']));
check('French starts with cgbuilder then the English scan',
  same(cardImageCandidates('/bundles/cards/01001a.png', 'fr'), [
    'https://mc-src.cgbuilder.fr/images/carte/1/1A.jpg',
    'https://marvelcdb.com/bundles/cards/01001a.png',
  ]));
check('reprints retain an additional original French scan',
  cardImageCandidates('/bundles/cards/12015.png', 'fr').includes('https://mc-src.cgbuilder.fr/images/carte/1/88.jpg'));
const borrowed = 'https://mc4db.merlindumesnil.net/bundles/cards/EN/fear_no_evil_by_ffg/60037a.webp';
check('borrowed MC4DB URLs are repaired',
  same(cardImageCandidates(borrowed, 'en'), ['https://marvelcdb.com/bundles/cards/60037a.png']));
check('borrowed French cards start at the working French provider',
  cardImageCandidates(borrowed, 'fr')[0] === 'https://mc-src.cgbuilder.fr/images/carte/60/37A.jpg');
for (const language of ['en','fr']) for (const src of [borrowed, '/bundles/cards/01001a.png']) {
  check(`no HTTP-200 placeholder in ${language} fallback`, !cardImageCandidates(src, language).some(u => u.includes('mc4db.merlindumesnil.net')));
}

check('something that is not a card picture is left alone',
  same(cardImageCandidates('/art/campaigns/fne.jpg', 'fr'), ['https://marvelcdb.com/art/campaigns/fne.jpg']));

// The chain the page's error listener walks.
const first = localisedCardImage('/bundles/cards/01001a.png');
check('the first address is English until a language is configured', first === 'https://marvelcdb.com/bundles/cards/01001a.png', first);
check('no unavailable provider after the English scan', nextCardImage(first) === null);
check('and then nothing', nextCardImage('https://mc4db.merlindumesnil.net/bundles/cards/EN/core/01001a.webp') === null);

// A localized image passed back through the resolver must not create a loop.
const alreadyFrench = 'https://mc4db.merlindumesnil.net/bundles/cards/FR/core/01001a.webp';
const unique = cardImageCandidates(alreadyFrench, 'fr');
check('localized source appears only once', unique.length === new Set(unique).size);
localisedCardImage(alreadyFrench);
const visited = new Set();
let address = alreadyFrench;
while (address !== null && !visited.has(address)) {
  visited.add(address);
  address = nextCardImage(address);
}
check('fallback terminates instead of cycling through failed images', address === null);

for (const [prefix, expected] of Object.entries({2:3,3:4,4:2,13:14,14:13,18:19,19:20,20:21,21:18,28:29,29:28,33:34,34:33,35:36,36:35,37:39,39:37,41:42,42:41,43:44,44:43,51:52,52:51,53:54,54:53,58:59,59:58})) {
  check(`Provider pack mapping ${prefix}`, cgbuilderUrl(`${prefix.padStart(2, '0')}001a`) === `https://mc-src.cgbuilder.fr/images/carte/${expected}/1A.jpg`);
}
check('Deadpool Poolisation must not display X-23 Rictor', cgbuilderUrl('44041') === 'https://mc-src.cgbuilder.fr/images/carte/43/41.jpg');
check('Unknown packs do not guess an unrelated French image', cgbuilderUrl('99001') === null);

if (failures > 0) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log('\nPASS');
