import type { Locale } from './types';

/**
 * User-interface strings, in the two languages the app supports.
 *
 * A typed dictionary rather than an i18n framework. With two languages, no
 * pluralisation worth the name and no runtime locale loading, a framework
 * would add a build step and a lookup indirection to buy nothing — whereas
 * this gets a compile error the moment a key is missing from either language,
 * which is the only guarantee that actually matters here.
 *
 * Note that the **interface language and the card language are separate**.
 * That is deliberate and inherited from the app, where `AppPreferences` says
 * so outright: reading a card in English while the interface is in French is a
 * stated requirement, not an accident.
 */
export interface Strings {
  readonly appName: string;
  readonly tagline: string;
  readonly searchPlaceholder: string;
  readonly searchLabel: string;
  readonly interfaceLanguage: string;
  readonly cardLanguage: string;
  readonly theme: string;
  readonly themeSystem: string;
  readonly themeLight: string;
  readonly themeDark: string;
  readonly allTypes: string;
  readonly allFactions: string;
  readonly allPacks: string;
  readonly loading: string;
  readonly loadError: string;
  readonly retry: string;
  readonly noResults: string;
  readonly noResultsHint: string;
  readonly resultCount: (shown: number, total: number) => string;
  readonly back: string;
  readonly cardNotFound: string;
  readonly traits: string;
  readonly illustrator: string;
  readonly pack: string;
  readonly viewOnMarvelCdb: string;
  readonly resources: string;
  readonly cost: string;
  readonly unique: string;
  readonly dataFrom: string;
  readonly dataUpdated: string;
  readonly legal: string;
  readonly statHealth: string;
  readonly statHandSize: string;
  readonly statAttack: string;
  readonly statThwart: string;
  readonly statDefense: string;
  readonly statRecover: string;
  readonly statScheme: string;
  readonly statBoost: string;
  readonly statThreat: string;

  readonly wave: (n: number) => string;
  readonly waveUnknown: string;
  readonly navCards: string;
  readonly navCollection: string;
  readonly collectionTitle: string;
  readonly collectionIntro: string;
  readonly collectionOwned: (owned: number, total: number) => string;
  readonly storageUnavailable: string;
  readonly copiesOwned: string;
  readonly showContents: string;
  readonly hideContents: string;
  readonly contentsHint: string;
  readonly scenarios: string;
  readonly modularSets: string;
  readonly cancel: string;
  readonly favourite: string;
  readonly unfavourite: string;
  readonly backupTitle: string;
  readonly backupIntro: string;
  readonly backupImport: string;
  readonly backupExport: string;
  readonly backupAboutToImport: string;
  readonly backupMerge: string;
  readonly backupReplace: string;
  readonly backupMergeHint: string;
  readonly backupCarriedNote: string;
  readonly backupPhotosNote: (count: number) => string;
  readonly backupNotJson: string;
  readonly backupUnreadable: string;
  readonly backupImportFailed: string;
  readonly backupImported: (packs: number, favourites: number) => string;
  readonly countPacks: (n: number) => string;
  readonly countFavourites: (n: number) => string;
  readonly countDecks: (n: number) => string;
  readonly countPlays: (n: number) => string;
  readonly countCampaigns: (n: number) => string;
}

const STRINGS: Record<Locale, Strings> = {
  en: {
    appName: 'Thwart',
    tagline: 'Marvel Champions card browser',
    searchPlaceholder: 'Search cards…',
    searchLabel: 'Search cards',
    interfaceLanguage: 'Interface',
    cardLanguage: 'Cards',
    theme: 'Theme',
    themeSystem: 'System',
    themeLight: 'Light',
    themeDark: 'Dark',
    allTypes: 'All types',
    allFactions: 'All factions',
    allPacks: 'All packs',
    loading: 'Loading the card database…',
    loadError: 'The card database could not be loaded.',
    retry: 'Retry',
    noResults: 'No cards match.',
    noResultsHint: 'Try fewer words, or clear the filters.',
    resultCount: (shown: number, total: number) =>
      shown === total ? `${total} cards` : `${shown} of ${total} cards`,
    back: 'Back to search',
    cardNotFound: 'That card is not in the database.',
    traits: 'Traits',
    illustrator: 'Illustrator',
    pack: 'Pack',
    viewOnMarvelCdb: 'View on MarvelCDB',
    resources: 'Resources',
    cost: 'Cost',
    unique: 'Unique',
    dataFrom: 'Card data from',
    dataUpdated: 'Updated',
    legal:
      'Marvel Champions card text and images are the property of Fantasy Flight Games and Marvel. This is an unofficial fan project.',
    statHealth: 'Health',
    statHandSize: 'Hand size',
    statAttack: 'Attack',
    statThwart: 'Thwart',
    statDefense: 'Defence',
    statRecover: 'Recover',
    statScheme: 'Scheme',
    statBoost: 'Boost',
    statThreat: 'Threat',

    wave: (n) => `Wave ${n}`,
    waveUnknown: 'Not yet classified',
    navCards: 'Cards',
    navCollection: 'Collection',
    collectionTitle: 'Collection',
    collectionIntro:
      'Tick the packs you own. This is stored in this browser only — nothing is sent anywhere, and there is no account. Use the export below to carry it to another device.',
    collectionOwned: (owned, total) => `${owned} of ${total} packs owned`,
    storageUnavailable:
      'This browser will not let the site store data, so the collection cannot be saved. A private window or blocked site data is the usual cause.',
    copiesOwned: 'Copies owned',
    showContents: 'Contents',
    hideContents: 'Hide',
    contentsHint:
      'Owning a pack is not the same as owning everything in it. Untick anything missing from your copy and the randomiser will not offer it.',
    scenarios: 'Scenarios',
    modularSets: 'Modular sets',
    cancel: 'Cancel',
    favourite: 'Add to favourites',
    unfavourite: 'Remove from favourites',
    backupTitle: 'Backup file',
    backupIntro:
      'The same file the Android app reads and writes. Until there is an account to sync with, this is how data moves between your phone and this browser.',
    backupImport: 'Import a backup…',
    backupExport: 'Export a backup',
    backupAboutToImport: 'This file contains:',
    backupMerge: 'Merge into what is here',
    backupReplace: 'Replace everything',
    backupMergeHint:
      'Merging keeps what is already in this browser and lets the file win where both hold the same thing. Importing the same file twice changes nothing.',
    backupCarriedNote:
      'Decks, plays and campaigns are stored and will be in anything you export, but this site cannot display them yet.',
    backupPhotosNote: (count) =>
      `${count} photographs are named in this file. The images themselves live on the phone and are not part of the bundle.`,
    backupNotJson: 'That file is not JSON.',
    backupUnreadable: 'That file is not a Thwart backup.',
    backupImportFailed: 'The import failed and nothing was changed.',
    backupImported: (packs, favourites) =>
      `Imported. ${packs} packs and ${favourites} favourites are now in this browser.`,
    countPacks: (n) => `${n} packs`,
    countFavourites: (n) => `${n} favourite cards`,
    countDecks: (n) => `${n} decks`,
    countPlays: (n) => `${n} recorded plays`,
    countCampaigns: (n) => `${n} campaigns`,
  },
  fr: {
    appName: 'Thwart',
    tagline: 'Recherche de cartes Marvel Champions',
    searchPlaceholder: 'Rechercher des cartes…',
    searchLabel: 'Rechercher des cartes',
    interfaceLanguage: 'Interface',
    cardLanguage: 'Cartes',
    theme: 'Thème',
    themeSystem: 'Système',
    themeLight: 'Clair',
    themeDark: 'Sombre',
    allTypes: 'Tous les types',
    allFactions: 'Toutes les factions',
    allPacks: 'Tous les paquets',
    loading: 'Chargement de la base de cartes…',
    loadError: 'Impossible de charger la base de cartes.',
    retry: 'Réessayer',
    noResults: 'Aucune carte ne correspond.',
    noResultsHint: 'Essayez moins de mots, ou effacez les filtres.',
    resultCount: (shown: number, total: number) =>
      shown === total ? `${total} cartes` : `${shown} cartes sur ${total}`,
    back: 'Retour à la recherche',
    cardNotFound: "Cette carte n'est pas dans la base.",
    traits: 'Traits',
    illustrator: 'Illustrateur',
    pack: 'Paquet',
    viewOnMarvelCdb: 'Voir sur MarvelCDB',
    resources: 'Ressources',
    cost: 'Coût',
    unique: 'Unique',
    dataFrom: 'Données des cartes :',
    dataUpdated: 'Mise à jour',
    legal:
      'Le texte et les images des cartes Marvel Champions appartiennent à Fantasy Flight Games et à Marvel. Projet de fan non officiel.',
    statHealth: 'Points de vie',
    statHandSize: 'Taille de main',
    statAttack: 'Attaque',
    statThwart: 'Neutralisation',
    statDefense: 'Défense',
    statRecover: 'Récupération',
    statScheme: 'Complot',
    statBoost: 'Bonus',
    statThreat: 'Menace',

    wave: (n) => `Vague ${n}`,
    waveUnknown: 'Non classés',
    navCards: 'Cartes',
    navCollection: 'Collection',
    collectionTitle: 'Collection',
    collectionIntro:
      "Cochez les paquets que vous possédez. Tout est enregistré dans ce navigateur uniquement : rien n'est envoyé nulle part et il n'y a pas de compte. Utilisez l'export ci-dessous pour emporter vos données ailleurs.",
    collectionOwned: (owned, total) => `${owned} paquets sur ${total} possédés`,
    storageUnavailable:
      "Ce navigateur refuse d'enregistrer les données du site, la collection ne peut donc pas être sauvegardée. Une fenêtre privée ou des données de site bloquées en sont la cause habituelle.",
    copiesOwned: 'Exemplaires possédés',
    showContents: 'Contenu',
    hideContents: 'Masquer',
    contentsHint:
      "Posséder un paquet ne veut pas dire posséder tout ce qu'il contient. Décochez ce qui manque à votre exemplaire et le tirage aléatoire ne le proposera pas.",
    scenarios: 'Scénarios',
    modularSets: 'Modules',
    cancel: 'Annuler',
    favourite: 'Ajouter aux favoris',
    unfavourite: 'Retirer des favoris',
    backupTitle: 'Fichier de sauvegarde',
    backupIntro:
      "Le même fichier que l'application Android lit et écrit. En attendant un compte à synchroniser, c'est ainsi que les données circulent entre votre téléphone et ce navigateur.",
    backupImport: 'Importer une sauvegarde…',
    backupExport: 'Exporter une sauvegarde',
    backupAboutToImport: 'Ce fichier contient :',
    backupMerge: 'Fusionner avec les données présentes',
    backupReplace: 'Tout remplacer',
    backupMergeHint:
      'La fusion conserve ce qui est déjà dans ce navigateur et laisse le fichier gagner en cas de doublon. Importer deux fois le même fichier ne change rien.',
    backupCarriedNote:
      "Les decks, parties et campagnes sont enregistrés et figureront dans vos exports, mais ce site ne sait pas encore les afficher.",
    backupPhotosNote: (count) =>
      `${count} photographies sont nommées dans ce fichier. Les images elles-mêmes restent sur le téléphone et ne font pas partie de la sauvegarde.`,
    backupNotJson: "Ce fichier n'est pas du JSON.",
    backupUnreadable: "Ce fichier n'est pas une sauvegarde Thwart.",
    backupImportFailed: "L'import a échoué et rien n'a été modifié.",
    backupImported: (packs, favourites) =>
      `Import terminé. ${packs} paquets et ${favourites} favoris sont maintenant dans ce navigateur.`,
    countPacks: (n) => `${n} paquets`,
    countFavourites: (n) => `${n} cartes favorites`,
    countDecks: (n) => `${n} decks`,
    countPlays: (n) => `${n} parties enregistrées`,
    countCampaigns: (n) => `${n} campagnes`,
  },
};

export function strings(locale: Locale): Strings {
  return STRINGS[locale];
}

export const LANGUAGE_NAMES: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
};

/**
 * Picks a starting interface language from the browser.
 *
 * French only when the browser actually asks for it; English is the fallback
 * for everything else rather than a default anyone chose.
 */
export function detectLocale(): Locale {
  const preferred = typeof navigator === 'undefined' ? [] : navigator.languages;
  for (const tag of preferred ?? []) {
    if (tag.toLowerCase().startsWith('fr')) {
      return 'fr';
    }
    if (tag.toLowerCase().startsWith('en')) {
      return 'en';
    }
  }
  return 'en';
}
