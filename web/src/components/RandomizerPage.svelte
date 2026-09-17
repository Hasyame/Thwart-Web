<script lang="ts">
  import { liveQuery } from 'dexie';
  import type { CardSet, IndexRow, Locale } from '../lib/types';
  import type { Strings } from '../lib/i18n';
  import { composeFne, isFne, loadFneBox, splitFne, type FearNoEvilBox } from '../lib/fearNoEvil';
  import RatingBadge from './RatingBadge.svelte';
  import { RatingsInView } from '../lib/ratingsView.svelte';
  import { modularSubject, scenarioSubject } from '../lib/ratings';
  import { db } from '../lib/db';
  import { loadScenarioRules } from '../lib/data';
  import {
    applyFilters,
    buildPools,
    EMPTY_DRAW,
    noFilters,
    MAX_EXTRA_MODULARS,
    modularCandidatesFor,
    modularShortfall,
    roll,
    ruleFor,
    scenariosShortOfExtras,
    standardSetFor,
    withVillain,
    type Aspect,
    type DifficultyId,
    type Draw,
    type DrawField,
    type DrawFilters,
    type Pools,
    type ScenarioRulesFile,
  } from '../lib/randomizer';

  interface Props {
    t: Strings;
    sets: readonly CardSet[];
    index: readonly IndexRow[];
    /** The language the scenarios are named in, which is the cards'. */
    cardLocale: Locale;
    storageOk: boolean;
    /**
     * Lays the draw out on the setup screen, as the phone's "play this game".
     * The name goes with it: Fear No Evil's pairings are named by no card
     * set, so the page that knows the name says it.
     *
     * Owned by App: it is the same door a replayed game goes through. Until
     * this existed a drawn game was never recorded as played, which is what
     * the history, the statistics and the ratings all need it to be.
     */
    onPlay: (draw: Draw, scenarioName: string) => void;
  }

  const { t, sets, index, cardLocale, storageOk, onPlay }: Props = $props();

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

  /* The community's opinion of what was drawn, beside the draw. Refetched on
     every roll for exactly the scenario and sets in view. */
  const ratings = new RatingsInView();
  $effect(() => {
    const scenario = draw.scenarioCode;
    const drawnSets = [...draw.mandatoryModularCodes, ...draw.modularSetCodes];
    void ratings.show(scenario, drawnSets, storageOk);
    return () => ratings.dispose();
  });

  /*
   * Extra modular sets on top of the scenario's own. 0 to 5, default 0, and a
   * device preference rather than a synced one: it answers "how do I like to
   * play here", and the settings record is fixed at five keys by the phone.
   */
  const EXTRAS_KEY = 'thwart.randomizer.extraModulars';
  const storedExtras = (): number => {
    try {
      const n = Number.parseInt(localStorage.getItem(EXTRAS_KEY) ?? '0', 10);
      return Number.isFinite(n) ? Math.max(0, Math.min(MAX_EXTRA_MODULARS, n)) : 0;
    } catch {
      return 0;
    }
  };
  let extras = $state(storedExtras());
  function setExtras(n: number): void {
    extras = Math.max(0, Math.min(MAX_EXTRA_MODULARS, n));
    try {
      localStorage.setItem(EXTRAS_KEY, String(extras));
    } catch {
      // Remembered for this visit only.
    }
  }

  const collection = $state<{
    owned: Set<string>;
    excludedSets: Set<string>;
    excludedScenarios: Set<string>;
    ready: boolean;
  }>({
    owned: new Set(),
    excludedSets: new Set(),
    excludedScenarios: new Set(),
    ready: false,
  });

  /**
   * Follows the collection rather than reading it once.
   *
   * The app had a bug in exactly this shape: `RandomizerViewModel` loaded its
   * pools in `init`, so changing the collection and coming back left the old
   * pools in place and the draw offered packs the player did not own. Since
   * liveQuery re-runs on any write, that failure mode does not exist here.
   */
  $effect(() => {
    if (!storageOk) {
      collection.ready = true;
      return;
    }
    const subs = [
      liveQuery(() => db.ownedPacks.toArray()).subscribe((rows) => {
        collection.owned = new Set(rows.map((r) => r.packCode));
        collection.ready = true;
      }),
      liveQuery(() => db.excludedModularSets.toArray()).subscribe((rows) => {
        collection.excludedSets = new Set(rows.map((r) => r.setCode));
      }),
      liveQuery(() => db.excludedScenarios.toArray()).subscribe((rows) => {
        collection.excludedScenarios = new Set(rows.map((r) => r.scenarioCode));
      }),
    ];
    return () => subs.forEach((s) => s.unsubscribe());
  });

  let rules = $state<ScenarioRulesFile | null>(null);
  $effect(() => {
    let cancelled = false;
    loadScenarioRules().then((loaded) => {
      if (!cancelled) {
        rules = loaded;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  /** Saved draws, newest first, so a scenario can be marked beaten. */
  const history = $state<{ rows: readonly { id: string; scenarioCode: string; createdAt: number; beaten: boolean }[] }>({ rows: [] });

  $effect(() => {
    if (!storageOk) {
      return;
    }
    const sub = liveQuery(() =>
      db.randomizerHistory.orderBy('createdAt').reverse().limit(25).toArray(),
    ).subscribe((rows) => {
      history.rows = rows.map((r) => ({
        id: r.id,
        scenarioCode: r.scenarioCode,
        createdAt: r.createdAt,
        beaten: r.beaten,
      }));
    });
    return () => sub.unsubscribe();
  });

  const beatenScenarios = $derived(
    new Set(history.rows.filter((r) => r.beaten).map((r) => r.scenarioCode)),
  );

  let filters = $state.raw<DrawFilters | null>(null);
  let showFilters = $state(false);
  let playerCount = $state(1);
  let draw = $state.raw<Draw>(EMPTY_DRAW);
  let locked = $state.raw<ReadonlySet<DrawField>>(new Set());
  let saved = $state(false);

  /** What the collection allows, before tonight's preferences. */
  const ownedPools = $derived.by((): Pools | null => {
    if (rules === null) {
      return null;
    }
    return buildPools({
      rules,
      sets,
      index,
      ownedPackCodes: collection.owned,
      excludedModularSets: collection.excludedSets,
      excludedScenarios: collection.excludedScenarios,
      fne:
        fne === null || fne.packCode === null
          ? null
          : {
              packCode: fne.packCode,
              scenarios: fne.scenarios(cardLocale),
              villains: fne.villains(cardLocale).map((v) => v.id),
            },
    });
  });

  // Defaults are derived from the pools, so a difficulty that arrives with a
  // newly ticked pack starts allowed rather than silently excluded.
  $effect(() => {
    if (ownedPools !== null && filters === null) {
      filters = noFilters(ownedPools);
    }
  });

  const pools = $derived.by((): Pools | null => {
    if (ownedPools === null) {
      return null;
    }
    if (filters === null) {
      return ownedPools;
    }
    // Beaten scenarios are folded in here rather than in the filter object,
    // mirroring the app's effectiveFilters().
    const effective: DrawFilters = filters.excludeBeaten
      ? {
          ...filters,
          excludedScenarios: new Set([
            ...filters.excludedScenarios,
            ...beatenScenarios,
          ]),
        }
      : filters;
    return applyFilters(ownedPools, effective);
  });

  /** Names come from the card database, already in the reader's language;
      Fear No Evil's from its template, every job with every subordinate. */
  const setNames = $derived(
    new Map([...sets.map((s) => [s.code, s.name] as const), ...(fne === null ? [] : fne.names(cardLocale))]),
  );
  const villainNames = $derived(new Map((fne?.villains(cardLocale) ?? []).map((v) => [v.id, v.name] as const)));
  /** The job half of the drawn scenario, which is what the scenario picker shows. */
  const drawnJob = $derived(draw.scenarioCode === null ? null : splitFne(draw.scenarioCode).job);
  /** The subordinates the drawn job can be played against; empty for every other scenario. */
  const villainOptions = $derived(drawnJob === null ? [] : (pools?.villainChoices[drawnJob] ?? []));

  /*
   * What the collection cannot supply, said before the roll.
   *
   * The scenario is drawn, so with extras asked for there is no single answer:
   * scenarios that cannot take that many are left out of the draw and named
   * here by count. When the scenario is locked the answer is exact, and a
   * locked scenario that is short is the one case the roll is refused — the
   * player chose it, and drawing it short would be the silent shortfall the
   * rule forbids.
   */
  const short = $derived(pools === null ? [] : scenariosShortOfExtras(pools, playerCount, extras));
  const lockedRule = $derived(
    pools === null || !locked.has('scenario') ? null : ruleFor(pools, draw.scenarioCode),
  );
  const lockedShortBy = $derived(
    lockedRule === null || pools === null ? 0 : modularShortfall(pools, lockedRule, playerCount, extras),
  );
  const nothingCanTakeExtras = $derived(
    pools !== null && extras > 0 && short.length === pools.scenarios.length,
  );

  const canRoll = $derived(
    pools !== null &&
      pools.scenarios.length > 0 &&
      pools.heroes.length >= playerCount &&
      !nothingCanTakeExtras &&
      lockedShortBy === 0,
  );

  function doRoll(): void {
    if (pools === null) {
      return;
    }
    draw = roll({ pools, previous: draw, locked, playerCount, extraModularSets: extras });
    saved = false;
  }

  function toggleIn<T>(set: ReadonlySet<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    return next;
  }

  function toggleDifficulty(id: DifficultyId): void {
    if (filters === null) {
      return;
    }
    filters = { ...filters, allowedDifficulties: toggleIn(filters.allowedDifficulties, id) };
  }

  function toggleAspect(aspect: Aspect): void {
    if (filters === null) {
      return;
    }
    filters = { ...filters, excludedAspects: toggleIn(filters.excludedAspects, aspect) };
  }

  function toggleHero(code: string): void {
    if (filters === null) {
      return;
    }
    filters = { ...filters, excludedHeroes: toggleIn(filters.excludedHeroes, code) };
  }

  function toggleScenario(code: string): void {
    if (filters === null) {
      return;
    }
    filters = { ...filters, excludedScenarios: toggleIn(filters.excludedScenarios, code) };
  }

  function setExcludeBeaten(value: boolean): void {
    if (filters === null) {
      return;
    }
    filters = { ...filters, excludeBeaten: value };
  }

  function resetFilters(): void {
    if (ownedPools !== null) {
      filters = noFilters(ownedPools);
    }
  }

  async function setBeaten(id: string, beaten: boolean): Promise<void> {
    await db.randomizerHistory.update(id, { beaten });
  }

  /** How many choices the panel is currently taking away. */
  const activeFilterCount = $derived.by((): number => {
    const current = filters;
    if (current === null || ownedPools === null) {
      return 0;
    }
    return (
      ownedPools.difficulties.filter((d) => !current.allowedDifficulties.has(d))
        .length +
      current.excludedAspects.size +
      current.excludedHeroes.size +
      current.excludedScenarios.size +
      (current.excludeBeaten ? 1 : 0)
    );
  });

  /**
   * Choosing a value locks the field.
   *
   * Without this, picking Ultron and pressing reroll throws the choice away,
   * which reads as the button ignoring you. Choosing something *is* saying you
   * want to keep it, so the padlock follows rather than being a second step
   * nobody realises they have to take.
   */
  function chose(field: DrawField): void {
    if (!locked.has(field)) {
      locked = new Set(locked).add(field);
    }
  }

  function chooseScenario(code: string): void {
    if (pools === null) {
      return;
    }
    const rule = pools.scenarios.find((s) => s.code === code);
    draw = {
      ...draw,
      // A job of Fear No Evil chosen by hand still draws its villain: this
      // is the randomiser, and the villain is the part it is for.
      scenarioCode: withVillain(code, pools),
      // The scenario decides these, so they follow it rather than surviving
      // from whatever was drawn before.
      mandatoryModularCodes: rule?.mandatoryModulars ?? [],
      modularSetCodes: rule?.noModulars === true ? [] : draw.modularSetCodes,
    };
    chose('scenario');
  }

  /** The other half of a Fear No Evil job, changed by hand. */
  function chooseVillain(villainId: string): void {
    if (drawnJob === null) {
      return;
    }
    draw = { ...draw, scenarioCode: composeFne(drawnJob, villainId) };
    chose('scenario');
  }

  function chooseDifficulty(id: DifficultyId): void {
    draw = {
      ...draw,
      difficulty: id,
      standardSet: standardSetFor(
        id,
        pools?.difficulties ?? [],
        ownedPools?.difficulties ?? [],
      ),
    };
    chose('difficulty');
  }

  function chooseHero(position: number, code: string): void {
    if (pools === null) {
      return;
    }
    const hero = pools.heroes.find((h) => h.code === code);
    if (hero === undefined) {
      return;
    }
    draw = {
      ...draw,
      heroes: draw.heroes.map((current, i) =>
        i === position ? { ...current, code: hero.code, name: hero.name } : current,
      ),
    };
    chose('heroes');
  }

  function chooseAspect(position: number, aspect: Aspect): void {
    draw = {
      ...draw,
      heroes: draw.heroes.map((current, i) => (i === position ? { ...current, aspect } : current)),
    };
    chose('heroes');
  }

  function chooseModularSet(position: number, code: string): void {
    draw = {
      ...draw,
      modularSetCodes: draw.modularSetCodes.map((current, i) => (i === position ? code : current)),
    };
    chose('modularSets');
  }

  function toggleLock(field: DrawField): void {
    const next = new Set(locked);
    if (next.has(field)) {
      next.delete(field);
    } else {
      next.add(field);
    }
    locked = next;
  }

  async function save(): Promise<void> {
    if (draw.scenarioCode === null || !storageOk) {
      return;
    }
    // Written in the app's RandomizerHistoryEntity shape, down to the
    // comma-separated code lists, so this row means the same thing in both.
    await db.randomizerHistory.put({
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      scenarioCode: draw.scenarioCode,
      difficulty: draw.difficulty ?? '',
      playerCount: draw.playerCount,
      heroes: draw.heroes.map((h) => `${h.code}:${h.aspect}`).join(','),
      modularSetCodes: [...draw.mandatoryModularCodes, ...draw.modularSetCodes].join(','),
      beaten: false,
    });
    saved = true;
  }

</script>

<section>
  <h1>{t.randomizerTitle}</h1>

  {#if !collection.ready || pools === null}
    <p class="notice muted">{t.loading}</p>
  {:else if collection.owned.size === 0}
    <div class="notice surface">
      <p>{t.randomizerNoCollection}</p>
    </div>
  {:else}
    <div class="controls surface">
      <label class="players">
        <span class="muted">{t.players}</span>
        <select class="field"
          value={playerCount}
          onchange={(e) => (playerCount = Number.parseInt(e.currentTarget.value, 10))}
        >
          {#each [1, 2, 3, 4] as n (n)}
            <option value={n}>{n}</option>
          {/each}
        </select>
      </label>

      <label class="players">
        <span class="muted">{t.extraModulars}</span>
        <select class="field" value={extras} onchange={(e) => setExtras(Number.parseInt(e.currentTarget.value, 10))}>
          {#each [0, 1, 2, 3, 4, 5] as n (n)}
            <option value={n}>{n}</option>
          {/each}
        </select>
      </label>

      {#if lockedShortBy > 0 && lockedRule !== null && pools !== null}
        <!-- Plain words in place of the button, never a shorter draw. -->
        <p class="notice muted extras-short" role="status">
          {t.extrasShortLocked(
            setNames.get(lockedRule.code) ?? lockedRule.code,
            modularCandidatesFor(pools, lockedRule).length,
            extras,
          )}
        </p>
      {:else if nothingCanTakeExtras}
        <p class="notice muted extras-short" role="status">{t.extrasShortAll(extras)}</p>
      {:else}
        <button class="roll" type="button" onclick={doRoll} disabled={!canRoll}>
          {draw.scenarioCode === null ? t.roll : t.reroll}
        </button>
        {#if short.length > 0}
          <p class="muted pool-note" role="status">{t.extrasShortSome(short.length, extras)}</p>
        {/if}
      {/if}

      <p class="muted pool-note">
        {t.poolNote(pools.scenarios.length, pools.heroes.length, pools.modularSets.length)}
      </p>

      <button
        type="button"
        class="filters-toggle"
        aria-expanded={showFilters}
        onclick={() => (showFilters = !showFilters)}
      >
        {t.filters}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
      </button>
    </div>

    {#if showFilters && filters !== null && ownedPools !== null}
      <div class="filters surface">
        <p class="muted filters-note">{t.filtersNote}</p>

        <fieldset>
          <legend>{t.difficultyLabel}</legend>
          <div class="options">
            {#each ownedPools.difficulties as id (id)}
              <label class="tick">
                <input
                  type="checkbox"
                  checked={filters.allowedDifficulties.has(id)}
                  onchange={() => toggleDifficulty(id)}
                />
                <span>{t.difficulty(id)}</span>
              </label>
            {/each}
          </div>
        </fieldset>

        <fieldset>
          <legend>{t.aspects}</legend>
          <div class="options">
            {#each ownedPools.aspects as aspect (aspect)}
              <label class="tick">
                <input
                  type="checkbox"
                  checked={!filters.excludedAspects.has(aspect)}
                  onchange={() => toggleAspect(aspect)}
                />
                <span>{t.aspect(aspect)}</span>
              </label>
            {/each}
          </div>
        </fieldset>

        <fieldset>
          <legend>{t.scenarios}</legend>
          <label class="tick beaten-toggle">
            <input
              type="checkbox"
              checked={filters.excludeBeaten}
              onchange={(e) => setExcludeBeaten(e.currentTarget.checked)}
            />
            <span>{t.excludeBeaten(beatenScenarios.size)}</span>
          </label>
          <div class="options">
            {#each ownedPools.scenarios as rule (rule.code)}
              <label class="tick">
                <input
                  type="checkbox"
                  checked={!filters.excludedScenarios.has(rule.code)}
                  onchange={() => toggleScenario(rule.code)}
                />
                <span>{setNames.get(rule.code) ?? rule.code}</span>
              </label>
            {/each}
          </div>
        </fieldset>

        <fieldset>
          <legend>{t.heroes}</legend>
          <div class="options">
            {#each ownedPools.heroes as hero (hero.code)}
              <label class="tick">
                <input
                  type="checkbox"
                  checked={!filters.excludedHeroes.has(hero.code)}
                  onchange={() => toggleHero(hero.code)}
                />
                <span>{hero.name}</span>
              </label>
            {/each}
          </div>
        </fieldset>

        <div class="filters-actions">
          <button type="button" onclick={resetFilters}>{t.resetFilters}</button>
        </div>
      </div>
    {/if}

    {#if !canRoll}
      <div class="notice surface">
        <p>{t.randomizerNotEnough(playerCount)}</p>
      </div>
    {/if}

    {#if draw.scenarioCode !== null}
      <div class="draw">
        <div class="options surface">
          <div class="options-head">
            <h2>{t.scenario}</h2>
            <button
              type="button"
              class="lock"
              class:on={locked.has('scenario')}
              aria-pressed={locked.has('scenario')}
              onclick={() => toggleLock('scenario')}
            >
              {locked.has('scenario') ? '🔒' : '🔓'}
              <span class="visually-hidden">{t.lockField}</span>
            </button>
          </div>
          <select
            class="value-select"
            value={drawnJob}
            onchange={(e) => chooseScenario(e.currentTarget.value)}
          >
            {#each pools?.scenarios ?? [] as rule (rule.code)}
              <option value={rule.code}>{setNames.get(rule.code) ?? rule.code}</option>
            {/each}
          </select>
          {#if villainOptions.length > 0}
            <!-- A Fear No Evil job is played against one of the box's
                 subordinates, drawn with it; this is where the villain half
                 is changed. -->
            <label class="villain">
              <span class="muted">{t.villain}</span>
              <select
                class="value-select"
                value={splitFne(draw.scenarioCode ?? '').villain}
                onchange={(e) => chooseVillain(e.currentTarget.value)}
              >
                {#each [...villainOptions].sort((a, b) => (villainNames.get(a) ?? a).localeCompare(villainNames.get(b) ?? b)) as id (id)}
                  <option value={id}>{villainNames.get(id) ?? id}</option>
                {/each}
              </select>
            </label>
          {/if}
          {#if draw.scenarioCode !== null && !isFne(draw.scenarioCode)}
            <RatingBadge {t} summary={ratings.forScenario(draw.scenarioCode)} own={ratings.ownFor(scenarioSubject(draw.scenarioCode).key)} />
          {/if}
        </div>

        <div class="options surface">
          <div class="options-head">
            <h2>{t.difficultyLabel}</h2>
            <button
              type="button"
              class="lock"
              class:on={locked.has('difficulty')}
              aria-pressed={locked.has('difficulty')}
              onclick={() => toggleLock('difficulty')}
            >
              {locked.has('difficulty') ? '🔒' : '🔓'}
              <span class="visually-hidden">{t.lockField}</span>
            </button>
          </div>
          <select
            class="value-select"
            value={draw.difficulty}
            onchange={(e) => chooseDifficulty(e.currentTarget.value as DifficultyId)}
          >
            {#each pools?.difficulties ?? [] as id (id)}
              <option value={id}>{t.difficulty(id)}</option>
            {/each}
          </select>
          {#if draw.standardSet !== null}
            <p class="value muted">+ {t.difficulty(draw.standardSet)}</p>
          {/if}
        </div>

        <div class="options surface wide">
          <div class="options-head">
            <h2>{t.heroes}</h2>
            <button
              type="button"
              class="lock"
              class:on={locked.has('heroes')}
              aria-pressed={locked.has('heroes')}
              onclick={() => toggleLock('heroes')}
            >
              {locked.has('heroes') ? '🔒' : '🔓'}
              <span class="visually-hidden">{t.lockField}</span>
            </button>
          </div>
          <ul class="drawn-list">
            {#each draw.heroes as hero, position (position)}
              <li class="drawn picker" data-faction={hero.aspect}>
                <select class="field"
                  value={hero.code}
                  onchange={(e) => chooseHero(position, e.currentTarget.value)}
                >
                  {#each pools?.heroes ?? [] as option (option.code)}
                    <option value={option.code}>{option.name}</option>
                  {/each}
                </select>
                <select class="field"
                  value={hero.aspect}
                  onchange={(e) => chooseAspect(position, e.currentTarget.value as Aspect)}
                >
                  {#each pools?.aspects ?? [] as option (option)}
                    <option value={option}>{t.aspect(option)}</option>
                  {/each}
                </select>
              </li>
            {/each}
          </ul>
        </div>

        <div class="options surface wide">
          <div class="options-head">
            <h2>{t.modularSets}</h2>
            <button
              type="button"
              class="lock"
              class:on={locked.has('modularSets')}
              aria-pressed={locked.has('modularSets')}
              onclick={() => toggleLock('modularSets')}
            >
              {locked.has('modularSets') ? '🔒' : '🔓'}
              <span class="visually-hidden">{t.lockField}</span>
            </button>
          </div>

          {#if draw.mandatoryModularCodes.length === 0 && draw.modularSetCodes.length === 0}
            <p class="value muted">{t.noModularSets}</p>
          {:else}
            <ul class="drawn-list">
              {#each draw.mandatoryModularCodes as code (code)}
                <!-- Marked because it was not drawn: the scenario requires it,
                     and rerolling will never replace it. -->
                <li class="drawn is-required">
                  {setNames.get(code) ?? code}
                  <span class="muted">{t.required}</span>
                </li>
              {/each}
              {#each draw.modularSetCodes as code, position (position)}
                <li class="drawn picker">
                  <select class="field"
                    value={code}
                    onchange={(e) => chooseModularSet(position, e.currentTarget.value)}
                  >
                    {#each pools?.modularSets ?? [] as option (option.code)}
                      <option value={option.code}>{option.name}</option>
                    {/each}
                  </select>
                  {#if draw.scenarioCode !== null}
                    <RatingBadge {t} summary={ratings.forSet(draw.scenarioCode, code)} own={ratings.ownFor(modularSubject(code, draw.scenarioCode).key)} />
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>

      <div class="actions">
        <!-- First, because it is what a draw is for. The phone has had this
             since its randomiser existed; the web recorded the draw and then
             left the person to rebuild it by hand on the setup screen. -->
        <button class="btn btn--primary" type="button" onclick={() => onPlay(draw, setNames.get(draw.scenarioCode ?? '') ?? draw.scenarioCode ?? '')}>
          {t.playThisDraw}
        </button>
        {#if storageOk}
          <button type="button" onclick={save} disabled={saved}>
            {saved ? t.savedToHistory : t.saveToHistory}
          </button>
        {/if}
      </div>
    {/if}

    {#if storageOk && history.rows.length > 0}
      <section class="history">
        <h2 class="history-heading">{t.savedDraws}</h2>
        <p class="muted filters-note">{t.beatenNote}</p>
        <ul>
          {#each history.rows as row (row.id)}
            <li class="surface">
              <label class="tick">
                <input
                  type="checkbox"
                  checked={row.beaten}
                  onchange={(e) => setBeaten(row.id, e.currentTarget.checked)}
                />
                <span class:done={row.beaten}>
                  {setNames.get(row.scenarioCode) ?? row.scenarioCode}
                </span>
              </label>
              <span class="muted when">
                {new Date(row.createdAt).toLocaleDateString()}
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</section>

<style>
  h1 {
    font-size: var(--text-2xl);
    margin: var(--space-5) 0 var(--space-4);
  }

  h2 {
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin: 0;
  }

  .notice {
    padding: var(--space-4);
    margin: var(--space-4) 0;
    max-width: var(--prose-max);
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4);
  }

  .players {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .roll {
    padding: var(--space-3) var(--space-6);
    border-radius: var(--radius-lg);
    border: 0;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: var(--text-lg);
    font-weight: 700;
    cursor: pointer;
  }

  .roll:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .pool-note {
    font-size: var(--text-sm);
    margin: 0;
  }

  .draw {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr));
    gap: var(--space-3);
    margin-top: var(--space-4);
  }

  .options {
    padding: var(--space-4);
  }

  .options.wide {
    grid-column: 1 / -1;
  }

  .options-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-2);
  }

  .value-select,
  .picker select {
    background: var(--surface-1);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: var(--space-2);
    max-width: 100%;
  }

  .value-select {
    font-size: var(--text-lg);
    font-weight: 600;
    width: 100%;
  }

  /* The villain half of a Fear No Evil job, under the job. */
  .villain {
    display: grid;
    gap: var(--space-1);
    margin-top: var(--space-2);
  }

  .picker {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    align-items: center;
  }

  .picker select {
    font-size: var(--text-sm);
  }

  .lock {
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--text-base);
    line-height: 1;
    padding: var(--space-1) var(--space-2);
    opacity: 0.55;
  }

  .lock.on {
    opacity: 1;
    border-color: var(--accent);
  }

  .value {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 600;
  }

  .drawn-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    list-style: none;
    padding: 0;
    margin: 0;
  }

  /*
   * One part of a drawn game — a hero, a modular set, the difficulty — with a
   * rule down its leading edge in the colour of what it names.
   *
   * Deliberately not the shared chip: that is a small pill for a label or a
   * filter, and these are full rows carrying two pieces of text apiece.
   */
  .drawn {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--surface-2);
    border-inline-start: 4px solid var(--hairline);
    font-size: var(--text-base);
  }

  .drawn.is-required {
    border-inline-start-color: var(--accent);
  }

  .drawn[data-faction='aggression'] {
    border-inline-start-color: var(--faction-aggression);
  }
  .drawn[data-faction='justice'] {
    border-inline-start-color: var(--faction-justice);
  }
  .drawn[data-faction='leadership'] {
    border-inline-start-color: var(--faction-leadership);
  }
  .drawn[data-faction='protection'] {
    border-inline-start-color: var(--faction-protection);
  }
  .drawn[data-faction='pool'] {
    border-inline-start-color: var(--faction-pool);
  }

  .actions {
    margin-top: var(--space-4);
  }

  .actions button {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .actions button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .filters-toggle {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: var(--text-sm);
  }

  .filters {
    padding: var(--space-4);
    margin-top: var(--space-3);
    display: grid;
    gap: var(--space-4);
  }

  .filters-note {
    font-size: var(--text-sm);
    margin: 0;
    max-width: var(--prose-max);
  }

  fieldset {
    border: 0;
    border-top: 1px solid var(--hairline);
    padding: var(--space-3) 0 0;
    margin: 0;
  }

  legend {
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    padding: 0 var(--space-2) 0 0;
  }

  .options {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(12rem, 100%), 1fr));
    gap: var(--space-1) var(--space-3);
    margin-top: var(--space-2);
  }

  .tick {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
    font-size: var(--text-sm);
  }

  .tick input {
    accent-color: var(--accent);
    width: 1rem;
    height: 1rem;
    flex: 0 0 auto;
  }

  .beaten-toggle {
    margin-top: var(--space-2);
    font-weight: 600;
  }

  .filters-actions button {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .history {
    margin-top: var(--space-6);
  }

  .history-heading {
    font-size: var(--text-lg);
    text-transform: none;
    letter-spacing: 0;
    color: var(--text);
    margin-bottom: var(--space-1);
  }

  .history ul {
    list-style: none;
    padding: 0;
    margin: var(--space-3) 0 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(20rem, 100%), 1fr));
    gap: var(--space-2);
  }

  .history li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3);
  }

  .history .done {
    text-decoration: line-through;
    color: var(--text-muted);
  }

  .when {
    font-size: var(--text-sm);
  }
</style>
