import type { Locale } from '../types';

export const APOCALYPSE_PRELATES = ['45179b', '45180b', '45181b', '45182b', '45183b'] as const;
export const APOCALYPSE_PRELATE_DRAW = 'apocalypsePrelate';
export interface ApocalypseGuideStep { title: string; lines: readonly string[]; source: string }

/** Original instructions in v1.8 order, with card links rather than copied card text. */
export function apocalypseGuide(locale: Locale, players: number, expert: boolean, campaignExpert: boolean): readonly ApocalypseGuideStep[] {
  const fr = locale === 'fr';
  const n = Math.max(1, players), printed = expert ? 10 : 9, hp = printed * n;
  const card = expert ? '45102a' : '45101b', stage = expert ? 'III' : 'II';
  const step = (title: string, enTitle: string, lines: string[], enLines: string[], source: string): ApocalypseGuideStep => ({title: fr ? title : enTitle, lines: fr ? lines : enLines, source});
  return [
    step('Installez vos héros', 'Set up your heroes', [
      'Posez chaque identité devant son joueur, face alter ego visible. Réglez ses PV sur sa valeur de départ. Les blessures de campagne experte seront appliquées après la mission.',
      'Choisissez le premier joueur et donnez-lui le jeton Premier joueur. Sortez les obligations pour le deck Rencontre et mettez les sets Némésis à part.',
      'Préparez et mélangez les decks Joueur avec les récompenses conservées. Rassemblez les jetons Dégât, Menace, Accélération et les états Sonné, Désorienté et Tenace. Ne piochez pas encore.'
    ], [
      'Place each identity in front of its player, alter-ego side up. Set its dial to its starting hit points. Expert campaign damage is applied after the mission is set up.',
      'Choose the first player and give them the first-player token. Set obligations aside for the encounter deck, and keep nemesis sets aside separately.',
      'Prepare and shuffle player decks, including retained rewards. Gather damage, threat and acceleration tokens and stunned, confused and tough status cards. Do not draw your opening hand yet.'
    ], 'Rules Reference v1.8 · 51 · 1–7'),
    step('Placez Apocalypse', 'Place Apocalypse', [
      `Posez {card:${card}} au stade ${stage}, face visible. Gardez les autres stades à portée de main.`,
      `Posez {card:45103a} à côté, face 1A visible. Réglez Apocalypse sur ${hp} PV : ${printed} × ${n} joueurs.`
    ], [
      `Place {card:${card}} stage ${stage} face up. Keep the other stages within reach.`,
      `Place {card:45103a} beside him, side 1A up. Set Apocalypse to ${hp} hit points: ${printed} × ${n} players.`
    ], 'v1.8 · 51 · 8–9 / AoA · 14'),
    step('Constituez le deck Rencontre', 'Build the encounter deck', [
      'Rassemblez tous les exemplaires des cartes Rencontre des sets affichés ci-dessous. Les méchants et la manigance principale restent hors du deck.',
      'Ajoutez les obligations des identités et mélangez. Gardez de la place pour la défausse. En scénario Expert, le set Expert s’ajoute au set Standard : il ne le remplace pas.',
      'Le set de campagne L’Ère d’Apocalypse sera ajouté à l’étape des instructions de campagne.'
    ], [
      'Gather every copy of the encounter cards in the sets below. Keep villain and main-scheme cards outside the deck.',
      'Add the identities’ obligations and shuffle. Leave room for a discard pile. In Expert scenario mode, add the Expert set alongside Standard; it does not replace it.',
      'Add the Age of Apocalypse campaign set later, during campaign instructions.'
    ], 'v1.8 · 51 · 10 / AoA · 14'),
    step('Installez les cartes de départ', 'Put setup cards into play', [
      'Sortez {card:45071} du deck Rencontre et mettez-la en jeu. Placez 4 menaces au total dessus, sans multiplier par le nombre de joueurs.',
      'Cette manigance est permanente : elle reste en jeu même à zéro menace. Pendant la partie, ajoutez-y 3 menaces lorsqu’un allié est vaincu autrement que par des dégâts consécutifs.',
      'Mettez également en jeu les autres cartes portant le mot-clé Mise en place dans vos decks. Les capacités « Mise en place » des identités attendent la fin de la préparation.'
    ], [
      'Find {card:45071} in the encounter deck and put it into play with 4 threat total, without multiplying by the number of players.',
      'This scheme is permanent: it stays in play even at zero threat. During the game, add 3 threat whenever an ally is defeated by anything other than consequential damage.',
      'Also put into play other cards with the Setup keyword in your decks. Identity Setup abilities wait until the end of preparation.'
    ], 'v1.8 · 51 · 11 / 45071'),
    step('Préparez les cartes mises de côté', 'Prepare the set-aside cards', [
      'Mettez de côté les stades d’Apocalypse inutilisés, les cinq sbires PRÉLAT et {card:45105a}, dont le verso est {card:45105b}.',
      'Les Prélats sont les faces B de {card:45179b}, {card:45180b}, {card:45181b}, {card:45182b} et {card:45183b}. Le retrait d’un Hiérarque du registre n’interdit pas son verso Prélat.'
    ], [
      'Set aside unused Apocalypse stages, all five PRELATE minions and {card:45105a}, whose reverse is {card:45105b}.',
      'The Prelates are the B sides: {card:45179b}, {card:45180b}, {card:45181b}, {card:45182b} and {card:45183b}. Removing an Overseer from the campaign log does not remove its Prelate side.'
    ], 'v1.8 · 51 · 12 / 45103A / AoA · 14'),
    step('Révélez Cœur de l’Empire', 'Reveal Heart of the Empire', [
      'Sortez {card:45104a} du deck Rencontre et révélez-la avec 2 menaces au total, quel que soit le nombre de joueurs.',
      'Son icône Accélération ajoute 1 menace à la manigance principale à chaque début de phase du Méchant. Cette accélération initiale est comprise dans le tracker.',
      'Aucune menace ne peut être retirée de cette manigance annexe tant qu’un PRÉLAT est en jeu. Il faudra d’abord éliminer le Prélat.'
    ], [
      'Find {card:45104a} in the encounter deck and reveal it with 2 threat total, regardless of player count.',
      'Its acceleration icon adds 1 threat to the main scheme at the start of each villain phase. The tracker includes this initial acceleration.',
      'Threat cannot be removed from this side scheme while a PRELATE is in play. Defeat the Prelate first.'
    ], '45103A / 45104A'),
    step('Révélez le premier Prélat', 'Reveal the first Prelate', [
      'Le premier joueur révèle un Prélat aléatoire mis de côté. Utilisez le tirage ci-dessous, ou indiquez celui que vous avez déjà tiré sur votre table.',
      `Placez ce sbire devant le premier joueur, engagé avec lui, avec ${5*n} PV (5 par joueur). Donnez-lui un état Tenace : il ignore la prochaine occurrence de dégâts, puis défausse cet état.`,
      'Laissez les quatre autres Prélats de côté. Revenir à cette étape ne relance pas le tirage.'
    ], [
      'The first player reveals a random set-aside Prelate. Use the draw below, or record the one already drawn on your physical table.',
      `Place that minion engaged with the first player, with ${5*n} hit points (5 per player). Give it a tough status card: it prevents the next instance of damage, then is discarded.`,
      'Keep the other four Prelates aside. Revisiting this step does not repeat the draw.'
    ], '45103A / 45179B–45183B'),
    step('Terminez la mise en place du scénario', 'Finish scenario setup', [
      `Remélangez le deck Rencontre après les recherches. Retournez {card:45103b} sur 1B et placez ${n} menaces dessus (1 par joueur). Son seuil est ${hp} menaces.`,
      'Apocalypse a Ténacité : donnez-lui un état Tenace. Il ignore la prochaine occurrence de dégâts, puis défausse cet état.',
      'Apocalypse est Solide : il faut deux états Sonné pour le sonner, ou deux états Désorienté pour le désorienter. Défaussez les deux états quand leur effet remplace son activation.',
      `Il n’a pas d’autre effet de révélation à résoudre sur ce stade initial. Le premier début de phase du Méchant ajoute ${n+1} menaces : ${n} de progression normale, plus 1 pour {card:45104a}.`
    ], [
      `Shuffle the encounter deck after searching it. Turn {card:45103b} to 1B with ${n} starting threat (1 per player). Its threshold is ${hp} threat.`,
      'Apocalypse has Toughness: give him a tough status card. It prevents the next instance of damage, then is discarded.',
      'Apocalypse is Steady: two stunned cards are needed to stun him, or two confused cards to confuse him. Discard both when their effect replaces his activation.',
      `There is no other reveal effect on this starting stage. The first villain phase adds ${n+1} threat: ${n} printed growth plus 1 from {card:45104a}.`
    ], 'v1.8 · 51 · 12 / 45103B / Apocalypse II–III'),
    step('Appliquez votre registre', 'Apply your campaign log', [
      'Mélangez tous les exemplaires de {card:45164} et {card:45165} dans le deck Rencontre : ils composent le set de campagne L’Ère d’Apocalypse.',
      'Appliquez les conséquences de vos parties précédentes affichées ci-dessous. Les cartes retirées restent retirées ; conservez les récompenses autorisées. Remélangez chaque deck modifié.'
    ], [
      'Shuffle every copy of {card:45164} and {card:45165} into the encounter deck: these form the Age of Apocalypse campaign set.',
      'Apply the consequences of previous games shown below. Removed cards remain removed; retain eligible rewards. Shuffle each modified deck.'
    ], 'v1.8 · 51 · 13 / AoA · 14, 24'),
    step('Installez votre mission', 'Set up your mission', [
      `Posez {mission} dans une zone distincte de celle des méchants, avec ${5*n} menaces (5 par joueur). Le tirage exclut les missions déjà tentées. Appliquez ensuite sa préparation particulière ci-dessous.`,
      `Placez {overseer} dans cette zone, face HIÉRARQUE visible, avec ${5*n} PV. Posez la carte Règles de Mission à côté. Donnez {card:45171a} au premier joueur, face Mission visible.`,
      'Les héros ne peuvent pas contrer normalement cette mission. Équipe de Mission permet d’y envoyer des alliés et d’effectuer des tentatives. Si le Prélat en jeu partage la carte du Hiérarque, représentez une de ces deux faces avec un substitut et son compteur distinct.'
    ], [
      `Place {mission} in a separate mission area with ${5*n} threat (5 per player). Previously attempted missions are excluded from the draw. Follow its specific setup below.`,
      `Place {overseer} there, OVERSEER side up, with ${5*n} hit points. Put the Mission Rules card beside it. Give {card:45171a} to the first player, Mission side up.`,
      'Heroes cannot thwart this mission normally. Mission Team sends allies to the mission and enables attempts. If the active Prelate shares the Overseer’s physical card, represent one side with a substitute and a separate dial.'
    ], 'AoA · 14, 24'),
    step('Choisissez vos alliés de départ', 'Choose your opening allies', [
      `Chaque joueur cherche un allié dans son propre deck.${campaignExpert?' Il doit partager au moins un trait avec son héros.':''} Ajoutez-le à sa main et remélangez son deck.`,
      'Cet allié ne commence pas gratuitement en jeu. Il compte dans la taille de main : pour une main de 6 avec cet allié, piochez ensuite seulement 5 autres cartes.'
    ], [
      `Each player searches their own deck for an ally.${campaignExpert?' It must share at least one trait with their hero.':''} Add it to their hand and shuffle their deck.`,
      'The ally does not enter play for free. It counts toward hand size: with a hand size of 6 and this ally, draw only 5 more cards later.'
    ], 'AoA · 14, 20'),
    step('Réglez les blessures', 'Apply campaign damage', [campaignExpert
      ? 'Reprenez les PV conservés après le scénario précédent. Chaque joueur peut se soigner entièrement en ajoutant 3 menaces à la mission, une seule fois. Un joueur éliminé doit utiliser ce soin pour revenir. Les boutons ci-dessous enregistrent le soin et calculent son coût.'
      : 'En campagne Standard, les blessures précédentes ne persistent pas. Chaque identité commence avec ses PV de départ, sauf effet particulier. Aucun coût de soin expert n’est ajouté.'
    ], [campaignExpert
      ? 'Restore the remaining hit points recorded after the previous scenario. Each player may heal to full once by adding 3 threat to the mission. An eliminated player must use this heal to rejoin. The controls below record healing and calculate its cost.'
      : 'In Standard campaign mode, previous damage does not persist. Each identity starts at its starting hit points unless another effect applies. No expert healing cost is added.'
    ], 'AoA · 14, 20'),
    step('Piochez et faites votre mulligan', 'Draw and mulligan', [
      'Complétez chaque main jusqu’à la taille de main de l’alter ego, en comptant l’allié déjà choisi et les éventuels modificateurs.',
      'Pour le mulligan, défaussez les cartes à remplacer, puis piochez pour compléter votre main. Ne remélangez pas les cartes défaussées dans le deck.',
      'Résolvez maintenant les capacités « Mise en place » des cartes Joueur en jeu, dont les identités. La partie commencera par le tour du premier joueur dans la phase des Joueurs.'
    ], [
      'Fill each hand to the alter-ego hand size, counting the chosen ally and any modifiers.',
      'For the mulligan, discard cards to replace and draw back to hand size. Do not shuffle those discards into the deck.',
      'Now resolve Setup abilities on player cards in play, including identities. Play begins with the first player’s turn in the player phase.'
    ], 'v1.8 · 51 · 14–16'),
    step('Votre objectif', 'Your objective', [
      'Éliminez les Prélats pour retirer les menaces de {card:45104a}, puis {card:45104b} (3 menaces au total), puis {card:45105a} (4 menaces au total). Leurs accélérations respectives sont +1, +2 et +3 : ajustez le total dans le tracker lorsque ces cartes changent.',
      'Chaque manigance annexe déjouée de ce parcours fait révéler un Prélat aléatoire mis de côté au premier joueur et attribuer une carte Rencontre à chaque autre joueur, à révéler au moment habituel. Après le Cœur, retournez sur la Citadelle ; après la Citadelle, retirez-la et révélez le Trône.',
      `Après le Trône, retournez-le sur {card:45105b} et attachez-le à Apocalypse : soignez-le de ${5*n} PV. Il ne peut plus subir de dégâts tant qu’un Prélat est en jeu. Éliminez ce Prélat, puis Apocalypse pour gagner.`,
      `Sans cet attachement, zéro PV fait régénérer Apocalypse : défaussez ses attachements, soignez tous ses dégâts et retirez ${printed} menaces de la manigance principale, sans multiplier ce retrait par les joueurs. Son stade reste le même.`,
      'Atteindre le seuil de la manigance principale retire toute sa menace et révèle le stade suivant d’Apocalypse. Au stade IV, son achèvement fait perdre la partie.'
    ], [
      'Defeat Prelates to remove threat from {card:45104a}, then {card:45104b} (3 threat total), then {card:45105a} (4 threat total). Their acceleration icons add +1, +2 and +3 respectively: adjust the tracker total when these cards change.',
      'Defeating each side scheme in this sequence makes the first player reveal a random set-aside Prelate and deals an encounter card to every other player, to reveal at the usual time. Flip Heart to Citadel; after Citadel, remove it and reveal Throne.',
      `After Throne, flip it to {card:45105b} and attach it to Apocalypse, healing ${5*n} hit points. He cannot take damage while a Prelate is in play. Defeat that Prelate, then Apocalypse to win.`,
      `Without that attachment, zero hit points triggers regeneration: discard his attachments, heal all damage and remove ${printed} threat from the main scheme, without multiplying that removal by players. Keep the same villain stage.`,
      'Completing the main scheme removes all its threat and reveals Apocalypse’s next stage. Completing it at stage IV loses the game.'
    ], 'AoA · 14 / 45103–45105')
  ];
}
