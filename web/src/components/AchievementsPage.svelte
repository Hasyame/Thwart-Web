<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { CardSet, IndexRow, Locale, Pack } from '../lib/types';
  import { achievements } from '../lib/achievements/store.svelte';
  import { derive } from '../lib/achievements/derive';
  import { CLASSIC_ASPECTS, LEVEL_RANK, type AchievementDefinition, type AchievementStatus, type Cell, type DifficultyLevel, type Tally } from '../lib/achievements/types';
  import { FNE_PREFIX, loadFneBox } from '../lib/fearNoEvil';

  /**
   * The achievements: the grid, the named ones, the recent unlocks.
   *
   * Everything shown is the derived state (lib/achievements), never a
   * stored unlock. The grid's filters re-derive over a subset of the facts
   * — the aspect asked for, the difficulty floor — so a filtered grid is
   * the same function over fewer games, not a second reading of the same
   * cells; the named achievements never move with the filters.
   */

  interface Props {
    t: Strings;
    uiLocale: Locale;
    cardLocale: Locale;
    index: readonly IndexRow[];
    sets: readonly CardSet[];
    packs: readonly Pack[];
    storageOk: boolean;
  }

  const { t, uiLocale, cardLocale, index, sets, packs, storageOk }: Props = $props();

  // --- filters ----------------------------------------------------------------------
  let heroPack = $state('');
  let scenarioPack = $state('');
  let aspect = $state('');
  let minLevel = $state<DifficultyLevel>('unknown');
  let anySeat = $state(false);
  let showLosses = $state(true);

  const current = $derived(achievements.state);

  /** The grid's state: the same derivation over the games the filters keep. */
  const gridState = $derived.by(() => {
    const input = achievements.lastInput;
    if (input === null) {
      return null;
    }
    if (aspect === '' && minLevel === 'unknown') {
      return current;
    }
    const facts = input.facts.filter((fact) => {
      if (LEVEL_RANK[fact.level] < LEVEL_RANK[minLevel as DifficultyLevel]) {
        return false;
      }
      if (aspect === '') {
        return true;
      }
      return anySeat
        ? fact.seats.some((seat) => seat.aspects.includes(aspect))
        : (fact.seats.find((seat) => seat.isOwner)?.aspects.includes(aspect) ?? false);
    });
    return derive({ ...input, facts });
  });

  // --- names ------------------------------------------------------------------------
  const heroName = $derived(new Map(index.filter((r) => r.typeCode === 'hero').map((r) => [r.code, r.name] as const)));
  const setName = $derived(new Map(sets.map((s) => [s.code, s.name] as const)));
  const packName = $derived(new Map(packs.map((p) => [p.code, p.name] as const)));
  let fneNames = $state.raw<ReadonlyMap<string, string>>(new Map());
  $effect(() => {
    let live = true;
    void loadFneBox().then((box) => {
      if (live && box !== null) {
        fneNames = new Map(box.scenarios(cardLocale).map((s) => [s.code, s.name] as const));
      }
    });
    return () => {
      live = false;
    };
  });
  const scenarioName = (key: string): string =>
    setName.get(key) ?? fneNames.get(key) ?? (key.startsWith(FNE_PREFIX) ? key.slice(FNE_PREFIX.length) : key);

  // --- the grid ---------------------------------------------------------------------
  const catalogue = $derived(achievements.catalogue);

  interface Group<T> {
    readonly pack: string;
    readonly name: string;
    readonly items: readonly T[];
  }

  const groupBy = <T,>(items: readonly T[], packOf: (item: T) => string, nameOf: (item: T) => string): Group<T>[] => {
    const groups = new Map<string, T[]>();
    for (const item of items) {
      const list = groups.get(packOf(item)) ?? [];
      list.push(item);
      groups.set(packOf(item), list);
    }
    const order = new Map(packs.map((p, i) => [p.code, i] as const));
    return [...groups]
      .sort((a, b) => (order.get(a[0]) ?? 999) - (order.get(b[0]) ?? 999))
      .map(([pack, list]) => ({
        pack,
        name: packName.get(pack) ?? pack,
        items: [...list].sort((a, b) => nameOf(a).localeCompare(nameOf(b), uiLocale)),
      }));
  };

  const heroGroups = $derived(
    groupBy(
      (catalogue?.heroes ?? []).filter((h) => heroPack === '' || h.packCode === heroPack),
      (h) => h.packCode,
      (h) => heroName.get(h.code) ?? h.code,
    ),
  );
  const scenarioGroups = $derived(
    groupBy(
      (catalogue?.scenarios ?? []).filter((s) => scenarioPack === '' || s.packCode === scenarioPack),
      (s) => s.packCode,
      (s) => scenarioName(s.key),
    ),
  );
  const heroPacks = $derived([...new Set((catalogue?.heroes ?? []).map((h) => h.packCode))]);
  const scenarioPacks = $derived([...new Set((catalogue?.scenarios ?? []).map((s) => s.packCode))]);

  const cellMap = $derived(new Map((gridState?.cells ?? []).map((c) => [`${c.scenarioKey}\u0000${c.heroCode}`, c] as const)));
  const tallyOf = (key: string, hero: string): Tally | null => {
    const cell: Cell | undefined = cellMap.get(`${key}\u0000${hero}`);
    if (cell === undefined) {
      return null;
    }
    return anySeat ? cell.anySeat : cell;
  };
  const stateOf = (tally: Tally | null): 'never' | 'played' | 'won' => {
    if (tally === null || tally.attempts === 0) {
      return 'never';
    }
    if (tally.wins > 0) {
      return 'won';
    }
    return showLosses ? 'played' : 'never';
  };
  const levelMark = (level: DifficultyLevel | null): string => (level === 'expert' ? 'E' : level === 'standard' ? 'S' : '');

  const percent = (won: number, cells: number): number => (cells === 0 ? 0 : Math.round((won / cells) * 100));

  // --- the named ones ---------------------------------------------------------------
  const definitions = $derived(new Map((achievements.definitions?.achievements ?? []).map((d) => [d.id, d] as const)));
  const categories = $derived.by(() => {
    const out = new Map<string, AchievementStatus[]>();
    for (const status of current?.achievements ?? []) {
      const definition = definitions.get(status.id);
      if (definition === undefined || definition.hidden) {
        continue;
      }
      const list = out.get(definition.category) ?? [];
      list.push(status);
      out.set(definition.category, list);
    }
    return [...out];
  });
  const shown = $derived((current?.achievements ?? []).filter((a) => definitions.get(a.id)?.hidden !== true));
  const unlockedCount = $derived(shown.filter((a) => a.status === 'unlocked').length);

  const wordsOf = (definition: AchievementDefinition): { title: string; description: string } => {
    const words = t.achievement[definition.id] ?? { title: definition.id, description: '' };
    const p = definition.predicate;
    const pack = 'pack' in p && p.pack !== '*' ? (packName.get(p.pack) ?? p.pack) : '';
    const top = definition.tiers?.[definition.tiers.length - 1]?.n;
    return {
      title: words.title,
      description: words.description.replace('{pack}', pack).replace('{n}', top === undefined ? '' : String(top)),
    };
  };
  const dayOf = (millis: number): string =>
    new Date(millis).toLocaleDateString(uiLocale, { year: 'numeric', month: 'long', day: 'numeric' });
</script>

<section class="achievements">
  <h1>{t.achievements.title}</h1>
  <p class="muted intro">{t.achievements.intro}</p>

  {#if !storageOk}
    <div class="notice surface"><p>{t.storageUnavailable}</p></div>
  {:else if achievements.refused}
    <div class="notice surface"><p role="alert">{t.achievements.unavailableFile}</p></div>
  {:else if current === null || gridState === null}
    <p class="notice muted">{t.loading}</p>
  {:else}
    <!-- Completion: wins only, the collection first, the whole game beside
         it, and always the counts, so a new box that lowers the ratio does
         not read as lost ground. -->
    <div class="surface completion">
      <div class="rate">
        <strong class="big">{t.achievements.rate(percent(current.completion.owned.won, current.completion.owned.cells))}</strong>
        <span class="muted">{t.achievements.completionOwned(current.completion.owned.won, current.completion.owned.cells)}</span>
        <span class="bar" aria-hidden="true"><span class="fill" style:width={`${percent(current.completion.owned.won, current.completion.owned.cells)}%`}></span></span>
      </div>
      <p class="muted small">
        {t.achievements.completionGlobal(current.completion.global.won, current.completion.global.cells)}
        · {t.achievements.count(unlockedCount, shown.length)}
      </p>
    </div>

    <h2>{t.achievements.gridTitle}</h2>
    <div class="filters" role="group" aria-label={t.achievements.gridTitle}>
      <label>
        <span class="muted lbl">{t.achievements.filterHeroPack}</span>
        <select class="field" bind:value={heroPack}>
          <option value="">{t.achievements.filterAll}</option>
          {#each heroPacks as code (code)}
            <option value={code}>{packName.get(code) ?? code}</option>
          {/each}
        </select>
      </label>
      <label>
        <span class="muted lbl">{t.achievements.filterScenarioPack}</span>
        <select class="field" bind:value={scenarioPack}>
          <option value="">{t.achievements.filterAll}</option>
          {#each scenarioPacks as code (code)}
            <option value={code}>{packName.get(code) ?? code}</option>
          {/each}
        </select>
      </label>
      <label>
        <span class="muted lbl">{t.achievements.filterAspect}</span>
        <select class="field" bind:value={aspect}>
          <option value="">{t.achievements.filterAll}</option>
          {#each [...CLASSIC_ASPECTS, 'pool'] as code (code)}
            <option value={code}>{t.aspect(code)}</option>
          {/each}
        </select>
      </label>
      <label>
        <span class="muted lbl">{t.achievements.filterMinDifficulty}</span>
        <select class="field" bind:value={minLevel}>
          <option value="unknown">{t.achievements.filterAll}</option>
          <option value="standard">{t.achievements.level('standard')}</option>
          <option value="expert">{t.achievements.level('expert')}</option>
        </select>
      </label>
      <label class="tick"><input type="checkbox" bind:checked={anySeat} /><span>{anySeat ? t.achievements.filterAnySeat : t.achievements.filterOwnerSeat}</span></label>
      <label class="tick"><input type="checkbox" bind:checked={showLosses} /><span>{t.achievements.filterShowLosses}</span></label>
    </div>

    <p class="legend muted small">
      <span class="swatch never" aria-hidden="true"></span>{t.achievements.legendNever}
      <span class="swatch played" aria-hidden="true"></span>{t.achievements.legendPlayed}
      <span class="swatch won" aria-hidden="true"></span>{t.achievements.legendWon}
    </p>

    <!-- Rows are scenarios grouped by their pack, columns heroes grouped by
         theirs: two facets, two filters, never one dropdown. -->
    <div class="grid-scroll">
      <table class="grid">
        <thead>
          <tr>
            <th class="corner"></th>
            {#each heroGroups as group (group.pack)}
              <th class="pack-head" colspan={group.items.length} scope="colgroup">{group.name}</th>
            {/each}
          </tr>
          <tr>
            <th class="corner"></th>
            {#each heroGroups as group (group.pack)}
              {#each group.items as hero (hero.code)}
                <th class="hero-head" scope="col"><span>{heroName.get(hero.code) ?? hero.code}</span></th>
              {/each}
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each scenarioGroups as group (group.pack)}
            <tr class="pack-row"><th colspan={1 + heroGroups.reduce((n, g) => n + g.items.length, 0)} scope="rowgroup">{group.name}</th></tr>
            {#each group.items as scenario (scenario.key)}
              <tr>
                <th class="scenario-head" scope="row">{scenarioName(scenario.key)}</th>
                {#each heroGroups as hg (hg.pack)}
                  {#each hg.items as hero (hero.code)}
                    {@const tally = tallyOf(scenario.key, hero.code)}
                    {@const kind = stateOf(tally)}
                    <td class="cell {kind}" title={t.achievements.cell(heroName.get(hero.code) ?? hero.code, scenarioName(scenario.key), tally?.attempts ?? 0, tally?.wins ?? 0) + (tally?.bestLevelWon ? ` · ${t.achievements.bestLevel(t.achievements.level(tally.bestLevelWon))}` : '')}>
                      {#if kind === 'won'}<span class="mark">{levelMark(tally?.bestLevelWon ?? null)}</span>{/if}
                    </td>
                  {/each}
                {/each}
              </tr>
            {/each}
          {/each}
        </tbody>
      </table>
    </div>

    <h2>{t.achievements.listTitle}</h2>
    {#each categories as [category, list] (category)}
      <h3>{t.achievements.category(category)}</h3>
      <ul class="named">
        {#each list as status (status.id)}
          {@const definition = definitions.get(status.id)}
          {#if definition !== undefined}
            {@const words = wordsOf(definition)}
            <li class="surface named-item {status.status}">
              <div class="named-head">
                <span class="glyph" aria-hidden="true">{status.status === 'unlocked' ? '★' : status.status === 'unavailable' ? '○' : '☆'}</span>
                <span class="words">
                  <span class="title">{words.title}{#if status.tier !== null}<span class="tier {status.tier}">{t.achievements.tier(status.tier)}</span>{/if}</span>
                  <span class="muted small">{words.description}</span>
                </span>
                <span class="state muted small">
                  {#if status.status === 'unlocked' && status.unlockedAt !== null}
                    {t.achievements.unlockedOn(dayOf(status.unlockedAt))}
                  {:else if status.status === 'unlocked'}
                    {t.achievements.unlocked}
                  {:else if status.status === 'unavailable'}
                    {t.achievements.unavailable}
                  {:else}
                    {t.achievements.progress(status.progress.current, status.progress.target)}
                  {/if}
                </span>
              </div>
              {#if status.status !== 'unlocked'}
                <span class="bar" aria-hidden="true"><span class="fill" style:width={`${percent(status.progress.current, status.progress.target)}%`}></span></span>
                {#if status.status === 'unavailable'}<span class="muted small">{t.achievements.unavailableHint} · {t.achievements.progress(status.progress.current, status.progress.target)}</span>{/if}
              {/if}
            </li>
          {/if}
        {/each}
      </ul>
    {/each}

    <h2>{t.achievements.recentTitle}</h2>
    {#if current.recent.length === 0}
      <p class="muted">{t.achievements.recentEmpty}</p>
    {:else}
      <ol class="recent">
        {#each current.recent.slice(0, 10) as unlock (unlock.id)}
          {@const definition = definitions.get(unlock.id)}
          <li><span class="muted small">{dayOf(unlock.unlockedAt)}</span> {definition === undefined ? unlock.id : wordsOf(definition).title}</li>
        {/each}
      </ol>
    {/if}
  {/if}
</section>

<style>
  h1 {
    font-size: var(--text-2xl);
    margin: var(--space-5) 0 var(--space-2);
  }

  h2 {
    font-size: var(--text-lg);
    margin: var(--space-5) 0 var(--space-3);
  }

  h3 {
    font-size: var(--text-base);
    margin: var(--space-4) 0 var(--space-2);
  }

  .intro {
    max-width: var(--prose-max);
    margin: 0 0 var(--space-4);
  }

  .small {
    font-size: var(--text-sm);
  }

  .completion {
    padding: var(--space-4);
    display: grid;
    gap: var(--space-2);
  }

  .rate {
    display: grid;
    gap: var(--space-1);
  }

  .big {
    font-size: var(--text-2xl);
    color: var(--gold);
  }

  .bar {
    display: block;
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--surface-2);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width var(--motion-base) var(--ease-out);
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
    align-items: end;
    margin-bottom: var(--space-3);
  }

  .filters label {
    display: grid;
    gap: 2px;
  }

  .lbl {
    font-size: var(--text-xs);
  }

  .tick {
    display: flex !important;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--tap-min);
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    margin: 0 0 var(--space-2);
  }

  .swatch {
    display: inline-block;
    width: 0.9rem;
    height: 0.9rem;
    border-radius: var(--radius-xs);
    border: 1px solid var(--hairline);
  }

  .never,
  .swatch.never {
    background: var(--surface-2);
  }

  .played,
  .swatch.played {
    background: var(--warn-soft, #f0d9a8);
  }

  .won,
  .swatch.won {
    background: var(--accent);
  }

  /* The grid scrolls in both directions inside the page; the scenario
     names stay put on the left and the hero names on top. */
  .grid-scroll {
    overflow: auto;
    max-height: 70vh;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
  }

  .grid {
    border-collapse: separate;
    border-spacing: 2px;
    font-size: var(--text-xs);
  }

  .grid th {
    font-weight: var(--weight-semibold);
    text-align: start;
    background: var(--surface-1);
    position: sticky;
    z-index: 1;
  }

  .corner {
    left: 0;
    top: 0;
    z-index: 3 !important;
  }

  .pack-head {
    top: 0;
    padding: 2px var(--space-2);
    white-space: nowrap;
    color: var(--text-muted);
  }

  .hero-head {
    top: 1.5rem;
    height: 7rem;
    vertical-align: bottom;
    padding: 0 2px;
  }

  .hero-head span {
    display: block;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    white-space: nowrap;
    max-height: 6.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pack-row th {
    left: 0;
    padding: var(--space-1) var(--space-2);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .scenario-head {
    left: 0;
    padding: 0 var(--space-2);
    white-space: nowrap;
  }

  .cell {
    width: 1.4rem;
    height: 1.4rem;
    min-width: 1.4rem;
    border-radius: var(--radius-xs);
    text-align: center;
    color: var(--on-accent, #fff);
    font-weight: var(--weight-bold);
    line-height: 1.4rem;
  }

  .mark {
    font-size: 0.65rem;
  }

  .named {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }

  @media (min-width: 60rem) {
    .named {
      grid-template-columns: 1fr 1fr;
    }
  }

  .named-item {
    padding: var(--space-3);
    display: grid;
    gap: var(--space-1);
  }

  .named-item.unavailable {
    opacity: 0.7;
  }

  .named-head {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
  }

  .named-head .glyph {
    color: var(--accent);
    font-size: var(--text-lg);
    line-height: 1.1;
  }

  .named-item.locked .glyph,
  .named-item.unavailable .glyph {
    color: var(--text-muted);
  }

  .named-head .words {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
  }

  .named-head .title {
    font-weight: var(--weight-semibold);
  }

  .state {
    white-space: nowrap;
  }

  .tier {
    margin-inline-start: var(--space-2);
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    background: var(--surface-2);
  }

  .tier.gold,
  .tier.platinum {
    color: var(--gold);
  }

  .recent {
    margin: 0;
    padding-left: 1.2em;
  }
</style>
