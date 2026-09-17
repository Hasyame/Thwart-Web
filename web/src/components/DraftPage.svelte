<script lang="ts">
  import { liveQuery } from 'dexie';
  import type { Strings } from '../lib/i18n';
  import type { IndexRow, Locale } from '../lib/types';
  import { db } from '../lib/db';
  import { cardImageUrl } from '../lib/data';
  import { fetchCard, showCard } from '../lib/cardViewer.svelte';
  import { syncAfter } from '../lib/sync/auto.svelte';
  import { validateDeck } from '../lib/deckRules';
  import { buildContext, ownedHeroes, rulesFor } from '../lib/draft/context';
  import { cardFromRow } from '../lib/draft/cards';
  import {
    aspectChoices,
    availableHeroes,
    imposedAspects,
    pick as enginePick,
    randomAspects,
    randomHero,
    randomHeroChoices,
    shortfalls,
    skipCurrent,
    start,
  } from '../lib/draft/engine';
  import { defaultName } from '../lib/draft/naming';
  import { freshSeed } from '../lib/draft/random';
  import { clearDraft, loadDraft, saveDraft } from '../lib/draft/store';
  import {
    DEFAULT_SETTINGS,
    DRAFT_RULES,
    EMPTY_PLAYER,
    cardCount,
    isFull,
    remaining,
    signatureCount,
    slotsOf,
    type DraftContext,
    type DraftPlayer,
    type DraftState,
    type IdentityMode,
  } from '../lib/draft/types';
  import CardHover from './CardHover.svelte';

  /**
   * The draft, as four pages: settings, identities one player at a time, the
   * table, the names. The engine (lib/draft) decides everything; this only
   * shows the draft and writes it down after every change, so a page closed
   * mid-pick reopens on the same offer. docs/spec/synergie-et-draft.md.
   */

  interface Props {
    t: Strings;
    uiLocale: Locale;
    cardLocale: Locale;
    index: readonly IndexRow[];
    storageOk: boolean;
    /** Opens a deck's page, once the decks are on the shelf. */
    onDone: () => void;
  }

  const { t, index, storageOk, onDone }: Props = $props();

  // --- the collection -----------------------------------------------------------

  let ownedPacks = $state.raw<ReadonlyMap<string, number>>(new Map());
  let deckNames = $state.raw<readonly string[]>([]);
  $effect(() => {
    if (!storageOk) {
      return;
    }
    const subs = [
      liveQuery(() => db.ownedPacks.toArray()).subscribe((rows) => {
        ownedPacks = new Map(rows.filter((r) => r.quantity > 0).map((r) => [r.packCode, r.quantity]));
      }),
      liveQuery(() => db.decks.toArray()).subscribe((rows) => {
        deckNames = rows.map((d) => d.name);
      }),
    ];
    return () => subs.forEach((s) => s.unsubscribe());
  });

  const heroes = $derived(ownedHeroes(index, ownedPacks));
  const rowByCode = $derived(new Map(index.map((row) => [row.code, row] as const)));
  const nameOf = (code: string | null): string => (code === null ? '' : (rowByCode.get(code)?.name ?? code));

  // --- the draft, written down after every change ----------------------------------

  let draft = $state.raw<DraftState | null>(null);
  let loaded = $state(false);
  $effect(() => {
    if (!storageOk) {
      loaded = true;
      return;
    }
    void loadDraft().then((saved) => {
      draft = saved;
      // Alone at the table, nobody has to look away.
      handedOver = saved !== null && saved.players.length === 1;
      loaded = true;
    });
  });

  function commit(next: DraftState): void {
    draft = next;
    void saveDraft(next);
  }

  /*
   * The card data behind the draft, rebuilt whenever the identities or the
   * collection change; never written down.
   */
  const context = $derived.by((): DraftContext | null => {
    if (draft === null) {
      return null;
    }
    const codes = draft.players.map((p) => p.heroCode).filter((c): c is string => c !== null);
    return buildContext(index, ownedPacks, codes);
  });

  // --- settings -------------------------------------------------------------------

  let settings = $state({ ...DEFAULT_SETTINGS });

  function begin(): void {
    const players = Array.from({ length: settings.players }, (_, i) => EMPTY_PLAYER(i));
    const fresh: DraftState = {
      settings: { ...settings },
      players,
      phase: 'identity',
      current: 0,
      stock: {},
      pickCount: 0,
      offer: [],
      seed: freshSeed(),
      rolls: 0,
    };
    commit(prepareIdentity(fresh));
  }

  /** Draws for the current player, when the mode draws. */
  function prepareIdentity(s: DraftState): DraftState {
    const player = s.players[s.current];
    if (player === undefined || player.heroCode !== null) {
      return s;
    }
    if (s.settings.identityMode === 'random') {
      const drawn = randomHero(s, heroes);
      return drawn === null ? s : withHero(s, drawn);
    }
    if (s.settings.identityMode === 'random_of_five') {
      return withPlayer(s, { ...player, heroChoices: randomHeroChoices(s, heroes) });
    }
    return s;
  }

  function withPlayer(s: DraftState, player: DraftPlayer): DraftState {
    return { ...s, players: s.players.map((p, i) => (i === s.current ? player : p)) };
  }

  /** Settles the identity: the hero, its signature cards, and no aspect yet. */
  function withHero(s: DraftState, heroCode: string): DraftState {
    const player = s.players[s.current] as DraftPlayer;
    const hero = rowByCode.get(heroCode);
    const rules = rulesFor(index, heroCode);
    const imposed = imposedAspects(rules);
    return withPlayer(s, {
      ...player,
      heroCode,
      heroName: hero?.name ?? heroCode,
      heroSetCode: hero?.setCode ?? null,
      signature: rules === null ? {} : Object.fromEntries(rules.requiredCards),
      aspects: imposed === null ? [] : [...imposed],
    });
  }

  function drawAgain(): void {
    if (draft === null) {
      return;
    }
    const player = draft.players[draft.current] as DraftPlayer;
    const rolled = { ...draft, rolls: draft.rolls + 1 };
    commit(prepareIdentity(withPlayer(rolled, { ...player, heroCode: null, heroChoices: [], aspects: [], signature: {} })));
  }

  function chooseHero(code: string): void {
    if (draft !== null) {
      commit(withHero(draft, code));
    }
  }

  function toggleAspect(aspect: string): void {
    if (draft === null) {
      return;
    }
    const player = draft.players[draft.current] as DraftPlayer;
    const rules = player.heroCode === null ? null : rulesFor(index, player.heroCode);
    const count = rules?.aspectCount ?? 1;
    const has = player.aspects.includes(aspect);
    let aspects: string[];
    if (has) {
      aspects = player.aspects.filter((a) => a !== aspect);
    } else if (count === 1) {
      aspects = [aspect];
    } else {
      aspects = player.aspects.length >= count ? [...player.aspects.slice(1), aspect] : [...player.aspects, aspect];
    }
    commit(withPlayer(draft, { ...player, aspects }));
  }

  function drawAspects(): void {
    if (draft === null || context === null) {
      return;
    }
    const player = draft.players[draft.current] as DraftPlayer;
    const rules = player.heroCode === null ? null : rulesFor(index, player.heroCode);
    const rolled = { ...draft, rolls: draft.rolls + 1 };
    commit(withPlayer(rolled, { ...player, aspects: [...randomAspects(rolled, rules, context.poolAspectAvailable)] }));
  }

  function setDeckSize(size: number): void {
    if (draft === null) {
      return;
    }
    const player = draft.players[draft.current] as DraftPlayer;
    commit(withPlayer(draft, { ...player, deckSize: size }));
  }

  /** The current identity page is complete: the next player's, or the table. */
  let shortfallLines = $state<readonly { player: number; needed: number; available: number }[]>([]);
  function confirmIdentity(): void {
    if (draft === null || context === null) {
      return;
    }
    shortfallLines = [];
    const last = draft.current >= draft.players.length - 1;
    if (!last) {
      commit(prepareIdentity({ ...draft, current: draft.current + 1 }));
      return;
    }
    const stocked = { ...draft, stock: Object.fromEntries(context.initialStock) };
    const short = shortfalls(stocked, context);
    if (short.length > 0) {
      shortfallLines = short.map((s) => ({ player: s.playerIndex + 1, needed: s.needed, available: s.available }));
      return;
    }
    commit(start(stocked, context));
    handedOver = draft.players.length === 1;
  }

  // --- the table ----------------------------------------------------------------

  /** Whether the current player has taken the device; false hides the offer. */
  let handedOver = $state(false);

  const current = $derived(draft === null ? null : (draft.players[draft.current] ?? null));
  const offerRows = $derived(
    draft === null || context === null
      ? []
      : draft.offer.map((code) => context.pool.get(code)).filter((r): r is IndexRow => r !== undefined),
  );

  /* The offer's pictures, fetched as they come; the picks show names only. */
  let images = $state.raw<ReadonlyMap<string, string>>(new Map());
  $effect(() => {
    const codes = [...offerRows.map((r) => r.code), ...(current?.heroCode === null || current === null ? [] : [current.heroCode])];
    const missing = codes.filter((code) => !images.has(code));
    if (missing.length === 0) {
      return;
    }
    let cancelled = false;
    void Promise.all(missing.map((code) => fetchCard(code).then((card) => [code, cardImageUrl(card?.imagesrc)] as const))).then((pairs) => {
      if (!cancelled) {
        const next = new Map(images);
        for (const [code, url] of pairs) {
          if (url !== null) {
            next.set(code, url);
          }
        }
        images = next;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  function takeCard(code: string): void {
    if (draft === null || context === null) {
      return;
    }
    const players = draft.players.length;
    const next = enginePick(draft, code, context);
    commit(next);
    // With one player the device never changes hands.
    handedOver = players === 1 || next.phase !== 'pick';
  }

  function stopHere(): void {
    if (draft !== null && context !== null) {
      commit(skipCurrent(draft, context));
      handedOver = draft.players.length === 1;
    }
  }

  let confirmingAbandon = $state(false);
  async function abandon(): Promise<void> {
    await clearDraft();
    draft = null;
    confirmingAbandon = false;
    handedOver = false;
    shortfallLines = [];
  }

  /** The current deck, grouped by type, for the side panel. */
  const deckGroups = $derived.by(() => {
    if (current === null || context === null) {
      return [];
    }
    const groups = new Map<string, { code: string; name: string; count: number; cost: number | null }[]>();
    for (const [code, count] of slotsOf(current)) {
      const row = context.pool.get(code) ?? rowByCode.get(code);
      if (row === undefined) {
        continue;
      }
      const list = groups.get(row.typeName) ?? [];
      list.push({ code, name: row.name, count, cost: row.cost });
      groups.set(row.typeName, list);
    }
    return [...groups.entries()]
      .map(([type, cards]) => ({ type, cards: cards.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.type.localeCompare(b.type));
  });

  // --- the finish -----------------------------------------------------------------

  let names = $state<Record<number, string>>({});
  let finishError = $state<string | null>(null);
  let saving = $state(false);

  /** Each player's name, the one typed or the default, with the earlier ones taken. */
  const proposedNames = $derived.by((): string[] => {
    if (draft === null) {
      return [];
    }
    const taken = [...deckNames];
    return draft.players.map((player) => {
      const typed = names[player.index]?.trim();
      const rules = player.heroCode === null ? null : rulesFor(index, player.heroCode);
      const name = typed !== undefined && typed !== '' ? typed : defaultName(player.heroName, player.aspects, rules, taken);
      taken.push(name);
      return name;
    });
  });

  async function finish(): Promise<void> {
    if (draft === null || context === null || saving) {
      return;
    }
    finishError = null;
    saving = true;
    try {
      const cards = new Map<string, ReturnType<typeof cardFromRow>>();
      for (const [code, row] of context.pool) {
        cards.set(code, cardFromRow(row));
      }
      for (const signature of context.signatureCards.values()) {
        for (const [code, row] of signature) {
          cards.set(code, cardFromRow(row));
        }
      }
      // Every deck through the usual check first: an illegal one here is a
      // bug, said out loud, and nothing is saved.
      const decks = draft.players.map((player, i) => {
        const rules = player.heroCode === null ? undefined : context.rules.get(player.heroCode);
        const slots = slotsOf(player);
        const validation = rules === undefined ? null : validateDeck(rules, player.aspects, slots, cards);
        return { player, slots, validation, name: proposedNames[i] ?? '' };
      });
      const short = decks.find((d) => cardCount(d.player) < DRAFT_RULES.MIN_DECK_SIZE);
      if (short !== undefined) {
        finishError = t.draft.short(short.name, cardCount(short.player), short.player.deckSize);
        return;
      }
      const illegal = decks.find((d) => d.validation === null || !d.validation.legal);
      if (illegal !== undefined) {
        console.error('draft: illegal deck at finish', illegal.name, illegal.validation?.problems, [...illegal.slots]);
        finishError = t.draft.illegal(illegal.name, illegal.validation?.problems.length ?? 0);
        return;
      }
      const now = Date.now();
      await db.decks.bulkPut(
        decks.map(({ player, slots, name }) => ({
          id: `local-${crypto.randomUUID()}`,
          marvelCdbId: 0,
          kind: 'LOCAL',
          url: '',
          name,
          heroCode: player.heroCode ?? '',
          heroName: player.heroName,
          aspects: player.aspects.join(','),
          slots: [...slots].map(([code, quantity]) => `${code}=${quantity}`).join(','),
          ignoreDeckLimitSlots: '',
          descriptionMd: null,
          version: null,
          tags: null,
          rawJson: '',
          lastSyncedAt: now,
          locallyEdited: true,
        })),
      );
      await clearDraft();
      syncAfter('edit');
      draft = null;
      onDone();
    } finally {
      saving = false;
    }
  }

  const aspectOptions = $derived.by((): readonly string[] => {
    if (current === null || context === null || current.heroCode === null) {
      return [];
    }
    return aspectChoices(rulesFor(index, current.heroCode), context.poolAspectAvailable);
  });
  const currentRules = $derived(current === null || current.heroCode === null ? null : rulesFor(index, current.heroCode));
  const identityReady = $derived(
    current !== null && current.heroCode !== null && current.aspects.length === (currentRules?.aspectCount ?? 1),
  );

  let heroQuery = $state('');
  const heroList = $derived.by(() => {
    if (draft === null) {
      return [];
    }
    // The engine counts this player's own choice as taken; here it stays
    // clickable so the ring can move to another card.
    const available = new Set(availableHeroes(draft, heroes));
    const own = current?.heroCode ?? null;
    const q = heroQuery.trim().toLowerCase();
    return heroes
      .map((code) => ({ code, name: nameOf(code), available: available.has(code) || code === own }))
      .filter((h) => q === '' || h.name.toLowerCase().includes(q));
  });
  // Which other player holds this identity; the current player's own choice
  // is shown by the ring, not by a line saying they took it.
  const takenBy = (code: string): number | null => {
    const i = draft?.players.findIndex((p, n) => p.heroCode === code && n !== draft?.current) ?? -1;
    return i < 0 ? null : i + 1;
  };
</script>

<section class="draft">
  <h1>{t.draft.title}</h1>

  {#if !storageOk}
    <div class="notice surface"><p>{t.storageUnavailable}</p></div>
  {:else if !loaded}
    <p class="notice muted">{t.loading}</p>
  {:else if draft === null}
    <!-- Page 1: the settings. -->
    <p class="muted intro">{t.draft.intro}</p>
    {#if heroes.length === 0}
      <div class="notice surface"><p>{t.draft.noHeroes}</p></div>
    {:else}
      <div class="surface panel">
        <div class="setting">
          <span class="label">{t.draft.players}</span>
          <div class="chip-row">
            {#each [1, 2, 3, 4] as n (n)}
              <button type="button" class="chip" aria-pressed={settings.players === n} onclick={() => (settings.players = n)}>{n}</button>
            {/each}
          </div>
        </div>
        <div class="setting">
          <span class="label">{t.draft.identityMode}</span>
          <div class="chip-row">
            {#each [['random', t.draft.modeRandom], ['random_of_five', t.draft.modeRandomOfFive], ['choice', t.draft.modeChoice]] as [mode, label] (mode)}
              <button type="button" class="chip" aria-pressed={settings.identityMode === mode} onclick={() => (settings.identityMode = mode as IdentityMode)}>{label}</button>
            {/each}
          </div>
        </div>
        <label class="slider">
          <span class="slider-head"><span class="label">{t.draft.offerSize}</span><strong class="value">{settings.offerSize}</strong></span>
          <input type="range" min={DRAFT_RULES.MIN_OFFER_SIZE} max={DRAFT_RULES.MAX_OFFER_SIZE} bind:value={settings.offerSize} />
          <span class="muted note">{t.draft.offerSizeDetail}</span>
        </label>
        <label class="tick">
          <input type="checkbox" bind:checked={settings.synergyOnly} />
          <span>{t.draft.synergy}</span>
        </label>
        <p class="muted note">{t.draft.synergyDetail}</p>
        <div class="btn-row">
          <button type="button" class="btn btn--primary" onclick={begin}>{t.draft.begin}</button>
        </div>
      </div>
    {/if}
  {:else if draft.phase === 'identity' && current !== null}
    <!-- Page 2: this player's identity, aspects and deck size, in three
         numbered steps, the identities as their cards. -->
    <div class="steps">
      <section class="step">
        <header class="step-head">
          <h2>1. {t.draft.identityTitle(draft.current + 1)}</h2>
          <div class="step-tools">
            {#if draft.settings.identityMode !== 'choice'}
              <button type="button" class="btn small" onclick={drawAgain}>⇶ {t.draft.drawAgain}</button>
            {:else}
              <input class="field search" type="search" placeholder={t.draft.searchHeroes} aria-label={t.draft.searchHeroes} bind:value={heroQuery} />
            {/if}
          </div>
        </header>

        {#if draft.settings.identityMode === 'random'}
          <p class="muted small">{t.draft.identityDrawn}</p>
          <ul class="heroes single">
            {#if current.heroCode !== null}
              {@render heroTile(current.heroCode, true)}
            {/if}
          </ul>
        {:else if draft.settings.identityMode === 'random_of_five'}
          <p class="muted small">{t.draft.chooseOfFive}</p>
          <ul class="heroes">
            {#each current.heroChoices as code (code)}
              {@render heroTile(code, true)}
            {/each}
          </ul>
        {:else}
          <ul class="heroes">
            {#each heroList as hero (hero.code)}
              {@render heroTile(hero.code, hero.available)}
            {/each}
          </ul>
        {/if}
      </section>

      {#if current.heroCode !== null}
        <section class="step">
          <header class="step-head">
            <h2>2. {t.draft.aspectsTitle}</h2>
            {#if imposedAspects(currentRules) === null}
              <div class="step-tools">
                <button type="button" class="btn small" onclick={drawAspects}>⇶ {t.draft.aspectsDraw}</button>
              </div>
            {/if}
          </header>
          {#if imposedAspects(currentRules) !== null}
            <p class="muted note">{t.draft.aspectsImposed}</p>
          {:else}
            {#if (currentRules?.aspectCount ?? 1) > 1}
              <p class="muted small">{t.draft.aspectsPickN(currentRules?.aspectCount ?? 1)}</p>
            {/if}
            <div class="aspects">
              {#each aspectOptions as aspect (aspect)}
                <button type="button" class="aspect" data-faction={aspect} aria-pressed={current.aspects.includes(aspect)} onclick={() => toggleAspect(aspect)}>
                  <span class="dot" aria-hidden="true"></span>{t.aspect(aspect)}
                </button>
              {/each}
            </div>
          {/if}
        </section>

        <section class="step sliders">
          <label class="slider">
            <span class="slider-head"><span class="label">3. {t.draft.deckSize}</span><strong class="value">{current.deckSize}</strong></span>
            <input type="range" min={DRAFT_RULES.MIN_DECK_SIZE} max={DRAFT_RULES.MAX_DECK_SIZE} value={current.deckSize} oninput={(e) => setDeckSize(Number(e.currentTarget.value))} />
            <span class="muted note">{t.draft.deckSizeDetail(current.deckSize, signatureCount(current), remaining(current))}</span>
          </label>
        </section>
      {/if}

      {#if shortfallLines.length > 0}
        <div class="shortfall" role="alert">
          <p class="warn">{t.draft.shortfallTitle}</p>
          {#each shortfallLines as line (line.player)}
            <p>{t.draft.shortfallLine(line.player, line.needed, line.available)}</p>
          {/each}
          <p class="muted note">{t.draft.shortfallHint}</p>
        </div>
      {/if}

      <!-- The way on, pinned to the foot so it is never below a long grid. -->
      <div class="foot surface">
        <span class="muted small">
          {#if current.heroCode === null}
            {t.draft.chooseIdentity}
          {:else if !identityReady}
            {t.draft.aspectsPickN(currentRules?.aspectCount ?? 1)}
          {:else}
            {current.heroName} · {current.aspects.map((a) => t.aspect(a)).join(', ')} · {current.deckSize}
          {/if}
        </span>
        <span class="btn-row">
          {@render abandonButton()}
          <button type="button" class="btn btn--primary" disabled={!identityReady} onclick={confirmIdentity}>
            {draft.current >= draft.players.length - 1 ? t.draft.startDraft : t.draft.next}
          </button>
        </span>
      </div>
    </div>
  {:else if draft.phase === 'pick' && current !== null}
    {#if !handedOver}
      <!-- The device changes hands: the previous pick stays out of sight. -->
      <div class="surface panel handover">
        <h2>{t.draft.handOver(draft.current + 1)}</h2>
        <p class="muted">{current.heroName} · {current.aspects.map((a) => t.aspect(a)).join(', ')}</p>
        <p class="muted note">{t.draft.handOverDetail}</p>
        <button type="button" class="btn btn--primary" onclick={() => (handedOver = true)}>{t.draft.reveal}</button>
      </div>
    {:else}
      <!-- Page 3: the table, the deck beside it. -->
      <div class="table">
        <div class="board">
          <header class="board-head">
            <div>
              <p class="hero-name">{current.heroName}</p>
              <p class="aspect-line">{draft.players.length > 1 ? `${t.draft.playerN(draft.current + 1)} · ` : ''}{current.aspects.map((a) => t.aspect(a)).join(', ')}</p>
            </div>
            <div class="progress-block">
              <p class="progress-text">{current.picks.length} / {current.picks.length + remaining(current)}</p>
              <p class="muted small">{t.draft.picksLabel}</p>
            </div>
          </header>
          <span class="progress" aria-hidden="true">
            <span class="fill" style:width={`${Math.round((current.picks.length / Math.max(1, current.picks.length + remaining(current))) * 100)}%`}></span>
          </span>
          <h2 class="round">{t.draft.round(current.picks.length + 1)}</h2>

          {#if offerRows.length === 0}
            <div class="notice surface">
              <p>{t.draft.nothingLeft}</p>
              <button type="button" class="btn" onclick={stopHere}>{t.draft.stopHere}</button>
            </div>
          {:else}
            <ul class="offer">
              {#each offerRows as row (row.code)}
                <li>
                  <CardHover code={row.code}>
                    <button type="button" class="card" aria-label={row.name} onclick={() => takeCard(row.code)}>
                      {#if images.get(row.code) !== undefined}
                        <img src={images.get(row.code)} alt="" loading="lazy" />
                      {:else}
                        <span class="card-blank">{row.name}</span>
                      {/if}
                    </button>
                  </CardHover>
                  <p class="card-name">{row.name}</p>
                  <p class="muted small">{row.typeName}{row.cost === null ? '' : ` · ${t.cost} ${row.cost}`}
                    <button type="button" class="btn btn--text small" aria-label={row.name} onclick={() => showCard(row.code)}>?</button></p>
                </li>
              {/each}
            </ul>
          {/if}
          <div class="btn-row">{@render abandonButton()}</div>
        </div>

        <aside class="deck surface">
          <header class="deck-head">
            <h2>{t.draft.yourDeck}</h2>
            <span class="count">{cardCount(current)}/{current.deckSize}</span>
          </header>
          <p class="group-title">{t.draft.identity}</p>
          <p class="deck-identity"><span class="chip">{current.heroName}</span></p>
          {#each deckGroups as group (group.type)}
            <p class="group-title">{group.type} ({group.cards.reduce((n, c) => n + c.count, 0)})</p>
            <ul class="deck-list">
              {#each group.cards as card (card.code)}
                <li>
                  <span class="muted qty">{card.count}×</span>
                  <CardHover code={card.code}><span class="deck-card-name">{card.name}</span></CardHover>
                  {#if card.cost !== null}<span class="cost">{card.cost}</span>{/if}
                </li>
              {/each}
            </ul>
          {/each}
        </aside>
      </div>
    {/if}
  {:else if draft.phase === 'finish'}
    <!-- Page 4: the names, then everything at once. -->
    <div class="surface panel">
      <h2>{t.draft.finishTitle}</h2>
      <p class="muted note">{t.draft.finishDetail}</p>
      {#each draft.players as player, i (player.index)}
        <label class="setting">
          <span class="label">{t.draft.playerN(player.index + 1)} · {player.heroName} · {player.aspects.map((a) => t.aspect(a)).join(', ')} · {cardCount(player)}/{player.deckSize}{isFull(player) ? '' : ' ✗'}</span>
          <input class="field" type="text" aria-label={t.draft.deckName} value={names[player.index] ?? proposedNames[i] ?? ''} oninput={(e) => (names = { ...names, [player.index]: e.currentTarget.value })} />
        </label>
      {/each}
      {#if finishError !== null}
        <p class="warn" role="alert">{finishError}</p>
      {/if}
      <div class="btn-row">
        <button type="button" class="btn btn--primary" disabled={saving} onclick={() => void finish()}>{t.draft.finish}</button>
        {@render abandonButton()}
      </div>
    </div>
  {/if}
</section>

{#snippet heroTile(code: string, available: boolean)}
  {@const taken = takenBy(code)}
  {@const art = cardImageUrl(rowByCode.get(code)?.img)}
  <li>
    <button type="button" class="hero" class:chosen={current?.heroCode === code} disabled={!available} aria-label={nameOf(code)} onclick={() => chooseHero(code)}>
      {#if art !== null}
        <img class="hero-card" src={art} alt="" loading="lazy" />
      {:else}
        <span class="hero-card hero-blank">{nameOf(code)}</span>
      {/if}
    </button>
    <p class="hero-tile-name">{nameOf(code)}</p>
    {#if taken !== null}<p class="muted small">{t.draft.takenBy(taken)}</p>{/if}
  </li>
{/snippet}

{#snippet abandonButton()}
  {#if confirmingAbandon}
    <span class="muted small">{t.draft.abandonConfirm}</span>
    <button type="button" class="btn btn--quiet danger" onclick={() => void abandon()}>{t.draft.abandon}</button>
    <button type="button" class="btn btn--quiet" onclick={() => (confirmingAbandon = false)}>{t.cancel}</button>
  {:else}
    <button type="button" class="btn btn--quiet danger" onclick={() => (confirmingAbandon = true)}>{t.draft.abandon}</button>
  {/if}
{/snippet}

<style>
  h1 {
    font-size: var(--text-2xl);
    margin: var(--space-5) 0 var(--space-3);
  }

  h2 {
    font-size: var(--text-lg);
    margin: 0 0 var(--space-2);
  }

  .intro {
    max-width: var(--prose-max);
  }

  .panel {
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
    max-width: 48rem;
  }

  .setting {
    display: grid;
    gap: var(--space-1);
  }

  .label {
    font-weight: var(--weight-semibold);
  }

  .value {
    color: var(--accent);
  }

  .note,
  .small {
    font-size: var(--text-sm);
  }

  .btn-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .danger {
    color: var(--danger);
  }

  .warn {
    color: var(--danger);
    font-weight: var(--weight-semibold);
    margin: 0;
  }

  .shortfall {
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border-inline-start: 3px solid var(--danger);
    display: grid;
    gap: var(--space-1);
  }

  /* The identities as their cards, the chosen one ringed. */
  .heroes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(9.5rem, 45%), 1fr));
    gap: var(--space-3);
  }

  .heroes.single {
    grid-template-columns: minmax(0, 12rem);
  }

  .heroes li {
    display: grid;
    gap: 2px;
    justify-items: center;
  }

  .hero {
    width: 100%;
    aspect-ratio: 5 / 7;
    padding: 0;
    border: 3px solid transparent;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    overflow: hidden;
    cursor: pointer;
    transition: transform var(--motion-fast) var(--ease-out), border-color var(--motion-fast) var(--ease-out);
  }

  .hero:hover:not(:disabled),
  .hero:focus-visible {
    transform: translateY(-3px);
    border-color: var(--accent);
  }

  .hero.chosen {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .hero:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .hero-card {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .hero-blank {
    display: grid;
    place-items: center;
    padding: var(--space-2);
    font-weight: var(--weight-semibold);
  }

  .hero-tile-name {
    margin: 0;
    font-weight: var(--weight-semibold);
    text-align: center;
  }

  .hero-name {
    font-size: var(--text-xl);
    font-weight: var(--weight-bold);
    margin: 0;
  }

  /* The numbered steps of the identity page. */
  .steps {
    display: grid;
    gap: var(--space-4);
  }

  .step-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }

  .step-head h2 {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .step-tools .search {
    width: min(18rem, 100%);
  }

  .sliders {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-4);
    border-radius: var(--radius-md);
    background: var(--surface-1);
    border: 1px solid var(--hairline);
  }

  @media (min-width: 48rem) {
    .sliders {
      grid-template-columns: 1fr 1fr;
    }
  }

  .slider {
    display: grid;
    gap: var(--space-1);
  }

  .slider-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .slider .value {
    font-size: var(--text-2xl);
    color: var(--gold);
  }

  /* The way on, pinned above the bottom bar so it never scrolls away. */
  .foot {
    position: sticky;
    bottom: calc(var(--safe-bottom, 0px) + 4.25rem);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    z-index: 2;
  }

  /* The five aspects as wide buttons with their colour, as on a card. */
  .aspects {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
    gap: var(--space-2);
  }

  .aspect {
    min-height: 3rem;
    border-radius: var(--radius-md);
    border: 2px solid var(--hairline);
    background: var(--surface-2);
    color: inherit;
    font: inherit;
    font-weight: var(--weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    cursor: pointer;
  }

  .aspect[aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--text-muted);
  }

  [data-faction='leadership'] .dot { background: var(--faction-leadership); }
  [data-faction='justice'] .dot { background: var(--faction-justice); }
  [data-faction='aggression'] .dot { background: var(--faction-aggression); }
  [data-faction='protection'] .dot { background: var(--faction-protection); }
  [data-faction='pool'] .dot { background: var(--faction-pool); }

  .handover {
    text-align: center;
    justify-items: center;
    padding: var(--space-6) var(--space-4);
  }

  /* The table: the offer, and the deck beside it when there is room. */
  .table {
    display: grid;
    gap: var(--space-4);
  }

  @media (min-width: 64rem) {
    .table {
      grid-template-columns: minmax(0, 1fr) 18rem;
      align-items: start;
    }
  }

  .board-head {
    display: flex;
    justify-content: space-between;
    align-items: end;
    gap: var(--space-3);
  }

  .board-head p {
    margin: 0;
  }

  .aspect-line {
    color: var(--accent);
    font-weight: var(--weight-semibold);
  }

  .progress-block {
    text-align: end;
  }

  .progress-text {
    color: var(--gold);
    font-size: var(--text-2xl);
    font-weight: var(--weight-bold);
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .progress {
    display: block;
    height: 0.375rem;
    margin: var(--space-2) 0 var(--space-3);
    border-radius: var(--radius-pill);
    background: var(--surface-2);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .round {
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: var(--text-base);
  }

  .offer {
    list-style: none;
    margin: 0 0 var(--space-3);
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(11rem, 45%), 1fr));
    gap: var(--space-3);
  }

  .offer li {
    display: grid;
    justify-items: center;
    gap: 2px;
  }

  .offer p {
    margin: 0;
    text-align: center;
  }

  .card {
    width: 100%;
    aspect-ratio: 5 / 7;
    padding: 0;
    border: 2px solid transparent;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    overflow: hidden;
    cursor: pointer;
    transition: transform var(--motion-fast) var(--ease-out), border-color var(--motion-fast) var(--ease-out);
  }

  .card:hover,
  .card:focus-visible {
    transform: translateY(-3px);
    border-color: var(--accent);
  }

  .card img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .card-blank {
    display: grid;
    place-items: center;
    height: 100%;
    padding: var(--space-2);
    font-weight: var(--weight-semibold);
  }

  .card-name {
    font-weight: var(--weight-semibold);
  }

  .deck {
    padding: var(--space-3);
    display: grid;
    gap: var(--space-1);
    align-content: start;
  }

  .deck-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .count {
    color: var(--accent);
    font-weight: var(--weight-bold);
    font-variant-numeric: tabular-nums;
  }

  .group-title {
    margin: var(--space-2) 0 0;
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .deck-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
    font-size: var(--text-sm);
  }

  .deck-list li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 2px var(--space-2);
    border-radius: var(--radius-xs);
    background: var(--surface-2);
  }

  .qty {
    flex: none;
    font-variant-numeric: tabular-nums;
  }

  .deck-card-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cost {
    flex: none;
    min-width: 1.4rem;
    text-align: center;
    border-radius: var(--radius-xs);
    background: var(--surface-1);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .deck-identity {
    margin: 0;
  }

  .notice {
    padding: var(--space-4);
    display: grid;
    gap: var(--space-2);
    justify-items: start;
  }
</style>
