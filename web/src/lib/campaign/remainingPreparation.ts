import { REMAINING_CAMPAIGNS } from './remainingRules';
import { scenarioDifficulty } from './encounter';
import type { CampaignState, SetupStep } from './types';

export type PreparationPhase = 'players' | 'gather' | 'beforeScheme' | 'afterScheme' | 'campaign' | 'mulligan' | 'afterMulligan' | 'finished' | 'omit';
export const hasRemainingGuide = (id: string): boolean => (REMAINING_CAMPAIGNS as readonly string[]).includes(id);

/** Route each instruction exactly once. Inventory previews never execute actions or draws. */
export function preparationPhase(id: string, sid: string, step: SetupStep): PreparationPhase {
  const en = step.text?.en ?? '';
  if (id === 'gmw' && sid === 's2_museum' && en.startsWith('When setup ends,')) return 'finished';
  if (id === 'mts') {
    if (step.cards?.[0] === '21129' || step.draw?.id === 'loki') return 'beforeScheme';
    if (en.startsWith('Choose how many Lokis')) return 'gather';
    if (en.startsWith('To make it harder,')) return 'afterScheme';
  }
  if (id === 'sm' && en.startsWith('During the mulligan step,')) return 'mulligan';
  if (id === 'mg') {
    if (en.startsWith('Optional difficulty adjustment:')) return 'afterScheme';
    if (step.draw?.id?.startsWith('brotherhoodOrder')) return 'beforeScheme';
    if (en === 'These allies were left behind and cannot be used for the rest of the campaign.') return 'players';
  }
  if (id === 'next') {
    if (step.cards?.[0] === '40204') return 'players';
    if (step.draw?.id === 'marauderOrder' || step.draw?.id === 'captor' || step.draw?.id === 'experiments' || en.startsWith('Remove these Marauders')) return 'beforeScheme';
    if (en === 'Defeat 3 of the 7 Marauders to win.') return 'gather';
  }
  if (id === 'aos') {
    if (en.startsWith('After mulligans,')) return 'afterMulligan';
    // The accusation is an in-game decision, not a preparation action.
    if (en.startsWith("The mole's evidence") || en.startsWith('Means:') || en.startsWith('Motive:') || en.startsWith('Opportunity:') || en.startsWith('Read those three')) return 'omit';
  }
  return 'campaign';
}

const text = (en: string, fr: string): SetupStep => ({text:{en,fr}});

export function inventoryPreview(id: string, sid: string, _state: CampaignState, steps: readonly SetupStep[]): SetupStep[] {
  const result: SetupStep[] = [];
  if (id === 'gmw') result.push({...text('Include every Market card bought by each hero in that hero’s deck; they remain for the campaign and do not count toward deck size. Identify any recorded Collection cards for the later campaign instruction.', 'Ajoutez au deck de chaque héros toutes ses cartes achetées au Marché ; elles restent dans la campagne et ne comptent pas dans la taille du deck. Repérez les cartes enregistrées dans la Collection pour l’instruction de campagne à venir.'), showCardList:'purchases'});
  if (id === 'mg') result.push(text('Prepare the role cards and any rescued allies listed below. Role choices, random upgrades and additions to decks are resolved once, after scenario setup. Keep the same role throughout the campaign.', 'Préparez les cartes de rôle et les alliés secourus indiqués ci-dessous. Les choix de rôle, améliorations aléatoires et ajouts aux decks seront résolus une seule fois, après l’installation du scénario. Conservez le même rôle pendant la campagne.'));
  if (id === 'sm') result.push(text('Keep each hero’s recorded S.H.I.E.L.D. Tech and Aspect Advantage cards in their deck; they do not count toward deck size. Reserve the Planning Ahead card without adding it to the hand yet.', 'Conservez dans chaque deck ses cartes enregistrées Techno du S.H.I.E.L.D. et Avantage d’Affinité ; elles ne comptent pas dans sa taille. Repérez la carte Planification sans encore l’ajouter à la main.'));
  if (id === 'aos' && sid !== 's1_black_widow') result.push(text('Keep the earned evidence faceup beside the campaign log. Its deck and hand effects will be resolved after mulligans; do not apply them now.', 'Gardez les indices acquis face visible près du registre. Leurs effets sur les decks et les mains seront résolus après les mulligans ; ne les appliquez pas maintenant.'));
  for (const step of steps) {
    const en = step.text?.en ?? '';
    const deckChange = (id === 'mts' && ['21183','21185'].includes(step.cards?.[0] ?? ''))
      || (id === 'gmw' && step.showCardList === 'collection')
      || (id === 'mg' && en.startsWith('Each of these rescued allies'));
    if (deckChange) result.push({...text('Set these cards within reach. Apply their deck changes at the campaign step, after the scenario effects.', 'Gardez ces cartes à portée de main. Appliquez leur modification des decks à l’étape Campagne, après les effets du scénario.'),cards:step.cards,showCardList:step.showCardList});
  }
  return result;
}

/** Booklet-only instructions, absent from the initial main scheme's text. */
export function preparationNotes(id: string, sid: string, state: CampaignState): {gather:SetupStep[]; beforeScheme:SetupStep[]; campaign:SetupStep[]} {
  const gather: SetupStep[] = [], beforeScheme: SetupStep[] = [], campaign: SetupStep[] = [];
  const n = state.heroes.length, expert = scenarioDifficulty(state,sid) === 'expert';
  if (id === 'gmw' && sid === 's2_museum') gather.push(text('Leave a shared, visible space beside the encounter deck for The Collection. Cards there are out of play.', 'Réservez près du deck Rencontre un espace commun et visible pour la Collection. Les cartes qui s’y trouvent sont hors jeu.'));
  if (id === 'gmw' && sid === 's3_escape') gather.push(text('Set the Ship Command set apart, including the Milano. It enters later; do not shuffle it into the initial encounter deck.', 'Réservez le set Commandement de Vaisseau, Milano compris. Il intervient plus tard ; ne le mélangez pas au deck Rencontre initial.'));
  if (id === 'mts' && ['s3_thanos','s5_loki'].includes(sid)) {
    gather.push(text('Keep the six Infinity Stones apart from the encounter deck, with a separate discard pile.', 'Gardez les six Pierres d’Infinité séparées du deck Rencontre, avec leur propre défausse.'));
    if(sid === 's5_loki') beforeScheme.push({...text('Attach the Infinity Gauntlet to the selected Loki. Shuffle the six Infinity Stones into a separate facedown deck before resolving the main scheme.', 'Attachez le Gantelet de l’Infini au Loki sélectionné. Mélangez les six Pierres d’Infinité en un deck séparé face cachée avant de résoudre la manigance principale.'),cards:['21129']});
  }
  if (id === 'mts' && sid === 's2_tower_defense') gather.push(text('Prepare both villains and both main schemes simultaneously. Start each villain at stage II in Expert or I in Standard. Corvus Glaive starts active because Focused Defense is attached to his scheme.', 'Préparez simultanément les deux méchants et leurs deux manigances principales. Chaque méchant commence au stade II en Expert ou I en Standard. Corvus Glaive commence actif : Défense Concentrée est attachée à sa manigance.'));
  if (id === 'mts' && sid === 's4_hela') gather.push(text('Use Hela’s Mystic side: A in Standard, B in Expert. Her Wounded reverse is not a second villain stage to prepare.', 'Utilisez la face Mystique d’Hela : A en Standard, B en Expert. Son verso Blessée n’est pas un second stade de méchant à préparer.'));
  if (id === 'sm' && sid === 's4_sinister_six') gather.push(text(`Prepare all six villains. The initial scheme selects ${n+1} of them; the others remain out of play.`, `Préparez les six méchants. La manigance initiale en sélectionne ${n+1} ; les autres restent hors jeu.`));
  if (id === 'mg' && sid === 's4_mansion') gather.push(text(`Prepare all four versions of stage 2A and the four villains on side ${expert?'B':'A'}. Defeat ${expert?3:2} villains to win. Keep the shuffled future cards hidden.`, `Préparez les quatre versions du stade 2A et les quatre méchants face ${expert?'B':'A'}. Il faut vaincre ${expert?3:2} méchants. Gardez les futures cartes mélangées cachées.`));
  if (id === 'next' && sid === 's1_morlock_siege') gather.push(text(`Use the ${expert?'Expert':'Standard'} side of Routed. Set Hide! and all Morlock allies apart from the encounter deck.`, `Utilisez la face ${expert?'Expert':'Standard'} de Déroute. Réservez Cachez-vous ! et tous les alliés Morlock hors du deck Rencontre.`));
  if (id === 'next' && sid === 's4_mister_sinister') gather.push(text('Reserve the complete Flight, Super Strength and Telepathy sets. Ignore their attachments’ Setup keyword here; only the experiment being revealed adds its matching set.', 'Réservez les sets complets Vol, Super-Force et Télépathie. Ignorez ici le mot-clé Mise en place de leurs attachements ; seule l’expérience révélée ajoute le set correspondant.'));
  if (id === 'aos' && sid === 's4_thunderbolts') gather.push(text(`Choose ${n+1} modular sets containing an Elite Thunderbolt minion: Gravitational Pull, Hard Sound, Pale Little Spider, Power of the Atom, Supersonic or The Leaper. Reserve those minions; shuffle the rest of the chosen sets into the encounter deck.`, `Choisissez ${n+1} sets modulaires contenant un sbire Élite Thunderbolt : Attraction Gravitationnelle, Son Solide, Petite Araignée Pâle, Pouvoir de l’Atome, Supersonique ou Le Sauteur. Réservez ces sbires et mélangez le reste des sets choisis au deck Rencontre.`));
  if (id === 'aos' && sid === 's5_baron_zemo') gather.push(text('Use the existing evidence envelopes; do not create a new mystery. The initial scheme puts the Board Members into play; the campaign restores their recorded secrets and betrayed sides.', 'Utilisez les enveloppes d’indices existantes ; ne recréez pas le mystère. La manigance initiale met les membres du Conseil en jeu ; la campagne rétablit leurs secrets enregistrés et les faces des membres ayant trahi.'));
  return {gather,beforeScheme,campaign};
}

const BOOKS: Record<string,{name:string;pages:number[]}> = {
  gmw:{name:'Galaxy’s Most Wanted',pages:[8,10,12,14,18]}, mts:{name:'The Mad Titan’s Shadow',pages:[6,10,16,20,24]},
  sm:{name:'Sinister Motives',pages:[9,11,13,15,17]}, mg:{name:'Mutant Genesis',pages:[7,9,12,15,18]},
  next:{name:'Next Evolution',pages:[9,11,14,16,18]}, aos:{name:'Agents of S.H.I.E.L.D.',pages:[9,11,13,15,18]},
};
export function preparationSource(id: string,sid: string): string {
  const book=BOOKS[id], position=Number(sid.match(/^s(\d)/)?.[1] ?? 0)-1;
  return book ? `${book.name}, p. ${book.pages[position] ?? '—'} · Rules Reference 1.8, p. 51, 66–67` : '';
}
