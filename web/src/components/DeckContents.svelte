<script lang="ts">
  import CardHover from './CardHover.svelte';
  import DeckBanner from './DeckBanner.svelte';
  import CardPanel from './CardPanel.svelte';
  import { cardImageUrl } from '../lib/data';
  import type { Card, Locale } from '../lib/types';
  import type { SavedDeck } from '../lib/records';
  import type { Strings } from '../lib/i18n';
  import { deckViewUrl, parseSlots } from '../lib/decks';
  import {
    deckAsText,
    deckStatistics,
    heroRules,
    validateDeck,
    type DeckProblem,
  } from '../lib/deckRules';

  interface Props {
    t: Strings;
    deck: SavedDeck;
    cardLocale: Locale;
    /** Full records for every pack the deck draws on, keyed by code. */
    cards: ReadonlyMap<string, Card>;
    ownedPackCodes: ReadonlySet<string>;
    packNames: ReadonlyMap<string, string>;
    openCard: (code: string) => void;
    cardHref: (code: string) => string;
    /** The page's own actions, beside the card. */
    onEdit: () => void;
    onDelete: () => void;
    onBack: () => void;
  }

  const { t, deck, cardLocale, cards, ownedPackCodes, packNames, openCard, cardHref, onEdit, onDelete, onBack }:
    Props = $props();

  /*
   * The toolbar: a word to find a card in this deck, an order, and whether
   * the list is names or pictures. Page state, not remembered: a question
   * about this deck, not a preference.
   */
  let search = $state('');
  let sort = $state<'name' | 'cost'>('name');
  let view = $state<'list' | 'grid'>('list');
  let confirming = $state(false);
  let copied = $state(false);

  const heroImage = $derived(cardImageUrl(cards.get(deck.heroCode)?.imagesrc));

  /*
   * The hero's nemesis set: the cards shuffled into the encounter deck when
   * the obligation comes up. In the hero's own pack, named after its set.
   * Shown for what it is -- part of playing this hero, not part of the deck.
   */
  const nemesis = $derived.by(() => {
    const setCode = hero?.card_set_code;
    if (setCode === null || setCode === undefined) {
      return [];
    }
    return [...cards.values()]
      .filter((card) => card.card_set_code === `${setCode}_nemesis`)
      .sort((a, b) => a.code.localeCompare(b.code));
  });

  async function copyText(): Promise<void> {
    const byTypeText = new Map(
      byType.map(([type, entries]) => [type, entries.map((e) => ({ quantity: e.quantity, name: e.card.name }))]),
    );
    await navigator.clipboard?.writeText(
      deckAsText(deck.name, deck.heroName, aspects.map((a) => t.aspect(a)), byTypeText, deck.kind === 'LOCAL' ? null : deckViewUrl(deck)),
    );
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  const slots = $derived(parseSlots(deck.slots));
  const hero = $derived(cards.get(deck.heroCode) ?? null);
  const aspects = $derived(deck.aspects === '' ? [] : deck.aspects.split(','));

  const resolved = $derived(
    [...slots.entries()]
      .map(([code, quantity]) => ({ card: cards.get(code) ?? null, code, quantity }))
      .filter((entry): entry is { card: Card; code: string; quantity: number } =>
        entry.card !== null,
      )
      .sort(
        (a, b) =>
          a.card.type_name.localeCompare(b.card.type_name) ||
          a.card.name.localeCompare(b.card.name),
      ),
  );

  const unresolved = $derived([...slots.keys()].filter((code) => !cards.has(code)));

  const byType = $derived.by(() => {
    const groups = new Map<string, typeof resolved>();
    for (const entry of resolved) {
      const bucket = groups.get(entry.card.type_name) ?? [];
      bucket.push(entry);
      groups.set(entry.card.type_name, bucket);
    }
    return [...groups.entries()];
  });

  /** The groups as the toolbar narrows and orders them. */
  const shown = $derived.by(() => {
    const needle = search.trim().toLocaleLowerCase();
    return byType
      .map(([type, entries]) => {
        const kept = needle === '' ? entries : entries.filter((e) => e.card.name.toLocaleLowerCase().includes(needle));
        const ordered =
          sort === 'cost'
            ? [...kept].sort((a, b) => (a.card.cost ?? 99) - (b.card.cost ?? 99) || a.card.name.localeCompare(b.card.name))
            : kept;
        return [type, ordered] as const;
      })
      .filter(([, entries]) => entries.length > 0);
  });

  const missing = $derived(
    resolved.filter((entry) => !ownedPackCodes.has(entry.card.pack_code)),
  );

  const stats = $derived(deckStatistics(slots, cards));

  /**
   * Legality, only where it can be judged.
   *
   * Without the hero's own card there are no rules to check against, and
   * saying nothing is better than guessing. The validator's own principle.
   */
  const validation = $derived.by(() => {
    if (hero === null) {
      return null;
    }
    const heroPack = [...cards.values()].filter((c) => c.pack_code === hero.pack_code);
    return validateDeck(heroRules(hero, heroPack), aspects, slots, cards);
  });

  function describe(problem: DeckProblem): string {
    switch (problem.kind) {
      case 'wrongAspectCount':
        return t.problemAspectCount(problem.chosen, problem.expected);
      case 'tooFewCards':
        return t.problemTooFew(problem.actual, problem.minimum);
      case 'tooManyCards':
        return t.problemTooMany(problem.actual, problem.maximum);
      case 'missingRequired':
        return t.problemRequired(problem.cardName, problem.required, problem.actual);
      case 'offAspect':
        return t.problemOffAspect(problem.cardName, t.aspect(problem.faction));
      case 'overCopyLimit':
        return t.problemCopyLimit(problem.title, problem.total, problem.limit);
      case 'duplicateUnique':
        return t.problemDuplicateUnique(problem.title, problem.total);
      case 'unbalancedAspects':
        return t.problemUnbalanced(
          [...problem.counts.entries()]
            .map(([aspect, n]) => `${t.aspect(aspect)} ${n}`)
            .join(', '),
        );
    }
  }

  /*
   * Every cost from 0 up to at least 6, the empty ones included: a curve
   * with holes in it is not a curve, and the shape is what the chart is
   * for. Anything above 6 is rare enough to share one column.
   */
  const costColumns = $derived.by((): readonly [string, number][] => {
    const top = Math.max(6, ...stats.costCurve.keys());
    const cap = Math.min(top, 6);
    const columns: [string, number][] = [];
    for (let cost = 0; cost <= cap; cost += 1) {
      columns.push([cost === 6 ? '6+' : String(cost), 0]);
    }
    for (const [cost, count] of stats.costCurve) {
      const i = Math.min(cost, 6);
      const column = columns[i];
      if (column !== undefined) {
        column[1] += count;
      }
    }
    return columns;
  });

  const RESOURCES = [
    ['physical', '✊'],
    ['mental', '🧠'],
    ['energy', '⚡'],
    ['wild', '✶'],
  ] as const;
</script>

<div class="contents">
  <DeckBanner
    {t}
    art={heroImage}
    name={deck.name}
    heroName={deck.heroName}
    {aspects}
    cards={validation?.totalCards ?? 0}
    tall
  />

  <!--
    What can be done with the deck, in a band of its own under the banner:
    always where the eye goes first, never under the card panel, which is
    where a column of buttons at the foot of a sticky panel ended up once
    the page had scrolled.
  -->
  <div class="actions">
    <button type="button" class="btn btn--quiet" onclick={onBack}>← {t.deckBackToShelf}</button>
    <span class="grow"></span>
    <button type="button" class="btn btn--primary" onclick={onEdit}>{t.deckEdit}</button>
    <button type="button" class="btn" onclick={() => void copyText()}>{copied ? t.deckCopied : t.deckCopy}</button>
    {#if deck.kind !== 'LOCAL'}
      <a class="btn" href={deckViewUrl(deck)} target="_blank" rel="noopener">{t.viewOnMarvelCdb} ↗</a>
    {/if}
    {#if confirming}
      <span class="confirm">
        <span class="muted small">{t.deckDeleteConfirm(deck.name)}</span>
        <button type="button" class="btn danger" onclick={onDelete}>{t.deckDeleteYes}</button>
        <button type="button" class="btn btn--quiet" onclick={() => (confirming = false)}>{t.cancel}</button>
      </span>
    {:else}
      <button type="button" class="btn btn--quiet danger" onclick={() => (confirming = true)}>{t.removeDeck}</button>
    {/if}
  </div>

  <!-- A word, an order, names or pictures. -->
  <div class="toolbar">
    <label class="find">
      <span class="visually-hidden">{t.searchLabel}</span>
      <input class="field" type="search" placeholder={t.deckSearchIn} value={search} oninput={(e) => (search = e.currentTarget.value)} />
    </label>
    <label class="sort">
      <span class="muted small">{t.sortLabel}</span>
      <select class="field field--inline" value={sort} onchange={(e) => (sort = e.currentTarget.value === 'cost' ? 'cost' : 'name')}>
        <option value="name">{t.sortByName}</option>
        <option value="cost">{t.sortByCost}</option>
      </select>
    </label>
    <div class="segments" role="group">
      <button type="button" class="segment" aria-pressed={view === 'list'} onclick={() => (view = 'list')}>{t.viewList}</button>
      <button type="button" class="segment" aria-pressed={view === 'grid'} onclick={() => (view = 'grid')}>{t.viewGrid}</button>
    </div>
  </div>

  <!-- The identity, set apart from the deck as the deck sites set the commander apart. -->
  {#if hero !== null}
    <CardHover code={hero.code}>
      <button type="button" class="hero-strip" onclick={() => openCard(hero.code)}>
        {#if heroImage !== null}<img class="hero-art" src={heroImage} alt="" />{/if}
        <span class="hero-text">
          <span class="muted small hero-label">{t.deckHeroLabel}</span>
          <span class="hero-name">{hero.name}</span>
        </span>
        <span class="hero-stats muted small">
          {#if hero.hand_size != null}<span><b>{t.statHandSize}</b> {hero.hand_size}</span>{/if}
          {#if hero.health != null}<span><b>{t.statHealth}</b> {hero.health}</span>{/if}
        </span>
      </button>
    </CardHover>
  {/if}

  {#if validation !== null}
    {#if validation.legal}
      <p class="ok">{t.deckLegal}</p>
    {:else}
      <div class="illegal">
        <p class="warn">{t.deckIllegal(validation.problems.length)}</p>
        <ul class="problems">
          {#each validation.problems as problem, i (i)}
            <li>{describe(problem)}</li>
          {/each}
        </ul>
      </div>
    {/if}
  {:else}
    <p class="muted note">{t.deckLegalityUnknown}</p>
  {/if}

  {#if missing.length > 0}
    <p class="warn">
      {t.deckMissing(
        missing.reduce((n, c) => n + c.quantity, 0),
        new Set(missing.map((c) => c.card.pack_code)).size,
      )}
    </p>
  {:else if resolved.length > 0}
    <p class="ok">{t.deckBuildable}</p>
  {/if}

  {#if unresolved.length > 0}
    <p class="muted note">{t.deckUnknownCards(unresolved.length)}</p>
  {/if}

  <!-- What the deck is made of: can I afford my cards early, can I pay for
       them at all, and is it the shape I meant it to be. -->
  <div class="body">
    <!--
      The list in columns, as a printed decklist is laid out, with the card
      the pointer last rested on pinned beside it where the screen is wide
      enough. The statistics come after: what is in the deck first, then what
      it adds up to.
    -->
    <div class="groups" class:grid={view === 'grid'}>
  {#each shown as [type, entries] (type)}
    <h3>{type} <span class="muted count">{entries.reduce((n, e) => n + e.quantity, 0)}</span></h3>
    {#if view === 'grid'}
      <ul class="pictures">
        {#each entries as entry (entry.code)}
          <li>
            <CardHover code={entry.code}>
              <button type="button" class="picture" onclick={() => openCard(entry.code)} aria-label={entry.card.name}>
                {#if cardImageUrl(entry.card.imagesrc) !== null}
                  <img src={cardImageUrl(entry.card.imagesrc)} alt="" loading="lazy" />
                {:else}
                  <span class="no-art">{entry.card.name}</span>
                {/if}
                {#if entry.quantity > 1}<span class="badge">×{entry.quantity}</span>{/if}
              </button>
            </CardHover>
          </li>
        {/each}
      </ul>
    {:else}
    <ul class="cards">
      {#each entries as entry (entry.code)}
        {@const owned = ownedPackCodes.has(entry.card.pack_code)}
        <li class:missing={!owned}>
          <span class="qty">{entry.quantity}</span>
          <CardHover code={entry.code}>
            <a
              href={cardHref(entry.code)}
              data-faction={entry.card.faction_code}
              onclick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
                  return;
                }
                e.preventDefault();
                openCard(entry.code);
              }}
            >
              {entry.card.name}
            </a>
          </CardHover>
          <!--
            A card from a pack not owned wears one mark, and says which box on
            hover: the line above the list already counts them and names the
            packs, so the row needs a flag, not a sentence.
          -->
          {#if !owned}
            <span class="mark" title={`${t.notOwned} · ${packNames.get(entry.card.pack_code) ?? entry.card.pack_code}`} aria-label={t.notOwned}>✕</span>
          {/if}
          {#if entry.card.cost !== null && entry.card.cost !== undefined}
            <span class="cost">{entry.card.cost}</span>
          {/if}
        </li>
      {/each}
    </ul>
    {/if}
  {/each}
    </div>
    <div class="side">
      <CardPanel {t} initial={deck.heroCode} from="(min-width: 64rem)" />
    </div>
  </div>

  {#if nemesis.length > 0}
    <section class="nemesis">
      <h3>{t.deckNemesis} <span class="muted count">{nemesis.length}</span></h3>
      <p class="muted small">{t.deckNemesisNote}</p>
      <ul class="pictures">
        {#each nemesis as card (card.code)}
          <li>
            <CardHover code={card.code}>
              <button type="button" class="picture" onclick={() => openCard(card.code)} aria-label={card.name}>
                {#if cardImageUrl(card.imagesrc) !== null}
                  <img src={cardImageUrl(card.imagesrc)} alt="" loading="lazy" />
                {:else}
                  <span class="no-art">{card.name}</span>
                {/if}
              </button>
            </CardHover>
            <span class="caption muted small">{card.name}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="composition">
    <h3>{t.deckComposition}</h3>

    {#if costColumns.length > 0}
      <div class="curve">
        <div class="bars">
          {#each costColumns as [cost, count] (cost)}
            <div class="column">
              <span class="column-count muted">{count}</span>
              <span
                class="column-bar"
                style:height={`${
                  stats.tallestCostColumn === 0
                    ? 0
                    : Math.round((count / stats.tallestCostColumn) * 100)
                }%`}
              ></span>
              <span class="column-label">{cost}</span>
            </div>
          {/each}
        </div>
        <p class="muted small">{t.averageCost(stats.averageCost.toFixed(1))}</p>
      </div>
    {/if}

    {#if stats.resources.total > 0}
      <ul class="resources">
        {#each RESOURCES as [key, icon] (key)}
          <li>
            <span aria-hidden="true">{icon}</span>
            <strong>{stats.resources[key]}</strong>
            <span class="muted small">{t.resourceName(key)}</span>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="breakdowns">
      <div>
        <h4>{t.deckByType}</h4>
        {#each stats.byType as [name, count] (name)}
          <div class="breakdown-row">
            <span class="breakdown-label">{name}</span>
            <span class="breakdown-bar">
              <span
                class="breakdown-fill"
                style:width={`${Math.round((count / (validation?.totalCards || 1)) * 100)}%`}
              ></span>
            </span>
            <span class="muted small">{count}</span>
          </div>
        {/each}
      </div>

      <!-- With a single aspect the bar is just the deck size again, which
           tells nobody anything. -->
      {#if stats.byAspect.length > 1}
        <div>
          <h4>{t.deckByAspect}</h4>
          {#each stats.byAspect as [name, count] (name)}
            <div class="breakdown-row">
              <span class="breakdown-label">{name}</span>
              <span class="breakdown-bar">
                <span
                  class="breakdown-fill"
                  style:width={`${Math.round((count / (validation?.totalCards || 1)) * 100)}%`}
                ></span>
              </span>
              <span class="muted small">{count}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </section>

  <p class="muted note locale-note">{t.deckLocaleNote(cardLocale)}</p>
</div>

<style>
  .contents {
    margin: 0 0 var(--space-4);
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin: var(--space-3) 0;
  }

  .find {
    flex: 1 1 14rem;
  }

  .sort {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .field--inline {
    width: auto;
    display: inline-block;
  }

  .segments {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }

  .segment {
    min-height: 2.25rem;
    padding-inline: var(--space-3);
    border: 0;
    border-radius: calc(var(--radius-sm) - 2px);
    background: none;
    color: var(--text);
    font: inherit;
    font-weight: var(--weight-semibold);
    cursor: pointer;
  }

  .segment[aria-pressed='true'] {
    background: var(--surface-1);
    box-shadow: 0 1px 2px rgb(0 0 0 / 12%);
  }

  /* The identity as a strip: its art behind, its name, the two numbers that matter. */
  .hero-strip {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    max-width: 30rem;
    min-height: 3.5rem;
    margin: 0 auto var(--space-4);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: 999px;
    background: var(--surface-1);
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
    overflow: hidden;
  }

  .hero-art {
    flex: 0 0 auto;
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 50%;
    object-fit: cover;
    object-position: 50% 18%;
  }

  .hero-text {
    display: grid;
    min-width: 0;
  }

  .hero-label {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: var(--text-2xs);
  }

  .hero-name {
    font-weight: var(--weight-bold);
  }

  .hero-stats {
    margin-inline-start: auto;
    display: inline-flex;
    gap: var(--space-3);
    white-space: nowrap;
  }

  .count {
    font-weight: normal;
    font-size: var(--text-xs);
    margin-inline-start: 0.3em;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-3) 0 0;
  }

  .grow {
    flex: 1 1 auto;
  }

  .confirm {
    flex: 1 0 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .danger {
    color: var(--danger);
  }

  /* Pictures, for the grid view and the nemesis set: card-shaped, a
     picture each, the count on the corner when there is more than one. */
  .pictures {
    list-style: none;
    margin: 0 0 var(--space-3);
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
    gap: var(--space-2);
  }

  .pictures li {
    display: grid;
    gap: 2px;
  }

  .picture {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 5 / 7;
    padding: 0;
    border: 0;
    border-radius: 4.5% / 3.2%;
    background: var(--surface-2);
    overflow: hidden;
    cursor: pointer;
    box-shadow: 0 2px 6px rgb(0 0 0 / 18%);
  }

  .picture img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .no-art {
    display: grid;
    place-items: center;
    height: 100%;
    padding: var(--space-2);
    font-size: var(--text-xs);
    text-align: center;
  }

  .badge {
    position: absolute;
    right: 4%;
    bottom: 4%;
    padding: 0.1em 0.5em;
    border-radius: 999px;
    background: rgb(0 0 0 / 75%);
    color: #fff;
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
  }

  .caption {
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .groups.grid {
    column-width: auto;
    columns: auto;
  }

  .nemesis {
    margin: var(--space-4) 0;
  }

  h3 {
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin: var(--space-4) 0 var(--space-2);
  }

  h4 {
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin: 0 0 var(--space-2);
    font-weight: 600;
  }

  .note,
  .small {
    font-size: var(--text-sm);
  }

  .note {
    max-width: var(--prose-max);
  }

  .warn {
    color: var(--danger);
    font-weight: 600;
    margin-bottom: var(--space-1);
  }

  /*
   * Good news is not coloured.
   *
   * The palette has no green in it (the app's own choice, so that the aspect
   * colours keep their meaning), and primary is the same red as error, so a
   * green-for-yes convention is not available. A tick and ordinary text carry
   * it instead, leaving red to mean only "something is wrong here".
   */
  .ok {
    font-weight: 600;
  }

  .ok::before {
    content: '✓';
    color: var(--text);
    margin-inline-end: var(--space-2);
  }

  .illegal {
    margin: var(--space-3) 0;
  }

  .problems {
    margin: 0;
    padding-inline-start: var(--space-5);
    font-size: var(--text-sm);
  }

  .composition {
    margin: var(--space-4) 0;
    padding: var(--space-4) 0;
    border-block: 1px solid var(--hairline);
  }

  .curve .bars {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    height: 9rem;
    max-width: 30rem;
  }

  .column {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-0-5);
    flex: 1 1 0;
    height: 100%;
  }

  .column-bar {
    display: block;
    width: 100%;
    background: var(--accent);
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    min-height: 2px;
  }

  .column-count,
  .column-label {
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
  }

  .column-label {
    font-weight: 600;
  }

  .resources {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    list-style: none;
    padding: 0;
    margin: var(--space-4) 0 0;
  }

  .resources li {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
  }

  .breakdowns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr));
    gap: var(--space-4);
    margin-top: var(--space-4);
  }

  .breakdown-row {
    display: grid;
    grid-template-columns: minmax(6rem, 9rem) 1fr auto;
    align-items: center;
    gap: var(--space-2);
    padding: 1px 0;
    font-size: var(--text-sm);
  }

  .breakdown-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .breakdown-bar {
    height: 0.55rem;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    overflow: hidden;
  }

  .breakdown-fill {
    display: block;
    height: 100%;
    background: var(--text);
  }

  .body {
    display: grid;
    gap: var(--space-4);
    margin-top: var(--space-3);
  }

  .side {
    display: none;
  }

  @media (min-width: 64rem) {
    .body {
      grid-template-columns: minmax(0, 1fr) 17rem;
      /* Tall enough that a short deck still leaves the panel somewhere to be. */
      min-height: 40rem;
    }
    /*
     * The panel's height must not be the page's. Its text is a different
     * length for every card, and when the side column set the row's height
     * every hover pushed everything below the list up or down -- the nemesis
     * pictures moved out from under the pointer that was reading them. Size
     * containment makes the column as tall as the row the list decides and
     * no taller, whatever the panel holds; the panel sticks inside it.
     */
    .side {
      display: block;
      contain: size;
      align-self: stretch;
    }
  }

  /* Columns that fill top to bottom then across, a group never split. */
  .groups {
    column-width: 16rem;
    column-gap: var(--space-5);
  }

  .groups h3,
  .groups ul {
    break-inside: avoid;
  }

  .groups h3 {
    break-after: avoid;
  }

  .cards {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(20rem, 100%), 1fr));
    gap: var(--space-1) var(--space-4);
  }

  .cards li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 1.9rem;
    padding: 1px 0;
  }

  .cards li.missing a {
    opacity: 0.65;
  }

  /* The count as a small square, the way decklists print it. */
  .qty {
    flex: 0 0 auto;
    min-width: 1.4rem;
    height: 1.4rem;
    display: inline-grid;
    place-items: center;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border: 1px solid var(--hairline);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    font-variant-numeric: tabular-nums;
  }

  /* The printed cost, a small circle at the end of the line. */
  .cost {
    flex: 0 0 auto;
    margin-inline-start: auto;
    width: 1.3rem;
    height: 1.3rem;
    display: inline-grid;
    place-items: center;
    border-radius: 50%;
    background: var(--surface-2);
    border: 1px solid var(--border);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    font-variant-numeric: tabular-nums;
  }

  .mark {
    flex: 0 0 auto;
    color: var(--danger);
    font-size: var(--text-xs);
    cursor: help;
  }

  .cards a {
    color: inherit;
    text-decoration: none;
    border-inline-start: 3px solid transparent;
    padding-inline-start: var(--space-2);
  }

  .cards a:hover {
    text-decoration: underline;
  }

  .cards a[data-faction='aggression'] {
    border-inline-start-color: var(--faction-aggression);
  }
  .cards a[data-faction='justice'] {
    border-inline-start-color: var(--faction-justice);
  }
  .cards a[data-faction='leadership'] {
    border-inline-start-color: var(--faction-leadership);
  }
  .cards a[data-faction='protection'] {
    border-inline-start-color: var(--faction-protection);
  }
  .cards a[data-faction='pool'] {
    border-inline-start-color: var(--faction-pool);
  }
  .cards a[data-faction='basic'] {
    border-inline-start-color: var(--faction-basic);
  }
  .cards a[data-faction='hero'] {
    border-inline-start-color: var(--faction-hero);
  }


  .locale-note {
    margin-top: var(--space-5);
    padding-top: var(--space-3);
    border-top: 1px solid var(--hairline);
  }


</style>
