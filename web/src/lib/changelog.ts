import type { Locale } from './types';

/**
 * What changed, release by release, for the home page.
 *
 * Written by hand, in both languages, one entry per day something shipped:
 * a generated list of commit titles would say "Settle the offer when a card
 * has no picture" to somebody who wants to know the draft no longer freezes.
 * Newest first; the home page shows the first entry whole and the rest
 * behind a fold. Dates are the day the change reached thwart.app.
 */
export interface ChangelogEntry {
  /** ISO date, the day it went live. */
  readonly date: string;
  readonly en: readonly string[];
  readonly fr: readonly string[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    date: '2026-09-24',
    en: [
      'Campaigns, redrawn after ArkhamCards’ campaign screens: each campaign is a card with the box’s picture, the heroes, the scenario to play, its difficulty and when it was last played.',
      'A page for each campaign: its scenarios as a strip of cards (beaten, to play, to come) with the time played, attempts, victory points and the community’s difficulty votes, the campaign’s totals, the heroes, the information and the settings.',
      'The scenario briefing reads as a guide, with the way in and the end of the scenario as comic panels.',
      'A recorded game no longer comes back when you return to Play: the game ends as soon as it is saved, and the Play tab offers a new one.',
      'Play again at the end of a game lays out the same scenario, difficulty, decks and modular sets, ready to change before you start.',
      'Draft or build a sealed deck straight from the Decks page; a game is offered as soon as the deck is saved.',
      'Fold deck folders on the Decks page, one at a time or all at once. This browser remembers which ones.',
      'The collection for a draft session is easier to adjust: grouped by box type, searchable, with plus and minus buttons, changed packs marked and a way back to your own collection. Packs added for the session bring their heroes too.',
      'On the achievements page, a switch shows everything, only the achievements or only the completion; tapping their card does the same.',
      'Install Thwart as an app on Android too: an Install button where Chrome, Edge or Samsung Internet allows it, and the menu steps for the other browsers.',
      'Ask to join the alpha of the Android app, from the home page or the More menu.',
      'A deck page remembers whether you read decks as a list or as a grid.',
      'The draft session collection has its own heading, so it is easier to find.',
    ],
    fr: [
      'Les campagnes, redessinées d’après les écrans de campagne d’ArkhamCards : chaque campagne est une carte avec l’image de la boîte, les héros, le scénario à jouer, sa difficulté et la date de la dernière partie.',
      'Une page par campagne : ses scénarios en bande de cartes (battus, à jouer, à venir) avec le temps de jeu, les tentatives, les points de victoire et la difficulté votée par la communauté, les totaux de la campagne, les héros, les informations et les paramètres.',
      'Le briefing d’un scénario se lit comme un guide, avec l’entrée et la fin du scénario en cases de bande dessinée.',
      'Une partie enregistrée ne revient plus quand vous retournez sur Jouer : la partie se termine dès qu’elle est enregistrée, et l’onglet Jouer en propose une nouvelle.',
      'Rejouer, à la fin d’une partie, remet en place le même scénario, la même difficulté, les mêmes decks et les mêmes sets modulaires, modifiables avant de commencer.',
      'Draftez ou construisez un deck scellé directement depuis la page Decks ; une partie vous est proposée dès que le deck est enregistré.',
      'Repliez les dossiers de la page Decks, un par un ou tous à la fois. Ce navigateur s’en souvient.',
      'La collection d’une session de draft se règle plus facilement : regroupée par type de boîte, avec une recherche, des boutons plus et moins, les packs modifiés signalés et un retour à votre collection. Les packs ajoutés pour la session apportent aussi leurs héros.',
      'Sur la page des succès, un sélecteur affiche tout, seulement les succès ou seulement la complétion ; toucher leur carte fait de même.',
      'Installez Thwart comme une application sur Android aussi : un bouton Installer là où Chrome, Edge ou Samsung Internet le permettent, et les étapes par le menu pour les autres navigateurs.',
      'Demandez à participer à l’alpha de l’application Android, depuis l’accueil ou le menu Plus.',
      'La page d’un deck se souvient si vous lisez les decks en liste ou en grille.',
      'La collection de la session de draft a son propre titre, pour la trouver plus facilement.',
    ],
  },
  {
    date: '2026-09-20',
    en: [
      'After draft or sealed, Random game opens the randomizer with your saved decks, heroes and aspects preserved.',
      'A Back button and browser history let you return to the saved-deck game choices, including after reloading the page.',
      'Own setup is now called Custom game throughout the interface.',
    ],
    fr: [
      'Après un draft ou un scellé, Partie aléatoire ouvre le générateur en conservant vos decks, héros et affinités.',
      'Le bouton Retour et le retour du navigateur retrouvent les choix de partie après les decks enregistrés, même après rechargement.',
      'Ma propre partie devient Partie personnalisée dans toute l’interface.',
    ],
  },
  {
    date: '2026-09-19',
    en: [
      'A shared Thwart look with warm surfaces and clearer contrast. Filter the achievement album to your own seat without changing unlocks.',
      'Import and view photos from Android backups, then export them again in a ZIP. Unknown backup fields are preserved.',
      'Achievement details show completed objectives, the actions still needed and remaining milestone counts, with named scenarios, heroes and aspects.',
      'Keep the selected Play shield and status icons readable in both light and dark themes.',
      'Tap an achievement or scenario sticker for its progress, milestones and victory details. Mobile navigation adds a central Play shield, a Progress tab and grouped shortcuts.',
      'Clearer setup links, compact mobile filters, encounter controls before the timer, and installation help for iPhone and iPad.',
      'Sync preserves conflict copies and BGG reporting, reports failed uploads, and stays off when switched off. Updates wait for open Thwart tabs to close.',
      'Achievements: a heroes-by-scenarios grid of what you have played and beaten, thirty-one named achievements and a completion rate over your collection, all read from your game history. On the Play hub, from the statistics, and said after a game that earns one.',
      'The card search moved to /cards; the home page took the root.',
    ],
    fr: [
      'Une identité Thwart commune, avec des surfaces chaleureuses et des contrastes renforcés. Filtrez les succès sur votre place sans modifier les déblocages.',
      'Importez et consultez les photos des sauvegardes Android, puis réexportez-les en ZIP. Les champs inconnus des sauvegardes sont conservés.',
      'Les détails des succès indiquent les objectifs accomplis, les actions restantes et les paliers à atteindre, avec les noms des scénarios, héros et affinités.',
      'Le bouclier Jouer sélectionné et les icônes d’état restent lisibles dans les thèmes clair et sombre.',
      'Touchez un succès ou une vignette de scénario pour voir sa progression, ses paliers et ses victoires. La navigation mobile ajoute un bouclier Jouer central, un onglet Succès et des raccourcis regroupés.',
      'Des liens de configuration plus clairs, des filtres compacts sur mobile, les commandes de rencontre avant le chronomètre et une aide à l’installation sur iPhone et iPad.',
      'La synchronisation préserve les copies en conflit et les envois BGG, signale les échecs d’envoi et reste désactivée à votre demande. Les mises à jour attendent la fermeture des onglets Thwart.',
      'Succès : une grille héros par scénarios de ce que vous avez joué et battu, trente et un succès nommés et un taux de complétion sur votre collection, le tout lu dans l’historique de vos parties. Sur l’onglet Jouer, depuis les statistiques, et annoncé après une partie qui en gagne un.',
      'La recherche de cartes a déménagé sur /cards ; la page d’accueil a pris la racine.',
    ],
  },
  {
    date: '2026-09-18',
    en: [
      'A home page: what is new, where everything is, and why an account is worth having.',
      'Fear No Evil outside its campaign: its five jobs and the Kingpin finale from the randomiser and from your own setup, with the villain drawn, the tracker and the setup text.',
      'The draft builds its packs before the first pick, one physical copy in one pack, and shuffles what is left into new packs when they run out.',
      'A card owned only as a reprint is offered as that printing, not as the original from a pack you do not have.',
      'Card pages say how many copies your collection holds, and from which packs.',
    ],
    fr: [
      'Une page d’accueil : les nouveautés, où tout se trouve, et pourquoi un compte vaut la peine.',
      'Peur de Rien hors campagne : ses cinq missions et la finale contre le Caïd depuis la partie aléatoire et votre propre partie, avec le méchant tiré, le suivi et la mise en place.',
      'Le draft construit ses paquets avant le premier choix, un exemplaire physique dans un seul paquet, et rebat ce qui reste en nouveaux paquets quand ils sont épuisés.',
      'Une carte possédée seulement en réimpression est proposée sous cette impression, pas sous l’originale d’une extension que vous n’avez pas.',
      'Les pages de cartes indiquent combien d’exemplaires votre collection contient, et de quelles extensions.',
    ],
  },
  {
    date: '2026-09-17',
    en: [
      'The history shows each game with its villain, and opening a game gives its rounds, the villain stage reached and the time played.',
      'Fear No Evil has its key art on the campaign shelf.',
      'One Play tab by default, gathering the random game, your own setup, the draft, the campaigns and versus.',
      'The draft shows the identities as their cards, with a search, and the table as a pack of cards beside your deck.',
      'Synergy: the deck editor says which cards your identity cannot play, and can hide them.',
      'Draft a deck one pick at a time from the cards you own, alone or up to four around one device.',
    ],
    fr: [
      'L’historique montre chaque partie avec son méchant, et ouvrir une partie donne ses tours, le stade du Méchant atteint et le temps de jeu.',
      'Peur de Rien a son illustration sur l’étagère des campagnes.',
      'Un seul onglet Jouer par défaut, qui regroupe la partie aléatoire, votre propre partie, le draft, les campagnes et le compétitif.',
      'Le draft montre les identités par leurs cartes, avec une recherche, et la table comme un paquet de cartes à côté de votre deck.',
      'Synergie : l’éditeur de deck dit quelles cartes votre identité ne peut pas jouer, et peut les masquer.',
      'Draftez un deck un choix à la fois parmi les cartes que vous possédez, seul ou jusqu’à quatre autour d’un appareil.',
    ],
  },
  {
    date: '2026-09-13',
    en: [
      'Each page and each language loads when first needed, so the first screen comes sooner.',
      'Sixty cards a page in the search, sorted the way a French or English reader expects.',
      'A mailbox in the footer, for bugs and words.',
    ],
    fr: [
      'Chaque page et chaque langue se charge quand on en a besoin, pour un premier écran plus rapide.',
      'Soixante cartes par page dans la recherche, triées comme un lecteur français ou anglais s’y attend.',
      'Une adresse en pied de page, pour les bugs et les mots.',
    ],
  },
  {
    date: '2026-09-12',
    en: [
      'Campaigns on tiles, each with its final villain and how it went.',
      'BoardGameGeek: sign in once and your games are logged there, as on the phone.',
      'Decks in folders, each deck on a page of its own, and the editor’s pool opened on the cards you own.',
      'Fear No Evil brought to the English rulebook.',
    ],
    fr: [
      'Les campagnes en tuiles, chacune avec son méchant final et son issue.',
      'BoardGameGeek : connectez-vous une fois et vos parties y sont enregistrées, comme sur le téléphone.',
      'Des decks en dossiers, chaque deck sur sa page, et la piscine de l’éditeur ouverte sur les cartes que vous possédez.',
      'Peur de Rien alignée sur le livret de règles anglais.',
    ],
  },
];

/** The lines of an entry in the reader's language. */
export const changelogLines = (entry: ChangelogEntry, locale: Locale): readonly string[] =>
  locale === 'fr' ? entry.fr : entry.en;
