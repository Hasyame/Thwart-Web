<script lang="ts">
  import { tick } from 'svelte';
  import type { Play } from '../lib/records';
  import type { Locale } from '../lib/types';
  import type { Strings } from '../lib/i18n';
  import type { CampaignProgress } from '../lib/campaigns';
  import type { CampaignTemplate } from '../lib/campaign/types';
  import { fieldHue, scenarioFaceOf, type CampaignTile } from '../lib/campaignTile';
  import { fetchCard } from '../lib/cardViewer.svelte';
  import { cardImageUrl } from '../lib/data';
  import { formatElapsed } from '../lib/session.svelte';
  import PlayRow from './PlayRow.svelte';

  /**
   * One campaign, as a page: the box across the top, its scenarios as a strip
   * of cards to read left to right, the heroes at the table, what the log
   * holds, and the way to delete it all.
   *
   * The shelf opens this, and playing happens one step further in (the
   * scenario's briefing and tracker, CampaignRun). Before, the shelf went
   * straight into the next scenario and everything else about a campaign
   * sat in a fold under its tile. The layout follows ArkhamCards' campaign
   * screen, at the owner's request, in this site's own comic style.
   */

  interface Props {
    t: Strings;
    uiLocale: Locale;
    campaign: CampaignProgress;
    tile: CampaignTile | undefined;
    template: CampaignTemplate | null;
    /** The box's picture: the final villain, or bundled key art. */
    art: string | undefined;
    /** True for bundled key art, already landscape; a card is cropped to its art. */
    boxArt: boolean;
    plays: readonly Play[];
    eventCount: number;
    /** "Saved on your account" or "only here", when signed in; else null. */
    storageNote: string | null;
    onContinue: () => void;
    onBack: () => void;
    onDelete: () => Promise<void>;
  }

  const { t, uiLocale, campaign, tile, template, art, boxArt, plays, eventCount, storageNote, onContinue, onBack, onDelete }: Props = $props();

  const status = $derived(tile?.status ?? 'not-started');
  const live = $derived(status === 'not-started' || status === 'in-progress');
  const folded = $derived(tile?.state ?? null);
  /** The scenario the next step belongs to, while the campaign is going. */
  const currentId = $derived(live ? (folded?.currentScenarioId ?? null) : null);

  type Step = 'won' | 'current' | 'lost' | 'later';
  const steps = $derived(
    campaign.scenarios.map((scenario, i) => {
      const step: Step = scenario.won
        ? 'won'
        : scenario.id === currentId
          ? 'current'
          : scenario.attempts > 0
            ? 'lost'
            : 'later';
      const source = template?.scenarios?.find((s) => s.id === scenario.id);
      return { ...scenario, n: i + 1, step, face: source === undefined ? null : scenarioFaceOf(source) };
    }),
  );

  /*
   * Faces for the strip and the heroes, through the card viewer's cache:
   * referenced from MarvelCDB, never copied. A card that does not arrive
   * leaves a colour field, which is what offline looks like.
   */
  let images = $state.raw<ReadonlyMap<string, string>>(new Map());
  $effect(() => {
    const codes = [
      ...new Set([
        ...steps.map((s) => s.face).filter((c): c is string => c !== null),
        ...(folded?.heroes ?? []).map((h) => h.heroCardCode),
      ]),
    ];
    let cancelled = false;
    void Promise.all(codes.map((code) => fetchCard(code).then((card) => [code, cardImageUrl(card?.imagesrc)] as const))).then((pairs) => {
      if (!cancelled) {
        images = new Map(pairs.flatMap(([code, url]) => (url === null ? [] : [[code, url] as const])));
      }
    });
    return () => {
      cancelled = true;
    };
  });

  // The strip opens on the scenario being played, not on the first one.
  let strip = $state.raw<HTMLOListElement | null>(null);
  $effect(() => {
    void currentId;
    void tick().then(() => {
      const card = strip?.querySelector<HTMLElement>('[data-step="current"]');
      if (card !== null && card !== undefined && strip !== null) {
        strip.scrollLeft = card.offsetLeft - strip.offsetLeft - 8;
      }
    });
  });

  const stepWord = (step: Step, attempts: number): string =>
    step === 'won'
      ? t.campaignScenarioBeaten
      : step === 'current'
        ? t.campaignScenarioNext
        : step === 'lost'
          ? t.attempts(attempts)
          : t.campaignScenarioLater;
  const stepGlyph = (step: Step): string => ({ won: '✓', current: '▶', lost: '✗', later: '·' })[step];

  let deleting = $state(false);
  let busy = $state(false);
  async function remove(): Promise<void> {
    busy = true;
    try {
      await onDelete();
    } finally {
      busy = false;
      deleting = false;
    }
  }
</script>

<div class="hub">
  <button class="back" type="button" onclick={onBack}>← {t.campaignsTitle}</button>

  <h1 class="comic-title">{campaign.title}</h1>

  <!-- The box: its picture, its name and difficulty, who is playing. -->
  <header class="banner" style:--field-hue={fieldHue(campaign.run.templateId)}>
    {#if art !== undefined}<img class="banner-art" class:card={!boxArt} src={art} alt="" />{/if}
    <span class="scrim" aria-hidden="true"></span>
    <div class="banner-body">
      {#if campaign.run.templateName !== campaign.title}<p class="box-name">{campaign.run.templateName}</p>{/if}
      <p class="banner-meta">
        <span class="level">{t.campaignDifficulty(campaign.run.difficulty)}</span>
        {#if !live}<span class="level over">{t.campaignOver}</span>{/if}
        <span class="progress-words">{t.campaignProgress(tile?.beaten ?? campaign.completed, tile?.total ?? campaign.scenarios.length)}</span>
      </p>
      {#if (folded?.heroes.length ?? 0) > 0}
        <ul class="faces">
          {#each folded?.heroes ?? [] as hero (hero.id)}
            {@const face = images.get(hero.heroCardCode)}
            <li class="face" title={hero.name}>
              {#if face !== undefined}<img src={face} alt={hero.name} loading="lazy" />{:else}<span>{hero.name.slice(0, 1)}</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </header>

  <!--
    The scenarios, as cards in a strip: beaten, the one to play, the ones to
    come. The card to play carries the way on; a campaign waiting on a choice
    (which scenario next, which place to defend) gets the button above.
  -->
  <section class="block">
    <div class="block-head">
      <h2>{t.campaignScenariosTitle}</h2>
      {#if live && currentId === null}
        <button class="btn btn--primary" type="button" onclick={onContinue}>{t.campaignContinue}</button>
      {/if}
    </div>
    <ol class="strip" bind:this={strip}>
      {#each steps as scenario (scenario.id)}
        {@const face = scenario.face === null ? undefined : images.get(scenario.face)}
        <li class="scenario" data-step={scenario.step} style:--field-hue={fieldHue(scenario.id)}>
          <div class="scenario-art">
            {#if face !== undefined}<img src={face} alt="" loading="lazy" />{/if}
            <span class="mark" aria-hidden="true">{stepGlyph(scenario.step)}</span>
          </div>
          <div class="scenario-body">
            <span class="muted small">{t.campaignScenarioN(scenario.n)}</span>
            <strong class="scenario-name">{scenario.name}</strong>
            <span class="step-word">{stepWord(scenario.step, scenario.attempts)}</span>
            {#if scenario.step === 'current'}
              <button class="btn btn--primary" type="button" onclick={onContinue}>
                {status === 'not-started' ? t.campaignStart : t.campaignContinue}
              </button>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
  </section>

  {#if (folded?.heroes.length ?? 0) > 0}
    <section class="block">
      <h2>{t.campaignHeroesTitle(folded?.heroes.length ?? 0)}</h2>
      <ul class="heroes">
        {#each folded?.heroes ?? [] as hero (hero.id)}
          {@const face = images.get(hero.heroCardCode)}
          <li class="hero surface">
            <span class="hero-face" aria-hidden="true">
              {#if face !== undefined}<img src={face} alt="" loading="lazy" />{/if}
            </span>
            <span class="hero-name">{hero.name}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="block">
    <h2>{t.campaignInfoTitle}</h2>
    <div class="surface info">
      {#if campaign.notice !== ''}<p class="muted">{campaign.notice}</p>{/if}
      {#if campaign.run.timerAccumulatedMillis > 0}
        <p>{t.timePlayed(formatElapsed(campaign.run.timerAccumulatedMillis))}</p>
      {/if}
      {#if storageNote !== null}<p class="muted small">{storageNote}</p>{/if}
      {#if plays.length > 0}
        <h3>{t.campaignGames}</h3>
        <ul class="games">
          {#each plays as play (play.id)}
            <PlayRow {t} {uiLocale} {play} />
          {/each}
        </ul>
      {/if}
      {#if campaign.unreadEvents > 0}
        <p class="muted small">{t.campaignUnread(campaign.unreadEvents)}</p>
      {/if}
    </div>
  </section>

  <section class="block">
    <h2>{t.campaignSettingsTitle}</h2>
    {#if deleting}
      <div class="surface info">
        <p>{t.campaignDeleteConfirm(plays.length, eventCount)}</p>
        <div class="row">
          <button class="btn btn--quiet danger" type="button" disabled={busy} onclick={() => void remove()}>{t.campaignDeleteYes}</button>
          <button class="btn btn--quiet" type="button" disabled={busy} onclick={() => (deleting = false)}>{t.cancel}</button>
        </div>
      </div>
    {:else}
      <button class="btn btn--quiet danger" type="button" onclick={() => (deleting = true)}>🗑 {t.campaignDelete}</button>
    {/if}
  </section>
</div>

<style>
  .hub {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }

  /* Quiet, under the page's own back button: this one returns to the shelf. */
  .back {
    justify-self: start;
    margin-top: var(--space-2);
    padding: var(--space-1) 0;
    min-height: var(--tap-min);
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-weight: var(--weight-semibold);
    cursor: pointer;
  }

  .hub :global(h1.comic-title) {
    margin-block: var(--space-3) 0;
  }

  /* The box, as the top of a campaign card: picture, name, who plays. */
  .banner {
    position: relative;
    overflow: hidden;
    border-radius: var(--radius-lg);
    min-height: 9.5rem;
    background: hsl(var(--field-hue) 45% 28%);
    color: #fff;
    display: flex;
    align-items: flex-end;
  }

  .banner-art {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 20%;
  }

  /* A card's art is on its right, its stats down the left: zoom to the art. */
  .banner-art.card {
    object-position: 75% 22%;
    transform: scale(1.35);
    transform-origin: 75% 22%;
  }

  .scrim {
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, rgb(0 0 0 / 85%) 0%, rgb(0 0 0 / 45%) 55%, rgb(0 0 0 / 10%) 100%);
  }

  .banner-body {
    position: relative;
    padding: var(--space-3) var(--space-4);
    display: grid;
    gap: var(--space-1);
    width: 100%;
  }

  .banner p {
    margin: 0;
  }

  .box-name {
    font-weight: var(--weight-bold);
    font-size: var(--text-lg);
    text-shadow: 0 1px 2px rgb(0 0 0 / 60%);
  }

  .banner-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  .level {
    padding: 0 var(--space-2);
    background: rgb(0 0 0 / 70%);
    border: 1px solid rgb(255 255 255 / 45%);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
  }

  .level.over {
    background: var(--accent);
    border-color: transparent;
    color: var(--accent-ink);
  }

  .faces {
    list-style: none;
    margin: var(--space-1) 0 0;
    padding: 0;
    display: flex;
    gap: var(--space-2);
  }

  .face,
  .hero-face {
    width: 3rem;
    height: 3rem;
    flex: none;
    overflow: hidden;
    border-radius: var(--radius-sm);
    border: 2px solid rgb(255 255 255 / 85%);
    background: hsl(var(--field-hue, 0) 30% 40%);
    display: grid;
    place-items: center;
    font-weight: var(--weight-bold);
  }

  .face img,
  .hero-face img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 72% 22%;
    transform: scale(2);
    transform-origin: 72% 22%;
  }

  .block {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }

  .block h2 {
    margin: var(--space-3) 0 0;
    font-size: var(--text-sm);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
  }

  .block-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  /* The strip: one card per scenario, swiped sideways, snapping to each. */
  .strip {
    list-style: none;
    margin: 0;
    padding: var(--space-1) var(--space-1) var(--space-3);
    display: flex;
    gap: var(--space-3);
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    overscroll-behavior-x: contain;
  }

  .scenario {
    flex: 0 0 min(15rem, 75%);
    scroll-snap-align: start;
    display: grid;
    grid-template-rows: auto 1fr;
    border: 2px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    overflow: hidden;
  }

  .scenario[data-step='current'] {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }

  .scenario[data-step='later'] .scenario-art {
    filter: grayscale(0.8);
    opacity: 0.7;
  }

  .scenario-art {
    position: relative;
    aspect-ratio: 16 / 9;
    background: hsl(var(--field-hue) 40% 32%);
    overflow: hidden;
  }

  .scenario-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 75% 22%;
    transform: scale(1.35);
    transform-origin: 75% 22%;
  }

  .mark {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    width: 1.8rem;
    height: 1.8rem;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: rgb(0 0 0 / 70%);
    color: #fff;
    font-weight: var(--weight-bold);
  }

  [data-step='won'] .mark {
    background: var(--ok);
  }

  [data-step='current'] .mark {
    background: var(--accent);
    color: var(--accent-ink);
  }

  .scenario-body {
    display: grid;
    align-content: start;
    gap: var(--space-1);
    padding: var(--space-3);
  }

  .scenario-name {
    font-size: var(--text-base);
  }

  .step-word {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  [data-step='won'] .step-word {
    color: var(--ok);
    font-weight: var(--weight-semibold);
  }

  [data-step='lost'] .step-word {
    color: var(--danger);
  }

  .scenario-body .btn {
    margin-top: var(--space-2);
    justify-self: start;
  }

  .heroes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }

  .hero {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
  }

  .hero-face {
    border-color: var(--border);
  }

  .hero-name {
    font-weight: var(--weight-semibold);
  }

  .info {
    padding: var(--space-3) var(--space-4);
    display: grid;
    gap: var(--space-2);
  }

  .info p,
  .info h3 {
    margin: 0;
  }

  .info h3 {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .games {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .danger {
    color: var(--danger);
    justify-self: start;
  }
</style>
