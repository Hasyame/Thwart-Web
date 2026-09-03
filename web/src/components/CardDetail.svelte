<script lang="ts">
  import type { Card, Locale } from '../lib/types';
  import type { Strings } from '../lib/i18n';
  import { cardImageUrl, marvelCdbCardUrl } from '../lib/data';

  interface Props {
    card: Card;
    cardLocale: Locale;
    t: Strings;
    isFavourite: boolean;
    canFavourite: boolean;
    onToggleFavourite: () => void;
  }

  const {
    card,
    cardLocale,
    t,
    isFavourite,
    canFavourite,
    onToggleFavourite,
  }: Props = $props();

  const image = $derived(cardImageUrl(card.imagesrc));
  const backImage = $derived(cardImageUrl(card.backimagesrc));

  interface Stat {
    readonly label: string;
    readonly value: number;
  }

  /**
   * The statistics this card actually has.
   *
   * Zero is a real value in this game — a zero-cost ally, a scheme with no
   * acceleration — so the test is for absence, not falsiness. `?? null` and an
   * explicit null check rather than a truthiness check, which would silently
   * hide every nought.
   */
  const stats = $derived(
    (
      [
        [t.statHealth, card.health ?? null],
        [t.statHandSize, card.hand_size ?? null],
        [t.statAttack, card.attack ?? null],
        [t.statThwart, card.thwart ?? null],
        [t.statDefense, card.defense ?? null],
        [t.statRecover, card.recover ?? null],
        [t.statScheme, card.scheme ?? null],
        [t.statBoost, card.boost ?? null],
        [t.statThreat, card.threat ?? null],
      ] as ReadonlyArray<readonly [string, number | null]>
    )
      .filter((entry): entry is readonly [string, number] => entry[1] !== null)
      .map(([label, value]): Stat => ({ label, value })),
  );

  const resources = $derived(
    (
      [
        ['🔵', card.resource_mental ?? 0],
        ['🟠', card.resource_physical ?? 0],
        ['⚡', card.resource_energy ?? 0],
        ['✳️', card.resource_wild ?? 0],
      ] as ReadonlyArray<readonly [string, number]>
    ).filter(([, count]) => count > 0),
  );
</script>

<article class="detail">
  <div class="text-column">
    <header>
      <h1>
        {card.name}
        {#if card.is_unique === true}<span class="unique" title={t.unique}>◆</span>{/if}
      </h1>
      {#if card.subname !== null && card.subname !== undefined && card.subname !== ''}
        <p class="subname muted">{card.subname}</p>
      {/if}
      <p class="classification muted">
        {card.type_name} · {card.faction_name}
      </p>

      {#if canFavourite}
        <button
          type="button"
          class="favourite"
          class:on={isFavourite}
          aria-pressed={isFavourite}
          onclick={onToggleFavourite}
        >
          <span aria-hidden="true">{isFavourite ? '★' : '☆'}</span>
          {isFavourite ? t.unfavourite : t.favourite}
        </button>
      {/if}
    </header>

    {#if card.traits !== null && card.traits !== undefined && card.traits !== ''}
      <p class="traits">{card.traits}</p>
    {/if}

    <div class="numbers">
      {#if card.cost !== null && card.cost !== undefined}
        <span class="chip"><b>{t.cost}</b> {card.cost}</span>
      {/if}
      {#each stats as stat (stat.label)}
        <span class="chip"><b>{stat.label}</b> {stat.value}</span>
      {/each}
    </div>

    {#if resources.length > 0}
      <p class="resources">
        <span class="muted">{t.resources}:</span>
        {#each resources as [icon, count] (icon)}
          <span class="resource">{icon.repeat(count)}</span>
        {/each}
      </p>
    {/if}

    {#if card.text !== null && card.text !== undefined && card.text !== ''}
      <!-- Sanitised at build time in scripts/fetch-cards.mjs, which strips
           every tag outside a small allow-list. This is the only place the
           project renders third-party markup, and it is safe because of that
           step rather than because MarvelCDB is trusted. -->
      <div class="card-text">{@html card.text}</div>
    {/if}

    {#if card.flavor !== null && card.flavor !== undefined && card.flavor !== ''}
      <blockquote class="flavor">{@html card.flavor}</blockquote>
    {/if}

    {#if card.back_text !== null && card.back_text !== undefined && card.back_text !== ''}
      <div class="back">
        {#if card.back_name !== undefined && card.back_name !== null}
          <h2>{card.back_name}</h2>
        {/if}
        <div class="card-text">{@html card.back_text}</div>
      </div>
    {/if}

    <dl class="facts">
      <dt>{t.pack}</dt>
      <dd>{card.pack_name}</dd>
      {#if card.illustrator !== null && card.illustrator !== undefined && card.illustrator !== ''}
        <dt>{t.illustrator}</dt>
        <dd>{card.illustrator}</dd>
      {/if}
    </dl>

    <p>
      <a href={marvelCdbCardUrl(cardLocale, card.code)} target="_blank" rel="noopener">
        {t.viewOnMarvelCdb} ↗
      </a>
    </p>
  </div>

  {#if image !== null}
    <div class="image-column">
      <!-- Referenced from MarvelCDB, never copied. See docs/design/01. -->
      <img src={image} alt={card.name} loading="lazy" />
      {#if backImage !== null}
        <img src={backImage} alt={card.name} loading="lazy" />
      {/if}
    </div>
  {/if}
</article>

<style>
  .detail {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 20rem);
    gap: var(--space-5);
    align-items: start;
  }

  h1 {
    font-size: var(--text-2xl);
  }

  .unique {
    color: var(--text);
    font-size: 0.7em;
    vertical-align: middle;
  }

  .subname,
  .classification {
    margin: var(--space-1) 0 0;
  }

  .favourite {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-3);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: var(--text-sm);
  }

  .favourite:hover {
    background: var(--surface-2);
  }

  .favourite.on {
    border-color: var(--accent);
    color: var(--accent);
  }

  .traits {
    font-style: italic;
    font-weight: 600;
    color: var(--text);
    margin: var(--space-4) 0 0;
  }

  .numbers {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-4) 0;
  }

  .chip {
    color: var(--text-muted);
  }

  .resources {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .card-text {
    margin: var(--space-4) 0;
    line-height: 1.6;
  }

  /* The icon spans are injected into sanitised HTML by the build script, so
     Svelte's scoping never sees them and :global is the only way to reach
     them. See renderIcons() in scripts/fetch-cards.mjs. */
  .card-text :global([data-icon]),
  .flavor :global([data-icon]) {
    display: inline-block;
    font-size: 0.95em;
    line-height: 1;
    color: var(--text);
  }

  .card-text :global([data-icon='star']),
  .flavor :global([data-icon='star']) {
    color: var(--text-muted);
  }

  .flavor {
    margin: var(--space-4) 0;
    padding-inline-start: var(--space-4);
    border-inline-start: 3px solid var(--text);
    font-style: italic;
    color: var(--text-muted);
  }

  .back {
    margin-top: var(--space-5);
    padding-top: var(--space-4);
    border-top: 1px solid var(--hairline);
  }

  .back h2 {
    font-size: var(--text-xl);
  }

  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-1) var(--space-4);
    margin: var(--space-5) 0;
    font-size: var(--text-sm);
  }

  .facts dt {
    font-weight: 600;
    color: var(--text-muted);
  }

  .facts dd {
    margin: 0;
  }

  .image-column {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    position: sticky;
    top: var(--space-4);
  }

  .image-column img {
    width: 100%;
    height: auto;
    border-radius: var(--radius-md);
    border: 1px solid var(--hairline);
  }

  @media (max-width: 52rem) {
    .detail {
      grid-template-columns: minmax(0, 1fr);
    }

    .image-column {
      position: static;
      order: -1;
      max-width: 18rem;
    }
  }
</style>
