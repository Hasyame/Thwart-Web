<script lang="ts">
  import type { Card, Locale } from '../lib/types';
  import type { SavedDeck } from '../lib/records';
  import type { Strings } from '../lib/i18n';
  import { cardImageUrl } from '../lib/data';
  import { deckViewUrl, parseSlots } from '../lib/decks';
  import {
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
  }

  const { t, deck, cardLocale, cards, ownedPackCodes, packNames, openCard, cardHref }:
    Props = $props();

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

  const costColumns = $derived(
    [...stats.costCurve.entries()].sort((a, b) => a[0] - b[0]),
  );

  const RESOURCES = [
    ['physical', '✊'],
    ['mental', '🧠'],
    ['energy', '⚡'],
    ['wild', '✶'],
  ] as const;

  /** The card being previewed, and where to put the preview. */
  let preview = $state<{ card: Card; x: number; y: number } | null>(null);

  function showPreview(card: Card, event: MouseEvent): void {
    if (cardImageUrl(card.imagesrc) === null) {
      return;
    }
    preview = { card, x: event.clientX, y: event.clientY };
  }
</script>

<div class="contents surface">
  <header class="head">
    <div>
      <h2>{deck.name}</h2>
      <p class="muted">
        {deck.heroName} · {t.cardCount(validation?.totalCards ?? 0)}{aspects.length === 0
          ? ''
          : ` · ${aspects.map((a) => t.aspect(a)).join(' / ')}`}
      </p>
    </div>
    <!--
      Only an imported deck has a page to link to. A deck built here has no
      MarvelCDB id, so the link would go nowhere.
    -->
    {#if deck.kind !== 'LOCAL'}
      <a href={deckViewUrl(deck)} target="_blank" rel="noopener">
        {t.viewOnMarvelCdb} ↗
      </a>
    {/if}
  </header>

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

  {#each byType as [type, entries] (type)}
    <h3>{type}</h3>
    <ul class="cards">
      {#each entries as entry (entry.code)}
        <li class:missing={!ownedPackCodes.has(entry.card.pack_code)}>
          <span class="qty">{entry.quantity}×</span>
          <a
            href={cardHref(entry.code)}
            data-faction={entry.card.faction_code}
            onmouseenter={(e) => showPreview(entry.card, e)}
            onmousemove={(e) => showPreview(entry.card, e)}
            onmouseleave={() => (preview = null)}
            onfocus={() => (preview = null)}
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
          <!-- Which box it came from, so a missing card can be found. -->
          <span class="pack muted" title={packNames.get(entry.card.pack_code) ?? ''}>
            [{entry.card.pack_code.toUpperCase()}]
          </span>
          {#if entry.card.cost !== null && entry.card.cost !== undefined}
            <span class="muted small">{entry.card.cost}</span>
          {/if}
          {#if !ownedPackCodes.has(entry.card.pack_code)}
            <span class="tag">{t.notOwned}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/each}

  <p class="muted note locale-note">{t.deckLocaleNote(cardLocale)}</p>
</div>

{#if preview !== null}
  <!--
    Follows the pointer rather than sitting under the row: a deck list is long,
    and a preview anchored to the row would fall off the screen as often as not.
    Flipped to the other side when it would overflow.
  -->
  <div
    class="preview"
    style:left={`${Math.min(preview.x + 20, window.innerWidth - 260)}px`}
    style:top={`${Math.min(preview.y + 12, window.innerHeight - 360)}px`}
  >
    <img src={cardImageUrl(preview.card.imagesrc)} alt="" loading="eager" />
  </div>
{/if}

<style>
  .contents {
    padding: var(--space-4);
    margin: var(--space-4) 0;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-3);
  }

  h2 {
    font-size: var(--text-lg);
    margin: 0 0 var(--space-1);
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
    height: 6rem;
  }

  .column {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-0-5);
    flex: 0 0 2rem;
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
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
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

  .cards {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
    gap: var(--space-1) var(--space-4);
  }

  .cards li {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: 2px 0;
  }

  .cards li.missing a {
    opacity: 0.65;
  }

  .qty {
    min-width: 1.8rem;
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
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

  .pack {
    font-size: var(--text-2xs);
    letter-spacing: 0.03em;
    font-variant-numeric: tabular-nums;
  }

  .tag {
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--danger);
    border: 1px solid currentColor;
    border-radius: var(--radius-sm);
    padding: 0 var(--space-1);
  }

  .locale-note {
    margin-top: var(--space-5);
    padding-top: var(--space-3);
    border-top: 1px solid var(--hairline);
  }

  .preview {
    position: fixed;
    z-index: 50;
    pointer-events: none;
    width: 240px;
    border-radius: var(--radius-md);
    overflow: hidden;
    box-shadow: 0 8px 28px var(--scrim);
    border: 1px solid var(--border);
    background: var(--surface-1);
  }

  .preview img {
    display: block;
    width: 100%;
    height: auto;
  }

  @media (hover: none) {
    /* No pointer, no preview: on a touch screen it would only ever appear
       under a finger that has already tapped through to the card. */
    .preview {
      display: none;
    }
  }
</style>
