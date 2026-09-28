import type { Locale } from '../types';
import { counterOf, flagOf, type CampaignState } from './types';
import { drawnVillainFor, scenarioDifficulty } from './encounter';

export interface FneGuideStep { id: string; title: string; lines: readonly string[]; source: string }
export const FNE_JOB_SETS: Readonly<Record<string, readonly string[]>> = {
  s1_musee: ['art_museum_heist', 'cops', 'the_owl'],
  s2_poursuite: ['the_getaway', 'cops', 'drive'],
  s3_racket: ['protection_racket', 'disasters', 'tracksuit_mafia'],
  s4_raft: ['the_raft_breakout', 'the_owl', 'tombstone'],
  s5_rotatives: ['stop_the_presses', 'tombstone', 'tracksuit_mafia'],
  s6_caid: ['kingpin', 'tombstone', 'tracksuit_mafia'],
};
const villains: Readonly<Record<string, { set: string; codes: readonly string[]; hp: readonly number[] }>> = {
  fne_villain_hammerhead: {set:'hammerhead',codes:['60086','60087','60088'],hp:[14,15,16]},
  fne_villain_bullseye: {set:'bullseye',codes:['60065','60066','60067'],hp:[14,16,18]},
  fne_villain_electro: {set:'electro',codes:['60076','60077','60078'],hp:[15,17,20]},
  fne_villain_homme_pourpre: {set:'purple_man',codes:['60097','60098','60099'],hp:[13,15,17]},
  fne_villain_mary_typhoide: {set:'typhoid_mary',codes:['60110a','60111a'],hp:[10,13]},
};
export function fneGuideSets(state: CampaignState, id: string): readonly string[] {
  const villain = villains[drawnVillainFor(state,id) ?? ''];
  return [...(FNE_JOB_SETS[id] ?? []), ...(villain ? [villain.set] : []), ...(id==='s6_caid'?[]:['standard']), ...(scenarioDifficulty(state,id)==='expert'?['expert']:[])];
}

/** Original, contextual instructions audited against mc60 pp. 5, 9, 13–23 and card setup faces. */
export function fneGuide(locale: Locale, state: CampaignState, id: string): readonly FneGuideStep[] {
  const fr=locale==='fr', n=Math.max(1,state.heroes.length), expert=scenarioDifficulty(state,id)==='expert';
  const campaignExpert=state.difficulty==='expert', rate=campaignExpert?2:1;
  const say=(a:string,b:string)=>fr?a:b;
  const steps:FneGuideStep[]=[];
  const add=(id:string,title:string,enTitle:string,lines:readonly (readonly [string,string])[],source:string)=>steps.push({id,title:say(title,enTitle),lines:lines.map(([a,b])=>say(a,b)),source});
  const villainId=drawnVillainFor(state,id) ?? '', villain=villains[villainId];
  const isMary=villainId==='fne_villain_mary_typhoide';
  add('heroes','Préparez la table','Prepare the table',[
    ['Conservez les identités de cette campagne, face alter ego. Choisissez le premier joueur. Rassemblez les jetons et les cartes d’état.', 'Keep this campaign’s identities, alter-ego side up. Choose the first player. Gather tokens and status cards.'],
    ['Mettez les obligations à part pour le deck Rencontre et les sets Némésis en réserve. Préparez vos decks sans encore piocher.', 'Set obligations aside for the encounter deck and keep nemesis sets in reserve. Prepare your decks without drawing yet.'],
    ['Le scénario et son méchant ont déjà été attribués. Revenir dans ce guide ne relance ni le méchant ni la progression des missions.', 'The job and its villain are already assigned. Returning to this guide does not redraw the villain or progress jobs again.'],
  ],'mc60 · 9 · 1–7');
  const vlines: [string,string][]=[];
  if(id==='s6_caid') vlines.push([`Posez {card:${expert?'60160a':'60159a'}} sur ${expert?'B1':'A1'}, avec ${(expert?28:25)*n} PV. Gardez son verso pour la seconde phase.`,`Place {card:${expert?'60160a':'60159a'}} on ${expert?'B1':'A1'} with ${(expert?28:25)*n} HP. Keep its reverse for phase two.`]);
  else if(villain && !isMary) vlines.push([`Placez {card:${villain.codes[expert?1:0]}} au-dessus de {card:${villain.codes[expert?2:1]}}. Le premier stade commence à ${villain.hp[expert?1:0]!*n} PV. Mettez l’autre stade inutilisé de côté.`,`Place {card:${villain.codes[expert?1:0]}} above {card:${villain.codes[expert?2:1]}}. The starting stage has ${villain.hp[expert?1:0]!*n} HP. Set the unused stage aside.`]);
  else if(isMary) vlines.push([`Prenez les faces ${expert?'B':'A'} de Mary. La face enregistrée est {maryFace}. Préparez ${(expert?13:10)*n} PV ; sa révélation sera résolue après le deck Rencontre.`,`Take Mary’s ${expert?'B':'A'} faces. The saved starting face is {maryFace}. Prepare ${(expert?13:10)*n} HP; resolve its reveal after building the encounter deck.`]);
  else vlines.push(['Le méchant n’est pas encore enregistré. Revenez au choix de scénario pour terminer son attribution.','The villain is not recorded yet. Return to scenario selection to finish assigning it.']);
  add('villain','Placez votre méchant','Place your villain',vlines,'mc60 · 5 / villain cards');
  add('deck','Constituez le deck Rencontre','Build the encounter deck',[
    ['Rassemblez tous les exemplaires des sets ci-dessous. Les cartes Méchant et Manigance principale restent hors du deck. Ajoutez les obligations des joueurs et mélangez.', 'Gather every copy from the sets below. Keep villain and main-scheme cards outside the deck. Add the players’ obligations and shuffle.'],
    [id==='s6_caid'?'Le Caïd n’utilise aucun set Standard. En Expert, ajoutez le set Expert.':'Ajoutez Standard ; en scénario Expert, ajoutez aussi Expert.',id==='s6_caid'?'Kingpin uses no Standard set. In Expert mode, add Expert.':'Add Standard; in Expert scenario mode, add Expert as well.'],
    ['Sortez les cartes portant le mot-clé Mise en place. Gardez les sets Némésis en réserve, sauf instruction explicite ci-après.', 'Put cards with the Setup keyword into play. Keep nemesis sets in reserve unless instructed otherwise below.'],
  ],'mc60 · scenario contents / setup');
  const schemes:Record<string,readonly [string,string][]>={
    s1_musee:[['Posez {card:60121a}. Sortez {card:60122}, {card:60123}, {card:60124} et {card:60125}. Tirez-en une au hasard et attachez-la au méchant ; mélangez les trois autres dans le deck Rencontre.','Place {card:60121a}. Find {card:60122}, {card:60123}, {card:60124} and {card:60125}. Randomly attach one to the villain; shuffle the other three into the encounter deck.'],[`Retournez sur {card:60121b} avec ${n} menaces ; seuil ${9*n}. La première phase du Méchant ajoute ${2*n} menaces tant qu’il possède cette seule œuvre.`,`Flip to {card:60121b} with ${n} threat; threshold ${9*n}. The first villain phase adds ${2*n} threat while he holds that one artwork.`]],
    s2_poursuite:[[`Posez {card:60128a} avec ${expert?2:1} jeton(s) Vitesse. Attachez {card:60129a} au méchant, face En Tête.`,`Place {card:60128a} with ${expert?2:1} speed counter(s). Attach {card:60129a} to the villain, Out Front side up.`],[`Retournez sur {card:60128b} avec ${2*n} menaces, seuil ${9*n}. Gardez les jetons Vitesse ; ils ne représentent pas des menaces.`,`Flip to {card:60128b} with ${2*n} threat, threshold ${9*n}. Retain speed counters; they are separate from threat.`]],
    s3_racket:[[expert?'Distribuez au hasard une manigance différente à chaque joueur.':'Chaque joueur choisit une manigance différente, en consultant ses faces 1B.',expert?'Randomly deal a different main scheme to each player.':'Each player chooses a different main scheme, inspecting the 1B sides.'],['Les cinq possibilités sont {card:60134b}, {card:60135b}, {card:60136b}, {card:60137b} et {card:60138b}. Posez chacune dans la zone de son joueur à 0 menace, seuil 10. Mettez les autres hors jeu.','The five options are {card:60134b}, {card:60135b}, {card:60136b}, {card:60137b} and {card:60138b}. Place each in its owner’s play area at 0 threat, threshold 10. Set unused schemes aside.']],
    s4_raft:[['Posez {card:60142a} et attachez {card:60143} au méchant. Chaque joueur défausse des cartes Rencontre jusqu’à trouver un sbire PRISONNIER, puis le révèle engagé avec lui.','Place {card:60142a} and attach {card:60143} to the villain. Each player discards encounter cards until finding a PRISONER minion, then reveals it engaged with them.'],[`Retournez sur {card:60142b} avec ${2*n} menaces, seuil ${11*n}. Conservez la défausse créée par cette recherche.`,`Flip to {card:60142b} with ${2*n} threat, threshold ${11*n}. Retain the discard pile created by this search.`]],
    s5_rotatives:[['Posez {card:60151a} et {card:60152}. Distribuez au hasard un soutien parmi {card:60153}, {card:60154}, {card:60155} et {card:60156} à chaque joueur. Mettez-le en jeu avec 3 jetons Endurance et retirez les soutiens restants de cette partie.','Place {card:60151a} and {card:60152}. Randomly deal each player one support from {card:60153}, {card:60154}, {card:60155} and {card:60156}. Put it into play with 3 stamina counters and remove unused supports from this game.'],[`Retournez sur {card:60151b} avec ${n} menaces, seuil ${9*n}.`,`Flip to {card:60151b} with ${n} threat, threshold ${9*n}.`]],
    s6_caid:[['Posez {card:60161a}. Chaque joueur révèle son sbire Némésis. Si son titre est déjà celui d’un personnage en jeu, retirez ce sbire de la partie et cherchez puis révélez un sbire SUBORDONNÉ qui n’est pas en jeu.','Place {card:60161a}. Each player reveals their nemesis minion. If its title matches a character in play, remove that nemesis from the game and find and reveal an UNDERLING minion not in play.'],[`Retournez sur {card:60161b} avec ${3*n} menaces, seuil ${11*n}. Mettez {card:60163a} en jeu, face Faible, sans jeton Soutien. Gardez {card:60162a} pour la phase suivante.`,`Flip to {card:60161b} with ${3*n} threat, threshold ${11*n}. Put {card:60163a} into play, Low side up, with no support counters. Keep {card:60162a} for the next phase.`]],
  };
  add('scheme','Installez la manigance','Set up the main scheme',schemes[id]??[],'mc60 · 13–23 / main scheme 1A–1B');
  const reveal:[string,string][]=[];
  if(villainId==='fne_villain_bullseye') reveal.push([expert?'Attachez {card:60068a} à Bullseye.':'Mettez {card:60068a} de côté pour le prochain stade.',expert?'Attach {card:60068a} to Bullseye.':'Set {card:60068a} aside for the next stage.']);
  if(villainId==='fne_villain_electro') reveal.push([`Attachez {card:60079} à Electro avec ${2*n} jetons Charge.`,`Attach {card:60079} to Electro with ${2*n} charge counters.`]);
  if(villainId==='fne_villain_hammerhead'&&expert) reveal.push(['Donnez un état Tenace à Hammerhead. Son stade II a Riposte 1.','Give Hammerhead a tough status card. Stage II has Retaliate 1.']);
  if(isMary) reveal.push([`Mettez {card:60112} et {card:60113a} en jeu. Placez ${8*n+(expert?3*n:0)} menaces sur cette manigance annexe. Révélez la face {maryFace} déjà tirée. ${expert?'Sur Typhoid Mary, donnez-lui Tenace ; sur Bloody Mary, infligez 1 dégât à chaque identité.':''}`,`Put {card:60112} and {card:60113a} into play. Place ${8*n+(expert?3*n:0)} threat on the side scheme. Reveal the saved {maryFace} face. ${expert?'On Typhoid Mary, give her Tough; on Bloody Mary, deal 1 damage to each identity.':''}`]);
  if(!reveal.length) reveal.push(['Aucun effet de révélation supplémentaire pour ce méchant à ce stade de départ.','There is no additional reveal effect for this villain’s starting stage.']);
  add('reveal','Révélez le méchant','Reveal the villain',reveal,'mc60 · 5 / starting villain');
  add('decks','Vérifiez vos decks de campagne','Check campaign decks',[
    ['Retirez les alliés et soutiens enregistrés comme perdus ci-dessous. Complétez vos decks jusqu’à leur taille minimale légale, puis mélangez.', 'Remove the allies and supports recorded as lost below. Restore each deck to its legal minimum size, then shuffle.'],
  ],'mc60 · 9 · 8');
  add('hand','Main de départ et identités','Opening hands and identities',[
    ['Piochez jusqu’à la taille de main de votre alter ego. Pour le mulligan, mettez de côté les cartes choisies, repiochez jusqu’à cette taille, puis remélangez les cartes écartées dans votre deck.', 'Draw to your alter-ego hand size. For a mulligan, set chosen cards aside, draw back to hand size, then shuffle the set-aside cards into your deck.'],
    ['Résolvez ensuite les capacités de mise en place de vos identités. Le livret de cette campagne place les effets de campagne suivants après la préparation des joueurs.', 'Then resolve your identities’ setup abilities. This campaign’s booklet places the following campaign effects after player setup.'],
  ],'mc60 · 9 · 9');
  add('health','Points de vie de campagne','Campaign hit points',campaignExpert?[
    ['Reprenez les PV enregistrés ci-dessous après la partie précédente. Pour la première partie, utilisez les PV de départ de votre identité.', 'Restore the recorded HP below from the previous game. For the first game, use your identity’s starting HP.'],
    ['Chaque joueur peut recevoir une seule carte Rencontre face cachée pour soigner sa valeur REC, sans dépasser ses PV de base. Un joueur éliminé peut ainsi revenir à la partie. Ajustez son compteur physique.', 'Each player may take one facedown encounter card to heal their REC, up to base HP. An eliminated player can rejoin this way. Adjust their physical dial.'],
  ]:[['En campagne Standard, commencez avec les PV de base de chaque identité.','In a Standard campaign, start each identity at its base HP.']],'mc60 · 9 · 10–11');
  const env:[string,string][]=[];
  const jobs=['s1_musee','s2_poursuite','s3_racket','s4_raft','s5_rotatives'];
  const counters=['pressionMusee','pressionPoursuite','pressionRacket','pressionRaft','pressionRotatives'];
  const completed:[string,string][]=[
    ['Donnez Tenace à chaque identité.','Give every identity Tough.'],
    [`Chaque joueur peut chercher une amélioration dans son deck et sa défausse pour l’ajouter à sa main.${expert?' S’il le fait, il défausse ensuite 1 carte de sa main.':''} Remélangez le deck.`,`Each player may find an upgrade in their deck and discard pile and add it to their hand.${expert?' If they do, discard 1 card from hand.':''} Shuffle the deck.`],
    [`Chaque joueur peut chercher un soutien dans son deck et sa défausse pour l’ajouter à sa main.${expert?' S’il le fait, il défausse ensuite 1 carte de sa main.':''} Remélangez le deck.`,`Each player may find a support in their deck and discard pile and add it to their hand.${expert?' If they do, discard 1 card from hand.':''} Shuffle the deck.`],
    [`Chaque joueur peut chercher un allié dans son deck et sa défausse pour l’ajouter à sa main.${expert?' S’il le fait, il défausse ensuite 1 carte de sa main.':''} Remélangez le deck.`,`Each player may find an ally in their deck and discard pile and add it to their hand.${expert?' If they do, discard 1 card from hand.':''} Shuffle the deck.`],
    ['Chaque joueur met en jeu un soutien DAILY BUGLE qui n’a pas été retiré de la campagne.','Each player puts a DAILY BUGLE support not removed from the campaign into play.'],
  ];
  const failed:[string,string][]=[
    [expert?'Sonnez ET désorientez chaque identité.':'Chaque joueur choisit de sonner ou désorienter son identité.',expert?'Stun AND confuse every identity.':'Each player chooses to stun or confuse their identity.'],
    [`Chaque joueur cherche et révèle un attachement du deck Rencontre ; s’il ne peut pas, il reçoit une carte Rencontre face cachée.${expert?' Aucun attachement ne peut être défaussé du jeu pendant le premier round.':''} Remélangez.`,`Each player finds and reveals an attachment from the encounter deck; if unable, they receive a facedown encounter card.${expert?' Attachments cannot be discarded from play during round one.':''} Shuffle.`],
    [`Chaque joueur défausse ${expert?2:1} carte(s) de sa main.`,`Each player discards ${expert?2:1} card(s) from hand.`],
    [`Rassemblez les sbires du set L’Évasion du Raft.${expert?' Distribuez-en un au hasard à chaque joueur comme carte Rencontre face cachée.':''} Mélangez ${expert?'les autres':'ces sbires'} dans le deck Rencontre.`,`Gather the minions from The Raft Breakout set.${expert?' Deal one randomly to each player as a facedown encounter card.':''} Shuffle ${expert?'the rest':'them'} into the encounter deck.`],
    [`Chaque joueur reçoit ${expert?2:1} carte(s) Rencontre face cachée(s).`,`Deal each player ${expert?2:1} facedown encounter card(s).`],
  ];
  jobs.forEach((job,i)=>{ const won=flagOf(state,'acheve',job), lost=!won&&(flagOf(state,'echoue',job)||counterOf(state,counters[i]!)>=3); if(won||lost){const code=`${60205+i}${won?'a':'b'}`, effect=(won?completed:failed)[i]!;env.push([`Mettez {card:${code}} en jeu : ${effect[0]}`,`Put {card:${code}} into play: ${effect[1]}`]);}});
  if(flagOf(state,'confianceGagnee','')&&!flagOf(state,'maryVaincue','')) env.push(['Mettez {card:60210a} sous le contrôle du joueur de votre choix.','Put {card:60210a} under any player’s control.']);
  if(!env.length)env.push(['Aucun environnement de mission achevée ou échouée à ajouter pour le moment.','No completed or failed job environment to add yet.']);
  add('environments','Conséquences des missions précédentes','Previous job consequences',env,'mc60 · 9 · 12–13 / 60205–60210');
  const pressure=counterOf(state,counters[jobs.indexOf(id)]??''), p:[string,string][]=[];
  if(id==='s1_musee'&&pressure)p.push([`Ajoutez ${pressure*rate*n} menaces sur la manigance : ${pressure} marque(s) × ${rate} × ${n} joueur(s).`,`Add ${pressure*rate*n} threat to the main scheme: ${pressure} mark(s) × ${rate} × ${n} player(s).`]);
  if(id==='s2_poursuite'&&pressure)p.push([`Révélez {card:60131}.${pressure>=2?` Ajoutez ${rate*n} menaces en plus de ses menaces de révélation.`:''}`,`Reveal {card:60131}.${pressure>=2?` Add ${rate*n} threat beyond its reveal threat.`:''}`]);
  if(id==='s3_racket'&&pressure)p.push([`Ajoutez ${pressure*rate} menaces à CHAQUE manigance, sans multiplier par le nombre de joueurs.`,`Add ${pressure*rate} threat to EACH main scheme, without multiplying by player count.`]);
  if(id==='s4_raft'&&pressure)p.push([`Donnez Tenace à chaque PRISONNIER en jeu.${pressure>=2?' Donnez aussi une carte de boost face cachée à chacun.':''}`,`Give each PRISONER in play Tough.${pressure>=2?' Also give each one a facedown boost card.':''}`]);
  if(id==='s5_rotatives'&&pressure)p.push([`Retirez ${pressure} jeton(s) Endurance à chaque soutien DAILY BUGLE : il lui en reste ${3-pressure}.`,`Remove ${pressure} stamina counter(s) from each DAILY BUGLE support: ${3-pressure} remain.`]);
  if(id==='s6_caid'){ const count=Object.values(state.flags.acheve??{}).filter(Boolean).length;if(count>=3)p.push(['Donnez Tenace à chaque sbire en jeu.','Give each minion in play Tough.']);if(count>=4)p.push(['Cherchez et révélez {card:60165}.','Find and reveal {card:60165}.']); }
  if(!p.length)p.push(['Aucune pénalité supplémentaire du registre pour ce scénario.','No additional campaign-log penalty for this scenario.']);
  add('pressure','Appliquez la pression sur cette mission','Apply this job’s pressure',p,'mc60 · 13–23 · campaign setup');
  const reminders:[string,string][]=[];
  if(isMary)reminders.push(['À zéro PV, placez un jeton Dégât sur {card:60112} et rétablissez les PV de Mary. Vaincre {card:60113a} y ajoute un jeton Menace. Trois jetons au total font gagner ; deux jetons Menace établissent la confiance pour la campagne.','At zero HP, add a damage token to {card:60112} and reset Mary’s HP. Defeating {card:60113a} adds a threat token. Three tokens total win; two threat tokens establish trust for the campaign.']);
  if(id==='s6_caid')reminders.push([`Vaincre un sbire ajoute 1 Soutien sur {card:60163a}. À ${2*n+2} jetons au début d’une phase du Méchant, retournez le Caïd, avancez à {card:60162a}, résolvez sa révélation puis retournez le Soutien public. Le Caïd est invulnérable jusque-là.`,`Defeating a minion adds 1 support to {card:60163a}. At ${2*n+2} counters when a villain phase begins, flip Kingpin, advance to {card:60162a}, resolve its reveal, then flip Public Support. Kingpin is invulnerable until then.`]);
  if(id==='s3_racket')reminders.push(['Une seule manigance achevée ou un seul joueur éliminé fait perdre toute l’équipe. Chaque jeton Accélération ajoute 1 menace à chaque manigance.','Any completed main scheme or eliminated player loses the game for everyone. Each acceleration token adds 1 threat to each main scheme.']);
  if(id==='s5_rotatives')reminders.push(['Si un soutien DAILY BUGLE quitte le jeu, la partie est perdue. En alter ego, inclinez votre soutien avec {card:60152} pour lui rendre 1 Endurance.','If a DAILY BUGLE support leaves play, the game is lost. In alter ego, exhaust your support through {card:60152} to restore 1 stamina.']);
  reminders.push(['Vérifiez les compteurs de votre table avant de lancer le chrono. Les instructions précédentes se font une seule fois par partie, même si vous revenez dans le guide.','Check your table’s counters before starting the timer. Perform setup instructions once per game, even when revisiting the guide.']);
  add('ready','Prêts à jouer','Ready to play',reminders,'mc60 · scenario rules');
  return steps;
}
