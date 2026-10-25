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


export interface CampaignSetupCard extends BriefingCard {
  readonly code: string;
  readonly linked_to_code?: string | null;
  readonly base_threat?: number | null;
  readonly base_threat_fixed?: boolean | null;
  readonly threat?: number | null;
  readonly threat_fixed?: boolean | null;
  readonly real_text?: string | null;
}

export function scaledSetupText(card: CampaignSetupCard, players: number, locale: string): string {
  return (card.text ?? '').replace(/(\d+)\s*(?:\[per_hero\]|per hero|par héros|par joueur)/gi, (_m,n) => String(Number(n)*players))
    .replace(/\[per_hero\]/g, locale === 'fr' ? ' par joueur' : ' per player');
}

/** Resolve effects of putting/revealing a campaign card; never its in-game actions. */
export function cardPreparationDetails(card: CampaignSetupCard | undefined, reveal: boolean, players: number, locale: string): string[] {
  if (!card) return [];
  const raw=scaledSetupText(card,players,locale), result:string[]=[];
  if (card.type_code === 'side_scheme' && typeof card.base_threat === 'number') {
    const base=card.base_threat*(card.base_threat_fixed?1:players);
    const hinder=reveal?Number(/(?:Hinder|Entrave)\s+(\d+)/i.exec(raw)?.[1]??0):0;
    result.push(locale==='fr'?`${card.name} : ${base+hinder} menaces de départ${hinder?' (Entrave comprise)':''}.`:`${card.name}: ${base+hinder} starting threat${hinder?' (including Hinder)':''}.`);
  }
  if (reveal) result.push(...setupSteps(raw.replace(/<b>\s*(?:When Revealed|Une fois révélée?)\s*:?\s*<\/b>/i,'<b>Setup</b>')));
  else if (card.type_code.startsWith('evidence')) result.push(...setupSteps(raw));
  return result;
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
    result.push(typeof back.base_threat !== 'number' && typeof back.threat !== 'number'
      ? (locale === 'fr' ? `${back.name} : retournez sur ${back.stage ?? '1B'}.` : `${back.name}: flip to ${back.stage ?? '1B'}.`)
      : locale === 'fr'
      ? `${back.name} : retournez sur ${back.stage ?? '1B'}, avec ${start} menace(s) de départ${typeof back.threat === 'number' ? ` ; seuil ${limit}` : ''}.`
      : `${back.name}: flip to ${back.stage ?? '1B'}, with ${start} starting threat${typeof back.threat === 'number' ? `; threshold ${limit}` : ''}.`);
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

/** Resolve only the starting board, including scenarios with simultaneous schemes. */
export function campaignScenarioSetupSteps(
  cards: ReadonlyMap<string, CampaignSetupCard>, schemeCodes: readonly string[],
  villainCodes: readonly string[], scenarioId: string | undefined, players: number, locale: string,
  draws: Readonly<Record<string,readonly string[]>> = {},
): string[] {
  cards = new Map([...cards].map(([code,card])=>[code,{...card,text:scaledSetupText(card,players,locale)}]));
  const fr=locale==='fr';
  const replaceFront = (code:string, en:string, french:string) => {
    const card=cards.get(code);
    if(card) cards=new Map([...cards,[code,{...card,text:`<b>Setup</b>: ${fr?french:en}`}]]);
  };
  if(scenarioId==='s1_morlock_siege' && draws.marauderOrder?.length) replaceFront('40077a',
    'Put Routed into play on the side matching scenario difficulty. Set Hide! and the Morlock allies aside. Use the recorded Marauder order, with only its first villain in play.',
    'Mettez Déroute en jeu sur la face correspondant à la difficulté du scénario. Réservez Cachez-vous ! et les alliés Morlock. Utilisez l’ordre des Maraudeurs enregistré : seul le premier méchant est en jeu.');
  if(scenarioId==='s2_on_the_run' && draws.captor?.length) replaceFront('40103a',
    'Put the recorded captor into play. Remove the minion with that same name and all other villain cards from the game. Attach Hope’s Captor to the villain, Confident side up.',
    'Mettez le ravisseur enregistré en jeu. Retirez le sbire portant ce même nom et toutes les autres cartes Méchant de la partie. Attachez Ravisseur de Hope au méchant, face Confiant.');
  if(scenarioId==='s4_mansion' && (draws.brotherhoodOrder?.length || draws.brotherhoodOrderExpert?.length)) replaceFront('32125a',
    'Put Save the School into play. Shuffle the four stage 2A cards facedown beneath stage 1A. Use the recorded Brotherhood order; only the first villain is in play.',
    'Mettez Sauver l’École en jeu. Mélangez les quatre cartes 2A face cachée sous le stade 1A. Utilisez l’ordre de la Confrérie enregistré ; seul le premier méchant est en jeu.');
  if(scenarioId==='s5_loki' && draws.loki?.length) replaceFront('21165a',
    'Use the recorded Loki and set the other four aside. Put War in Asgard into play and shuffle the encounter deck. Reveal the top card of the separate Infinity Stone deck.',
    'Utilisez le Loki enregistré et réservez les quatre autres. Mettez Guerre en Asgard en jeu et mélangez le deck Rencontre. Révélez la carte du dessus du deck séparé des Pierres d’Infinité.');
  if(scenarioId==='s3_modok') {
    const code='50104a', card=cards.get(code);
    const cellSetup = fr
      ? `Mélangez les quatre Cellules de Détention, faces Cellule visibles. Seule la carte du dessus est en jeu ; placez-y ${2*players} jetons Verrou.`
      : `Shuffle the four Holding Cell cards with their cell faces up. Only the top card is in play; place ${2*players} lock counters on it.`;
    if(card) cards=new Map([...cards,[code,{...card,text:(card.text??'')
      .replace(/Create the Holding Cell deck(?:\s*<i>.*?<\/i>)?\./i,cellSetup)
      .replace(/Créez le deck[^.(]*(?:\([^)]*\)[^.]*)?\./i,cellSetup)}]]);
  }
  // Tower Defense starts both stages. Venom Goblin uses a separate setup card,
  // whose reverse is a rules card rather than a numbered threat stage.
  let schemes = scenarioId === 's2_tower_defense'
    ? schemeCodes.flatMap(code => campaignSetupSteps(cards, [code], players, locale))
    : scenarioId === 's5_venom_goblin'
      ? schemeCodes.flatMap(code => setupSteps(cards.get(code)?.text))
      : campaignSetupSteps(cards, schemeCodes, players, locale);
  if (scenarioId === 's5_venom_goblin') {
    for (const code of ['27117a','27118a','27119a']) {
      const card=cards.get(code); if(!card)continue;
      const start=(card.base_threat??0)*(card.base_threat_fixed?1:players), limit=(card.threat??0)*(card.threat_fixed?1:players);
      schemes.push(locale==='fr'?`${card.name} : ${start} menaces de départ ; seuil ${limit}.`:`${card.name}: ${start} starting threat; threshold ${limit}.`);
    }
  }
  if (scenarioId === 's4_mister_sinister') {
    const selected=draws.experiments?.[0];
    if(selected) {
      // 1B has already advanced: reveal the selected 2A/2B before the villain.
      schemes=schemes.filter(s=>!/(?:Remove 1 random stage|Retirez.*aléatoire|Then advance|Puis avancez)/i.test(s));
      schemes.push(...campaignSetupSteps(cards,[selected],players,locale));
    } else schemes.push(locale==='fr'?'Résolvez les faces 2A et 2B de l’expérience tirée avant la révélation du méchant.':'Resolve the drawn experiment’s 2A and 2B sides before revealing the villain.');
  }
  if (scenarioId === 's4_mansion') schemes = schemes.map(step => /^(?:Advance to the next card|Avancez à la carte suivante)/i.test(step)
    ? (locale==='fr'
      ? `Avancez vers le premier stade 2A du paquet mélangé. Retournez-le sur 2B : ${players} menace(s) de départ, seuil ${7*players}. Appliquez l’effet constant du lieu révélé.`
      : `Advance to the first stage 2A of the shuffled deck. Flip it to 2B: ${players} starting threat, threshold ${7*players}. Apply the revealed location’s constant effect.`)
    : step);
  // A pool of different villains is not a sequential I/II/III deck. Their
  // selected order and reveal instructions remain in the scenario's guide.
  const sameVillain = new Set(villainCodes.map(code => cards.get(code)?.name)).size === 1;
  const brotherhood = villainCodes[0]?.endsWith('b') ? draws.brotherhoodOrderExpert ?? draws.brotherhoodOrder : draws.brotherhoodOrder;
  const first = draws.loki?.[0] ?? draws.captor?.[0] ?? draws.marauderOrder?.[0] ?? brotherhood?.[0] ?? (sameVillain ? villainCodes[0] : undefined);
  const chosen = first && villainCodes.includes(first.replace(/a$/,'b')) && !villainCodes.includes(first) ? first.replace(/a$/,'b') : first;
  const villainSteps = scenarioId === 's2_tower_defense'
    ? [villainCodes[0],villainCodes[2]].flatMap(code=>villainSetupSteps(cards.get(code??''),locale))
    : villainSetupSteps(cards.get(chosen??''),locale);
  return [...schemes,...villainSteps];
}
