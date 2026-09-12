<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { IndexRow, Locale } from '../lib/types';
  import type { CampaignRun, Play, SavedDeck } from '../lib/records';
  import { db } from '../lib/db';
  import { loadCardsByCode } from '../lib/data';
  import { setupSteps } from '../lib/schemeSetup';
  import { endGame, formatElapsed, resumeSession, session } from '../lib/session.svelte';
  import { evaluate } from '../lib/campaign/conditions';
  import { fold, type HeroCardStats } from '../lib/campaign/engine';
  import { choosableScenarios } from '../lib/campaign/rules';
  import { buildCampaignPlay } from '../lib/campaign/play';
  import { syncAfter } from '../lib/sync/auto.svelte';
  import { bgg, bggCanSend, sendPlayToBgg } from '../lib/bgg.svelte';
  import { ApiError } from '../lib/sync/api';
  import {
    currentScenario,
    encounterSetsOf,
    isExpertCampaign,
    trackedSetCode,
    trackerSetupFor,
  } from '../lib/campaign/encounter';
  import { parseCampaignText, type TextContext } from '../lib/campaign/text';
  import {
    counterOf,
    heroCounterOf,
    textOf,
    type AnswerSet,
    type CampaignEvent,
    type CampaignState,
    type LocalizedText,
    type Outcome,
  } from '../lib/campaign/types';
  import {
    acknowledgeEnvironments,
    chooseScenario,
    concede,
    continueOutcome,
    ensureDealt,
    eventsOf,
    keepDrawnCard,
    pauseTimer,
    recordResult,
    setTimerElapsed,
    startTimer,
    takeSetupAction,
    templateOf,
    timerElapsed,
    timerRunning,
  } from '../lib/campaign/store';
  import CampaignBriefing from './CampaignBriefing.svelte';
  import RatingPanel from './RatingPanel.svelte';
  import { campaignSubject, ratingOfRun } from '../lib/ratings';
  import CampaignMarket from './CampaignMarket.svelte';
  import CampaignPlaying from './CampaignPlaying.svelte';
  import CampaignQuestions from './CampaignQuestions.svelte';
  import CampaignText from './CampaignText.svelte';

  interface Props {
    t: Strings;
    uiLocale: Locale;
    cardLocale: Locale;
    run: CampaignRun;
    index: readonly IndexRow[];
    /** Card names by code, so a template's card codes read as cards. */
    cardNames: ReadonlyMap<string, string>;
    setNames: ReadonlyMap<string, string>;
    decks: readonly SavedDeck[];
    storageOk: boolean;
    onBack: () => void;
  }

  const {
    t,
    uiLocale,
    cardLocale,
    run,
    index,
    cardNames,
    setNames,
    decks,
    storageOk,
    onBack,
  }: Props = $props();

  const template = $derived(templateOf(run));

  let events = $state.raw<readonly CampaignEvent[]>([]);
  let reloadToken = $state(0);

  $effect(() => {
    // Named so the effect re-runs after every append.
    void reloadToken;
    let cancelled = false;
    void eventsOf(run.id).then((loaded) => {
      if (!cancelled) {
        events = loaded;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  const reload = (): void => {
    reloadToken += 1;
  };

  /*
   * Each hero's printed health, from the card database, so a counter capped at
   * `heroCard.health` is capped here and not only in the tests. Fear No Evil
   * on Expert carries hit points from one scenario to the next, on a victory
   * and on a defeat alike, and a table that types 13 for a hero printed 12
   * gets 12.
   *
   * The index carries no health, so the hero cards are loaded, by pack. Read
   * from the setup event rather than the folded state, since the fold is what
   * these feed; until they arrive the fold runs uncapped, and re-runs once
   * they do.
   */
  let heroStats = $state.raw<Readonly<Record<string, HeroCardStats>>>({});

  $effect(() => {
    const setup = events.find((event) => event.type === 'setup');
    if (setup === undefined) {
      return;
    }
    const heroes = setup.heroes;
    const packs = heroes
      .map((hero) => index.find((row) => row.code === hero.heroCardCode)?.packCode)
      .filter((pack): pack is string => pack !== undefined);
    if (packs.length === 0) {
      return;
    }
    let cancelled = false;
    void loadCardsByCode(cardLocale, packs)
      .then((byCode) => {
        if (!cancelled) {
          heroStats = Object.fromEntries(
            heroes.map((hero) => [
              hero.id,
              { heroId: hero.id, printedHealth: byCode.get(hero.heroCardCode)?.health ?? null },
            ]),
          );
        }
      })
      .catch(() => {
        // Left uncapped: a card file that failed to load is not a reason to
        // refuse the campaign.
      });
    return () => {
      cancelled = true;
    };
  });

  const campaign = $derived<CampaignState | null>(
    template === null ? null : fold(template, events, heroStats),
  );

  const scenario = $derived(currentScenario(template, campaign));

  const label = (value: LocalizedText | null | undefined): string => textOf(value, uiLocale);

  /**
   * A card's name, in the card language.
   *
   * The template's own names come first: Fear No Evil invents its jobs and gives
   * them names no database has, and falling through to the code would put
   * `s2_poursuite` in the middle of a sentence.
   */
  const cardName = (code: string): string => {
    const local = template?.localCardNames?.[code];
    if (local !== undefined) {
      const named = textOf(local, cardLocale);
      if (named !== '') {
        return named;
      }
    }
    return cardNames.get(code) ?? code;
  };

  const setName = (code: string): string => setNames.get(code) ?? code;

  /*
   * The text is about the current scenario — or, on a result page, the one
   * just played: a Fear No Evil defeat hands the table the choice, so nothing
   * is current while its outcome is on screen, and the message's `{villain}`
   * came up empty ("vous a échappé" with nobody named).
   */
  const text = $derived<TextContext>({
    cardName,
    drawnFor: (drawId) => {
      const about = scenario?.id ?? campaign?.completedScenarios.at(-1)?.scenarioId ?? null;
      return about === null || campaign === null ? [] : (campaign.draws[about]?.[drawId] ?? []);
    },
  });

  // --- the app's own draws --------------------------------------------------

  let dealing = false;

  /*
   * Every random pick the campaign owes the players, made before the briefing
   * is drawn.
   *
   * Idempotent, so it can run on every fold: a draw already in the log is left
   * alone. A pick made while rendering would come out differently on every
   * redraw, and the mission would change while somebody was reading it.
   */
  $effect(() => {
    const current = template;
    const state = campaign;
    if (current === null || state === null || dealing) {
      return;
    }
    dealing = true;
    void ensureDealt(run, current, state)
      .then((dealt) => {
        if (dealt) {
          reload();
        }
      })
      .finally(() => {
        dealing = false;
      });
  });

  // --- the clock ------------------------------------------------------------

  let now = $state(Date.now());

  $effect(() => {
    if (!timerRunning(run)) {
      return;
    }
    const handle = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(handle);
  });

  const elapsed = $derived(timerElapsed(run, now));

  // --- where the run is -----------------------------------------------------

  type Page =
    | 'briefing'
    | 'playing'
    | 'questions'
    | 'result'
    | 'market'
    | 'choice'
    | 'environment'
    | 'lost'
    | 'finished'
    | 'between';

  /**
   * Which page a run belongs on, from its state alone.
   *
   * One place rather than a decision repeated at each transition: a campaign
   * that can end between two taps has too many ways to be got wrong.
   */
  const placed = $derived.by((): Page => {
    const state = campaign;
    if (state === null) {
      return 'briefing';
    }
    if (state.campaignLost) {
      return 'lost';
    }
    if (state.finished) {
      return 'finished';
    }
    if (state.awaitingChoice) {
      return state.environmentOffer.length > 0 ? 'environment' : 'choice';
    }
    if (timerRunning(run)) {
      return 'playing';
    }
    return scenario === null ? 'between' : 'briefing';
  });

  /** Set only for the pages the state cannot infer: recording, and shopping. */
  let override = $state<Page | null>(null);
  const page = $derived(override ?? placed);

  let victory = $state(true);
  let submitting = $state(false);

  // --- the table, for the tracker and the long break -------------------------

  /**
   * The scenario the play session was seeded for.
   *
   * Seeding again would throw away the damage on the table, so it happens once
   * per scenario — and the tracker rebuilds its counters from the encounter
   * set, which is read off the villain the campaign fields.
   */
  let seatedFor = $state<string | null>(null);

  $effect(() => {
    const state = campaign;
    const current = scenario;
    if (page !== 'playing' || state === null || current === null) {
      return;
    }
    if (seatedFor === current.id) {
      // The clock lives on the run, not in the session, so the session's copy
      // is kept level with it: a long break writes down what it reads here.
      session.current.accumulatedMillis = elapsed;
      return;
    }
    resumeSession({
      scenarioCode: trackedSetCode(current, state, index) ?? '',
      scenarioName: label(current.name) || current.id,
      difficulty: isExpertCampaign(state) ? 'EXPERT_I' : 'STANDARD_I',
      seats: state.heroes.map((hero) => ({
        deckId: hero.deckId ?? hero.id,
        deckName: hero.name,
        heroCode: hero.heroCardCode,
        heroName: hero.name,
        aspect: '',
      })),
      modularSetCodes: [...encounterSetsOf(current)],
      accumulatedMillis: elapsed,
    });
    seatedFor = current.id;
  });

  // A campaign session belongs to this screen; leaving it must not leave a
  // half-played scenario sitting on the Play page.
  $effect(() => () => endGame());

  // --- the setup printed on the scenario's own main scheme --------------------

  let schemeSteps = $state.raw<readonly string[]>([]);

  $effect(() => {
    const codes = scenario?.baseSetup?.mainScheme ?? [];
    if (codes.length === 0) {
      schemeSteps = [];
      return;
    }
    const packs = codes
      .map((code) => index.find((row) => row.code === code)?.packCode)
      .filter((pack): pack is string => pack !== undefined);
    if (packs.length === 0) {
      schemeSteps = [];
      return;
    }
    let cancelled = false;
    void loadCardsByCode(cardLocale, packs)
      .then((byCode) => {
        if (!cancelled) {
          // Read off the card rather than written into the template, so it
          // arrives in the language the cards are in.
          schemeSteps = codes.flatMap((code) => setupSteps(byCode.get(code)?.text));
        }
      })
      .catch(() => {
        if (!cancelled) {
          schemeSteps = [];
        }
      });
    return () => {
      cancelled = true;
    };
  });

  /** Every card in the decks being played, for questions that pick from them. */
  const deckCardCodes = $derived.by((): readonly string[] => {
    const mine = new Set((campaign?.heroes ?? []).map((hero) => hero.deckId ?? hero.id));
    const codes = new Set<string>();
    for (const deck of decks) {
      if (!mine.has(deck.id)) {
        continue;
      }
      try {
        for (const code of Object.keys(JSON.parse(deck.slots) as Record<string, number>)) {
          codes.add(code);
        }
      } catch {
        // A deck whose slots will not parse contributes nothing rather than
        // taking the whole question with it.
      }
    }
    return [...codes];
  });

  // --- moving the run on ------------------------------------------------------

  async function act(actionId: string, heroId: string | null): Promise<void> {
    if (scenario === null) {
      return;
    }
    await takeSetupAction(run, scenario.id, actionId, heroId);
    reload();
  }

  async function keep(drawId: string, cardCode: string): Promise<void> {
    if (scenario === null) {
      return;
    }
    await keepDrawnCard(run, scenario.id, drawId, cardCode);
    reload();
  }

  /** "I'm ready" — the cards are out, so this is where the clock starts. */
  async function begin(): Promise<void> {
    await startTimer(run, scenario?.id ?? null);
    override = null;
    reload();
  }

  async function finish(won: boolean): Promise<void> {
    await pauseTimer(run);
    victory = won;
    override = 'questions';
    reload();
  }

  /**
   * The numbers this campaign counts with, when it brings its own.
   *
   * Only Fear No Evil does, because its subordinates are its own invention and
   * on no database; without this that whole campaign has no tracker at all.
   * Null everywhere else, and the tracker reads the cards as it always has.
   */
  const trackerSetup = $derived(
    template === null || campaign === null
      ? null
      : trackerSetupFor(template, campaign, scenario, campaign.heroes.length),
  );

  const lastResult = $derived(campaign?.completedScenarios.at(-1) ?? null);

  /*
   * The end of a campaign, fired once when the run reaches it.
   *
   * Read from the settled state rather than from the button that caused it,
   * because a campaign can end by being finished or by being lost, and because
   * the write that ends it lands after the handler returns. `finishedSynced`
   * keeps it to once per mount: re-rendering the finished page is not a second
   * ending.
   */
  let finishedSynced = false;
  $effect(() => {
    const over = campaign?.finished === true || campaign?.campaignLost === true;
    if (over && !finishedSynced) {
      finishedSynced = true;
      syncAfter('campaign-end');
    }
  });

  /*
   * BoardGameGeek, after a scenario, as after any game (PlayPage does the
   * same): sent on its own when the connection says always, offered when it
   * says ask. The play is the one just filed, so a failure can be retried
   * from the result page without leaving it.
   */
  let bggPlay = $state.raw<Play | null>(null);
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
      bggState = 'sent';
    } catch (cause) {
      bggFailure = t.bggError(cause instanceof ApiError ? cause.code : 'server_error');
      bggState = 'failed';
    }
  }

  /**
   * Files the scenario: the campaign event, then the play.
   *
   * The play is recorded too, tagged with the run, because a campaign scenario
   * is a game that was played and counts towards win rates like any other.
   */
  async function record(answers: AnswerSet): Promise<void> {
    if (scenario === null || campaign === null || submitting) {
      return;
    }
    submitting = true;
    const played = elapsed;
    const scenarioId = scenario.id;
    const current = scenario;
    const state = campaign;
    try {
      await recordResult(run, scenarioId, victory, answers, played);
      bggPlay = null;
      bggState = 'idle';
      bggFailure = null;
      if (storageOk) {
        const play = buildCampaignPlay({
          runId: run.id,
          scenario: current,
          scenarioId,
          campaign: state,
          decks,
          locale: cardLocale,
          won: victory,
          elapsedMillis: played,
          victoryPoints: answers.numbers?.vp ?? 0,
        });
        await db.plays.put(play);
        bggPlay = play;
        if (bggCanSend() && bgg.mode === 'always') {
          void sendToBgg(play);
        }
      }
      seatedFor = null;
      endGame();
      override = 'result';
      reload();
      /*
       * A scenario ending mid-campaign, which is what lets somebody carry the
       * run to the other device between chapters. The campaign's own end is a
       * separate trigger, fired from the settled state rather than from here:
       * `reload()` has not landed yet, so this is the wrong place to ask
       * whether the campaign is over.
       */
      syncAfter('scenario-end');
    } finally {
      submitting = false;
    }
  }

  /** The outcome the last result was resolved by, on the template as it stands. */
  const lastOutcome = $derived.by((): Outcome | null => {
    if (lastResult === null) {
      return null;
    }
    const played = (template?.scenarios ?? []).find((s) => s.id === lastResult.scenarioId);
    return (lastResult.victory ? played?.onVictory : played?.onDefeat) ?? null;
  });

  /**
   * Whether the campaign lets the table move on from this defeat.
   *
   * Either it says what moving on costs (`onContinue`), or moving on costs
   * nothing and the next step is the players' choice. Fear No Evil is the
   * second kind: losing a scenario does not fail it (rulebook p.8), the
   * scenario stays open against the same villain, and the table picks what to
   * play next — so a defeat with nothing to settle still has to offer a way
   * to the choice.
   */
  const canContinue = $derived(
    lastResult === null ||
      lastResult.victory ||
      (lastOutcome?.onContinue ?? []).length > 0 ||
      (lastOutcome?.next ?? []).some((step) => step.choose === true),
  );

  /**
   * True when moving on from this defeat settles nothing: the scenario is
   * left as it was, to be come back to. Said under the button, because the
   * word "continue" on a defeat page otherwise reads as giving up on it.
   */
  const continueLeavesOpen = $derived(
    lastResult !== null &&
      !lastResult.victory &&
      (lastOutcome?.onContinue ?? []).length === 0 &&
      (lastOutcome?.next ?? []).some((step) => step.choose === true),
  );

  async function moveOn(): Promise<void> {
    if (lastResult === null) {
      override = null;
      return;
    }
    await continueOutcome(run, lastResult.scenarioId, lastResult.victory);
    override = null;
    reload();
  }

  async function pick(scenarioId: string): Promise<void> {
    await chooseScenario(run, scenarioId);
    override = null;
    reload();
  }

  async function readEnvironments(): Promise<void> {
    await acknowledgeEnvironments(run);
    reload();
  }

  const choices = $derived(
    template === null || campaign === null ? [] : choosableScenarios(template, campaign),
  );

  /** The message the outcome closes on, resolved against the run as it stands. */
  const outcomeMessage = $derived(lastOutcome?.message ?? null);

  /**
   * A readable name for a counter the template never labelled.
   *
   * Fear No Evil's five pressure counters are named after the jobs they belong
   * to and carry no label of their own, so the panel was reading
   * "PRESSIONMUSEE" at a player who has no reason to know the app calls it
   * that. The environment draw already says which job each one counts.
   */
  const counterNames = $derived.by((): ReadonlyMap<string, string> => {
    const named = new Map<string, string>();
    for (const [scenarioId, counterId] of Object.entries(
      template?.environmentDraw?.counts ?? {},
    )) {
      const named_scenario = (template?.scenarios ?? []).find((s) => s.id === scenarioId);
      named.set(counterId, label(named_scenario?.name) || scenarioId);
    }
    return named;
  });

  const counterName = (counter: { id: string; label?: LocalizedText }): string =>
    label(counter.label) || counterNames.get(counter.id) || counter.id;

  /** The counters this campaign has switched on, which is what gets a box. */
  const active = $derived(
    campaign === null
      ? []
      : (template?.counters ?? []).filter((counter) =>
          evaluate(counter.activeWhen, { state: campaign }),
        ),
  );

  /** What the page is about right now: a result names what it is a result of. */
  const headline = $derived.by((): string => {
    if (page === 'result' && lastResult !== null) {
      const played = (template?.scenarios ?? []).find((s) => s.id === lastResult.scenarioId);
      return label(played?.name) || lastResult.scenarioId;
    }
    return scenario === null ? run.name : label(scenario.name) || scenario.id;
  });

  const nextName = $derived(
    campaign?.currentScenarioId == null || campaign.currentScenarioId === lastResult?.scenarioId
      ? null
      : label(
          (template?.scenarios ?? []).find((s) => s.id === campaign?.currentScenarioId)?.name,
        ),
  );
</script>

<div class="run">
  <button class="back" type="button" onclick={onBack}>← {t.campaignsTitle}</button>

  {#if template === null}
    <p class="muted note">{t.campaignsUnavailable}</p>
  {:else if campaign === null}
    <p class="muted note">{t.loading}</p>
  {:else}
    <header class="head">
      <!-- The scenario just played, while its result is on screen: the campaign
           has already moved on to the next one, and naming that one over a
           result belonging to the last reads as the wrong verdict. -->
      <h2>{headline}</h2>
      <p class="muted">
        {run.name} · {t.campaignDifficulty(campaign.difficulty)} ·
        {campaign.heroes.map((hero) => hero.name).join(', ')}
      </p>
    </header>

    <!-- Counters first: they are the campaign's memory, and the thing a table
         checks before anything else. A counter is only shown once the campaign
         has switched it on, so an empty box does not sit at the top of the
         first scenario claiming to count something. -->
    {#if active.length > 0 && page !== 'playing'}
      <div class="counters surface">
        {#each active as counter (counter.id)}
          <div class="counter">
            <span class="muted name">{counterName(counter)}</span>
            {#if counter.scope === 'hero'}
              <ul class="per-hero">
                {#each campaign.heroes as hero (hero.id)}
                  <li>
                    <span>{hero.name}</span>
                    <strong>{heroCounterOf(campaign, counter.id, hero.id)}</strong>
                  </li>
                {/each}
              </ul>
            {:else}
              <!-- Against its ceiling where it has one: three is the number
                   that matters on a pressure counter, and a bare 2 does not
                   say how close the job is to falling. -->
              <strong class="value">
                {counterOf(campaign, counter.id)}{#if counter.max != null}<span class="of"
                  >/{counter.max}</span
                >{/if}
              </strong>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if page === 'lost'}
      <section class="panel">
        <h3>{t.campaignLost}</h3>
        <p class="muted note">{t.campaignSummary(
          campaign.completedScenarios.length,
          campaign.completedScenarios.filter((r) => r.victory).length,
        )}</p>
      </section>
    {:else if page === 'finished'}
      <section class="panel">
        <h3>{t.campaignComplete}</h3>
        <p class="note">{t.campaignFinishedMessage}</p>
        <p class="muted note">{t.campaignSummary(
          campaign.completedScenarios.length,
          campaign.completedScenarios.filter((r) => r.victory).length,
        )}</p>
        <p class="muted note">{t.timePlayed(formatElapsed(campaign.totalPlayTimeMillis))}</p>
        <p class="muted note">{t.campaignFinishedCleanup}</p>
      </section>
      <!-- The campaign as a whole, unlocked by finishing it and independent of
           the ratings given scenario by scenario inside it. -->
      <RatingPanel
        {t}
        {storageOk}
        title={t.ratingCampaignTitle}
        subjects={[campaignSubject(run.templateId)]}
        labelOf={() => run.name || run.templateName}
        build={(_, score) => ratingOfRun(run, score, campaign.heroes.length)}
      />
    {:else if page === 'questions' && scenario !== null}
      <CampaignQuestions
        {t}
        {uiLocale}
        {campaign}
        {scenario}
        {victory}
        {text}
        {cardName}
        {deckCardCodes}
        {submitting}
        elapsedMillis={elapsed}
        onSubmit={record}
        onBack={() => (override = null)}
      />
    {:else if page === 'result'}
      <section class="panel">
        <p class="verdict" class:won={lastResult?.victory === true}>
          {lastResult?.victory === true ? t.campaignBravo : t.campaignDefeatRecorded}
        </p>
        {#if lastResult !== null}
          <p class="clock">{formatElapsed(lastResult.elapsedMillis)}</p>
        {/if}
        {#if outcomeMessage !== null && label(outcomeMessage) !== ''}
          <p class="message">
            <CampaignText segments={parseCampaignText(label(outcomeMessage), text)} />
          </p>
        {/if}

        <div class="actions">
          {#if canContinue}
            <button class="btn btn--primary" type="button" onclick={moveOn}>
              {nextName === null || nextName === '' ? t.campaignContinue : t.campaignGoToNext(nextName)}
            </button>
          {/if}
          {#if lastResult?.victory === false}
            <!-- Same scenario, clock from zero. Nothing is appended: the defeat
                 stands in the log and the campaign has not moved past it. -->
            <button class="btn" type="button" onclick={() => (override = null)}>{t.campaignRetry}</button>
          {/if}
          {#if template.market != null}
            <button class="btn" type="button" onclick={() => (override = 'market')}>{t.market}</button>
          {/if}
          <button class="btn" type="button" onclick={onBack}>{t.campaignTakeABreak}</button>
        </div>
        {#if canContinue && continueLeavesOpen}
          <!-- Not a failure. The scenario is left as it stands, against the
               same villain, for whenever the table comes back to it. -->
          <p class="muted note continue-note">{t.campaignContinueLeavesOpen}</p>
        {/if}
        {#if bggPlay !== null && bggCanSend() && bgg.mode !== 'off'}
          {@const sending = bggPlay}
          <div class="bgg-line">
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
          </div>
        {/if}
      </section>
    {:else if page === 'market'}
      <CampaignMarket {t} {uiLocale} {run} {template} {campaign} {cardName} onChanged={reload} />
      <div class="actions">
        <button class="btn btn--primary" type="button" onclick={() => (override = null)}>
          {t.campaignDoneShopping}
        </button>
      </div>
    {:else if page === 'environment'}
      <section class="panel">
        <h3>
          {campaign.environmentOffer.length === 1
            ? t.campaignEnvironmentLast
            : t.campaignEnvironmentTitle}
        </h3>
        <!-- Nothing is chosen here: the rules draw two and tick the jobs they
             name. The app dealt them; this only records that it was read. -->
        <ul class="pushed">
          {#each campaign.environmentOffer as id (id)}
            <li>
              <strong>{label((template.scenarios ?? []).find((s) => s.id === id)?.name) || id}</strong>
              <span class="muted">
                {campaign.environmentOffer.length === 1
                  ? t.campaignPushedTwice
                  : t.campaignPushed}
              </span>
            </li>
          {/each}
        </ul>
        <div class="actions">
          <button class="btn btn--primary" type="button" onclick={readEnvironments}>
            {t.campaignContinue}
          </button>
        </div>
      </section>
    {:else if page === 'choice'}
      <section class="panel">
        <h3>{t.campaignChooseScenario}</h3>
        <div class="actions">
          {#each choices as option (option.id)}
            <button class="btn" type="button" onclick={() => pick(option.id)}>
              {label(option.name) || option.id}
            </button>
          {/each}
        </div>
      </section>
    {:else if page === 'playing' && scenario !== null}
      <CampaignPlaying
        {t}
        {cardLocale}
        {index}
        {storageOk}
        expert={isExpertCampaign(campaign)}
        scenarioName={label(scenario.name) || scenario.id}
        encounterSets={encounterSetsOf(scenario).map(setName)}
        elapsedMillis={elapsed}
        running={timerRunning(run)}
        campaignRunId={run.id}
        {trackerSetup}
        onPause={() => void pauseTimer(run)}
        onResume={() => void startTimer(run, scenario.id)}
        onCorrect={(millis) => void setTimerElapsed(run, millis)}
        onVictory={() => void finish(true)}
        onDefeat={() => void finish(false)}
        onBreakSaved={() => {
          seatedFor = null;
          void pauseTimer(run).then(onBack);
        }}
      />
    {:else if page === 'briefing' && scenario !== null}
      <CampaignBriefing
        {t}
        {uiLocale}
        {template}
        {campaign}
        {scenario}
        {cardName}
        {setName}
        {text}
        {schemeSteps}
        onAction={act}
        onKeep={keep}
        onReady={begin}
        onNotReady={onBack}
      />
      {#if template.market != null}
        <CampaignMarket {t} {uiLocale} {run} {template} {campaign} {cardName} onChanged={reload} />
      {/if}
    {:else}
      <section class="panel">
        <h3>{t.campaignBetween}</h3>
        <div class="actions">
          <button class="btn btn--primary" type="button" onclick={moveOn}>{t.campaignContinue}</button>
        </div>
      </section>
      {#if template.market != null}
        <CampaignMarket {t} {uiLocale} {run} {template} {campaign} {cardName} onChanged={reload} />
      {/if}
    {/if}

    {#if !campaign.finished && page !== 'playing' && page !== 'questions'}
      <button class="forget" type="button" onclick={async () => { await concede(run); override = null; reload(); }}>
        {t.campaignStopCampaign}
      </button>
    {/if}
  {/if}
</div>

<style>
  /*
   * Held to a reading width.
   *
   * The page is 92rem because the card browser is a grid of four thousand
   * rows; a briefing is prose with a table in front of it, and a setup step
   * running the full width of a monitor is not readable while somebody is
   * holding cards in their other hand.
   */
  .run {
    margin: var(--space-4) 0;
    max-width: 56rem;
  }

  .back {
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
    padding: 0;
    font-weight: 600;
  }

  .head {
    margin: var(--space-3) 0 var(--space-4);
  }

  h2 {
    font-size: var(--text-2xl);
  }

  h3 {
    font-size: var(--text-lg);
    font-weight: 700;
    margin-bottom: var(--space-2);
  }

  .panel {
    margin: var(--space-3) 0;
  }

  /* The campaign's memory, laid out as a row of readings rather than a list:
     it is glanced at, not read. */
  .counters {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(10rem, 100%), 1fr));
    gap: var(--space-4);
    padding: var(--space-4);
    margin: var(--space-3) 0;
  }

  .counter .name {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .counter .value {
    display: block;
    font-size: var(--text-2xl);
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }

  .counter .of {
    font-size: var(--text-base);
    color: var(--text-muted);
  }

  .per-hero {
    list-style: none;
    padding: 0;
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
  }

  .per-hero li {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .per-hero strong {
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }

  .verdict {
    text-align: center;
    font-size: var(--text-xl);
    font-weight: 700;
    margin: 0;
    color: var(--danger);
  }

  .verdict.won {
    color: var(--accent);
  }

  .clock {
    text-align: center;
    font-size: var(--text-3xl);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    margin: var(--space-2) 0;
  }

  .message {
    max-width: var(--prose-max);
  }

  .pushed {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: var(--space-2);
  }

  .pushed li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: baseline;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }

  .continue-note {
    margin: var(--space-2) 0 0;
    max-width: var(--prose-max);
  }

  .bgg-line {
    margin-top: var(--space-3);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .bgg-line p {
    margin: 0;
  }

  .ok {
    color: var(--accent);
    font-weight: var(--weight-semibold);
  }

  .danger-text {
    color: var(--danger);
  }

  /* A text link rather than a button: giving up a campaign is not a thing to
     reach for by accident. */
  .forget {
    display: block;
    margin: var(--space-5) auto 0;
    border: 0;
    background: none;
    color: var(--danger);
    font-weight: 600;
  }

  .note {
    font-size: var(--text-base);
    max-width: var(--prose-max);
  }
</style>
