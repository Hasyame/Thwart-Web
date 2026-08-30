<script lang="ts">
  import { liveQuery } from 'dexie';
  import type { CardSet, IndexRow } from '../lib/types';
  import type { Strings } from '../lib/i18n';
  import { db } from '../lib/db';
  import { loadScenarioRules } from '../lib/data';
  import {
    ASPECTS,
    buildPools,
    DIFFICULTIES,
    type Aspect,
    type DifficultyId,
    type Pools,
    type ScenarioRulesFile,
  } from '../lib/randomizer';
  import {
    elapsedMillis,
    endGame,
    formatElapsed,
    pauseGame,
    resumeGame,
    session,
    startGame,
  } from '../lib/session.svelte';
  import { buildPlay } from '../lib/plays';

  interface Props {
    t: Strings;
    sets: readonly CardSet[];
    index: readonly IndexRow[];
    storageOk: boolean;
  }

  const { t, sets, index, storageOk }: Props = $props();

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
        }),
  );

  const setNames = $derived(new Map(sets.map((s) => [s.code, s.name] as const)));

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

  const isExpert = $derived(
    DIFFICULTIES.find((d) => d.id === session.current.difficulty)?.expert === true,
  );

  // Setup is complete when there is a scenario, at least one seat, and — if
  // Expert was chosen — the Standard set it is played with.
  const canStart = $derived(
    session.current.scenarioCode !== '' &&
      session.current.seats.length > 0 &&
      (!isExpert || session.current.standardSet !== null),
  );

  function setScenario(code: string): void {
    session.current.scenarioCode = code;
    session.current.scenarioName = setNames.get(code) ?? code;
    session.current.modularSetCodes = [];
  }

  function setDifficulty(id: DifficultyId): void {
    session.current.difficulty = id;
    if (DIFFICULTIES.find((d) => d.id === id)?.expert !== true) {
      session.current.standardSet = null;
    }
  }

  function addSeat(): void {
    const taken = new Set(session.current.seats.map((s) => s.heroCode));
    const hero = pools?.heroes.find((h) => !taken.has(h.code));
    if (hero === undefined) {
      return;
    }
    session.current.seats = [
      ...session.current.seats,
      { heroCode: hero.code, heroName: hero.name, aspect: 'justice' },
    ];
  }

  function setSeatHero(seatIndex: number, code: string): void {
    const hero = pools?.heroes.find((h) => h.code === code);
    if (hero === undefined) {
      return;
    }
    session.current.seats = session.current.seats.map((seat, i) =>
      i === seatIndex ? { ...seat, heroCode: hero.code, heroName: hero.name } : seat,
    );
  }

  function setSeatAspect(seatIndex: number, aspect: Aspect): void {
    session.current.seats = session.current.seats.map((seat, i) =>
      i === seatIndex ? { ...seat, aspect } : seat,
    );
  }

  function removeSeat(seatIndex: number): void {
    session.current.seats = session.current.seats.filter((_, i) => i !== seatIndex);
  }

  function toggleModular(code: string): void {
    const current = session.current.modularSetCodes;
    session.current.modularSetCodes = current.includes(code)
      ? current.filter((c) => c !== code)
      : [...current, code];
  }

  // --- recording -----------------------------------------------------------

  let notes = $state('');
  let location = $state('');
  let victoryPoints = $state(0);
  let recorded = $state(false);
  let recording = $state(false);

  async function record(won: boolean): Promise<void> {
    if (recording) {
      return;
    }
    recording = true;
    pauseGame();
    try {
      const play = buildPlay({
        session: session.current,
        elapsedMillis: elapsedMillis(Date.now()),
        won,
        notes,
        location,
        victoryPoints,
        modularSetNames: session.current.modularSetCodes.map(
          (code) => setNames.get(code) ?? code,
        ),
      });
      await db.plays.put(play);
      recorded = true;
    } finally {
      recording = false;
    }
  }

  function newGame(): void {
    endGame();
    notes = '';
    location = '';
    victoryPoints = 0;
    recorded = false;
  }

  const availableScenarios = $derived(
    [...(pools?.scenarios ?? [])].sort((a, b) =>
      (setNames.get(a.code) ?? a.code).localeCompare(setNames.get(b.code) ?? b.code),
    ),
  );

  const availableModulars = $derived(
    [...(pools?.modularSets ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
  );
</script>

<section>
  <h1>{t.playTitle}</h1>

  {#if !storageOk}
    <div class="notice surface"><p>{t.storageUnavailable}</p></div>
  {:else if pools === null}
    <p class="notice muted">{t.loading}</p>
  {:else if owned.packs.size === 0}
    <div class="notice surface"><p>{t.randomizerNoCollection}</p></div>
  {:else if recorded}
    <div class="notice surface">
      <p class="ok">{t.playRecorded}</p>
      <button type="button" class="primary" onclick={newGame}>{t.playAnother}</button>
    </div>
  {:else if !session.current.started}
    <p class="muted note">{t.playSetupNote}</p>

    <div class="setup surface">
      <label class="field">
        <span class="muted">{t.scenario}</span>
        <select
          value={session.current.scenarioCode}
          onchange={(e) => setScenario(e.currentTarget.value)}
        >
          <option value="">{t.choose}</option>
          {#each availableScenarios as rule (rule.code)}
            <option value={rule.code}>{setNames.get(rule.code) ?? rule.code}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span class="muted">{t.difficultyLabel}</span>
        <select
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
        <label class="field">
          <span class="muted">{t.standardSetWith}</span>
          <select
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
        <h2>{t.heroes}</h2>
        <button type="button" onclick={addSeat} disabled={session.current.seats.length >= 4}>
          {t.addHero}
        </button>
      </div>

      {#if session.current.seats.length === 0}
        <p class="muted note">{t.noHeroesYet}</p>
      {/if}

      {#each session.current.seats as seat, i (i)}
        <div class="seat">
          <select value={seat.heroCode} onchange={(e) => setSeatHero(i, e.currentTarget.value)}>
            {#each pools.heroes as hero (hero.code)}
              <option value={hero.code}>{hero.name}</option>
            {/each}
          </select>
          <select
            value={seat.aspect}
            onchange={(e) => setSeatAspect(i, e.currentTarget.value as Aspect)}
          >
            {#each ASPECTS.filter((a) => pools.aspects.includes(a)) as aspect (aspect)}
              <option value={aspect}>{t.aspect(aspect)}</option>
            {/each}
          </select>
          <button type="button" class="small" onclick={() => removeSeat(i)}>×</button>
        </div>
      {/each}
    </div>

    {#if session.current.scenarioCode !== ''}
      <div class="setup surface">
        <h2>{t.modularSets}</h2>
        <p class="muted note">{t.modularChooseNote}</p>
        <div class="options">
          {#each availableModulars as set (set.code)}
            <label class="tick">
              <input
                type="checkbox"
                checked={session.current.modularSetCodes.includes(set.code)}
                onchange={() => toggleModular(set.code)}
              />
              <span>{set.name}</span>
            </label>
          {/each}
        </div>
      </div>
    {/if}

    <button class="primary big" type="button" onclick={startGame} disabled={!canStart}>
      {t.startGame}
    </button>
  {:else}
    <div class="running surface">
      <p class="clock">{formatElapsed(elapsed)}</p>
      <p class="muted">
        {session.current.scenarioName} · {t.difficulty(session.current.difficulty)}{session
          .current.standardSet === null
          ? ''
          : ` + ${t.difficulty(session.current.standardSet)}`}
      </p>
      <ul class="chips">
        {#each session.current.seats as seat (seat.heroCode)}
          <li class="chip" data-faction={seat.aspect}>
            <strong>{seat.heroName}</strong>
            <span>{t.aspect(seat.aspect)}</span>
          </li>
        {/each}
      </ul>

      <div class="clock-actions">
        {#if session.current.runningSince === null}
          <button type="button" onclick={resumeGame}>{t.resumeClock}</button>
        {:else}
          <button type="button" onclick={pauseGame}>{t.pauseClock}</button>
        {/if}
      </div>
    </div>

    <div class="setup surface">
      <h2>{t.recordResult}</h2>
      <label class="field">
        <span class="muted">{t.location}</span>
        <input type="text" value={location} oninput={(e) => (location = e.currentTarget.value)} />
      </label>
      <label class="field">
        <span class="muted">{t.victoryPoints}</span>
        <input
          type="number"
          min="0"
          value={victoryPoints}
          oninput={(e) => (victoryPoints = Number.parseInt(e.currentTarget.value, 10) || 0)}
        />
      </label>
      <label class="field">
        <span class="muted">{t.notes}</span>
        <textarea rows="2" value={notes} oninput={(e) => (notes = e.currentTarget.value)}
        ></textarea>
      </label>

      <div class="result-actions">
        <button class="primary" type="button" onclick={() => record(true)} disabled={recording}>
          {t.won}
        </button>
        <button type="button" onclick={() => record(false)} disabled={recording}>
          {t.lost}
        </button>
        <button type="button" onclick={newGame} disabled={recording}>{t.discardGame}</button>
      </div>
      <p class="muted note">{t.discardNote}</p>
    </div>
  {/if}
</section>

<style>
  h1 {
    font-size: 1.6rem;
    margin: var(--space-5) 0 var(--space-3);
  }

  h2 {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--md-on-surface-variant);
    margin: 0;
  }

  .notice,
  .setup,
  .running {
    padding: var(--space-4);
    margin: var(--space-3) 0;
  }

  .note {
    font-size: 0.85rem;
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

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-width: 26rem;
  }

  .seat {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .seat select {
    flex: 1 1 10rem;
  }

  select,
  input,
  textarea {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    border: 1px solid var(--md-outline);
    background: var(--md-surface);
    color: var(--md-on-surface);
    font-family: inherit;
  }

  button {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-lg);
    border: 1px solid var(--md-outline);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  button.primary {
    background: var(--md-primary);
    color: var(--md-on-primary);
    border-color: var(--md-primary);
    font-weight: 700;
  }

  button.big {
    padding: var(--space-3) var(--space-6);
    font-size: 1.05rem;
    margin-top: var(--space-2);
  }

  button.small {
    padding: var(--space-1) var(--space-3);
  }

  .options {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
    gap: var(--space-1) var(--space-3);
  }

  .tick {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
    font-size: 0.92rem;
  }

  .tick input {
    accent-color: var(--md-primary);
    width: 1rem;
    height: 1rem;
    flex: 0 0 auto;
  }

  .clock {
    font-size: 2.6rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    margin: 0;
  }

  .clock-actions,
  .result-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    list-style: none;
    padding: 0;
    margin: var(--space-3) 0 0;
  }

  .chip {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--md-surface-container-high);
    border-inline-start: 4px solid var(--md-outline-variant);
    font-size: 0.95rem;
  }

  .chip[data-faction='aggression'] {
    border-inline-start-color: var(--faction-aggression);
  }
  .chip[data-faction='justice'] {
    border-inline-start-color: var(--faction-justice);
  }
  .chip[data-faction='leadership'] {
    border-inline-start-color: var(--faction-leadership);
  }
  .chip[data-faction='protection'] {
    border-inline-start-color: var(--faction-protection);
  }
  .chip[data-faction='pool'] {
    border-inline-start-color: var(--faction-pool);
  }

  .ok {
    color: var(--md-primary);
    font-weight: 600;
  }
</style>
