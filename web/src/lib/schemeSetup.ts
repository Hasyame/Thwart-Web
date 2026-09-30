/**
 * The setup printed on a scenario's first main scheme card.
 *
 * Every scenario tells you how to set itself up, and that text is on the 1A
 * side of the main scheme: put this into play, attach that, discard so many
 * cards. Without it the briefing can say which cards to gather and then leaves
 * the player to pick the card out of the box to read the part in between.
 *
 * A port of the app's `domain/campaign/SchemeSetup.kt`. It reads the card
 * database rather than a template, which means it arrives in whatever language
 * the cards are in and no Fantasy Flight text ever lives in this repository.
 *
 * Only stage 1A carries one. Later stages are what happens when the scheme
 * advances, and asking them for a setup correctly gets nothing back.
 */

/**
 * The heading, which is bold, and inconsistently so.
 *
 * Nebula writes `<b>Setup</b>:`, Hela `<b> Setup: </b>` with the colon inside
 * the tag and spaces around it, and the French endpoint
 * `<b>Mise en place</b> :` with the space before the colon that French
 * typography wants. All three are the same heading.
 */
const HEADING = /<b>\s*(?:Setup|Mise en place)\s*:?\s*<\/b>\s*:?\s*/i;

/** Whatever heading comes after it, usually none, since Setup is last. */
const NEXT_HEADING = /<b>\s*[^<]{2,40}\s*<\/b>\s*:/;

/**
 * A full stop that ends a step.
 *
 * Not every full stop does. One after a single capital is an initial, and
 * "Agents of S.H.I.E.L.D." would otherwise become five steps. One before an
 * opening bracket introduces an aside: Mysterio's "(Shuffle.)" belongs to the
 * sentence it follows, not to a step of its own.
 */
const STEP_BREAK = /(?<![A-Z])\.\s+(?=[A-ZÀ-Ý“"])/;

const TRAIT = /\[\[([^\]]+)\]\]/g;
const ICON = /\[([a-z_]+)\]/g;
const TAG = /<[^>]+>/g;
const SPACE_BEFORE_PUNCTUATION = /\s+([.,;:])/g;
const RUN_OF_SPACES = /\s{2,}/g;

function readable(raw: string): string {
  return raw
    // A trait reads as a trait on the printed card, which is small capitals
    // the site has no font for; capitals are the honest approximation.
    .replace(TRAIT, (_match, inner: string) => inner.toUpperCase())
    // "2[per_hero] cards" has to become "2 per player cards": the rules
    // reference calls this icon PER PLAYER, so the site does too.
    .replace(/\[per_hero\]/g, ' per player')
    .replace(ICON, (_match, name: string) => ` ${name.replace(/_/g, ' ').toUpperCase()}`)
    .replace(TAG, '')
    .replace(RUN_OF_SPACES, ' ')
    .replace(SPACE_BEFORE_PUNCTUATION, '$1')
    .trim();
}

function section(text: string | null | undefined): string | null {
  const whole = text ?? '';
  const match = HEADING.exec(whole);
  if (match === null) {
    return null;
  }
  const rest = whole.slice(match.index + match[0].length);
  const next = NEXT_HEADING.exec(rest);
  const body = readable(rest.slice(0, next === null ? rest.length : next.index));
  return body === '' ? null : body;
}

const endsWithSentence = (value: string): boolean =>
  value.endsWith('.') ||
  value.endsWith('!') ||
  value.endsWith('?') ||
  value.endsWith('.)') ||
  value.endsWith('."');

/**
 * The setup steps printed on `text`, or empty when it carries none.
 *
 * Two scenarios genuinely have none: Ebony Maw and Thanos put theirs in the
 * rules insert instead. Empty is the right answer there, not a guess.
 */
export function setupSteps(text: string | null | undefined): string[] {
  const body = section(text);
  if (body === null) {
    return [];
  }
  return body
    .split(STEP_BREAK)
    .map((step) => step.trim())
    .filter((step) => step !== '')
    .map((step) => (endsWithSentence(step) ? step : `${step}.`));
}

export interface SchemeBriefing {
  readonly schemeName: string | null;
  readonly steps: readonly string[];
}

interface BriefingCard {
  readonly name: string;
  readonly type_code: string;
  readonly stage?: string | null;
  readonly text?: string | null;
}

/**
 * The main scheme to put out, and how the scenario says to set itself up.
 *
 * The scheme is chosen by what the card carries rather than by its stage. Only
 * the first stage has a setup, but the stage is written "1A" on sixty of them
 * and plain "A" on two, and older scenarios number theirs "1" and print no
 * setup at all because it lives in the campaign book. Asking for the one with a
 * setup on it answers all three.
 */
export function briefingFor(cards: readonly BriefingCard[]): SchemeBriefing {
  const schemes = cards.filter((card) => card.type_code === 'main_scheme');
  if (schemes.length === 0) {
    return { schemeName: null, steps: [] };
  }

  for (const scheme of schemes) {
    const steps = setupSteps(scheme.text);
    if (steps.length > 0) {
      return { schemeName: scheme.name, steps };
    }
  }

  // Named even when there is no setup to print, so the briefing can still say
  // which main scheme to put out.
  const earliest = [...schemes].sort((a, b) =>
    (a.stage ?? '').localeCompare(b.stage ?? ''),
  )[0];
  return { schemeName: earliest?.name ?? null, steps: [] };
}


interface CampaignSetupCard extends BriefingCard {
  readonly code: string;
  readonly linked_to_code?: string | null;
  readonly base_threat?: number | null;
  readonly base_threat_fixed?: boolean | null;
  readonly threat?: number | null;
  readonly threat_fixed?: boolean | null;
}

/** Read the initial scheme pair only; never execute later stages during preparation. */
export function campaignSetupSteps(
  cards: ReadonlyMap<string, CampaignSetupCard>, codes: readonly string[], players: number, locale: string,
): string[] {
  const listed = codes.map(code => cards.get(code)).filter((card): card is CampaignSetupCard => card != null);
  const first = listed.find(card => /^(?:1)?[AB]$/i.test(card.stage ?? '')) ?? listed[0];
  if (!first) return [];
  const front = /B$/i.test(first.stage ?? '')
    ? [...cards.values()].find(card => card.linked_to_code === first.code) ?? cards.get(first.code.replace(/b$/, 'a')) ?? first
    : first;
  const back = cards.get(front.linked_to_code ?? front.code.replace(/a$/, 'b'));
  const result = setupSteps(front.text);
  const reveal = (text: string | null | undefined) => setupSteps((text ?? '').replace(/<b>\s*(?:When Revealed|Une fois révélée?)\s*:?\s*<\/b>/i, '<b>Setup</b>'));
  if (!result.length) result.push(...reveal(front.text));
  if (back && back.code !== front.code) {
    const start = typeof back.base_threat === 'number' ? back.base_threat * (back.base_threat_fixed ? 1 : players) : 'X';
    const limit = typeof back.threat === 'number' ? back.threat * (back.threat_fixed ? 1 : players) : 'X';
    result.push(locale === 'fr'
      ? `${back.name} : retournez sur ${back.stage ?? '1B'}, avec ${start} menace(s) de départ ; seuil ${limit}.`
      : `${back.name}: flip to ${back.stage ?? '1B'}, with ${start} starting threat; threshold ${limit}.`);
    result.push(...reveal(back.text));
  }
  return result;
}

/** Initial villain effects follow the initial scheme, never later villain stages. */
export function villainSetupSteps(card: CampaignSetupCard | undefined, locale: string): string[] {
  if (!card) return [];
  const result = setupSteps(card.text);
  const reveal = /<b>\s*(?:When Revealed|Une fois révélée?)\s*:?\s*<\/b>/i;
  const match = reveal.exec(card.text ?? '');
  if (match) result.push(...setupSteps((card.text ?? '').slice(match.index).replace(reveal, '<b>Setup</b>')));
  if (/^(?:Toughness|Ténacité)\./i.test(readable(card.text ?? ''))) result.unshift(locale === 'fr'
    ? 'Donnez-lui un état Tenace (Ténacité).'
    : 'Give it a tough status card (Toughness).');
  return result.map(step => `${card.name} ${card.stage ?? ''} : ${step}`);
}
