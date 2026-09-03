/**
 * Campaign prose: the placeholders it carries, and the words it sets apart.
 *
 * The interesting failure is silent. A `{card:45071}` that does not resolve
 * prints a five-digit code in the middle of a French sentence and nothing
 * errors; a `{drawId}` that does not resolve prints braces. So the sweep at the
 * bottom is the real test: every placeholder in every bundled template has to
 * name something the app can name.
 *
 *   npm run test:text
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { campaignPlainText, parseCampaignText } from '../src/lib/campaign/text.ts';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

const NAMES = { '01001a': 'Spider-Man', '45071': 'Réserve de Gènes', s1_musee: "Cambriolage du Musée d'Art" };
const context = {
  cardName: (code) => NAMES[code] ?? code,
  drawnFor: (drawId) => (drawId === 'villain' ? ['01001a'] : drawId === 'pair' ? ['01001a', '45071'] : []),
};

// --- placeholders --------------------------------------------------------------

{
  const segments = parseCampaignText('Mettez {card:45071} en jeu.', context);
  check('a card placeholder becomes a card', segments.some((s) => s.kind === 'card'));
  check(
    'and carries the resolved name',
    segments.find((s) => s.kind === 'card')?.name === 'Réserve de Gènes',
  );
  check(
    'as plain text it is quoted',
    campaignPlainText('Mettez {card:45071} en jeu.', context) ===
      'Mettez "Réserve de Gènes" en jeu.',
  );
}

{
  check(
    'a draw placeholder resolves to what was drawn',
    campaignPlainText('Méchant : {villain}.', context) === 'Méchant : "Spider-Man".',
  );
  check(
    'several drawn cards are listed',
    campaignPlainText('{pair}', context) === '"Spider-Man", "Réserve de Gènes"',
  );
  // Dropped rather than printed as braces: an undrawn placeholder is the app
  // having nothing to say, not something to show the player.
  check(
    'nothing drawn leaves nothing behind',
    campaignPlainText('Ajoutez {nothing} au deck.', context) === 'Ajoutez au deck.',
  );
}

{
  // A template's own id for a card no database has. It still resolves, because
  // the template names it; what must not happen is the raw id reaching a reader.
  check(
    'a template-local id resolves through the same path',
    campaignPlainText('{card:s1_musee}', context) === `"Cambriolage du Musée d'Art"`,
  );
}

// --- keywords ------------------------------------------------------------------

{
  const segments = parseCampaignText('Retournez-la sur sa face ACHEVÉ ou ÉCHOUÉ.', context);
  const keywords = segments.filter((s) => s.kind === 'keyword').map((s) => s.text);
  check('both faces are set apart', keywords.join(',') === 'ACHEVÉ,ÉCHOUÉ');
}

{
  // Bounded by letters, not by \b: \b is defined against ASCII word characters,
  // so it would break ACHEVÉ in the middle.
  const segments = parseCampaignText('MISSIONNAIRE et MISSION', context);
  check(
    'a longer word containing a keyword is left alone',
    segments.filter((s) => s.kind === 'keyword').length === 1,
  );
}

{
  const segments = parseCampaignText('Sbire OVERSEER : {card:01001a}.', context);
  check(
    'keywords and cards live in the same sentence',
    segments.some((s) => s.kind === 'keyword') && segments.some((s) => s.kind === 'card'),
  );
}

check('empty text is no segments', parseCampaignText('', context).length === 0);
check('absent text is no segments', parseCampaignText(null, context).length === 0);

// --- every placeholder in every bundled campaign ---------------------------------

const TEMPLATES = join(import.meta.dirname, '..', 'public', 'data', 'campaigns');
if (!existsSync(TEMPLATES)) {
  console.error('No campaign templates. Run `npm run campaigns` first.');
  process.exit(1);
}

const PLACEHOLDER = /\{(card:)?([A-Za-z0-9_]+)\}/g;
/** MarvelCDB codes are digits with an optional face letter. */
const CARD_CODE = /^\d{5,6}[a-z]?$/;

let cards = 0;
let draws = 0;
const unresolvable = [];
const unknownDraws = [];

for (const file of readdirSync(TEMPLATES)) {
  if (file === 'index.json' || !file.endsWith('.json')) {
    continue;
  }
  const template = JSON.parse(readFileSync(join(TEMPLATES, file), 'utf8'));
  const local = new Set(Object.keys(template.localCardNames ?? {}));

  // Every draw id the template declares anywhere, so a `{drawId}` can be
  // checked against something rather than assumed.
  const drawIds = new Set();
  const collectDraws = (node) => {
    if (Array.isArray(node)) {
      node.forEach(collectDraws);
      return;
    }
    if (node && typeof node === 'object') {
      if (node.draw && typeof node.draw.id === 'string') {
        drawIds.add(node.draw.id);
      }
      Object.values(node).forEach(collectDraws);
    }
  };
  collectDraws(template);
  // Dealt by the app rather than declared in a setup step, and referred to by
  // name in the prose of every campaign that has one.
  if ((template.villainPool ?? []).length > 0) {
    drawIds.add('villain');
  }
  if (template.environmentDraw?.id) {
    drawIds.add(template.environmentDraw.id);
  }

  const strings = [];
  const collectText = (node) => {
    if (Array.isArray(node)) {
      node.forEach(collectText);
      return;
    }
    if (node && typeof node === 'object') {
      Object.values(node).forEach(collectText);
      return;
    }
    if (typeof node === 'string') {
      strings.push(node);
    }
  };
  collectText(template);

  for (const text of strings) {
    PLACEHOLDER.lastIndex = 0;
    for (const match of text.matchAll(PLACEHOLDER)) {
      const id = match[2];
      if (match[1] !== undefined) {
        cards += 1;
        if (!CARD_CODE.test(id) && !local.has(id)) {
          unresolvable.push(`${template.id}:${id}`);
        }
      } else {
        draws += 1;
        if (!drawIds.has(id)) {
          unknownDraws.push(`${template.id}:${id}`);
        }
      }
    }
  }
}

console.log(`      swept ${cards} card placeholders and ${draws} draw placeholders`);
check(
  'every card placeholder names a card the app can name',
  unresolvable.length === 0,
  unresolvable.slice(0, 5).join(', '),
);
check(
  'every draw placeholder names a draw the template declares',
  unknownDraws.length === 0,
  unknownDraws.slice(0, 5).join(', '),
);

process.exit(failures === 0 ? 0 : 1);
