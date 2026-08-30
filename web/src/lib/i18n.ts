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
