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
  readonly trackEncounter: string;
  readonly trackEncounterNote: string;
  readonly playLocation: string;
  readonly playLocationNote: string;
  readonly allTypes: string;
  readonly allFactions: string;
  readonly allPacks: string;
  readonly allTraits: string;
  readonly costFrom: string;
  readonly costTo: string;
  readonly ownedOnly: string;
  readonly favouritesOnly: string;
  readonly clearFilters: (active: number) => string;
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
  readonly navHistory: string;
  readonly statsRecord: string;
  readonly statsSeeHistory: (games: number) => string;
  /**
   * Reading recorded games out of storage.
   *
   * Not `loading`, which is about fetching the card database — a different
   * wait, over the network, that a history page never does.
   */
  readonly loadingGames: string;
  readonly historyTitle: string;
  readonly historyFilters: string;
  readonly historyFrom: string;
  readonly historyTo: string;
  readonly historyAny: string;
  readonly historyResult: string;
  readonly historyInACampaign: string;
  readonly historyOutsideACampaign: string;
  readonly historyClear: string;
  readonly historyCount: (shown: number, total: number) => string;
  readonly historyEmpty: string;
  readonly historyEmptyHint: string;
  readonly historyNoMatches: string;
  readonly historyNoMatchesHint: string;
  readonly historyRunEmpty: string;
  readonly historyDeleteConfirm: string;
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
  /** Names a table-size bucket. See docs/spec/statistics.md section 3.6. */
  readonly playerBucket: (bucket: string) => string;
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

  // Building a deck: the editor, and what the rules say while it is being built.
  readonly deckName: string;
  readonly deckSave: string;
  readonly deckContents: string;
  readonly deckAddCards: string;
  readonly deckEmpty: string;
  /** The group of the hero's own cards in the editor, and why it has no steppers. */
  readonly deckHeroCards: string;
  /** The two halves of the editor on a phone, and the folded problem list. */
  readonly deckTabDeck: string;
  readonly deckTabPool: string;
  readonly deckProblems: (n: number) => string;
  /** The pool's filter groups and its sort. */
  readonly factionLabel: string;
  readonly typeLabel: string;
  readonly sortLabel: string;
  readonly sortByName: string;
  readonly sortByCost: string;
  readonly deckHeroCardsFixed: string;
  /** Puts the hero's cards a deck is missing into it. */
  readonly deckAddHeroCards: string;
  /** The editor's search is limited to owned packs, and none is ticked. */
  readonly deckOwnedOnlyEmpty: string;
  readonly deckStats: string;
  readonly deckCopy: string;
  readonly deckCopied: string;
  readonly deckEdit: string;
  readonly deckNew: string;
  readonly deckPickHero: string;
  readonly deckPickAspect: string;
  readonly deckCreate: string;
  readonly deckCardCount: (total: number, min: number, max: number) => string;
  readonly deckAverageCost: (average: string) => string;
  readonly deckResources: (
    physical: number,
    mental: number,
    energy: number,
    wild: number,
  ) => string;
  readonly deckTooFew: (actual: number, required: number) => string;
  readonly deckTooMany: (actual: number, allowed: number) => string;
  readonly deckWrongAspects: (actual: number, required: number) => string;
  readonly deckOffAspect: (card: string) => string;
  readonly deckOverLimit: (card: string, quantity: number, limit: number) => string;
  readonly deckDuplicateUnique: (card: string) => string;
  readonly deckMissingRequired: (card: string, required: number, actual: number) => string;
  readonly deckUnbalanced: (counts: string) => string;
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
  readonly navVersus: string;

  // The competitive mode. The tie-breaks are the rulebook's, in the order they
  // are applied, and that order is the rule.
  readonly versusTitle: string;
  readonly versusIntro: string;
  readonly versusNeedsBox: string;
  readonly versusBox: string;
  readonly versusFaces: string;
  readonly versusLeader: string;
  readonly versusStageOne: string;
  readonly versusStageTwo: string;
  readonly versusPlayers: string;
  readonly versusStart: string;
  readonly versusEndRound: string;
  readonly versusRound: (round: number) => string;
  readonly versusWhoWon: string;
  readonly versusTie: string;
  readonly versusAgain: string;
  readonly versusTiebreakTitle: string;
  readonly versusTiebreaks: readonly string[];
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

  /*
   * The Play hub, when the ways of playing share one tab.
   *
   * The wording is the phone's own, taken across rather than written again, so
   * somebody moving between the two reads the same sentences about the same
   * screens.
   */
  readonly hubStart: string;
  readonly hubRandomDetail: string;
  readonly hubOwnDetail: string;
  readonly hubCampaignDetail: string;
  readonly hubPaused: string;
  readonly settingsGroupedPlay: string;
  readonly settingsGroupedPlayHint: string;
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
  readonly savedOnServer: string;
  readonly savedLocalOnly: string;
  readonly registeredCheckMail: (address: string) => string;
  readonly registeredThenSignIn: string;
  readonly accountYourData: string;
  readonly accountExport: string;
  readonly accountExporting: string;
  readonly accountExportNote: string;
  readonly accountDeleteTitle: string;
  readonly accountDelete: string;
  readonly accountDeleteNote: string;
  readonly accountDeleteConfirm: string;
  readonly accountDeleteYes: string;
  readonly verifyTitle: string;
  readonly verifyWorking: string;
  readonly verifyDone: (handle: string) => string;
  readonly verifyDoneHint: string;
  readonly verifyFailedHint: string;
  readonly verifyGoToAccount: string;
  readonly verifyPendingTitle: string;
  readonly verifyPendingBody: (address: string) => string;
  readonly verifyResend: string;
  readonly verifyResent: string;
  readonly verifyAlready: string;
  readonly accountNewPassword: string;
  readonly accountRecoveryCode: string;
  readonly accountDeviceName: string;
  readonly accountDeviceNameNote: string;
  /**
   * The top bar's own word for signing in.
   *
   * A noun, not the form's imperative: it labels a place to go, and it has to
   * be read at a glance from the corner of a bar.
   */
  readonly navSignIn: string;
  readonly accountEmail: string;
  readonly accountEmailNote: string;
  readonly accountHandleNote: string;
  readonly accountPasswordRule: string;
  readonly accountRecoveryNote: string;
  readonly accountClosed: string;
  readonly accountManage: string;
  readonly accountSignedInAs: string;
  readonly accountDeviceIs: (name: string) => string;
  readonly accountDevices: string;
  readonly accountThisDevice: string;
  readonly accountLeaving: string;
  readonly accountSignOut: string;
  readonly accountSignOutKeeps: string;
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
  readonly bulkLabel: string;
  readonly bulkAll: string;
  readonly bulkCore: string;
  readonly bulkHeroes: string;
  readonly bulkScenarios: string;
  readonly bulkCampaigns: string;
  readonly bulkClear: string;
  readonly bulkClearConfirm: (owned: number) => string;
  readonly bulkClearYes: string;
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
  readonly trackerStarredAcceleration: string;
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

  // Keeping this browser in step, and the merge it asks about the first time.
  readonly syncTitle: string;
  readonly syncSwitch: string;
  readonly syncSwitchNote: string;
  readonly liveOn: string;
  readonly liveOffline: string;
  readonly syncForkExplain: string;
  readonly autoSyncSwitch: string;
  readonly autoSyncNote: string;
  readonly autoSyncScenario: string;
  readonly autoSyncCampaign: string;
  readonly autoSyncBreak: string;
  readonly autoSyncDeck: string;
  readonly autoSyncCollection: string;
  readonly autoSyncFavourite: string;
  readonly syncStaging: string;
  readonly syncWorking: string;
  readonly syncOn: string;
  readonly syncNow: string;
  readonly syncStopped: string;
  readonly syncDone: (pulled: number, pushed: number) => string;
  readonly syncAdoptTitle: string;
  readonly syncAdoptNothing: string;
  readonly syncAdoptKeeps: string;
  readonly syncAdoptGo: string;
  readonly syncArriving: (n: number) => string;
  readonly syncUploading: (n: number) => string;
  readonly syncMerging: (n: number) => string;
  readonly syncForkNote: (n: number) => string;
  readonly collectionName: (collection: string) => string;

  // Setting a game aside, and removing one. Both live on the play row, and the
  // campaign list uses the same words for the same act.
  readonly playWon: string;
  readonly playLost: string;
  readonly bggUsername: string;
  readonly bggNote: string;
  readonly bggOpenProfile: string;
  readonly bggLogPlay: string;
  readonly bggFollowUp: string;
  readonly bggCopy: string;
  readonly bggCopied: string;
  readonly bggMark: string;
  readonly bggUnmark: string;
  readonly bggLogged: string;
  readonly playEdit: string;
  /** Lays the same game out again on the setup screen. */
  readonly playAgain: string;
  /** Shown on setup after a replay whose modular sets could not be recovered. */
  readonly playAgainModularNote: string;
  readonly favouritePlayAdd: string;
  readonly favouritePlayRemove: string;
  readonly historyFavouritesOnly: string;
  /** The starred games on the setup screen, each one tap from being laid out. */
  readonly favouriteGames: string;
  readonly favouriteGamesNote: string;

  /* Extra modular sets. docs/spec/ratings-and-modular-sets.md section 1. */
  readonly extraModulars: string;
  /** One locked scenario, its candidate count, and the extras asked for. */
  readonly extrasShortLocked: (scenario: string, available: number, extras: number) => string;
  readonly extrasShortAll: (extras: number) => string;
  readonly extrasShortSome: (scenarios: number, extras: number) => string;
  readonly playThisDraw: string;
  readonly modularSearch: string;
  readonly modularSelectedCount: (n: number) => string;
  readonly modularRequired: string;
  readonly modularShowAll: string;
  readonly modularNotOwned: string;
  readonly modularRemove: string;

  /* Difficulty ratings. docs/spec/ratings-and-modular-sets.md section 2. */
  /** The word for a score, 0 effortless to 5 impossible. */
  readonly difficultyWord: (score: number) => string;
  readonly ratingTitle: string;
  readonly ratingCampaignTitle: string;
  readonly ratingOptional: string;
  readonly ratingYours: string;
  readonly ratingClear: string;
  readonly ratingCommunity: (mean: number, count: number) => string;
  readonly ratingCountOnly: (count: number) => string;
  readonly ratingRejected: (count: number) => string;
  readonly ratingRefreshing: string;
  readonly playEditSave: string;
  readonly playWhen: string;
  readonly playResult: string;
  readonly playDelete: string;
  readonly playDeleteConfirm: string;
  readonly playDeleteYes: string;
  readonly campaignsInProgress: string;
  readonly campaignsFinished: string;
  readonly campaignDelete: string;
  readonly campaignDeleteConfirm: (plays: number, events: number) => string;
  readonly campaignDeleteYes: string;
  readonly campaignGames: string;
  readonly statsGames: string;
  readonly statsGamesNote: string;
  readonly statsShowMore: (remaining: number) => string;
  readonly statsShowFewer: string;
  readonly statAverageGame: string;
  readonly statLongestGame: string;
  readonly statCurrentStreak: string;
  readonly statBestStreak: string;
  readonly statCampaignGames: string;
  readonly statSoloGroup: string;
  readonly statsFilter: string;
  readonly statsSort: string;
  readonly statsMeasure: string;
  readonly sortMostPlayed: string;
  readonly sortAlphabetical: string;
  readonly sortBestRate: string;
  readonly sortWorstRate: string;
  readonly measureWinRate: string;
  readonly measureLossRate: string;
  readonly measureShare: string;
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
    trackEncounter: 'Track the villain and the scheme',
    trackEncounterNote:
      'Shows the health and threat trackers while you play. Turn it off if you keep score on the table.',
    playLocation: 'Where you play',
    playLocationNote:
      'Filled in on every game you record. It is remembered from the last one you typed.',
    allTypes: 'All types',
    allFactions: 'All factions',
    allPacks: 'All packs',
    allTraits: 'All traits',
    costFrom: 'Cost from',
    costTo: 'to',
    ownedOnly: 'Only what I own',
    favouritesOnly: 'Only favourites',
    clearFilters: (active) => `Clear ${active} filter${active === 1 ? '' : 's'}`,
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
    navHistory: 'History',
    statsRecord: 'Record',
    statsSeeHistory: (games) => `See all ${games} games in the history`,
    loadingGames: 'Reading your games…',
    historyTitle: 'History',
    historyFilters: 'Narrow the history',
    historyFrom: 'From',
    historyTo: 'To',
    historyAny: 'Any',
    historyResult: 'Result',
    historyInACampaign: 'In a campaign',
    historyOutsideACampaign: 'Outside a campaign',
    historyClear: 'Clear the filters',
    historyCount: (shown, total) =>
      shown === total ? `${total} games` : `${shown} of ${total} games`,
    historyEmpty: 'No games recorded yet.',
    historyEmptyHint:
      'Record one from Your own game, or import a backup from the Android app on the Collection page. Everything you play shows up here.',
    historyNoMatches: 'No game matches these filters.',
    historyNoMatchesHint: 'Widen the range, or clear them and start again.',
    historyRunEmpty: 'No scenario recorded against this campaign yet.',
    historyDeleteConfirm:
      'This removes the game from every device and from your statistics. It is kept as a deleted row so the removal can travel, and so it can be undone.',
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
    winRateOf: (won, total) => `${won} won of ${total} ${total === 1 ? 'game' : 'games'}`,
    timePlayed: (formatted) => `${formatted} at the table`,
    wonOf: (won, played) => `${won}/${played}`,
    byHero: 'By hero',
    byAspect: 'By aspect',
    byHeroAspect: 'By hero and aspect',
    byScenario: 'By scenario',
    byDifficulty: 'By difficulty',
    byPlayerCount: 'By number of players',
    playerBucket: (bucket) =>
      ({
        players_1: 'Solo',
        players_2: 'Two players or two hands',
        players_3: 'Three players',
        players_4: 'Four players',
        // Should never appear: this is a one to four player game, so a row
        // here is a game recorded wrongly and saying so is more use than
        // folding it into the fours.
        players_5plus: 'More than four',
      })[bucket] ?? bucket,
    navDecks: 'Decks',
    deckName: 'Deck name',
    deckSave: 'Save',
    deckContents: 'In the deck',
    deckAddCards: 'Add cards',
    deckEmpty: 'Nothing in it yet. Search on the right and press the plus.',
    deckHeroCards: 'Hero cards',
    deckTabDeck: 'Deck',
    deckTabPool: 'Cards',
    deckProblems: (n) => (n === 1 ? '1 problem' : `${n} problems`),
    factionLabel: 'Aspect',
    typeLabel: 'Type',
    sortLabel: 'Sort',
    sortByName: 'by name',
    sortByCost: 'by cost',
    deckHeroCardsFixed: 'In every deck this hero builds, at the printed count.',
    deckAddHeroCards: 'Add the hero\u2019s cards',
    deckOwnedOnlyEmpty: 'Your collection is empty, so nothing can match. Tick your packs on the Collection page, or untick this to see every card.',
    deckStats: 'What it is made of',
    deckCopy: 'Copy as text',
    deckCopied: 'Copied',
    deckEdit: 'Edit',
    deckNew: 'Build a deck',
    deckPickHero: 'Hero',
    deckPickAspect: 'Aspect',
    deckCreate: 'Start building',
    deckCardCount: (total, min, max) => `${total} cards (${min}\u2013${max})`,
    deckAverageCost: (average) => `Average cost ${average}`,
    deckResources: (physical, mental, energy, wild) =>
      `Resources: ${physical} physical, ${mental} mental, ${energy} energy, ${wild} wild`,
    deckTooFew: (actual, required) => `Only ${actual} cards. A deck needs ${required}.`,
    deckTooMany: (actual, allowed) => `${actual} cards. A deck takes at most ${allowed}.`,
    deckWrongAspects: (actual, required) =>
      `${actual} aspect${actual === 1 ? '' : 's'} chosen; this hero takes ${required}.`,
    deckOffAspect: (card) => `${card} is not in an aspect this deck can take.`,
    deckOverLimit: (card, quantity, limit) =>
      `${quantity} copies of ${card}, and ${limit} ${limit === 1 ? 'is' : 'are'} the limit.`,
    deckDuplicateUnique: (card) => `${card} is unique: only one copy, counting the hero.`,
    deckMissingRequired: (card, required, actual) =>
      `${card} is one of the hero's own cards: ${required} needed, ${actual} in the deck.`,
    deckUnbalanced: (counts) => `The chosen aspects must contribute equally (${counts}).`,
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
    navVersus: 'Versus',
    versusTitle: 'Versus game',
    versusIntro:
      'Each team builds a scenario and hands it to the other, so what a team faces here is the enemy leader and the enemy schemes.',
    versusNeedsBox:
      'Versus needs a box that has the mode. Record one in your collection and this comes back.',
    versusBox: 'Box',
    versusFaces: 'This team faces:',
    versusLeader: 'Leader',
    versusStageOne: 'Main scheme, stage 1',
    versusStageTwo: 'Main scheme, stage 2',
    versusPlayers: 'Players on this team',
    versusStart: 'Start the game',
    versusEndRound: 'End the round on both boards',
    versusRound: (round) => `Round ${round}`,
    versusWhoWon: 'Who won?',
    versusTie: 'A tie',
    versusAgain: 'Another game',
    versusTiebreakTitle: 'Tie-breaks, in order',
    versusTiebreaks: [
      'The team whose enemy main scheme deck did not advance past stage 1B.',
      'The team with the fewest minions and side schemes in their area.',
      'The team with the least threat on the main scheme in their area.',
      'The team whose identities have the most hit points left.',
      'The team with the fewest attachments on their leader.',
    ],
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
    navCollection: 'My collection',
    navPlayShort: 'Play',
    navMore: 'More',
    hubStart: 'Start a game',
    hubRandomDetail: 'Let the app pick a scenario, heroes and aspects from what you own.',
    hubOwnDetail: 'Choose everything yourself. The app times the game.',
    hubCampaignDetail: 'Start a campaign, or open one you have finished.',
    hubPaused: 'A game is waiting',
    settingsGroupedPlay: 'One Play tab',
    settingsGroupedPlayHint:
      'Puts the random game, your own setup, the campaigns and versus behind a single Play tab, the way the Android app does.',
    navMoreTitle: 'Everything else',
    settingsTitle: 'Settings',
    close: 'Close',

    accountTitle: 'Account',
    accountSignIn: 'Sign in',
    accountCreate: 'Create an account',
    accountForgot: 'Lost your password',
    accountRecoverAction: 'Reset the password',
    accountHandle: 'Pseudonym',
    accountPassword: 'Password',
    savedOnServer: 'On the server',
    savedLocalOnly: 'On this device only',
    registeredCheckMail: (address) =>
      `The account exists, and it is disabled until you open the link sent to ${address}. Check the spam folder if it is not there.`,
    registeredThenSignIn:
      'Registering does not sign you in. Open the link, then sign in here — on this device and on any other you want kept in step.',
    accountYourData: 'Your data',
    accountExport: 'Download my data',
    accountExporting: 'Preparing…',
    accountExportNote:
      'Everything this account holds on the server, as the same file the app reads and writes. Yours to keep, to move elsewhere, or to check.',
    accountDeleteTitle: 'Delete this account',
    accountDelete: 'Delete my account',
    accountDeleteNote:
      'Removes the account and everything synced to it: your address, your decks, your games, your campaigns and your collection. It does not come back, and it is not the same as signing out. What is on this device stays on this device.',
    accountDeleteConfirm:
      'This deletes the account and everything on the server. There is no undo. Type your password to confirm.',
    accountDeleteYes: 'Delete it permanently',
    verifyTitle: 'Confirming your address',
    verifyWorking: 'One moment.',
    verifyDone: (handle) => `Confirmed. The account ${handle} is now working.`,
    verifyDoneHint:
      'Sign in on whichever devices you want to keep in step. This browser is not signed in by opening a link.',
    verifyFailedHint:
      'A link works once and expires after a week. Ask for a new one from the account screen.',
    verifyGoToAccount: 'Go to the account',
    verifyPendingTitle: 'Confirm your address',
    verifyPendingBody: (address) =>
      `The account is disabled until you open the link sent to ${address}. Nothing syncs until then. If it never arrived, check the spam folder and then ask for another.`,
    verifyResend: 'Send the link again',
    verifyResent: 'On its way. It can take a minute.',
    verifyAlready: 'That address is already confirmed.',
    accountNewPassword: 'New password',
    accountRecoveryCode: 'Recovery code',
    accountDeviceName: 'Name for this browser',
    accountDeviceNameNote:
      'Shown in your list of devices, so you can tell them apart and sign one out.',
    accountManage: 'Manage the account',
    accountClosed:
      'This server is not taking new accounts at the moment. If you have one already, sign in — and if you have lost the password, the recovery code still works.',
    navSignIn: 'Login',
    accountEmail: 'Email address',
    accountEmailNote:
      'This is what you sign in with. It is used for nothing else \u2014 no newsletter, no analytics, and it is never passed to anybody.',
    accountHandleNote: 'The name on your account. You sign in with your address, not with this.',
    accountPasswordRule:
      'At least 12 characters. A phrase you will actually remember beats a short password with symbols in it. It cannot contain your pseudonym or your address.',
    accountRecoveryNote:
      'You also get a recovery code, once. Until this server can send email, that code is the only way back in if you forget your password \u2014 so keep it.',
    accountSignedInAs: 'Signed in as',
    accountDeviceIs: (name) => `This browser is registered as \u201c${name}\u201d.`,
    accountDevices: 'Devices',
    accountThisDevice: 'this one',
    accountLeaving: 'Signing out',
    accountSignOut: 'Sign out',
    accountSignOutKeeps:
      'Everything on this browser stays exactly where it is. Signing out forgets the account, not your collection, decks, plays or campaigns.',
    accountWhy: 'What an account is for',
    accountWhyBody:
      'One place your collection, decks, plays and campaigns live, so the same data is on your phone and in this browser. Until then, the backup file on the Collection page is how it travels.',
    accountPrivacy:
      'The server stores your records without reading them: it does not know what a card is. Your address is kept to sign you in and for nothing else. You can export everything or delete the account outright, and neither needs anybody\u2019s permission.',
    accountError: (code) =>
      ({
        invalid_credentials: 'That address and password do not match an account.',
        email_taken: 'There is already an account on this server with that address.',
        handle_taken: 'That pseudonym is taken on this server. Try another.',
        invalid_email: 'That does not look like an email address.',
        invalid_handle:
          'A pseudonym is 3 to 32 characters: letters, digits, dot, dash or underscore.',
        weak_password:
          'That password is too easy. Use at least 12 characters, and nothing containing your pseudonym or your address.',
        registration_closed: 'This server is not taking new accounts.',
        invalid_recovery_code: 'That recovery code is not right for this account.',
        rate_limited: 'Too many attempts. Wait a little and try again.',
        server_busy: 'The server is busy. Try again in a moment.',
        unauthorized: 'You have been signed out. Sign in again.',
        offline: 'The server could not be reached. Check your connection.',
      })[code] ?? 'Something went wrong on the server. Try again.',
    recoveryTitle: 'Keep this code',
    recoveryIntro:
      'This is shown once and never again. This server cannot send email yet, so until it can, this code is the only way back in if you forget your password. Save it somewhere you will still have it in a year.',
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
    bulkLabel: 'Add at once:',
    bulkAll: 'Everything',
    bulkCore: 'Core sets',
    bulkHeroes: 'Hero packs',
    bulkScenarios: 'Scenario packs',
    bulkCampaigns: 'Campaign boxes',
    bulkClear: 'Clear the collection',
    bulkClearConfirm: (owned) =>
      `This forgets all ${owned} packs, quantities included. It does not come back.`,
    bulkClearYes: 'Clear it',
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
    trackerStarredAcceleration:
      'This scheme accelerates by a starred amount that depends on the board, so nothing is added for it here — move the threat yourself at the end of the round.',
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
    syncTitle: 'Keeping this browser in step',
    syncSwitch: 'Sync this browser with the account',
    liveOn: 'Changes from your other devices arrive here as they happen.',
    liveOffline: 'Offline. Anything you record is kept and sent when you are back.',
    syncForkExplain:
      'The same deck was edited on two devices and neither version is safe to discard, so you get both: the second is renamed rather than overwritten. Nothing was duplicated, and nothing was lost.',
    syncSwitchNote:
      'Signing in only said who you are. This is what moves your collection, decks, games and campaigns between your devices.',
    autoSyncSwitch: 'Sync on its own',
    autoSyncNote:
      'Syncs at the moments where you are most likely to pick up the other device. This choice stays on this browser and is never carried to your other devices, so each one decides for itself.',
    autoSyncScenario: 'When a scenario ends, in a campaign or not',
    autoSyncCampaign: 'When a campaign ends',
    autoSyncBreak: 'When you put a game away for a long break',
    autoSyncDeck: 'When a deck is built or imported',
    autoSyncCollection: 'When your collection changes',
    autoSyncFavourite: 'When a card is added to your favourites',
    syncStaging: 'Reading the account. Nothing on this browser has been touched yet.',
    syncWorking: 'Working\u2026',
    syncOn: 'In step with the account.',
    syncNow: 'Sync now',
    syncStopped:
      'A batch did not get through, so the rest is still waiting. It will be sent again next time \u2014 nothing was applied twice.',
    syncDone: (pulled, pushed) =>
      pulled === 0 && pushed === 0 ?
        'Already in step. Nothing to move.'
      : `Brought down ${pulled} and sent up ${pushed}.`,
    syncAdoptTitle: 'Before anything moves',
    syncAdoptNothing: 'This browser and the account already hold the same thing. Nothing to merge.',
    syncAdoptKeeps:
      'Nothing here is deleted. What this browser has and the account does not is uploaded; what the account has and this browser does not comes down.',
    syncAdoptGo: 'Merge them',
    syncArriving: (n) => `${n} coming down`,
    syncUploading: (n) => `${n} going up`,
    syncMerging: (n) => `${n} to reconcile`,
    syncForkNote: (n) =>
      n === 1 ?
        'One deck was edited in both places. Nothing reconciles two card lists, so the account\u2019s copy keeps its name and yours is kept beside it as a second deck.'
      : `${n} decks were edited in both places. Nothing reconciles two card lists, so the account\u2019s copies keep their names and yours are kept beside them.`,
    collectionName: (collection) =>
      ({
        settings: 'Settings',
        owned_packs: 'Packs',
        excluded_modular_sets: 'Excluded modular sets',
        excluded_scenarios: 'Excluded scenarios',
        favourite_cards: 'Favourite cards',
        favourite_plays: 'Starred games',
        ratings: 'Difficulty ratings',
        saved_decks: 'Decks',
        campaign_runs: 'Campaigns',
        campaign_events: 'Campaign log',
        plays: 'Games',
        randomizer_history: 'Randomiser draws',
      })[collection] ?? collection,
    playWon: 'won',
    playLost: 'lost',
    bggUsername: 'BoardGameGeek username',
    bggNote:
      'Kept on this device only. It is never synced, never written to a backup, and no BoardGameGeek password is ever asked for or stored: you sign in to BoardGameGeek yourself, in this browser, and games are logged on their site.',
    bggOpenProfile: 'Open this profile on BoardGameGeek',
    bggLogPlay: 'Log on BGG',
    bggFollowUp: 'The form is open in another tab.',
    bggCopy: 'Copy the details',
    bggCopied: 'Copied',
    bggMark: 'Mark as logged',
    bggUnmark: 'Not logged on BGG after all',
    bggLogged: 'on BGG',
    playEdit: 'Edit',
    playAgain: 'Play again',
    playAgainModularNote:
      'Same scenario, difficulty and heroes as that game. The modular sets are not recorded on a game, so choose them again.',
    favouritePlayAdd: 'Star this game',
    favouritePlayRemove: 'Remove the star',
    historyFavouritesOnly: 'Starred only',
    favouriteGames: 'Starred games',
    favouriteGamesNote: 'Games you starred in the history, to lay out again in one tap.',
    extraModulars: 'Extra modular sets',
    extrasShortLocked: (scenario, available, extras) =>
      `Your collection has ${available} modular set${available === 1 ? '' : 's'} for ${scenario}; it cannot add ${extras}.`,
    extrasShortAll: (extras) =>
      `No scenario in your collection can take ${extras} extra modular set${extras === 1 ? '' : 's'}.`,
    extrasShortSome: (scenarios, extras) =>
      `${scenarios} scenario${scenarios === 1 ? '' : 's'} cannot take ${extras} extra${extras === 1 ? '' : 's'} and ${scenarios === 1 ? 'is' : 'are'} left out of this draw.`,
    playThisDraw: 'Play this game',
    modularSearch: 'Find a modular set\u2026',
    modularSelectedCount: (n) => (n === 1 ? '1 modular set' : `${n} modular sets`),
    modularRequired: 'Required by the scenario',
    modularShowAll: 'Show sets I do not own',
    modularNotOwned: 'Not in your collection',
    modularRemove: 'Remove',
    difficultyWord: (score) =>
      ['Effortless', 'Easy', 'Fair', 'Hard', 'Brutal', 'Impossible'][score] ?? String(score),
    ratingTitle: 'How hard was it?',
    ratingCampaignTitle: 'How hard was the campaign, all told?',
    ratingOptional: 'Optional. Your rating is yours to see; the community average appears once a subject has five.',
    ratingYours: 'Your rating',
    ratingClear: 'Clear',
    ratingCommunity: (mean, count) => `${mean.toFixed(1)} \u00b7 ${count} rating${count === 1 ? '' : 's'}`,
    ratingCountOnly: (count) => `${count} rating${count === 1 ? '' : 's'} so far`,
    ratingRejected: (count) =>
      count === 1
        ? 'One rating was refused by the server: it was for a game the server does not have. It has been removed.'
        : `${count} ratings were refused by the server: they were for games the server does not have. They have been removed.`,
    ratingRefreshing: 'Updating\u2026',
    playEditSave: 'Save the correction',
    playWhen: 'Played on',
    playResult: 'Result',
    playDelete: 'Delete',
    playDeleteConfirm: 'Delete this game? It does not come back.',
    playDeleteYes: 'Delete it',
    campaignsInProgress: 'In progress',
    campaignsFinished: 'Finished',
    campaignDelete: 'Delete this campaign',
    campaignDeleteConfirm: (plays, events) => {
      const log = `its log of ${events} ${events === 1 ? 'entry' : 'entries'}`;
      if (plays === 0) {
        return `This removes the campaign and ${log}. It does not come back.`;
      }
      const games =
        plays === 1 ? 'the game recorded against it' : `the ${plays} games recorded against it`;
      const leave = plays === 1 ? 'it leaves' : 'they leave';
      return `This removes the campaign, ${log}, and ${games} \u2014 so ${leave} your statistics too. It does not come back.`;
    },
    campaignDeleteYes: 'Delete it',
    campaignGames: 'Games recorded',
    statsGames: 'Every game',
    statsGamesNote:
      'Deleting a game removes it from every device and from these numbers. It stays here as a deleted row so the removal can reach your phone, and so it can be undone.',
    statsShowMore: (remaining) => `Show ${remaining} more`,
    statsShowFewer: 'Show fewer',
    statAverageGame: 'Average game',
    statLongestGame: 'Longest game',
    statCurrentStreak: 'Current streak',
    statBestStreak: 'Best streak',
    statCampaignGames: 'In a campaign',
    statSoloGroup: 'Solo / group',
    statsFilter: 'Filter the tables',
    statsSort: 'Sort',
    statsMeasure: 'Measure',
    sortMostPlayed: 'Most played',
    sortAlphabetical: 'A to Z',
    sortBestRate: 'Best rate',
    sortWorstRate: 'Worst rate',
    measureWinRate: 'Win rate',
    measureLossRate: 'Loss rate',
    measureShare: 'Share of games',
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
    trackEncounter: 'Suivre le vilain et la machination',
    trackEncounterNote:
      'Affiche les compteurs de points de vie et de menace pendant la partie. Désactivez-les si vous comptez sur la table.',
    playLocation: 'Où vous jouez',
    playLocationNote:
      'Rempli sur chaque partie enregistrée. Retenu depuis la dernière que vous avez saisie.',
    allTypes: 'Tous les types',
    allFactions: 'Toutes les factions',
    allPacks: 'Tous les paquets',
    allTraits: 'Tous les traits',
    costFrom: 'Coût de',
    costTo: 'à',
    ownedOnly: 'Seulement ce que je possède',
    favouritesOnly: 'Seulement les favorites',
    clearFilters: (active) => `Effacer ${active} filtre${active === 1 ? '' : 's'}`,
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
    navHistory: 'Historique',
    statsRecord: 'Bilan',
    statsSeeHistory: (games) =>
      `Voir les ${games} parties dans l'historique`,
    loadingGames: 'Lecture de vos parties…',
    historyTitle: 'Historique',
    historyFilters: "Restreindre l'historique",
    historyFrom: 'Du',
    historyTo: 'Au',
    historyAny: 'Toutes',
    historyResult: 'Résultat',
    historyInACampaign: 'En campagne',
    historyOutsideACampaign: 'Hors campagne',
    historyClear: 'Effacer les filtres',
    historyCount: (shown, total) =>
      shown === total ? `${total} parties` : `${shown} parties sur ${total}`,
    historyEmpty: 'Aucune partie enregistrée pour le moment.',
    historyEmptyHint:
      "Enregistrez-en une depuis Ma propre partie, ou importez une sauvegarde de l'application Android sur la page Ma collection. Tout ce que vous jouez apparaît ici.",
    historyNoMatches: 'Aucune partie ne correspond à ces filtres.',
    historyNoMatchesHint: 'Élargissez la période, ou effacez-les pour recommencer.',
    historyRunEmpty: 'Aucun scénario enregistré pour cette campagne.',
    historyDeleteConfirm:
      'Ceci retire la partie de tous vos appareils et de vos statistiques. Elle est conservée comme ligne supprimée, pour que la suppression circule et puisse être annulée.',
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
    winRateOf: (won, total) =>
      `${won} victoire${won === 1 ? '' : 's'} sur ${total} partie${total === 1 ? '' : 's'}`,
    timePlayed: (formatted) => `${formatted} de jeu`,
    wonOf: (won, played) => `${won}/${played}`,
    byHero: 'Par héros',
    byAspect: 'Par aspect',
    byHeroAspect: 'Par héros et aspect',
    byScenario: 'Par scénario',
    byDifficulty: 'Par difficulté',
    byPlayerCount: 'Par nombre de joueurs',
    playerBucket: (bucket) =>
      ({
        players_1: 'Solo',
        players_2: 'Deux joueurs ou deux mains',
        players_3: 'Trois joueurs',
        players_4: 'Quatre joueurs',
        players_5plus: 'Plus de quatre',
      })[bucket] ?? bucket,
    navDecks: 'Decks',
    deckName: 'Nom du deck',
    deckSave: 'Enregistrer',
    deckContents: 'Dans le deck',
    deckAddCards: 'Ajouter des cartes',
    deckEmpty: 'Encore vide. Cherchez \u00e0 droite et appuyez sur le plus.',
    deckHeroCards: 'Cartes du h\u00e9ros',
    deckTabDeck: 'Deck',
    deckTabPool: 'Cartes',
    deckProblems: (n) => (n === 1 ? '1 probl\u00e8me' : `${n} probl\u00e8mes`),
    factionLabel: 'Aspect',
    typeLabel: 'Type',
    sortLabel: 'Tri',
    sortByName: 'par nom',
    sortByCost: 'par co\u00fbt',
    deckHeroCardsFixed: 'Dans chaque deck de ce h\u00e9ros, au nombre imprim\u00e9.',
    deckAddHeroCards: 'Ajouter les cartes du h\u00e9ros',
    deckOwnedOnlyEmpty: 'Votre collection est vide, rien ne peut correspondre. Cochez vos paquets sur la page Collection, ou d\u00e9cochez ceci pour voir toutes les cartes.',
    deckStats: 'De quoi il est fait',
    deckCopy: 'Copier en texte',
    deckCopied: 'Copi\u00e9',
    deckEdit: 'Modifier',
    deckNew: 'Construire un deck',
    deckPickHero: 'H\u00e9ros',
    deckPickAspect: 'Aspect',
    deckCreate: 'Commencer',
    deckCardCount: (total, min, max) => `${total} cartes (${min}\u2013${max})`,
    deckAverageCost: (average) => `Co\u00fbt moyen ${average}`,
    deckResources: (physical, mental, energy, wild) =>
      `Ressources : ${physical} physique, ${mental} mental, ${energy} \u00e9nergie, ${wild} joker`,
    deckTooFew: (actual, required) => `Seulement ${actual} cartes. Un deck en demande ${required}.`,
    deckTooMany: (actual, allowed) => `${actual} cartes. Un deck en accepte ${allowed} au plus.`,
    deckWrongAspects: (actual, required) =>
      `${actual} aspect${actual === 1 ? '' : 's'} choisi${actual === 1 ? '' : 's'} ; ce h\u00e9ros en prend ${required}.`,
    deckOffAspect: (card) => `${card} n\u2019est pas dans un aspect que ce deck peut prendre.`,
    deckOverLimit: (card, quantity, limit) =>
      `${quantity} exemplaires de ${card}, et la limite est de ${limit}.`,
    deckDuplicateUnique: (card) =>
      `${card} est unique : un seul exemplaire, le h\u00e9ros compris.`,
    deckMissingRequired: (card, required, actual) =>
      `${card} fait partie des cartes du h\u00e9ros : ${required} attendue${required === 1 ? '' : 's'}, ${actual} dans le deck.`,
    deckUnbalanced: (counts) =>
      `Les aspects choisis doivent contribuer \u00e9galement (${counts}).`,
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
    navVersus: 'Comp\u00e9titif',
    versusTitle: 'Partie comp\u00e9titive',
    versusIntro:
      'Chaque \u00e9quipe construit un sc\u00e9nario et le donne \u00e0 l\u2019autre : ce qu\u2019une \u00e9quipe affronte ici, c\u2019est le leader et les manigances de l\u2019adversaire.',
    versusNeedsBox:
      'Le mode comp\u00e9titif demande une bo\u00eete qui le propose. Ajoutez-en une \u00e0 votre collection et il r\u00e9appara\u00eetra.',
    versusBox: 'Bo\u00eete',
    versusFaces: 'Cette \u00e9quipe affronte :',
    versusLeader: 'Leader',
    versusStageOne: 'Manigance principale, stade 1',
    versusStageTwo: 'Manigance principale, stade 2',
    versusPlayers: 'Joueurs dans cette \u00e9quipe',
    versusStart: 'Commencer la partie',
    versusEndRound: 'Finir le round sur les deux tableaux',
    versusRound: (round) => `Round ${round}`,
    versusWhoWon: 'Qui a gagn\u00e9 ?',
    versusTie: '\u00c9galit\u00e9',
    versusAgain: 'Une autre partie',
    versusTiebreakTitle: 'D\u00e9partages, dans l\u2019ordre',
    versusTiebreaks: [
      'L\u2019\u00e9quipe dont le deck manigance principale adverse n\u2019a pas d\u00e9pass\u00e9 le stade 1B.',
      'L\u2019\u00e9quipe avec le moins de sbires et de manigances annexes dans sa zone.',
      'L\u2019\u00e9quipe avec le moins de menace sur la manigance principale de sa zone.',
      'L\u2019\u00e9quipe dont les identit\u00e9s ont le plus de points de vie restants.',
      'L\u2019\u00e9quipe avec le moins d\u2019attachements sur son leader.',
    ],
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
    navCollection: 'Ma collection',
    navPlayShort: 'Jouer',
    navMore: 'Plus',
    hubStart: 'Commencer une partie',
    hubRandomDetail:
      'Laissez l’application choisir un scénario, des héros et des affinités parmi ce que vous possédez.',
    hubOwnDetail: 'Choisissez tout vous-même. L’application chronomètre la partie.',
    hubCampaignDetail: 'Démarrez une campagne, ou ouvrez-en une terminée.',
    hubPaused: 'Une partie vous attend',
    settingsGroupedPlay: 'Un seul onglet Jouer',
    settingsGroupedPlayHint:
      'Regroupe la partie aléatoire, votre propre partie, les campagnes et le compétitif derrière un seul onglet Jouer, comme l’application Android.',
    navMoreTitle: 'Tout le reste',
    settingsTitle: 'Paramètres',
    close: 'Fermer',

    accountTitle: 'Compte',
    accountSignIn: 'Se connecter',
    accountCreate: 'Cr\u00e9er un compte',
    accountForgot: 'Mot de passe oubli\u00e9',
    accountRecoverAction: 'R\u00e9initialiser le mot de passe',
    accountHandle: 'Pseudo',
    accountPassword: 'Mot de passe',
    savedOnServer: 'Sur le serveur',
    savedLocalOnly: 'Sur cet appareil seulement',
    registeredCheckMail: (address) =>
      `Le compte existe, et il est désactivé tant que vous n'avez pas ouvert le lien envoyé à ${address}. Regardez dans les indésirables s'il n'y est pas.`,
    registeredThenSignIn:
      "S'inscrire ne vous connecte pas. Ouvrez le lien, puis connectez-vous ici — sur cet appareil et sur ceux que vous voulez garder synchronisés.",
    accountYourData: 'Vos données',
    accountExport: 'Télécharger mes données',
    accountExporting: 'Préparation…',
    accountExportNote:
      "Tout ce que ce compte contient sur le serveur, dans le même fichier que l'application lit et écrit. À vous de le garder, de l'emporter ailleurs ou de le vérifier.",
    accountDeleteTitle: 'Supprimer ce compte',
    accountDelete: 'Supprimer mon compte',
    accountDeleteNote:
      "Supprime le compte et tout ce qui y est synchronisé : votre adresse, vos decks, vos parties, vos campagnes et votre collection. C'est définitif, et ce n'est pas la même chose que se déconnecter. Ce qui est sur cet appareil y reste.",
    accountDeleteConfirm:
      "Ceci supprime le compte et tout ce qui est sur le serveur. Aucun retour en arrière. Saisissez votre mot de passe pour confirmer.",
    accountDeleteYes: 'Supprimer définitivement',
    verifyTitle: 'Confirmation de votre adresse',
    verifyWorking: 'Un instant.',
    verifyDone: (handle) => `Confirmée. Le compte ${handle} fonctionne désormais.`,
    verifyDoneHint:
      'Connectez-vous sur les appareils que vous voulez garder synchronisés. Ouvrir un lien ne connecte pas ce navigateur.',
    verifyFailedHint:
      "Un lien ne sert qu'une fois et expire au bout d'une semaine. Demandez-en un nouveau depuis l'écran du compte.",
    verifyGoToAccount: 'Aller au compte',
    verifyPendingTitle: 'Confirmez votre adresse',
    verifyPendingBody: (address) =>
      `Le compte est désactivé tant que vous n'avez pas ouvert le lien envoyé à ${address}. Rien ne se synchronise d'ici là. S'il n'est jamais arrivé, regardez dans les indésirables puis demandez-en un autre.`,
    verifyResend: 'Renvoyer le lien',
    verifyResent: "C'est parti. Cela peut prendre une minute.",
    verifyAlready: 'Cette adresse est déjà confirmée.',
    accountNewPassword: 'Nouveau mot de passe',
    accountRecoveryCode: 'Code de r\u00e9cup\u00e9ration',
    accountDeviceName: 'Nom de ce navigateur',
    accountDeviceNameNote:
      'Affich\u00e9 dans la liste de vos appareils, pour les distinguer et pouvoir en d\u00e9connecter un.',
    accountManage: 'Gérer le compte',
    accountClosed:
      'Ce serveur n’accepte pas de nouveaux comptes pour l’instant. Si vous en avez déjà un, connectez-vous — et si vous avez perdu le mot de passe, le code de récupération fonctionne toujours.',
    navSignIn: 'Connexion',
    accountEmail: 'Adresse e-mail',
    accountEmailNote:
      'C\u2019est avec elle que vous vous connectez. Elle ne sert \u00e0 rien d\u2019autre : aucune lettre d\u2019information, aucune mesure d\u2019audience, et elle n\u2019est transmise \u00e0 personne.',
    accountHandleNote:
      'Le nom affich\u00e9 sur votre compte. Vous vous connectez avec votre adresse, pas avec lui.',
    accountPasswordRule:
      'Au moins 12 caract\u00e8res. Une phrase dont vous vous souviendrez vaut mieux qu\u2019un mot de passe court plein de symboles. Il ne peut contenir ni votre pseudo ni votre adresse.',
    accountRecoveryNote:
      'Vous recevez aussi un code de r\u00e9cup\u00e9ration, une seule fois. Tant que ce serveur ne peut pas envoyer d\u2019e-mail, ce code est le seul moyen de revenir si vous oubliez votre mot de passe : gardez-le.',
    accountSignedInAs: 'Connect\u00e9 en tant que',
    accountDeviceIs: (name) => `Ce navigateur est enregistr\u00e9 sous \u00ab\u00a0${name}\u00a0\u00bb.`,
    accountDevices: 'Appareils',
    accountThisDevice: 'celui-ci',
    accountLeaving: 'D\u00e9connexion',
    accountSignOut: 'Se d\u00e9connecter',
    accountSignOutKeeps:
      'Tout ce qui est sur ce navigateur reste exactement o\u00f9 c\u2019est. Se d\u00e9connecter oublie le compte, pas votre collection, vos decks, vos parties ni vos campagnes.',
    accountWhy: '\u00c0 quoi sert un compte',
    accountWhyBody:
      'Un seul endroit pour votre collection, vos decks, vos parties et vos campagnes, afin que les m\u00eames donn\u00e9es soient sur votre t\u00e9l\u00e9phone et dans ce navigateur. En attendant, le fichier de sauvegarde de la page Collection est la fa\u00e7on de les d\u00e9placer.',
    accountPrivacy:
      'Le serveur conserve vos enregistrements sans les lire : il ne sait pas ce qu\u2019est une carte. Votre adresse sert \u00e0 vous connecter et \u00e0 rien d\u2019autre. Vous pouvez tout exporter ou supprimer le compte, sans demander la permission \u00e0 personne.',
    accountError: (code) =>
      ({
        invalid_credentials: 'Cette adresse et ce mot de passe ne correspondent \u00e0 aucun compte.',
        email_taken: 'Un compte existe d\u00e9j\u00e0 sur ce serveur avec cette adresse.',
        handle_taken: 'Ce pseudo est d\u00e9j\u00e0 pris sur ce serveur. Essayez-en un autre.',
        invalid_email: 'Cela ne ressemble pas \u00e0 une adresse e-mail.',
        invalid_handle:
          'Un pseudo fait 3 \u00e0 32 caract\u00e8res : lettres, chiffres, point, tiret ou soulignement.',
        weak_password:
          'Ce mot de passe est trop simple. Utilisez au moins 12 caract\u00e8res, sans y mettre votre pseudo ni votre adresse.',
        registration_closed: 'Ce serveur n\u2019accepte pas de nouveaux comptes.',
        invalid_recovery_code: 'Ce code de r\u00e9cup\u00e9ration ne correspond pas \u00e0 ce compte.',
        rate_limited: 'Trop de tentatives. Patientez un peu avant de r\u00e9essayer.',
        server_busy: 'Le serveur est occupé. Réessayez dans un instant.',
        unauthorized: 'Vous avez \u00e9t\u00e9 d\u00e9connect\u00e9. Reconnectez-vous.',
        offline: 'Le serveur est injoignable. V\u00e9rifiez votre connexion.',
      })[code] ?? 'Une erreur est survenue sur le serveur. R\u00e9essayez.',
    recoveryTitle: 'Conservez ce code',
    recoveryIntro:
      'Il n\u2019est affich\u00e9 qu\u2019une seule fois. Ce serveur ne sait pas encore envoyer d\u2019e-mail : jusque-l\u00e0, ce code est le seul moyen de revenir si vous oubliez votre mot de passe. Rangez-le l\u00e0 o\u00f9 vous l\u2019aurez encore dans un an.',
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
    bulkLabel: 'Ajouter d\u2019un coup :',
    bulkAll: 'Tout',
    bulkCore: 'Bo\u00eetes de base',
    bulkHeroes: 'Paquets h\u00e9ros',
    bulkScenarios: 'Paquets sc\u00e9nario',
    bulkCampaigns: 'Bo\u00eetes de campagne',
    bulkClear: 'Vider la collection',
    bulkClearConfirm: (owned) =>
      `Ceci oublie les ${owned} paquets, quantit\u00e9s comprises. C\u2019est d\u00e9finitif.`,
    bulkClearYes: 'Vider',
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
    trackerStarredAcceleration:
      'Cette machination accélère d’un montant étoilé qui dépend du plateau : rien n’est ajouté ici pour elle, déplacez la menace vous-même à la fin du round.',
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
    syncTitle: 'Garder ce navigateur \u00e0 jour',
    syncSwitch: 'Synchroniser ce navigateur avec le compte',
    liveOn: 'Les modifications de vos autres appareils arrivent ici en direct.',
    liveOffline: "Hors ligne. Ce que vous enregistrez est conservé et envoyé à votre retour.",
    syncForkExplain:
      "Le même deck a été modifié sur deux appareils et aucune version ne peut être écartée sans risque : vous gardez les deux, la seconde étant renommée plutôt qu'écrasée. Rien n'a été dupliqué, et rien n'a été perdu.",
    syncSwitchNote:
      'Se connecter n\u2019a fait que dire qui vous \u00eates. Ceci d\u00e9place votre collection, vos decks, vos parties et vos campagnes entre vos appareils.',
    autoSyncSwitch: 'Synchroniser tout seul',
    autoSyncNote:
      "Synchronise aux moments où vous êtes le plus susceptible de prendre l'autre appareil. Ce choix reste sur ce navigateur et n'est jamais transmis à vos autres appareils : chacun décide pour lui-même.",
    autoSyncScenario: "À la fin d'un scénario, en campagne ou non",
    autoSyncCampaign: "À la fin d'une campagne",
    autoSyncBreak: 'Quand vous rangez une partie pour une longue pause',
    autoSyncDeck: "Quand un deck est créé ou importé",
    autoSyncCollection: 'Quand votre collection change',
    autoSyncFavourite: "Quand une carte est ajoutée à vos favoris",
    syncStaging: 'Lecture du compte. Rien n\u2019a encore \u00e9t\u00e9 modifi\u00e9 sur ce navigateur.',
    syncWorking: 'En cours\u2026',
    syncOn: '\u00c0 jour avec le compte.',
    syncNow: 'Synchroniser maintenant',
    syncStopped:
      'Un lot n\u2019est pas pass\u00e9 : le reste attend encore. Il sera renvoy\u00e9 la prochaine fois, et rien n\u2019a \u00e9t\u00e9 appliqu\u00e9 deux fois.',
    syncDone: (pulled, pushed) =>
      pulled === 0 && pushed === 0 ?
        'D\u00e9j\u00e0 \u00e0 jour. Rien \u00e0 d\u00e9placer.'
      : `${pulled} r\u00e9cup\u00e9r\u00e9${pulled === 1 ? '' : 's'}, ${pushed} envoy\u00e9${pushed === 1 ? '' : 's'}.`,
    syncAdoptTitle: 'Avant que quoi que ce soit ne bouge',
    syncAdoptNothing:
      'Ce navigateur et le compte ont d\u00e9j\u00e0 la m\u00eame chose. Rien \u00e0 fusionner.',
    syncAdoptKeeps:
      'Rien n\u2019est supprim\u00e9 ici. Ce que ce navigateur a et pas le compte est envoy\u00e9 ; ce que le compte a et pas ce navigateur est r\u00e9cup\u00e9r\u00e9.',
    syncAdoptGo: 'Fusionner',
    syncArriving: (n) => `${n} \u00e0 r\u00e9cup\u00e9rer`,
    syncUploading: (n) => `${n} \u00e0 envoyer`,
    syncMerging: (n) => `${n} \u00e0 r\u00e9concilier`,
    syncForkNote: (n) =>
      n === 1 ?
        'Un deck a \u00e9t\u00e9 modifi\u00e9 des deux c\u00f4t\u00e9s. Rien ne r\u00e9concilie deux listes de cartes : la copie du compte garde son nom et la v\u00f4tre est conserv\u00e9e \u00e0 c\u00f4t\u00e9, comme un second deck.'
      : `${n} decks ont \u00e9t\u00e9 modifi\u00e9s des deux c\u00f4t\u00e9s. Rien ne r\u00e9concilie deux listes de cartes : les copies du compte gardent leurs noms et les v\u00f4tres sont conserv\u00e9es \u00e0 c\u00f4t\u00e9.`,
    collectionName: (collection) =>
      ({
        settings: 'R\u00e9glages',
        owned_packs: 'Paquets',
        excluded_modular_sets: 'Sets modulaires exclus',
        excluded_scenarios: 'Sc\u00e9narios exclus',
        favourite_cards: 'Cartes favorites',
        favourite_plays: 'Parties favorites',
        ratings: 'Notes de difficult\u00e9',
        saved_decks: 'Decks',
        campaign_runs: 'Campagnes',
        campaign_events: 'Journal de campagne',
        plays: 'Parties',
        randomizer_history: 'Tirages al\u00e9atoires',
      })[collection] ?? collection,
    playWon: 'gagn\u00e9e',
    playLost: 'perdue',
    bggUsername: 'Identifiant BoardGameGeek',
    bggNote:
      "Conservé sur cet appareil uniquement. Il n'est jamais synchronisé, jamais écrit dans une sauvegarde, et aucun mot de passe BoardGameGeek n'est demandé ni conservé : vous vous connectez vous-même à BoardGameGeek, dans ce navigateur, et les parties sont enregistrées sur leur site.",
    bggOpenProfile: 'Ouvrir ce profil sur BoardGameGeek',
    bggLogPlay: 'Enregistrer sur BGG',
    bggFollowUp: "Le formulaire est ouvert dans un autre onglet.",
    bggCopy: 'Copier les détails',
    bggCopied: 'Copié',
    bggMark: 'Marquer comme enregistrée',
    bggUnmark: 'Finalement pas enregistrée sur BGG',
    bggLogged: 'sur BGG',
    playEdit: 'Modifier',
    playAgain: 'Rejouer',
    playAgainModularNote:
      'Même scénario, même difficulté et mêmes héros que cette partie. Les sets modulaires ne sont pas enregistrés sur une partie, choisissez-les à nouveau.',
    favouritePlayAdd: 'Mettre en favori',
    favouritePlayRemove: 'Retirer des favoris',
    historyFavouritesOnly: 'Favoris seulement',
    favouriteGames: 'Parties favorites',
    favouriteGamesNote: 'Les parties que vous avez mises en favori dans l’historique, à remettre en place en un geste.',
    extraModulars: 'Sets modulaires en plus',
    extrasShortLocked: (scenario, available, extras) =>
      `Votre collection a ${available} set${available === 1 ? '' : 's'} modulaire${available === 1 ? '' : 's'} pour ${scenario} : impossible d\u2019en ajouter ${extras}.`,
    extrasShortAll: (extras) =>
      `Aucun sc\u00e9nario de votre collection ne peut prendre ${extras} set${extras === 1 ? '' : 's'} modulaire${extras === 1 ? '' : 's'} en plus.`,
    extrasShortSome: (scenarios, extras) =>
      `${scenarios} sc\u00e9nario${scenarios === 1 ? '' : 's'} ne ${scenarios === 1 ? 'peut' : 'peuvent'} pas prendre ${extras} set${extras === 1 ? '' : 's'} en plus et ${scenarios === 1 ? 'est laiss\u00e9' : 'sont laiss\u00e9s'} de c\u00f4t\u00e9 pour ce tirage.`,
    playThisDraw: 'Jouer cette partie',
    modularSearch: 'Chercher un set modulaire\u2026',
    modularSelectedCount: (n) => (n === 1 ? '1 set modulaire' : `${n} sets modulaires`),
    modularRequired: 'Requis par le sc\u00e9nario',
    modularShowAll: 'Afficher les sets que je ne poss\u00e8de pas',
    modularNotOwned: 'Hors collection',
    modularRemove: 'Retirer',
    difficultyWord: (score) =>
      ['Une formalit\u00e9', 'Facile', '\u00c9quilibr\u00e9', 'Difficile', 'Brutal', 'Impossible'][score] ?? String(score),
    ratingTitle: 'C\u2019\u00e9tait difficile ?',
    ratingCampaignTitle: 'Et la campagne dans son ensemble, difficile ?',
    ratingOptional: 'Facultatif. Votre note reste visible pour vous ; la moyenne de la communaut\u00e9 appara\u00eet \u00e0 partir de cinq notes.',
    ratingYours: 'Votre note',
    ratingClear: 'Effacer',
    ratingCommunity: (mean, count) => `${mean.toFixed(1).replace('.', ',')} \u00b7 ${count} note${count === 1 ? '' : 's'}`,
    ratingCountOnly: (count) => `${count} note${count === 1 ? '' : 's'} pour l\u2019instant`,
    ratingRejected: (count) =>
      count === 1
        ? 'Une note a \u00e9t\u00e9 refus\u00e9e par le serveur : elle portait sur une partie qu\u2019il ne conna\u00eet pas. Elle a \u00e9t\u00e9 retir\u00e9e.'
        : `${count} notes ont \u00e9t\u00e9 refus\u00e9es par le serveur : elles portaient sur des parties qu\u2019il ne conna\u00eet pas. Elles ont \u00e9t\u00e9 retir\u00e9es.`,
    ratingRefreshing: 'Mise \u00e0 jour\u2026',
    playEditSave: 'Enregistrer la correction',
    playWhen: 'Jouée le',
    playResult: 'Résultat',
    playDelete: 'Supprimer',
    playDeleteConfirm: 'Supprimer cette partie ? C\u2019est d\u00e9finitif.',
    playDeleteYes: 'Supprimer',
    campaignsInProgress: 'En cours',
    campaignsFinished: 'Termin\u00e9es',
    campaignDelete: 'Supprimer cette campagne',
    campaignDeleteConfirm: (plays, events) => {
      const log = `son journal de ${events} entr\u00e9e${events === 1 ? '' : 's'}`;
      if (plays === 0) {
        return `Ceci supprime la campagne et ${log}. C\u2019est d\u00e9finitif.`;
      }
      const games =
        plays === 1 ?
          'la partie enregistr\u00e9e pour elle'
        : `les ${plays} parties enregistr\u00e9es pour elle`;
      const leave = plays === 1 ? 'elle quitte' : 'elles quittent';
      return `Ceci supprime la campagne, ${log} et ${games} \u2014 ${leave} donc aussi vos statistiques. C\u2019est d\u00e9finitif.`;
    },
    campaignDeleteYes: 'Supprimer',
    campaignGames: 'Parties enregistr\u00e9es',
    statsGames: 'Toutes les parties',
    statsGamesNote:
      'Supprimer une partie la retire de tous vos appareils et de ces chiffres. Elle reste ici comme ligne supprimée, pour que la suppression atteigne votre téléphone et puisse être annulée.',
    statsShowMore: (remaining) => `Afficher ${remaining} de plus`,
    statsShowFewer: 'Afficher moins',
    statAverageGame: 'Partie moyenne',
    statLongestGame: 'Partie la plus longue',
    statCurrentStreak: 'Série en cours',
    statBestStreak: 'Meilleure série',
    statCampaignGames: 'En campagne',
    statSoloGroup: 'Solo / groupe',
    statsFilter: 'Filtrer les tableaux',
    statsSort: 'Trier',
    statsMeasure: 'Mesure',
    sortMostPlayed: 'Les plus jouées',
    sortAlphabetical: 'De A à Z',
    sortBestRate: 'Meilleur taux',
    sortWorstRate: 'Pire taux',
    measureWinRate: 'Taux de victoire',
    measureLossRate: 'Taux de défaite',
    measureShare: 'Part des parties',
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
