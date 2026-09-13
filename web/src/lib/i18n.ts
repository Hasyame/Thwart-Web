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
  /**
   * What the document says about itself, per page: the title and description
   * a search engine files a page under and a shared link shows. lib/head.
   */
  readonly seo: {
    readonly homeTitle: string;
    readonly homeDescription: string;
    readonly cardTitle: string;
    readonly cardTitleNamed: (name: string) => string;
    readonly cardDescription: string;
    readonly collectionTitle: string;
    readonly collectionDescription: string;
    readonly randomizerTitle: string;
    readonly randomizerDescription: string;
    readonly versusTitle: string;
    readonly versusDescription: string;
    readonly playTitle: string;
    readonly playDescription: string;
    readonly campaignsTitle: string;
    readonly campaignsDescription: string;
    readonly rulesTitle: string;
    readonly rulesDescription: string;
    readonly decksTitle: string;
    readonly decksDescription: string;
    readonly historyTitle: string;
    readonly historyDescription: string;
    readonly statsTitle: string;
    readonly statsDescription: string;
    readonly accountTitle: string;
    readonly accountDescription: string;
    readonly bggTitle: string;
    readonly bggDescription: string;
    readonly notFoundTitle: string;
    readonly notFoundDescription: string;
  };
  /** The page for an address nothing answers to. */
  readonly notFoundTitle: string;
  readonly notFoundBody: string;
  readonly notFoundHome: string;
  /** The home page's own words, above the card search, for a first visit. */
  readonly homeIntroTitle: string;
  readonly homeIntro: string;
  readonly homeIntroLinks: {
    readonly collection: string;
    readonly play: string;
    readonly campaigns: string;
    readonly decks: string;
  };
  readonly homeIntroNote: string;
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
  /** A page's own chunk did not arrive. Reloading fetches the current build. */
  readonly pageLoadError: string;
  readonly retry: string;
  readonly noResults: string;
  readonly noResultsHint: string;
  readonly resultCount: (shown: number, total: number) => string;
  /** The button under a capped list, naming how many more it will show. */
  readonly showMore: (n: number) => string;
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
  /** The three links in the footer: funding, the phone, the source. */
  readonly footerPatreon: string;
  readonly footerAndroid: string;
  readonly footerSource: string;
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
  /** The shelf's head: whose decks, and how many of what. */
  readonly decksOf: (handle: string) => string;
  readonly decksOfThisBrowser: string;
  readonly decksCount: (n: number) => string;
  readonly foldersCount: (n: number) => string;
  readonly cardsInDecks: (n: number) => string;
  /** Folders on the shelf. */
  readonly folderLabel: string;
  readonly folderNone: string;
  readonly folderNew: string;
  readonly folderNamePlaceholder: string;
  readonly folderCreate: string;
  readonly folderRename: string;
  readonly folderDelete: string;
  readonly folderDeleteConfirm: (name: string) => string;
  readonly importDeck: string;
  readonly importDeckNote: string;
  readonly importAction: string;
  readonly importing: string;
  readonly deckImportNotFound: string;
  readonly deckImportNetwork: string;
  readonly noDecks: string;
  readonly removeDeck: string;
  /** A deck's own page: not found, the way back, the toolbar, the sections. */
  readonly deckNotFound: string;
  readonly deckBackToShelf: string;
  readonly deckSearchIn: string;
  readonly viewList: string;
  readonly viewGrid: string;
  readonly deckHeroLabel: string;
  readonly deckNemesis: string;
  readonly deckNemesisNote: string;
  /** Asked once before a deck goes; the same shape as a game's. */
  readonly deckDeleteConfirm: (name: string) => string;
  readonly deckDeleteYes: string;
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
  /** The tile's status badge: a word beside a glyph, never colour alone. */
  readonly campaignStatusNotStarted: string;
  readonly campaignStatusInProgress: string;
  readonly campaignStatusWon: string;
  readonly campaignStatusLost: string;
  readonly campaignStatusConceded: string;
  readonly campaignDetails: string;
  readonly campaignHideDetails: string;
  readonly campaignResultsLabel: (won: number, played: number) => string;
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
  /** Under "continue" on a defeat that settles nothing: the scenario is not failed. */
  readonly campaignContinueLeavesOpen: string;
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
  /** The BoardGameGeek page under Settings, laid out as the phone lays it out. */
  readonly bggTitle: string;
  readonly bggMenuSubtitle: string;
  readonly bggAboutTitle: string;
  readonly bggAbout: string;
  readonly bggConnectedAs: (username: string) => string;
  readonly bggNotConnected: string;
  readonly bggSignInTitle: string;
  readonly bggPassword: string;
  readonly bggPasswordWarning: string;
  readonly bggNeedsAccount: string;
  readonly bggRelayOff: string;
  readonly bggConnect: string;
  readonly bggVerifying: string;
  readonly bggLoginOk: string;
  readonly bggSyncTitle: string;
  readonly bggModeOff: string;
  readonly bggModeAsk: string;
  readonly bggModeAlways: string;
  readonly bggModeOffDetail: string;
  readonly bggModeAskDetail: string;
  readonly bggModeAlwaysDetail: string;
  readonly bggSynced: (n: number) => string;
  readonly bggDisconnect: string;
  readonly bggDisconnectConfirm: string;
  readonly bggSend: string;
  readonly bggSending: string;
  readonly bggSent: string;
  readonly bggSendFailed: (reason: string) => string;
  readonly bggError: (code: string) => string;
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

/**
 * The strings for a language, fetched when needed.
 *
 * Each language is its own chunk (lib/strings/en, lib/strings/fr), so the
 * bundle a visitor downloads carries one and not both: together they were a
 * third of what stood between a first visit and the first card. The promise
 * is kept per language, so a switch back and forth imports each once.
 */
const loaded: Partial<Record<Locale, Promise<Strings>>> = {};

export function loadStrings(locale: Locale): Promise<Strings> {
  loaded[locale] ??= (locale === 'fr'
    ? import('./strings/fr').then((m) => m.fr)
    : import('./strings/en').then((m) => m.en)
  ).catch((cause: unknown) => {
    // Not permanent: a flaky connection should not lock a language out for
    // the rest of the visit.
    delete loaded[locale];
    throw cause;
  });
  return loaded[locale];
}

/** The other language, for whoever switches: fetched in idle time. */
export function warmStrings(except: Locale): void {
  const other: Locale = except === 'fr' ? 'en' : 'fr';
  const run = (): void => void loadStrings(other).catch(() => undefined);
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 5000 });
  } else {
    setTimeout(run, 2000);
  }
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
