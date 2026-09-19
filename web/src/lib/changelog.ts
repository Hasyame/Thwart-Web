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
    date: '2026-09-19',
    en: [
      'Achievement details show completed objectives, the actions still needed and remaining milestone counts, with named scenarios, heroes and aspects.',
      'Keep the selected Play shield and status icons readable in both light and dark themes.',
      'Tap an achievement or scenario sticker for its progress, milestones and victory details. Mobile navigation adds a central Play shield, a Progress tab and grouped shortcuts.',
      'Clearer setup links, compact mobile filters, encounter controls before the timer, and installation help for iPhone and iPad.',
      'Sync preserves conflict copies and BGG reporting, reports failed uploads, and stays off when switched off. Updates wait for open Thwart tabs to close.',
      'Achievements: a heroes-by-scenarios grid of what you have played and beaten, thirty-one named achievements and a completion rate over your collection, all read from your game history. On the Play hub, from the statistics, and said after a game that earns one.',
      'The card search moved to /cards; the home page took the root.',
    ],
    fr: [
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
