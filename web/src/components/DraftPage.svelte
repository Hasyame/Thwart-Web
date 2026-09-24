<script lang="ts">
  import { tick } from 'svelte';
  import { liveQuery } from 'dexie';
  import type { Strings } from '../lib/i18n';
  import type { IndexRow, Locale, Pack } from '../lib/types';
  import { normalizeForSearch } from '../lib/normalize';
  import { dealSealed, selectSealed, SEALED_SIZE, BOOSTER_SIZE, BOOSTER_COUNT, openedBoosters, openBooster, openAllBoosters, isBuilding, buildSealedDeck } from '../lib/draft/sealed';
  import { canTake } from '../lib/draft/engine';
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
  import { freshSeed, seeded, shuffled } from '../lib/draft/random';
  import { buildStock } from '../lib/draft/stock';
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
    packs: readonly Pack[];
    initiallySealed?: boolean;
    completedDeckIds?: string[];
    onSaved: (ids: string[], sealed: boolean) => void;
    storageOk: boolean;
    /** Opens a deck's page, once the decks are on the shelf. */
    onDone: () => void;
    onPlay: (ids: readonly string[], mode: 'random' | 'campaign' | 'own') => Promise<void>;
  }

  const { t, index, packs, storageOk, onDone, onPlay, onSaved, completedDeckIds = [], initiallySealed = false }: Props = $props();
  let savedDeckIds = $derived(completedDeckIds);

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

  const rowByCode = $derived(new Map(index.map((row) => [row.code, row] as const)));

  /*
   * The setup page's showcase: a hand of the collection's identities, fanned
   * out, and what the shelf holds. Five drawn once per opening of the page,
   * not per render, so the hand stays still while the settings change.
   */
  const showcase = $derived.by(() => {
    const pool = heroes.filter((code) => rowByCode.get(code)?.img !== undefined);
    const hand = shuffled(pool, seeded(showcaseSeed)).slice(0, 5);
    return hand.map((code) => ({ code, name: nameOf(code), art: cardImageUrl(rowByCode.get(code)?.img) }));
  });
  const showcaseSeed = freshSeed();
  const shelfSize = $derived.by(() => {
    let cards = 0;
    for (const copies of buildStock(index, sessionPacks).stock.values()) {
      cards += copies;
    }
    return cards;
  });
  const nameOf = (code: string | null): string => (code === null ? '' : (rowByCode.get(code)?.name ?? code));

  // --- the draft, written down after every change ----------------------------------

  let draft = $state.raw<DraftState | null>(null);
  let loaded = $state(false);

  /*
   * The collection this draft is played from: the saved one, or the one
   * adjusted for this session once a draft has begun. The identities follow
   * it too, so a friend's hero pack added for the evening can be drafted.
   */
  const sessionPacks = $derived(
    draft?.collection === undefined ? ownedPacks : new Map(Object.entries(draft.collection)),
  );
  const heroes = $derived(ownedHeroes(index, sessionPacks));
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
    return buildContext(index, draft.collection === undefined ? ownedPacks : new Map(Object.entries(draft.collection)), codes);
  });

  // --- settings -------------------------------------------------------------------

  let settings = $state({ ...DEFAULT_SETTINGS });
  let initialFormatApplied = $state(false);
  $effect(() => {
    if (!initialFormatApplied) {
      settings.format = initiallySealed ? 'sealed' : 'draft';
      initialFormatApplied = true;
    }
  });

  function begin(): void {
    names = {};
    finishError = null;
    const players = Array.from({ length: settings.players }, (_, i) => EMPTY_PLAYER(i));
    const fresh: DraftState = {
      collection: Object.fromEntries(ownedPacks),
      settings: { ...settings },
      players,
      phase: 'identity',
      current: 0,
      stock: {},
      packs: [],
      builds: 0,
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
    return { ...s, players: s.players.map((p, i) => (i === player.index ? player : p)) };
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
    const started = draft.settings.format === 'sealed' ? dealSealed(stocked, context) : start(stocked, context);
    if (draft.settings.format === 'sealed') {
      shortfallLines = (started.sealedPools ?? []).flatMap((pool, i) => pool.length < SEALED_SIZE
        ? [{ player: i + 1, needed: SEALED_SIZE, available: pool.length }] : []);
      if (shortfallLines.length > 0) return;
    }
    commit(started);
    handedOver = draft.players.length === 1;
  }

  // --- the table ----------------------------------------------------------------

  /** Whether the current player has taken the device; false hides the offer. */
  let handedOver = $state(false);

  // --- the collection for this session ------------------------------------------

  let packQuery = $state('');
  let everyPack = $state(false);
  const countIn = (code: string): number => draft?.collection?.[code] ?? ownedPacks.get(code) ?? 0;
  /** Packs whose count differs from the saved collection. */
  const sessionChanges = $derived(packs.filter((pack) => countIn(pack.code) !== (ownedPacks.get(pack.code) ?? 0)).length);
  const sessionPackCount = $derived(packs.filter((pack) => countIn(pack.code) > 0).length);
  /*
   * Grouped as the Collection page groups them, each group in release order.
   * By default only what is on the table: packs in the saved collection and
   * packs added for this session. A search looks through every pack, since
   * the point of searching is usually a box somebody else brought.
   */
  const PACK_GROUPS = [
    { type: 'CORE', label: (s: Strings) => s.bulkCore },
    { type: 'CAMPAIGN_BOX', label: (s: Strings) => s.bulkCampaigns },
    { type: 'HERO_PACK', label: (s: Strings) => s.bulkHeroes },
    { type: 'SCENARIO_PACK', label: (s: Strings) => s.bulkScenarios },
    { type: null, label: (s: Strings) => s.draft.otherPacks },
  ] as const;
  const packGroups = $derived.by(() => {
    const needle = normalizeForSearch(packQuery.trim());
    const shown = [...packs]
      .sort((a, b) => a.position - b.position)
      .filter((pack) =>
        needle !== ''
          ? normalizeForSearch(pack.name).includes(needle)
          : everyPack || countIn(pack.code) > 0 || (ownedPacks.get(pack.code) ?? 0) > 0,
      );
    const known = new Set<string>(PACK_GROUPS.flatMap((g) => (g.type === null ? [] : [g.type])));
    return PACK_GROUPS.map((group) => ({
      label: group.label(t),
      packs: shown.filter((pack) => (group.type === null ? pack.type === null || !known.has(pack.type) : pack.type === group.type)),
    })).filter((group) => group.packs.length > 0);
  });

  function resetCollection(): void {
    if (draft === null) return;
    commit({ ...draft, collection: Object.fromEntries(ownedPacks) });
  }

  function setPack(code: string, value: number): void {
    if (draft === null || !Number.isFinite(value)) return;
    commit({ ...draft, collection: { ...(draft.collection ?? Object.fromEntries(ownedPacks)), [code]: Math.max(0, Math.min(99, Math.trunc(value))) } });
  }

  function chooseSealed(code: string, add: boolean): void {
    if (draft !== null && context !== null) commit(selectSealed(draft, code, add, context));
  }

  function confirmSealed(): void {
    if (draft === null || current === null || !isFull(current)) return;
    if (draft.current + 1 < draft.players.length) commit({ ...draft, current: draft.current + 1 });
    else commit({ ...draft, phase: 'finish' });
  }

  const current = $derived(draft === null ? null : (draft.players[draft.current] ?? null));
  const sealedVisible = $derived.by(() => {
    if (draft === null) return [];
    const pool = draft.sealedPools?.[draft.current] ?? [];
    if (isBuilding(draft)) return [...new Set(pool)];
    const opened = openedBoosters(draft);
    return opened === 0 ? [] : pool.slice((opened - 1) * BOOSTER_SIZE, opened * BOOSTER_SIZE);
  });
  const offerRows = $derived(
    draft === null || context === null
      ? []
      : (draft.settings.format === 'sealed' ? sealedVisible : draft.offer)
        .map((code) => context.pool.get(code)).filter((r): r is IndexRow => r !== undefined),
  );

  /* The offer's pictures, fetched as they come; the picks show names only.
     A card MarvelCDB has no picture for is remembered as null, otherwise the
     effect would fetch it again every time the map changed and never settle:
     the first Luke Cage pack offered froze the page that way. */
  let images = $state.raw<ReadonlyMap<string, string | null>>(new Map());
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
          next.set(code, url);
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
  async function play(mode: 'random' | 'campaign' | 'own'): Promise<void> {
    if (saving) return;
    saving = true;
    finishError = null;
    try { await onPlay(savedDeckIds, mode); }
    catch (error) { finishError = error instanceof Error && error.message === t.draft.activeGame ? error.message : t.draft.preparationFailed; }
    finally { saving = false; }
  }

  /** Each player's name, the one typed or the default, with the earlier ones taken. */
  const proposedNames = $derived.by((): string[] => {
    if (draft === null) {
      return [];
    }
    const taken = [...deckNames];
    return draft.players.map((player) => {
      const typed = (names[player.index] ?? player.deckName)?.trim();
      const rules = player.heroCode === null ? null : rulesFor(index, player.heroCode);
      const prefix = draft?.settings.format === 'sealed' ? 'SEALED-' : 'DRAFT-';
      const name = typed !== undefined && typed !== '' ? typed : defaultName(player.heroName, player.aspects, rules,
        taken.map((name) => name.replace(prefix, 'DRAFT-'))).replace('DRAFT-', prefix);
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
      const ids = decks.map(() => `local-${crypto.randomUUID()}`);
      await db.transaction('rw', db.decks, db.drafts, async () => {
        await db.decks.bulkPut(
          decks.map(({ player, slots, name }, i) => ({
            id: ids[i]!,
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
            // So a game played with it records mode `draft`. Spec: achievements §5.
            tags: draft?.settings.format === 'sealed' ? 'sealed' : 'draft',
            rawJson: '',
            lastSyncedAt: now,
            locallyEdited: true,
          })),
        );
        await clearDraft();
      });
      syncAfter('edit');
      onSaved(ids, draft?.settings.format === 'sealed');
      draft = null;
    } catch {
      finishError = t.storageUnavailable;
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
  let heading = $state.raw<HTMLHeadingElement | null>(null);
  const stepKey = $derived(`${draft?.phase ?? 'setup'}:${draft?.current ?? 0}:${draft?.pickCount ?? 0}:${handedOver}:${draft?.sealedOpened?.[draft.current]}:${draft?.sealedBuilding?.[draft.current]}`);
  $effect(() => {
    void stepKey;
    let cancelled = false;
    void tick().then(() => {
      if (cancelled) return;
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: 'start' });
    });
    return () => { cancelled = true; };
  });
</script>

<section class="draft">
  <h1 class="limited-title" bind:this={heading} tabindex="-1">
    <span class="title-burst">{(draft?.settings.format === 'sealed' || (savedDeckIds.length > 0 && initiallySealed)) ? t.draft.sealed : 'Draft'}</span>
    {#if draft === null && savedDeckIds.length === 0}<span class="title-divider" aria-hidden="true">/</span><span class="title-secondary">{t.draft.sealed}</span>{/if}
  </h1>

  {#if savedDeckIds.length > 0}
    <div class="surface panel">
      <h2>{t.draft.playNext}</h2>
      {#if finishError}<p role="alert">{finishError}</p>{/if}
      <div class="btn-row">
        <button class="btn btn--primary" type="button" disabled={saving} onclick={() => play('random')}>{t.draft.randomGame}</button>
        <button class="btn" type="button" disabled={saving} onclick={() => play('campaign')}>{t.draft.campaign}</button>
        <button class="btn" type="button" disabled={saving} onclick={() => play('own')}>{t.draft.ownGame}</button>
        <button class="btn btn--quiet" type="button" onclick={onDone}>{t.draft.later}</button>
      </div>
    </div>
  {:else if !storageOk}
    <div class="notice surface"><p>{t.storageUnavailable}</p></div>
  {:else if !loaded}
    <p class="notice muted">{t.loading}</p>
  {:else if draft === null}
    <!-- Page 1: the settings. -->
    <p class="muted intro">{settings.format === 'sealed' ? t.draft.sealedDescription : t.draft.intro}</p>
    {#if heroes.length === 0}
      <div class="notice surface"><p>{t.draft.noHeroes}</p><a class="btn btn--primary" href="/collection">{t.navCollection}</a></div>
    {:else}
      <div class="setup">
      <div class="surface panel">
        <div class="mode-choice">
          <button type="button" class="mode-button" aria-pressed={settings.format !== 'sealed'} onclick={() => (settings.format = 'draft')}>Draft</button>
          <button type="button" class="mode-button" aria-pressed={settings.format === 'sealed'} onclick={() => (settings.format = 'sealed')}>{t.draft.sealed}</button>
        </div>
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
        {#if settings.format !== 'sealed'}<label class="slider">
          <span class="slider-head"><span class="label">{t.draft.offerSize}</span><strong class="value">{settings.offerSize}</strong></span>
          <input type="range" min={DRAFT_RULES.MIN_OFFER_SIZE} max={DRAFT_RULES.MAX_OFFER_SIZE} bind:value={settings.offerSize} />
          <span class="muted note">{t.draft.offerSizeDetail}</span>
        </label>{/if}
        <label class="tick">
          <input type="checkbox" bind:checked={settings.synergyOnly} />
          <span>{t.draft.synergy}</span>
        </label>
        <p class="muted note">{t.draft.synergyDetail}</p>
        <div class="btn-row">
          <button type="button" class="btn btn--primary" onclick={begin}>{t.draft.begin}</button>
        </div>
      </div>

      <!-- A hand of the collection's identities, and what the draft does
           with it: the page was a form on an empty field, and a draft is a
           table with cards on it. -->
      <aside class="showcase" aria-hidden="true">
        <div class="fan">
          {#each showcase as hero, i (hero.code)}
            {#if hero.art !== null}
              <img class="fan-card" src={hero.art} alt="" loading="lazy" style:--i={i - (showcase.length - 1) / 2} />
            {/if}
          {/each}
        </div>
        <p class="muted small shelf">{t.draft.shelf(heroes.length, shelfSize)}</p>
        <ol class="steps-list">
          <li>{t.draft.stepIdentity}</li>
          <li>{t.draft.stepAspects}</li>
          <li>{settings.format === 'sealed' ? t.draft.sealedDescription : t.draft.stepPacks}</li>
        </ol>
      </aside>
      </div>
    {/if}
  {:else if draft.phase === 'identity' && current !== null}
    <!-- Page 2: this player's identity, aspects and deck size, in three
         numbered steps, the identities as their cards. -->
    <div class="steps">
      <!-- The collection for this session, before the identity, because
           it decides which identities there are. A step heading like the
           ones below, so it is not missed; the packs stay folded. -->
      <section class="step">
      <header class="step-head">
        <h2>{t.draft.sessionCollection}</h2>
      </header>
      <details class="surface session-packs">
        <summary>
          <span class="label">{t.draft.sessionAdjust}</span>
          <span class="muted small">{t.draft.sessionSummary(sessionPackCount, sessionChanges)}</span>
        </summary>
        <div class="session-body">
          <p class="muted note">{t.draft.sessionCollectionHint}</p>
          <div class="session-tools">
            <input class="field search" type="search" placeholder={t.draft.searchPacks} aria-label={t.draft.searchPacks} bind:value={packQuery} />
            <label class="tick"><input type="checkbox" bind:checked={everyPack} /><span>{t.draft.everyPack}</span></label>
            {#if sessionChanges > 0}
              <button type="button" class="btn btn--quiet small" onclick={resetCollection}>{t.draft.resetCollection}</button>
            {/if}
          </div>
          <p class="muted small">{t.draft.shelf(heroes.length, shelfSize)}</p>
          {#each packGroups as group (group.label)}
            <h3 class="pack-group">{group.label}</h3>
            <ul class="pack-list">
              {#each group.packs as pack (pack.code)}
                {@const n = countIn(pack.code)}
                {@const saved = ownedPacks.get(pack.code) ?? 0}
                <li class="pack-row" class:changed={n !== saved} class:absent={n === 0}>
                  <span class="pack-name">
                    {pack.name}
                    {#if n !== saved}<span class="muted small was">{t.draft.savedCount(saved)}</span>{/if}
                  </span>
                  <span class="stepper">
                    <button type="button" class="btn small" aria-label={t.draft.fewerCopies(pack.name)} disabled={n === 0} onclick={() => setPack(pack.code, n - 1)}>−</button>
                    <output class="copies" aria-live="polite">{n}</output>
                    <button type="button" class="btn small" aria-label={t.draft.moreCopies(pack.name)} disabled={n >= 99} onclick={() => setPack(pack.code, n + 1)}>+</button>
                  </span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="muted small">{t.draft.noPackFound}</p>
          {/each}
        </div>
      </details>
      </section>

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
                  <span class="dot" aria-hidden="true"></span><span class="aspect-label">{t.aspect(aspect)}</span>
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
            {draft.current >= draft.players.length - 1 ? (draft.settings.format === 'sealed' ? t.draft.sealedStart : t.draft.startDraft) : t.draft.next}
          </button>
        </span>
      </div>
    </div>
  {:else if draft.phase === 'pick' && current !== null && draft.settings.format === 'sealed' && context !== null}
    <div class="surface panel">
      <h2>{t.draft.playerN(draft.current + 1)} · {current.heroName}</h2>
      <p>{t.draft.sealedDescription}</p>
      {#if !isBuilding(draft)}
        <div class="booster-track" aria-label={t.draft.sealed}>
          {#each Array.from({ length: BOOSTER_COUNT }, (_, i) => i + 1) as number}
            <span class="booster" class:opened={number <= openedBoosters(draft)} aria-label={t.draft.boosterProgress(number)}>{number <= openedBoosters(draft) ? '✓' : number}</span>
          {/each}
        </div>
        {#if openedBoosters(draft) > 0}<h3>{t.draft.boosterProgress(openedBoosters(draft))}</h3>{/if}
      {:else}<p>{cardCount(current)} / {current.deckSize}</p>{/if}
      {@render sealedActions()}
      <div class="sealed-grid">
      {#each sealedVisible as code, position (`${position}-${code}`)}
        {@const row = context.pool.get(code)}
        {@const selected = current.picks.filter((c) => c === code).length}
        {@const copies = draft.sealedPools?.[draft.current]?.filter((c) => c === code).length ?? 0}
        <div class="sealed-card">
          <CardHover {code}>
          <button class="card" type="button" aria-label={row?.name ?? code} onclick={() => showCard(code)}>
            {#if typeof images.get(code) === 'string'}
              <img src={images.get(code)} alt="" loading="lazy" />
            {:else}<span class="card-blank">{row?.name ?? code}</span>{/if}
          </button>
          </CardHover>
          <p class="sealed-name">{row?.name ?? code}</p>
          {#if isBuilding(draft)}<div class="sealed-controls">
          <button class="btn" type="button" aria-label={`− ${row?.name ?? code}`} disabled={selected === 0} onclick={() => chooseSealed(code, false)}>−</button>
          <span>{selected} / {copies}</span>
          <button class="btn" type="button" aria-label={`+ ${row?.name ?? code}`} disabled={isFull(current) || selected >= copies || row === undefined || !canTake(current, row, context)} onclick={() => chooseSealed(code, true)}>+</button>
          </div>{/if}
        </div>
      {/each}
      </div>
      {#if sealedVisible.length > 0}{@render sealedActions()}{/if}
      {@render abandonButton()}
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
          <!-- The packs were built before the first pick; this is how many
               are still to open before the shelf is shuffled into more. -->
          <p class="muted small sealed">{t.draft.packsSealed((draft.packs[draft.current] ?? []).length)}</p>

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
                      {#if typeof images.get(row.code) === 'string'}
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
          <input class="field" type="text" aria-label={t.draft.deckName} value={names[player.index] ?? player.deckName ?? proposedNames[i] ?? ''} oninput={(e) => { names = { ...names, [player.index]: e.currentTarget.value }; if (draft) commit(withPlayer(draft, { ...player, deckName: e.currentTarget.value })); }} />
        </label>
      {/each}
      {#if finishError !== null}
        <p class="warn" role="alert">{finishError}</p>
      {/if}
      <div class="btn-row">
        {#if draft.settings.format === 'sealed'}<button type="button" class="btn" disabled={saving} onclick={() => draft && commit({ ...draft, phase: 'pick', current: 0 })}>{t.draft.reviseSealed}</button>{/if}
        <button type="button" class="btn btn--primary" disabled={saving} onclick={() => void finish()}>{draft.settings.format === 'sealed' ? t.draft.sealedFinish : t.draft.finish}</button>
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

{#snippet sealedActions()}
  {#if draft !== null && current !== null}
    <div class="btn-row">
      {#if !isBuilding(draft)}
        {#if openedBoosters(draft) < BOOSTER_COUNT}
          <button class="btn btn--primary" type="button" onclick={() => draft && commit(openBooster(draft))}>{t.draft.openBooster(openedBoosters(draft) + 1)}</button>
          <button class="btn" type="button" onclick={() => draft && commit(openAllBoosters(draft))}>{t.draft.openAllBoosters}</button>
        {:else}
          <button class="btn btn--primary" type="button" onclick={() => draft && commit(buildSealedDeck(draft))}>{t.draft.buildSealed}</button>
        {/if}
      {:else}<button class="btn btn--primary" type="button" disabled={!isFull(current)} onclick={confirmSealed}>{t.draft.next}</button>{/if}
    </div>
  {/if}
{/snippet}

{#snippet abandonButton()}
  {#if confirmingAbandon}
    <span class="muted small">{draft?.settings.format === 'sealed' ? t.draft.sealedAbandonConfirm : t.draft.abandonConfirm}</span>
    <button type="button" class="btn btn--quiet danger" onclick={() => void abandon()}>{draft?.settings.format === 'sealed' ? t.draft.sealedAbandon : t.draft.abandon}</button>
    <button type="button" class="btn btn--quiet" onclick={() => (confirmingAbandon = false)}>{t.cancel}</button>
  {:else}
    <button type="button" class="btn btn--quiet danger" onclick={() => (confirmingAbandon = true)}>{draft?.settings.format === 'sealed' ? t.draft.sealedAbandon : t.draft.abandon}</button>
  {/if}
{/snippet}

<style>
  .mode-choice { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); margin-bottom: var(--space-2); }
  .mode-button {
    min-height: 4rem;
    padding: var(--space-3);
    border: 2px solid var(--hairline);
    border-radius: 3px;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-size: clamp(1.2rem, 3vw, 1.8rem);
    font-weight: 900;
    font-style: italic;
    text-transform: uppercase;
    cursor: pointer;
    transition: transform 150ms ease, box-shadow 150ms ease, background 150ms ease;
  }
  .mode-button:hover { transform: translateY(-2px); }
  .mode-button[aria-pressed='true'] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); box-shadow: 4px 4px 0 var(--text); transform: translate(-2px, -2px); }
  @media (prefers-reduced-motion: reduce) { .mode-button { transition: none; } }
  .booster-track { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .booster {
    display: grid;
    place-items: center;
    width: 3rem;
    aspect-ratio: 2 / 3;
    background: repeating-linear-gradient(135deg, transparent 0 6px, rgb(0 0 0 / 12%) 6px 8px), var(--accent);
    color: var(--accent-ink);
    border-block: 4px solid var(--text);
    font-size: var(--text-xl);
    font-weight: 900;
    transform: skewY(-4deg);
  }
  .booster.opened { background: var(--surface-2); color: var(--text-muted); }
  .sealed-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 10rem), 1fr));
    gap: var(--space-4);
    margin-block: var(--space-4);
  }
  .sealed-card { display: flex; flex-direction: column; min-width: 0; }
  .sealed-name { overflow-wrap: anywhere; margin-block: var(--space-2); }
  .sealed-controls {
    display: grid;
    grid-template-columns: 2.75rem minmax(0, 1fr) 2.75rem;
    align-items: center;
    text-align: center;
    gap: var(--space-1);
    margin-top: auto;
  }
  .sealed-controls .btn { padding: 0; min-height: 2.75rem; }
  .limited-title {
    scroll-margin-top: calc(5rem + env(safe-area-inset-top));
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35em;
    font-size: clamp(1.8rem, 5vw, 3.2rem);
    font-weight: 900;
    font-style: italic;
    line-height: 1.1;
    text-transform: uppercase;
    letter-spacing: -0.035em;
    margin: var(--space-5) 0 var(--space-5);
    border: 0;
    outline: none;
  }
  .title-burst {
    background: var(--accent);
    color: var(--accent-ink);
    padding: 0.16em 0.45em 0.22em;
    clip-path: polygon(5% 0, 100% 0, 95% 100%, 0 100%);
  }
  .title-divider { color: var(--accent); font-weight: 900; }
  .title-secondary { color: var(--text); }

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

  .session-packs {
    padding: var(--space-3) var(--space-4);
    max-width: 48rem;
  }

  .session-packs summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
    min-height: var(--tap-min);
    align-content: center;
    cursor: pointer;
    list-style: none;
  }

  /* A flex summary loses the browser's own marker, so it gets one back. */
  .session-packs summary::-webkit-details-marker {
    display: none;
  }

  .session-packs summary::before {
    content: '▸';
    color: var(--text-muted);
    transition: transform var(--motion-fast) var(--ease-out);
  }

  .session-packs[open] summary::before {
    transform: rotate(90deg);
  }

  @media (prefers-reduced-motion: reduce) {
    .session-packs summary::before {
      transition: none;
    }
  }

  .session-body {
    display: grid;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .session-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }

  .session-tools .search {
    flex: 1 1 14rem;
    width: auto;
  }

  .pack-group {
    margin: var(--space-3) 0 0;
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
  }

  .pack-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-1) var(--space-4);
  }

  @media (min-width: 40rem) {
    .pack-list {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .pack-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    border-left: 3px solid transparent;
  }

  /* Changed for this session: marked, with the saved count beside it. */
  .pack-row.changed {
    border-left-color: var(--accent);
    background: var(--accent-soft);
  }

  .pack-row.absent .pack-name {
    color: var(--text-muted);
  }

  .pack-name {
    min-width: 0;
  }

  .was {
    display: block;
  }

  .stepper {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex: none;
  }

  .stepper .btn {
    min-width: 2.25rem;
    padding-inline: 0;
  }

  .copies {
    min-width: 2ch;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-semibold);
  }

  /* The settings and the showcase side by side where there is room. */
  .setup {
    display: grid;
    gap: var(--space-4);
    align-items: start;
  }

  @media (min-width: 64rem) {
    .setup {
      grid-template-columns: minmax(0, 48rem) minmax(18rem, 1fr);
    }
  }

  .showcase {
    display: grid;
    gap: var(--space-3);
    justify-items: center;
    padding: var(--space-3) 0;
  }

  /* Five cards fanned as a hand, each turned a little more than the last. */
  /* Tall enough for the outer cards, which the turn drops below the middle
     one: the box is the fan's whole outline, so nothing under it is covered. */
  .fan {
    position: relative;
    width: 100%;
    max-width: 26rem;
    aspect-ratio: 26 / 18;
  }

  .fan-card {
    position: absolute;
    left: 50%;
    top: 0;
    width: 32%;
    aspect-ratio: 5 / 7;
    object-fit: cover;
    border-radius: var(--radius-md);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
    transform-origin: 50% 130%;
    transform: translateX(-50%) rotate(calc(var(--i) * 11deg));
    transition: transform var(--motion-base) var(--ease-out);
  }

  .fan:hover .fan-card {
    transform: translateX(-50%) rotate(calc(var(--i) * 15deg));
  }

  .shelf {
    margin: 0;
    text-align: center;
  }

  .steps-list {
    margin: 0;
    padding-left: 1.4em;
    max-width: 24rem;
    color: var(--text-muted);
    font-size: var(--text-sm);
    display: grid;
    gap: var(--space-1);
  }

  .steps-list li::marker {
    color: var(--accent);
    font-weight: var(--weight-bold);
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
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
    gap: var(--space-2);
  }

  .aspect {
    min-width: 0;
    padding: var(--space-2) var(--space-3);
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

  .aspect-label {
    max-width: 100%;
    overflow-wrap: anywhere;
    text-align: center;
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
    margin-bottom: 0;
  }

  .sealed {
    text-align: center;
    margin: 0 0 var(--space-3);
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

  /* The hover wrapper is inline; the button must still fill the cell so a
     card without a picture keeps a card's shape. */
  .offer li > :global(.hover) {
    display: block;
    width: 100%;
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
