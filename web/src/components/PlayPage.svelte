<script lang="ts">
  import { liveQuery } from 'dexie';
  import type { CardSet, IndexRow, Locale } from '../lib/types';
  import Tracker from './Tracker.svelte';
  import { appSettings, setAppSettings } from '../lib/appsettings.svelte';
  import Briefing from './Briefing.svelte';
  import LongBreak from './LongBreak.svelte';
  import type { PausedGame, Play } from '../lib/records';
  import { inCampaign } from '../lib/playQuery';
  import {
    discardPausedGame,
    loadPausedGame,
    splitHeroes,
  } from '../lib/pausedGame';
  import type { Strings } from '../lib/i18n';
  import { db, SETTINGS_KEY } from '../lib/db';
  import { syncAfter } from '../lib/sync/auto.svelte';
  import { loadScenarioRules } from '../lib/data';
  import { composeFne, isFne, loadFneBox, needsVillain, splitFne, type FearNoEvilBox } from '../lib/fearNoEvil';
  import {
    buildPools,
    DIFFICULTIES,
    type DifficultyId,
    type Pools,
    type ScenarioRulesFile,
  } from '../lib/randomizer';
  import type { SavedDeck } from '../lib/records';
  import {
    elapsedMillis,
    endGame,
    formatElapsed,
    pauseGame,
    resumeGame,
    session,
    startGame,
    setElapsed,
    goToBriefing,
    backToSetup,
  } from '../lib/session.svelte';
  import { buildPlay } from '../lib/plays';
  import { achievements } from '../lib/achievements/store.svelte';
  import { newlyUnlocked } from '../lib/achievements/derive';
  import type { AchievementState, Unlock } from '../lib/achievements/types';
  import { pathForRoute } from '../lib/router';
  import { ScreenWakeLock } from '../lib/wakeLock.svelte';
  import { prepareSession, resumeSession, setupNotice, type Session } from '../lib/session.svelte';
  import { normalizeForSearch } from '../lib/normalize';
  import RatingPanel from './RatingPanel.svelte';
  import RatingBadge from './RatingBadge.svelte';
  import { RatingsInView } from '../lib/ratingsView.svelte';
  import { modularSubject, ratingOfPlay, scenarioSubject, subjectsOfPlay } from '../lib/ratings';
  import { bgg, bggCanSend, sendPlayToBgg } from '../lib/bgg.svelte';
  import { ApiError } from '../lib/sync/api';

  /* What the community thinks of the scenario chosen and the sets chosen
     with it, beside each, while the game is being set up. */
  const inView = new RatingsInView();
  $effect(() => {
    const scenario = session.current.scenarioCode;
    const chosen = [...session.current.modularSetCodes];
    void inView.show(scenario === '' ? null : scenario, chosen, storageOk);
    return () => inView.dispose();
  });

  interface Props {
    t: Strings;
    sets: readonly CardSet[];
    index: readonly IndexRow[];
    uiLocale: Locale;
    /** Which language the tracker reads the scenario's cards in. */
    cardLocale: Locale;
    storageOk: boolean;
    /** Lays a starred game out on this screen. Owned by App, which resolves it. */
    onReplay: (play: Play) => void;
  }

  const { t, sets, index, uiLocale, cardLocale, storageOk, onReplay }: Props = $props();

  /*
   * The starred games, joined to their plays.

   * The point of a star is that the game is easy to get back to, and "back to"
   * means here: the screen where it gets laid out. Read live, so a star put on
   * in the history is on this list when the person comes across.
   */
  let starred = $state.raw<readonly Play[]>([]);
  $effect(() => {
    if (!storageOk) {
      return;
    }
    const sub = liveQuery(async () => {
      const stars = await db.favouritePlays.orderBy('addedAt').reverse().toArray();
      const plays = await db.plays.bulkGet(stars.map((s) => s.playId));
      // A campaign's scenario may be starred, but it is played again from
      // its own campaign, and this list exists for the one-tap replay.
      return plays.filter(
        (p): p is Play => p !== undefined && (p.deletedAt ?? null) === null && !inCampaign(p),
      );
    }).subscribe((rows) => {
      starred = rows;
    });
    return () => sub.unsubscribe();
  });

  const tableOf = (play: Play): string =>
    (play.roster.length > 0 ? play.roster.map((s) => s.name) : [play.heroName])
      .filter((n) => n !== '')
      .join(', ');

  const owned = $state<{ packs: Set<string>; excludedSets: Set<string>; excludedScenarios: Set<string> }>({
    packs: new Set(),
    excludedSets: new Set(),
    excludedScenarios: new Set(),
  });

  $effect(() => {
    if (!storageOk) {
      return;
    }
    const subs = [
      liveQuery(() => db.ownedPacks.toArray()).subscribe((rows) => {
        owned.packs = new Set(rows.map((r) => r.packCode));
      }),
      liveQuery(() => db.excludedModularSets.toArray()).subscribe((rows) => {
        owned.excludedSets = new Set(rows.map((r) => r.setCode));
      }),
      liveQuery(() => db.excludedScenarios.toArray()).subscribe((rows) => {
        owned.excludedScenarios = new Set(rows.map((r) => r.scenarioCode));
      }),
    ];
    return () => subs.forEach((s) => s.unsubscribe());
  });

  const decks = $state<{ saved: readonly SavedDeck[] }>({ saved: [] });

  /** A deck's tags, as the phone stores them: one string, comma-separated. */
  const deckTags = (deckId: string | undefined): readonly string[] =>
    (decks.saved.find((deck) => deck.id === deckId)?.tags ?? '').split(',').map((t) => t.trim()).filter((t) => t !== '');

  $effect(() => {
    if (!storageOk) {
      return;
    }
    // Sorted here rather than by Dexie: `name` is not an index, and orderBy on
    // an unindexed field fails, which liveQuery reports as no rows at all.
    const sub = liveQuery(() => db.decks.toArray()).subscribe((rows) => {
      decks.saved = [...rows].sort((a, b) => a.name.localeCompare(b.name));
    });
    return () => sub.unsubscribe();
  });

  let rules = $state<ScenarioRulesFile | null>(null);
  $effect(() => {
    let cancelled = false;
    loadScenarioRules().then((r) => {
      if (!cancelled) {
        rules = r;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  /*
   * Fear No Evil's box, from its campaign template: on no card database, so
   * its scenarios cannot come through the rules file like the others. Null
   * until read, and then the box is simply not offered yet.
   */
  let fne = $state.raw<FearNoEvilBox | null>(null);
  $effect(() => {
    let cancelled = false;
    void loadFneBox().then((box) => {
      if (!cancelled) {
        fne = box;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  const pools = $derived.by((): Pools | null =>
    rules === null
      ? null
      : buildPools({
          rules,
          sets,
          index,
          ownedPackCodes: owned.packs,
          excludedModularSets: owned.excludedSets,
          excludedScenarios: owned.excludedScenarios,
          fne:
            fne === null || fne.packCode === null
              ? null
              : {
                  packCode: fne.packCode,
                  scenarios: fne.scenarios(cardLocale),
                  villains: fne.villains(cardLocale).map((v) => v.id),
                },
        }),
  );

  /** Set names from the card database; Fear No Evil's pairings from its template. */
  const setNames = $derived(
    new Map([...sets.map((s) => [s.code, s.name] as const), ...(fne === null ? [] : fne.names(cardLocale))]),
  );
  const villainNames = $derived(new Map((fne?.villains(cardLocale) ?? []).map((v) => [v.id, v.name] as const)));
  /** The job half of the chosen scenario, which is what the scenario picker shows. */
  const chosenJob = $derived(splitFne(session.current.scenarioCode).job);
  /** The subordinates the chosen job can be played against; empty for every other scenario. */
  const villainOptions = $derived(pools?.villainChoices[chosenJob] ?? []);


  /** Ticks the clock. One second is plenty for a game measured in hours. */
  let now = $state(Date.now());
  $effect(() => {
    if (session.current.runningSince === null) {
      return;
    }
    const handle = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(handle);
  });

  const elapsed = $derived(elapsedMillis(now));

  let putAway = $state.raw<PausedGame | null>(null);

  async function refreshPutAway(): Promise<void> {
    putAway = storageOk ? ((await loadPausedGame()) ?? null) : null;
  }

  $effect(() => {
    void refreshPutAway();
  });

  /**
   * Puts a written-down game back on the table.
   *
   * The counters are left to the tracker to rebuild from the scenario's own
   * cards: it has to load them anyway, and asking it to trust a number typed a
   * week ago over the card in front of the player would be the wrong way round.
   */
  async function resume(game: PausedGame): Promise<void> {
    resumeSession({
      scenarioCode: game.scenarioCode,
      scenarioName: game.scenarioName,
      difficulty: game.difficulty as typeof session.current.difficulty,
      seats: splitHeroes(game.heroes).map((hero) => ({
        deckId: hero.code,
        deckName: hero.name,
        heroCode: hero.code,
        heroName: hero.name,
        aspect: '',
      })),
      modularSetCodes: game.modularSetCodes.split(',').filter((code) => code !== ''),
      accumulatedMillis: game.elapsedMillis,
    });
    await discardPausedGame();
    await refreshPutAway();
  }

  async function throwAway(): Promise<void> {
    await discardPausedGame();
    await refreshPutAway();
  }

  const isExpert = $derived(
    DIFFICULTIES.find((d) => d.id === session.current.difficulty)?.expert === true,
  );

  /*
   * Fear No Evil's numbers, for the tracker: the template's, since the box is
   * on no card database. Null for every other scenario, and the tracker then
   * reads the cards as it always did.
   */
  const fneSetup = $derived(
    fne === null || !isFne(session.current.scenarioCode)
      ? null
      : fne.encounterSetup(session.current.scenarioCode, session.current.seats.length, isExpert, cardLocale),
  );

  // Setup is complete when there is a scenario, at least one seat, and — if
  // Expert was chosen — the Standard set it is played with.
  const canStart = $derived(
    session.current.scenarioCode !== '' &&
      session.current.seats.length > 0 &&
      (!isExpert || session.current.standardSet !== null) &&
      // A Fear No Evil job needs its villain before there is a game to start.
      !needsVillain(session.current.scenarioCode, pools?.villainChoices ?? {}),
  );

  function setScenario(code: string): void {
    setupNotice.text = null;
    session.current.scenarioCode = code;
    session.current.scenarioName = setNames.get(code) ?? code;
    // What the scenario mandates is on the table from the moment it is chosen,
    // and cannot be taken off: the picker shows those as required. Owned or
    // not — the person is saying what is in front of them, and the rules put
    // these there. docs/spec/ratings-and-modular-sets.md section 1.2.
    session.current.modularSetCodes = [...mandatedFor(code)];
    modularSearch = '';
  }

  const mandatedFor = (code: string): readonly string[] =>
    pools?.scenarios.find((rule) => rule.code === splitFne(code).job)?.mandatoryModulars ?? [];

  /** The other half of a Fear No Evil job: the scenario is the pair. */
  function setVillain(villainId: string): void {
    setScenario(composeFne(chosenJob, villainId));
  }

  function setDifficulty(id: DifficultyId): void {
    session.current.difficulty = id;
    if (DIFFICULTIES.find((d) => d.id === id)?.expert !== true) {
      session.current.standardSet = null;
    }
  }

  /**
   * Seats a deck.
   *
   * The same deck twice is allowed on purpose: two people at one table can
   * bring the same list, and refusing it would be the app inventing a rule.
   */
  function addSeat(deckId: string): void {
    const deck = decks.saved.find((d) => d.id === deckId);
    if (deck === undefined) {
      return;
    }
    session.current.seats = [
      ...session.current.seats,
      {
        deckId: deck.id,
        deckName: deck.name,
        heroCode: deck.heroCode,
        // The name the deck states, not one looked up: an imported deck can
        // name a hero this collection has never heard of.
        heroName: deck.heroName,
        aspect: deck.aspects === '' ? '' : deck.aspects.split(',').join(', '),
      },
    ];
  }

  function removeSeat(seatIndex: number): void {
    session.current.seats = session.current.seats.filter((_, i) => i !== seatIndex);
  }

  // --- recording -----------------------------------------------------------

  let notes = $state('');
  /**
   * Where games get played, from the app's preferences.
   *
   * Not asked for per game: the app keeps it as a setting, and a question the
   * answer to which is the same every time is a question worth not asking.
   * Empty unless a backup brought the setting over.
   */
  let location = $state('');

  $effect(() => {
    if (!storageOk) {
      return;
    }
    void db.appSettings.get(SETTINGS_KEY).then((settings) => {
      location = settings?.playLocation ?? '';
    });
  });

  /*
   * Whether the encounter tracker appears at all.
   *
   * On unless somebody has turned it off, including on a browser that has
   * never held the settings row — the tracker is most of why a companion is
   * open during a game, so absent reads as yes.
   */
  /* Absent means no, which is what the Android app means by it. */
  const trackEncounter = $derived(appSettings.value.trackEncounter === true);
  let victoryPoints = $state(0);
  /**
   * Won or lost, once the game is over and before it is written down.
   *
   * A separate step from playing, because the questions that belong at the end
   * are not questions to have on screen during the game: nobody knows their
   * victory points until it is over.
   */
  let outcome = $state<boolean | null>(null);
  let recorded = $state(false);
  /** The game just recorded, which is what the rating row is about. */
  let lastPlay = $state.raw<Play | null>(null);
  /**
   * The table the recorded game was played at, for "play again".
   *
   * Kept here because the session itself is ended the moment the game is
   * written down (see `record`), and the history's replay has to guess the
   * modular sets from the notes where this knows them exactly.
   */
  let lastTable = $state.raw<Partial<Session> | null>(null);

  /*
   * BoardGameGeek, after the game: sent on its own when the connection says
   * always, offered as a button when it says ask, and nothing when it says
   * off. Every failure is said here rather than swallowed — a play silently
   * not appearing on BGG is worse than one that says why.
   */
  let bggState = $state<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  let bggFailure = $state<string | null>(null);

  async function sendToBgg(play: Play): Promise<void> {
    if (bggState === 'sending' || bggState === 'sent') {
      return;
    }
    bggState = 'sending';
    bggFailure = null;
    try {
      await sendPlayToBgg(play, t.difficulty, uiLocale);
      lastPlay = { ...play, reportedToBgg: true };
      bggState = 'sent';
    } catch (cause) {
      bggFailure = t.bggError(cause instanceof ApiError ? cause.code : 'server_error');
      bggState = 'failed';
    }
  }
  let recording = $state(false);

  // --- the clock, corrected by hand ------------------------------------------

  let editingClock = $state(false);
  let clockMinutes = $state(0);

  function openClockEdit(): void {
    clockMinutes = Math.round(elapsed / 60_000);
    editingClock = true;
  }

  function applyClockEdit(): void {
    setElapsed(Math.max(0, clockMinutes) * 60_000);
    editingClock = false;
  }

  /** Keeping the screen on, where the browser allows it. See lib/wakeLock. */
  const wake = new ScreenWakeLock();

  $effect(() => {
    const reacquire = (): void => wake.reacquire();
    document.addEventListener('visibilitychange', reacquire);
    return () => {
      document.removeEventListener('visibilitychange', reacquire);
      wake.dispose();
    };
  });

  function finish(won: boolean): void {
    pauseGame();
    outcome = won;
  }

  /*
   * What the game just earned: the state before it was written, compared
   * with the state after the store has read it back. A delta, never the
   * whole list, and never more than three named.
   */
  let stateBefore = $state.raw<AchievementState | null>(null);
  let unlocks = $state.raw<readonly Unlock[]>([]);
  $effect(() => {
    const before = stateBefore;
    const after = achievements.state;
    if (before !== null && after !== null && after !== before) {
      unlocks = newlyUnlocked(before, after);
      stateBefore = null;
    }
  });
  const unlockTitle = (id: string): string => t.achievement[id]?.title ?? id;

  async function record(): Promise<void> {
    if (recording || outcome === null) {
      return;
    }
    const won = outcome;
    recording = true;
    stateBefore = achievements.state;
    unlocks = [];
    try {
      const play = buildPlay({
        session: session.current,
        elapsedMillis: elapsedMillis(Date.now()),
        won,
        notes,
        // Not asked for here. The app keeps it as a preference rather than a
        // question per game, and this browser has it only if a backup brought
        // it over.
        location,
        victoryPoints,
        modularSetNames: session.current.modularSetCodes.map(
          (code) => setNames.get(code) ?? code,
        ),
        // A deck the draft built carries the tag; the game then counts for
        // the draft achievements. docs/spec/achievements/data-model.md §5.
        ...(['draft', 'sealed'].find((mode) => deckTags(session.current.seats[0]?.deckId).includes(mode)) !== undefined
          ? { mode: ['draft', 'sealed'].find((mode) => deckTags(session.current.seats[0]?.deckId).includes(mode)) } : {}),
      });
      await db.plays.put(play);
      lastPlay = play;
      /*
       * Written down, so the game is over. Ending the session here rather
       * than on "Play another" is what lets somebody walk to the decks and
       * back without finding the finished game still on the table: the
       * debrief below lives in this page, not in the session, and leaving
       * the page is enough to put it away. The draft's and the achievements'
       * "play now" also refuse while a session is past setup.
       */
      const s = session.current;
      lastTable = {
        scenarioCode: s.scenarioCode,
        scenarioName: s.scenarioName,
        difficulty: s.difficulty,
        standardSet: s.standardSet,
        seats: [...s.seats],
        modularSetCodes: [...s.modularSetCodes],
      };
      endGame();
      // In the same tick, so the setup screen never flashes between the two.
      recorded = true;
      /*
       * Where you play is remembered rather than asked every time.
       *
       * It is a preference on both platforms, and this is the only moment the
       * app learns it: somebody who types a table into one game means it for
       * the next one too. Written only when it changed, so recording a game
       * does not touch a synced record for nothing.
       */
      if (location.trim() !== '' && location !== appSettings.value.playLocation) {
        await setAppSettings({ playLocation: location });
      }
      /*
       * The end of a scenario, which is the trigger that matters most.
       *
       * It is the moment somebody puts the browser down and might well pick a
       * phone up, and the whole point of auto-sync is that the game is already
       * there when they do.
       */
      syncAfter('scenario-end');
      bggState = 'idle';
      bggFailure = null;
      if (bggCanSend() && bgg.mode === 'always') {
        void sendToBgg(play);
      }
    } finally {
      recording = false;
    }
  }

  function newGame(): void {
    endGame();
    notes = '';
    victoryPoints = 0;
    outcome = null;
    recorded = false;
    lastPlay = null;
    lastTable = null;
    bggState = 'idle';
    bggFailure = null;
  }

  /*
   * The same game again: scenario, difficulty, decks and modular sets, laid
   * out on the setup screen rather than started, so a seat can still change.
   */
  function playAgain(): void {
    const table = lastTable;
    newGame();
    if (table !== null) {
      prepareSession(table);
      setupNotice.text = t.playAgainSameNote;
    }
  }

  const availableScenarios = $derived(
    [...(pools?.scenarios ?? [])].sort((a, b) =>
      (setNames.get(a.code) ?? a.code).localeCompare(setNames.get(b.code) ?? b.code),
    ),
  );

  /*
   * The modular set picker.
   *
   * No cap on how many, so it has to stay usable at twenty: a search, the
   * count in view, the chosen sets first with their own remove, the mandated
   * ones shown as placed and not removable, and the rest behind the search.
   * Sets outside the collection are offered behind one tap, marked, because
   * a friend's cards on the table are a real game; refusing them teaches
   * people to tick packs they do not own.
   */
  let modularSearch = $state('');
  let showAllModulars = $state(false);

  const ownedModularCodes = $derived(new Set((pools?.modularSets ?? []).map((set) => set.code)));
  const everyModular = $derived(
    [...sets.filter((set) => set.type === 'modular')].sort((a, b) => a.name.localeCompare(b.name)),
  );
  const mandated = $derived(new Set(mandatedFor(session.current.scenarioCode)));
  /** Chosen by hand, in the order chosen; the mandated ones are shown apart. */
  const chosenModulars = $derived(
    session.current.modularSetCodes
      .filter((code) => !mandated.has(code))
      .map((code) => everyModular.find((set) => set.code === code) ?? { code, name: code, type: 'modular', packCode: '' }),
  );
  const mandatedModulars = $derived(
    [...mandated].map((code) => everyModular.find((set) => set.code === code) ?? { code, name: code, type: 'modular', packCode: '' }),
  );
  const offeredModulars = $derived.by(() => {
    const needle = normalizeForSearch(modularSearch.trim());
    return everyModular.filter(
      (set) =>
        !mandated.has(set.code) &&
        !session.current.modularSetCodes.includes(set.code) &&
        (showAllModulars || ownedModularCodes.has(set.code)) &&
        (needle === '' || normalizeForSearch(set.name).includes(needle)),
    );
  });

  function addModular(code: string): void {
    if (!session.current.modularSetCodes.includes(code)) {
      session.current.modularSetCodes = [...session.current.modularSetCodes, code];
    }
  }

  function removeModular(code: string): void {
    if (!mandated.has(code)) {
      session.current.modularSetCodes = session.current.modularSetCodes.filter((c) => c !== code);
    }
  }
</script>

<section>
  <h1 class="comic-title">{t.playTitle}</h1>

  {#if !storageOk}
    <div class="notice surface"><p>{t.storageUnavailable}</p></div>
  {:else if pools === null}
    <p class="notice muted">{t.loading}</p>
  {:else if owned.packs.size === 0}
    <div class="notice surface"><p>{t.randomizerNoCollection}</p><a class="btn btn--primary" href="/collection">{t.navCollection}</a></div>
  {:else if recorded}
    <div class="notice surface">
      <p class="ok">{t.playRecorded}</p>
      {#if lastPlay !== null && bggCanSend() && bgg.mode !== 'off'}
        {@const sending = lastPlay}
        <!-- The BGG line: what happened, or the offer. Never a step. -->
        {#if bggState === 'sent'}
          <p class="ok">{t.bggSent}</p>
        {:else if bggState === 'failed'}
          <p class="danger-text" role="alert">{t.bggSendFailed(bggFailure ?? '')}</p>
          <button type="button" class="btn" onclick={() => void sendToBgg(sending)}>{t.bggSend}</button>
        {:else if bggState === 'sending'}
          <p class="muted">{t.bggSending}</p>
        {:else if bgg.mode === 'ask'}
          <button type="button" class="btn" onclick={() => void sendToBgg(sending)}>{t.bggSend}</button>
        {/if}
      {/if}
      <div class="result-actions">
        {#if lastTable !== null}
          <button type="button" class="btn btn--primary" onclick={playAgain}>{t.playAgain}</button>
        {/if}
        <button type="button" class="btn" class:btn--primary={lastTable === null} onclick={newGame}>{t.playAnother}</button>
      </div>
    </div>
    {#if unlocks.length > 0}
      <!-- Said once, here, for what this game earned; the page says the rest. -->
      <div class="surface unlocks" role="status">
        <p>
          <strong>{unlocks.length === 1 ? t.achievements.toastOne(unlockTitle(unlocks[0]?.id ?? '')) : t.achievements.toastMany(unlocks.length)}</strong>
          {#if unlocks.length > 1}<span class="muted"> · {unlocks.slice(0, 3).map((u) => unlockTitle(u.id)).join(', ')}{unlocks.length > 3 ? '…' : ''}</span>{/if}
        </p>
        <a class="btn btn--quiet" href={pathForRoute({ name: 'achievements' }, '')}>{t.achievements.toastOpen}</a>
      </div>
    {/if}
    {#if lastPlay !== null}
      {@const rated = lastPlay}
      <!--
        Optional, after the result is saved, never before and never as a step:
        the scenario, then each modular set that was on the table. Closing the
        page without answering is not a state anyone has to confirm.
      -->
      <RatingPanel
        {t}
        {storageOk}
        title={t.ratingTitle}
        subjects={subjectsOfPlay(rated, sets)}
        labelOf={(s) => setNames.get(s.code) ?? s.code}
        subOf={(s) => (s.kind === 'modular' ? undefined : t.scenario)}
        build={(s, score) => ratingOfPlay(s, score, rated)}
      />
    {/if}
  {:else if session.current.phase === 'setup'}
    <p class="muted note">{t.playSetupNote}</p>

    {#if setupNotice.text !== null}
      <!--
        How this game got here, said once.

        After "play again", the seats and the scenario are already filled in
        and it is worth a line saying what was carried over and what was not —
        the modular sets are the thing people would otherwise wonder about.
        Cleared on dismiss or on the next game, so it never becomes furniture.
      -->
      <div class="notice surface replay-note" role="status">
        <p>{setupNotice.text}</p>
        <button class="btn btn--quiet small" type="button" onclick={() => (setupNotice.text = null)}>
          {t.close}
        </button>
      </div>
    {/if}

    {#if starred.length > 0 && session.current.phase === 'setup'}
      <div class="setup surface">
        <h2>{t.favouriteGames}</h2>
        <p class="muted note">{t.favouriteGamesNote}</p>
        <ul class="starred">
          {#each starred as play (play.id)}
            <li>
              <span class="words">
                <span class="scenario">{play.scenarioName || play.scenarioCode}</span>
                <span class="muted sub">{tableOf(play)}</span>
              </span>
              <button class="btn small" type="button" onclick={() => onReplay(play)}>
                {t.playAgain}
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <div class="setup surface">
      <label class="field-group">
        <span class="field-label">{t.scenario}</span>
        <select class="field"
          value={chosenJob}
          onchange={(e) => setScenario(e.currentTarget.value)}
        >
          <option value="">{t.choose}</option>
          {#each availableScenarios as rule (rule.code)}
            <option value={rule.code}>{setNames.get(rule.code) ?? rule.code}</option>
          {/each}
        </select>
        {#if session.current.scenarioCode !== '' && !isFne(session.current.scenarioCode)}
          <RatingBadge {t} summary={inView.forScenario(session.current.scenarioCode)} own={inView.ownFor(scenarioSubject(session.current.scenarioCode).key)} />
        {/if}
      </label>

      {#if villainOptions.length > 0}
        <!-- A Fear No Evil job is played against one of the box's
             subordinates, chosen here: the job is not a scenario until it
             has one, so the question follows the job at once. -->
        <label class="field-group">
          <span class="field-label">{t.villain}</span>
          <select class="field"
            value={splitFne(session.current.scenarioCode).villain ?? ''}
            onchange={(e) => setVillain(e.currentTarget.value)}
          >
            <option value="">{t.choose}</option>
            {#each [...villainOptions].sort((a, b) => (villainNames.get(a) ?? a).localeCompare(villainNames.get(b) ?? b)) as id (id)}
              <option value={id}>{villainNames.get(id) ?? id}</option>
            {/each}
          </select>
        </label>
      {/if}

      <label class="field-group">
        <span class="field-label">{t.difficultyLabel}</span>
        <select class="field"
          value={session.current.difficulty}
          onchange={(e) => setDifficulty(e.currentTarget.value as DifficultyId)}
        >
          {#each pools.difficulties as id (id)}
            <option value={id}>{t.difficulty(id)}</option>
          {/each}
        </select>
      </label>

      {#if isExpert}
        <!-- An Expert set is played with a Standard one, so choosing Expert
             leaves a second question to answer. -->
        <label class="field-group">
          <span class="field-label">{t.standardSetWith}</span>
          <select class="field"
            value={session.current.standardSet ?? ''}
            onchange={(e) =>
              (session.current.standardSet =
                e.currentTarget.value === ''
                  ? null
                  : (e.currentTarget.value as DifficultyId))}
          >
            <option value="">{t.choose}</option>
            {#each pools.difficulties.filter((id) => DIFFICULTIES.find((d) => d.id === id)?.expert === false) as id (id)}
              <option value={id}>{t.difficulty(id)}</option>
            {/each}
          </select>
        </label>
      {/if}
    </div>

    <div class="setup surface">
      <div class="head">
        <h2>{t.seats}</h2>
      </div>

      {#if decks.saved.length === 0}
        <!-- Seats are decks, so with no decks there is nothing to seat. -->
        <p class="muted note">{t.noDecksForPlay}</p>
        <a class="btn" href="/decks">{t.navDecks}</a>
      {:else}
        <label class="field-group">
          <span class="field-label">{t.addDeck}</span>
          <select class="field"
            value=""
            onchange={(e) => {
              addSeat(e.currentTarget.value);
              e.currentTarget.value = '';
            }}
            disabled={session.current.seats.length >= 4}
          >
            <option value="">{t.choose}</option>
            {#each decks.saved as deck (deck.id)}
              <option value={deck.id}>{deck.name} · {deck.heroName}</option>
            {/each}
          </select>
        </label>
      {/if}

      {#if session.current.seats.length === 0}
        <p class="muted note">{t.noSeatsYet}</p>
      {/if}

      {#each session.current.seats as seat, i (i)}
        <div class="seat surface">
          <span class="seat-body">
            <!-- The deck name leads, because that is what its owner
                 recognises; the hero and aspects follow. -->
            <strong>{seat.deckName}</strong>
            <span class="muted seat-sub">
              {seat.heroName}{seat.aspect === ''
                ? ''
                : ` · ${seat.aspect
                    .split(',')
                    .map((a) => t.aspect(a.trim()))
                    .join(' / ')}`}
            </span>
          </span>
          <button type="button" class="btn small" onclick={() => removeSeat(i)}>×</button>
        </div>
      {/each}
    </div>

    {#if putAway !== null}
      {@const saved = putAway}
      <div class="notice surface">
        <p>
          <strong>{t.savedGame(saved.scenarioName, new Date(saved.savedAt).toLocaleDateString())}</strong>
        </p>
        <p class="muted note">{t.savedGameNote}</p>
        <div class="result-actions">
          <button class="btn btn--primary" type="button" onclick={() => resume(saved)}>
            {t.resumeSaved}
          </button>
          <button class="btn" type="button" onclick={throwAway}>{t.discardSaved}</button>
        </div>
      </div>
    {/if}

    {#if session.current.scenarioCode !== ''}
      <div class="setup surface picker">
        <div class="picker-head">
          <h2>{t.modularSets}</h2>
          <!-- Live, so the count is heard as it changes. -->
          <span class="muted count" aria-live="polite">
            {t.modularSelectedCount(session.current.modularSetCodes.length)}
          </span>
        </div>
        <p class="muted note">{t.modularChooseNote}</p>

        {#if mandatedModulars.length > 0}
          <ul class="chosen" aria-label={t.modularRequired}>
            {#each mandatedModulars as set (set.code)}
              <li class="chip required">
                <span>{set.name}</span>
                <span class="muted tag">{t.modularRequired}</span>
              </li>
            {/each}
          </ul>
        {/if}

        {#if chosenModulars.length > 0}
          <ul class="chosen">
            {#each chosenModulars as set (set.code)}
              <li class="chip">
                <span>{set.name}</span>
                {#if !ownedModularCodes.has(set.code)}
                  <span class="muted tag">{t.modularNotOwned}</span>
                {/if}
                <RatingBadge {t} summary={inView.forSet(session.current.scenarioCode, set.code)} own={inView.ownFor(modularSubject(set.code, session.current.scenarioCode).key)} />
                <button
                  type="button"
                  class="remove"
                  aria-label={`${t.modularRemove} ${set.name}`}
                  onclick={() => removeModular(set.code)}
                >
                  ×
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        <!-- 16px, so iOS does not zoom the page when it is focused. -->
        <input
          class="field search"
          type="search"
          placeholder={t.modularSearch}
          aria-label={t.modularSearch}
          value={modularSearch}
          oninput={(e) => (modularSearch = e.currentTarget.value)}
        />

        <div class="options">
          {#each offeredModulars as set (set.code)}
            <button type="button" class="offer" onclick={() => addModular(set.code)}>
              <span aria-hidden="true">+</span>
              <span>{set.name}</span>
              {#if !ownedModularCodes.has(set.code)}
                <span class="muted tag">{t.modularNotOwned}</span>
              {/if}
            </button>
          {/each}
        </div>

        <label class="tick show-all">
          <input type="checkbox" checked={showAllModulars} onchange={(e) => (showAllModulars = e.currentTarget.checked)} />
          <span>{t.modularShowAll}</span>
        </label>
      </div>
    {/if}

    <button class="btn btn--primary big" type="button" onclick={goToBriefing} disabled={!canStart}>
      {t.goToSetup}
    </button>
  {:else if session.current.phase === 'briefing'}
    <Briefing {t} {cardLocale} {index} setNames={setNames} />

    <div class="result-actions">
      <button class="btn btn--primary big" type="button" onclick={startGame}>{t.play}</button>
      <button class="btn" type="button" onclick={backToSetup}>{t.backToSetup}</button>
    </div>
    <p class="muted note">{t.clockStartsNote}</p>
  {:else if outcome === null}
    {#if trackEncounter}
      <Tracker {t} {cardLocale} {index} expert={isExpert} setup={fneSetup} />
    {/if}
    <div class="running surface" class:compact={trackEncounter}>
      <!-- Name, heroes and encounter deck at the top, as the app has it: the
           three things somebody glances up to check mid-game. -->
      <p class="scenario">{session.current.scenarioName}</p>
      <p class="heroes">{session.current.seats.map((seat) => seat.heroName).join(', ')}</p>
      {#if session.current.modularSetCodes.length > 0}
        <p class="muted">
          {session.current.modularSetCodes.map((code) => setNames.get(code) ?? code).join(', ')}
        </p>
      {/if}

      <button class="clock" type="button" onclick={openClockEdit}>
        {formatElapsed(elapsed)}
      </button>
      <p class="muted note tap">{t.tapToCorrect}</p>

      {#if editingClock}
        <label class="field-group">
          <span class="field-label">{t.correctTheClock}</span>
          <input class="field"
            type="number"
            min="0"
            inputmode="numeric"
            bind:value={clockMinutes}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                applyClockEdit();
              }
            }}
          />
        </label>
        <div class="clock-actions">
          <button class="btn btn--primary" type="button" onclick={applyClockEdit}>{t.saveResult}</button>
          <button class="btn" type="button" onclick={() => (editingClock = false)}>{t.cancel}</button>
        </div>
      {/if}

      <div class="clock-actions">
        {#if session.current.runningSince === null}
          <button class="btn" type="button" onclick={resumeGame}>{t.resumeClock}</button>
        {:else}
          <button class="btn" type="button" onclick={pauseGame}>{t.pauseClock}</button>
        {/if}
      </div>

      <LongBreak {t} {storageOk} onSaved={refreshPutAway} />
    </div>

    <label class="awake surface">
      <span>{t.keepScreenOn}</span>
      <input type="checkbox" checked={wake.on} onchange={(e) => void wake.set(e.currentTarget.checked)} />
    </label>

    <div class="ending">
      <button class="btn btn--primary big" type="button" onclick={() => finish(true)}>{t.won}</button>
      <button class="btn big" type="button" onclick={() => finish(false)}>{t.lost}</button>
    </div>
    <button class="forget" type="button" onclick={newGame}>{t.discardGame}</button>

  {:else}
    <!-- The end of the game, and the only place the questions that need an
         ending belong: nobody knows their victory points until it is over. -->
    <div class="setup surface">
      <h2>{outcome ? t.won : t.lost}</h2>
      <p class="muted">
        {session.current.scenarioName} · {t.difficulty(session.current.difficulty)}{session
          .current.standardSet === null
          ? ''
          : ` + ${t.difficulty(session.current.standardSet)}`}
      </p>
      <p class="clock">{formatElapsed(elapsed)}</p>
      <p class="muted note">{t.timePlayedLabel}</p>

      <label class="field-group">
        <span class="field-label">{t.victoryPoints}</span>
        <input class="field"
          type="number"
          min="0"
          inputmode="numeric"
          value={victoryPoints}
          oninput={(e) => (victoryPoints = Number.parseInt(e.currentTarget.value, 10) || 0)}
        />
      </label>
      <label class="field-group">
        <span class="field-label">{t.notes}</span>
        <textarea class="field" rows="2" value={notes} oninput={(e) => (notes = e.currentTarget.value)}
        ></textarea>
      </label>

      <div class="result-actions">
        <button class="btn btn--primary" type="button" onclick={record} disabled={recording}>
          {t.saveResult}
        </button>
        <button class="btn" type="button" onclick={() => (outcome = null)} disabled={recording}>
          {t.backToGame}
        </button>
      </div>
    </div>
  {/if}
</section>

<style>
  .running.compact { padding: var(--space-3); }
  .compact .clock { font-size: var(--text-xl); margin-top: var(--space-2); min-height: var(--tap-min); }
  .compact p { margin-block: var(--space-1); }
  h1 {
    font-size: var(--text-2xl);
    margin: var(--space-5) 0 var(--space-3);
  }

  h2 {
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin: 0;
  }

  .notice,
  .setup,
  .running {
    padding: var(--space-4);
    margin: var(--space-3) 0;
  }

  .starred {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .starred li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .starred .words {
    display: grid;
    min-width: 0;
  }

  .starred .scenario {
    font-weight: var(--weight-semibold);
  }

  .starred .sub {
    font-size: var(--text-sm);
  }

  .replay-note {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .replay-note p {
    margin: 0;
  }

  .note {
    font-size: var(--text-sm);
    max-width: var(--prose-max);
  }

  .setup {
    display: grid;
    gap: var(--space-3);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-width: 26rem;
  }

  .seat {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
  }

  .seat-body {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .seat-sub {
    font-size: var(--text-sm);
  }

  .big {
    padding: var(--space-3) var(--space-6);
    font-size: var(--text-lg);
    margin-top: var(--space-2);
  }

  .small {
    padding: var(--space-1) var(--space-3);
  }

  .options {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(13rem, 100%), 1fr));
    gap: var(--space-1) var(--space-3);
  }

  .picker-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .picker-head h2 {
    margin: 0;
  }

  .picker .search {
    margin-block: var(--space-3);
    font-size: 16px;
  }

  .chosen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--tap-min);
    padding-inline: var(--space-3) var(--space-1);
    border: 1px solid var(--accent);
    border-radius: var(--radius-pill);
    color: var(--text);
  }

  .chip.required {
    border-color: var(--hairline);
    background: var(--surface-2);
    padding-inline-end: var(--space-3);
  }

  .chip .remove {
    display: grid;
    place-items: center;
    width: var(--tap-min);
    height: var(--tap-min);
    border: 0;
    border-radius: var(--radius-pill);
    background: none;
    color: var(--text-muted);
    font-size: var(--text-lg);
    cursor: pointer;
  }

  .chip .remove:hover {
    color: var(--accent);
  }

  .tag {
    font-size: var(--text-sm);
  }

  .offer {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--tap-min);
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    text-align: start;
    cursor: pointer;
  }

  .offer:hover {
    background: var(--surface-2);
  }

  .show-all {
    margin-top: var(--space-3);
  }

  .tick {
    font-size: var(--text-sm);
  }

  .tap {
    text-align: center;
    font-size: var(--text-xs);
  }

  .scenario {
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--accent);
    text-align: center;
  }

  .heroes {
    text-align: center;
    font-weight: 600;
  }

  .awake {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    margin: var(--space-3) 0;
  }

  .ending {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }

  .ending .big {
    flex: 1 1 10rem;
  }

  /* A text link rather than a button: forgetting a game is not a thing to
     reach for by accident. */
  .forget {
    display: block;
    margin: var(--space-4) auto 0;
    border: 0;
    background: none;
    color: var(--danger);
    font-weight: 600;
    cursor: pointer;
  }

  /* A button now, because tapping it corrects it, but it must not look like
     one: it is the biggest thing on the screen and the game is what it counts. */
  .clock {
    display: block;
    width: 100%;
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
    font-size: var(--text-4xl);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: center;
    margin: var(--space-3) 0 0;
    padding: 0;
  }

  .clock:hover {
    color: var(--accent);
  }

  .clock-actions,
  .result-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .ok {
    color: var(--accent);
    font-weight: 600;
  }

  .danger-text {
    color: var(--danger);
  }

  .unlocks {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    margin: var(--space-3) 0;
    border-color: var(--gold);
  }

  .unlocks p {
    margin: 0;
  }
</style>
