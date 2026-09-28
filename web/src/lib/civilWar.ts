import type { Card, Locale } from './types';

/** Original summaries and recipes from mc56 pp. 3–8, 14–17. No campaign is invented. */
export const CIVIL_WAR = {
  iron_man_leader: {side:'registration', schemes:['56063b','56064b'], modules:['mighty_avengers','the_initiative','maria_hill_modular','dangerous_recruits'], reserve:['56065','56066','56067','56068','56069'], sideScheme:'56072'},
  captain_marvel_leader: {side:'registration', schemes:['56096b','56097b'], modules:['cape_killer','martial_law','heroes_for_hire','paladin'], reserve:['56098'], sideScheme:'56104'},
  captain_america_leader: {side:'resistance', schemes:['56141b','56142b'], modules:['new_avengers','secret_avengers','namor_modular','atlanteans'], reserve:['56143'], sideScheme:'56149'},
  spider_woman_leader: {side:'resistance', schemes:['56172b','56173b'], modules:['spider_man_modular','defenders','hells_kitchen','cloak_and_dagger_modular'], reserve:['56174'], sideScheme:'56179'},
} as const;
export type CivilLeader = keyof typeof CIVIL_WAR;
export const isCivilLeader = (id:string):id is CivilLeader => Object.hasOwn(CIVIL_WAR,id);
export const civilModules = (side:string):readonly string[] => Object.values(CIVIL_WAR).filter(x=>x.side===side).flatMap(x=>[...x.modules]);
export function civilSchemeRule(locale:Locale,code:string,n:number):string {
  const minions=[`Révélation : cherchez ${n} sbire(s) dans le deck Rencontre, puis distribuez-en un face cachée à chaque joueur. Ne les révélez pas maintenant.`,`When revealed: find ${n} minion(s) in the encounter deck and deal one facedown to each player. Do not reveal them now.`];
  const treachery=['Chaque joueur qui révèle une traîtrise ajoute 1 menace ici, une fois par phase pour chacun.','Each player revealing a treachery adds 1 threat here, once per phase for each player.'];
  const guards=['Tous les sbires gagnent Garde.','Every minion gains Guard.'];
  const sideSchemes=[`Révélation : cherchez ${n} manigance(s) annexe(s) dans le deck et la défausse Rencontre ; distribuez-en une face cachée à chaque joueur.`,`When revealed: find ${n} side scheme(s) in the encounter deck and discard pile; deal one facedown to each player.`];
  const rules:Record<string,string[]>={
    '56063b':treachery,'56096b':minions,'56121b':guards,'56122b':['Après l’ajout de menace en début de phase Méchant, chaque joueur défausse les 3 premières cartes de son deck.','After start-of-villain-phase threat, each player discards the top 3 cards of their deck.'],
    '56141b':minions,'56172b':treachery,'56199b':guards,'56200b':['Le leader ennemi gagne Résolu.','The enemy leader gains Steady.'],
    '56064b':['Chaque allié vaincu par une attaque ennemie est placé face cachée sous cette manigance. Réduisez sa limite de 1 par carte ainsi placée.','Put each ally defeated by an enemy attack facedown underneath. Reduce the limit by 1 per card underneath.'],
    '56097b':['Les héros gagnent Non Recensé. Chaque autre carte révélée qui leur donne ce trait inflige 2 dégâts aux héros concernés.','Heroes gain Unregistered. Each other revealed card giving them this trait deals 2 damage to those heroes.'],
    '56123b':sideSchemes,'56124b':['Les alliés entrent en jeu inclinés.','Allies enter play exhausted.'],
    '56142b':['Le leader ennemi gagne +1 ATQ pendant ses attaques, ou +2 ATQ si l’attaque n’est pas défendue.','The enemy leader gets +1 ATK while attacking, or +2 ATK if undefended.'],
    '56173b':sideSchemes,'56201b':['Chaque carte d’état placée sur le leader ennemi ajoute 1 menace ici.','Each status card placed on the enemy leader adds 1 threat here.'],
    '56202b':['Après l’ajout de menace en début de phase Méchant, chacun défausse la première carte Rencontre. Si c’est un sbire, il le met en jeu engagé avec lui.','After start-of-villain-phase threat, each player discards the top encounter card. If it is a minion, put it into play engaged with that player.'],
  };
  return rules[code]?.[locale==='fr'?0:1]??'';
}
export interface CivilStep {title:string; lines:string[]; cards:string[]}

export function civilGuide(locale:Locale, leader:CivilLeader, players:number, expert:boolean, competitive:boolean, schemes:readonly string[]=CIVIL_WAR[leader].schemes):CivilStep[] {
  const fr=locale==='fr', n=players, spec=CIVIL_WAR[leader];
  const s=(a:string,b:string)=>fr?a:b;
  const result:CivilStep[]=[];
  const add=(a:string,b:string,lines:string[],cards:readonly string[]=[])=>result.push({title:s(a,b),lines,cards:[...cards]});
  add('Le format et les équipes','Format and teams',[
    s(competitive?'Jouez à 1 contre 1 ou 2 contre 2. Une équipe représente le Recensement, l’autre la Résistance. Asseyez-vous face à face.':'Ce scénario indépendant se joue en solo ou en coopération, à 1–4 joueurs. Il ne fait pas partie d’une campagne officielle.',competitive?'Play 1v1 or 2v2. One team is Registration, the other Resistance. Sit opposite each other.':'This standalone scenario supports 1–4 cooperative players, including solo. It is not an official campaign.'),
    s(competitive?'Aucun joueur ne peut choisir une identité du même titre que le leader de sa propre équipe. Les cartes uniques sont vérifiées seulement entre les cartes Joueur de la même équipe.':'Le leader remplace le méchant. « Équipe ennemie » désigne les joueurs : faites les choix les plus défavorables. Les effets visant « votre leader » ne se résolvent pas ; appliquez le reste de la capacité.',competitive?'No player may use an identity with the same title as their own team’s leader. Uniqueness is checked only among player cards on the same team.':'The leader replaces the villain. “Enemy team” means the players: make the least favourable choices. Effects targeting “your leader” cannot resolve; apply the rest of the ability.'),
  ]);
  add('Les joueurs','Players',[
    s('Posez les identités face alter ego et leurs PV de départ. Préparez les decks, les jetons et les états. Mettez les obligations de côté et les sets Némésis en réserve. Ne piochez pas encore.','Place identities alter-ego side up and set their starting HP. Prepare decks, tokens and status cards. Set obligations aside and reserve nemesis sets. Do not draw yet.'),
    s(competitive?'Chaque équipe choisit son premier joueur et reçoit son propre marqueur.':'Choisissez le premier joueur.',competitive?'Each team chooses a first player and takes its own first-player marker.':'Choose the first player.'),
  ]);
  add('Le deck Rencontre','Encounter deck',[
    s('Rassemblez les 10 cartes Rencontre du leader et tous les exemplaires des sets modulaires choisis. Gardez les leaders et manigances principales hors du deck.','Gather the leader’s 10 encounter cards and every copy in the chosen modular sets. Keep leaders and main schemes outside the deck.'),
    s(competitive?'Prenez 3 ou 4 sets du même camp que ce leader, ainsi que Standard JcJ de ce camp. Ne mélangez pas les camps et n’ajoutez pas Standard/Expert ordinaires. Réservez les quatre cartes Joueur de base du leader pour son équipe.':'Ajoutez le set Standard choisi et les obligations des identités. Civil War utilise III et IV en Expert ; ses instructions de composition ne demandent pas d’ajouter le set Expert ordinaire.',competitive?'Take 3 or 4 modular sets from this leader’s side and that side’s Standard PvP set. Do not mix sides or add ordinary Standard/Expert sets. Reserve the leader’s four basic player cards for their team.':'Add the selected Standard set and identity obligations. Civil War uses III and IV in Expert; its deck instructions do not call for the ordinary Expert set.'),
    ...(competitive?[s('Échangez les scénarios : chaque équipe affronte le leader, les manigances et le deck préparés par l’équipe adverse. Ajoutez les obligations des joueurs qui les affrontent.','Exchange scenarios: each team faces the leader, schemes and deck prepared by its opponents. Add obligations belonging to the players facing them.')]:[]),
    s('Mélangez le deck Rencontre et laissez une place pour sa défausse.','Shuffle the encounter deck and leave space for its discard pile.'),
  ]);
  add('Les stades du leader','Leader stages',[
    s(`Utilisez les stades ${expert?'III puis IV':'I puis II'}, dans cet ordre. Mettez les deux autres stades de côté. Le compteur est calculé pour ${n} joueur(s) affrontant ce leader.`,`Use stages ${expert?'III then IV':'I then II'}, in that order. Set the other two stages aside. The counter is scaled for ${n} player(s) facing this leader.`),
    s('Les PV et les cartes des stades sont indiqués ci-dessous. Résolvez les instructions « Mise en place » à l’étape suivante ; les effets « Une fois révélée » viendront après la manigance.','Stage cards and HP are shown below. Resolve Setup instructions in the next step; When Revealed effects follow the main scheme.'),
  ]);
  const iron=leader==='iron_man_leader';
  add('Les instructions du leader','Leader setup',[
    iron?s(expert?'Iron Man III a un effet de révélation : attendez l’étape « Révélez le leader ».':'Pour Iron Man I, l’équipe ennemie choisit un de ses attachements dans le deck Rencontre ; révélez-le et résolvez son texte. En coopération, choisissez le plus défavorable.',expert?'Iron Man III has a When Revealed effect: wait for the Reveal the leader step.':'For Iron Man I, the enemy team chooses one of his attachments in the encounter deck; reveal it and resolve its text. In cooperation, choose the least favourable one.'):
      s('Trouvez l’attachement indiqué ci-dessous et attachez-le au leader. Captain America reçoit aussi Tenace lorsque son bouclier lui est attaché. Les compteurs Énergie/Compétence commencent à zéro.','Find the attachment below and attach it to the leader. Captain America also receives Tough when his shield is attached. Energy/skill counters start at zero.'),
    s('Mélangez le deck après une recherche. Les effets sont à résoudre sur les cartes physiques ; consulter le guide ne les répète pas.','Shuffle the deck after a search. Resolve effects on the physical cards; browsing the guide does not repeat them.'),
  ],spec.reserve);
  add('La manigance principale','Main scheme',[
    s(`Posez le stade 1A sur le stade 2A. Révélez ${competitive?'Choisir son Camp':'la manigance annexe du leader'} puis retournez 1A en 1B.`,`Place stage 1A above stage 2A. Reveal ${competitive?'Choosing Sides':'the leader’s side scheme'}, then flip 1A to 1B.`),
    s(`Commencez avec ${n>1?2*n:0} menaces sur 1B : Entrave 2 par joueur s’applique seulement à plusieurs joueurs. Le seuil initial est ${7*n}.`,`Start 1B with ${n>1?2*n:0} threat: Hinder 2 per player applies only with multiple players. The initial threshold is ${7*n}.`),
    s('Résolvez ensuite son effet de révélation ci-dessous. Pour « Rassembler des soutiens » ou « Recrues du S.H.I.E.L.D. », l’équipe ennemie cherche un sbire par joueur et en distribue un à chacun, face cachée, sans le révéler maintenant.','Then resolve its When Revealed effect below. For Gathering Support or S.H.I.E.L.D. Recruits, the enemy team finds one minion per player and deals one facedown to each, without revealing it now.'),
  ],[schemes[0]!,competitive?(spec.side==='registration'?'56128a':'56206a'):spec.sideScheme]);
  result[result.length-1]!.lines.push(civilSchemeRule(locale,schemes[0]!,n));
  add('Révélez le leader','Reveal the leader',[
    s(iron&&expert?'Iron Man III : l’équipe ennemie choisit un attachement Iron Man dans le deck ; révélez-le, appliquez son texte, puis mélangez.':'Le stade initial choisi n’a pas d’effet « Une fois révélée » supplémentaire. Ne répétez pas sa mise en place.',iron&&expert?'Iron Man III: the enemy team chooses an Iron Man attachment in the deck; reveal it, apply its text, then shuffle.':'The chosen starting stage has no additional When Revealed effect. Do not repeat its setup.'),
  ],iron&&expert?spec.reserve:[]);
  add('La main de départ','Opening hand',[
    s('Chaque joueur mélange son deck et pioche jusqu’à sa taille de main alter ego. Il peut défausser les cartes de son choix, repiocher autant, puis remélanger ces cartes défaussées dans son deck. Résolvez enfin les capacités de mise en place des joueurs.','Each player shuffles their deck and draws to their alter-ego hand size. They may discard chosen cards, draw replacements, then shuffle those discards back into their deck. Finally resolve player setup abilities.'),
  ]);
  add('Pendant la partie','During play',[
    s('Au stade II ou IV, distribuez une carte Rencontre à chaque joueur : le leader ne peut subir aucun dégât pendant cette phase et gagne Résolu. Ne continuez pas vers III après II : II termine la partie Standard.','At stage II or IV, deal each player an encounter card: the leader cannot take damage during this phase and gains Steady. Do not advance to III after II: II ends the Standard game.'),
    s('À la limite de menace, résolvez le stade 2 et son texte ci-dessous. Sa limite atteinte fait perdre les joueurs qui l’affrontent. La Prison de la Zone Négative réduit sa limite de 1 par allié placé sous elle : ajustez le maximum du compteur.','At the threat threshold, resolve stage 2 and its text below. Reaching its limit defeats the players facing it. Negative Zone Prison reduces its limit by 1 per ally underneath: adjust the tracker maximum.'),
  ],[schemes[1]!]);
  result[result.length-1]!.lines.push(civilSchemeRule(locale,schemes[1]!,n));
  if(competitive) {
    add('L’ordre des phases','Phase order',[
      s('Héros Recensement → Héros Résistance → Méchant Recensement → Méchant Résistance. Terminez chaque phase Héros, y compris redressement et nouvelle main, avant de passer la main. L’autre équipe observe sans agir.','Registration heroes → Resistance heroes → Registration villain → Resistance villain. Finish each hero phase, including readying and refilling hands, before handing over. The other team observes without acting.'),
      s('Ajoutez la menace au début de chaque phase Méchant, puis résolvez les activations, les cartes Rencontre dans leur ordre de distribution et les effets de fin de phase. En 2 contre 2, passez le premier joueur de cette équipe à la fin de sa phase Méchant.','Add threat at the start of each villain phase, then resolve activations, encounter cards in dealt order and end-of-phase effects. In 2v2, pass that team’s first-player marker after its villain phase.'),
    ]);
    add('Choisir son camp et attaques entre leaders','Choosing Sides and leader attacks',[
      s(`Choisir son Camp commence à ${4*n} menaces. Sur sa face A, chaque attaque inflige au plus 2 dégâts au leader ennemi. À zéro, les adversaires choisissent ${n} carte(s) parmi les 5 premières du deck Rencontre et en distribuent une à chacun, puis retournez la carte. Appliquez sa face B pour gagner les cartes de base : chaque joueur gagne deux cartes de son propre leader, qui intègrent son deck pour cette partie.`,`Choosing Sides starts with ${4*n} threat. On side A, each attack deals at most 2 damage to the enemy leader. At zero, opponents choose ${n} card(s) from the top 5 encounter cards and deal one to each player, then flip the card. Apply side B to earn the basic cards: each player earns two cards of their own leader, which join their deck for this game.`),
      s('Une attaque entre leaders ignore Garde et ne permet aucun défenseur joueur. Donnez une carte de boost à l’attaquant ; le premier joueur de l’équipe du leader défenseur la révèle et résout ses effets. Défaussez-la, puis infligez l’ATQ totale. Les autres effets ignorent l’autre table sauf mention explicite.','A leader-to-leader attack ignores Guard and allows no player defender. Give the attacker a boost card; the defending leader’s first player reveals and resolves it. Discard it, then deal total ATK. Other effects ignore the opposite table unless explicitly stated.'),
    ],[spec.side==='registration'?'56128a':'56206a',spec.side==='registration'?'56128b':'56206b']);
    add('La victoire et les égalités','Victory and ties',[
      s('Gagnez en battant le leader ennemi, ou si votre leader termine sa manigance 2B ou élimine tous les héros adverses. Attendez que les équipes aient joué le même nombre de phases. Si le Recensement termine en premier, la Résistance joue sa phase correspondante ; le leader vaincu reste ciblable jusque-là.','Win by defeating the enemy leader, or if your leader completes scheme 2B or defeats all opposing heroes. Wait until both teams have played equal numbers of phases. If Registration finishes first, Resistance plays its matching phase; the defeated leader remains targetable until then.'),
      s('Si les deux équipes perdent, c’est une double défaite. Si elles battent toutes deux leur leader ennemi, c’est une égalité. Départagez dans cet ordre : manigance restée en 1B ; moins de sbires et manigances annexes ; moins de menace principale ; plus de PV d’identités ; moins d’attachements sur le leader affronté.','If both teams lose, both lose. If both defeat their enemy leader, it is a tie. Break ties in order: scheme still on 1B; fewer minions plus side schemes; less main-scheme threat; more remaining identity HP; fewer attachments on the faced leader.'),
    ]);
  }
  return result;
}

export function civilCards(cards:readonly Card[],leader:CivilLeader,schemeCodes:readonly string[]=CIVIL_WAR[leader].schemes):Card[] {
  return cards.filter(c=>c.card_set_code===leader||schemeCodes.includes(c.code));
}
