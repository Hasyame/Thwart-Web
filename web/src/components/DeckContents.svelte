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
</script>

<div class="contents surface">
  <DeckBanner
    {t}
    art={cardImageUrl(cards.get(deck.heroCode)?.imagesrc)}
    name={deck.name}
    heroName={deck.heroName}
    {aspects}
    cards={validation?.totalCards ?? 0}
  />
  <!--
    Only an imported deck has a page to link to. A deck built here has no
    MarvelCDB id, so the link would go nowhere.
  -->
  {#if deck.kind !== 'LOCAL'}
    <p class="head">
      <a href={deckViewUrl(deck)} target="_blank" rel="noopener">
        {t.viewOnMarvelCdb} ↗
      </a>
    </p>
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
    <div class="groups">
  {#each byType as [type, entries] (type)}
    <h3>{type}</h3>
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
  {/each}
    </div>
    <div class="side">
      <CardPanel {t} initial={deck.heroCode} from="(min-width: 64rem)" />
    </div>
  </div>

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
    padding: 0 var(--space-4) var(--space-4);
    margin: var(--space-4) 0;
    overflow: hidden;
  }

  .head {
    margin: var(--space-3) 0 0;
    text-align: end;
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
      grid-template-columns: minmax(0, 1fr) 14rem;
      align-items: start;
    }
    .side {
      display: block;
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
