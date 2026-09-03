import type { Locale } from './types';

/**
 * User-interface strings, in the two languages the app supports.
 *
 * A typed dictionary rather than an i18n framework. With two languages, no
 * pluralisation worth the name and no runtime locale loading, a framework
 * would add a build step and a lookup indirection to buy nothing, whereas
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

  readonly navRules: string;
  readonly rulesTitle: string;
  readonly rulesSearchHint: string;
  readonly rulesNoResults: string;
  readonly rulesLoadError: string;
  readonly rulesLoading: string;
  readonly rulesCount: (shown: number, total: number) => string;
  readonly rulesCreditBefore: string;
  readonly rulesCreditAfter: (licence: string) => string;
  readonly navCampaigns: string;
  readonly campaignsTitle: string;
  readonly campaignsEmpty: string;
  readonly campaignsEmptyHint: string;
  readonly campaignProgress: (done: number, total: number) => string;
  readonly campaignConceded: string;
  readonly campaignFinished: string;
  readonly campaignPlays: (n: number) => string;
  readonly campaignUnread: (n: number) => string;
  readonly attempts: (n: number) => string;
  readonly navPlay: string;
  readonly navStats: string;
  readonly playTitle: string;
  readonly playSetupNote: string;
  readonly choose: string;
  readonly standardSetWith: string;
  readonly seats: string;
  readonly addDeck: string;
  readonly noSeatsYet: string;
  readonly noDecksForPlay: string;
  readonly modularChooseNote: string;
  readonly startGame: string;
  readonly pauseClock: string;
  readonly resumeClock: string;
  readonly recordResult: string;
  readonly location: string;
  readonly victoryPoints: string;
  readonly notes: string;
  readonly won: string;
  readonly lost: string;
  readonly discardGame: string;
  readonly discardNote: string;
  readonly playRecorded: string;
  readonly playAnother: string;
  readonly statsTitle: string;
  readonly statsEmpty: string;
  readonly statsEmptyHint: string;
  readonly statsNote: string;
  readonly winRateOf: (won: number, total: number) => string;
  readonly timePlayed: (formatted: string) => string;
  readonly wonOf: (won: number, played: number) => string;
  readonly byHero: string;
  readonly byAspect: string;
  readonly byHeroAspect: string;
  readonly byScenario: string;
  readonly byDifficulty: string;
  readonly byPlayerCount: string;
  readonly deckLegal: string;
  readonly deckLegalShort: string;
  readonly deckIllegalShort: string;
  readonly deckIllegal: (n: number) => string;
  readonly deckLegalityUnknown: string;
  readonly deckComposition: string;
  readonly deckByType: string;
  readonly deckByAspect: string;
  readonly averageCost: (avg: string) => string;
  readonly resourceName: (key: string) => string;
  readonly problemAspectCount: (chosen: number, expected: number) => string;
  readonly problemTooFew: (actual: number, minimum: number) => string;
  readonly problemTooMany: (actual: number, maximum: number) => string;
  readonly problemRequired: (card: string, required: number, actual: number) => string;
  readonly problemOffAspect: (card: string, faction: string) => string;
  readonly problemCopyLimit: (title: string, total: number, limit: number) => string;
  readonly problemDuplicateUnique: (title: string, total: number) => string;
  readonly problemUnbalanced: (counts: string) => string;
  readonly navDecks: string;
  readonly decksTitle: string;
  readonly importDeck: string;
  readonly importDeckNote: string;
  readonly importAction: string;
  readonly importing: string;
  readonly deckImportNotFound: string;
  readonly deckImportNetwork: string;
  readonly noDecks: string;
  readonly removeDeck: string;
  readonly cardCount: (n: number) => string;
  readonly deckMissing: (cards: number, packs: number) => string;
  readonly deckBuildable: string;
  readonly deckUnknownCards: (n: number) => string;
  readonly notOwned: string;
  readonly deckLocaleNote: (locale: string) => string;
  readonly navRandomizer: string;
  readonly filters: string;
  readonly filtersNote: string;
  readonly aspects: string;
  readonly excludeBeaten: (n: number) => string;
  readonly resetFilters: string;
  readonly savedDraws: string;
  readonly beatenNote: string;
  readonly randomizerTitle: string;
  readonly randomizerNoCollection: string;
  readonly randomizerNotEnough: (players: number) => string;
  readonly poolNote: (scenarios: number, heroes: number, modulars: number) => string;
  readonly players: string;
  readonly roll: string;
  readonly reroll: string;
  readonly lockField: string;
  readonly scenario: string;
  readonly difficultyLabel: string;
  readonly difficulty: (id: string) => string;
  readonly heroes: string;
  readonly aspect: (id: string) => string;
  readonly required: string;
  readonly noModularSets: string;
  readonly saveToHistory: string;
  readonly savedToHistory: string;
  readonly wave: (n: number) => string;
  readonly waveUnknown: string;
  readonly navCards: string;
  readonly navCollection: string;
  /** The Play tab's label, which has about six characters of room. */
  readonly navPlayShort: string;
  readonly navMore: string;
  readonly navMoreTitle: string;
  readonly settingsTitle: string;
  readonly close: string;

  // The account, and the recovery code that stands in for an email address.
  readonly accountTitle: string;
  readonly accountSignIn: string;
  readonly accountCreate: string;
  readonly accountForgot: string;
  readonly accountRecoverAction: string;
  readonly accountHandle: string;
  readonly accountPassword: string;
  readonly accountNewPassword: string;
  readonly accountRecoveryCode: string;
  readonly accountDeviceName: string;
  readonly accountDeviceNameNote: string;
  readonly accountNoEmail: string;
  readonly accountClosed: string;
  readonly accountManage: string;
  readonly accountSignedInAs: string;
  readonly accountDeviceIs: (name: string) => string;
  readonly accountDevices: string;
  readonly accountThisDevice: string;
  readonly accountLeaving: string;
  readonly accountSignOut: string;
  readonly accountSignOutKeeps: string;
  readonly accountSyncNotYet: string;
  readonly accountWhy: string;
  readonly accountWhyBody: string;
  readonly accountPrivacy: string;
  readonly accountError: (code: string) => string;
  readonly recoveryTitle: string;
  readonly recoveryIntro: string;
  readonly recoveryDownload: string;
  readonly recoveryCopy: string;
  readonly recoverySaved: string;
  readonly recoveryDone: string;
  readonly recoveryFileBody: (handle: string, code: string) => string;
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

  // The encounter tracker.
  readonly tracker: string;
  readonly trackerLoading: string;
  readonly trackerUnavailable: string;
  readonly trackerStarred: string;
  readonly trackerNote: string;
  readonly round: (n: number) => string;
  readonly endRound: string;
  readonly advanceVillain: string;
  readonly advanceScheme: string;
  readonly whichScheme: string;

  // Putting a game away for longer than a pause.
  readonly longBreak: string;
  readonly longBreakIntro: string;
  readonly longBreakPhase: string;
  readonly phasePlayer: string;
  readonly phaseVillain: string;
  readonly villainStep: (step: string) => string;
  readonly heroLives: string;
  readonly villainLifeLeft: string;
  readonly villainStageLabel: string;
  readonly putAway: string;
  readonly savePutAway: string;
  readonly resumeSaved: string;
  readonly discardSaved: string;
  readonly savedGame: (scenario: string, when: string) => string;
  readonly savedGameNote: string;

  // The three steps of a game: choose it, lay it out, play it.
  readonly goToSetup: string;
  readonly play: string;
  readonly backToSetup: string;
  readonly clockStartsNote: string;
  readonly briefingTitle: string;
  readonly briefingIntro: string;
  readonly briefingGather: string;
  readonly mainSchemeDeck: string;
  readonly encounterDeck: string;
  readonly schemeSetupTitle: string;
  readonly damageOnVillain: string;
  readonly threatOnScheme: string;
  /** Whose copy of the main scheme a counter is, when there is one each. */
  readonly schemeForPlayer: (n: number) => string;
  readonly tapToCorrect: string;
  readonly correctTheClock: string;
  readonly keepScreenOn: string;
  readonly briefingNoSetup: string;
  readonly howDidItEnd: string;
  readonly timePlayedLabel: string;

  // Campaigns you can actually play.
  readonly startCampaign: string;
  readonly campaign: string;
  readonly campaignName: string;
  readonly campaignRoster: string;
  readonly campaignRosterNote: string;
  readonly campaignWip: string;
  readonly campaignsUnavailable: string;
  readonly campaignDifficulty: (id: string) => string;
  readonly campaignComplete: string;
  readonly campaignLost: string;
  readonly campaignSummary: (played: number, won: number) => string;
  readonly campaignBetween: string;
  readonly campaignContinue: string;
  readonly campaignOpen: string;
  readonly actionTaken: string;
  readonly promptUnsupported: (type: string) => string;

  // The briefing, in the four boxes the app reads it in.
  readonly campaignPreSetup: string;
  readonly campaignSetupLabel: string;
  readonly campaignInformation: string;
  readonly campaignVillainDeck: string;
  readonly campaignMainScheme: string;
  readonly campaignImReady: string;
  readonly campaignNotReady: string;
  readonly campaignChooseOne: string;
  readonly campaignNothingRecorded: string;
  readonly campaignNobody: string;

  // Recording a scenario, and what comes after it.
  readonly campaignQuestionsTitle: string;
  readonly campaignNoQuestions: string;
  readonly campaignAnswerRequired: string;
  readonly campaignCardListHint: string;
  readonly campaignNoDeckCards: string;
  readonly campaignValidate: string;
  readonly campaignValidating: string;
  readonly campaignBravo: string;
  readonly campaignDefeatRecorded: string;
  readonly campaignGoToNext: (name: string) => string;
  readonly campaignRetry: string;
  readonly campaignTakeABreak: string;
  readonly campaignStopCampaign: string;
  readonly campaignChooseScenario: string;
  readonly campaignDoneShopping: string;
  readonly campaignWhoIsBuying: string;
  readonly campaignFinishedMessage: string;
  readonly campaignFinishedCleanup: string;

  // Fear No Evil's rotation, where the villains push two places.
  readonly campaignEnvironmentTitle: string;
  readonly campaignEnvironmentLast: string;
  readonly campaignPushed: string;
  readonly campaignPushedTwice: string;

  readonly market: string;
  readonly creditsLeft: (n: number) => string;
  readonly ownedBy: (name: string) => string;
  readonly buy: string;
  readonly refund: string;
  readonly yes: string;
  readonly saveResult: string;
  readonly backToGame: string;
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
    tagline: 'Cards, collection, decks and statistics for Marvel Champions',
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

    navRules: 'Rules',
    rulesTitle: 'Rules Reference',
    rulesSearchHint: 'Search the rules',
    rulesNoResults: 'No rule matches your search.',
    rulesLoadError: 'The rules reference could not be loaded.',
    rulesLoading: 'Loading the rules reference…',
    rulesCount: (shown, total) =>
      shown === total ? `${total} entries` : `${shown} of ${total} entries`,
    rulesCreditBefore: 'Compiled by',
    rulesCreditAfter: (licence) =>
      `and released under ${licence}, which is the only reason it can be included here. Unofficial, and not endorsed by Fantasy Flight Games.`,
    navCampaigns: 'Campaigns',
    campaignsTitle: 'Campaigns',
    campaignsEmpty: 'No campaigns here.',
    campaignsEmptyHint:
      'Import a backup from the Android app on the Collection page and your campaigns will show up.',
    campaignProgress: (done, total) => `${done} of ${total} scenarios beaten`,
    campaignConceded: 'conceded',
    campaignFinished: 'finished',
    campaignPlays: (n) =>
      n === 1
        ? '1 recorded play belongs to this campaign.'
        : `${n} recorded plays belong to this campaign.`,
    campaignUnread: (n) =>
      n === 1
        ? "1 event in this campaign's log is not read by this page."
        : `${n} events in this campaign's log are not read by this page.`,
    attempts: (n) => `${n} attempts`,
    navPlay: 'My own setup',
    navStats: 'Stats',
    playTitle: 'My own setup',
    playSetupNote: 'Choose everything yourself. The clock runs while you play.',
    choose: 'Choose…',
    standardSetWith: 'Standard set played with it',
    seats: 'Decks & players',
    addDeck: 'Add a deck',
    noSeatsYet: 'Add at least one deck.',
    noDecksForPlay:
      'A player is a deck, so there is nothing to add yet. Import one on the Decks page and it will appear here.',
    modularChooseNote:
      'Whatever you actually shuffled in. Only sets from packs you own are listed.',
    startGame: 'Start the game',
    pauseClock: 'Pause the clock',
    resumeClock: 'Resume the clock',
    recordResult: 'Record the result',
    location: 'Where you played',
    victoryPoints: 'Victory points',
    notes: 'Notes',
    won: 'Won',
    lost: 'Lost',
    discardGame: 'Forget this game',
    discardNote:
      'Discarding records nothing: no play in your history and nothing in your statistics.',
    playRecorded: 'Recorded.',
    playAnother: 'Play another',
    statsTitle: 'Statistics',
    statsEmpty: 'No games recorded yet.',
    statsEmptyHint:
      'Record one from My own setup, or import a backup from the Android app on the Collection page.',
    statsNote:
      'Counted per seat, so a four-player game credits all four heroes rather than only the first.',
    winRateOf: (won, total) => `${won} won of ${total} games`,
    timePlayed: (formatted) => `${formatted} at the table`,
    wonOf: (won, played) => `${won}/${played}`,
    byHero: 'By hero',
    byAspect: 'By aspect',
    byHeroAspect: 'By hero and aspect',
    byScenario: 'By scenario',
    byDifficulty: 'By difficulty',
    byPlayerCount: 'By number of players',
    navDecks: 'Decks',
    decksTitle: 'Decks',
    deckLegal: 'This deck is legal.',
    deckLegalShort: 'legal',
    deckIllegalShort: 'not legal',
    deckIllegal: (n) =>
      n === 1 ? '1 problem with this deck:' : `${n} problems with this deck:`,
    deckLegalityUnknown:
      'The hero card is not in the database, so this deck cannot be checked against the rules.',
    deckComposition: 'Composition',
    deckByType: 'By type',
    deckByAspect: 'By aspect',
    averageCost: (avg) => `Average cost ${avg}`,
    resourceName: (key) =>
      ({ physical: 'physical', mental: 'mental', energy: 'energy', wild: 'wild' })[key] ?? key,
    problemAspectCount: (chosen, expected) =>
      `This hero takes ${expected} ${expected === 1 ? 'aspect' : 'aspects'}; the deck names ${chosen}.`,
    problemTooFew: (actual, minimum) => `${actual} cards, fewer than the ${minimum} minimum.`,
    problemTooMany: (actual, maximum) => `${actual} cards, more than the ${maximum} maximum.`,
    problemRequired: (card, required, actual) =>
      `${card}: the hero's own cards are not optional (${required} required, ${actual} present).`,
    problemOffAspect: (card, faction) =>
      `${card} is ${faction}, which this deck has not taken.`,
    problemCopyLimit: (title, total, limit) =>
      `${total} copies of ${title}; the limit is ${limit}.`,
    problemDuplicateUnique: (title, total) => `${total} copies of ${title}, which is unique.`,
    problemUnbalanced: (counts) => `This hero's aspects must contribute equally: ${counts}.`,
    importDeck: 'Import from MarvelCDB',
    importDeckNote:
      'Paste a decklist link, or just its number. The deck is stored in this browser, keyed the same way the Android app keys it, so importing it in both places gives you one deck rather than two.',
    importAction: 'Import',
    importing: 'Importing…',
    deckImportNotFound:
      'No deck there. Published decklists always work; a personal deck only works if its owner has shared it.',
    deckImportNetwork: 'Could not reach MarvelCDB.',
    noDecks: 'No decks yet.',
    removeDeck: 'Remove',
    cardCount: (n) => `${n} cards`,
    deckMissing: (cards, packs) =>
      `${cards} cards in this deck are not in your collection, from ${packs} packs you do not own.`,
    deckBuildable: 'You own everything in this deck.',
    deckUnknownCards: (n) =>
      `${n} cards in this deck are not in the card database yet. MarvelCDB enters new cards as volunteers get to them.`,
    notOwned: 'not owned',
    deckLocaleNote: (locale) =>
      `Card names are shown in ${locale === 'fr' ? 'French' : 'English'}, following the card language above.`,
    navRandomizer: 'Random game',
    filters: 'Filters',
    filtersNote:
      'These apply to this session only and are not saved. What you own lives on the Collection page; this is what you fancy tonight.',
    aspects: 'Aspects',
    excludeBeaten: (n) =>
      n === 0 ? 'Skip scenarios I have beaten' : `Skip scenarios I have beaten (${n})`,
    resetFilters: 'Allow everything again',
    savedDraws: 'Saved draws',
    beatenNote: 'Tick a scenario once you have beaten it, and the filter above can skip it.',
    randomizerTitle: 'Random game',
    randomizerNoCollection:
      'Tick the packs you own on the Collection page first. The draw only offers what you can actually put on the table.',
    randomizerNotEnough: (players) =>
      `Not enough in your collection for ${players} players. Add packs, or play with fewer.`,
    poolNote: (scenarios, heroes, modulars) =>
      `Drawing from ${scenarios} scenarios, ${heroes} heroes and ${modulars} modular sets.`,
    players: 'Players',
    roll: 'Roll',
    reroll: 'Roll again',
    lockField: 'Keep this when rolling again',
    scenario: 'Scenario',
    difficultyLabel: 'Difficulty',
    difficulty: (id) =>
      ({
        STANDARD_I: 'Standard I',
        STANDARD_II: 'Standard II',
        STANDARD_III: 'Standard III',
        EXPERT_I: 'Expert I',
        EXPERT_II: 'Expert II',
      })[id] ?? id,
    heroes: 'Heroes',
    aspect: (id) =>
      ({
        aggression: 'Aggression',
        justice: 'Justice',
        leadership: 'Leadership',
        protection: 'Protection',
        pool: 'Pool',
      })[id] ?? id,
    required: 'required',
    noModularSets: 'This scenario takes no modular sets.',
    saveToHistory: 'Save this draw',
    savedToHistory: 'Saved',
    wave: (n) => `Wave ${n}`,
    waveUnknown: 'Not yet classified',
    navCards: 'Cards',
    navCollection: 'Collection',
    navPlayShort: 'Play',
    navMore: 'More',
    navMoreTitle: 'Everything else',
    settingsTitle: 'Settings',
    close: 'Close',

    accountTitle: 'Account',
    accountSignIn: 'Sign in',
    accountCreate: 'Create an account',
    accountForgot: 'Lost your password',
    accountRecoverAction: 'Reset the password',
    accountHandle: 'Name',
    accountPassword: 'Password',
    accountNewPassword: 'New password',
    accountRecoveryCode: 'Recovery code',
    accountDeviceName: 'Name for this browser',
    accountDeviceNameNote:
      'Shown in your list of devices, so you can tell them apart and sign one out.',
    accountManage: 'Manage the account',
    accountClosed:
      'This server is not taking new accounts at the moment. If you have one already, sign in — and if you have lost the password, the recovery code still works.',
    accountNoEmail:
      'No email address is asked for and none is stored. You get a recovery code instead, once, and it is the only way back in \u2014 so keep it.',
    accountSignedInAs: 'Signed in as',
    accountDeviceIs: (name) => `This browser is registered as \u201c${name}\u201d.`,
    accountDevices: 'Devices',
    accountThisDevice: 'this one',
    accountLeaving: 'Signing out',
    accountSignOut: 'Sign out',
    accountSignOutKeeps:
      'Everything on this browser stays exactly where it is. Signing out forgets the account, not your collection, decks, plays or campaigns.',
    accountSyncNotYet:
      'Nothing is syncing yet. The account works and this browser is registered to it, but moving data between your devices is still being built \u2014 so nothing has been uploaded and nothing has been changed here.',
    accountWhy: 'What an account is for',
    accountWhyBody:
      'One place your collection, decks, plays and campaigns live, so the same data is on your phone and in this browser. Until then, the backup file on the Collection page is how it travels.',
    accountPrivacy:
      'The server stores your records without reading them: it does not know what a card is. You can export everything or delete the account outright, and neither needs anybody\u2019s permission.',
    accountError: (code) =>
      ({
        invalid_credentials: 'That name and password do not match an account.',
        handle_taken: 'That name is taken on this server. Try another.',
        registration_closed: 'This server is not taking new accounts.',
        invalid_recovery_code: 'That recovery code is not right for this account.',
        rate_limited: 'Too many attempts. Wait a little and try again.',
        unauthorized: 'You have been signed out. Sign in again.',
        offline: 'The server could not be reached. Check your connection.',
      })[code] ?? 'Something went wrong on the server. Try again.',
    recoveryTitle: 'Keep this code',
    recoveryIntro:
      'This is shown once and never again. There is no email address on this account, so this code is the only way back in if you forget your password. Save it somewhere you will still have it in a year.',
    recoveryDownload: 'Save as a file',
    recoveryCopy: 'Copy',
    recoverySaved: 'I have saved it somewhere safe',
    recoveryDone: 'Done',
    recoveryFileBody: (handle, code) =>
      [
        'Thwart \u2014 account recovery code',
        '',
        `Account: ${handle}`,
        `Code:    ${code}`,
        '',
        'This code resets the password on this account. It is shown once and',
        'the server keeps only a hash of it, so this file is the only copy.',
        'Anyone holding it can take the account: keep it as you would a key.',
      ].join('\n'),
    collectionTitle: 'Collection',
    collectionIntro:
      'Tick the packs you own. This is stored in this browser only; nothing is sent anywhere, and there is no account. Use the export below to carry it to another device.',
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

    tracker: 'Villain and scheme',
    trackerLoading: 'Reading the scenario…',
    trackerUnavailable: 'This scenario has no numbers to count.',
    trackerStarred: 'The card prints a star, so type the number',
    trackerNote:
      "Counters only. It does not know that drones enter play or that a Crisis icon stops thwarting, because a tracker that half-adjudicates rules is wrong at somebody's table, and then the numbers it is keeping stop being trusted either.",
    round: (n) => `Round ${n}`,
    endRound: 'End the round',
    advanceVillain: 'Flip the villain',
    advanceScheme: 'Advance the scheme',
    whichScheme: 'Which one is on the table',

    longBreak: 'Take a long break?',
    longBreakIntro:
      'For a table that has to be cleared, or left for a week. The clock stops and where everything stood is written down. One game at a time: saving replaces whatever was already put away.',
    longBreakPhase: 'It stopped in',
    phasePlayer: 'The player phase',
    phaseVillain: 'The villain phase',
    villainStep: (step) =>
      ({
        PLACE_THREAT: 'Placing threat on the main scheme',
        ACTIVATE_MINIONS: 'Activating minions',
        DEAL_ENCOUNTERS: 'Dealing encounter cards',
        REVEAL_ENCOUNTERS: 'Revealing encounter cards',
        PASS_FIRST_PLAYER: 'Passing the first player token',
      })[step] ?? step,
    heroLives: 'Hit points left',
    villainLifeLeft: 'Hit points left on the villain',
    villainStageLabel: 'Which villain card is face up',
    putAway: 'Take the break',
    savePutAway: 'Save and leave the table',
    resumeSaved: 'Pick it up again',
    discardSaved: 'Throw it away',
    savedGame: (scenario, when) => `${scenario}, put away ${when}`,
    savedGameNote:
      'Picking it up puts the cards and the clock back where they were. The clock comes back stopped, because getting the cards out again is not play time.',

    goToSetup: 'Go to setup',
    play: 'Play',
    backToSetup: 'Change the setup',
    clockStartsNote: 'The clock starts when you press Play, not before. Laying a game out takes several minutes and counting them made every game look longer than it was.',
    briefingTitle: 'Preparation',
    briefingIntro: 'What to fetch, and what the scenario says to do with it. The setup is read off the main scheme card, in the language your cards are in.',
    briefingGather: 'Gather',
    mainSchemeDeck: 'Main scheme deck',
    encounterDeck: 'Encounter deck',
    schemeSetupTitle: 'Main scheme setup',
    damageOnVillain: 'Damage on the villain',
    threatOnScheme: 'Threat on the main scheme',
    schemeForPlayer: (n) => `Player ${n}`,
    tapToCorrect: 'Tap the time to correct it',
    correctTheClock: 'Time played, as minutes',
    keepScreenOn: 'Keep the screen on',
    briefingNoSetup: 'This scenario prints no setup on its main scheme; it is in the rules insert or the campaign book.',
    howDidItEnd: 'How did it end?',
    timePlayedLabel: 'Time played',

    startCampaign: 'Start a campaign',
    campaign: 'Campaign',
    campaignName: 'Call it',
    campaignRoster: 'Who is playing',
    campaignRosterNote:
      'The roster is fixed for the whole campaign. Each player keeps their own credits, scars and upgrades from the first scenario to the last, so this is asked once and never again.',
    campaignWip: 'This campaign is marked unfinished by whoever wrote it. Parts of it may be missing.',
    campaignsUnavailable: 'The campaigns could not be loaded.',
    campaignDifficulty: (id) => (id === 'expert' ? 'Expert' : 'Standard'),
    campaignComplete: 'Campaign complete',
    campaignLost: 'The campaign is lost',
    campaignSummary: (played, won) => `${played} scenarios played, ${won} won.`,
    campaignBetween: 'Between scenarios',
    campaignContinue: 'Continue',
    campaignOpen: 'Open this campaign',
    actionTaken: 'Done.',
    promptUnsupported: (type) =>
      `This build cannot ask this question yet (${type}). Record it by hand on the campaign sheet.`,

    campaignPreSetup: 'Pre-setup',
    campaignSetupLabel: 'Campaign setup',
    campaignInformation: 'Subordinates and play tips',
    campaignVillainDeck: 'Villain deck',
    campaignMainScheme: 'Main scheme deck',
    campaignImReady: "I'm ready",
    campaignNotReady: "I'm not ready yet",
    campaignChooseOne: 'Tap the one you want to keep',
    campaignNothingRecorded: 'Nothing recorded',
    campaignNobody: 'Nobody',

    campaignQuestionsTitle: 'A few questions',
    campaignNoQuestions: 'Nothing to record for this outcome.',
    campaignAnswerRequired:
      'A required choice is still open. The campaign expects it, and later scenarios assume it was made.',
    campaignCardListHint: 'Card names separated by commas.',
    campaignNoDeckCards: 'No deck cards available for this run.',
    campaignValidate: 'Validate',
    campaignValidating: 'Recording...',
    campaignBravo: 'Bravo!',
    campaignDefeatRecorded: 'Defeat recorded',
    campaignGoToNext: (name) => `Go to ${name}`,
    campaignRetry: 'I can beat you! (retry)',
    campaignTakeABreak: 'Take a break',
    campaignStopCampaign: 'Stop the campaign',
    campaignChooseScenario: 'Which scenario next?',
    campaignDoneShopping: 'Done shopping',
    campaignWhoIsBuying: 'Who is buying?',
    campaignFinishedMessage:
      'The last villain is down and the campaign is yours. Everything below is what it took.',
    campaignFinishedCleanup:
      'Before your next game, take the campaign cards back out of your decks.',

    campaignEnvironmentTitle: 'The villains push two places.',
    campaignEnvironmentLast: 'One place left. It takes the hit twice.',
    campaignPushed: 'pushed one step',
    campaignPushedTwice: 'alone in the pile, pushed two steps',

    market: 'Market',
    creditsLeft: (n) => `${n} credits`,
    ownedBy: (name) => `taken by ${name}`,
    buy: 'Buy',
    refund: 'Give back',
    yes: 'Yes',
    saveResult: 'Save the game',
    backToGame: 'Back to the game',
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
    tagline: 'Cartes, collection, decks et statistiques pour Marvel Champions',
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

    navRules: 'Règles',
    rulesTitle: 'Guide des règles',
    rulesSearchHint: 'Rechercher dans les règles',
    rulesNoResults: 'Aucune règle ne correspond à votre recherche.',
    rulesLoadError: 'Impossible de charger le guide des règles.',
    rulesLoading: 'Chargement du guide des règles…',
    rulesCount: (shown, total) =>
      shown === total
        ? `${total} entrées`
        : `${shown} ${shown === 1 ? 'entrée' : 'entrées'} sur ${total}`,
    rulesCreditBefore: 'Compilé par',
    rulesCreditAfter: (licence) =>
      `et publié sous ${licence}, ce qui est la seule raison pour laquelle il peut figurer ici. Non officiel, sans lien avec Fantasy Flight Games.`,
    navCampaigns: 'Campagnes',
    campaignsTitle: 'Campagnes',
    campaignsEmpty: 'Aucune campagne ici.',
    campaignsEmptyHint:
      "Importez une sauvegarde de l'application Android sur la page Collection et vos campagnes apparaîtront.",
    campaignProgress: (done, total) => `${done} scénarios battus sur ${total}`,
    campaignConceded: 'abandonnée',
    campaignFinished: 'terminée',
    campaignPlays: (n) =>
      n === 1
        ? '1 partie enregistrée appartient à cette campagne.'
        : `${n} parties enregistrées appartiennent à cette campagne.`,
    campaignUnread: (n) =>
      n === 1
        ? "1 événement du journal de cette campagne n'est pas lu par cette page."
        : `${n} événements du journal de cette campagne ne sont pas lus par cette page.`,
    attempts: (n) => `${n} tentatives`,
    navPlay: 'Ma propre partie',
    navStats: 'Stats',
    playTitle: 'Ma propre partie',
    playSetupNote: 'Choisissez tout vous-même. Le chronomètre tourne pendant la partie.',
    choose: 'Choisir…',
    standardSetWith: 'Set Standard joué avec',
    seats: 'Decks & nombre de joueurs',
    addDeck: 'Ajouter un deck',
    noSeatsYet: 'Ajoutez au moins un deck.',
    noDecksForPlay:
      "Un joueur est un deck, il n'y a donc rien à ajouter pour le moment. Importez-en un sur la page Decks et il apparaîtra ici.",
    modularChooseNote:
      'Ce que vous avez réellement mélangé. Seuls les sets modulaires des paquets que vous possédez sont listés.',
    startGame: 'Commencer la partie',
    pauseClock: 'Mettre en pause',
    resumeClock: 'Reprendre',
    recordResult: 'Enregistrer le résultat',
    location: 'Lieu de la partie',
    victoryPoints: 'Points de victoire',
    notes: 'Notes',
    won: 'Victoire',
    lost: 'Défaite',
    discardGame: 'Ignorer cette partie',
    discardNote:
      "Abandonner n'enregistre rien : aucune partie dans votre historique ni dans vos statistiques.",
    playRecorded: 'Enregistrée.',
    playAnother: 'Rejouer',
    statsTitle: 'Statistiques',
    statsEmpty: 'Aucune partie enregistrée pour le moment.',
    statsEmptyHint:
      "Enregistrez-en une depuis Ma propre partie, ou importez une sauvegarde de l'application Android sur la page Collection.",
    statsNote:
      'Compté par siège : une partie à quatre crédite les quatre héros et non le premier seulement.',
    winRateOf: (won, total) => `${won} victoires sur ${total} parties`,
    timePlayed: (formatted) => `${formatted} de jeu`,
    wonOf: (won, played) => `${won}/${played}`,
    byHero: 'Par héros',
    byAspect: 'Par aspect',
    byHeroAspect: 'Par héros et aspect',
    byScenario: 'Par scénario',
    byDifficulty: 'Par difficulté',
    byPlayerCount: 'Par nombre de joueurs',
    navDecks: 'Decks',
    decksTitle: 'Decks',
    deckLegal: 'Ce deck est légal.',
    deckLegalShort: 'légal',
    deckIllegalShort: 'non légal',
    deckIllegal: (n) =>
      n === 1 ? '1 problème dans ce deck :' : `${n} problèmes dans ce deck :`,
    deckLegalityUnknown:
      "La carte du héros n'est pas dans la base, ce deck ne peut donc pas être vérifié.",
    deckComposition: 'Composition',
    deckByType: 'Par type',
    deckByAspect: 'Par aspect',
    averageCost: (avg) => `Coût moyen ${avg}`,
    resourceName: (key) =>
      ({ physical: 'physique', mental: 'mental', energy: 'énergie', wild: 'joker' })[key] ?? key,
    problemAspectCount: (chosen, expected) =>
      `Ce héros prend ${expected} ${expected === 1 ? 'aspect' : 'aspects'} ; le deck en annonce ${chosen}.`,
    problemTooFew: (actual, minimum) => `${actual} cartes, moins que le minimum de ${minimum}.`,
    problemTooMany: (actual, maximum) => `${actual} cartes, plus que le maximum de ${maximum}.`,
    problemRequired: (card, required, actual) =>
      `${card} : les cartes du héros ne sont pas optionnelles (${required} requises, ${actual} présentes).`,
    problemOffAspect: (card, faction) =>
      `${card} est ${faction}, un aspect que ce deck n'a pas pris.`,
    problemCopyLimit: (title, total, limit) =>
      `${total} exemplaires de ${title} ; la limite est de ${limit}.`,
    problemDuplicateUnique: (title, total) =>
      `${total} exemplaires de ${title}, qui est unique.`,
    problemUnbalanced: (counts) =>
      `Les aspects de ce héros doivent contribuer à parts égales : ${counts}.`,
    importDeck: 'Importer depuis MarvelCDB',
    importDeckNote:
      "Collez le lien d'une decklist, ou simplement son numéro. Le deck est enregistré dans ce navigateur, avec la même clé que l'application Android : l'importer des deux côtés donne un seul deck et non deux.",
    importAction: 'Importer',
    importing: 'Import en cours…',
    deckImportNotFound:
      "Aucun deck à cette adresse. Les decklists publiées fonctionnent toujours ; un deck personnel ne fonctionne que si son auteur l'a partagé.",
    deckImportNetwork: 'Impossible de joindre MarvelCDB.',
    noDecks: 'Aucun deck pour le moment.',
    removeDeck: 'Supprimer',
    cardCount: (n) => `${n} cartes`,
    deckMissing: (cards, packs) =>
      `${cards} cartes de ce deck ne sont pas dans votre collection, réparties dans ${packs} paquets que vous ne possédez pas.`,
    deckBuildable: 'Vous possédez toutes les cartes de ce deck.',
    deckUnknownCards: (n) =>
      `${n} cartes de ce deck ne sont pas encore dans la base. MarvelCDB saisit les nouvelles cartes au rythme des bénévoles.`,
    notOwned: 'non possédée',
    deckLocaleNote: (locale) =>
      `Les noms de cartes sont affichés en ${locale === 'fr' ? 'français' : 'anglais'}, selon la langue des cartes choisie ci-dessus.`,
    navRandomizer: 'Partie aléatoire',
    filters: 'Filtres',
    filtersNote:
      "Ces filtres ne valent que pour cette session et ne sont pas enregistrés. Ce que vous possédez se règle sur la page Collection ; ici, c'est ce dont vous avez envie ce soir.",
    aspects: 'Aspects',
    excludeBeaten: (n) =>
      n === 0 ? 'Ignorer les scénarios déjà battus' : `Ignorer les scénarios déjà battus (${n})`,
    resetFilters: 'Tout réautoriser',
    savedDraws: 'Résultats enregistrés',
    beatenNote:
      "Cochez un scénario une fois battu, et le filtre ci-dessus pourra l'ignorer.",
    randomizerTitle: 'Partie aléatoire',
    randomizerNoCollection:
      "Cochez d'abord les paquets que vous possédez sur la page Collection. Seul ce que vous pouvez réellement mettre sur la table est proposé.",
    randomizerNotEnough: (players) =>
      `Votre collection ne suffit pas pour ${players} joueurs. Ajoutez des paquets, ou jouez à moins.`,
    poolNote: (scenarios, heroes, modulars) =>
      `Parmi ${scenarios} scénarios, ${heroes} héros et ${modulars} sets modulaires.`,
    players: 'Joueurs',
    roll: 'Lancer',
    reroll: 'Relancer',
    lockField: 'Conserver au prochain lancer',
    scenario: 'Scénario',
    difficultyLabel: 'Difficulté',
    difficulty: (id) =>
      ({
        STANDARD_I: 'Standard I',
        STANDARD_II: 'Standard II',
        STANDARD_III: 'Standard III',
        EXPERT_I: 'Expert I',
        EXPERT_II: 'Expert II',
      })[id] ?? id,
    heroes: 'Héros',
    aspect: (id) =>
      ({
        aggression: 'Agressivité',
        justice: 'Justice',
        leadership: 'Commandement',
        protection: 'Protection',
        pool: 'Pool',
      })[id] ?? id,
    required: 'obligatoire',
    noModularSets: 'Ce scénario ne prend aucun set modulaire.',
    saveToHistory: 'Enregistrer ce résultat',
    savedToHistory: 'Enregistré',
    wave: (n) => `Vague ${n}`,
    waveUnknown: 'Non classés',
    navCards: 'Cartes',
    navCollection: 'Collection',
    navPlayShort: 'Jouer',
    navMore: 'Plus',
    navMoreTitle: 'Tout le reste',
    settingsTitle: 'Réglages',
    close: 'Fermer',

    accountTitle: 'Compte',
    accountSignIn: 'Se connecter',
    accountCreate: 'Cr\u00e9er un compte',
    accountForgot: 'Mot de passe oubli\u00e9',
    accountRecoverAction: 'R\u00e9initialiser le mot de passe',
    accountHandle: 'Pseudo',
    accountPassword: 'Mot de passe',
    accountNewPassword: 'Nouveau mot de passe',
    accountRecoveryCode: 'Code de r\u00e9cup\u00e9ration',
    accountDeviceName: 'Nom de ce navigateur',
    accountDeviceNameNote:
      'Affich\u00e9 dans la liste de vos appareils, pour les distinguer et pouvoir en d\u00e9connecter un.',
    accountManage: 'Gérer le compte',
    accountClosed:
      'Ce serveur n’accepte pas de nouveaux comptes pour l’instant. Si vous en avez déjà un, connectez-vous — et si vous avez perdu le mot de passe, le code de récupération fonctionne toujours.',
    accountNoEmail:
      'Aucune adresse e-mail n\u2019est demand\u00e9e ni conserv\u00e9e. Vous recevez \u00e0 la place un code de r\u00e9cup\u00e9ration, une seule fois, et c\u2019est le seul moyen de revenir : gardez-le.',
    accountSignedInAs: 'Connect\u00e9 en tant que',
    accountDeviceIs: (name) => `Ce navigateur est enregistr\u00e9 sous \u00ab\u00a0${name}\u00a0\u00bb.`,
    accountDevices: 'Appareils',
    accountThisDevice: 'celui-ci',
    accountLeaving: 'D\u00e9connexion',
    accountSignOut: 'Se d\u00e9connecter',
    accountSignOutKeeps:
      'Tout ce qui est sur ce navigateur reste exactement o\u00f9 c\u2019est. Se d\u00e9connecter oublie le compte, pas votre collection, vos decks, vos parties ni vos campagnes.',
    accountSyncNotYet:
      'Rien n\u2019est encore synchronis\u00e9. Le compte fonctionne et ce navigateur y est enregistr\u00e9, mais le transfert des donn\u00e9es entre vos appareils est encore en cours d\u2019\u00e9criture : rien n\u2019a \u00e9t\u00e9 envoy\u00e9 et rien n\u2019a \u00e9t\u00e9 modifi\u00e9 ici.',
    accountWhy: '\u00c0 quoi sert un compte',
    accountWhyBody:
      'Un seul endroit pour votre collection, vos decks, vos parties et vos campagnes, afin que les m\u00eames donn\u00e9es soient sur votre t\u00e9l\u00e9phone et dans ce navigateur. En attendant, le fichier de sauvegarde de la page Collection est la fa\u00e7on de les d\u00e9placer.',
    accountPrivacy:
      'Le serveur conserve vos enregistrements sans les lire : il ne sait pas ce qu\u2019est une carte. Vous pouvez tout exporter ou supprimer le compte, sans demander la permission \u00e0 personne.',
    accountError: (code) =>
      ({
        invalid_credentials: 'Ce nom et ce mot de passe ne correspondent \u00e0 aucun compte.',
        handle_taken: 'Ce nom est d\u00e9j\u00e0 pris sur ce serveur. Essayez-en un autre.',
        invalid_recovery_code: 'Ce code de r\u00e9cup\u00e9ration ne correspond pas \u00e0 ce compte.',
        rate_limited: 'Trop de tentatives. Patientez un peu avant de r\u00e9essayer.',
        unauthorized: 'Vous avez \u00e9t\u00e9 d\u00e9connect\u00e9. Reconnectez-vous.',
        offline: 'Le serveur est injoignable. V\u00e9rifiez votre connexion.',
      })[code] ?? 'Une erreur est survenue sur le serveur. R\u00e9essayez.',
    recoveryTitle: 'Conservez ce code',
    recoveryIntro:
      'Il n\u2019est affich\u00e9 qu\u2019une seule fois. Ce compte n\u2019a aucune adresse e-mail : ce code est le seul moyen de revenir si vous oubliez votre mot de passe. Rangez-le l\u00e0 o\u00f9 vous l\u2019aurez encore dans un an.',
    recoveryDownload: 'Enregistrer dans un fichier',
    recoveryCopy: 'Copier',
    recoverySaved: 'Je l\u2019ai mis en lieu s\u00fbr',
    recoveryDone: 'Termin\u00e9',
    recoveryFileBody: (handle, code) =>
      [
        'Thwart \u2014 code de r\u00e9cup\u00e9ration du compte',
        '',
        `Compte : ${handle}`,
        `Code :   ${code}`,
        '',
        'Ce code r\u00e9initialise le mot de passe de ce compte. Il n\u2019est affich\u00e9',
        'qu\u2019une fois et le serveur n\u2019en garde qu\u2019une empreinte : ce fichier en est',
        'la seule copie. Quiconque le d\u00e9tient peut prendre le compte.',
      ].join('\n'),
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
      "Posséder un paquet ne veut pas dire posséder tout ce qu'il contient. Décochez ce qui manque à votre exemplaire et il ne sera plus proposé.",
    scenarios: 'Scénarios',
    modularSets: 'Sets modulaires',

    tracker: 'Méchant et manigance',
    trackerLoading: 'Lecture du scénario…',
    trackerUnavailable: "Ce scénario n'a aucun compteur à tenir.",
    trackerStarred: 'La carte imprime une étoile : saisissez le nombre',
    trackerNote:
      "Des compteurs, rien de plus. L'application ne sait pas que les drones entrent en jeu ni qu'une icône Crise empêche de contrer : un compteur qui arbitre à moitié se trompe à une table, et les nombres qu'il tient vraiment cessent alors d'être crus.",
    round: (n) => `Tour ${n}`,
    endRound: 'Terminer le tour',
    advanceVillain: 'Retourner le Méchant',
    advanceScheme: 'Faire avancer la manigance',
    whichScheme: 'Laquelle est sur la table',

    longBreak: 'Faire une longue pause ?',
    longBreakIntro:
      "Pour une table qu'il faut débarrasser, ou laisser une semaine. Le chrono s'arrête et la position de chacun est notée. Une partie à la fois : enregistrer remplace celle qui était rangée.",
    longBreakPhase: "Arrêtée pendant",
    phasePlayer: 'La phase des joueurs',
    phaseVillain: 'La phase du Méchant',
    villainStep: (step) =>
      ({
        PLACE_THREAT: 'Placer la Menace sur la manigance principale',
        ACTIVATE_MINIONS: 'Activer les Sbires',
        DEAL_ENCOUNTERS: 'Distribuer les cartes Rencontre',
        REVEAL_ENCOUNTERS: 'Révéler les cartes Rencontre',
        PASS_FIRST_PLAYER: 'Passer le jeton Premier Joueur',
      })[step] ?? step,
    heroLives: 'Points de vie restants',
    villainLifeLeft: 'Points de vie restants du Méchant',
    villainStageLabel: 'Quelle carte Méchant est face visible',
    putAway: 'Faire la pause',
    savePutAway: 'Enregistrer et quitter la table',
    resumeSaved: 'Reprendre la partie',
    discardSaved: 'Jeter',
    savedGame: (scenario, when) => `${scenario}, rangée ${when}`,
    savedGameNote:
      'Reprendre remet les cartes et le chrono là où ils étaient. Le chrono revient arrêté : ressortir le matériel ne compte pas comme du temps de jeu.',

    goToSetup: 'Aller à la mise en place',
    play: 'Jouer',
    backToSetup: 'Modifier la mise en place',
    clockStartsNote: "Le chrono démarre quand vous appuyez sur Jouer, pas avant. Installer une partie prend plusieurs minutes, et les compter faisait paraître chaque partie plus longue qu'elle ne l'était.",
    briefingTitle: 'Préparation',
    briefingIntro: "Ce qu'il faut sortir, et ce que le scénario dit d'en faire. La mise en place est lue sur la carte de manigance principale, dans la langue de vos cartes.",
    briefingGather: 'À sortir',
    mainSchemeDeck: 'Deck manigance principale',
    encounterDeck: 'Deck Rencontre',
    schemeSetupTitle: 'Mise en place de la manigance principale',
    damageOnVillain: 'Dégâts sur le Méchant',
    threatOnScheme: 'Menace sur la manigance principale',
    schemeForPlayer: (n) => `Joueur ${n}`,
    tapToCorrect: 'Touchez le temps pour le corriger',
    correctTheClock: 'Temps de jeu, en minutes',
    keepScreenOn: "Garder l'écran allumé",
    briefingNoSetup: "Ce scénario n'imprime aucune mise en place sur sa manigance principale : elle se trouve dans le livret de règles ou le livret de campagne.",
    howDidItEnd: "Comment cela s'est-il terminé ?",
    timePlayedLabel: 'Temps de jeu',

    startCampaign: 'Commencer une campagne',
    campaign: 'Campagne',
    campaignName: 'Nommez-la',
    campaignRoster: 'Qui joue',
    campaignRosterNote:
      "L'équipe est fixée pour toute la campagne. Chaque joueur garde ses propres crédits, cicatrices et améliorations du premier scénario au dernier : la question est posée une fois et plus jamais.",
    campaignWip: "Cette campagne est marquée inachevée par son auteur. Des passages peuvent manquer.",
    campaignsUnavailable: "Les campagnes n'ont pas pu être chargées.",
    campaignDifficulty: (id) => (id === 'expert' ? 'Expert' : 'Standard'),
    campaignComplete: 'Campagne terminée',
    campaignLost: 'La campagne est perdue',
    campaignSummary: (played, won) => `${played} scénarios joués, ${won} gagnés.`,
    campaignBetween: 'Entre deux scénarios',
    campaignContinue: 'Continuer',
    campaignOpen: 'Ouvrir cette campagne',
    actionTaken: 'Fait.',
    promptUnsupported: (type) =>
      `Cette version ne sait pas encore poser cette question (${type}). Notez-la à la main sur la feuille de campagne.`,

    campaignPreSetup: 'Préparation',
    campaignSetupLabel: 'Mise en place',
    campaignInformation: 'Subordonnés et conseils de jeu',
    campaignVillainDeck: 'Deck du Méchant',
    campaignMainScheme: 'Deck Manigance Principale',
    campaignImReady: 'Je suis prêt',
    campaignNotReady: 'Pas encore prêt',
    campaignChooseOne: 'Touchez celle que vous gardez',
    campaignNothingRecorded: "Rien d'enregistré",
    campaignNobody: 'Personne',

    campaignQuestionsTitle: 'Quelques questions',
    campaignNoQuestions: 'Rien à enregistrer pour ce résultat.',
    campaignAnswerRequired:
      "Un choix obligatoire reste à faire. La campagne l'exige, et les scénarios suivants le supposent acquis.",
    campaignCardListHint: 'Noms de cartes séparés par des virgules.',
    campaignNoDeckCards: 'Aucune carte de deck disponible pour cette partie.',
    campaignValidate: 'Valider',
    campaignValidating: 'Enregistrement...',
    campaignBravo: 'Bravo !',
    campaignDefeatRecorded: 'Défaite enregistrée',
    campaignGoToNext: (name) => `Aller à ${name}`,
    campaignRetry: 'Je peux le battre ! (rejouer)',
    campaignTakeABreak: 'Faire une pause',
    campaignStopCampaign: 'Arrêter la campagne',
    campaignChooseScenario: 'Quel scénario ensuite ?',
    campaignDoneShopping: 'Terminer les achats',
    campaignWhoIsBuying: 'Qui achète ?',
    campaignFinishedMessage:
      "Le dernier Méchant est à terre et la campagne est à vous. Voici ce qu'elle aura coûté.",
    campaignFinishedCleanup:
      'Avant la prochaine partie, retirez les cartes de campagne de vos decks.',

    campaignEnvironmentTitle: 'Les Méchants font progresser deux lieux.',
    campaignEnvironmentLast: 'Un seul lieu restant. Il encaisse deux fois.',
    campaignPushed: "progresse d'une case",
    campaignPushedTwice: 'seul dans la pile, progresse de deux cases',

    market: 'Marché',
    creditsLeft: (n) => `${n} crédits`,
    ownedBy: (name) => `pris par ${name}`,
    buy: 'Acheter',
    refund: 'Rendre',
    yes: 'Oui',
    saveResult: 'Enregistrer la partie',
    backToGame: 'Revenir à la partie',
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
