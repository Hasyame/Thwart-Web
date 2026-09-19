<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { CardSet, IndexRow, Locale, Pack } from '../lib/types';
  import { achievements } from '../lib/achievements/store.svelte';
  import { derive } from '../lib/achievements/derive';
  import { CLASSIC_ASPECTS, LEVEL_RANK, type AchievementDefinition, type AchievementStatus, type Cell, type DifficultyLevel, type Tally } from '../lib/achievements/types';
  import { FNE_PREFIX, FNE_TEMPLATE_ID, isFne, loadFneBox } from '../lib/fearNoEvil';
  import { cardImageUrl } from '../lib/data';
  import { scenarioFaceOf } from '../lib/scenarioFace';
  import { boxArtOf } from '../lib/campaignTile';

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
  /** The villain's face for a scenario, or the box's cover for Fear No Evil. */
  const scenarioArt = (key: string): string | null =>
    isFne(key) ? boxArtOf(FNE_TEMPLATE_ID) : cardImageUrl(scenarioFaceOf(index, key)?.img);
  const heroArt = (code: string): string | null => cardImageUrl(index.find((r) => r.code === code)?.img);

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

  const scenarioGroups = $derived(
    groupBy(
      (catalogue?.scenarios ?? []).filter((s) => scenarioPack === '' || s.packCode === scenarioPack),
      (s) => s.packCode,
      (s) => scenarioName(s.key),
    ),
  );
  const heroPacks = $derived([...new Set((catalogue?.heroes ?? []).map((h) => h.packCode))]);
  const scenarioPacks = $derived([...new Set((catalogue?.scenarios ?? []).map((s) => s.packCode))]);
  const ownedPacks = $derived(new Set(achievements.lastInput?.ownedPacks ?? []));
  /** The scenarios a hero's bar counts against: the collection's, or the whole game's. */
  const ownedScenarioKeys = $derived(new Set((catalogue?.scenarios ?? []).filter((s) => ownedPacks.has(s.packCode)).map((s) => s.key)));
  const allScenarioKeys = $derived(new Set((catalogue?.scenarios ?? []).map((s) => s.key)));

  /*
   * One row per hero with a bar: scenarios beaten out of the collection's.
   * The heroes shown are the collection's and any hero ever played; a hero
   * from a box you do not own and never played is a row of nothing, and
   * seventy of those hide the ones that matter. A tick shows them all.
   */
  let everyHero = $state(false);
  interface HeroRow {
    readonly code: string;
    readonly name: string;
    readonly packCode: string;
    readonly won: number;
    readonly total: number;
    readonly wonGlobal: number;
    readonly totalGlobal: number;
    readonly played: number;
  }
  const heroRows = $derived.by((): HeroRow[] => {
    const played = new Map<string, { won: Set<string>; wonGlobal: Set<string>; played: Set<string> }>();
    for (const cell of gridState?.cells ?? []) {
      const tally = anySeat ? cell.anySeat : cell;
      if (tally.attempts === 0) {
        continue;
      }
      const entry = played.get(cell.heroCode) ?? { won: new Set(), wonGlobal: new Set(), played: new Set() };
      entry.played.add(cell.scenarioKey);
      if (tally.wins > 0) {
        if (allScenarioKeys.has(cell.scenarioKey)) {
          entry.wonGlobal.add(cell.scenarioKey);
        }
        if (ownedScenarioKeys.has(cell.scenarioKey)) {
          entry.won.add(cell.scenarioKey);
        }
      }
      played.set(cell.heroCode, entry);
    }
    const rows: HeroRow[] = [];
    for (const hero of catalogue?.heroes ?? []) {
      const entry = played.get(hero.code);
      const shownHero = everyHero || ownedPacks.has(hero.packCode) || entry !== undefined;
      if (!shownHero || (heroPack !== '' && hero.packCode !== heroPack)) {
        continue;
      }
      rows.push({
        code: hero.code,
        name: heroName.get(hero.code) ?? hero.code,
        packCode: hero.packCode,
        won: entry?.won.size ?? 0,
        total: ownedScenarioKeys.size,
        wonGlobal: entry?.wonGlobal.size ?? 0,
        totalGlobal: allScenarioKeys.size,
        played: entry?.played.size ?? 0,
      });
    }
    return rows.sort((a, b) => b.won - a.won || b.played - a.played || a.name.localeCompare(b.name, uiLocale));
  });

  /** The hero opened by hand, else the one last played, else the first of the list. */
  let chosenHero = $state<string | null>(null);
  const lastPlayedHero = $derived.by((): string | null => {
    const facts = achievements.lastInput?.facts ?? [];
    let latest: { playedAt: number; hero: string } | null = null;
    for (const fact of facts) {
      const hero = anySeat ? fact.seats[0]?.heroCode : (fact.seats.find((seat) => seat.isOwner)?.heroCode ?? fact.seats[0]?.heroCode);
      if (hero !== undefined && (latest === null || fact.playedAt > latest.playedAt)) {
        latest = { playedAt: fact.playedAt, hero };
      }
    }
    return latest?.hero ?? null;
  });
  const selectedHero = $derived.by((): HeroRow | null => {
    const wanted = chosenHero ?? lastPlayedHero;
    return heroRows.find((row) => row.code === wanted) ?? heroRows[0] ?? null;
  });

  /** The chosen hero's scenarios, by pack, with each cell's state. */
  interface ScenarioLine {
    readonly key: string;
    readonly name: string;
    readonly kind: 'never' | 'played' | 'won';
    readonly tally: Tally | null;
    readonly owned: boolean;
  }
  const heroScenarios = $derived.by((): Group<ScenarioLine>[] => {
    const hero = selectedHero;
    if (hero === null) {
      return [];
    }
    return scenarioGroups.map((group) => ({
      pack: group.pack,
      name: group.name,
      items: group.items.map((scenario) => {
        const tally = tallyOf(scenario.key, hero.code);
        return { key: scenario.key, name: scenarioName(scenario.key), kind: stateOf(tally), tally, owned: ownedPacks.has(scenario.packCode) };
      }),
    }));
  });

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
    <!-- Two figures, each its own card: the achievements unlocked, and the
         completion, one hero having beaten one scenario, over the collection. -->
    <div class="completion">
      <div class="surface stat">
        <p class="stat-title">{t.achievements.namedTitle}</p>
        <strong class="big">{t.achievements.rate(percent(unlockedCount, shown.length))}</strong>
        <span class="bar" aria-hidden="true"><span class="fill" style:width={`${percent(unlockedCount, shown.length)}%`}></span></span>
        <p class="muted small">{t.achievements.namedCount(unlockedCount, shown.length)}</p>
      </div>
      <div class="surface stat">
        <p class="stat-title">{t.achievements.pairsTitle}</p>
        <strong class="big">{t.achievements.rate(percent(current.completion.owned.won, current.completion.owned.cells))}</strong>
        <span class="bar" aria-hidden="true"><span class="fill" style:width={`${percent(current.completion.owned.won, current.completion.owned.cells)}%`}></span></span>
        <p class="muted small">{t.achievements.pairsOwned(current.completion.owned.won, current.completion.owned.cells)}</p>
      </div>
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
      <label class="tick"><input type="checkbox" bind:checked={everyHero} /><span>{t.achievements.filterEveryHero}</span></label>
    </div>

    <!-- The heroes as portraits with a bar each, and the chosen hero's
         album beside them: every scenario as its villain, in colour once
         beaten, faded when only played, grey while never met. The hero
         last played opens by default. -->
    <div class="heroes">
      <ol class="hero-grid" aria-label={t.achievements.gridTitle}>
        {#each heroRows as row (row.code)}
          {@const art = heroArt(row.code)}
          <li>
            <button
              type="button"
              class="hero-tile"
              class:chosen={selectedHero?.code === row.code}
              aria-pressed={selectedHero?.code === row.code}
              onclick={() => (chosenHero = row.code)}
            >
              {#if art !== null}
                <img class="portrait" src={art} alt="" loading="lazy" />
              {:else}
                <span class="portrait blank" aria-hidden="true">★</span>
              {/if}
              <span class="hero-name">{row.name}</span>
              <span class="bar hero-bar" aria-hidden="true"><span class="fill" style:width={`${percent(row.won, row.total)}%`}></span></span>
              <span class="hero-count muted">{row.won} / {row.total}</span>
            </button>
          </li>
        {/each}
      </ol>
      {#if heroRows.length === 0}
        <p class="muted">{t.achievements.recentEmpty}</p>
      {/if}

      {#if selectedHero !== null}
        {@const hero = selectedHero}
        {@const art = heroArt(hero.code)}
        <section class="surface album" aria-live="polite">
          <header class="album-head">
            {#if art !== null}<img class="album-art" src={art} alt="" loading="lazy" />{/if}
            <div class="album-words">
              <h3>{hero.name}</h3>
              <p class="muted small">{t.achievements.heroWon(hero.won, hero.total)} · {t.achievements.completionGlobal(hero.wonGlobal, hero.totalGlobal)}</p>
              <span class="bar" aria-hidden="true"><span class="fill" style:width={`${percent(hero.won, hero.total)}%`}></span></span>
            </div>
          </header>
          <p class="legend muted small">
            <span class="swatch never" aria-hidden="true"></span>{t.achievements.legendNever}
            <span class="swatch played" aria-hidden="true"></span>{t.achievements.legendPlayed}
            <span class="swatch won" aria-hidden="true"></span>{t.achievements.legendWon}
          </p>
          {#each heroScenarios as group (group.pack)}
            {@const wonHere = group.items.filter((l) => l.kind === 'won').length}
            <div class="pack">
              <p class="pack-title">
                <span>{group.name}</span>
                <span class="muted small">{wonHere} / {group.items.length}</span>
              </p>
              <ul class="stickers">
                {#each group.items as line (line.key)}
                  {@const villain = scenarioArt(line.key)}
                  <li class="sticker {line.kind}" class:dim={!line.owned} title={t.achievements.cell(hero.name, line.name, line.tally?.attempts ?? 0, line.tally?.wins ?? 0) + (line.tally?.lastPlayedAt ? ` · ${dayOf(line.tally.lastPlayedAt)}` : '')}>
                    <span class="frame">
                      {#if villain !== null}
                        <img src={villain} alt="" loading="lazy" />
                      {:else}
                        <span class="no-art" aria-hidden="true">?</span>
                      {/if}
                      {#if line.kind === 'won'}
                        <span class="seal" aria-hidden="true">{levelMark(line.tally?.bestLevelWon ?? null) || '✓'}</span>
                      {/if}
                    </span>
                    <span class="sticker-name">{line.name}</span>
                    {#if line.tally !== null && line.tally.attempts > 0}
                      <span class="muted tiny">{t.achievements.cellShort(line.tally.attempts, line.tally.wins)}</span>
                    {/if}
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </section>
      {/if}
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
    display: grid;
    gap: var(--space-3);
  }

  @media (min-width: 48rem) {
    .completion {
      grid-template-columns: 1fr 1fr;
    }
  }

  .stat {
    padding: var(--space-4);
    display: grid;
    gap: var(--space-1);
    align-content: start;
  }

  .stat p {
    margin: 0;
  }

  .stat-title {
    font-weight: var(--weight-semibold);
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

  .swatch.never {
    background: var(--surface-2);
  }

  .swatch.played {
    background: var(--warn-soft, #f0d9a8);
  }

  .swatch.won {
    background: var(--accent);
  }

  .heroes {
    display: grid;
    gap: var(--space-3);
    align-items: start;
  }

  @media (min-width: 56rem) {
    .heroes {
      grid-template-columns: minmax(15rem, 1fr) 2fr;
    }
  }

  /* The heroes as portraits: a face, a name, a bar. */
  .hero-grid {
    list-style: none;
    margin: 0;
    padding: 2px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
    gap: var(--space-2);
    max-height: 70vh;
    overflow: auto;
  }

  .hero-tile {
    display: grid;
    justify-items: center;
    gap: 4px;
    width: 100%;
    padding: var(--space-2) var(--space-1);
    border: 2px solid transparent;
    border-radius: var(--radius-md);
    background: var(--surface-1);
    color: inherit;
    font: inherit;
    text-align: center;
    cursor: pointer;
    transition: transform var(--motion-fast) var(--ease-out), border-color var(--motion-fast) var(--ease-out);
  }

  .hero-tile:hover {
    transform: translateY(-2px);
    border-color: var(--hairline);
  }

  .hero-tile.chosen {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .portrait {
    width: 3.25rem;
    height: 3.25rem;
    border-radius: 50%;
    object-fit: cover;
    object-position: 50% 15%;
    background: var(--surface-2);
  }

  .blank {
    display: grid;
    place-items: center;
    color: var(--accent);
  }

  .hero-name {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    line-height: 1.2;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hero-bar {
    width: 100%;
    height: 4px;
  }

  .hero-count {
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  /* The album: the chosen hero, then each pack's villains as stickers. */
  .album {
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
  }

  .album-head {
    display: flex;
    gap: var(--space-3);
    align-items: center;
  }

  .album-words {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 4px;
  }

  .album-head h3 {
    margin: 0;
    font-size: var(--text-xl);
  }

  .album-head p {
    margin: 0;
  }

  .album-art {
    flex: none;
    width: 4.5rem;
    height: 4.5rem;
    border-radius: 50%;
    object-fit: cover;
    object-position: 50% 15%;
    border: 3px solid var(--accent);
  }

  .pack-title {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: var(--space-2) 0 var(--space-1);
    padding-bottom: 2px;
    border-bottom: 1px solid var(--hairline);
    font-weight: var(--weight-semibold);
  }

  .stickers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
    gap: var(--space-2);
  }

  .sticker {
    display: grid;
    justify-items: center;
    gap: 3px;
    text-align: center;
  }

  .frame {
    position: relative;
    width: 4.25rem;
    height: 4.25rem;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--surface-2);
    border: 2px solid var(--hairline);
  }

  .frame img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 12%;
    display: block;
  }

  .no-art {
    display: grid;
    place-items: center;
    height: 100%;
    color: var(--text-muted);
  }

  /* Never met: grey and quiet. Played: colour, but faded. Won: in full
     colour, framed in the accent, sealed with the level. */
  .sticker.never .frame img {
    filter: grayscale(1);
    opacity: 0.35;
  }

  .sticker.played .frame {
    border-color: var(--gold);
  }

  .sticker.played .frame img {
    opacity: 0.75;
  }

  .sticker.won .frame {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }

  .seal {
    position: absolute;
    right: -2px;
    bottom: -2px;
    min-width: 1.4rem;
    height: 1.4rem;
    padding: 0 4px;
    border-radius: var(--radius-pill) 0 var(--radius-md) 0;
    background: var(--accent);
    color: #fff;
    font-size: 0.7rem;
    font-weight: var(--weight-bold);
    line-height: 1.4rem;
  }

  .sticker.dim {
    opacity: 0.5;
  }

  .sticker-name {
    font-size: var(--text-xs);
    line-height: 1.2;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sticker.never .sticker-name {
    color: var(--text-muted);
  }

  .tiny {
    font-size: 0.7rem;
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
