<script lang="ts">
  import type { Card, CardSet, IndexRow, Locale, Pack } from '../lib/types';
  import type { Strings } from '../lib/i18n';
  import { loadPackCards } from '../lib/data';
  import {
    damaged,
    isFinalSchemeStage,
    isFinalVillainStage,
    roundEnded,
    schemeAdvanced,
    schemeComplete,
    schemeLimit,
    startOf,
    threatOn,
    threatened,
    versusSetup,
    villainAdvanced,
    villainDefeated,
    villainHealth,
    villainSideOf,
    schemeSideOf,
    type Encounter,
  } from '../lib/encounter';

  /**
   * A competitive game, both boards on one screen.
   *
   * Each team builds a scenario and hands it to the other, so what a team faces
   * here is the *enemy's* leader and the enemy's schemes. Both boards sit
   * together because the question this mode asks is which side is further
   * along, and that is unanswerable while each half lives on a different phone.
   *
   * The rules that matter are the rulebook's and are not invented here: the
   * round ends on both boards at once so the two cannot drift, and the five
   * tie-breaks are printed in the order they are applied rather than guessed at.
   */

  interface Props {
    t: Strings;
    cardLocale: Locale;
    sets: readonly CardSet[];
    packs: readonly Pack[];
    index: readonly IndexRow[];
    /** Pack codes the collection says are owned. */
    ownedPacks: ReadonlySet<string>;
  }

  const { t, cardLocale, sets, packs, ownedPacks }: Props = $props();

  type TeamId = 'one' | 'two';
  const TEAMS: readonly TeamId[] = ['one', 'two'];

  interface Board {
    leaderSet: string | null;
    stageOne: string | null;
    stageTwo: string | null;
    players: number;
    game: Encounter | null;
  }

  const blankBoard = (): Board => ({
    leaderSet: null,
    stageOne: null,
    stageTwo: null,
    players: 1,
    game: null,
  });

  let phase = $state<'setup' | 'playing' | 'result'>('setup');
  let outcome = $state<TeamId | 'tie' | null>(null);
  const boards = $state<Record<TeamId, Board>>({ one: blankBoard(), two: blankBoard() });

  /*
   * The boxes that have a versus mode, which is the ones carrying two
   * main-scheme sets. Read from the data rather than listed here, so a future
   * box appears on its own.
   */
  const versusPacks = $derived.by(() => {
    const byPack = new Map<string, CardSet[]>();
    for (const set of sets) {
      if (set.type !== 'main_scheme') {
        continue;
      }
      const bucket = byPack.get(set.packCode);
      if (bucket === undefined) {
        byPack.set(set.packCode, [set]);
      } else {
        bucket.push(set);
      }
    }
    return [...byPack.entries()]
      .filter(([, sides]) => sides.length >= 2)
      .map(([packCode, sides]) => ({
        packCode,
        name: packs.find((pack) => pack.code === packCode)?.name ?? packCode,
        sides: sides.slice(0, 2),
      }));
  });

  const owned = $derived(versusPacks.filter((pack) => ownedPacks.has(pack.packCode)));

  let packCode = $state<string | null>(null);
  const pack = $derived(owned.find((entry) => entry.packCode === packCode) ?? owned[0] ?? null);

  let cards = $state.raw<readonly Card[]>([]);
  let loading = $state(false);

  $effect(() => {
    const code = pack?.packCode;
    if (code === undefined) {
      cards = [];
      return;
    }
    let cancelled = false;
    loading = true;
    void loadPackCards(cardLocale, code)
      .then((loaded) => {
        if (!cancelled) {
          cards = loaded;
          loading = false;
        }
      })
      .catch(() => {
        if (!cancelled) {
          cards = [];
          loading = false;
        }
      });
    return () => {
      cancelled = true;
    };
  });

  /** The leader sets in this box, each with the stages it prints. */
  const leaderSets = $derived.by(() => {
    const byCode = new Map<string, { code: string; name: string; cards: Card[] }>();
    for (const card of cards) {
      const setCode = card.card_set_code;
      if (typeof setCode !== 'string' || card.card_set_type_name_code !== 'leader') {
        continue;
      }
      const entry = byCode.get(setCode);
      if (entry === undefined) {
        byCode.set(setCode, {
          code: setCode,
          name: card.card_set_name ?? setCode,
          cards: [card],
        });
      } else {
        entry.cards.push(card);
      }
    }
    return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  /** The main schemes one side prints, split by the stage they belong to. */
  function schemesOf(sideCode: string, stage: '1B' | '2B'): readonly Card[] {
    return cards.filter(
      (card) =>
        card.card_set_code === sideCode &&
        card.type_code === 'main_scheme' &&
        (card.stage ?? '').toUpperCase() === stage,
    );
  }

  const sideFor = (team: TeamId): CardSet | null =>
    pack === null ? null : (pack.sides[team === 'one' ? 0 : 1] ?? null);

  const cardsOf = (codes: readonly (string | null)[]): Card[] =>
    codes
      .filter((code): code is string => code !== null)
      .map((code) => cards.find((card) => card.code === code))
      .filter((card): card is Card => card !== undefined);

  const ready = $derived(
    TEAMS.every((team) => {
      const board = boards[team];
      return board.leaderSet !== null && board.stageOne !== null && board.stageTwo !== null;
    }),
  );

  function start(): void {
    for (const team of TEAMS) {
      const board = boards[team];
      const leader = leaderSets.find((entry) => entry.code === board.leaderSet);
      board.game = startOf(
        versusSetup(
          leader?.cards ?? [],
          cardsOf([board.stageOne, board.stageTwo]),
          board.players,
        ),
      );
    }
    phase = 'playing';
    outcome = null;
  }

  /**
   * Ends the round on both boards at once.
   *
   * The rulebook keeps the two sides in step: a game does not end until both
   * have played the same number of phases. Ending each board on its own would
   * let them drift, which is the one thing the tie rules exist to prevent.
   */
  function endRound(): void {
    for (const team of TEAMS) {
      const board = boards[team];
      if (board.game !== null) {
        board.game = roundEnded(board.game);
      }
    }
  }

  function change(team: TeamId, apply: (game: Encounter) => Encounter): void {
    const board = boards[team];
    if (board.game !== null) {
      board.game = apply(board.game);
    }
  }

  function again(): void {
    for (const team of TEAMS) {
      boards[team] = blankBoard();
    }
    phase = 'setup';
    outcome = null;
  }
</script>

<section>
  <h1 class="comic-title">{t.versusTitle}</h1>

  {#if owned.length === 0}
    <div class="notice surface">
      <p>{t.versusNeedsBox}</p>
      <p class="muted">
        {versusPacks.map((entry) => entry.name).join(' · ')}
      </p>
    </div>
  {:else if phase === 'setup'}
    <p class="muted intro">{t.versusIntro}</p>

    {#if owned.length > 1}
      <label class="field-group box">
        <span class="field-label">{t.versusBox}</span>
        <select
          class="field"
          value={pack?.packCode ?? ''}
          onchange={(event) => (packCode = event.currentTarget.value)}
        >
          {#each owned as entry (entry.packCode)}
            <option value={entry.packCode}>{entry.name}</option>
          {/each}
        </select>
      </label>
    {/if}

    {#if loading}
      <p class="muted">{t.loading}</p>
    {:else}
      <div class="boards">
        {#each TEAMS as team (team)}
          {@const side = sideFor(team)}
          {@const board = boards[team]}
          <div class="board surface">
            <h2>{side?.name ?? ''}</h2>
            <p class="muted note">{t.versusFaces}</p>

            <label class="field-group">
              <span class="field-label">{t.versusLeader}</span>
              <select
                class="field"
                value={board.leaderSet ?? ''}
                onchange={(event) => (board.leaderSet = event.currentTarget.value || null)}
              >
                <option value="">·</option>
                {#each leaderSets as leader (leader.code)}
                  <option value={leader.code}>{leader.name}</option>
                {/each}
              </select>
            </label>

            {#if side !== null}
              <label class="field-group">
                <span class="field-label">{t.versusStageOne}</span>
                <select
                  class="field"
                  value={board.stageOne ?? ''}
                  onchange={(event) => (board.stageOne = event.currentTarget.value || null)}
                >
                  <option value="">·</option>
                  {#each schemesOf(side.code, '1B') as scheme (scheme.code)}
                    <option value={scheme.code}>{scheme.name}</option>
                  {/each}
                </select>
              </label>

              <label class="field-group">
                <span class="field-label">{t.versusStageTwo}</span>
                <select
                  class="field"
                  value={board.stageTwo ?? ''}
                  onchange={(event) => (board.stageTwo = event.currentTarget.value || null)}
                >
                  <option value="">·</option>
                  {#each schemesOf(side.code, '2B') as scheme (scheme.code)}
                    <option value={scheme.code}>{scheme.name}</option>
                  {/each}
                </select>
              </label>
            {/if}

            <label class="field-group">
              <span class="field-label">{t.versusPlayers}</span>
              <select
                class="field"
                value={String(board.players)}
                onchange={(event) => (board.players = Number(event.currentTarget.value))}
              >
                {#each [1, 2, 3, 4] as count (count)}
                  <option value={String(count)}>{count}</option>
                {/each}
              </select>
            </label>
          </div>
        {/each}
      </div>

      <button class="btn btn--primary btn--block" type="button" disabled={!ready} onclick={start}>
        {t.versusStart}
      </button>
    {/if}
  {:else if phase === 'playing'}
    <div class="boards">
      {#each TEAMS as team (team)}
        {@const board = boards[team]}
        {@const game = board.game}
        {#if game !== null}
          {@const leader = villainSideOf(game)}
          {@const scheme = schemeSideOf(game)}
          {@const health = villainHealth(game)}
          {@const limit = schemeLimit(game)}
          <div class="board surface">
            <h2>{sideFor(team)?.name ?? ''}</h2>

            <div class="counter">
              <p class="what">{leader?.name ?? ''} <span class="muted">{leader?.stage ?? ''}</span></p>
              <p class="value">
                {game.progress.damage}<span class="muted">/{health ?? '·'}</span>
              </p>
              <div class="btn-row">
                <button class="btn btn--quiet" type="button" onclick={() => change(team, (g) => damaged(g, -1))}>−1</button>
                <button class="btn btn--quiet" type="button" onclick={() => change(team, (g) => damaged(g, 1))}>+1</button>
                <button class="btn btn--quiet" type="button" onclick={() => change(team, (g) => damaged(g, 5))}>+5</button>
              </div>
              {#if villainDefeated(game) && !isFinalVillainStage(game)}
                <button class="btn advance" type="button" onclick={() => change(team, villainAdvanced)}>
                  {t.advanceVillain}
                </button>
              {/if}
            </div>

            <div class="counter">
              <p class="what">{scheme?.name ?? ''} <span class="muted">{scheme?.stage ?? ''}</span></p>
              <p class="value">
                {threatOn(game, 0)}<span class="muted">/{limit ?? '·'}</span>
              </p>
              <div class="btn-row">
                <button class="btn btn--quiet" type="button" onclick={() => change(team, (g) => threatened(g, -1))}>−1</button>
                <button class="btn btn--quiet" type="button" onclick={() => change(team, (g) => threatened(g, 1))}>+1</button>
                <button class="btn btn--quiet" type="button" onclick={() => change(team, (g) => threatened(g, 5))}>+5</button>
              </div>
              {#if schemeComplete(game) && !isFinalSchemeStage(game)}
                <button class="btn advance" type="button" onclick={() => change(team, schemeAdvanced)}>
                  {t.advanceScheme}
                </button>
              {/if}
            </div>

            <p class="muted note">{t.versusRound(game.progress.round)}</p>
          </div>
        {/if}
      {/each}
    </div>

    <button class="btn btn--primary btn--block" type="button" onclick={endRound}>
      {t.versusEndRound}
    </button>

    <div class="won">
      <p class="muted">{t.versusWhoWon}</p>
      <div class="btn-row">
        {#each TEAMS as team (team)}
          <button class="btn" type="button" onclick={() => ((outcome = team), (phase = 'result'))}>
            {sideFor(team)?.name ?? ''}
          </button>
        {/each}
        <button class="btn" type="button" onclick={() => ((outcome = 'tie'), (phase = 'result'))}>
          {t.versusTie}
        </button>
      </div>
    </div>
  {:else}
    <div class="result surface">
      <p class="winner">
        {outcome === 'tie' ? t.versusTie : (sideFor(outcome as TeamId)?.name ?? '')}
      </p>

      {#if outcome === 'tie'}
        <!-- Printed in the order they are applied, because that order is the
             rule. A list in any other order is a different game. -->
        <h2>{t.versusTiebreakTitle}</h2>
        <ol class="tiebreaks">
          {#each t.versusTiebreaks as rule, i (i)}
            <li>{rule}</li>
          {/each}
        </ol>
      {/if}

      <button class="btn btn--primary" type="button" onclick={again}>{t.versusAgain}</button>
    </div>
  {/if}
</section>

<style>
  h1 {
    font-size: var(--text-2xl);
    margin: var(--space-5) 0 var(--space-3);
  }

  h2 {
    font-size: var(--text-lg);
    font-weight: var(--weight-bold);
  }

  .intro {
    max-width: var(--prose-max);
    margin-bottom: var(--space-4);
  }

  .box {
    max-width: 22rem;
    margin-bottom: var(--space-4);
  }

  /* Side by side wherever there is room: the whole point of this mode is
     comparing the two, and a board each on its own screen answers nothing. */
  .boards {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    margin-bottom: var(--space-4);
  }

  .board {
    display: grid;
    gap: var(--space-3);
    align-content: start;
    padding: var(--space-4);
    border-radius: var(--radius-md);
  }

  .note {
    font-size: var(--text-sm);
    margin: 0;
  }

  .counter {
    display: grid;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--hairline);
  }

  .what {
    font-weight: var(--weight-semibold);
    margin: 0;
  }

  .value {
    font-size: var(--text-3xl);
    font-weight: var(--weight-bold);
    font-variant-numeric: tabular-nums;
    margin: 0;
  }

  .advance {
    justify-self: start;
    border-color: var(--accent);
    color: var(--accent);
  }

  .won {
    margin-top: var(--space-5);
    display: grid;
    gap: var(--space-2);
  }

  .result {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-5);
    border-radius: var(--radius-md);
    max-width: var(--prose-max);
  }

  .winner {
    font-size: var(--text-2xl);
    font-weight: var(--weight-bold);
    margin: 0;
  }

  .tiebreaks {
    margin: 0;
    padding-left: var(--space-5);
    display: grid;
    gap: var(--space-2);
  }

  .notice {
    padding: var(--space-4);
    border-radius: var(--radius-md);
    display: grid;
    gap: var(--space-2);
    max-width: var(--prose-max);
  }
</style>
